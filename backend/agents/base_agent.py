import os
import json
from datetime import datetime

from database import SessionLocal
from models import Task, ActivityLog, AgentMemory
from agents import mock

try:
    import anthropic
except Exception:  # pragma: no cover
    anthropic = None

try:
    from openai import OpenAI
except Exception:  # pragma: no cover
    OpenAI = None

ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "").strip()
NVIDIA_API_KEY = os.getenv("NVIDIA_API_KEY", "").strip()
NVIDIA_BASE_URL = os.getenv(
    "NVIDIA_BASE_URL", "https://integrate.api.nvidia.com/v1"
)
CLAUDE_MODEL = os.getenv("CLAUDE_MODEL", "claude-sonnet-4-20250514")
NVIDIA_MODEL = os.getenv("NVIDIA_MODEL", "meta/llama-3.3-70b-instruct")

# Provider selection: Anthropic (if key) > NVIDIA NIM (if key) > offline mock.
PROVIDER = "mock"
MODEL = None
_client = None

if ANTHROPIC_API_KEY and anthropic is not None:
    try:
        _client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
        PROVIDER = "anthropic"
        MODEL = CLAUDE_MODEL
    except Exception:
        PROVIDER = "mock"
elif NVIDIA_API_KEY and OpenAI is not None:
    try:
        _client = OpenAI(
            api_key=NVIDIA_API_KEY, base_url=NVIDIA_BASE_URL
        )
        PROVIDER = "nvidia"
        MODEL = NVIDIA_MODEL
    except Exception:
        PROVIDER = "mock"

USE_MOCK = PROVIDER == "mock"


class BaseAgent:
    def __init__(self, name: str, role: str):
        self.name = name
        self.role = role

    def get_memory(self) -> dict:
        db = SessionLocal()
        try:
            memories = (
                db.query(AgentMemory)
                .filter(AgentMemory.agent_name == self.name)
                .all()
            )
            return {m.memory_key: m.memory_value for m in memories}
        finally:
            db.close()

    def save_memory(self, key: str, value: str):
        db = SessionLocal()
        try:
            existing = (
                db.query(AgentMemory)
                .filter(
                    AgentMemory.agent_name == self.name,
                    AgentMemory.memory_key == key,
                )
                .first()
            )
            if existing:
                existing.memory_value = value
            else:
                db.add(
                    AgentMemory(
                        agent_name=self.name,
                        memory_key=key,
                        memory_value=value,
                    )
                )
            db.commit()
        finally:
            db.close()

    def log(self, task_id, action: str, detail: str = ""):
        db = SessionLocal()
        try:
            db.add(
                ActivityLog(
                    task_id=task_id,
                    agent_name=self.name,
                    action=action,
                    detail=detail,
                )
            )
            db.commit()
        finally:
            db.close()

    def update_task(self, task_id, **kwargs):
        db = SessionLocal()
        try:
            task = db.query(Task).filter(Task.id == task_id).first()
            if task:
                for key, value in kwargs.items():
                    setattr(task, key, value)
                task.updated_at = datetime.now()
                db.commit()
        finally:
            db.close()

    def create_subtask(
        self, title: str, description: str, assigned_to: str, parent_task_id
    ):
        db = SessionLocal()
        try:
            task = Task(
                title=title,
                description=description,
                status="BACKLOG",
                assigned_to=assigned_to,
                parent_task_id=parent_task_id,
            )
            db.add(task)
            db.commit()
            task_id = task.id
        finally:
            db.close()
        self.log(task_id, "TASK_CREATED", f"Created by {self.name}: {title}")
        return task_id

    def call_claude(self, system_prompt: str, user_message: str) -> str:
        memory = self.get_memory()
        memory_context = ""
        if memory:
            memory_context = (
                "\n\nYour memory from previous tasks:\n"
                f"{json.dumps(memory, indent=2)}"
            )

        if PROVIDER == "mock":
            return mock.respond(self.name, system_prompt, user_message, memory)

        full_system = system_prompt + memory_context

        if PROVIDER == "anthropic":
            response = _client.messages.create(
                model=MODEL,
                max_tokens=1000,
                system=full_system,
                messages=[{"role": "user", "content": user_message}],
            )
            return response.content[0].text

        # PROVIDER == "nvidia" — OpenAI-compatible chat completions.
        response = _client.chat.completions.create(
            model=MODEL,
            max_tokens=1000,
            temperature=0.2,
            messages=[
                {"role": "system", "content": full_system},
                {"role": "user", "content": user_message},
            ],
        )
        return response.choices[0].message.content
