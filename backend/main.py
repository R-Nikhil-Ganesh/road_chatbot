import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from pathlib import Path

from backend.config import settings
from backend.database import run_query
from backend.agent import ask_agent

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

@app.get("/api/roads")
async def get_roads_endpoint():
    """Returns a list of all roads in the database with their metadata for map rendering."""
    sql = "SELECT road_name, contractor_name, allotted_budget_inr, amount_used_inr, overall_status, latitude, longitude FROM roads"
    roads = run_query(sql)
    if isinstance(roads, str):
        raise HTTPException(status_code=500, detail=f"Failed to fetch roads from DB: {roads}")
    return roads

# Mount static frontend files
FRONTEND_DIR = Path(__file__).resolve().parent.parent / "frontend"
if FRONTEND_DIR.exists():
    app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="static")
else:
    print(f"Warning: Frontend directory not found at {FRONTEND_DIR}. Server will run API only.")

if __name__ == "__main__":
    uvicorn.run("backend.main:app", host=settings.HOST, port=settings.PORT, reload=True)
