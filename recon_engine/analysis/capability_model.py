"""Capability-based model for attack chain reasoning.

Defines what capabilities exist, what nodes require, and what they grant.
This is the semantic layer that makes chain traversal meaningful.
"""

from dataclasses import dataclass, field


# ---- Well-known capabilities ----
# These are the standard capabilities the system reasons about.
# The AI engine can produce any string, but these are the ones
# the scoring system understands natively.

CAPABILITIES = {
    # Access levels
    "network_access": "Can reach the target network",
    "http_access": "Can make HTTP/HTTPS requests to the target",
    "dns_access": "Can resolve DNS names",
    "ftp_access": "Can connect via FTP",
    "ssh_access": "Can connect via SSH",
    "smtp_access": "Can connect via SMTP",
    "database_access": "Can connect to database services",

    # Authentication states
    "authenticated_user": "Has valid user-level credentials",
    "admin_access": "Has administrative privileges",
    "api_key": "Has a valid API key or token",

    # File system
    "file_read": "Can read files on the target",
    "file_write": "Can write files on the target",
    "file_upload": "Can upload files to the target",

    # Execution
    "command_execution": "Can execute OS commands (RCE)",
    "code_execution": "Can execute code in application context",
    "sql_execution": "Can execute SQL queries",

    # Information
    "source_code": "Has access to application source",
    "config_data": "Has access to configuration data",
    "credential_data": "Has access to stored credentials",
    "user_data": "Has access to user/customer data",
    "internal_network": "Has access to internal network",

    # Specific attack outcomes
    "session_hijack": "Can hijack user sessions",
    "privilege_escalation": "Can escalate privileges",
    "lateral_movement": "Can pivot to other systems",
    "data_exfiltration": "Can extract sensitive data",
    "persistence": "Can maintain persistent access",
}

# Capabilities that represent high-impact outcomes
CRITICAL_CAPABILITIES = {
    "command_execution", "admin_access", "credential_data",
    "data_exfiltration", "persistence", "internal_network",
    "lateral_movement",
}

# Default initial capabilities (what an external attacker starts with)
DEFAULT_INITIAL_CAPABILITIES = {
    "network_access", "http_access", "dns_access",
}


@dataclass
class CapabilityState:
    """Tracks accumulated capabilities during chain traversal."""
    capabilities: set = field(default_factory=lambda: set(DEFAULT_INITIAL_CAPABILITIES))

    def has(self, capability):
        return capability in self.capabilities

    def has_all(self, required):
        return all(r in self.capabilities for r in required)

    def grant(self, new_capabilities):
        """Return a new state with additional capabilities."""
        return CapabilityState(
            capabilities=self.capabilities | set(new_capabilities)
        )

    def gained(self, other_state):
        """Return capabilities gained compared to another state."""
        return self.capabilities - other_state.capabilities

    def has_critical(self):
        """Check if any critical capability has been achieved."""
        return bool(self.capabilities & CRITICAL_CAPABILITIES)

    def impact_score(self):
        """Score the impact of current capability set (0-1)."""
        critical_count = len(self.capabilities & CRITICAL_CAPABILITIES)
        if critical_count == 0:
            return 0.1
        return min(1.0, 0.3 + (critical_count / len(CRITICAL_CAPABILITIES)) * 0.7)

    def copy(self):
        return CapabilityState(capabilities=set(self.capabilities))

    def __repr__(self):
        return f"CapabilityState({sorted(self.capabilities)})"


@dataclass
class NodeCapabilities:
    """Pre/postconditions for a graph node."""
    node_id: str
    preconditions: list = field(default_factory=list)
    postconditions: list = field(default_factory=list)
    confidence: float = 0.5

    def can_exploit(self, state):
        """Check if current capability state satisfies preconditions."""
        return state.has_all(self.preconditions)

    def apply(self, state):
        """Apply postconditions to capability state."""
        return state.grant(self.postconditions)


def build_capability_map(nodes, findings):
    """Build a capability map from AI-enriched graph nodes and findings.

    This takes the threat_map nodes (which now include preconditions/postconditions
    from the AI engine) and builds a lookup table for the chain engine.

    Returns:
        dict: node_id -> NodeCapabilities
    """
    cap_map = {}

    for node in nodes:
        node_id = node.get("id", "")
        node_type = node.get("type", "")

        preconditions = node.get("preconditions", [])
        postconditions = node.get("postconditions", [])
        confidence = node.get("confidence", 0.5)

        # If the AI didn't provide capabilities, infer defaults
        if not preconditions and not postconditions:
            preconditions, postconditions, confidence = _infer_capabilities(
                node, findings
            )

        cap_map[node_id] = NodeCapabilities(
            node_id=node_id,
            preconditions=preconditions,
            postconditions=postconditions,
            confidence=confidence,
        )

    return cap_map


