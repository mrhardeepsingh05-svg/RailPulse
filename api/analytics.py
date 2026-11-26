"""Live database dashboard, analytics, calendar, global search, and 5-type PDF/CSV report generator."""

from __future__ import annotations

import csv
import io
from datetime import datetime, timedelta, timezone
from typing import Any

from api.security import sanitize_csv_cell


def _today_str() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def compute_dashboard_summary(
    conn: Any,
    *,
    category_id: int | None = None,
    days: int | None = None,
) -> dict[str, Any]:
    """Calculate all Dashboard statistics strictly from stored database records."""
    today = _today_str()
    next_14 = (datetime.now(timezone.utc) + timedelta(days=14)).strftime("%Y-%m-%d")
    date_cutoff = (
        (datetime.now(timezone.utc) - timedelta(days=days)).strftime("%Y-%m-%d")
        if days is not None
        else None
    )

    asset_where = ["1=1"]
    asset_params: list[Any] = []
    if category_id is not None:
        asset_where.append("category_id = ?")
        asset_params.append(category_id)
    asset_where_sql = " AND ".join(asset_where)

    total_assets = conn.execute(f"SELECT COUNT(*) AS c FROM railway_assets WHERE {asset_where_sql}", asset_params).fetchone()["c"]
    demo_assets = conn.execute(f"SELECT COUNT(*) AS c FROM railway_assets WHERE is_demo = 1 AND {asset_where_sql}", asset_params).fetchone()["c"]
    critical_alerts = conn.execute(
        f"SELECT COUNT(*) AS c FROM railway_assets WHERE current_condition = 'Critical Alert' AND {asset_where_sql}",
        asset_params,
    ).fetchone()["c"]
    requiring_attention = conn.execute(
        f"SELECT COUNT(*) AS c FROM railway_assets WHERE current_condition IN ('Needs Attention', 'Under Repair', 'Critical Alert') AND {asset_where_sql}",
        asset_params,
    ).fetchone()["c"]

    insp_where = ["1=1"]
    insp_params: list[Any] = []
    if category_id is not None:
        insp_where.append("a.category_id = ?")
        insp_params.append(category_id)
    if date_cutoff is not None:
        insp_where.append("i.inspection_date >= ?")
        insp_params.append(date_cutoff)
    insp_where_sql = " AND ".join(insp_where)

    insp_completed = conn.execute(
        f"SELECT COUNT(*) AS c FROM inspections i JOIN railway_assets a ON a.id = i.asset_id WHERE i.status = 'Approved' AND {insp_where_sql}",
        insp_params,
    ).fetchone()["c"]
    insp_waiting = conn.execute(
        f"SELECT COUNT(*) AS c FROM inspections i JOIN railway_assets a ON a.id = i.asset_id WHERE i.status = 'Waiting for Review' AND {insp_where_sql}",
        insp_params,
    ).fetchone()["c"]
    insp_followup = conn.execute(
        f"SELECT COUNT(*) AS c FROM inspections i JOIN railway_assets a ON a.id = i.asset_id WHERE i.status = 'Needs Follow-up' AND {insp_where_sql}",
        insp_params,
    ).fetchone()["c"]

    wo_where = ["1=1"]
    wo_params: list[Any] = []
    if category_id is not None:
        wo_where.append("a.category_id = ?")
        wo_params.append(category_id)
    wo_where_sql = " AND ".join(wo_where)

    open_tasks = conn.execute(
        f"SELECT COUNT(*) AS c FROM work_orders w JOIN railway_assets a ON a.id = w.asset_id WHERE w.status != 'Completed' AND {wo_where_sql}",
        wo_params,
    ).fetchone()["c"]
    completed_tasks = conn.execute(
        f"SELECT COUNT(*) AS c FROM work_orders w JOIN railway_assets a ON a.id = w.asset_id WHERE w.status = 'Completed' AND {wo_where_sql}",
        wo_params,
    ).fetchone()["c"]
    waiting_review_tasks = conn.execute(
        f"SELECT COUNT(*) AS c FROM work_orders w JOIN railway_assets a ON a.id = w.asset_id WHERE w.status = 'Waiting for Review' AND {wo_where_sql}",
        wo_params,
    ).fetchone()["c"]
    overdue_tasks = conn.execute(
        f"SELECT COUNT(*) AS c FROM work_orders w JOIN railway_assets a ON a.id = w.asset_id WHERE w.status != 'Completed' AND w.due_date < ? AND {wo_where_sql}",
        [today, *wo_params],
    ).fetchone()["c"]
    total_tasks = open_tasks + completed_tasks
    completion_pct = round((completed_tasks / total_tasks) * 100) if total_tasks > 0 else 0

    cond_rows = conn.execute(
        f"SELECT current_condition AS condition, COUNT(*) AS count FROM railway_assets WHERE {asset_where_sql} GROUP BY current_condition",
        asset_params,
    ).fetchall()
    cond_map = {r["condition"]: r["count"] for r in cond_rows}
    asset_condition_overview = [
        {"condition": cond, "count": cond_map.get(cond, 0)}
        for cond in ("Good", "Needs Attention", "Under Repair", "Critical Alert")
    ]

    fault_category_chart = [
        dict(r)
        for r in conn.execute(
            f"""
            SELECT f.category, COUNT(*) AS count
            FROM fault_reports f
            JOIN railway_assets a ON a.id = f.asset_id
            WHERE {wo_where_sql}
            GROUP BY f.category
            ORDER BY count DESC
            LIMIT 8
            """,
            wo_params,
        ).fetchall()
    ]

    upcoming_inspections = [
        dict(r)
        for r in conn.execute(
            f"""
            SELECT a.id, a.asset_code, a.name, a.section_location, a.next_inspection_date,
                   a.current_condition, c.name AS category_name, a.is_demo
            FROM railway_assets a
            JOIN asset_categories c ON c.id = a.category_id
            WHERE a.next_inspection_date IS NOT NULL
              AND a.next_inspection_date <= ?
              AND {asset_where_sql.replace('category_id', 'a.category_id')}
            ORDER BY a.next_inspection_date ASC
            LIMIT 6
            """,
            [next_14, *asset_params],
        ).fetchall()
    ]

    recent_activities = [
        dict(r)
        for r in conn.execute(
            """
            SELECT id, actor_username, actor_role, action, entity_type, entity_id, details, created_at
            FROM activity_logs
            ORDER BY id DESC
            LIMIT 8
            """
        ).fetchall()
    ]

    return {
        "kpis": {
            "total_assets": total_assets,
            "demo_assets": demo_assets,
            "real_assets": total_assets - demo_assets,
            "inspections_completed": insp_completed,
            "inspections_waiting": insp_waiting,
            "inspections_followup": insp_followup,
            "open_maintenance_tasks": open_tasks,
            "completed_maintenance_tasks": completed_tasks,
            "waiting_review_tasks": waiting_review_tasks,
            "overdue_maintenance_tasks": overdue_tasks,
            "critical_alerts": critical_alerts,
            "assets_requiring_attention": requiring_attention,
            "maintenance_completion_pct": completion_pct,
        },
        "asset_condition_overview": asset_condition_overview,
        "fault_category_chart": fault_category_chart,
        "upcoming_inspections": upcoming_inspections,
        "recent_activities": recent_activities,
        "maintenance_progress": {
            "total": total_tasks,
            "completed": completed_tasks,
            "open": open_tasks,
            "completion_pct": completion_pct,
        },
        "data_provenance": {
            "has_demo_records": demo_assets > 0,
            "label": "SAVED RECORDS (INCLUDES DEMO SAMPLES)" if demo_assets > 0 else "LIVE SAVED RECORDS",
        },
    }


