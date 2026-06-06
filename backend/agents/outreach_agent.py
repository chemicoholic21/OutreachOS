import json

from agents.base_agent import BaseAgent


class OutreachAgent(BaseAgent):
    def __init__(self):
        super().__init__("Outreach Agent", "Message Personalizer")

    def run(self, task_id, task_title: str, task_description: str):
        self.log(task_id, "STARTED", "Generating outreach messages")
        self.update_task(task_id, status="IN_PROGRESS")

        memory = self.get_memory()
        proven_template = memory.get(
            "proven_template",
            "Hey {name}, if you are still in touch with early-career folks or "
            "people looking to switch careers, could you share this "
            "opportunity with them? {link}",
        )

        system_prompt = f"""You are an outreach agent for a talent program that connects early-career job seekers and career switchers to opportunities.
Target: well-connected professionals — recruiters, hiring managers, university career staff, community organizers — who can amplify to their networks.
NOT direct candidates — connectors who know job seekers and junior talent.

Proven message template that worked:
{proven_template}

Generate 3 personalized outreach messages for different connector profiles.
Each message should feel personal, not templated.

Return ONLY valid JSON:
{{
  "messages": [
    {{
      "profile_type": "University career-services coordinator",
      "platform": "LinkedIn",
      "message": "Hey [Name], ...",
      "why_this_works": "One sentence"
    }},
    {{
      "profile_type": "Senior engineer / hiring manager",
      "platform": "LinkedIn",
      "message": "Hey [Name], ...",
      "why_this_works": "One sentence"
    }},
    {{
      "profile_type": "Community organizer / meetup host",
      "platform": "LinkedIn DM or WhatsApp",
      "message": "Hey [Name], ...",
      "why_this_works": "One sentence"
    }}
  ],
  "memory_updates": {{
    "proven_template": "best performing template from this batch"
  }}
}}"""

        result = self.call_claude(system_prompt, task_description or task_title)

        try:
            clean = result.strip().replace("```json", "").replace("```", "")
            data = json.loads(clean)

            for key, value in data.get("memory_updates", {}).items():
                self.save_memory(key, value)

            output = ""
            for m in data["messages"]:
                output += (
                    f"[{m['profile_type']} — {m['platform']}]\n"
                    f"{m['message']}\n"
                    f"Why: {m['why_this_works']}\n\n"
                )

            self.update_task(
                task_id, status="WAITING_APPROVAL", output=output
            )
            self.log(
                task_id,
                "WAITING_APPROVAL",
                "Outreach messages ready for review",
            )

        except Exception as e:
            self.update_task(
                task_id,
                status="BLOCKED",
                block_reason=f"Error: {str(e)}",
                block_question="Please review manually",
            )
