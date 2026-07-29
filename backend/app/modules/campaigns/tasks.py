"""
Campaign Celery Tasks – Production Engine
==========================================
Architecture
------------
send_campaign_recipient_task  ← one Celery task per CampaignRecipient row

  Per-recipient lifecycle:
    1.  Idempotency check – skip if already terminal (Sent/Failed/Skipped/Invalid/Cancelled)
    2.  Validate email address – mark Invalid and exit without sending
    3.  Mark status = Processing immediately (visible to progress polling)
    4.  Load Campaign + Template; mark Skipped if missing
    5.  Render Jinja2 subject + body with CRM variables
    6.  Call Gmail / email provider directly (NO nested send_email_task.delay)
    7.  Persist result (Sent/Failed), attempt_count, last_attempt_at, gmail_message_id
    8.  Retry transient failures with exponential backoff (max 3 retries)
    9.  Create CRM Activity on success
   10.  Call _check_campaign_completion in a fresh session

resume_campaign_task          ← dispatches send_campaign_recipient_task for every Queued recipient
schedule_campaigns_task       ← periodic beat task for Scheduled campaigns
"""
import logging
import re
import time
from datetime import datetime, timezone

from app.core.celery_app import celery_app
from app.db.session import AsyncSessionLocal

logger = logging.getLogger("campaign.tasks")


# ─── Helpers ─────────────────────────────────────────────────────────────────

def _is_valid_email(email) -> bool:
    """Return True only for non-empty, properly formatted email addresses."""
    if not email:
        return False
    email = str(email).strip()
    if not email:
        return False
    # Basic RFC-compliant check: must have exactly one @, non-empty local + domain parts
    pattern = r"^[^@\s]+@[^@\s]+\.[^@\s]+$"
    return bool(re.match(pattern, email))


def _classify_error(exc: Exception) -> str:
    """
    Classify an exception as:
      'invalid'   – bad recipient, will never succeed (do not retry)
      'permanent' – auth/permission failure (do not retry)
      'transient' – network/rate-limit/server error (retry with backoff)
    """
    msg = str(exc).lower()

    # Permanent – Gmail auth / permission failures
    if any(k in msg for k in ("401", "unauthorized", "403", "forbidden",
                               "invalid_grant", "token has been expired",
                               "token_refresh_failed", "no valid gmail")):
        return "permanent"

    # Permanent – bad recipient
    if any(k in msg for k in ("550", "invalid recipient", "user not found",
                               "no such user", "does not exist", "mailbox unavailable")):
        return "invalid"

    # Transient – rate limit / server errors
    if any(k in msg for k in ("429", "500", "502", "503", "504", "timeout",
                               "connection", "temporarily", "try again", "quota")):
        return "transient"

    # Default: treat unknown as transient (safe default)
    return "transient"


def run_async_coro(coro):
    """
    Safely run an async coroutine from a synchronous Celery task context.

    CELERY_ALWAYS_EAGER=True runs tasks inline inside FastAPI's event loop.
    Using loop.create_task() in that scenario returns a Task object, never
    awaiting it. We detect both cases and handle them correctly:

      - No running loop → create a new loop and run_until_complete (normal worker)
      - Running loop → use asyncio.run_coroutine_threadsafe or nest via nest_asyncio
    """
    import asyncio

    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        loop = None

    if loop is None or not loop.is_running():
        # Standard Celery worker path – no running event loop
        try:
            loop = asyncio.get_event_loop()
            if loop.is_closed():
                raise RuntimeError("closed")
        except RuntimeError:
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
        return loop.run_until_complete(coro)
    else:
        # CELERY_ALWAYS_EAGER=True path – called from within FastAPI's running loop.
        # We cannot run_until_complete from inside a running loop, so we spin up a
        # dedicated thread with its own event loop.
        import concurrent.futures
        result_holder = {}

        def _run_in_thread():
            new_loop = asyncio.new_event_loop()
            asyncio.set_event_loop(new_loop)
            try:
                result_holder["result"] = new_loop.run_until_complete(coro)
            except Exception as e:
                result_holder["error"] = e
            finally:
                new_loop.close()

        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
            future = pool.submit(_run_in_thread)
            future.result()  # Block until done

        if "error" in result_holder:
            raise result_holder["error"]
        return result_holder.get("result")


