"""AI-Assisted Inspection & RAILY Assistant Service (Simple English + Honest Integrity)."""

from __future__ import annotations

import json
import re
from typing import Any

from api.config import settings


def is_live_ai_configured() -> bool:
    return bool(settings.GEMINI_API_KEY)


def _rule_based_triage(
    observed_conditions: str,
    inspection_category: str,
    has_image: bool,
    asset_context: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Transparent text check used ONLY when an external AI API key is not configured."""
    text = observed_conditions.lower()
    asset_label = f"{asset_context['asset_code']} ({asset_context['name']})" if asset_context else "Selected asset"

    rules = [
        {
            "keywords": ["crack", "fracture", "spall", "break", "split", "flaw"],
            "category": "Track or Structure Damage",
            "priority": "Critical",
            "possible": "Possible crack or structural damage mentioned in the notes.",
            "followup": "Have a qualified engineer inspect this spot up close before clearing the asset.",
        },
        {
            "keywords": ["moisture", "water", "leak", "rust", "wet", "seep", "condensation", "oxidation"],
            "category": "Water Leak or Rust",
            "priority": "High",
            "possible": "Possible water entry, wet seal, or rust described in the notes.",
            "followup": "Check door seals and cable covers, dry out moisture, and clean any rust.",
        },
        {
            "keywords": ["loose", "clip", "bolt", "vibration", "wear", "pad", "fastener", "step"],
            "category": "Track & Fasteners",
            "priority": "High",
            "possible": "Possible loose clips, bolts, or worn rail pads mentioned in the notes.",
            "followup": "Tighten fasteners, check track alignment, and schedule follow-up repair.",
        },
        {
            "keywords": ["gate", "barrier", "slow", "oil", "hydraulic", "motor", "signal"],
            "category": "Gate or Signal Mechanism",
            "priority": "High",
            "possible": "Possible slow gate movement, oil leak, or signal box issue noted.",
            "followup": "Test gate or signal timing and replace worn seals if needed.",
        },
    ]

    matched = [r for r in rules if any(k in text for k in r["keywords"])]

    clearly_identifiable = [
        f"Notes saved for {asset_label} under '{inspection_category}'.",
    ]
    if any(w in text for w in ["good", "clean", "intact", "smooth", "normal"]) and not matched:
        clearly_identifiable.append("Inspector notes describe normal or clean condition.")

    possible_defects = [r["possible"] for r in matched]
    if not possible_defects:
        possible_defects.append("No obvious problem words found in the notes. Please review manually.")

    uncertain_items = [
        "Text checks cannot measure exact size, depth, or hidden wear."
    ]
    if has_image:
        uncertain_items.insert(
            0,
            "Uploaded photos were NOT checked by image AI because no AI API key is connected. Please look at the photos yourself.",
        )

    priority_order = {"Critical": 4, "High": 3, "Medium": 2, "Low": 1}
    if matched:
        top_rule = max(matched, key=lambda r: priority_order[r["priority"]])
        suggested_category = top_rule["category"]
        suggested_priority = top_rule["priority"]
        followups = [r["followup"] for r in matched]
    else:
        suggested_category = "General Check"
        suggested_priority = "Low"
        followups = [
            "Look over the notes and photos manually.",
            "Keep the regular inspection schedule.",
        ]

    return {
        "mode": "DEMO_RULE_BASED",
        "is_demo_mode": True,
        "label": "Basic Text Check (AI Image Service Not Connected)",
        "model_used": "keyword-check-only",
        "ai_confidence": "Not applicable (text-only rule check)",
        "requires_human_verification": True,
        "image_analyzed_by_vision_model": False,
        "image_evidence": "Photos attached, awaiting manual review by an authorised team member." if has_image else "No photos uploaded.",
        "summary": (
            f"{asset_label}: Suggested category '{suggested_category}' ({suggested_priority} priority) "
            "based on words in your notes. Needs human review."
        ),
        "suggested_category": suggested_category,
        "suggested_priority": suggested_priority,
        "clearly_identifiable_observations": clearly_identifiable,
        "possible_defects_requiring_verification": possible_defects,
        "uncertain_or_inconclusive": uncertain_items,
        "recommended_follow_up_actions": followups,
        "disclaimer": (
            "AI image service is not connected (no API key). This helper only checked your written notes and "
            "did not read your photos. An authorised person must confirm all findings."
        ),
    }


def analyze_inspection_with_ai(
    *,
    observed_conditions: str,
    inspection_category: str,
    image_blobs: list[tuple[bytes, str]] | None = None,
    asset_context: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Run Gemini Vision analysis when configured, or honest text-only fallback."""
    image_blobs = image_blobs or []
    has_image = len(image_blobs) > 0

    if not settings.GEMINI_API_KEY:
        return _rule_based_triage(observed_conditions, inspection_category, has_image, asset_context)

    try:
        from google import genai
        from google.genai import types

        client = genai.Client(api_key=settings.GEMINI_API_KEY)
        asset_desc = (
            f"Asset: {asset_context['asset_code']} - {asset_context['name']}, "
            f"Type: {asset_context.get('category_name', '')}, Location: {asset_context.get('section_location', '')}."
            if asset_context
            else "Asset details not provided."
        )

        prompt = (
            "You help railway maintenance staff review inspection notes and photos using simple, clear English.\n"
            "RULES:\n"
            "1. Only describe clearly visible observations from the image or notes.\n"
            "2. Never claim an AI prediction is a confirmed engineering diagnosis.\n"
            "3. If no image is provided, say so clearly in uncertain_or_inconclusive.\n"
            "4. Return ONLY valid JSON with these keys:\n"
            "   summary (string),\n"
            "   suggested_category (string),\n"
            "   suggested_priority (Low, Medium, High, or Critical),\n"
            "   ai_confidence (string such as 'Medium (70%)' or 'Low - photo blurry'),\n"
            "   image_evidence (string summarizing what is visible in the photos),\n"
            "   clearly_identifiable_observations (array of strings),\n"
            "   possible_defects_requiring_verification (array of strings),\n"
            "   uncertain_or_inconclusive (array of strings),\n"
            "   recommended_follow_up_actions (array of strings).\n\n"
            f"Context: {asset_desc}\n"
            f"Check Type: {inspection_category}\n"
            f"Notes: {observed_conditions}\n"
        )

        contents: list[Any] = [prompt]
        for img_bytes, mime_type in image_blobs[:3]:
            contents.append(types.Part.from_bytes(data=img_bytes, mime_type=mime_type))

        response = client.models.generate_content(
            model=settings.GEMINI_MODEL,
            contents=contents,
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                temperature=0.2,
            ),
        )

        parsed = json.loads((response.text or "").strip())
        priority = parsed.get("suggested_priority", "Medium")
        if priority not in {"Low", "Medium", "High", "Critical"}:
            priority = "Medium"

        return {
            "mode": "LIVE_VISION_LLM",
            "is_demo_mode": False,
            "label": "AI Inspection Review (Needs Human Approval)",
            "model_used": settings.GEMINI_MODEL,
            "ai_confidence": str(parsed.get("ai_confidence", "Provided by AI (needs human check)")),
            "requires_human_verification": True,
            "image_analyzed_by_vision_model": has_image,
            "image_evidence": str(parsed.get("image_evidence", "Visible details checked from attached image(s)." if has_image else "No image attached.")),
            "summary": str(parsed.get("summary", "Inspection check finished.")),
            "suggested_category": str(parsed.get("suggested_category", inspection_category)),
            "suggested_priority": priority,
            "clearly_identifiable_observations": list(parsed.get("clearly_identifiable_observations", [])),
            "possible_defects_requiring_verification": list(parsed.get("possible_defects_requiring_verification", [])),
            "uncertain_or_inconclusive": list(parsed.get("uncertain_or_inconclusive", [])),
            "recommended_follow_up_actions": list(parsed.get("recommended_follow_up_actions", [])),
            "disclaimer": (
                "AI findings are suggestions only and are NOT a confirmed engineering diagnosis. "
                "An authorised person must review and approve them."
            ),
        }
    except Exception:
        fallback = _rule_based_triage(observed_conditions, inspection_category, has_image, asset_context)
        fallback["disclaimer"] = (
            "The live AI service could not be reached right now, so a basic text check was used instead. "
            "Photos were not analyzed by image AI."
        )
        return fallback