def _infer_capabilities(node, findings):
    """Infer pre/postconditions when the AI doesn't provide them.

    Falls back to heuristics based on node type, severity, and metadata.
    """
    node_type = node.get("type", "")
    severity = node.get("severity", "").lower()
    label = node.get("label", "").lower()
    details = node.get("details", "").lower()

    preconditions = []
    postconditions = []
    confidence = 0.5

    if node_type == "target":
        preconditions = ["network_access"]
        postconditions = ["http_access"]
        confidence = 0.9

    elif node_type == "service":
        preconditions = ["network_access"]
        postconditions = _infer_service_postconditions(label, details)
        confidence = 0.7

    elif node_type == "endpoint":
        preconditions = ["http_access"]
        postconditions = _infer_endpoint_postconditions(label, details)
        confidence = 0.6

    elif node_type == "subdomain":
        preconditions = ["dns_access"]
        postconditions = ["http_access"]
        confidence = 0.7

    elif node_type == "vulnerability":
        # Match to finding for richer data
        finding = _match_finding(node, findings)
        preconditions, postconditions, confidence = _infer_vuln_capabilities(
            node, finding
        )

    return preconditions, postconditions, confidence


def _infer_service_postconditions(label, details):
    """Infer what capabilities a service grants access to."""
    text = label + " " + details
    caps = []
    if any(w in text for w in ("http", "web", "nginx", "apache", "443", "80")):
        caps.append("http_access")
    if any(w in text for w in ("ssh", "22")):
        caps.append("ssh_access")
    if any(w in text for w in ("ftp", "21")):
        caps.append("ftp_access")
    if any(w in text for w in ("mysql", "postgres", "mongo", "redis", "3306", "5432")):
        caps.append("database_access")
    if any(w in text for w in ("smtp", "25", "587")):
        caps.append("smtp_access")
    return caps or ["network_access"]


def _infer_endpoint_postconditions(label, details):
    """Infer what an endpoint might provide."""
    text = label + " " + details
    caps = []
    if any(w in text for w in ("admin", "dashboard", "panel", "manage")):
        caps.append("admin_access")
    if any(w in text for w in ("upload", "file", "import")):
        caps.append("file_upload")
    if any(w in text for w in ("login", "auth", "signin", "token")):
        caps.append("authenticated_user")
    if any(w in text for w in ("api", "graphql", "rest")):
        caps.append("api_key")
    if any(w in text for w in ("config", "env", "settings", ".git")):
        caps.append("config_data")
    if any(w in text for w in ("backup", "dump", "export", "download")):
        caps.append("file_read")
    return caps or ["http_access"]


def _infer_vuln_capabilities(node, finding):
    """Infer vulnerability pre/postconditions from finding data."""
    severity = node.get("severity", "").lower()
    label = node.get("label", "").lower()
    details = node.get("details", "").lower()

    text = label + " " + details
    if finding:
        text += " " + (finding.get("title", "") + " " +
                        finding.get("description", "") + " " +
                        finding.get("impact", "")).lower()

    preconditions = ["http_access"]  # most vulns need HTTP
    postconditions = []
    confidence = {"critical": 0.85, "high": 0.7, "medium": 0.5, "low": 0.3}.get(
        severity, 0.4
    )

    # Infer from vulnerability characteristics
    if any(w in text for w in ("rce", "remote code", "command injection", "os command")):
        postconditions = ["command_execution"]
    elif any(w in text for w in ("sql injection", "sqli")):
        postconditions = ["sql_execution", "credential_data"]
        preconditions = ["http_access"]
    elif any(w in text for w in ("file upload", "unrestricted upload", "webshell")):
        postconditions = ["file_upload", "code_execution"]
    elif any(w in text for w in ("lfi", "local file inclusion", "path traversal", "directory traversal")):
        postconditions = ["file_read", "config_data"]
    elif any(w in text for w in ("xss", "cross-site scripting")):
        postconditions = ["session_hijack"]
    elif any(w in text for w in ("ssrf", "server-side request")):
        postconditions = ["internal_network"]
    elif any(w in text for w in ("auth bypass", "authentication bypass", "broken auth")):
        postconditions = ["authenticated_user"]
        preconditions = ["http_access"]
    elif any(w in text for w in ("privilege escalation", "priv esc", "idor")):
        postconditions = ["admin_access", "privilege_escalation"]
        preconditions = ["authenticated_user"]
    elif any(w in text for w in ("information disclosure", "info leak", "sensitive data")):
        postconditions = ["config_data"]
    elif any(w in text for w in ("default credentials", "weak password")):
        postconditions = ["authenticated_user"]
    elif any(w in text for w in ("missing header", "security header")):
        postconditions = []  # informational
        confidence = 0.2
    else:
        # Generic fallback based on severity
        if severity == "critical":
            postconditions = ["command_execution"]
        elif severity == "high":
            postconditions = ["authenticated_user"]
        elif severity == "medium":
            postconditions = ["config_data"]

    # If finding has explicit exploitability
    if finding:
        exploit = (finding.get("exploitability", "")).lower()
        if "easy" in exploit:
            confidence = min(1.0, confidence + 0.15)
        elif "difficult" in exploit:
            confidence = max(0.1, confidence - 0.15)

    return preconditions, postconditions, confidence


def _match_finding(node, findings):
    """Try to match a graph node to a finding for richer data."""
    node_id = node.get("id", "").lower()
    node_label = node.get("label", "").lower()

    for f in findings:
        fid = f.get("id", "").lower()
        ftitle = f.get("title", "").lower()
        if fid and fid == node_id:
            return f
        if node_label and (node_label in ftitle or ftitle in node_label):
            return f
        # Partial match on first 20 chars
        if node_label[:20] and node_label[:20] in ftitle:
            return f
    return None
