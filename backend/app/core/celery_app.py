from celery import Celery
from app.core.config import settings

celery_app = Celery(
    "growthos_tasks",
    broker=settings.REDIS_URL,
    backend=settings.REDIS_URL
)

celery_app.conf.update(
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    timezone="UTC",
    enable_utc=True,
    task_track_started=True,
    task_acks_late=True,
    worker_prefetch_multiplier=1,
    task_always_eager=settings.CELERY_ALWAYS_EAGER,
    task_eager_propagates=settings.CELERY_ALWAYS_EAGER,
)

# Autodiscover tasks from loaded modules
celery_app.autodiscover_tasks([
    "app.modules.email",
    "app.modules.inbox",
    "app.modules.workflow",
    "app.modules.payments",
    "app.modules.campaigns",   # campaign send, resume, scheduler tasks
], force=True)