# ─── Per-Recipient Sender ─────────────────────────────────────────────────────

@celery_app.task(bind=True, max_retries=3, name="campaigns.send_recipient")
def send_campaign_recipient_task(self, recipient_id: str):
    """
    Send one personalized campaign email for a single CampaignRecipient row.

    Each call is fully self-contained:
      - Validates the email address before attempting send
      - Never dispatches a nested Celery task (avoids event-loop collision)
      - Calls Gmail service directly (same path as send_email_task but inline)
      - Wraps everything in exception handling; one failure never stops the campaign
      - Retries only transient failures with exponential backoff
      - Updates DB status on every attempt (never waits for campaign finish)
    """
    return run_async_coro(_async_send_recipient(self, recipient_id))


async def _async_send_recipient(task_self, recipient_id: str):
    from sqlalchemy.future import select
    from jinja2 import Template

    from app.modules.campaigns.models import Campaign, CampaignRecipient
    from app.modules.email.models import EmailTemplate, EmailLog
    from app.modules.crm.models import Lead, Contact, Activity

    start_time = time.monotonic()
    campaign_id = None

    async with AsyncSessionLocal() as db:
        try:
            # ── 1. Load recipient ────────────────────────────────────────────
            res = await db.execute(
                select(CampaignRecipient).where(CampaignRecipient.id == recipient_id)
            )
            recipient = res.scalars().first()

            if not recipient:
                logger.error(f"[Campaign] CampaignRecipient {recipient_id} not found – skipping")
                return

            campaign_id = recipient.campaign_id

            # ── 2. Idempotency guard ─────────────────────────────────────────
            terminal_statuses = {"Sent", "Failed", "Cancelled", "Skipped", "Invalid"}
            if recipient.status in terminal_statuses:
                logger.info(
                    f"[Campaign:{campaign_id}] Recipient {recipient_id} already in terminal "
                    f"status '{recipient.status}' – skipping"
                )
                return

            # ── 3. Validate email address ────────────────────────────────────
            if not _is_valid_email(recipient.recipient_email):
                logger.warning(
                    f"[Campaign:{campaign_id}] Invalid email '{recipient.recipient_email}' "
                    f"for recipient {recipient_id} – marking Invalid"
                )
                recipient.status = "Invalid"
                recipient.error_message = f"Invalid email address: '{recipient.recipient_email}'"
                recipient.last_attempt_at = datetime.now(timezone.utc)
                recipient.attempt_count = (recipient.attempt_count or 0) + 1
                await db.commit()
                await _check_campaign_completion(campaign_id)
                return

            # ── 4. Load campaign ─────────────────────────────────────────────
            res = await db.execute(
                select(Campaign).where(Campaign.id == recipient.campaign_id)
            )
            campaign = res.scalars().first()

            if not campaign:
                logger.error(f"[Campaign] Campaign {recipient.campaign_id} not found for recipient {recipient_id}")
                recipient.status = "Failed"
                recipient.error_message = "Campaign record not found"
                await db.commit()
                return

            if campaign.status == "Cancelled":
                recipient.status = "Cancelled"
                await db.commit()
                return

            org_id = campaign.organization_id

            # ── 5. Mark Processing ───────────────────────────────────────────
            recipient.status = "Processing"
            recipient.last_attempt_at = datetime.now(timezone.utc)
            recipient.attempt_count = (recipient.attempt_count or 0) + 1
            await db.commit()

            logger.info(
                f"[Campaign:{campaign_id}] Processing recipient {recipient_id} "
                f"<{recipient.recipient_email}> attempt={recipient.attempt_count} "
                f"worker={task_self.request.id}"
            )

            # ── 6. Load template ─────────────────────────────────────────────
            template_obj = None
            if campaign.template_id:
                res = await db.execute(
                    select(EmailTemplate).where(
                        EmailTemplate.id == campaign.template_id,
                        EmailTemplate.organization_id == org_id,
                    )
                )
                template_obj = res.scalars().first()

            if not template_obj:
                recipient.status = "Skipped"
                recipient.skipped_reason = "Email template not found or deleted"
                await db.commit()
                logger.warning(f"[Campaign:{campaign_id}] Template not found for recipient {recipient_id} – Skipped")
                await _check_campaign_completion(campaign_id)
                return

            # ── 7. Build CRM personalization variables ───────────────────────
            variables = {
                "first_name": "",
                "last_name": "",
                "email": recipient.recipient_email,
                "phone": "",
                "company": "",
                "assigned_owner": "",
                "pipeline_stage": "",
            }

            lead = None
            if recipient.lead_id:
                res = await db.execute(select(Lead).where(Lead.id == recipient.lead_id))
                lead = res.scalars().first()
                if lead:
                    variables["first_name"] = lead.first_name or ""
                    variables["last_name"] = lead.last_name or ""
                    variables["email"] = lead.email or recipient.recipient_email
                    variables["phone"] = lead.phone or ""

            contact = None
            if not lead and recipient.contact_id:
                res = await db.execute(select(Contact).where(Contact.id == recipient.contact_id))
                contact = res.scalars().first()
                if contact:
                    variables["first_name"] = contact.first_name or ""
                    variables["last_name"] = contact.last_name or ""
                    variables["email"] = contact.email or recipient.recipient_email

            # ── 8. Render subject + body ─────────────────────────────────────
            try:
                rendered_subject = Template(campaign.subject).render(**variables)
                rendered_body = Template(template_obj.html_content).render(**variables)
            except Exception as render_err:
                recipient.status = "Failed"
                recipient.error_message = f"Template render error: {render_err}"
                await db.commit()
                logger.error(
                    f"[Campaign:{campaign_id}] Template render failed for recipient {recipient_id}: {render_err}"
                )
                await _check_campaign_completion(campaign_id)
                return

            # ── 9. Create EmailLog row (for unified send history / inbox) ────
            log_obj = EmailLog(
                organization_id=org_id,
                recipient=recipient.recipient_email,
                reply_to=campaign.reply_to,
                subject=rendered_subject,
                body=rendered_body,
                status="Queued",
                lead_id=recipient.lead_id,
                campaign_id=campaign.id,
            )
            db.add(log_obj)
            await db.flush()  # Populate log_obj.id
            recipient.email_log_id = log_obj.id
            await db.commit()

            # ── 10. Send via email provider (inline – no nested Celery task) ──
            #
            # This is the core fix: we call the provider directly instead of
            # send_email_task.delay(), eliminating the nested task / unawaited
            # coroutine bug entirely.
            send_result = await _do_send(db, org_id, recipient.recipient_email,
                                         rendered_subject, rendered_body)

            duration_ms = round((time.monotonic() - start_time) * 1000)

            # ── 11. Persist result ───────────────────────────────────────────
            if send_result.get("success"):
                gmail_msg_id = send_result.get("gmail_message_id") or send_result.get("message_id")

                recipient.status = "Sent"
                recipient.sent_at = datetime.now(timezone.utc)
                recipient.gmail_message_id = gmail_msg_id
                recipient.error_message = None

                log_obj.status = "Sent"
                log_obj.message_id = gmail_msg_id

                await db.commit()

                logger.info(
                    f"[Campaign:{campaign_id}] ✓ Sent to <{recipient.recipient_email}> "
                    f"gmail_msg={gmail_msg_id} duration={duration_ms}ms "
                    f"attempt={recipient.attempt_count}"
                )

                # ── 12. CRM Activity ─────────────────────────────────────────
                if lead:
                    try:
                        act = Activity(
                            type="Email",
                            description=(
                                f"Campaign Email Sent: {campaign.name} "
                                f"(Subject: {rendered_subject})"
                            ),
                            lead_id=lead.id,
                            author_id=campaign.created_by_id or "system",
                            timestamp=datetime.now(timezone.utc),
                            organization_id=org_id,
                        )
                        db.add(act)
                        await db.commit()
                    except Exception as act_err:
                        logger.warning(
                            f"[Campaign:{campaign_id}] Failed to create Activity "
                            f"for lead {lead.id}: {act_err}"
                        )

                # ── 13. Automation event ──────────────────────────────────────
                try:
                    from app.core.events import publish, GenericEvent
                    await publish(
                        "campaign.email_sent",
                        GenericEvent(
                            event_name="campaign.email_sent",
                            organization_id=org_id,
                            entity_id=campaign.id,
                            trigger_name="campaign.email_sent",
                            lead_id=recipient.lead_id,
                            data={
                                "campaign_id": campaign.id,
                                "campaign_name": campaign.name,
                                "recipient_email": recipient.recipient_email,
                                "lead_id": recipient.lead_id,
                            },
                        ),
                    )
                except Exception:
                    pass  # Automation failures must never block the campaign

            else:
                # Send failed
                error_msg = send_result.get("error", "Unknown send failure")
                error_class = _classify_error(Exception(error_msg))

                log_obj.status = "Failed"
                log_obj.error_message = error_msg
                await db.commit()

                logger.warning(
                    f"[Campaign:{campaign_id}] ✗ Failed to send to <{recipient.recipient_email}> "
                    f"error_class={error_class} error='{error_msg}' "
                    f"attempt={recipient.attempt_count} duration={duration_ms}ms"
                )

                if error_class == "transient" and task_self.request.retries < task_self.max_retries:
                    # Retry with exponential backoff
                    countdown = 30 * (4 ** task_self.request.retries)
                    # Reset to Queued so it shows as waiting, not stuck Processing
                    recipient.status = "Queued"
                    recipient.error_message = f"Retry {task_self.request.retries + 1}: {error_msg}"
                    await db.commit()
                    logger.info(
                        f"[Campaign:{campaign_id}] Scheduling retry #{task_self.request.retries + 1} "
                        f"for recipient {recipient_id} in {countdown}s"
                    )
                    raise task_self.retry(exc=Exception(error_msg), countdown=countdown)
                else:
                    # Permanent failure or max retries exceeded
                    if error_class == "invalid":
                        recipient.status = "Invalid"
                    else:
                        recipient.status = "Failed"
                    recipient.error_message = error_msg
                    await db.commit()

        except Exception as outer_err:
            # Catch-all: log and fail this recipient, but do NOT propagate.
            # The campaign must continue for remaining recipients.
            if "MaxRetriesExceededError" in type(outer_err).__name__ or hasattr(outer_err, 'sentry_tag'):
                # Let Celery retry machinery propagate retry signals
                raise

            logger.error(
                f"[Campaign:{campaign_id or '?'}] Unhandled exception for recipient "
                f"{recipient_id}: {type(outer_err).__name__}: {outer_err}",
                exc_info=True,
            )
            try:
                # Best-effort: mark this recipient as Failed
                async with AsyncSessionLocal() as rescue_db:
                    res = await rescue_db.execute(
                        select(CampaignRecipient).where(CampaignRecipient.id == recipient_id)
                    )
                    r = res.scalars().first()
                    if r and r.status not in {"Sent", "Failed", "Skipped", "Invalid", "Cancelled"}:
                        r.status = "Failed"
                        r.error_message = f"Unhandled error: {type(outer_err).__name__}: {outer_err}"
                        await rescue_db.commit()
            except Exception:
                pass  # Rescue path must never raise

    # ── 14. Update campaign progress/completion (outside the main session) ─────
    if campaign_id:
        try:
            await _check_campaign_completion(campaign_id)
        except Exception as comp_err:
            logger.warning(f"[Campaign:{campaign_id}] _check_campaign_completion error: {comp_err}")


