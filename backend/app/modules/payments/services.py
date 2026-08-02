from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from typing import List, Optional, Sequence
from datetime import datetime, timezone
from app.core.config import settings
from app.modules.payments.models import Invoice, Payment
from app.modules.payments.schemas import InvoiceCreate, InvoiceUpdate, PaymentCreate

class PaymentService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def _get_customer_email(self, invoice: Invoice) -> Optional[str]:
        if invoice.recipient_email:
            return invoice.recipient_email
        if invoice.lead_id:
            from app.modules.crm.models import Lead
            res = await self.db.execute(select(Lead.email).where(Lead.id == invoice.lead_id))
            return res.scalar()
        elif invoice.contact_id:
            from app.modules.crm.models import Contact
            res = await self.db.execute(select(Contact.email).where(Contact.id == invoice.contact_id))
            return res.scalar()
        return None

    async def _send_invoice_notifications(self, invoice: Invoice, action_type: str):
        from datetime import datetime, timezone
        import logging
        logger = logging.getLogger(__name__)

        # 1. Capture customer email
        customer_email = await self._get_customer_email(invoice)

        # 2. Asynchronous email queueing
        if customer_email:
            try:
                from app.modules.email.models import EmailTemplate
                from app.modules.email.services import EmailLogService
                from app.modules.email.schemas import EmailSendRequest

                action_clean = action_type.lower()
                if action_clean == "created":
                    template_name = "Invoice Created"
                    subject = f"Invoice Issued: {{{{invoice_number}}}}"
                    heading = "Your new invoice is ready."
                elif action_clean == "paid":
                    template_name = "Invoice Paid"
                    subject = f"Payment Receipt: {{{{invoice_number}}}}"
                    heading = "Thank you! We have received your payment."
                elif action_clean == "failed":
                    template_name = "Invoice Payment Failed"
                    subject = f"Payment Attempt Failed: {{{{invoice_number}}}}"
                    heading = "A payment attempt for your invoice has failed."
                elif action_clean in ["reminder", "overdue", "due_soon"]:
                    template_name = "Invoice Payment Reminder"
                    subject = f"Payment Reminder for Invoice {{{{invoice_number}}}}"
                    heading = "This is a reminder regarding your upcoming or past due invoice payment."
                else:
                    template_name = f"Invoice {action_type.capitalize()}"
                    subject = f"Invoice {action_type.capitalize()}: {{{{invoice_number}}}}"
                    heading = f"Your invoice has been updated to {action_type}."

                html_body = f"""
                <p>Hello {{{{recipient_name}}}},</p>
                <p>{heading}</p>
                <p><strong>Invoice Number:</strong> {{{{invoice_number}}}}<br/>
                <strong>Invoice Date:</strong> {{{{invoice_date}}}}<br/>
                <strong>Due Date:</strong> {{{{due_date}}}}<br/>
                <strong>Total Amount:</strong> {{{{total_amount}}}} {{{{currency}}}}</p>
                <p><strong>Payment Instructions:</strong> Please view and pay your invoice using the button below.</p>
                <p><a href="{{{{download_link}}}}" style="display:inline-block;padding:10px 18px;background:#4F46E5;color:#ffffff;text-decoration:none;border-radius:6px;font-weight:bold;">View & Pay Invoice</a></p>
                """

                tmpl_check = await self.db.execute(
                    select(EmailTemplate).where(
                        EmailTemplate.name == template_name,
                        EmailTemplate.organization_id == invoice.organization_id
                    )
                )
                tmpl = tmpl_check.scalars().first()
                if not tmpl:
                    tmpl = EmailTemplate(
                        name=template_name,
                        subject=subject,
                        html_content=html_body,
                        organization_id=invoice.organization_id
                    )
                    self.db.add(tmpl)
                    await self.db.flush()

                due_str = invoice.due_date.strftime("%Y-%m-%d") if invoice.due_date else ""
                created_str = invoice.created_at.strftime("%Y-%m-%d") if invoice.created_at else datetime.now(timezone.utc).strftime("%Y-%m-%d")

                req = EmailSendRequest(
                    template_id=tmpl.id,
                    recipient_email=customer_email,
                    lead_id=invoice.lead_id,
                    variables={
                        "invoice_id": invoice.id,
                        "recipient_name": invoice.recipient_name or "Valued Customer",
                        "invoice_number": invoice.number,
                        "invoice_date": created_str,
                        "due_date": due_str,
                        "total_amount": invoice.amount,
                        "currency": invoice.currency,
                        "download_link": f"{settings.FRONTEND_URL}/payments/invoice/{invoice.id}",
                        "payment_instructions": "Process through Credit Card / Bank Transfer on the billing page."
                    }
                )
                await EmailLogService.send_email(self.db, req, invoice.organization_id)
            except Exception as e:
                logger.exception(f"Failed to queue invoice email: {e}")

        # 3. Log CRM Activity timeline entry
        try:
            from app.modules.crm.models import Activity
            act_type = f"Invoice {action_type.capitalize()}"
            act = Activity(
                type=act_type,
                description=f"Invoice {invoice.number} ({invoice.amount} {invoice.currency}) status: {action_type}. Recipient: {invoice.recipient_name}",
                lead_id=invoice.lead_id,
                contact_id=invoice.contact_id,
                author_id="system",
                timestamp=datetime.now(timezone.utc),
                organization_id=invoice.organization_id
            )
            self.db.add(act)
        except Exception as e:
            logger.warning(f"Failed to create invoice activity log: {e}")

    async def get_invoices(self, organization_id: str, current_user: Optional[dict] = None) -> Sequence[Invoice]:
        stmt = select(Invoice).where(Invoice.organization_id == organization_id)

        if current_user and not current_user.get("is_superuser") and current_user.get("role") != "Admin":
            from app.core.permissions import get_employee_permissions_context
            from app.modules.crm.models import Lead
            from sqlalchemy import or_

            perm_ctx = await get_employee_permissions_context(self.db, current_user)
            if not perm_ctx["is_admin"]:
                u_id = perm_ctx["user_id"]
                assigned_contacts = perm_ctx["assigned_contacts"] or []

                lead_conditions = []
                if u_id:
                    lead_conditions.append(Lead.owner_id == u_id)
                if assigned_contacts:
                    lead_conditions.append(Lead.id.in_(assigned_contacts))

                user_lead_ids = []
                if lead_conditions:
                    lead_stmt = select(Lead.id).where(
                        Lead.organization_id == organization_id,
                        or_(*lead_conditions)
                    )
                    l_res = await self.db.execute(lead_stmt)
                    user_lead_ids = list(l_res.scalars().all())

                conds = []
                if user_lead_ids:
                    conds.append(Invoice.lead_id.in_(user_lead_ids))
                    conds.append(Invoice.related_entity_id.in_(user_lead_ids))
                if assigned_contacts:
                    conds.append(Invoice.contact_id.in_(assigned_contacts))
                    conds.append(Invoice.related_entity_id.in_(assigned_contacts))

                if conds:
                    stmt = stmt.where(or_(*conds))
                else:
                    return []

        result = await self.db.execute(stmt.order_by(Invoice.created_at.desc()))
        return result.scalars().all()

    async def create_invoice(self, inv_in: InvoiceCreate, organization_id: str) -> Invoice:
        from fastapi import HTTPException
        from app.modules.payments.models import InvoiceItem
        
        # 1. Validation
        if not inv_in.related_entity_type or not inv_in.related_entity_id:
            raise HTTPException(status_code=400, detail="Recipient type and ID are required")
        if not inv_in.items or len(inv_in.items) == 0:
            raise HTTPException(status_code=400, detail="Invoice must contain at least one line item")
        if not inv_in.due_date:
            raise HTTPException(status_code=400, detail="Invoice due date is required")
        if not inv_in.currency:
            raise HTTPException(status_code=400, detail="Invoice currency is required")

        ent_type = inv_in.related_entity_type.lower()
        if ent_type not in ["lead", "contact", "company"]:
            raise HTTPException(status_code=400, detail="Invalid recipient entity type")

        # 2. Recipient lookup & Auto-population
        r_name = inv_in.recipient_name
        r_email = inv_in.recipient_email
        r_phone = inv_in.recipient_phone
        r_company = inv_in.recipient_company
        b_address = inv_in.billing_address
        t_info = inv_in.tax_information

        legacy_lead_id = inv_in.lead_id
        legacy_contact_id = inv_in.contact_id

        if ent_type == "lead":
            from app.modules.crm.models import Lead
            res = await self.db.execute(select(Lead).where(Lead.id == inv_in.related_entity_id, Lead.organization_id == organization_id))
            lead = res.scalars().first()
            if not lead:
                raise HTTPException(status_code=400, detail="Lead recipient not found")
            legacy_lead_id = lead.id
            if not r_name:
                r_name = f"{lead.first_name} {lead.last_name}"
            if not r_email:
                r_email = lead.email
            if not r_phone:
                r_phone = lead.phone
            if not b_address:
                b_address = lead.billing_address
            if not t_info:
                t_info = lead.tax_information

        elif ent_type == "contact":
            from app.modules.crm.models import Contact, Company
            res = await self.db.execute(select(Contact).where(Contact.id == inv_in.related_entity_id, Contact.organization_id == organization_id))
            contact = res.scalars().first()
            if not contact:
                raise HTTPException(status_code=400, detail="Contact recipient not found")
            legacy_contact_id = contact.id
            if not r_name:
                r_name = f"{contact.first_name} {contact.last_name}"
            if not r_email:
                r_email = contact.email
            if not r_phone:
                r_phone = contact.phone
            if not b_address:
                b_address = contact.billing_address
            if not t_info:
                t_info = contact.tax_information
            if contact.company_id and not r_company:
                res_comp = await self.db.execute(select(Company).where(Company.id == contact.company_id))
                comp = res_comp.scalars().first()
                if comp:
                    r_company = comp.name

        elif ent_type == "company":
            from app.modules.crm.models import Company
            res = await self.db.execute(select(Company).where(Company.id == inv_in.related_entity_id, Company.organization_id == organization_id))
            comp = res.scalars().first()
            if not comp:
                raise HTTPException(status_code=400, detail="Company recipient not found")
            if not r_name:
                r_name = comp.name
            if not r_company:
                r_company = comp.name
            if not b_address:
                b_address = comp.address
            if not t_info:
                t_info = comp.tax_information

        # 3. Create invoice & Auto Generate Invoice Number if needed
        data = inv_in.model_dump(exclude={"items"})

        if not data.get("number") or str(data.get("number")).strip() in ["", "AUTO", "AUTO_GEN"]:
            count_res = await self.db.execute(select(Invoice).where(Invoice.organization_id == organization_id))
            total_existing = len(count_res.scalars().all())
            year_str = datetime.now(timezone.utc).strftime("%Y")
            data["number"] = f"INV-{year_str}-{(total_existing + 1):04d}"

        # Parse due_date string to datetime if provided
        if data.get("due_date") and isinstance(data["due_date"], str):
            try:
                data["due_date"] = datetime.fromisoformat(data["due_date"].replace("Z", "+00:00"))
            except ValueError:
                data["due_date"] = None
                
        # Total amount verification or overwrite
        total_items_amount = sum(item.quantity * item.unit_price for item in inv_in.items)
        if total_items_amount > 0:
            data["amount"] = total_items_amount

        data.update({
            "lead_id": legacy_lead_id,
            "contact_id": legacy_contact_id,
            "recipient_name": r_name,
            "recipient_email": r_email,
            "recipient_phone": r_phone,
            "recipient_company": r_company,
            "billing_address": b_address,
            "tax_information": t_info
        })

        invoice = Invoice(**data, organization_id=organization_id)
        self.db.add(invoice)
        await self.db.flush()  # Obtain invoice.id

        # 4. Create items
        for item_in in inv_in.items:
            item = InvoiceItem(
                invoice_id=invoice.id,
                description=item_in.description,
                quantity=item_in.quantity,
                unit_price=item_in.unit_price,
                amount=item_in.quantity * item_in.unit_price,
                organization_id=organization_id
            )
            self.db.add(item)

        await self._send_invoice_notifications(invoice, "created")

        await self.db.commit()
        await self.db.refresh(invoice)

        # 5. Emit events
        customer_email = await self._get_customer_email(invoice)
        from app.core.events import publish, GenericEvent
        evt_data = {
            "invoice_id": invoice.id,
            "amount": invoice.amount,
            "customer_email": customer_email,
            "related_entity_type": invoice.related_entity_type,
            "related_entity_id": invoice.related_entity_id
        }
        await publish("invoice.created", GenericEvent(
            event_name="invoice.created",
            organization_id=organization_id,
            entity_id=invoice.id,
            trigger_name="invoice.created",
            data=evt_data
        ))
        await publish("InvoiceCreated", GenericEvent(
            event_name="InvoiceCreated",
            organization_id=organization_id,
            entity_id=invoice.id,
            trigger_name="InvoiceCreated",
            data=evt_data
        ))
        
        # Trigger automation for Created
        return invoice

    async def update_invoice(self, inv_id: str, inv_in: InvoiceUpdate, organization_id: str) -> Optional[Invoice]:
        result = await self.db.execute(
            select(Invoice).where(Invoice.id == inv_id, Invoice.organization_id == organization_id)
        )
        invoice = result.scalars().first()
        if not invoice:
            return None
            
        old_status = invoice.status
        update_data = inv_in.model_dump(exclude_unset=True)
        
        # Parse due_date string to datetime if provided
        if update_data.get("due_date") and isinstance(update_data["due_date"], str):
            try:
                update_data["due_date"] = datetime.fromisoformat(update_data["due_date"].replace("Z", "+00:00"))
            except ValueError:
                pass

        if update_data.get("status") == "Paid" and not invoice.paid_at:
            invoice.paid_at = datetime.now(timezone.utc)
            
        for key, value in update_data.items():
            setattr(invoice, key, value)
            
        await self.db.commit()
        await self.db.refresh(invoice)
        
        if old_status != invoice.status:
            customer_email = await self._get_customer_email(invoice)
            from app.core.events import publish, GenericEvent
            evt_data = {
                "invoice_id": invoice.id,
                "amount": invoice.amount,
                "customer_email": customer_email,
                "status": invoice.status,
                "related_entity_type": invoice.related_entity_type,
                "related_entity_id": invoice.related_entity_id
            }

            # Send Email and Timeline log based on status
            action_map = {
                "Sent": "sent",
                "Paid": "paid",
                "Cancelled": "cancelled",
                "Overdue": "overdue"
            }
            action_name = action_map.get(invoice.status, invoice.status.lower())
            await self._send_invoice_notifications(invoice, action_name)

            # Publish legacy paid event if status Paid
            if invoice.status == "Paid":
                await publish("invoice.paid", GenericEvent(
                    event_name="invoice.paid",
                    organization_id=organization_id,
                    entity_id=invoice.id,
                    trigger_name="invoice.paid",
                    data=evt_data
                ))

            # Emit specific event names
            specific_event = f"Invoice{invoice.status}"
            await publish(specific_event, GenericEvent(
                event_name=specific_event,
                organization_id=organization_id,
                entity_id=invoice.id,
                trigger_name=specific_event,
                data=evt_data
            ))

            # Emit general updated event
            await publish("InvoiceUpdated", GenericEvent(
                event_name="InvoiceUpdated",
                organization_id=organization_id,
                entity_id=invoice.id,
                trigger_name="InvoiceUpdated",
                data=evt_data
            ))
            
        return invoice

    async def get_payments(self, organization_id: str) -> List[Payment]:
        result = await self.db.execute(
            select(Payment).where(Payment.organization_id == organization_id)
            .order_by(Payment.created_at.desc())
        )
        return result.scalars().all()

    async def create_payment(self, pay_in: PaymentCreate, organization_id: str) -> Payment:
        payment = Payment(**pay_in.model_dump(), organization_id=organization_id)
        self.db.add(payment)
        
        # Mark invoice as paid
        res = await self.db.execute(
            select(Invoice).where(Invoice.id == pay_in.invoice_id, Invoice.organization_id == organization_id)
        )
        invoice = res.scalars().first()
        if invoice:
            await self.update_invoice(invoice.id, InvoiceUpdate(status="Paid"), organization_id)
            
        await self.db.commit()
        await self.db.refresh(payment)
        return payment

    async def send_reminder(self, invoice_id: str, organization_id: str) -> Optional[Invoice]:
        res = await self.db.execute(
            select(Invoice).where(Invoice.id == invoice_id, Invoice.organization_id == organization_id)
        )
        invoice = res.scalars().first()
        # Paid and Cancelled invoices CANNOT receive payment reminders
        if not invoice or invoice.status in ["Paid", "Cancelled"]:
            return None
        await self._send_invoice_notifications(invoice, "reminder")
        return invoice

    async def process_auto_reminders(self, organization_id: str, days_before: int = 1) -> dict:
        from datetime import datetime, timezone, timedelta
        now = datetime.now(timezone.utc)
        target_threshold = now + timedelta(days=days_before)

        res = await self.db.execute(
            select(Invoice).where(
                Invoice.organization_id == organization_id,
                Invoice.status.not_in(["Paid", "Cancelled"])
            )
        )
        invoices = res.scalars().all()
        reminded_count = 0

        for inv in invoices:
            if not inv.due_date:
                continue
            due_dt = inv.due_date if inv.due_date.tzinfo else inv.due_date.replace(tzinfo=timezone.utc)
            if now <= due_dt <= target_threshold:
                today_tag = f"AUTO_REMINDER_SENT:{now.strftime('%Y-%m-%d')}"
                if not inv.notes or today_tag not in inv.notes:
                    await self._send_invoice_notifications(inv, "reminder")
                    inv.notes = (inv.notes or "") + f" [{today_tag}]"
                    reminded_count += 1

        await self.db.commit()
        return {"status": "success", "reminded_count": reminded_count, "days_before": days_before}

    async def delete_invoice(self, invoice_id: str, organization_id: str) -> bool:
        res = await self.db.execute(
            select(Invoice).where(Invoice.id == invoice_id, Invoice.organization_id == organization_id)
        )
        invoice = res.scalars().first()
        if not invoice:
            return False
        await self.db.delete(invoice)
        await self.db.commit()
        return True