def compute_analytics_overview(conn: Any) -> dict[str, Any]:
    """Compute Analytics & Trends page datasets strictly from database records."""
    fault_distribution = [
        dict(r)
        for r in conn.execute(
            """
            SELECT category, COUNT(*) AS total,
                   SUM(CASE WHEN status IN ('Open', 'Assigned') THEN 1 ELSE 0 END) AS open_count
            FROM fault_reports
            GROUP BY category
            ORDER BY total DESC
            """
        ).fetchall()
    ]

    monthly_inspections = [
        dict(r)
        for r in conn.execute(
            """
            SELECT substr(inspection_date, 1, 7) AS month,
                   COUNT(*) AS total,
                   SUM(CASE WHEN status = 'Approved' THEN 1 ELSE 0 END) AS approved,
                   SUM(CASE WHEN status = 'Waiting for Review' THEN 1 ELSE 0 END) AS waiting,
                   SUM(CASE WHEN status = 'Needs Follow-up' THEN 1 ELSE 0 END) AS followup
            FROM inspections
            GROUP BY substr(inspection_date, 1, 7)
            ORDER BY month ASC
            """
        ).fetchall()
    ]

    open_tasks = conn.execute("SELECT COUNT(*) AS c FROM work_orders WHERE status != 'Completed'").fetchone()["c"]
    completed_tasks = conn.execute("SELECT COUNT(*) AS c FROM work_orders WHERE status = 'Completed'").fetchone()["c"]
    total_tasks = open_tasks + completed_tasks
    completion_rate = round((completed_tasks / total_tasks) * 100) if total_tasks > 0 else 0

    task_by_status = [
        dict(r)
        for r in conn.execute(
            "SELECT status, COUNT(*) AS count FROM work_orders GROUP BY status"
        ).fetchall()
    ]

    condition_trends = [
        dict(r)
        for r in conn.execute(
            """
            SELECT c.name AS category_name,
                   SUM(CASE WHEN a.current_condition = 'Good' THEN 1 ELSE 0 END) AS good_count,
                   SUM(CASE WHEN a.current_condition = 'Needs Attention' THEN 1 ELSE 0 END) AS attention_count,
                   SUM(CASE WHEN a.current_condition IN ('Under Repair', 'Critical Alert') THEN 1 ELSE 0 END) AS alert_count
            FROM asset_categories c
            LEFT JOIN railway_assets a ON a.category_id = c.id
            GROUP BY c.id
            ORDER BY c.name ASC
            """
        ).fetchall()
    ]

    inspection_history = [
        dict(r)
        for r in conn.execute(
            """
            SELECT i.inspection_code, i.inspection_date, i.inspection_category, i.status,
                   a.asset_code, a.name AS asset_name, u.full_name AS inspector_name, i.is_demo
            FROM inspections i
            JOIN railway_assets a ON a.id = i.asset_id
            JOIN users u ON u.id = i.inspector_id
            ORDER BY i.inspection_date DESC, i.id DESC
            LIMIT 25
            """
        ).fetchall()
    ]

    return {
        "fault_distribution": fault_distribution,
        "monthly_inspections": monthly_inspections,
        "maintenance_completion": {
            "completion_rate_pct": completion_rate,
            "open_tasks": open_tasks,
            "completed_tasks": completed_tasks,
            "total_tasks": total_tasks,
            "by_status": task_by_status,
        },
        "condition_trends": condition_trends,
        "inspection_history": inspection_history,
    }


