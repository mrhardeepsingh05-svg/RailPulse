"""Comprehensive backend integration, 4-role RBAC, security, map, calendar, search, and report tests."""

from __future__ import annotations

import os
import tempfile
import unittest
from pathlib import Path

_TMP_DIR = Path(tempfile.mkdtemp(prefix="railpulse_v2_test_"))
os.environ["RAILPULSE_ENV"] = "test"
os.environ["RAILPULSE_DB_PATH"] = str(_TMP_DIR / "test_railpulse_v2.db")
os.environ["RAILPULSE_UPLOAD_DIR"] = str(_TMP_DIR / "uploads")
os.environ["RAILPULSE_JWT_SECRET"] = "test-secret-key-at-least-thirty-two-bytes-long-1234"
os.environ["RAILPULSE_ENABLE_DEMO_DATA"] = "true"
os.environ["GEMINI_API_KEY"] = ""

from fastapi.testclient import TestClient  # noqa: E402
from api.index import app  # noqa: E402
from api.database import init_db  # noqa: E402
from api.seed import seed_initial_data  # noqa: E402
from api.security import rate_limiter  # noqa: E402


VALID_PNG_BYTES = (
    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
    b"\x08\x02\x00\x00\x00\x90wS\xde\x00\x00\x00\x0cIDATx\x9cc\xf8\xcf\xc0"
    b"\x00\x00\x03\x01\x01\x00\xc9\xfe\x92\xef\x00\x00\x00\x00IEND\xaeB`\x82"
)