async def _do_send(db, org_id: str, to_email: str, subject: str, body: str) -> dict:
    """
    Send via the configured email provider for this org.
    Mirrors the provider-selection logic from email/tasks.py send_email_task.
    Returns {"success": True/False, "gmail_message_id"/"message_id": ..., "error": ...}
    """
    import json
    from sqlalchemy.future import select
    from app.modules.email.models import EmailConfig
    from app.modules.email.providers import EmailProviderRegistry
    from app.core.security import decrypt_data

    # Check for explicit email config first
    res = await db.execute(
        select(EmailConfig).where(
            EmailConfig.organization_id == org_id,
            EmailConfig.is_active == True,
        )
    )
    config_obj = res.scalars().first()

    provider_name = "smtp"
    settings_dict = {}

    if not config_obj:
        # Fall back to Gmail OAuth
        from app.modules.gmail.models import GmailIntegration
        r = await db.execute(
            select(GmailIntegration).where(
                GmailIntegration.organization_id == org_id,
                GmailIntegration.is_connected == True,
            )
        )
        gmail_int = r.scalars().first()
        if gmail_int:
            provider_name = "gmail"
        else:
            return {"success": False, "error": "No email provider configured and Gmail is not connected"}
    else:
        provider_name = config_obj.provider
        if config_obj.settings_enc:
            try:
                decrypted = decrypt_data(config_obj.settings_enc)
                settings_dict = json.loads(decrypted)
            except Exception as e:
                return {"success": False, "error": f"Config decryption failed: {e}"}

    try:
        provider = EmailProviderRegistry.get_provider(
            provider_name=provider_name,
            settings_dict=settings_dict,
            organization_id=org_id,
            db_session=db,
        )

        # Determine HTML vs plain text
        is_html = any(tag in body.lower() for tag in ("<html", "<div", "<p", "<br", "<table"))
        html_body = body if is_html else None
        if is_html:
            import re
            text_body = re.sub(r"<[^>]+>", "", body)
        else:
            text_body = body

        result = await provider.send(
            to_email=to_email,
            subject=subject,
            body=text_body,
            html_body=html_body,
        )
        return result
    except Exception as e:
        return {"success": False, "error": str(e)}