def build_calendar_events(conn: Any) -> dict[str, Any]:
    """Collect real scheduled & completed events for the interactive Calendar."""
    events: list[dict[str, Any]] = []

    # 1. Upcoming / overdue inspections from assets
    for a in conn.execute(
        """
        SELECT a.id, a.asset_code, a.name, a.next_inspection_date, a.current_condition, c.name AS category_name
        FROM railway_assets a
        JOIN asset_categories c ON c.id = a.category_id
        WHERE a.next_inspection_date IS NOT NULL
        """
    ).fetchall():
        events.append(
            {
                "id": f"upcoming-insp-{a['id']}",
                "date": a["next_inspection_date"],
                "type": "upcoming_inspection",
                "title": f"Inspection Due: {a['asset_code']}",
                "subtitle": f"{a['name']} ({a['category_name']})",
                "status": a["current_condition"],
                "link": "/inspections",
            }
        )

    # 2. Maintenance task deadlines & completed tasks
    for w in conn.execute(
        """
        SELECT w.id, w.work_order_code, w.title, w.due_date, w.status, w.priority,
               w.completed_at, a.asset_code
        FROM work_orders w
        JOIN railway_assets a ON a.id = w.asset_id
        """
    ).fetchall():
        if w["status"] == "Completed" and w["completed_at"]:
            events.append(
                {
                    "id": f"done-task-{w['id']}",
                    "date": w["completed_at"][:10],
                    "type": "completed_activity",
                    "title": f"Completed: {w['work_order_code']}",
                    "subtitle": f"{w['title']} ({w['asset_code']})",
                    "status": "Completed",
                    "link": "/maintenance",
                }
            )
        else:
            events.append(
                {
                    "id": f"due-task-{w['id']}",
                    "date": w["due_date"],
                    "type": "maintenance_deadline",
                    "title": f"Task Due: {w['work_order_code']}",
                    "subtitle": f"{w['title']} ({w['priority']})",
                    "status": w["status"],
                    "link": "/maintenance",
                }
            )

    # 3. Completed inspections
    for i in conn.execute(
        """
        SELECT i.id, i.inspection_code, i.inspection_date, i.inspection_category, i.status, a.asset_code
        FROM inspections i
        JOIN railway_assets a ON a.id = i.asset_id
        """
    ).fetchall():
        events.append(
            {
                "id": f"insp-{i['id']}",
                "date": i["inspection_date"],
                "type": "completed_activity" if i["status"] == "Approved" else "maintenance_schedule",
                "title": f"{i['inspection_code']} ({i['status']})",
                "subtitle": f"{i['asset_code']} — {i['inspection_category']}",
                "status": i["status"],
                "link": "/inspections",
            }
        )

    events.sort(key=lambda e: e["date"])
    return {"events": events}