class RailPulseV2BackendTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        init_db()
        seed_initial_data()
        cls.client = TestClient(app)

    def setUp(self) -> None:
        rate_limiter.reset()

    def _login(self, username: str, password: str) -> str:
        res = self.client.post("/api/auth/login", json={"username": username, "password": password})
        self.assertEqual(res.status_code, 200, res.text)
        return res.json()["access_token"]

    def _hdr(self, token: str) -> dict[str, str]:
        return {"Authorization": f"Bearer {token}"}

    def test_01_health_and_four_demo_roles(self) -> None:
        h = self.client.get("/api/health")
        self.assertEqual(h.status_code, 200)
        self.assertEqual(h.json()["ai_mode"], "DEMO_MODE")

        demo = self.client.get("/api/auth/demo-accounts").json()
        roles = {a["role"] for a in demo["accounts"]}
        self.assertEqual(roles, {"admin", "inspector", "engineer", "staff"})

    def test_02_four_role_rbac_permissions(self) -> None:
        adm = self._login("admin.demo", "Admin@2026!")
        insp = self._login("inspector.demo", "Inspector@2026!")
        eng = self._login("engineer.demo", "Engineer@2026!")
        staff = self._login("staff.demo", "Staff@2026!")

        # Only Admin can manage users & categories
        self.assertEqual(self.client.get("/api/admin/users", headers=self._hdr(adm)).status_code, 200)
        self.assertEqual(self.client.get("/api/admin/users", headers=self._hdr(eng)).status_code, 403)
        self.assertEqual(self.client.get("/api/admin/users", headers=self._hdr(insp)).status_code, 403)
        self.assertEqual(self.client.get("/api/admin/users", headers=self._hdr(staff)).status_code, 403)

        # Staff cannot submit inspections, create maintenance tasks, or download reports
        self.assertEqual(
            self.client.post(
                "/api/work-orders",
                headers=self._hdr(staff),
                json={"asset_id": 1, "title": "Test", "description": "Test desc", "priority": "Low", "due_date": "2026-12-20"},
            ).status_code,
            403,
        )
        self.assertEqual(self.client.get("/api/reports", headers=self._hdr(staff)).status_code, 403)

        # Inspector cannot create maintenance tasks (Engineer & Admin only)
        self.assertEqual(
            self.client.post(
                "/api/work-orders",
                headers=self._hdr(insp),
                json={"asset_id": 1, "title": "Test", "description": "Test desc", "priority": "Low", "due_date": "2026-12-20"},
            ).status_code,
            403,
        )

    def test_03_assets_verified_coordinates_and_image_upload(self) -> None:
        eng = self._login("engineer.demo", "Engineer@2026!")
        create = self.client.post(
            "/api/assets",
            headers=self._hdr(eng),
            json={
                "name": "East Yard Signal S-12",
                "category_id": 4,
                "section_location": "East Yard — Km 4.0",
                "description": "Signal head with verified coordinates",
                "installation_date": "2024-05-10",
                "registration_date": "2026-11-26",
                "current_condition": "Needs Attention",
                "maintenance_status": "Active",
                "latitude": 28.6139,
                "longitude": 77.2090,
                "coordinates_verified": True,
            },
        )
        self.assertEqual(create.status_code, 201, create.text)
        asset = create.json()
        self.assertEqual(asset["coordinates_verified"], 1)
        self.assertAlmostEqual(asset["latitude"], 28.6139)

        # Attach photo to asset
        img_up = self.client.post(
            f"/api/assets/{asset['id']}/images",
            headers=self._hdr(eng),
            files={"files": ("signal.png", VALID_PNG_BYTES, "image/png")},
        )
        self.assertEqual(img_up.status_code, 201)

        detail = self.client.get(f"/api/assets/{asset['id']}", headers=self._hdr(eng)).json()
        self.assertEqual(len(detail["images"]), 1)

    def test_04_dashboard_filters_analytics_calendar_search(self) -> None:
        eng = self._login("engineer.demo", "Engineer@2026!")

        dash_all = self.client.get("/api/dashboard", headers=self._hdr(eng))
        dash_filtered = self.client.get("/api/dashboard?category_id=1&days=30", headers=self._hdr(eng))
        self.assertEqual(dash_all.status_code, 200)
        self.assertEqual(dash_filtered.status_code, 200)
        self.assertLessEqual(dash_filtered.json()["kpis"]["total_assets"], dash_all.json()["kpis"]["total_assets"])

        analytics = self.client.get("/api/analytics", headers=self._hdr(eng))
        self.assertEqual(analytics.status_code, 200)
        self.assertIn("maintenance_completion", analytics.json())

        cal = self.client.get("/api/calendar", headers=self._hdr(eng))
        self.assertEqual(cal.status_code, 200)
        self.assertGreater(len(cal.json()["events"]), 0)

        search = self.client.get("/api/search?q=Switch", headers=self._hdr(eng))
        self.assertEqual(search.status_code, 200)
        self.assertGreater(len(search.json()["assets"]), 0)

    def test_05_inspection_upload_review_and_ai_honesty(self) -> None:
        insp = self._login("inspector.demo", "Inspector@2026!")
        eng = self._login("engineer.demo", "Engineer@2026!")

        # Bad upload rejected
        bad = self.client.post(
            "/api/inspections",
            headers=self._hdr(insp),
            data={
                "asset_id": "1",
                "inspection_date": "2026-11-26",
                "inspection_category": "Routine Check",
                "observed_conditions": "Checking track clip tightness along switch bed.",
            },
            files={"files": ("bad.png", b"not-a-png", "image/png")},
        )
        self.assertEqual(bad.status_code, 400)

        # Valid upload
        good = self.client.post(
            "/api/inspections",
            headers=self._hdr(insp),
            data={
                "asset_id": "1",
                "inspection_date": "2026-11-26",
                "inspection_category": "Routine Check",
                "observed_conditions": "Observed loose clips and worn pad near switch heel.",
                "report_fault": "true",
                "fault_title": "Loose clips found",
                "fault_severity": "High",
            },
            files={"files": ("track.png", VALID_PNG_BYTES, "image/png")},
        )
        self.assertEqual(good.status_code, 201, good.text)
        insp_id = good.json()["id"]

        # Review
        rev = self.client.patch(
            f"/api/inspections/{insp_id}/review",
            headers=self._hdr(eng),
            json={"status": "Approved", "review_notes": "Confirmed by engineer."},
        )
        self.assertEqual(rev.status_code, 200)
        self.assertEqual(rev.json()["status"], "Approved")

        # AI honesty when no key configured
        ai_res = self.client.post(
            "/api/ai/analyze",
            headers=self._hdr(insp),
            data={"asset_id": "1", "inspection_category": "Routine Check", "observed_conditions": "Water leak and rust in signal box."},
            files={"files": ("box.png", VALID_PNG_BYTES, "image/png")},
        )
        self.assertEqual(ai_res.status_code, 200)
        self.assertFalse(ai_res.json()["image_analyzed_by_vision_model"])
        self.assertTrue(ai_res.json()["requires_human_verification"])

    def test_06_maintenance_task_lifecycle_and_supporting_image(self) -> None:
        eng = self._login("engineer.demo", "Engineer@2026!")
        staff = self._login("staff.demo", "Staff@2026!")
        staff_me = self.client.get("/api/auth/me", headers=self._hdr(staff)).json()

        wo = self.client.post(
            "/api/work-orders",
            headers=self._hdr(eng),
            json={
                "asset_id": 1,
                "title": "Tighten switch bolts",
                "description": "Tighten all loose switch bolts and check alignment.",
                "priority": "High",
                "assigned_to": staff_me["id"],
                "due_date": "2026-12-18",
            },
        )
        self.assertEqual(wo.status_code, 201)
        wo_id = wo.json()["id"]
        self.assertEqual(wo.json()["status"], "Assigned")

        # Staff uploads supporting image
        img_up = self.client.post(
            f"/api/work-orders/{wo_id}/images",
            headers=self._hdr(staff),
            files={"files": ("repair.png", VALID_PNG_BYTES, "image/png")},
        )
        self.assertEqual(img_up.status_code, 201)

        # Staff cannot mark Completed directly
        self.assertEqual(
            self.client.patch(f"/api/work-orders/{wo_id}", headers=self._hdr(staff), json={"status": "Completed"}).status_code,
            403,
        )

        # Staff marks Waiting for Review -> Engineer marks Completed
        self.client.patch(f"/api/work-orders/{wo_id}", headers=self._hdr(staff), json={"status": "Waiting for Review"})
        done = self.client.patch(f"/api/work-orders/{wo_id}", headers=self._hdr(eng), json={"status": "Completed"})
        self.assertEqual(done.status_code, 200)
        self.assertEqual(done.json()["status"], "Completed")

    def test_07_five_report_types_pdf_and_notifications(self) -> None:
        eng = self._login("engineer.demo", "Engineer@2026!")
        for rtype in ("inspections", "asset_condition", "maintenance", "team_activity", "fault_summary"):
            pdf_res = self.client.get(f"/api/reports/export?fmt=pdf&report_type={rtype}", headers=self._hdr(eng))
            self.assertEqual(pdf_res.status_code, 200)
            self.assertTrue(pdf_res.content.startswith(b"%PDF-1.4"), f"{rtype} did not start with %PDF-1.4")

        read_all = self.client.post("/api/notifications/read-all", headers=self._hdr(eng))
        self.assertEqual(read_all.status_code, 200)

        raily = self.client.post(
            "/api/assistant/chat",
            headers=self._hdr(eng),
            json={"message": "Give me a project summary", "current_route": "/"},
        )
        self.assertEqual(raily.status_code, 200)
        self.assertFalse(raily.json()["ai_available"])
        self.assertIn("not connected", raily.json()["limitation_note"].lower())


if __name__ == "__main__":
    unittest.main()