async def _check_campaign_completion(campaign_id: str):
    """
    Recalculate campaign counters and status based on current recipient states.
    Opens its own DB session so it's independent of the per-recipient transaction.

    Campaign status rules:
      - Any Queued or Processing recipients → Sending (still in progress)
      - All terminal, at least one Sent, zero Failed → Completed
      - All terminal, at least one Sent, some Failed → Completed with Errors
      - All terminal, zero Sent → Failed
    """
    from sqlalchemy.future import select
    from sqlalchemy import func
    from app.modules.campaigns.models import Campaign, CampaignRecipient

    async with AsyncSessionLocal() as db:
        # Aggregate recipient counts
        res = await db.execute(
            select(
                CampaignRecipient.status,
                func.count(CampaignRecipient.id).label("cnt"),
            )
            .where(CampaignRecipient.campaign_id == campaign_id)
            .group_by(CampaignRecipient.status)
        )
        rows = res.all()
        counts = {r[0]: r[1] for r in rows}

        total = sum(counts.values())
        sent = counts.get("Sent", 0)
        failed = counts.get("Failed", 0)
        skipped = counts.get("Skipped", 0)
        invalid = counts.get("Invalid", 0)
        cancelled = counts.get("Cancelled", 0)
        in_progress = counts.get("Queued", 0) + counts.get("Processing", 0)

        terminal = sent + failed + skipped + invalid + cancelled

        logger.debug(
            f"[Campaign:{campaign_id}] Progress — total={total} sent={sent} "
            f"failed={failed} skipped={skipped} invalid={invalid} "
            f"cancelled={cancelled} in_progress={in_progress}"
        )

        # Fetch and update campaign
        res = await db.execute(select(Campaign).where(Campaign.id == campaign_id))
        campaign = res.scalars().first()
        if not campaign:
            return

        campaign.recipient_count = total
        campaign.sent_count = sent
        campaign.failed_count = failed + invalid  # Both count as failed for display

        if in_progress > 0:
            campaign.status = "Sending"
        elif total == 0:
            pass  # No recipients yet, leave status alone
        elif sent == 0 and terminal > 0:
            campaign.status = "Failed"
            campaign.completed_at = datetime.now(timezone.utc)
        elif failed > 0 or invalid > 0 or skipped > 0:
            campaign.status = "Completed with Errors"
            campaign.completed_at = datetime.now(timezone.utc)
        else:
            campaign.status = "Completed"
            campaign.completed_at = datetime.now(timezone.utc)

        await db.commit()

        if campaign.status in ("Completed", "Completed with Errors", "Failed"):
            logger.info(
                f"[Campaign:{campaign_id}] ✓ Campaign finished → status='{campaign.status}' "
                f"sent={sent} failed={failed} invalid={invalid} skipped={skipped}"
            )