def global_search(conn: Any, query: str) -> dict[str, Any]:
    """Search across Assets, Inspections, Maintenance Tasks, Team Members, and Reports."""
    q = query.strip()
    if not q:
        return {"assets": [], "inspections": [], "tasks": [], "team": [], "reports": []}
    like = f"%{q}%"

    assets = [
        dict(r)
        for r in conn.execute(
            """
            SELECT id, asset_code, name, section_location, current_condition
            FROM railway_assets
            WHERE asset_code LIKE ? OR name LIKE ? OR section_location LIKE ?
            LIMIT 6
            """,
            (like, like, like),
        ).fetchall()
    ]

    inspections = [
        dict(r)
        for r in conn.execute(
            """
            SELECT i.id, i.inspection_code, i.inspection_date, i.status, a.asset_code, a.name AS asset_name
            FROM inspections i
            JOIN railway_assets a ON a.id = i.asset_id
            WHERE i.inspection_code LIKE ? OR i.observed_conditions LIKE ? OR a.asset_code LIKE ? OR a.name LIKE ?
            LIMIT 6
            """,
            (like, like, like, like),
        ).fetchall()
    ]

    tasks = [
        dict(r)
        for r in conn.execute(
            """
            SELECT w.id, w.work_order_code, w.title, w.status, w.priority, a.asset_code
            FROM work_orders w
            JOIN railway_assets a ON a.id = w.asset_id
            WHERE w.work_order_code LIKE ? OR w.title LIKE ? OR w.description LIKE ? OR a.asset_code LIKE ?
            LIMIT 6
            """,
            (like, like, like, like),
        ).fetchall()
    ]

    team = [
        dict(r)
        for r in conn.execute(
            """
            SELECT u.id, u.username, u.full_name, u.department, r.display_name AS role_display
            FROM users u
            JOIN roles r ON r.id = u.role_id
            WHERE u.username LIKE ? OR u.full_name LIKE ? OR u.department LIKE ? OR r.display_name LIKE ?
            LIMIT 6
            """,
            (like, like, like, like),
        ).fetchall()
    ]

    report_catalog = [
        {"id": "inspections", "title": "Inspection Reports", "description": "All submitted and reviewed inspection checks."},
        {"id": "asset_condition", "title": "Asset Condition Reports", "description": "Condition, inspection dates, and open task counts per asset."},
        {"id": "maintenance", "title": "Maintenance Reports", "description": "Maintenance task status, assignees, and due dates."},
        {"id": "team_activity", "title": "Team Activity Reports", "description": "Recent actions recorded by team members."},
        {"id": "fault_summary", "title": "Fault Summary Reports", "description": "Fault counts by category and severity."},
    ]
    q_low = q.lower()
    reports = [
        r for r in report_catalog if q_low in r["title"].lower() or q_low in r["description"].lower() or "report" in q_low
    ]

    return {
        "assets": assets,
        "inspections": inspections,
        "tasks": tasks,
        "team": team,
        "reports": reports,
    }


