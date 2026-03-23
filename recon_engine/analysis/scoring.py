"""Attack chain scoring and ranking system.

Scores chains based on:
- Exploit probability (confidence + severity)
- Severity escalation (does it reach critical capabilities?)
- Chain length (shorter is better)
- Reliability (fewer assumptions = higher score)
"""

from recon_engine.analysis.capability_model import (
    CRITICAL_CAPABILITIES,
    DEFAULT_INITIAL_CAPABILITIES,
)

# Scoring weights — tunable
CONFIDENCE_WEIGHT = 0.30
SEVERITY_WEIGHT = 0.25
IMPACT_WEIGHT = 0.25
LENGTH_PENALTY_WEIGHT = 0.10
RELIABILITY_WEIGHT = 0.10

SEVERITY_SCORES = {
    "critical": 1.0,
    "high": 0.8,
    "medium": 0.5,
    "low": 0.2,
    "info": 0.05,
    "neutral": 0.0,
}

# Impact labels based on final capabilities
IMPACT_LABELS = {
    "command_execution": "Remote Code Execution",
    "admin_access": "Administrative Access",
    "credential_data": "Credential Theft",
    "data_exfiltration": "Data Exfiltration",
    "persistence": "Persistent Access",
    "internal_network": "Internal Network Access",
    "lateral_movement": "Lateral Movement",
    "sql_execution": "Database Compromise",
    "privilege_escalation": "Privilege Escalation",
    "file_write": "Arbitrary File Write",
    "file_read": "Arbitrary File Read",
    "session_hijack": "Session Hijacking",
    "code_execution": "Code Execution",
    "config_data": "Configuration Disclosure",
    "authenticated_user": "Authentication Bypass",
}


def score_chain(chain, nodes_lookup):
    """Score an attack chain and set its score, impact, and confidence.

    Modifies chain in place.

    Args:
        chain: AttackChain instance
        nodes_lookup: dict of node_id -> node dict
    """
    if not chain.steps:
        chain.score = 0
        chain.impact = "None"
        chain.confidence = 0
        return

    # 1. Confidence score — geometric mean of step confidences
    confidences = [s.confidence for s in chain.steps if s.confidence > 0]
    if confidences:
        product = 1.0
        for c in confidences:
            product *= c
        confidence_score = product ** (1.0 / len(confidences))
    else:
        confidence_score = 0.1

    # 2. Severity score — max severity in chain
    max_severity = max(
        (SEVERITY_SCORES.get(s.severity, 0) for s in chain.steps),
        default=0,
    )

    # Bonus for severity escalation (chain progresses from low to high)
    severities = [SEVERITY_SCORES.get(s.severity, 0) for s in chain.steps]
    escalation_bonus = 0
    if len(severities) >= 2 and severities[-1] > severities[0]:
        escalation_bonus = 0.1

    severity_score = min(1.0, max_severity + escalation_bonus)

    # 3. Impact score — based on final capabilities gained
    gained = chain.final_capabilities - DEFAULT_INITIAL_CAPABILITIES
    critical_gained = gained & CRITICAL_CAPABILITIES

    if critical_gained:
        impact_score = min(1.0, 0.5 + len(critical_gained) * 0.15)
    elif gained:
        impact_score = min(0.5, len(gained) * 0.1)
    else:
        impact_score = 0.05

    # 4. Length penalty — shorter chains are more reliable
    length = len(chain.steps)
    if length <= 2:
        length_score = 1.0
    elif length <= 4:
        length_score = 0.8
    elif length <= 6:
        length_score = 0.6
    else:
        length_score = 0.4

    # 5. Reliability — fewer preconditions that depend on unlikely states
    vuln_steps = [s for s in chain.steps if s.node_type == "vulnerability"]
    if vuln_steps:
        avg_conf = sum(s.confidence for s in vuln_steps) / len(vuln_steps)
        reliability_score = avg_conf
    else:
        reliability_score = 0.3

    # Weighted total
    chain.score = (
        confidence_score * CONFIDENCE_WEIGHT +
        severity_score * SEVERITY_WEIGHT +
        impact_score * IMPACT_WEIGHT +
        length_score * LENGTH_PENALTY_WEIGHT +
        reliability_score * RELIABILITY_WEIGHT
    )

    # Set chain confidence (product of all step confidences)
    chain.confidence = 1.0
    for s in chain.steps:
        chain.confidence *= s.confidence
    chain.confidence = round(chain.confidence, 4)

    # Determine impact label
    chain.impact = _determine_impact(chain.final_capabilities)


def _determine_impact(capabilities):
    """Determine the highest-impact outcome from final capabilities."""
    # Check from most critical to least
    priority = [
        "command_execution", "admin_access", "credential_data",
        "data_exfiltration", "persistence", "internal_network",
        "lateral_movement", "sql_execution", "privilege_escalation",
        "file_write", "code_execution", "file_read",
        "session_hijack", "config_data", "authenticated_user",
    ]

    for cap in priority:
        if cap in capabilities:
            return IMPACT_LABELS.get(cap, cap)

    return "Access Gained"


def rank_chains(chains):
    """Sort chains by score, descending."""
    return sorted(chains, key=lambda c: c.score, reverse=True)