# ─── Resume Task ──────────────────────────────────────────────────────────────

@celery_app.task(name="campaigns.resume")
def resume_campaign_task(campaign_id: str):
    """
    Re-dispatch send tasks for all Queued recipients in a Sending campaign.
    Used after a server crash or manual resume via POST /campaigns/{id}/resume.
    Already-terminal recipients (Sent/Failed/Skipped/Invalid/Cancelled) are
    untouched — preventing duplicate sends.
    """
    return run_async_coro(_async_resume_campaign(campaign_id))


async def _async_resume_campaign(campaign_id: str):
    from sqlalchemy.future import select
    from app.modules.campaigns.models import Campaign, CampaignRecipient

    async with AsyncSessionLocal() as db:
        res = await db.execute(select(Campaign).where(Campaign.id == campaign_id))
        campaign = res.scalars().first()
        if not campaign:
            logger.error(f"[Campaign Resume] Campaign {campaign_id} not found")
            return 0

        if campaign.status not in ("Sending", "Draft", "Scheduled"):
            logger.warning(
                f"[Campaign Resume] Campaign {campaign_id} is in status '{campaign.status}' "
                f"– only Sending campaigns can be resumed"
            )
            return 0

        res = await db.execute(
            select(CampaignRecipient).where(
                CampaignRecipient.campaign_id == campaign_id,
                CampaignRecipient.status.in_(["Queued", "Processing"]),
            )
        )
        queued_recipients = res.scalars().all()

        if not queued_recipients:
            logger.info(f"[Campaign Resume] No Queued/Processing recipients found for campaign {campaign_id}")
            await _check_campaign_completion(campaign_id)
            return 0

        # Reset any stuck Processing recipients back to Queued before re-dispatching
        for r in queued_recipients:
            if r.status == "Processing":
                r.status = "Queued"
        await db.commit()

        count = 0
        for r in queued_recipients:
            send_campaign_recipient_task.delay(r.id)
            count += 1

        logger.info(f"[Campaign Resume] Re-dispatched {count} tasks for campaign {campaign_id}")
        return count


