"""Orchestrator - coordinates all recon modules and AI analysis."""

import json
import os
import re
import socket
from datetime import datetime
from pathlib import Path

from recon_engine.utils.config import Config
from recon_engine.utils.logger import (
    banner, section, info, success, warn, error,
    results_table, finding,
)
from recon_engine.recon import port_scanner, subdomain_enum, tech_detector, endpoint_discovery
from recon_engine.analysis.ai_engine import analyze
from recon_engine.analysis.chain_engine import ChainEngine
from recon_engine.visualization.server import serve


def _detect_target_type(target):
    """Detect if target is a domain, IP, or IP range."""
    # IP range (CIDR)
    if "/" in target and re.match(r'^\d+\.\d+\.\d+\.\d+/\d+$', target):
        return "ip_range"
    # IP address
    try:
        socket.inet_aton(target)
        return "ip"
    except socket.error:
        pass
    # Domain
    if re.match(r'^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z]{2,})+$', target):
        return "domain"
    # Username (fallback)
    return "username"


def _resolve_target(target, target_type):
    """Resolve target to an IP for scanning."""
    if target_type in ("ip", "ip_range"):
        return target
    try:
        ip = socket.gethostbyname(target)
        info(f"Resolved {target} -> {ip}")
        return ip
    except socket.gaierror:
        warn(f"Could not resolve {target}")
        return target


def run_scan(config):
    """Execute the full recon pipeline."""
    banner()

    target = config.target
    target_type = config.target_type or _detect_target_type(target)
    config.target_type = target_type

    section(f"Target: {target} ({target_type})")
    info(f"Scan started at {datetime.now().isoformat()}")

    recon_data = {"target": target, "target_type": target_type}
    ip = _resolve_target(target, target_type)

    # Phase 1: Port Scanning
    if target_type in ("domain", "ip", "ip_range"):
        section("Phase 1: Port Scanning")
        try:
            scan_results = port_scanner.run(ip, config)
            recon_data["port_scan"] = scan_results.to_dict()

            if scan_results.ports:
                rows = [
                    (str(p.port), p.state, p.service, p.version, p.banner[:40])
                    for p in scan_results.ports[:30]
                ]
                results_table(
                    "Open Ports",
                    ["Port", "State", "Service", "Version", "Banner"],
                    rows,
                )
        except Exception as e:
            error(f"Port scan failed: {e}")

    # Phase 2: Subdomain Enumeration
    if target_type == "domain":
        section("Phase 2: Subdomain Enumeration")
        try:
            subdomains = subdomain_enum.run(target, config)
            recon_data["subdomains"] = [s.to_dict() for s in subdomains]

            if subdomains:
                rows = [
                    (s.subdomain, s.ip, str(s.status_code), s.title[:30])
                    for s in subdomains[:20]
                ]
                results_table(
                    "Subdomains",
                    ["Subdomain", "IP", "HTTP", "Title"],
                    rows,
                )
        except Exception as e:
            error(f"Subdomain enumeration failed: {e}")

    # Phase 3: Technology Detection
    if target_type in ("domain", "ip"):
        section("Phase 3: Technology Detection")
        try:
            tech = tech_detector.run(target, config)
            recon_data["tech_stack"] = tech.to_dict()

            if tech.technologies:
                info(f"Technologies: {', '.join(tech.technologies)}")

            # Show security header status
            missing = [
                h for h, v in tech.security_headers.items()
                if not v.get("present")
            ]
            if missing:
                warn(f"Missing security headers: {', '.join(missing)}")
        except Exception as e:
            error(f"Tech detection failed: {e}")

    # Phase 4: Endpoint Discovery
    if target_type in ("domain", "ip"):
        section("Phase 4: Endpoint Discovery")
        try:
            endpoints = endpoint_discovery.run(target, config)
            recon_data["endpoints"] = endpoints.to_dict()

            interesting = [e for e in endpoints.endpoints if e.interesting]
            if interesting:
                rows = [
                    (str(e.status_code), e.url, e.reason)
                    for e in interesting
                ]
                results_table(
                    "Interesting Endpoints",
                    ["Status", "URL", "Reason"],
                    rows,
                )
        except Exception as e:
            error(f"Endpoint discovery failed: {e}")

    # Phase 5: AI Analysis
    section("Phase 5: AI Vulnerability Analysis")
    try:
        analysis = analyze(recon_data, config)
        recon_data["analysis"] = analysis

        # Display findings
        if analysis.get("findings"):
            section("Vulnerability Findings")
            for f in analysis["findings"]:
                finding(
                    f.get("severity", "INFO"),
                    f.get("title", "Untitled"),
                    f.get("description", ""),
                )

        # Display next steps
        if analysis.get("next_steps"):
            section("Recommended Next Steps")
            for step in analysis["next_steps"]:
                info(f"[{step.get('priority', '?')}] {step.get('action', '')}")
                info(f"    Why: {step.get('reason', '')}")

        # Risk score
        risk = analysis.get("risk_score", 0)
        section(f"Overall Risk Score: {risk}/100")

    except Exception as e:
        error(f"AI analysis failed: {e}")

    # Phase 6: Attack Chain Computation
    if recon_data.get("analysis", {}).get("threat_map"):
        section("Phase 6: Attack Chain Computation")
        try:
            engine = ChainEngine(max_depth=8)
            engine.load(
                recon_data["analysis"]["threat_map"],
                recon_data["analysis"].get("findings", []),
            )
            chains = engine.discover_chains()
            recon_data["analysis"]["computed_chains"] = engine.to_dict()

            info(f"Discovered {len(chains)} viable attack chains")
            for chain in chains[:5]:
                finding(
                    "HIGH" if chain.score > 0.5 else "MEDIUM",
                    f"{chain.chain_id}: {chain.impact}",
                    f"Score: {chain.score:.2f} | Confidence: {chain.confidence:.2f} | "
                    f"Steps: {len(chain.steps)}",
                )

            if engine.recommended:
                section("Recommended Next Action")
                rec = engine.recommended
                info(f"[RECOMMENDED] {rec.action}")
                info(f"    Expected: {rec.expected_outcome} ({rec.confidence:.0%})")

        except Exception as e:
            error(f"Chain computation failed: {e}")

    # Save results
    output_dir = config.ensure_output_dir()
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    safe_target = re.sub(r'[^\w.-]', '_', target)
    output_file = os.path.join(output_dir, f"recon_{safe_target}_{timestamp}.json")

    with open(output_file, "w") as f:
        json.dump(recon_data, f, indent=2, default=str)

    success(f"Results saved to {output_file}")

    return recon_data, output_file
