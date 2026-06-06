import json

from agents.base_agent import BaseAgent

BLOCKED_CHANNELS = [
    "ShareChat (geo-restricted from India)",
    "Xiaohongshu (requires Chinese account)",
    "Chinese job boards (no India access)",
]


class ChannelAgent(BaseAgent):
    def __init__(self):
        super().__init__("Channel Agent", "Distribution Strategy")

    def run(self, task_id, task_title: str, task_description: str):
        self.log(task_id, "STARTED", "Identifying distribution channels")
        self.update_task(task_id, status="IN_PROGRESS")

        memory = self.get_memory()
        local_contacts = memory.get("local_contacts", "none provided yet")

        # Check if we have China/Korea local contacts
        if "china_contact" not in memory and "korea_contact" not in memory \
                and "local_contacts" not in memory:
            self.update_task(
                task_id,
                status="BLOCKED",
                block_reason=(
                    "Cannot reach Chinese or Korean platforms from India. "
                    "Xiaohongshu, Chinese job boards, and Naver require "
                    "local accounts."
                ),
                block_question=(
                    "Do you have a local contact in China or South Korea "
                    "who could post on local platforms? If yes, provide "
                    "their name and what they can access."
                ),
            )
            self.log(
                task_id,
                "BLOCKED",
                "Waiting for local contact info for China/Korea",
            )
            return

        system_prompt = f"""You are a distribution strategy agent for a talent outreach campaign.
You find the best platforms, job boards, and communities to reach early-career job seekers and career switchers.
Known blocked channels (geo-restricted): {', '.join(BLOCKED_CHANNELS)}
Local contacts available: {local_contacts}

Identify the best channels to reach early-career job seekers and career switchers.
For each channel, specify what action is needed and who should do it.

Return ONLY valid JSON:
{{
  "channels": [
    {{
      "platform": "Platform name",
      "region": "Target region",
      "action": "What to do",
      "who": "human | agent | local_contact",
      "status": "ready | needs_local_contact | needs_account",
      "estimated_reach": "rough number"
    }}
  ],
  "blocked_channels": [
    {{
      "platform": "Platform",
      "reason": "Why blocked",
      "workaround": "Possible workaround"
    }}
  ]
}}"""

        result = self.call_claude(system_prompt, task_description or task_title)

        try:
            clean = result.strip().replace("```json", "").replace("```", "")
            data = json.loads(clean)

            output = "Channels ready:\n"
            for c in data["channels"]:
                output += (
                    f"• {c['platform']} ({c['region']}) — "
                    f"{c['action']} [{c['who']}]\n"
                )

            output += "\nBlocked channels:\n"
            for b in data.get("blocked_channels", []):
                output += (
                    f"• {b['platform']}: {b['reason']} "
                    f"→ {b['workaround']}\n"
                )

            self.update_task(
                task_id, status="WAITING_APPROVAL", output=output
            )
            self.log(
                task_id,
                "WAITING_APPROVAL",
                "Channel strategy ready for review",
            )

        except Exception as e:
            self.update_task(
                task_id,
                status="BLOCKED",
                block_reason=f"Error: {str(e)}",
                block_question="Please review manually",
            )
