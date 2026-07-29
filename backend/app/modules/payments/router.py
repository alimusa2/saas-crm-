from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.ext.asyncio import AsyncSession
from typing import List

from app.db.session import get_db
from app.core.security import get_current_user
from app.modules.payments.schemas import InvoiceCreate, InvoiceUpdate, InvoiceResponse, PaymentCreate, PaymentResponse
from app.modules.payments.services import PaymentService

from app.modules.auth.dependencies import require_org_admin
from app.modules.auth.models import User

router = APIRouter()

def get_payment_service(db: AsyncSession = Depends(get_db)) -> PaymentService:
    return PaymentService(db)

@router.get("/invoices", response_model=List[InvoiceResponse])
async def list_invoices(
    payment_service: PaymentService = Depends(get_payment_service),
    current_user: dict = Depends(get_current_user),
    admin_user: User = Depends(require_org_admin)
):
    """List all invoices for the organization."""
    return await payment_service.get_invoices(current_user["org"])

@router.post("/invoices", response_model=InvoiceResponse, status_code=status.HTTP_201_CREATED)
async def create_invoice(
    inv_in: InvoiceCreate,
    payment_service: PaymentService = Depends(get_payment_service),
    current_user: dict = Depends(get_current_user),
    admin_user: User = Depends(require_org_admin)
):
    """Create a new invoice."""
    return await payment_service.create_invoice(inv_in, current_user["org"])

@router.patch("/invoices/{invoice_id}", response_model=InvoiceResponse)
async def update_invoice(
    invoice_id: str,
    inv_in: InvoiceUpdate,
    payment_service: PaymentService = Depends(get_payment_service),
    current_user: dict = Depends(get_current_user),
    admin_user: User = Depends(require_org_admin)
):
    """Update an invoice status."""
    invoice = await payment_service.update_invoice(invoice_id, inv_in, current_user["org"])
    if not invoice:
        raise HTTPException(status_code=404, detail="Invoice not found")
    return invoice

@router.post("/invoices/{invoice_id}/send-reminder")
async def send_invoice_reminder(
    invoice_id: str,
    payment_service: PaymentService = Depends(get_payment_service),
    current_user: dict = Depends(get_current_user),
    admin_user: User = Depends(require_org_admin)
):
    """Send payment due reminder email to the recipient."""
    inv = await payment_service.send_reminder(invoice_id, current_user["org"])
    if not inv:
        raise HTTPException(status_code=404, detail="Invoice not found")
    return {"status": "success", "message": "Reminder sent successfully"}

@router.delete("/invoices/{invoice_id}")
async def delete_invoice(
    invoice_id: str,
    payment_service: PaymentService = Depends(get_payment_service),
    current_user: dict = Depends(get_current_user),
    admin_user: User = Depends(require_org_admin)
):
    """Delete an invoice."""
    success = await payment_service.delete_invoice(invoice_id, current_user["org"])
    if not success:
        raise HTTPException(status_code=404, detail="Invoice not found")
    return {"status": "success", "message": "Invoice deleted"}

@router.post("/auto-reminders")
async def trigger_auto_reminders(
    days_before: int = Query(1, ge=0, le=30),
    payment_service: PaymentService = Depends(get_payment_service),
    current_user: dict = Depends(get_current_user),
    admin_user: User = Depends(require_org_admin)
):
    """Automatically check unpaid invoices and dispatch due date reminders based on configured lead-time (e.g. 1 day before due date)."""
    return await payment_service.process_auto_reminders(current_user["org"], days_before=days_before)

@router.get("/payments", response_model=List[PaymentResponse])
async def list_payments(
    payment_service: PaymentService = Depends(get_payment_service),
    current_user: dict = Depends(get_current_user),
    admin_user: User = Depends(require_org_admin)
):
    """List all payments for the organization."""
    return await payment_service.get_payments(current_user["org"])

