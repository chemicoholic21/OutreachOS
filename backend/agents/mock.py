"""Offline fallback that mimics an LLM's JSON responses.

Used when no provider API key is set so the full coordination loop
(screening, outreach, channel blocking, memory, approvals) can be demoed
end-to-end without network access. Returns the exact JSON shapes each
agent's parser expects.
"""
import json
import re


def _extract_name(user_message: str) -> str:
    m = re.search(r"Applicant:\s*(.+)", user_message)
    return m.group(1).strip() if m else "the applicant"


def _screen(user_message: str, memory: dict) -> str:
    text = user_message.lower()
    name = _extract_name(user_message)

    build_signals = any(
        w in text
        for w in [
            "built", "building", "project", "side project", "made",
            "created", "shipped", "hackathon", "github", "prototype",
        ]
    )
    learn_signals = any(
        w in text
        for w in [
            "learn", "passion", "curious", "career change", "switch career",
            "transition", "motivated", "teach", "community", "mentor",
        ]
    )
    reject_signals = any(
        w in text
        for w in [
            "found a startup", "founding a startup", "start a company",
            "raise funding", "my existing job better", "do my job better",
        ]
    )

    if reject_signals and not (build_signals and learn_signals):
        decision, score = "REJECT", 3
        reasoning = (
            f"{name}'s primary motivation is founding a startup rather than "
            "seeking a role or making a genuine career switch."
        )
        signals = ["startup-first motivation", "not actively job-seeking"]
        rejection_reason = "startup-founding motivation"
    elif build_signals and learn_signals:
        decision, score = "APPROVE", 9
        reasoning = (
            f"{name} has been building hands-on projects and shows strong "
            "motivation to learn and grow into a new career."
        )
        signals = ["hands-on builder", "strong learning motivation"]
        rejection_reason = "no hands-on building"
    elif build_signals or learn_signals:
        decision, score = "MAYBE", 6
        reasoning = (
            f"{name} shows some positive signals but motivation or hands-on "
            "experience is unclear — worth a human look."
        )
        signals = ["mixed signals", "unclear depth of motivation"]
        rejection_reason = "no hands-on building"
    else:
        decision, score = "REJECT", 2
        reasoning = (
            f"{name} shows no expressed motivation, passion, or evidence of "
            "having built anything."
        )
        signals = ["no motivation expressed", "no initiative shown"]
        rejection_reason = "no expressed motivation"

    total = int(memory.get("total_screened", "0") or "0") + 1
    return json.dumps(
        {
            "decision": decision,
            "score": score,
            "reasoning": reasoning,
            "key_signals": signals,
            "memory_updates": {
                "total_screened": str(total),
                "common_rejection_reason": rejection_reason,
            },
        }
    )


def _outreach(memory: dict) -> str:
    template = memory.get(
        "proven_template",
        "Hey {name}, if you are still in touch with early-career folks or "
        "people looking to switch careers, could you share this opportunity "
        "with them? {link}",
    )
    return json.dumps(
        {
            "messages": [
                {
                    "profile_type": "University career-services coordinator",
                    "platform": "LinkedIn",
                    "message": (
                        "Hey [Name], I work with early-career job seekers and "
                        "career switchers looking for their next role. If any "
                        "of your students or recent grads are on the hunt, "
                        "would you mind passing this along? [link]"
                    ),
                    "why_this_works": (
                        "Career-services staff are trusted hubs to job seekers."
                    ),
                },
                {
                    "profile_type": "Senior engineer / hiring manager",
                    "platform": "LinkedIn",
                    "message": (
                        "Hey [Name], if you're still in touch with juniors "
                        "trying to break in or switch fields, we're helping "
                        "connect motivated candidates to opportunities. Could "
                        "you share it with anyone who'd be a fit? [link]"
                    ),
                    "why_this_works": (
                        "Hiring managers know exactly who's a strong fit."
                    ),
                },
                {
                    "profile_type": "Community organizer / meetup host",
                    "platform": "LinkedIn DM or WhatsApp",
                    "message": (
                        "Hi [Name]! Your community is full of people we'd love "
                        "to reach — early-career folks and career switchers "
                        "looking for their next role. Mind dropping this in "
                        "your group? [link]"
                    ),
                    "why_this_works": (
                        "Organizers broadcast to large, relevant audiences."
                    ),
                },
            ],
            "memory_updates": {"proven_template": template},
        }
    )


def _channel(memory: dict) -> str:
    contacts = memory.get("local_contacts", "none provided yet")
    return json.dumps(
        {
            "channels": [
                {
                    "platform": "LinkedIn (job-seeker & early-career groups)",
                    "region": "Global",
                    "action": "Post in early-career and career-switch groups",
                    "who": "agent",
                    "status": "ready",
                    "estimated_reach": "5000+",
                },
                {
                    "platform": "University career portals & alumni groups",
                    "region": "Global",
                    "action": "Share via career-services connector contacts",
                    "who": "local_contact",
                    "status": "ready",
                    "estimated_reach": "1500",
                },
                {
                    "platform": "Regional job boards & dev communities",
                    "region": "Localized",
                    "action": f"Local contact to post ({contacts})",
                    "who": "local_contact",
                    "status": "ready",
                    "estimated_reach": "2000",
                },
            ],
            "blocked_channels": [
                {
                    "platform": "Xiaohongshu",
                    "reason": "Requires a Chinese account, geo-restricted",
                    "workaround": "Have the China local contact post natively",
                },
                {
                    "platform": "Chinese job boards",
                    "reason": "No access from India",
                    "workaround": "Route through local contact",
                },
            ],
        }
    )


def respond(agent_name: str, system_prompt: str, user_message: str, memory: dict) -> str:
    name = agent_name.lower()
    if "screen" in name:
        return _screen(user_message, memory)
    if "outreach" in name:
        return _outreach(memory)
    if "channel" in name:
        return _channel(memory)
    return json.dumps({"note": "no mock handler"})
