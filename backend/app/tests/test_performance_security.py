import unittest
import asyncio
from unittest.mock import MagicMock
from app.core.permissions import is_admin_user
from app.core.security import get_current_user

class TestPerformanceSecurityFix(unittest.IsolatedAsyncioTestCase):
    def test_is_admin_user_roles(self):
        # Superuser
        self.assertTrue(is_admin_user({"is_superuser": True, "role": "Member"}))
        # Admin role
        self.assertTrue(is_admin_user({"is_superuser": False, "role": "Admin"}))
        # Owner role
        self.assertTrue(is_admin_user({"is_superuser": False, "role": "Owner"}))
        # Manager role
        self.assertTrue(is_admin_user({"is_superuser": False, "role": "Manager"}))
        # Regular Member
        self.assertFalse(is_admin_user({"is_superuser": False, "role": "Member"}))
        self.assertFalse(is_admin_user({"is_superuser": False, "role": "Employee"}))

    async def test_get_current_user_jwt_resolution(self):
        # Mock credentials with token containing is_superuser and role
        mock_creds = MagicMock()
        mock_creds.credentials = "valid_token"

        from unittest.mock import patch
        with patch("app.core.security.verify_token") as mock_verify:
            # Case 1: Payload already has is_superuser and role
            mock_verify.return_value = {
                "sub": "user_123",
                "org": "org_123",
                "is_superuser": True,
                "role": "Admin"
            }
            res = await get_current_user(mock_creds)
            self.assertTrue(res["is_superuser"])
            self.assertEqual(res["role"], "Admin")

            # Case 2: Payload only has sub and org (missing is_superuser and role)
            mock_verify.return_value = {
                "sub": "user_456",
                "org": "org_456"
            }
            with patch("app.core.redis_cache.cache_get", return_value={"is_superuser": True, "role": "Admin"}):
                res2 = await get_current_user(mock_creds)
                self.assertTrue(res2["is_superuser"])
                self.assertEqual(res2["role"], "Admin")

if __name__ == "__main__":
    unittest.main()
