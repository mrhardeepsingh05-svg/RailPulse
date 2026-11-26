"""Pydantic v2 request and response validation schemas for RAILPULSE AI."""

from __future__ import annotations

from typing import Literal, Optional
from pydantic import BaseModel, Field, field_validator


RoleName = Literal["admin", "inspector", "engineer", "staff"]
AssetCondition = Literal["Good", "Needs Attention", "Under Repair", "Critical Alert"]
AssetOperationalStatus = Literal["Active", "Maintenance Scheduled", "Under Repair", "Out of Service"]
InspectionCategory = Literal[
    "Routine Check",
    "Track & Structure Check",
    "Signal Check",
    "Safety & Crossing Check",
    "Urgent Check",
]
InspectionStatus = Literal["Waiting for Review", "Approved", "Needs Follow-up"]
FaultSeverity = Literal["Low", "Medium", "High", "Critical"]
FaultStatus = Literal["Open", "Assigned", "Resolved", "Dismissed"]
WorkOrderPriority = Literal["Low", "Medium", "High", "Critical"]
WorkOrderStatus = Literal["New", "Assigned", "In Progress", "Waiting for Review", "Completed"]


class LoginRequest(BaseModel):
    username: str = Field(min_length=3, max_length=64)
    password: str = Field(min_length=6, max_length=128)


class UserCreateRequest(BaseModel):
    username: str = Field(min_length=3, max_length=40, pattern=r"^[a-zA-Z0-9._-]+$")
    email: str = Field(min_length=5, max_length=120, pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
    full_name: str = Field(min_length=2, max_length=80)
    password: str = Field(min_length=8, max_length=128)
    role: RoleName
    department: str = Field(min_length=2, max_length=80)


class UserUpdateRequest(BaseModel):
    role: Optional[RoleName] = None
    department: Optional[str] = Field(default=None, min_length=2, max_length=80)
    is_active: Optional[bool] = None


class CategoryCreateRequest(BaseModel):
    code: str = Field(min_length=2, max_length=10, pattern=r"^[A-Z0-9_-]+$")
    name: str = Field(min_length=2, max_length=80)
    inspection_interval_days: int = Field(ge=1, le=3650)
    description: str = Field(default="", max_length=300)


class AssetCreateRequest(BaseModel):
    asset_code: Optional[str] = Field(default=None, min_length=3, max_length=32, pattern=r"^[A-Z0-9-]+$")
    name: str = Field(min_length=3, max_length=120)
    category_id: int = Field(ge=1)
    section_location: str = Field(min_length=3, max_length=120)
    description: str = Field(default="", max_length=1000)
    installation_date: Optional[str] = Field(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$")
    registration_date: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    next_inspection_date: Optional[str] = Field(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$")
    current_condition: AssetCondition = "Good"
    maintenance_status: AssetOperationalStatus = "Active"
    latitude: Optional[float] = Field(default=None, ge=-90.0, le=90.0)
    longitude: Optional[float] = Field(default=None, ge=-180.0, le=180.0)
    coordinates_verified: bool = False
    assigned_engineer_id: Optional[int] = Field(default=None, ge=1)


class AssetUpdateRequest(BaseModel):
    name: Optional[str] = Field(default=None, min_length=3, max_length=120)
    category_id: Optional[int] = Field(default=None, ge=1)
    section_location: Optional[str] = Field(default=None, min_length=3, max_length=120)
    description: Optional[str] = Field(default=None, max_length=1000)
    installation_date: Optional[str] = Field(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$")
    next_inspection_date: Optional[str] = Field(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$")
    current_condition: Optional[AssetCondition] = None
    maintenance_status: Optional[AssetOperationalStatus] = None
    latitude: Optional[float] = Field(default=None, ge=-90.0, le=90.0)
    longitude: Optional[float] = Field(default=None, ge=-180.0, le=180.0)
    coordinates_verified: Optional[bool] = None
    assigned_engineer_id: Optional[int] = Field(default=None, ge=1)


class InspectionReviewRequest(BaseModel):
    status: Literal["Approved", "Needs Follow-up"]
    review_notes: str = Field(default="", max_length=1000)


class FaultCreateRequest(BaseModel):
    asset_id: int = Field(ge=1)
    inspection_id: Optional[int] = Field(default=None, ge=1)
    category: str = Field(min_length=2, max_length=80)
    severity: FaultSeverity
    title: str = Field(min_length=3, max_length=140)
    description: str = Field(min_length=5, max_length=2000)
    ai_analysis_json: Optional[str] = None
    ai_confidence: str = Field(default="", max_length=60)
    ai_mode: Literal["MANUAL", "DEMO_RULE_BASED", "LIVE_VISION_LLM"] = "MANUAL"
    human_verified: bool = False


class FaultVerifyRequest(BaseModel):
    human_verified: bool
    severity: Optional[FaultSeverity] = None
    category: Optional[str] = Field(default=None, min_length=2, max_length=80)
    status: Optional[FaultStatus] = None


class WorkOrderCreateRequest(BaseModel):
    asset_id: int = Field(ge=1)
    fault_report_id: Optional[int] = Field(default=None, ge=1)
    inspection_id: Optional[int] = Field(default=None, ge=1)
    title: str = Field(min_length=3, max_length=140)
    description: str = Field(min_length=5, max_length=2000)
    priority: WorkOrderPriority
    assigned_to: Optional[int] = Field(default=None, ge=1)
    due_date: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")

    @field_validator("title", "description")
    @classmethod
    def strip_text(cls, v: str) -> str:
        return v.strip()


class WorkOrderUpdateRequest(BaseModel):
    status: Optional[WorkOrderStatus] = None
    assigned_to: Optional[int] = Field(default=None, ge=1)
    priority: Optional[WorkOrderPriority] = None
    due_date: Optional[str] = Field(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$")
    maintenance_notes: Optional[str] = Field(default=None, max_length=2000)
    completion_notes: Optional[str] = Field(default=None, max_length=2000)
    action_summary: Optional[str] = Field(default=None, max_length=200)


class RailyChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=600)
    current_route: str = Field(default="/", max_length=100)