@router.post("/payments", response_model=PaymentResponse, status_code=status.HTTP_201_CREATED)
async def record_payment(
    pay_in: PaymentCreate,
    payment_service: PaymentService = Depends(get_payment_service),
    current_user: dict = Depends(get_current_user),
    admin_user: User = Depends(require_org_admin)
):
    """Record a payment against an invoice."""
    return await payment_service.create_payment(pay_in, current_user["org"])


from fastapi import Request

@router.post("/stripe-webhook")
async def stripe_webhook(
    request: Request,
    db: AsyncSession = Depends(get_db)
):
    """Public webhook to handle Stripe payment notifications."""
    payload = await request.body()
    sig_header = request.headers.get("stripe-signature")
    
    event = None
    try:
        import stripe
        from app.core.config import settings
        webhook_secret = getattr(settings, "STRIPE_WEBHOOK_SECRET", None)
        if webhook_secret and sig_header:
            event = stripe.Webhook.construct_event(payload, sig_header, webhook_secret)
        else:
            event = json.loads(payload)
    except Exception:
        import json
        try:
            event = json.loads(payload)
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Invalid webhook payload: {e}")

    event_type = event.get("type") if isinstance(event, dict) else getattr(event, "type", None)
    event_data = event.get("data", {}) if isinstance(event, dict) else getattr(event, "data", {})
    
    # Emit stripe.webhook event
    from app.core.events import publish, GenericEvent
    org_id = "system"
    if isinstance(event, dict):
        org_id = event.get("data", {}).get("object", {}).get("metadata", {}).get("organization_id") or "system"
    elif hasattr(event, "data"):
        try:
            org_id = event.data.object.metadata.get("organization_id") or "system"
        except Exception:
            pass
    try:
        await publish("stripe.webhook", GenericEvent(
            event_name="stripe.webhook",
            organization_id=org_id,
            data=event if isinstance(event, dict) else getattr(event, "model_dump", lambda: {})()
        ))
    except Exception:
        pass

    if event_type in ["invoice.payment_succeeded", "checkout.session.completed"]:
        obj = event_data.get("object", {})
        metadata = obj.get("metadata", {})
        invoice_id = metadata.get("invoice_id")
        
        if not invoice_id:
            desc = obj.get("description", "")
            if "invoice_" in desc:
                invoice_id = desc.split("invoice_")[1].strip()

        if invoice_id:
            from app.modules.payments.models import Invoice
            from app.modules.payments.schemas import PaymentCreate
            from app.core.events import publish, PaymentSucceededEvent
            from sqlalchemy.future import select
            
            stmt = select(Invoice).where(Invoice.id == invoice_id)
            res = await db.execute(stmt)
            invoice = res.scalars().first()
            
            if invoice:
                pay_svc = PaymentService(db)
                await pay_svc.create_payment(
                    PaymentCreate(
                        invoice_id=invoice_id,
                        amount=float(obj.get("amount_paid", obj.get("amount_total", 0))) / 100.0,
                        method="Stripe",
                        reference=obj.get("id"),
                        status="Succeeded"
                    ),
                    organization_id=invoice.organization_id
                )
                
                await publish("payment.succeeded", PaymentSucceededEvent(
                    invoice_id=invoice_id,
                    organization_id=invoice.organization_id,
                    amount=invoice.amount,
                    entity_id=invoice_id,
                    trigger_name="payment.succeeded"
                ))
                return {"status": "success", "processed": True}

    elif event_type in ["charge.failed", "payment_intent.payment_failed", "invoice.payment_failed"]:
        obj = event_data.get("object", {})
        metadata = obj.get("metadata", {})
        invoice_id = metadata.get("invoice_id")
        
        if not invoice_id:
            desc = obj.get("description", "")
            if "invoice_" in desc:
                invoice_id = desc.split("invoice_")[1].strip()

        if invoice_id:
            from app.modules.payments.models import Invoice
            from app.modules.payments.schemas import PaymentCreate
            from app.core.events import publish, PaymentFailedEvent
            from sqlalchemy.future import select
            
            stmt = select(Invoice).where(Invoice.id == invoice_id)
            res = await db.execute(stmt)
            invoice = res.scalars().first()
            
            if invoice:
                pay_svc = PaymentService(db)
                await pay_svc.create_payment(
                    PaymentCreate(
                        invoice_id=invoice_id,
                        amount=float(obj.get("amount_failed", obj.get("amount", 0))) / 100.0,
                        method="Stripe",
                        reference=obj.get("id"),
                        status="Failed"
                    ),
                    organization_id=invoice.organization_id
                )
                
                await publish("payment.failed", PaymentFailedEvent(
                    invoice_id=invoice_id,
                    organization_id=invoice.organization_id,
                    amount=invoice.amount,
                    error_message=obj.get("failure_message") or "Stripe payment failed",
                    entity_id=invoice_id,
                    trigger_name="payment.failed"
                ))
                return {"status": "success", "processed": True}
                
    return {"status": "success", "processed": False}