def build_report_data(conn: Any) -> dict[str, Any]:
    """Aggregate all 5 report datasets strictly from stored database records."""
    asset_condition = [
        dict(r)
        for r in conn.execute(
            """
            SELECT a.asset_code, a.name AS asset_name, c.name AS category, a.section_location,
                   a.current_condition, a.maintenance_status, a.last_inspection_date, a.next_inspection_date,
                   a.is_demo,
                   (SELECT COUNT(*) FROM inspections i WHERE i.asset_id = a.id) AS inspection_count,
                   (SELECT COUNT(*) FROM fault_reports f WHERE f.asset_id = a.id) AS fault_count,
                   (SELECT COUNT(*) FROM work_orders w WHERE w.asset_id = a.id AND w.status != 'Completed') AS open_tasks
            FROM railway_assets a
            JOIN asset_categories c ON c.id = a.category_id
            ORDER BY a.asset_code ASC
            """
        ).fetchall()
    ]

    inspections = [
        dict(r)
        for r in conn.execute(
            """
            SELECT i.inspection_code, i.inspection_date, i.inspection_category, i.status,
                   a.asset_code, a.name AS asset_name, u.full_name AS inspector_name, i.is_demo
            FROM inspections i
            JOIN railway_assets a ON a.id = i.asset_id
            JOIN users u ON u.id = i.inspector_id
            ORDER BY i.inspection_date DESC, i.id DESC
            """
        ).fetchall()
    ]

    maintenance = [
        dict(r)
        for r in conn.execute(
            """
            SELECT w.work_order_code, w.title, w.priority, w.status, w.due_date, w.completed_at,
                   a.asset_code, a.name AS asset_name,
                   COALESCE(u.full_name, 'Unassigned') AS assignee_name, w.is_demo
            FROM work_orders w
            JOIN railway_assets a ON a.id = w.asset_id
            LEFT JOIN users u ON u.id = w.assigned_to
            ORDER BY w.due_date ASC
            """
        ).fetchall()
    ]

    team_activity = [
        dict(r)
        for r in conn.execute(
            """
            SELECT actor_username, actor_role, action, entity_type, entity_id, details, created_at
            FROM activity_logs
            ORDER BY id DESC
            LIMIT 40
            """
        ).fetchall()
    ]

    fault_summary = [
        dict(r)
        for r in conn.execute(
            """
            SELECT category,
                   COUNT(*) AS total_faults,
                   SUM(CASE WHEN severity = 'Critical' THEN 1 ELSE 0 END) AS critical_count,
                   SUM(CASE WHEN severity = 'High' THEN 1 ELSE 0 END) AS high_count,
                   SUM(CASE WHEN status IN ('Open', 'Assigned') THEN 1 ELSE 0 END) AS open_count,
                   SUM(CASE WHEN human_verified = 1 THEN 1 ELSE 0 END) AS verified_count
            FROM fault_reports
            GROUP BY category
            ORDER BY total_faults DESC
            """
        ).fetchall()
    ]

    return {
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "asset_condition": asset_condition,
        "inspections": inspections,
        "maintenance": maintenance,
        "team_activity": team_activity,
        "fault_summary": fault_summary,
    }


