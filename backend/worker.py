import time

from dotenv import load_dotenv

load_dotenv()

from database import SessionLocal  # noqa: E402
from models import Task
from agents.screening_agent import ScreeningAgent
from agents.outreach_agent import OutreachAgent
from agents.channel_agent import ChannelAgent
from agents.base_agent import PROVIDER, MODEL

AGENT_MAP = {
    "agent_screening": ScreeningAgent(),
    "agent_outreach": OutreachAgent(),
    "agent_channel": ChannelAgent(),
}


def process_task(task):
    agent = AGENT_MAP.get(task.assigned_to)
    if not agent:
        return

    print(f"[Worker] {task.title} → {task.assigned_to}")

    try:
        if task.assigned_to == "agent_screening":
            # Description holds the application_id
            agent.screen_application(task.id, task.description)
        else:
            agent.run(task.id, task.title, task.description or "")
    except Exception as e:
        # Never leave a task stuck IN_PROGRESS if the model call fails/times out.
        print(f"[Worker] task {task.id} failed: {e}")
        agent.update_task(
            task.id,
            status="BLOCKED",
            block_reason=f"Model call failed: {e}",
            block_question="Retry, or handle this one manually.",
        )


def handle_approved_channel_tasks():
    """When human provides a local contact, save to memory and retry."""
    db = SessionLocal()
    approved = (
        db.query(Task)
        .filter(
            Task.status == "APPROVED",
            Task.assigned_to == "agent_channel",
            Task.human_response.isnot(None),
        )
        .all()
    )
    rows = [(t.id, t.human_response) for t in approved]
    db.close()

    for task_id, human_response in rows:
        agent = ChannelAgent()
        agent.save_memory("local_contacts", human_response)
        agent.log(
            task_id,
            "RESUMED",
            f"Human provided contacts: {human_response}",
        )
        agent.update_task(task_id, status="BACKLOG", human_response=None)


def run_worker():
    if PROVIDER == "mock":
        mode = "MOCK (no API key set)"
    else:
        mode = f"LIVE {PROVIDER} ({MODEL})"
    print(f"[Worker] Polling... mode={mode}")
    while True:
        try:
            db = SessionLocal()
            tasks = (
                db.query(Task)
                .filter(
                    Task.status == "BACKLOG",
                    Task.assigned_to != "human",
                )
                .all()
            )
            # Detach: read needed attrs before closing
            pending = list(tasks)
            db.expunge_all()
            db.close()

            for task in pending:
                process_task(task)

            handle_approved_channel_tasks()
        except Exception as e:
            print(f"[Worker] error: {e}")
        time.sleep(3)


if __name__ == "__main__":
    run_worker()
