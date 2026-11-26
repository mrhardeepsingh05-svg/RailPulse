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
        {"id": "overdue_tasks", "title": "Overdue Task Reports", "description": "Maintenance tasks past their due date and still open."},
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

    today = _today_str()
    overdue_tasks = [
        dict(r)
        for r in conn.execute(
            """
            SELECT w.work_order_code, w.title, w.priority, w.status, w.due_date,
                   CAST(julianday(?) - julianday(w.due_date) AS INTEGER) AS days_overdue,
                   a.asset_code, a.name AS asset_name,
                   COALESCE(u.full_name, 'Unassigned') AS assignee_name, w.is_demo
            FROM work_orders w
            JOIN railway_assets a ON a.id = w.asset_id
            LEFT JOIN users u ON u.id = w.assigned_to
            WHERE w.status != 'Completed' AND w.due_date < ?
            ORDER BY w.due_date ASC
            """,
            (today, today),
        ).fetchall()
    ]

    return {
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "asset_condition": asset_condition,
        "inspections": inspections,
        "maintenance": maintenance,
        "overdue_tasks": overdue_tasks,
        "team_activity": team_activity,
        "fault_summary": fault_summary,
    }


def export_report_csv(report: dict[str, Any], report_type: str) -> str:
    """Generate formula-injection-safe CSV for any of the 6 report types."""
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
    elif report_type == "overdue_tasks":
        writer.writerow(["Task ID", "Title", "Asset ID", "Priority", "Status", "Assigned To", "Due Date", "Days Overdue", "Data Type"])
        for r in report["overdue_tasks"]:
            writer.writerow([sanitize_csv_cell(r[k]) for k in ("work_order_code", "title", "asset_code", "priority", "status", "assignee_name", "due_date")] + [r["days_overdue"], "DEMO DATA" if r["is_demo"] else "REAL DATA"])
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
        "overdue_tasks": "Overdue Maintenance Tasks Report",
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
    elif report_type == "overdue_tasks":
        for r in report["overdue_tasks"]:
            tag = "[DEMO]" if r["is_demo"] else "[REAL]"
            lines.append(f"{tag} {r['work_order_code']} | Overdue:{r['days_overdue']}d | {r['priority']} | {r['status']} | {r['asset_code']} | {r['assignee_name']}")
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