def export_report_csv(report: dict[str, Any], report_type: str) -> str:
    """Generate formula-injection-safe CSV for any of the 5 report types."""
    buf = io.StringIO()
    writer = csv.writer(buf)

    if report_type == "inspections":
        writer.writerow(["Inspection ID", "Date", "Asset ID", "Asset Name", "Check Type", "Inspector", "Status", "Data Type"])
        for r in report["inspections"]:
            writer.writerow([sanitize_csv_cell(r[k]) for k in ("inspection_code", "inspection_date", "asset_code", "asset_name", "inspection_category", "inspector_name", "status")] + ["DEMO DATA" if r["is_demo"] else "REAL DATA"])
    elif report_type == "maintenance":
        writer.writerow(["Task ID", "Title", "Asset ID", "Priority", "Status", "Assigned To", "Due Date", "Data Type"])
        for r in report["maintenance"]:
            writer.writerow([sanitize_csv_cell(r[k]) for k in ("work_order_code", "title", "asset_code", "priority", "status", "assignee_name", "due_date")] + ["DEMO DATA" if r["is_demo"] else "REAL DATA"])
    elif report_type == "team_activity":
        writer.writerow(["Timestamp", "User", "Role", "Action", "Target", "Details"])
        for r in report["team_activity"]:
            writer.writerow([sanitize_csv_cell(r["created_at"]), sanitize_csv_cell(r["actor_username"]), sanitize_csv_cell(r["actor_role"]), sanitize_csv_cell(r["action"]), sanitize_csv_cell(f"{r['entity_type']}:{r['entity_id']}"), sanitize_csv_cell(r["details"])])
    elif report_type == "fault_summary":
        writer.writerow(["Fault Category", "Total", "Critical", "High", "Open", "Human Verified"])
        for r in report["fault_summary"]:
            writer.writerow([sanitize_csv_cell(r["category"]), r["total_faults"], r["critical_count"], r["high_count"], r["open_count"], r["verified_count"]])
    else:
        writer.writerow(["Asset ID", "Name", "Type", "Location", "Condition", "Status", "Last Check", "Next Check", "Inspections", "Open Tasks", "Data Type"])
        for r in report["asset_condition"]:
            writer.writerow([sanitize_csv_cell(r[k]) for k in ("asset_code", "asset_name", "category", "section_location", "current_condition", "maintenance_status")] + [sanitize_csv_cell(r["last_inspection_date"] or "Never"), sanitize_csv_cell(r["next_inspection_date"] or "Not set"), r["inspection_count"], r["open_tasks"], "DEMO DATA" if r["is_demo"] else "REAL DATA"])
    return buf.getvalue()


