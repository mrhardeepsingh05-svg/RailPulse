export type UserRole = 'admin' | 'inspector' | 'engineer' | 'staff';

export interface User {
  id: number;
  username: string;
  email: string;
  full_name: string;
  department: string;
  role: UserRole;
  role_display: string;
  is_demo: boolean;
  is_active?: number | boolean;
  created_at?: string;
}

export interface DemoAccountHint {
  username: string;
  role: UserRole;
  role_display: string;
  summary: string;
}

export interface AssetCategory {
  id: number;
  code: string;
  name: string;
  inspection_interval_days: number;
  description: string;
}

export type AssetCondition = 'Good' | 'Needs Attention' | 'Under Repair' | 'Critical Alert';
export type AssetOperationalStatus = 'Active' | 'Maintenance Scheduled' | 'Under Repair' | 'Out of Service';

export interface StoredImage {
  id: number;
  original_filename: string;
  stored_filename: string;
  mime_type: string;
  file_size_bytes: number;
  created_at: string;
}

export interface RailwayAsset {
  id: number;
  asset_code: string;
  name: string;
  category_id: number;
  category_code: string;
  category_name: string;
  inspection_interval_days?: number;
  section_location: string;
  description: string;
  installation_date: string | null;
  registration_date: string;
  last_inspection_date: string | null;
  next_inspection_date: string | null;
  current_condition: AssetCondition;
  maintenance_status: AssetOperationalStatus;
  latitude: number | null;
  longitude: number | null;
  coordinates_verified: number | boolean;
  assigned_engineer_id: number | null;
  assigned_engineer_name: string | null;
  inspection_count?: number;
  open_fault_count?: number;
  image_count?: number;
  is_demo: number | boolean;
  created_at: string;
  updated_at: string;
}

export interface Inspection {
  id: number;
  inspection_code: string;
  asset_id: number;
  asset_code: string;
  asset_name: string;
  section_location?: string;
  inspector_id: number;
  inspector_name: string;
  inspection_date: string;
  inspection_category: string;
  observed_conditions: string;
  status: 'Waiting for Review' | 'Approved' | 'Needs Follow-up';
  reviewer_id: number | null;
  reviewer_name: string | null;
  review_notes: string;
  reviewed_at: string | null;
  is_demo: number | boolean;
  images?: StoredImage[];
  created_at: string;
}

export interface FaultReport {
  id: number;
  fault_code: string;
  inspection_id: number | null;
  inspection_code?: string | null;
  asset_id: number;
  asset_code: string;
  asset_name: string;
  reported_by: number;
  reporter_name: string;
  category: string;
  severity: 'Low' | 'Medium' | 'High' | 'Critical';
  title: string;
  description: string;
  ai_analysis_json?: string | null;
  ai_confidence?: string;
  ai_mode: 'MANUAL' | 'DEMO_RULE_BASED' | 'LIVE_VISION_LLM';
  human_verified: number | boolean;
  verifier_name?: string | null;
  status: 'Open' | 'Assigned' | 'Resolved' | 'Dismissed';
  is_demo: number | boolean;
  created_at: string;
}

export interface AIAnalysisResult {
  mode: 'DEMO_RULE_BASED' | 'LIVE_VISION_LLM';
  is_demo_mode: boolean;
  label: string;
  model_used: string;
  ai_confidence: string;
  requires_human_verification: boolean;
  image_analyzed_by_vision_model: boolean;
  image_evidence: string;
  summary: string;
  suggested_category: string;
  suggested_priority: 'Low' | 'Medium' | 'High' | 'Critical';
  clearly_identifiable_observations: string[];
  possible_defects_requiring_verification: string[];
  uncertain_or_inconclusive: string[];
  recommended_follow_up_actions: string[];
  disclaimer: string;
}

