"""Validated demonstration data seeder (clearly tagged is_demo=1)."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from api.config import settings
from api.database import get_db
from api.security import hash_password


def _days_ago(days: int) -> str:
    return (datetime.now(timezone.utc) - timedelta(days=days)).strftime("%Y-%m-%d")


def _ts_days_ago(days: int) -> str:
    return (datetime.now(timezone.utc) - timedelta(days=days)).strftime("%Y-%m-%dT%H:%M:%SZ")


def _days_ahead(days: int) -> str:
    return (datetime.now(timezone.utc) + timedelta(days=days)).strftime("%Y-%m-%d")


def seed_initial_data() -> None:
    """Idempotently populate core roles, 6 asset categories, and clearly-labelled demo records."""
    with get_db() as conn:
        roles = [
            ("admin", "Admin", "Manages team accounts, roles, categories, assets, and system logs."),
            ("inspector", "Inspector", "Creates and reviews inspections, uploads photos, and checks AI findings."),
            ("engineer", "Engineer", "Manages assets, verifies inspection findings, and assigns maintenance tasks."),
            ("staff", "Maintenance Staff", "Carries out assigned maintenance tasks, adds notes, and uploads repair photos."),
        ]
        for name, display, desc in roles:
            conn.execute(
                "INSERT OR IGNORE INTO roles (name, display_name, description) VALUES (?, ?, ?)",
                (name, display, desc),
            )

        categories = [
            ("TRK", "Railway Tracks", 30, "Running rails, sleepers, joints, switches, and track bed."),
            ("BRG", "Bridges", 90, "Steel spans, piers, bearings, and drainage structures."),
            ("STN", "Railway Stations", 60, "Platforms, shelters, footbridges, and passenger walkways."),
            ("SIG", "Signals", 14, "Track signals, point motors, and track-side control boxes."),
            ("LXG", "Level Crossings", 21, "Road-rail crossing surfaces, barrier gates, and warning lights."),
            ("EQP", "Railway Equipment", 30, "Power lines, tensioners, switches, and wayside equipment."),
        ]
        for code, name, interval, desc in categories:
            conn.execute(
                """
                INSERT OR IGNORE INTO asset_categories (code, name, inspection_interval_days, description)
                VALUES (?, ?, ?, ?)
                """,
                (code, name, interval, desc),
            )

        if not settings.ENABLE_DEMO_DATA:
            conn.commit()
            return

        existing_users = conn.execute("SELECT COUNT(*) AS c FROM users").fetchone()["c"]
        if existing_users > 0:
            conn.commit()
            return

        role_rows = {r["name"]: r["id"] for r in conn.execute("SELECT id, name FROM roles").fetchall()}
        cat_rows = {c["code"]: c["id"] for c in conn.execute("SELECT id, code FROM asset_categories").fetchall()}

        demo_users = [
            ("admin.demo", "admin.demo@railpulse.example", "Vikram Rao", "Admin@2026!", role_rows["admin"], "System Administration"),
            ("inspector.demo", "inspector.demo@railpulse.example", "Priya Nair", "Inspector@2026!", role_rows["inspector"], "Field Inspection Team"),
            ("engineer.demo", "engineer.demo@railpulse.example", "Arjun Mehta", "Engineer@2026!", role_rows["engineer"], "Track & Signal Engineering"),
            ("staff.demo", "staff.demo@railpulse.example", "Rohan Kulkarni", "Staff@2026!", role_rows["staff"], "Field Maintenance Crew"),
        ]
        for uname, email, fname, pw, rid, dept in demo_users:
            conn.execute(
                """
                INSERT INTO users (username, email, full_name, password_hash, role_id, department, is_active, is_demo)
                VALUES (?, ?, ?, ?, ?, ?, 1, 1)
                """,
                (uname, email, fname, hash_password(pw), rid, dept),
            )

        user_rows = {u["username"]: u["id"] for u in conn.execute("SELECT id, username FROM users").fetchall()}
        admin_id = user_rows["admin.demo"]
        insp_uid = user_rows["inspector.demo"]
        eng_uid = user_rows["engineer.demo"]
        staff_uid = user_rows["staff.demo"]

        # Note: Demo assets leave GPS coordinates NULL by default (coordinates_verified = 0)
        # so the Map View never displays invented coordinates unless a user stores verified coordinates.
        demo_assets = [
            ("RP-TRK-001", "North Line Switch #14A", cat_rows["TRK"], "North Section — Km 14.2", "Main track switch assembly and sleeper bed.", _days_ago(720), _days_ago(180), _days_ago(6), _days_ahead(5), "Needs Attention", "Maintenance Scheduled", eng_uid),
            ("RP-BRG-002", "River Crossing Span S-04", cat_rows["BRG"], "East Section — Km 28.6", "Steel plate bridge span with concrete piers.", _days_ago(1200), _days_ago(365), _days_ago(95), _days_ago(5), "Needs Attention", "Active", eng_uid),
            ("RP-SIG-003", "Home Signal & Box HS-09", cat_rows["SIG"], "Central Yard — Approach B", "Signal lamp assembly and track-side relay box.", _days_ago(500), _days_ago(240), _days_ago(18), _days_ahead(2), "Critical Alert", "Under Repair", eng_uid),
            ("RP-EQP-004", "Overhead Tension Unit P-22", cat_rows["EQP"], "West Line — Km 42.1", "Overhead wire tensioner and insulator set.", _days_ago(640), _days_ago(210), _days_ago(12), _days_ahead(18), "Good", "Active", eng_uid),
            ("RP-LXG-005", "Road Crossing Gate LC-18", cat_rows["LXG"], "South Spur — Km 9.4", "Dual-barrier road crossing with warning lights.", _days_ago(480), _days_ago(150), _days_ago(26), _days_ahead(4), "Under Repair", "Under Repair", staff_uid),
            ("RP-TRK-006", "Welded Track Section CWR-11", cat_rows["TRK"], "West Line — Km 51.0", "Continuous welded rail on concrete sleepers.", _days_ago(900), _days_ago(300), _days_ago(9), _days_ahead(21), "Good", "Active", eng_uid),
            ("RP-STN-007", "Platform Footbridge FOB-2", cat_rows["STN"], "North Station — Platform 2/3", "Pedestrian steel footbridge and stairs.", _days_ago(820), _days_ago(60), _days_ago(22), _days_ahead(38), "Good", "Active", staff_uid),
        ]
        for code, name, cid, loc, desc, inst_d, reg_d, last_i, next_i, cond, mstat, eid in demo_assets:
            conn.execute(
                """
                INSERT INTO railway_assets (
                    asset_code, name, category_id, section_location, description,
                    installation_date, registration_date, last_inspection_date, next_inspection_date,
                    current_condition, maintenance_status, assigned_engineer_id, is_demo
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
                """,
                (code, name, cid, loc, desc, inst_d, reg_d, last_i, next_i, cond, mstat, eid),
            )

        asset_rows = {a["asset_code"]: a["id"] for a in conn.execute("SELECT id, asset_code FROM railway_assets").fetchall()}

        demo_inspections = [
            ("INSP-2026-0001", asset_rows["RP-TRK-001"], insp_uid, _days_ago(55), "Routine Check", "Small pad wear seen near switch heel. Bolts tightened.", "Approved", eng_uid, "Approved; watch during next check.", _ts_days_ago(54)),
            ("INSP-2026-0002", asset_rows["RP-TRK-001"], insp_uid, _days_ago(28), "Track & Structure Check", "4 track clips loose again with minor joint step wear.", "Approved", eng_uid, "Approved; repair task created.", _ts_days_ago(27)),
            ("INSP-2026-0003", asset_rows["RP-TRK-001"], insp_uid, _days_ago(6), "Routine Check", "Clip vibration noticed again at rail joint.", "Waiting for Review", None, "", None),
            ("INSP-2026-0004", asset_rows["RP-SIG-003"], insp_uid, _days_ago(42), "Signal Check", "Water droplets noticed inside signal box door seal.", "Approved", eng_uid, "Approved; seal replacement advised.", _ts_days_ago(41)),
            ("INSP-2026-0005", asset_rows["RP-SIG-003"], insp_uid, _days_ago(18), "Signal Check", "Water entering near cable entry; rust visible on spare terminal.", "Approved", eng_uid, "Approved; high priority repair created.", _ts_days_ago(17)),
            ("INSP-2026-0006", asset_rows["RP-BRG-002"], insp_uid, _days_ago(95), "Track & Structure Check", "Bridge bearings intact; light surface rust on lower edge.", "Approved", eng_uid, "Approved; schedule touch-up paint.", _ts_days_ago(94)),
            ("INSP-2026-0007", asset_rows["RP-EQP-004"], insp_uid, _days_ago(12), "Routine Check", "Tension unit height normal and insulators clean.", "Approved", eng_uid, "Approved.", _ts_days_ago(11)),
            ("INSP-2026-0008", asset_rows["RP-LXG-005"], insp_uid, _days_ago(26), "Safety & Crossing Check", "West gate arm lowering slowly; small oil leak at seal.", "Approved", eng_uid, "Approved; repair task assigned.", _ts_days_ago(25)),
            ("INSP-2026-0009", asset_rows["RP-TRK-006"], insp_uid, _days_ago(9), "Track & Structure Check", "Track surface smooth and ballast uniform.", "Approved", eng_uid, "Approved.", _ts_days_ago(8)),
            ("INSP-2026-0010", asset_rows["RP-STN-007"], insp_uid, _days_ago(22), "Routine Check", "Stair steps intact; minor paint peel on handrail.", "Waiting for Review", None, "", None),
        ]
        for code, aid, iid, idate, icat, obs, st, rev_id, rnotes, rat in demo_inspections:
            conn.execute(
                """
                INSERT INTO inspections (
                    inspection_code, asset_id, inspector_id, inspection_date,
                    inspection_category, observed_conditions, status,
                    reviewer_id, review_notes, reviewed_at, is_demo
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
                """,
                (code, aid, iid, idate, icat, obs, st, rev_id, rnotes, rat),
            )

        insp_rows = {i["inspection_code"]: i["id"] for i in conn.execute("SELECT id, inspection_code FROM inspections").fetchall()}

        demo_faults = [
            ("FLT-2026-0001", insp_rows["INSP-2026-0001"], asset_rows["RP-TRK-001"], insp_uid, "Track & Fasteners", "Medium", "Worn pad at switch heel", "Small pad wear near switch heel block.", "DEMO_RULE_BASED", 1, eng_uid, _ts_days_ago(54), "Resolved"),
            ("FLT-2026-0002", insp_rows["INSP-2026-0002"], asset_rows["RP-TRK-001"], insp_uid, "Track & Fasteners", "High", "Loose clips & joint wear", "4 track clips loose with minor joint step wear.", "DEMO_RULE_BASED", 1, eng_uid, _ts_days_ago(27), "Assigned"),
            ("FLT-2026-0003", insp_rows["INSP-2026-0003"], asset_rows["RP-TRK-001"], insp_uid, "Track & Fasteners", "High", "Repeated clip vibration", "Clip vibration returned within 22 days.", "DEMO_RULE_BASED", 0, None, None, "Open"),
            ("FLT-2026-0004", insp_rows["INSP-2026-0004"], asset_rows["RP-SIG-003"], insp_uid, "Signal Box Seal", "Medium", "Moisture inside signal box", "Condensation inside signal box door seal.", "DEMO_RULE_BASED", 1, eng_uid, _ts_days_ago(41), "Resolved"),
            ("FLT-2026-0005", insp_rows["INSP-2026-0005"], asset_rows["RP-SIG-003"], insp_uid, "Signal Box Seal", "Critical", "Water leak & terminal rust", "Water entering cable entry with rust on spare terminal.", "DEMO_RULE_BASED", 1, eng_uid, _ts_days_ago(17), "Assigned"),
            ("FLT-2026-0006", insp_rows["INSP-2026-0008"], asset_rows["RP-LXG-005"], insp_uid, "Crossing Gate Mechanism", "High", "Gate arm hydraulic oil leak", "Oil weeping slowing down gate arm drop.", "MANUAL", 1, eng_uid, _ts_days_ago(25), "Assigned"),
            ("FLT-2026-0007", insp_rows["INSP-2026-0006"], asset_rows["RP-BRG-002"], insp_uid, "Surface Rust", "Low", "Light rust on bridge edge", "Paint flaking on drainage edge.", "MANUAL", 1, eng_uid, _ts_days_ago(94), "Open"),
        ]
        for fcode, insp_id, aid, rby, fcat, sev, title, desc, aimode, hvis, vby, vat, st in demo_faults:
            conn.execute(
                """
                INSERT INTO fault_reports (
                    fault_code, inspection_id, asset_id, reported_by, category,
                    severity, title, description, ai_mode, human_verified,
                    verified_by, verified_at, status, is_demo
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
                """,
                (fcode, insp_id, aid, rby, fcat, sev, title, desc, aimode, hvis, vby, vat, st),
            )

        fault_rows = {f["fault_code"]: f["id"] for f in conn.execute("SELECT id, fault_code FROM fault_reports").fetchall()}

        demo_wos = [
            ("TASK-2026-0001", asset_rows["RP-TRK-001"], fault_rows["FLT-2026-0001"], insp_rows["INSP-2026-0001"], "Replace heel block pads", "Replace worn pads and tighten track clips at Switch #14A.", "Medium", "Completed", staff_uid, eng_uid, _days_ago(40), "Replaced 4 pads and tightened clips.", "Checked and signed off.", _ts_days_ago(42)),
            ("TASK-2026-0002", asset_rows["RP-SIG-003"], fault_rows["FLT-2026-0005"], insp_rows["INSP-2026-0005"], "Seal signal cable entry & clean rust", "Install waterproof cable seals and clean spare terminal block.", "Critical", "In Progress", staff_uid, eng_uid, _days_ago(2), "New seals installed; final test pending.", "", None),
            ("TASK-2026-0003", asset_rows["RP-LXG-005"], fault_rows["FLT-2026-0006"], insp_rows["INSP-2026-0008"], "Fix gate arm seal leak", "Replace seal kit on West crossing gate and check drop speed.", "High", "Waiting for Review", staff_uid, eng_uid, _days_ahead(3), "Seal kit replaced and tested 15 times.", "Ready for engineer check.", None),
            ("TASK-2026-0004", asset_rows["RP-TRK-001"], fault_rows["FLT-2026-0002"], insp_rows["INSP-2026-0002"], "Smooth rail joint & pack ballast", "Smooth small step at rail joint and pack ballast at Switch #14A.", "High", "Assigned", staff_uid, eng_uid, _days_ahead(6), "Scheduled for field crew.", "", None),
            ("TASK-2026-0005", asset_rows["RP-BRG-002"], fault_rows["FLT-2026-0007"], insp_rows["INSP-2026-0006"], "Touch-up paint on bridge edge", "Brush off light rust and apply primer on Span S-04.", "Low", "New", None, eng_uid, _days_ahead(14), "Waiting for team assignment.", "", None),
        ]
        for wcode, aid, fid, iid, title, desc, prio, st, ato, cby, due, mnotes, cnotes, cat_ts in demo_wos:
            conn.execute(
                """
                INSERT INTO work_orders (
                    work_order_code, asset_id, fault_report_id, inspection_id,
                    title, description, priority, status, assigned_to, created_by,
                    due_date, maintenance_notes, completion_notes, completed_at, is_demo
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
                """,
                (wcode, aid, fid, iid, title, desc, prio, st, ato, cby, due, mnotes, cnotes, cat_ts),
            )

        wo_rows = {w["work_order_code"]: w["id"] for w in conn.execute("SELECT id, work_order_code FROM work_orders").fetchall()}

        demo_maint = [
            (wo_rows["TASK-2026-0001"], asset_rows["RP-TRK-001"], eng_uid, None, "Assigned", "Task created and assigned", "Assigned to Rohan Kulkarni.", _ts_days_ago(53)),
            (wo_rows["TASK-2026-0001"], asset_rows["RP-TRK-001"], staff_uid, "Assigned", "In Progress", "Work started on site", "Track clear window confirmed.", _ts_days_ago(45)),
            (wo_rows["TASK-2026-0001"], asset_rows["RP-TRK-001"], eng_uid, "Waiting for Review", "Completed", "Task verified and completed", "Pads replaced and clips checked.", _ts_days_ago(42)),
            (wo_rows["TASK-2026-0002"], asset_rows["RP-SIG-003"], eng_uid, None, "Assigned", "Urgent repair task created", "Needs waterproof sealing.", _ts_days_ago(16)),
            (wo_rows["TASK-2026-0002"], asset_rows["RP-SIG-003"], staff_uid, "Assigned", "In Progress", "Seals replaced", "Final moisture check remaining.", _ts_days_ago(5)),
            (wo_rows["TASK-2026-0003"], asset_rows["RP-LXG-005"], staff_uid, "In Progress", "Waiting for Review", "Repair finished, waiting for check", "Gate drop time normal.", _ts_days_ago(2)),
        ]
        for woid, aid, pby, prev, new, summ, notes, rts in demo_maint:
            conn.execute(
                """
                INSERT INTO maintenance_records (
                    work_order_id, asset_id, performed_by, previous_status,
                    new_status, action_summary, notes, recorded_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (woid, aid, pby, prev, new, summ, notes, rts),
            )

        demo_notifs = [
            (eng_uid, "2 Inspections Waiting for Review", "INSP-2026-0003 and INSP-2026-0010 are waiting for review.", "inspection_waiting", "warning", "/inspections"),
            (eng_uid, "Task Ready for Review", "TASK-2026-0003 (Road Crossing Gate LC-18) is waiting for review.", "task_waiting", "info", "/maintenance"),
            (eng_uid, "Important Asset Alert: RP-SIG-003", "Home Signal & Box HS-09 is marked Critical Alert.", "asset_alert", "critical", "/assets"),
            (staff_uid, "Maintenance Task Assigned", "TASK-2026-0004 (Switch #14A) is assigned to you.", "task_assigned", "info", "/maintenance"),
            (insp_uid, "Upcoming Inspection Reminder", "RP-TRK-001 and RP-LXG-005 are due for inspection within 7 days.", "upcoming_reminder", "warning", "/calendar"),
        ]
        for uid, title, msg, cat, sev, link in demo_notifs:
            conn.execute(
                """
                INSERT INTO notifications (user_id, title, message, category, severity, link_path)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (uid, title, msg, cat, sev, link),
            )

        conn.execute(
            """
            INSERT INTO activity_logs (
                actor_user_id, actor_username, actor_role, action,
                entity_type, entity_id, details, ip_address
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                admin_id,
                "admin.demo",
                "admin",
                "DEMO_DATA_READY",
                "system",
                "railpulse",
                "Loaded sample demonstration records (clearly labelled DEMO DATA).",
                "127.0.0.1",
            ),
        )
        conn.commit()
