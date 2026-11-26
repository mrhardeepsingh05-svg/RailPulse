-- RAILPULSE AI Normalized Relational Database Schema (v2)
-- Compatible with SQLite 3 (PRAGMA foreign_keys = ON) and PostgreSQL

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS roles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE CHECK (name IN ('admin', 'inspector', 'engineer', 'staff')),
    display_name TEXT NOT NULL,
    description TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    email TEXT NOT NULL UNIQUE,
    full_name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
    department TEXT NOT NULL DEFAULT 'Railway Maintenance',
    is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    is_demo INTEGER NOT NULL DEFAULT 0 CHECK (is_demo IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE TABLE IF NOT EXISTS asset_categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL UNIQUE,
    inspection_interval_days INTEGER NOT NULL DEFAULT 30 CHECK (inspection_interval_days >= 1),
    description TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE TABLE IF NOT EXISTS railway_assets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    asset_code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    category_id INTEGER NOT NULL REFERENCES asset_categories(id) ON DELETE RESTRICT,
    section_location TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    installation_date TEXT,
    registration_date TEXT NOT NULL,
    last_inspection_date TEXT,
    next_inspection_date TEXT,
    current_condition TEXT NOT NULL DEFAULT 'Good'
        CHECK (current_condition IN ('Good', 'Needs Attention', 'Under Repair', 'Critical Alert')),
    maintenance_status TEXT NOT NULL DEFAULT 'Active'
        CHECK (maintenance_status IN ('Active', 'Maintenance Scheduled', 'Under Repair', 'Out of Service')),
    latitude REAL,
    longitude REAL,
    coordinates_verified INTEGER NOT NULL DEFAULT 0 CHECK (coordinates_verified IN (0, 1)),
    assigned_engineer_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    is_demo INTEGER NOT NULL DEFAULT 0 CHECK (is_demo IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE TABLE IF NOT EXISTS asset_images (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    asset_id INTEGER NOT NULL REFERENCES railway_assets(id) ON DELETE CASCADE,
    original_filename TEXT NOT NULL,
    stored_filename TEXT NOT NULL UNIQUE,
    mime_type TEXT NOT NULL CHECK (mime_type IN ('image/jpeg', 'image/png', 'image/webp')),
    file_size_bytes INTEGER NOT NULL CHECK (file_size_bytes > 0 AND file_size_bytes <= 5242880),
    sha256_hash TEXT NOT NULL,
    uploaded_by INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE TABLE IF NOT EXISTS inspections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    inspection_code TEXT NOT NULL UNIQUE,
    asset_id INTEGER NOT NULL REFERENCES railway_assets(id) ON DELETE CASCADE,
    inspector_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    inspection_date TEXT NOT NULL,
    inspection_category TEXT NOT NULL
        CHECK (inspection_category IN ('Routine Check', 'Track & Structure Check', 'Signal Check', 'Safety & Crossing Check', 'Urgent Check')),
    observed_conditions TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'Waiting for Review'
        CHECK (status IN ('Waiting for Review', 'Approved', 'Needs Follow-up')),
    reviewer_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    review_notes TEXT DEFAULT '',
    reviewed_at TEXT,
    is_demo INTEGER NOT NULL DEFAULT 0 CHECK (is_demo IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE TABLE IF NOT EXISTS inspection_images (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    inspection_id INTEGER NOT NULL REFERENCES inspections(id) ON DELETE CASCADE,
    original_filename TEXT NOT NULL,
    stored_filename TEXT NOT NULL UNIQUE,
    mime_type TEXT NOT NULL CHECK (mime_type IN ('image/jpeg', 'image/png', 'image/webp')),
    file_size_bytes INTEGER NOT NULL CHECK (file_size_bytes > 0 AND file_size_bytes <= 5242880),
    sha256_hash TEXT NOT NULL,
    uploaded_by INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE TABLE IF NOT EXISTS fault_reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    fault_code TEXT NOT NULL UNIQUE,
    inspection_id INTEGER REFERENCES inspections(id) ON DELETE SET NULL,
    asset_id INTEGER NOT NULL REFERENCES railway_assets(id) ON DELETE CASCADE,
    reported_by INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    category TEXT NOT NULL,
    severity TEXT NOT NULL CHECK (severity IN ('Low', 'Medium', 'High', 'Critical')),
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    ai_analysis_json TEXT,
    ai_confidence TEXT DEFAULT '',
    ai_mode TEXT NOT NULL DEFAULT 'MANUAL' CHECK (ai_mode IN ('MANUAL', 'DEMO_RULE_BASED', 'LIVE_VISION_LLM')),
    human_verified INTEGER NOT NULL DEFAULT 0 CHECK (human_verified IN (0, 1)),
    verified_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    verified_at TEXT,
    status TEXT NOT NULL DEFAULT 'Open' CHECK (status IN ('Open', 'Assigned', 'Resolved', 'Dismissed')),
    is_demo INTEGER NOT NULL DEFAULT 0 CHECK (is_demo IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE TABLE IF NOT EXISTS work_orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    work_order_code TEXT NOT NULL UNIQUE,
    asset_id INTEGER NOT NULL REFERENCES railway_assets(id) ON DELETE CASCADE,
    fault_report_id INTEGER REFERENCES fault_reports(id) ON DELETE SET NULL,
    inspection_id INTEGER REFERENCES inspections(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    priority TEXT NOT NULL CHECK (priority IN ('Low', 'Medium', 'High', 'Critical')),
    status TEXT NOT NULL DEFAULT 'New'
        CHECK (status IN ('New', 'Assigned', 'In Progress', 'Waiting for Review', 'Completed')),
    assigned_to INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    due_date TEXT NOT NULL,
    maintenance_notes TEXT NOT NULL DEFAULT '',
    completion_notes TEXT NOT NULL DEFAULT '',
    completed_at TEXT,
    is_demo INTEGER NOT NULL DEFAULT 0 CHECK (is_demo IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE TABLE IF NOT EXISTS work_order_images (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    work_order_id INTEGER NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
    original_filename TEXT NOT NULL,
    stored_filename TEXT NOT NULL UNIQUE,
    mime_type TEXT NOT NULL CHECK (mime_type IN ('image/jpeg', 'image/png', 'image/webp')),
    file_size_bytes INTEGER NOT NULL CHECK (file_size_bytes > 0 AND file_size_bytes <= 5242880),
    sha256_hash TEXT NOT NULL,
    uploaded_by INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE TABLE IF NOT EXISTS maintenance_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    work_order_id INTEGER NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
    asset_id INTEGER NOT NULL REFERENCES railway_assets(id) ON DELETE CASCADE,
    performed_by INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    previous_status TEXT,
    new_status TEXT NOT NULL,
    action_summary TEXT NOT NULL,
    notes TEXT NOT NULL DEFAULT '',
    recorded_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'general',
    severity TEXT NOT NULL DEFAULT 'info' CHECK (severity IN ('info', 'warning', 'critical', 'success')),
    link_path TEXT NOT NULL DEFAULT '/',
    is_read INTEGER NOT NULL DEFAULT 0 CHECK (is_read IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE TABLE IF NOT EXISTS activity_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    actor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    actor_username TEXT NOT NULL,
    actor_role TEXT NOT NULL,
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    details TEXT NOT NULL DEFAULT '',
    ip_address TEXT NOT NULL DEFAULT 'unknown',
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_assets_category ON railway_assets(category_id);
CREATE INDEX IF NOT EXISTS idx_assets_condition ON railway_assets(current_condition);
CREATE INDEX IF NOT EXISTS idx_assets_status ON railway_assets(maintenance_status);
CREATE INDEX IF NOT EXISTS idx_assets_next_insp ON railway_assets(next_inspection_date);
CREATE INDEX IF NOT EXISTS idx_inspections_asset ON inspections(asset_id);
CREATE INDEX IF NOT EXISTS idx_inspections_status ON inspections(status);
CREATE INDEX IF NOT EXISTS idx_inspections_date ON inspections(inspection_date);
CREATE INDEX IF NOT EXISTS idx_faults_asset ON fault_reports(asset_id);
CREATE INDEX IF NOT EXISTS idx_faults_status ON fault_reports(status);
CREATE INDEX IF NOT EXISTS idx_work_orders_asset ON work_orders(asset_id);
CREATE INDEX IF NOT EXISTS idx_work_orders_status ON work_orders(status);
CREATE INDEX IF NOT EXISTS idx_work_orders_due ON work_orders(due_date);
CREATE INDEX IF NOT EXISTS idx_work_orders_assigned ON work_orders(assigned_to);
CREATE INDEX IF NOT EXISTS idx_maintenance_wo ON maintenance_records(work_order_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, is_read);
CREATE INDEX IF NOT EXISTS idx_activity_created ON activity_logs(created_at DESC);
