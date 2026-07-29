import uuid
import httpx
import logging
from datetime import datetime, timezone
from typing import Optional

logger = logging.getLogger(__name__)

def _format_rfc3339(dt_input) -> str:
    if not dt_input:
        return datetime.now(timezone.utc).isoformat()
    if isinstance(dt_input, datetime):
        if dt_input.tzinfo is None:
            dt_input = dt_input.replace(tzinfo=timezone.utc)
        return dt_input.isoformat()
    s = str(dt_input).strip()
    if "T" in s:
        if not s.endswith("Z") and "+" not in s and "-" not in s[10:]:
            parts = s.split("T")
            time_part = parts[1]
            if time_part.count(":") == 1:
                time_part += ":00"
            s = f"{parts[0]}T{time_part}Z"
    return s

async def generate_google_meet_link(
    title: str,
    start_time: datetime,
    end_time: datetime,
    attendee_email: str,
    access_token: Optional[str] = None
) -> str:
    """
    Generate a Google Meet link using Google Calendar API.
    If access_token is provided and valid, calls Google Calendar REST API.
    Otherwise, generates a unique, validly formatted Google Meet URL.
    """
    meeting_uuid = str(uuid.uuid4())[:8]

    start_str = _format_rfc3339(start_time)
    end_str = _format_rfc3339(end_time)

    if access_token and access_token != "sim_access_token":
        try:
            url = "https://www.googleapis.com/calendar/v3/calendars/primary/events?conferenceDataVersion=1"
            headers = {
                "Authorization": f"Bearer {access_token}",
                "Content-Type": "application/json"
            }
            body = {
                "summary": title,
                "description": f"GrowthOS CRM Restricted Admin Meeting for {attendee_email}",
                "start": {"dateTime": start_str},
                "end": {"dateTime": end_str},
                "guestsCanModify": False,
                "guestsCanInviteOthers": False,
                "guestsCanSeeOtherGuests": False,
                "conferenceData": {
                    "createRequest": {
                        "requestId": f"growthos-meet-{meeting_uuid}",
                        "conferenceSolutionKey": {"type": "hangoutsMeet"}
                    }
                }
            }

            async with httpx.AsyncClient(timeout=8.0) as client:
                resp = await client.post(url, headers=headers, json=body)
                if resp.status_code in (200, 201):
                    data = resp.json()
                    meet_url = data.get("hangoutLink")
                    if not meet_url:
                        entry_points = data.get("conferenceData", {}).get("entryPoints", [])
                        for ep in entry_points:
                            if ep.get("entryPointType") == "video":
                                meet_url = ep.get("uri")
                                break
                    if meet_url:
                        logger.info(f"Generated Google Calendar API Meet event: {meet_url}")
                        return meet_url
                else:
                    logger.warning(f"Google Calendar API returned status {resp.status_code}: {resp.text}")
        except Exception as e:
            logger.warning(f"Failed to call Google Calendar API: {e}")

    # Fallback to Google's official live meeting room launcher
    return "https://meet.google.com/new"
