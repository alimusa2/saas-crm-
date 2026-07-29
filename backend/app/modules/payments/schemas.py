from pydantic import BaseModel
from typing import Optional
from datetime import datetime

from typing import List

class InvoiceItemCreate(BaseModel):
    description: str
    quantity: float = 1.0
    unit_price: float

class InvoiceItemResponse(BaseModel):
    id: str
    description: str
    quantity: float
    unit_price: float
    amount: float

    class Config:
        from_attributes = True

class InvoiceCreate(BaseModel):
    number: str
    amount: float
    currency: str = "USD"
    description: Optional[str] = None
    notes: Optional[str] = None
    due_date: str
    lead_id: Optional[str] = None
    contact_id: Optional[str] = None
    related_entity_type: str
    related_entity_id: str
    recipient_name: Optional[str] = None
    recipient_email: Optional[str] = None
    recipient_phone: Optional[str] = None
    recipient_company: Optional[str] = None
    billing_address: Optional[str] = None
    tax_information: Optional[str] = None
    items: List[InvoiceItemCreate]

class InvoiceUpdate(BaseModel):
    status: Optional[str] = None
    amount: Optional[float] = None
    description: Optional[str] = None
    notes: Optional[str] = None
    due_date: Optional[str] = None

class InvoiceResponse(BaseModel):
    id: str
    number: str
    amount: float
    currency: str
    status: str
    description: Optional[str] = None
    notes: Optional[str] = None
    due_date: Optional[datetime] = None
    paid_at: Optional[datetime] = None
    lead_id: Optional[str] = None
    contact_id: Optional[str] = None
    related_entity_type: Optional[str] = None
    related_entity_id: Optional[str] = None
    recipient_name: Optional[str] = None
    recipient_email: Optional[str] = None
    recipient_phone: Optional[str] = None
    recipient_company: Optional[str] = None
    billing_address: Optional[str] = None
    tax_information: Optional[str] = None
    organization_id: str
    created_at: datetime
    items: List[InvoiceItemResponse] = []


    class Config:
        from_attributes = True

class PaymentCreate(BaseModel):
    invoice_id: str
    amount: float
    method: str = "Card"
    reference: Optional[str] = None

class PaymentResponse(BaseModel):
    id: str
    invoice_id: str
    amount: float
    method: str
    reference: Optional[str] = None
    status: str
    organization_id: str
    created_at: datetime

    class Config:
        from_attributes = True