def generate_raily_reply(
    *,
    message: str,
    current_route: str,
    user_role: str,
    db_snapshot: dict[str, Any],
) -> dict[str, Any]:
    """Generate a friendly, simple-English RAILY response grounded in live database data."""
    msg = message.strip()
    lower = msg.lower()

    if settings.GEMINI_API_KEY:
        try:
            from google import genai
            from google.genai import types

            client = genai.Client(api_key=settings.GEMINI_API_KEY)
            system_instruction = (
                "You are Raily, a cute, helpful railway maintenance assistant in RailPulse AI. "
                "Use simple, natural English that any new railway employee can understand. "
                "ONLY quote numbers from the Live Project Data JSON. Never invent locations, inspections, or safety decisions. "
                "Keep replies short (2-4 sentences)."
            )
            prompt = (
                f"User Role: {user_role}\nCurrent Page: {current_route}\n"
                f"Live Project Data: {json.dumps(db_snapshot)}\n"
                f"User Question: {msg}"
            )
            resp = client.models.generate_content(
                model=settings.GEMINI_MODEL,
                contents=prompt,
                config=types.GenerateContentConfig(
                    system_instruction=system_instruction,
                    temperature=0.3,
                    max_output_tokens=260,
                ),
            )
            reply_text = (resp.text or "").strip()
            if reply_text:
                return {
                    "reply": reply_text,
                    "mode": "LIVE_LLM",
                    "ai_available": True,
                    "suggested_links": _suggest_links(lower),
                    "limitation_note": "Answered using connected AI and your saved database records.",
                }
        except Exception:
            return {
                "reply": (
                    "Sorry, the live AI service could not be reached right now. "
                    f"From your saved records: there are {db_snapshot['total_assets']} assets, "
                    f"{db_snapshot['inspections_waiting']} inspections waiting for review, and "
                    f"{db_snapshot['open_maintenance_tasks']} open maintenance tasks."
                ),
                "mode": "AI_UNAVAILABLE",
                "ai_available": False,
                "suggested_links": _suggest_links(lower),
                "limitation_note": "AI connection failed. Showing verified numbers from your database only.",
            }

    stats = db_snapshot
    if any(k in lower for k in ["hello", "hi", "hey", "who", "help", "welcome"]):
        reply = (
            f"Hi! I am Raily, your friendly railway helper. Right now your system has {stats['total_assets']} railway assets, "
            f"{stats['inspections_waiting']} inspections waiting for review, and {stats['open_maintenance_tasks']} open maintenance tasks. "
            "Ask me about dashboard numbers, inspection steps, maintenance tasks, or where to find any page!"
        )
    elif any(k in lower for k in ["summary", "status", "dashboard", "data", "today", "how many"]):
        reply = (
            f"Here is your live summary: {stats['total_assets']} assets total ({stats['assets_requiring_attention']} need attention, "
            f"{stats['critical_alerts']} critical alert), {stats['inspections_completed']} inspections completed, "
            f"{stats['inspections_waiting']} waiting for review, and {stats['open_maintenance_tasks']} open maintenance tasks."
        )
    elif any(k in lower for k in ["inspect", "photo", "ai", "result", "fault"]):
        reply = (
            "In Manage Inspections, pick an asset, upload clear photos, write what you see, and submit. "
            "AI checks help spot possible issues, but an authorised Inspector or Engineer must always review and confirm them."
        )
    elif any(k in lower for k in ["task", "repair", "maintenance", "work"]):
        reply = (
            "Maintenance tasks move through five simple steps: New -> Assigned -> In Progress -> Waiting for Review -> Completed. "
            f"Right now {stats['open_maintenance_tasks']} tasks are open and {stats['waiting_review_tasks']} are waiting for review."
        )
    elif any(k in lower for k in ["map", "calendar", "report", "analytics", "team", "search"]):
        reply = (
            "You can open Asset Map to see verified asset locations, Schedule Calendar for upcoming checks and deadlines, "
            "Analytics & Trends for charts, Reports for PDF downloads, or use the top search bar to find anything fast."
        )
    else:
        reply = (
            f"Your saved project records currently track {stats['total_assets']} assets and {stats['open_maintenance_tasks']} open maintenance tasks. "
            "Try asking me for a 'project summary', 'how inspections work', or 'maintenance task steps'."
        )

    return {
        "reply": re.sub(r"\s+", " ", reply).strip(),
        "mode": "GUIDED_NO_API_KEY",
        "ai_available": False,
        "suggested_links": _suggest_links(lower),
        "limitation_note": (
            "AI service is not connected (no GEMINI_API_KEY set). Raily is showing Guided Help using your live database records."
        ),
    }


