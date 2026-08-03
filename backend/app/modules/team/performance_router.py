from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy.ext.asyncio import AsyncSession
from typing import List, Optional, Dict, Any
import csv
import io

from app.db.session import get_db
from app.core.security import get_current_user
from app.modules.team.performance_service import PerformanceService

from app.core.permissions import is_admin_user, get_user_team_member_id

router = APIRouter()

def get_performance_service(db: AsyncSession = Depends(get_db)) -> PerformanceService:
    return PerformanceService(db)

@router.get("/leaderboard")
async def get_leaderboard(
    sort_by: str = Query("revenue", pattern="^(revenue|deals|conversion|meetings|tasks|rating)$"),
    svc: PerformanceService = Depends(get_performance_service),
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    """Retrieve team leaderboard sorted by selected metric (Admin Only)."""
    if not is_admin_user(current_user):
        raise HTTPException(
            status_code=403,
            detail="Forbidden: Access to company-wide leaderboard is restricted to Admins."
        )
    return await svc.get_team_leaderboard(current_user["org"], sort_by=sort_by)

@router.get("/{member_id}")
async def get_employee_performance(
    member_id: str,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    svc: PerformanceService = Depends(get_performance_service),
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    """Retrieve comprehensive performance statistics for an employee (Self or Admin Only)."""
    if not is_admin_user(current_user):
        my_member_id = await get_user_team_member_id(db, current_user["sub"], current_user["org"])
        if not my_member_id or member_id != my_member_id:
            raise HTTPException(
                status_code=403,
                detail="Forbidden: You can only view your own performance statistics."
            )

    perf = await svc.get_employee_performance(member_id, current_user["org"], start_date, end_date)
    if not perf:
        raise HTTPException(status_code=404, detail="Employee performance data not found")
    return perf

@router.get("/{member_id}/export")
async def export_employee_report(
    member_id: str,
    format: str = Query("csv", pattern="^(csv|excel|pdf)$"),
    svc: PerformanceService = Depends(get_performance_service),
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    """Export individual employee performance report (Self or Admin Only)."""
    if not is_admin_user(current_user):
        my_member_id = await get_user_team_member_id(db, current_user["sub"], current_user["org"])
        if not my_member_id or member_id != my_member_id:
            raise HTTPException(
                status_code=403,
                detail="Forbidden: You can only export your own performance report."
            )

    perf = await svc.get_employee_performance(member_id, current_user["org"])
    if not perf:
        raise HTTPException(status_code=404, detail="Employee not found")

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["Metric", "Value"])
    writer.writerow(["Employee Name", perf["name"]])
    writer.writerow(["Job Title", perf["job_title"]])
    writer.writerow(["Department", perf["department"]])
    writer.writerow(["Status", perf["status"]])
    writer.writerow(["Assigned Leads", perf["assigned_leads"]])
    writer.writerow(["Active Leads", perf["active_leads"]])
    writer.writerow(["Qualified Leads", perf["qualified_leads"]])
    writer.writerow(["Won Deals", perf["won_deals"]])
    writer.writerow(["Lost Deals", perf["lost_deals"]])
    writer.writerow(["Revenue Generated ($)", perf["revenue_generated"]])
    writer.writerow(["Pipeline Value ($)", perf["pipeline_value"]])
    writer.writerow(["Conversion Rate (%)", perf["conversion_rate"]])
    writer.writerow(["Tasks Completed", perf["tasks_completed"]])
    writer.writerow(["Meetings Completed", perf["meetings_completed"]])
    writer.writerow(["Performance Rating", perf["performance_rating"]])

    response_content = output.getvalue()
    filename = f"performance_report_{member_id[:8]}.csv"

    return Response(
        content=response_content,
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )
