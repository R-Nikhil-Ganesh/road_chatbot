import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from pathlib import Path

from backend.config import settings
from backend.database import run_query, conn
from backend.agent import ask_agent
import datetime

# Initialize FastAPI app
app = FastAPI(
    title="Chennai RoadWatch AI",
    description="Citizen portal prototype to query and view road infrastructure audits.",
    version="1.0.0"
)

# Enable CORS for local development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Request schema for chat
class ChatMessage(BaseModel):
    role: str
    content: str

class ChatRequest(BaseModel):
    message: str | None = None
    messages: list[ChatMessage] | None = None

# Request schema for complaints
class ComplaintCreate(BaseModel):
    road_name: str
    contractor_name: str
    category: str
    severity: str
    description: str

def resolve_routing(road_name: str, category: str) -> dict:
    """Dynamic routing engine that assigns complaints to departments and officers
    based on the complaint category. Checks blacklist status of contractor for PWD escalation
    and drafts an official complaint letter.
    """
    cursor = conn.cursor()
    
    # 1. Find road and contractor (supporting phonetic normalizations)
    cursor.execute("""
        SELECT contractor_name, road_name 
        FROM roads 
        WHERE NORMALIZE_SPELLING(road_name) = NORMALIZE_SPELLING(?) 
           OR road_name = ?
    """, (road_name, road_name))
    res_road = cursor.fetchone()
    if not res_road:
        raise HTTPException(status_code=404, detail=f"Road '{road_name}' not found.")
        
    contractor = res_road[0]
    actual_road_name = res_road[1]
    
    # 2. Check if contractor is blacklisted
    cursor.execute("""
        SELECT blacklist_status 
        FROM contractors 
        WHERE NORMALIZE_SPELLING(contractor_name) = NORMALIZE_SPELLING(?) 
           OR contractor_name = ?
    """, (contractor, contractor))
    res_contractor = cursor.fetchone()
    is_blacklisted = res_contractor and res_contractor[0] == "Blacklisted"
    blacklist_status = res_contractor[0] if res_contractor else "Active - Clean Record"
    
    # 3. Determine routing values based on category
    dept = "General Road Works Cell, GCC"
    officer = "Dr. K. Ravichandran, Chief Engineer (General)"
    email = "gcc.roads@tn.gov.in"
    status = "Routed & Assigned"
    
    if category == "Potholes & Damaged Surface":
        dept = "Road Infrastructure Division, GCC"
        officer = "Dr. K. Ravichandran, Chief Engineer (General)"
        email = "gcc.roads@tn.gov.in"
    elif category == "Drainage & Waterlogging":
        dept = "Stormwater Drain Department, Greater Chennai Corporation (GCC)"
        officer = "Dr. K. Ravichandran, Chief Engineer (General)"
        email = "gcc.drainage@tn.gov.in"
    elif category == "Substandard Material Usage":
        dept = "Quality Assurance Cell, Public Works Department (PWD), Tamil Nadu"
        officer = "Er. S. Anbarasan, Superintending Engineer (Highways)"
        email = "pwd.qa@tn.gov.in"
    elif category == "Delay in Completion":
        dept = "Project Monitoring Unit, CMDA"
        officer = "Thiru. M. Vadivelu, Member Secretary"
        email = "cmda.projects@tn.gov.in"
    elif category == "Safety Norm Violations":
        dept = "Directorate of Industrial Safety, Government of Tamil Nadu"
        officer = "Thiru. S. Kumaran, Chief Inspector of Safety"
        email = "safety.inspector@tn.gov.in"
    elif category == "Billing Discrepancy & Corruption":
        dept = "Directorate of Vigilance and Anti-Corruption (DVAC), Tamil Nadu"
        officer = "Thiru. A. Ponnuvel, Deputy Superintendent of Police"
        email = "dvac.complaints@tn.gov.in"
        status = "Investigation Initiated"
        
    # Blacklist escalation override
    if is_blacklisted:
        dept = "Special Investigation Cell, PWD Tamil Nadu"
        officer = "Er. S. Anbarasan, Superintending Engineer (Special Audits)"
        email = "pwd.specialcell@tn.gov.in"
        status = "Escalated - Blacklist Alert"
        
    # 4. Generate draft grievance email letter
    subject = f"Official Grievance: Poor Road Condition at {actual_road_name} ({category})"
    
    if is_blacklisted:
        blacklist_clause = (
            f"Please note that the contractor responsible, {contractor}, is currently BLACKLISTED by the government. "
            f"Accordingly, this matter demands immediate audit intervention and contract compliance review by the Special Investigation Cell."
        )
    else:
        blacklist_clause = f"The contractor assigned to this road is {contractor}."
        
    body = (
        f"Dear {officer},\n\n"
        f"I am writing to draw your urgent attention to a serious infrastructure issue at {actual_road_name}.\n\n"
        f"Issue Category: {category}\n"
        f"{blacklist_clause}\n\n"
        f"Grievance Description:\n[Provide specific landmarks, impact on local traffic, and photos/videos if available]\n\n"
        f"This road infrastructure constitutes a vital public asset. Under the citizen audit portal, I request "
        f"an immediate inspection of the site by your office and formal action to hold the contractor accountable.\n\n"
        f"Kindly confirm the receipt of this email and provide the estimated completion date for resolution.\n\n"
        f"Sincerely,\n"
        f"[Your Name]\n"
        f"[Your Contact Details]"
    )
    
    return {
        "road_name": actual_road_name,
        "contractor_name": contractor,
        "category": category,
        "blacklist_status": blacklist_status,
        "is_blacklisted": is_blacklisted,
        "routed_department": dept,
        "routing_officer": officer,
        "contact_email": email,
        "status": status,
        "subject": subject,
        "draft_letter": body
    }

def route_complaint(complaint: ComplaintCreate) -> dict:
    """Dynamic routing engine that assigns complaints to departments and officers,
    saves the ticket, and returns metadata.
    """
    routing = resolve_routing(complaint.road_name, complaint.category)
    
    cursor = conn.cursor()
    cursor.execute("SELECT COUNT(*) FROM complaints")
    count = cursor.fetchone()[0]
    ticket_id = f"COMP-2026-{1000 + count + 1}"
    
    now_str = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    
    # Save complaint to database
    cursor.execute("""
    INSERT INTO complaints (
        complaint_id, road_name, contractor_name, category, severity,
        description, status, routed_department, routing_officer,
        contact_email, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        ticket_id, routing["road_name"], routing["contractor_name"], routing["category"], complaint.severity,
        complaint.description, routing["status"], routing["routed_department"], routing["routing_officer"],
        routing["contact_email"], now_str
    ))
    conn.commit()
    
    return {
        "complaint_id": ticket_id,
        "road_name": routing["road_name"],
        "contractor_name": routing["contractor_name"],
        "category": routing["category"],
        "severity": complaint.severity,
        "description": complaint.description,
        "status": routing["status"],
        "routed_department": routing["routed_department"],
        "routing_officer": routing["routing_officer"],
        "contact_email": routing["contact_email"],
        "created_at": now_str,
        "blacklist_alert": routing["is_blacklisted"],
        "subject": routing["subject"],
        "draft_letter": routing["draft_letter"]
    }


# Endpoints
@app.post("/api/chat")
async def chat_endpoint(request: ChatRequest):
    """Exposes the AI Agent chat loop, supporting both stateless and stateful payloads."""
    if request.messages:
        history = [{"role": msg.role, "content": msg.content} for msg in request.messages]
    elif request.message:
        history = [{"role": "user", "content": request.message}]
    else:
        raise HTTPException(status_code=400, detail="Either 'message' or 'messages' must be provided.")
        
    result = ask_agent(history)
    return result

@app.get("/api/routing-lookup")
async def routing_lookup_endpoint(road_name: str, category: str):
    """Retrieves routing information and draft letter without filing a ticket."""
    if not road_name or not category:
        raise HTTPException(status_code=400, detail="road_name and category parameters are required.")
    try:
        routing = resolve_routing(road_name, category)
        return routing
    except HTTPException as he:
        raise he
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to resolve routing: {str(e)}")

@app.get("/api/roads")
async def get_roads_endpoint():
    """Returns a list of all roads in the database with their metadata for map rendering."""
    sql = "SELECT road_name, contractor_name, allotted_budget_inr, amount_used_inr, overall_status, latitude, longitude FROM roads"
    roads = run_query(sql)
    if isinstance(roads, str):
        raise HTTPException(status_code=500, detail=f"Failed to fetch roads from DB: {roads}")
    return roads

@app.post("/api/complaints")
async def create_complaint_endpoint(complaint: ComplaintCreate):
    """Files a citizen complaint, routes it dynamically to the responsible agency,
    cross-checks contractor blacklist status, and records it in SQLite.
    """
    if not complaint.road_name.strip() or not complaint.description.strip():
        raise HTTPException(status_code=400, detail="Road name and description are required.")
    
    try:
        routed_ticket = route_complaint(complaint)
        return routed_ticket
    except HTTPException as he:
        raise he
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to route complaint: {str(e)}")

@app.get("/api/complaints")
async def list_complaints_endpoint():
    """Returns all filed complaints sorted by creation time descending."""
    sql = "SELECT * FROM complaints ORDER BY created_at DESC"
    complaints = run_query(sql)
    if isinstance(complaints, str):
        raise HTTPException(status_code=500, detail=f"Failed to list complaints: {complaints}")
    return complaints

# Mount static frontend files
FRONTEND_DIR = Path(__file__).resolve().parent.parent / "frontend"
if FRONTEND_DIR.exists():
    app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="static")
else:
    print(f"Warning: Frontend directory not found at {FRONTEND_DIR}. Server will run API only.")

if __name__ == "__main__":
    uvicorn.run("backend.main:app", host=settings.HOST, port=settings.PORT, reload=True)