def _suggest_links(lower_query: str) -> list[dict[str, str]]:
    links: list[dict[str, str]] = []
    if any(k in lower_query for k in ["asset", "track", "bridge", "signal"]):
        links.append({"label": "Open Railway Assets", "path": "/assets"})
    if any(k in lower_query for k in ["inspect", "photo", "fault", "ai"]):
        links.append({"label": "Manage Inspections", "path": "/inspections"})
    if any(k in lower_query for k in ["task", "repair", "maintenance"]):
        links.append({"label": "Open Maintenance Tasks", "path": "/maintenance"})
    if any(k in lower_query for k in ["map", "location", "gps"]):
        links.append({"label": "Open Asset Map", "path": "/map"})
    if any(k in lower_query for k in ["calendar", "upcoming", "schedule"]):
        links.append({"label": "Open Schedule Calendar", "path": "/calendar"})
    if any(k in lower_query for k in ["report", "pdf", "download"]):
        links.append({"label": "Open Reports", "path": "/reports"})
    if any(k in lower_query for k in ["analytic", "trend", "chart"]):
        links.append({"label": "Open Analytics", "path": "/analytics"})
    if any(k in lower_query for k in ["predict", "risk", "overdue", "repeat", "watch", "early"]):
        links.append({"label": "Open Predictive Maintenance", "path": "/predictive"})
    if not links:
        links.append({"label": "Go to Dashboard", "path": "/"})
    return links[:3]