def compute_predictive_maintenance(conn: Any) -> dict[str, Any]:
    """Transparent rule-based Predictive Maintenance analysis strictly from stored history.

    Enforces data-availability guardrails: assets with zero historical inspections,
    fault reports, and maintenance tasks receive 'Insufficient Data' rather than
    a fabricated prediction. Never claims to predict railway accidents or guarantee safety.
    """
    today = _today_str()
    today_dt = datetime.strptime(today, "%Y-%m-%d").date()

    rows = conn.execute(
        """
        SELECT a.id, a.asset_code, a.name, a.section_location, a.current_condition,
               a.maintenance_status, a.last_inspection_date, a.next_inspection_date, a.is_demo,
               c.name AS category_name,
               (SELECT COUNT(*) FROM inspections i WHERE i.asset_id = a.id) AS inspection_count,
               (SELECT COUNT(*) FROM inspections i WHERE i.asset_id = a.id AND i.status = 'Needs Follow-up') AS followup_count,
               (SELECT COUNT(*) FROM fault_reports f WHERE f.asset_id = a.id) AS fault_count,
               (SELECT COUNT(*) FROM fault_reports f WHERE f.asset_id = a.id AND f.status IN ('Open', 'Assigned')) AS open_fault_count,
               (SELECT COUNT(*) FROM fault_reports f WHERE f.asset_id = a.id AND f.severity = 'Critical') AS critical_fault_count,
               (SELECT COUNT(*) FROM work_orders w WHERE w.asset_id = a.id) AS total_work_orders,
               (SELECT COUNT(*) FROM work_orders w WHERE w.asset_id = a.id AND w.status != 'Completed') AS open_work_orders,
               (SELECT COUNT(*) FROM work_orders w WHERE w.asset_id = a.id AND w.status != 'Completed' AND w.due_date < ?) AS overdue_work_orders
        FROM railway_assets a
        JOIN asset_categories c ON c.id = a.category_id
        ORDER BY a.id ASC
        """,
        (today,),
    ).fetchall()

    rules_documentation = [
        {"factor": "Critical or Under Repair condition", "points": "+35 / +20", "meaning": "Asset condition is currently flagged Critical Alert (+35) or Needs Attention / Under Repair (+20)."},
        {"factor": "Repeated maintenance work orders", "points": "+20", "meaning": "Asset has 2 or more recorded maintenance tasks showing recurring repair demand."},
        {"factor": "Frequent or open fault reports", "points": "+15 / +25", "meaning": "Multiple faults or unresolved open faults (+15), plus +10 if Critical severity fault exists."},
        {"factor": "Overdue scheduled inspection", "points": "+20", "meaning": "Next scheduled inspection date has passed without a newly completed check."},
        {"factor": "Overdue maintenance task", "points": "+15", "meaning": "One or more open maintenance tasks are past their target due date."},
        {"factor": "Repeated follow-up inspections", "points": "+10", "meaning": "Multiple inspections marked Needs Follow-up."},
    ]

    asset_estimates: list[dict[str, Any]] = []
    overdue_inspections: list[dict[str, Any]] = []
    frequent_fault_assets: list[dict[str, Any]] = []
    repeated_issue_assets: list[dict[str, Any]] = []
    insufficient_count = 0

    for r in rows:
        item = dict(r)
        history_records = item["inspection_count"] + item["fault_count"] + item["total_work_orders"]

        overdue_days = 0
        if item["next_inspection_date"]:
            try:
                due_dt = datetime.strptime(item["next_inspection_date"], "%Y-%m-%d").date()
                if due_dt < today_dt:
                    overdue_days = (today_dt - due_dt).days
            except ValueError:
                overdue_days = 0

        if overdue_days > 0:
            overdue_inspections.append(
                {
                    "id": item["id"],
                    "asset_code": item["asset_code"],
                    "name": item["name"],
                    "category_name": item["category_name"],
                    "section_location": item["section_location"],
                    "next_inspection_date": item["next_inspection_date"],
                    "days_overdue": overdue_days,
                    "is_demo": item["is_demo"],
                }
            )

        if item["fault_count"] >= 1:
            frequent_fault_assets.append(
                {
                    "id": item["id"],
                    "asset_code": item["asset_code"],
                    "name": item["name"],
                    "category_name": item["category_name"],
                    "fault_count": item["fault_count"],
                    "open_fault_count": item["open_fault_count"],
                    "critical_fault_count": item["critical_fault_count"],
                    "is_demo": item["is_demo"],
                }
            )

        if item["total_work_orders"] >= 2 or item["followup_count"] >= 2 or item["fault_count"] >= 2:
            repeated_issue_assets.append(
                {
                    "id": item["id"],
                    "asset_code": item["asset_code"],
                    "name": item["name"],
                    "total_work_orders": item["total_work_orders"],
                    "fault_count": item["fault_count"],
                    "followup_count": item["followup_count"],
                    "is_demo": item["is_demo"],
                }
            )

        if history_records < 1:
            insufficient_count += 1
            asset_estimates.append(
                {
                    **item,
                    "overdue_days": overdue_days,
                    "history_records": history_records,
                    "data_availability": "Insufficient",
                    "risk_score": None,
                    "risk_level": "Insufficient Data",
                    "confidence": "Cannot estimate (0 past records)",
                    "prediction_basis": [
                        "No past inspection, fault, or maintenance task records saved for this asset yet."
                    ],
                    "recommended_action": "Complete an initial inspection before generating maintenance estimates.",
                }
            )
            continue

        score = 0
        basis: list[str] = []
        if item["current_condition"] == "Critical Alert":
            score += 35
            basis.append("Current condition is Critical Alert (+35).")
        elif item["current_condition"] in ("Needs Attention", "Under Repair"):
            score += 20
            basis.append(f"Current condition is {item['current_condition']} (+20).")

        if item["total_work_orders"] >= 2:
            score += 20
            basis.append(f"Repeated maintenance demand: {item['total_work_orders']} tasks logged (+20).")
        if item["fault_count"] >= 2 or item["open_fault_count"] >= 1:
            score += 15
            basis.append(f"Reported faults: {item['fault_count']} total, {item['open_fault_count']} open (+15).")
        if item["critical_fault_count"] >= 1:
            score += 10
            basis.append(f"Critical-severity fault on record (+10).")
        if overdue_days > 0:
            score += 20
            basis.append(f"Inspection overdue by {overdue_days} day(s) (+20).")
        if item["overdue_work_orders"] >= 1:
            score += 15
            basis.append(f"{item['overdue_work_orders']} overdue maintenance task(s) (+15).")
        if item["followup_count"] >= 2:
            score += 10
            basis.append(f"{item['followup_count']} inspections required follow-up (+10).")

        if not basis:
            basis.append(f"Based on {history_records} recorded history item(s) with no active alerts or overdue dates.")

        score = min(score, 100)
        if score >= 50:
            risk_level = "High Watch"
            rec_action = "Schedule an urgent follow-up inspection and review open repair tasks."
        elif score >= 25:
            risk_level = "Moderate Watch"
            rec_action = "Plan a targeted follow-up check before the next cycle date."
        else:
            risk_level = "Low Watch"
            rec_action = "Continue regular scheduled checks."

        if history_records >= 4:
            confidence = f"Medium ({history_records} history records)"
            availability = "Sufficient"
        else:
            confidence = f"Low ({history_records} history record{'s' if history_records != 1 else ''} — limited trend depth)"
            availability = "Limited"

        asset_estimates.append(
            {
                **item,
                "overdue_days": overdue_days,
                "history_records": history_records,
                "data_availability": availability,
                "risk_score": score,
                "risk_level": risk_level,
                "confidence": confidence,
                "prediction_basis": basis,
                "recommended_action": rec_action,
            }
        )

    asset_estimates.sort(
        key=lambda a: (a["risk_score"] is not None, a["risk_score"] if a["risk_score"] is not None else -1),
        reverse=True,
    )
    frequent_fault_assets.sort(key=lambda a: (a["fault_count"], a["open_fault_count"]), reverse=True)
    overdue_inspections.sort(key=lambda a: a["days_overdue"], reverse=True)

    total_inspections = conn.execute("SELECT COUNT(*) AS c FROM inspections").fetchone()["c"]
    total_faults = conn.execute("SELECT COUNT(*) AS c FROM fault_reports").fetchone()["c"]
    total_tasks = conn.execute("SELECT COUNT(*) AS c FROM work_orders").fetchone()["c"]
    sufficient_assets = len(asset_estimates) - insufficient_count
    system_data_sufficient = (total_inspections + total_faults + total_tasks) >= 3

    return {
        "provenance_label": "PREDICTIVE ESTIMATES",
        "system_data_sufficient": system_data_sufficient,
        "summary": {
            "total_assets_evaluated": len(asset_estimates),
            "sufficient_assets": sufficient_assets,
            "insufficient_data_assets": insufficient_count,
            "high_watch_count": sum(1 for a in asset_estimates if a["risk_level"] == "High Watch"),
            "overdue_inspections_count": len(overdue_inspections),
            "repeated_issue_assets_count": len(repeated_issue_assets),
            "total_history_records": total_inspections + total_faults + total_tasks,
        },
        "rules_documentation": rules_documentation,
        "asset_estimates": asset_estimates,
        "overdue_inspections": overdue_inspections,
        "frequent_fault_assets": frequent_fault_assets,
        "repeated_issue_assets": repeated_issue_assets,
        "safety_disclaimer": (
            "PREDICTIVE ESTIMATES are transparent rule-based indicators calculated strictly from saved database "
            "records. They assist authorised maintenance teams and NEVER claim to predict railway accidents or guarantee safety."
        ),
    }
