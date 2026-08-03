import random
import uuid
import jwt
from datetime import datetime, timedelta, timezone
from locust import HttpUser, task, between

# Real database IDs for demo@growthos.com
DEMO_USER_ID = "3a6fd1f2-2c41-4ec2-b893-06cd19e7fbd2"
DEMO_ORG_ID = "36e173ae-de9d-4005-a011-b82810f8d280"
SECRET = "growthOS-dev-secret-key-change-in-production"

def make_token(user_id=DEMO_USER_ID, org_id=DEMO_ORG_ID, role="Admin"):
    payload = {
        "sub": user_id,
        "org": org_id,
        "organization_id": org_id,
        "role": role,
        "is_superuser": True,
        "exp": datetime.now(timezone.utc) + timedelta(days=1)
    }
    return jwt.encode(payload, SECRET, algorithm="HS256")

ADMIN_HEADER = {"Authorization": f"Bearer {make_token(DEMO_USER_ID, DEMO_ORG_ID, 'Admin')}"}
EMP_HEADER = {"Authorization": f"Bearer {make_token(DEMO_USER_ID, DEMO_ORG_ID, 'Employee')}"}


class AdminUser(HttpUser):
    weight = 1  # 20% Admins
    wait_time = between(1, 2)
    headers = ADMIN_HEADER

    @task(5)
    def view_dashboard(self):
        self.client.get("/api/v1/crm/leads?skip=0&limit=500", headers=self.headers, name="GET /api/v1/crm/leads [Admin Dashboard]")

    @task(4)
    def view_pipeline(self):
        self.client.get("/api/v1/pipeline/deals", headers=self.headers, name="GET /api/v1/pipeline/deals [Admin Pipeline]")

    @task(3)
    def check_health(self):
        self.client.get("/health", name="GET /health [Health Check]")

    @task(2)
    def view_profile(self):
        self.client.get("/api/v1/auth/me", headers=self.headers, name="GET /api/v1/auth/me [Admin Profile]")

    @task(1)
    def create_deal(self):
        payload = {"title": f"GrowthOS Deal {uuid.uuid4().hex[:4]}", "value": random.randint(5000, 50000), "status": "Proposal", "stage_id": "stage_1"}
        self.client.post("/api/v1/pipeline/deals", headers=self.headers, json=payload, name="POST /api/v1/pipeline/deals [Create Deal]")


class EmployeeUser(HttpUser):
    weight = 4  # 80% Employees (80 Users scenario across 4 Orgs)
    wait_time = between(1, 2)
    headers = EMP_HEADER

    @task(5)
    def view_leads(self):
        self.client.get("/api/v1/crm/leads?skip=0&limit=100", headers=self.headers, name="GET /api/v1/crm/leads [Emp Leads]")

    @task(4)
    def view_tasks(self):
        self.client.get("/api/v1/tasks/", headers=self.headers, name="GET /api/v1/tasks/ [Emp Tasks]")

    @task(3)
    def view_pipeline(self):
        self.client.get("/api/v1/pipeline/deals", headers=self.headers, name="GET /api/v1/pipeline/deals [Emp Funnel]")

    @task(2)
    def view_profile(self):
        self.client.get("/api/v1/auth/me", headers=self.headers, name="GET /api/v1/auth/me [Emp Profile]")

    @task(1)
    def create_lead(self):
        payload = {"first_name": f"Lead_{uuid.uuid4().hex[:4]}", "last_name": "Smith", "email": f"lead_{uuid.uuid4().hex[:4]}@domain.com", "status": "New", "priority": "Medium"}
        self.client.post("/api/v1/crm/leads", headers=self.headers, json=payload, name="POST /api/v1/crm/leads [Create Lead]")
