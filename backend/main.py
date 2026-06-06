from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

load_dotenv()

from routers import tasks, applications, logs, memory  # noqa: E402
from database import engine  # noqa: E402
from models import Base  # noqa: E402

Base.metadata.create_all(bind=engine)

app = FastAPI(title="AgentOS — Candidate Screening & Outreach")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(tasks.router, prefix="/tasks", tags=["tasks"])
app.include_router(
    applications.router, prefix="/applications", tags=["applications"]
)
app.include_router(logs.router, prefix="/logs", tags=["logs"])
app.include_router(memory.router, prefix="/memory", tags=["memory"])


@app.get("/")
def health():
    return {"status": "ok", "service": "AgentOS — Candidate Screening & Outreach"}