export type WorkOrderStatus = 'New' | 'Assigned' | 'In Progress' | 'Waiting for Review' | 'Completed';
export type WorkOrderPriority = 'Low' | 'Medium' | 'High' | 'Critical';

export interface WorkOrder {
  id: number;
  work_order_code: string;
  asset_id: number;
  asset_code: string;
  asset_name: string;
  section_location?: string;
  fault_report_id: number | null;
  fault_code?: string | null;
  inspection_id: number | null;
  title: string;
  description: string;
  priority: WorkOrderPriority;
  status: WorkOrderStatus;
  assigned_to: number | null;
  assignee_name: string | null;
  created_by: number;
  creator_name?: string;
  due_date: string;
  maintenance_notes: string;
  completion_notes: string;
  completed_at: string | null;
  image_count?: number;
  is_demo: number | boolean;
  created_at: string;
}

export interface MaintenanceRecord {
  id: number;
  work_order_id: number;
  asset_id: number;
  performed_by_name: string;
  performed_by_username: string;
  previous_status: string | null;
  new_status: string;
  action_summary: string;
  notes: string;
  recorded_at: string;
}

export interface NotificationItem {
  id: number;
  title: string;
  message: string;
  category: string;
  severity: 'info' | 'warning' | 'critical' | 'success';
  link_path: string;
  is_read: number;
  created_at: string;
}

export interface DashboardSummary {
  kpis: {
    total_assets: number;
    demo_assets: number;
    real_assets: number;
    inspections_completed: number;
    inspections_waiting: number;
    inspections_followup: number;
    open_maintenance_tasks: number;
    completed_maintenance_tasks: number;
    waiting_review_tasks: number;
    overdue_maintenance_tasks: number;
    critical_alerts: number;
    assets_requiring_attention: number;
    maintenance_completion_pct: number;
  };
  asset_condition_overview: { condition: string; count: number }[];
  fault_category_chart: { category: string; count: number }[];
  upcoming_inspections: {
    id: number;
    asset_code: string;
    name: string;
    section_location: string;
    next_inspection_date: string;
    current_condition: AssetCondition;
    category_name: string;
    is_demo: number;
  }[];
  recent_activities: {
    id: number;
    actor_username: string;
    actor_role: string;
    action: string;
    entity_type: string;
    entity_id: string;
    details: string;
    created_at: string;
  }[];
  maintenance_progress: {
    total: number;
    completed: number;
    open: number;
    completion_pct: number;
  };
  data_provenance: {
    has_demo_records: boolean;
    label: string;
  };
}

export interface AnalyticsOverview {
  fault_distribution: { category: string; total: number; open_count: number }[];
  monthly_inspections: { month: string; total: number; approved: number; waiting: number; followup: number }[];
  maintenance_completion: {
    completion_rate_pct: number;
    open_tasks: number;
    completed_tasks: number;
    total_tasks: number;
    by_status: { status: string; count: number }[];
  };
  condition_trends: { category_name: string; good_count: number; attention_count: number; alert_count: number }[];
  inspection_history: {
    inspection_code: string;
    inspection_date: string;
    inspection_category: string;
    status: string;
    asset_code: string;
    asset_name: string;
    inspector_name: string;
    is_demo: number;
  }[];
}

export interface CalendarEvent {
  id: string;
  date: string;
  type: 'upcoming_inspection' | 'maintenance_deadline' | 'completed_activity' | 'maintenance_schedule';
  title: string;
  subtitle: string;
  status: string;
  link: string;
}

export interface GlobalSearchResults {
  assets: { id: number; asset_code: string; name: string; section_location: string; current_condition: string }[];
  inspections: { id: number; inspection_code: string; inspection_date: string; status: string; asset_code: string; asset_name: string }[];
  tasks: { id: number; work_order_code: string; title: string; status: string; priority: string; asset_code: string }[];
  team: { id: number; username: string; full_name: string; department: string; role_display: string }[];
  reports: { id: string; title: string; description: string }[];
}
