"""
Reports module - aggregates data from multiple modules for analytics.
"""
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy import func

from app.db.session import get_db
from app.core.security import get_current_user
from app.modules.crm.models import Lead
from app.modules.pipeline.models import Deal
from app.modules.tasks.models import Task

router = APIRouter()

@router.get("/overview")
async def get_reports_overview(
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    """Returns aggregated stats for the dashboard Reports page, respecting RBAC permissions."""
    from app.core.permissions import get_employee_permissions_context
    from sqlalchemy import or_

    org_id = current_user["org"]
    perm_ctx = await get_employee_permissions_context(db, current_user)
    is_admin = perm_ctx["is_admin"]
    u_id = perm_ctx["user_id"]
    m_id = perm_ctx["member_id"]
    assigned_contacts = perm_ctx["assigned_contacts"]
    assigned_deals = perm_ctx["assigned_deals"]

    import asyncio
    from app.modules.payments.models import Invoice

    # 1. Prepare query statements
    leads_stmt = select(Lead).where(Lead.organization_id == org_id)
    if not is_admin:
        conds = []
        if u_id: conds.append(Lead.owner_id == u_id)
        if m_id: conds.append(Lead.owner_id == m_id)
        if assigned_contacts: conds.append(Lead.id.in_(assigned_contacts))
        if conds: leads_stmt = leads_stmt.where(or_(*conds))

    deals_stmt = select(Deal).where(Deal.organization_id == org_id)
    if not is_admin:
        conds = []
        if u_id: conds.append(Deal.owner_id == u_id)
        if m_id: conds.append(Deal.owner_id == m_id)
        if assigned_deals: conds.append(Deal.id.in_(assigned_deals))
        if conds: deals_stmt = deals_stmt.where(or_(*conds))

    tasks_stmt = select(Task).where(Task.organization_id == org_id)
    if not is_admin:
        conds = []
        if u_id: conds.extend([Task.assigned_to_id == u_id, Task.owner_id == u_id, Task.assigned_by_id == u_id])
        if m_id: conds.append(Task.assigned_to_id == m_id)
        if conds: tasks_stmt = tasks_stmt.where(or_(*conds))

    inv_stmt = select(Invoice).where(Invoice.organization_id == org_id)

    # 2. Execute all 4 queries concurrently in parallel
    leads_res, deals_res, tasks_res, inv_res = await asyncio.gather(
        db.execute(leads_stmt),
        db.execute(deals_stmt),
        db.execute(tasks_stmt),
        db.execute(inv_stmt)
    )

    # 3. Process results
    leads_list = list(leads_res.scalars().all())
    total_leads = len(leads_list)

    lead_status_counts = {}
    lead_source_counts = {}
    for l in leads_list:
        st = l.status or "New"
        lead_status_counts[st] = lead_status_counts.get(st, 0) + 1
        src = l.lead_source or "Direct / Web"
        lead_source_counts[src] = lead_source_counts.get(src, 0) + 1

    leads_by_status = [{"status": k, "count": v} for k, v in lead_status_counts.items()]
    leads_by_source = [{"source": k, "count": v} for k, v in lead_source_counts.items()]
    if not leads_by_source:
        leads_by_source = [{"source": "Direct / Web", "count": total_leads or 1}]

    deals_list = list(deals_res.scalars().all())
    deal_status_counts = {}
    deal_status_values = {}
    total_won_revenue = 0.0
    pipeline_value = 0.0

    for d in deals_list:
        st = d.status or "Open"
        val = float(d.value or 0.0)
        deal_status_counts[st] = deal_status_counts.get(st, 0) + 1
        deal_status_values[st] = deal_status_values.get(st, 0.0) + val
        if st == "Won":
            total_won_revenue += val
        elif st == "Open":
            pipeline_value += val

    deals_by_status = [
        {"status": st, "count": cnt, "value": deal_status_values[st]}
        for st, cnt in deal_status_counts.items()
    ]

    tasks_list = list(tasks_res.scalars().all())
    tasks_completed = sum(1 for t in tasks_list if t.is_completed or t.status == "Completed")
    tasks_pending = len(tasks_list) - tasks_completed

    invoices_list = list(inv_res.scalars().all())
    paid_invoices_revenue = sum(float(i.amount or 0) for i in invoices_list if i.status == "Paid")
    invoices_paid_count = sum(1 for i in invoices_list if i.status == "Paid")
    invoices_pending_count = sum(1 for i in invoices_list if i.status != "Paid")

    total_revenue = total_won_revenue + (paid_invoices_revenue if is_admin else 0.0)

    return {
        "total_leads": total_leads,
        "total_revenue": total_revenue,
        "pipeline_value": pipeline_value,
        "tasks_completed": tasks_completed,
        "tasks_pending": tasks_pending,
        "invoices_paid": invoices_paid_count,
        "invoices_pending": invoices_pending_count,
        "leads_by_status": leads_by_status,
        "deals_by_status": deals_by_status,
        "leads_by_source": leads_by_source,
    }
