"""AI-powered vulnerability analysis and triage engine."""

import json

import anthropic

from recon_engine.utils.logger import info, success, error, section


SYSTEM_PROMPT = """You are an expert penetration tester and vulnerability analyst. You are analyzing
reconnaissance data collected from a target during an authorized security assessment.

Your job is to:
1. Analyze the raw recon data (ports, services, technologies, endpoints, subdomains)
2. Identify potential vulnerabilities and attack vectors
3. Prioritize findings by severity and exploitability
4. Recommend specific next steps for testing
5. Map out the attack surface

Be specific, technical, and actionable. Reference CVEs where applicable.
Use CVSS-like severity ratings: CRITICAL, HIGH, MEDIUM, LOW, INFO.

IMPORTANT: Output your analysis as valid JSON matching this schema:
{
  "executive_summary": "Brief overview of the target's security posture",
  "risk_score": 0-100,
  "attack_surface": {
    "total_entry_points": number,
    "external_services": number,
    "web_applications": number,
    "interesting_endpoints": number
  },
  "findings": [
    {
      "id": "FINDING-001",
      "severity": "CRITICAL|HIGH|MEDIUM|LOW|INFO",
      "title": "Short description",
      "description": "Detailed explanation",
      "affected_asset": "What's affected",
      "evidence": "What data supports this",
      "exploitability": "How easy to exploit (Easy/Moderate/Difficult)",
      "impact": "What could happen if exploited",
      "recommendation": "What to do about it",
      "cve_references": ["CVE-XXXX-XXXXX"],
      "test_next": "Specific command or technique to test this"
    }
  ],
  "attack_chains": [
    {
      "name": "Chain name",
      "description": "How these findings chain together",
      "steps": ["Step 1", "Step 2"],
      "severity": "CRITICAL|HIGH|MEDIUM|LOW",
      "likelihood": "High/Medium/Low"
    }
  ],
  "threat_map": {
    "nodes": [
      {
        "id": "unique-id",
        "label": "Display name",
        "type": "target|service|vulnerability|endpoint|subdomain",
        "severity": "critical|high|medium|low|info|neutral",
        "details": "Extra info",
        "x": 0,
        "y": 0
      }
    ],
    "edges": [
      {
        "source": "node-id",
        "target": "node-id",
        "label": "Relationship",
        "type": "connection|attack_path|data_flow"
      }
    ]
  },
  "next_steps": [
    {
      "priority": 1,
      "action": "What to do",
      "reason": "Why",
      "tools": ["Tool suggestions"]
    }
  ]
}"""


def _build_recon_summary(recon_data):
    """Build a structured summary of all recon data for the AI."""
    summary = []

    if "port_scan" in recon_data:
        scan = recon_data["port_scan"]
        summary.append("## Port Scan Results")
        summary.append(f"Target: {scan.get('target', 'N/A')}")
        summary.append(f"OS Guess: {scan.get('os_guess', 'N/A')}")
        for port in scan.get("ports", []):
            summary.append(
                f"  Port {port['port']}/{port['state']}: "
                f"{port['service']} {port.get('version', '')} "
                f"| Banner: {port.get('banner', '')}"
            )

    if "subdomains" in recon_data:
        summary.append("\n## Subdomains")
        for sub in recon_data["subdomains"]:
            summary.append(
                f"  {sub['subdomain']} -> {sub['ip']} "
                f"(HTTP {sub.get('status_code', 'N/A')}) "
                f"{sub.get('title', '')}"
                + (f" CNAME: {sub['cname']}" if sub.get("cname") else "")
            )

    if "tech_stack" in recon_data:
        tech = recon_data["tech_stack"]
        summary.append("\n## Technology Stack")
        summary.append(f"URL: {tech.get('url', 'N/A')}")
        summary.append(f"Technologies: {', '.join(tech.get('technologies', []))}")
        summary.append("\nSecurity Headers:")
        for header, info_dict in tech.get("security_headers", {}).items():
            status = "PRESENT" if info_dict.get("present") else "MISSING"
            summary.append(f"  {header}: {status}")

    if "endpoints" in recon_data:
        ep_data = recon_data["endpoints"]
        summary.append("\n## Endpoints")
        for ep in ep_data.get("endpoints", []):
            flag = " *** INTERESTING ***" if ep.get("interesting") else ""
            summary.append(
                f"  [{ep['status_code']}] {ep['url']} "
                f"({ep.get('content_length', 0)} bytes){flag}"
                + (f" - {ep['reason']}" if ep.get("reason") else "")
            )
        if ep_data.get("forms"):
            summary.append("\nForms found:")
            for form in ep_data["forms"]:
                summary.append(
                    f"  {form['method']} {form['action']} "
                    f"inputs: {[i['name'] for i in form.get('inputs', [])]}"
                )
        if ep_data.get("js_files"):
            summary.append(f"\nJS Files: {len(ep_data['js_files'])} found")
            for js in ep_data["js_files"][:20]:
                summary.append(f"  {js}")

    return "\n".join(summary)


def analyze(recon_data, config):
    """Run AI analysis on collected recon data."""
    section("AI Vulnerability Analysis")

    summary = _build_recon_summary(recon_data)
    info(f"Sending {len(summary)} chars of recon data to AI for analysis")

    try:
        client = anthropic.Anthropic(api_key=config.anthropic_api_key)

        message = client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=8000,
            system=SYSTEM_PROMPT,
            messages=[
                {
                    "role": "user",
                    "content": (
                        f"Analyze this reconnaissance data from an authorized "
                        f"penetration test and provide your vulnerability "
                        f"assessment as JSON:\n\n{summary}"
                    ),
                }
            ],
        )

        response_text = message.content[0].text

        # Extract JSON from response (handle markdown code blocks)
        json_text = response_text
        if "```json" in json_text:
            json_text = json_text.split("```json")[1].split("```")[0]
        elif "```" in json_text:
            json_text = json_text.split("```")[1].split("```")[0]

        analysis = json.loads(json_text.strip())
        success("AI analysis complete")
        return analysis

    except json.JSONDecodeError as e:
        error(f"Failed to parse AI response as JSON: {e}")
        return {
            "executive_summary": "Analysis completed but output parsing failed",
            "raw_response": response_text,
            "risk_score": 0,
            "findings": [],
            "threat_map": {"nodes": [], "edges": []},
            "next_steps": [],
        }
    except Exception as e:
        error(f"AI analysis failed: {e}")
        return {
            "executive_summary": f"Analysis failed: {str(e)}",
            "risk_score": 0,
            "findings": [],
            "threat_map": {"nodes": [], "edges": []},
            "next_steps": [],
        }