# ─── Periodic Scheduler (Celery Beat) ────────────────────────────────────────

@celery_app.task(name="campaigns.schedule")
def schedule_campaigns_task():
    """
    Periodic Celery beat task. Finds campaigns that are Scheduled and past
    their scheduled_for time, then queues them.
    Requires celery beat to be running (opt-in for dev environments).
    """
    return run_async_coro(_async_schedule_campaigns())


async def _async_schedule_campaigns():
    from sqlalchemy.future import select
    from app.modules.campaigns.models import Campaign
    from app.modules.campaigns.services import CampaignService

    now = datetime.now(timezone.utc)
    async with AsyncSessionLocal() as db:
        res = await db.execute(
            select(Campaign).where(Campaign.status == "Scheduled")
        )
        campaigns = res.scalars().all()
        for campaign in campaigns:
            if not campaign.scheduled_for:
                continue

            sched = campaign.scheduled_for
            if sched.tzinfo is None:
                # Localize naive datetime to UTC to ensure safe comparison
                sched = sched.replace(tzinfo=timezone.utc)
            else:
                sched = sched.astimezone(timezone.utc)

            if sched <= now:
                logger.info(
                    f"[Campaign Scheduler] Queuing scheduled campaign {campaign.id}: {campaign.name} "
                    f"(scheduled_for={sched}, now={now})"
                )
                try:
                    await CampaignService.queue_campaign(
                        db, campaign.id, campaign.organization_id, "scheduler"
                    )
                except Exception as e:
                    logger.error(
                        f"[Campaign Scheduler] Failed to queue campaign {campaign.id}: {e}"
                    )