@router.post("/paypal-webhook")
async def paypal_webhook(
    request: Request,
    db: AsyncSession = Depends(get_db)
):
    """Public webhook to handle PayPal notifications."""
    try:
        payload = await request.json()
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid JSON: {e}")

    event_type = payload.get("event_type")
    resource = payload.get("resource", {})

    if event_type == "PAYMENT.SALE.COMPLETED":
        invoice_id = resource.get("custom") or resource.get("invoice_number")
        
        if invoice_id:
            from app.modules.payments.models import Invoice
            from app.modules.payments.schemas import PaymentCreate
            from app.core.events import publish, PaymentSucceededEvent
            from sqlalchemy.future import select
            
            stmt = select(Invoice).where(Invoice.id == invoice_id)
            res = await db.execute(stmt)
            invoice = res.scalars().first()
            
            if invoice:
                pay_svc = PaymentService(db)
                amount = float(resource.get("amount", {}).get("total", 0.0))
                await pay_svc.create_payment(
                    PaymentCreate(
                        invoice_id=invoice_id,
                        amount=amount,
                        method="PayPal",
                        reference=resource.get("id"),
                        status="Succeeded"
                    ),
                    organization_id=invoice.organization_id
                )
                
                await publish("payment.succeeded", PaymentSucceededEvent(
                    invoice_id=invoice_id,
                    organization_id=invoice.organization_id,
                    amount=invoice.amount,
                    entity_id=invoice_id,
                    trigger_name="payment.succeeded"
                ))
                return {"status": "success", "processed": True}

    elif event_type in ["PAYMENT.SALE.DENIED", "PAYMENT.SALE.FAILED"]:
        invoice_id = resource.get("custom") or resource.get("invoice_number")
        
        if invoice_id:
            from app.modules.payments.models import Invoice
            from app.modules.payments.schemas import PaymentCreate
            from app.core.events import publish, PaymentFailedEvent
            from sqlalchemy.future import select
            
            stmt = select(Invoice).where(Invoice.id == invoice_id)
            res = await db.execute(stmt)
            invoice = res.scalars().first()
            
            if invoice:
                pay_svc = PaymentService(db)
                amount = float(resource.get("amount", {}).get("total", 0.0))
                await pay_svc.create_payment(
                    PaymentCreate(
                        invoice_id=invoice_id,
                        amount=amount,
                        method="PayPal",
                        reference=resource.get("id"),
                        status="Failed"
                    ),
                    organization_id=invoice.organization_id
                )
                
                await publish("payment.failed", PaymentFailedEvent(
                    invoice_id=invoice_id,
                    organization_id=invoice.organization_id,
                    amount=invoice.amount,
                    error_message="PayPal payment failed or denied",
                    entity_id=invoice_id,
                    trigger_name="payment.failed"
                ))
                return {"status": "success", "processed": True}
                
    return {"status": "success", "processed": False}