def _pdf_escape(text: str) -> str:
    ascii_text = text.encode("latin-1", "replace").decode("latin-1")
    return ascii_text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def export_report_pdf(report: dict[str, Any], report_type: str = "asset_condition") -> bytes:
    """Generate a standards-compliant multi-page PDF 1.4 report for any of the 5 report types."""
    titles = {
        "inspections": "Inspection Summary Report",
        "asset_condition": "Asset Condition Report",
        "maintenance": "Maintenance Tasks Report",
        "team_activity": "Team Activity Report",
        "fault_summary": "Fault Summary Report",
    }
    lines: list[str] = [
        f"RAILPULSE AI - {titles.get(report_type, 'Maintenance Report')}",
        f"Generated UTC: {report['generated_at']}",
        "Note: Records marked [DEMO] are demonstration samples. Assists authorized staff only.",
        "--------------------------------------------------------------------------------",
    ]

    if report_type == "inspections":
        for r in report["inspections"]:
            tag = "[DEMO]" if r["is_demo"] else "[REAL]"
            lines.append(f"{tag} {r['inspection_code']} | {r['inspection_date']} | {r['asset_code']} | {r['status']} | {r['inspector_name']}")
    elif report_type == "maintenance":
        for r in report["maintenance"]:
            tag = "[DEMO]" if r["is_demo"] else "[REAL]"
            lines.append(f"{tag} {r['work_order_code']} | {r['priority']} | {r['status']} | Due:{r['due_date']} | {r['assignee_name']} | {r['title'][:28]}")
    elif report_type == "team_activity":
        for r in report["team_activity"]:
            lines.append(f"{r['created_at'][:16]} | {r['actor_username']} ({r['actor_role']}) | {r['action']} | {r['entity_id']}")
    elif report_type == "fault_summary":
        for r in report["fault_summary"]:
            lines.append(f"{r['category']} | Total:{r['total_faults']} | Critical:{r['critical_count']} | High:{r['high_count']} | Open:{r['open_count']} | Verified:{r['verified_count']}")
    else:
        for r in report["asset_condition"]:
            tag = "[DEMO]" if r["is_demo"] else "[REAL]"
            lines.append(f"{tag} {r['asset_code']} | {r['asset_name'][:24]} | {r['current_condition']} | Last:{r['last_inspection_date'] or 'None'} | OpenTasks:{r['open_tasks']}")

    if len(lines) == 4:
        lines.append("No database records available for this report.")

    # Paginate into 48 lines per page
    pages_lines: list[list[str]] = [lines[i : i + 48] for i in range(0, len(lines), 48)]
    page_count = len(pages_lines)

    # Object numbering:
    # 1: Catalog, 2: Pages, 3: Font
    # For each page p (0..page_count-1):
    #   page_obj_id = 4 + 2*p
    #   content_obj_id = 5 + 2*p
    page_ids = [4 + 2 * p for p in range(page_count)]
    kids_str = " ".join(f"{pid} 0 R" for pid in page_ids)

    objects: list[bytes] = [
        b"1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n",
        f"2 0 obj << /Type /Pages /Kids [{kids_str}] /Count {page_count} >> endobj\n".encode("latin-1"),
        b"3 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj\n",
    ]

    for p_idx, p_lines in enumerate(pages_lines):
        page_obj_id = 4 + 2 * p_idx
        content_obj_id = 5 + 2 * p_idx
        y = 755
        ops = ["BT"]
        for l_idx, line in enumerate(p_lines):
            size = 13 if (p_idx == 0 and l_idx == 0) else 9
            ops.append(f"/F1 {size} Tf")
            ops.append(f"1 0 0 1 40 {y} Tm ({_pdf_escape(line)}) Tj")
            y -= 18 if (p_idx == 0 and l_idx == 0) else 13
        ops.append("ET")
        stream_data = "\n".join(ops).encode("latin-1")

        objects.append(
            f"{page_obj_id} 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents {content_obj_id} 0 R /Resources << /Font << /F1 3 0 R >> >> >> endobj\n".encode("latin-1")
        )
        objects.append(
            f"{content_obj_id} 0 obj << /Length {len(stream_data)} >> stream\n".encode("latin-1")
            + stream_data
            + b"\nendstream endobj\n"
        )

    pdf = bytearray(b"%PDF-1.4\n")
    offsets: list[int] = [0]
    for obj in objects:
        offsets.append(len(pdf))
        pdf.extend(obj)

    xref_pos = len(pdf)
    pdf.extend(f"xref\n0 {len(objects) + 1}\n".encode("latin-1"))
    pdf.extend(b"0000000000 65535 f \n")
    for off in offsets[1:]:
        pdf.extend(f"{off:010d} 00000 n \n".encode("latin-1"))
    pdf.extend(f"trailer << /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref_pos}\n%%EOF\n".encode("latin-1"))
    return bytes(pdf)
