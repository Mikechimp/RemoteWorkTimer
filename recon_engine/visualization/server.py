"""Flask server for the operational threat visualization."""

import json
import os

from flask import Flask, render_template, jsonify, request

from recon_engine.analysis.chain_engine import ChainEngine
from recon_engine.utils.logger import info, success


def create_app(scan_data=None):
    """Create the Flask visualization app."""
    app = Flask(
        __name__,
        template_folder=os.path.join(os.path.dirname(__file__), "templates"),
        static_folder=os.path.join(os.path.dirname(__file__), "static"),
    )

    app.config["SCAN_DATA"] = scan_data or {}

    # Pre-compute chains if analysis data exists
    _chain_engine = _build_chain_engine(app.config["SCAN_DATA"])
    app.config["CHAIN_ENGINE"] = _chain_engine

    @app.route("/")
    def index():
        return render_template("index.html")

    @app.route("/api/scan-data")
    def get_scan_data():
        return jsonify(app.config["SCAN_DATA"])

    @app.route("/api/threat-map")
    def get_threat_map():
        analysis = app.config["SCAN_DATA"].get("analysis", {})
        return jsonify(analysis.get("threat_map", {"nodes": [], "edges": []}))

    @app.route("/api/findings")
    def get_findings():
        analysis = app.config["SCAN_DATA"].get("analysis", {})
        return jsonify(analysis.get("findings", []))

    @app.route("/api/summary")
    def get_summary():
        analysis = app.config["SCAN_DATA"].get("analysis", {})
        return jsonify({
            "executive_summary": analysis.get("executive_summary", ""),
            "risk_score": analysis.get("risk_score", 0),
            "attack_surface": analysis.get("attack_surface", {}),
            "next_steps": analysis.get("next_steps", []),
            "attack_chains": analysis.get("attack_chains", []),
        })

    @app.route("/api/chains")
    def get_chains():
        """Return computed attack chains with scores and recommended action."""
        engine = app.config.get("CHAIN_ENGINE")
        if engine:
            return jsonify(engine.to_dict())
        # Fall back to pre-computed chains from orchestrator
        analysis = app.config["SCAN_DATA"].get("analysis", {})
        computed = analysis.get("computed_chains", {})
        if computed:
            return jsonify(computed)
        return jsonify({"chains": [], "recommended": None, "total_chains": 0})

    @app.route("/api/chains/for-node/<node_id>")
    def get_chain_for_node(node_id):
        """Get the best chain passing through a specific node."""
        engine = app.config.get("CHAIN_ENGINE")
        if not engine:
            return jsonify(None)
        chain = engine.get_chain_for_node(node_id)
        return jsonify(chain.to_dict() if chain else None)

    @app.route("/api/chains/recompute", methods=["POST"])
    def recompute_chains():
        """Recompute chains with custom initial capabilities."""
        body = request.get_json(silent=True) or {}
        initial_caps = body.get("initial_capabilities")

        engine = _build_chain_engine(app.config["SCAN_DATA"])
        if engine and initial_caps:
            engine.discover_chains(initial_capabilities=initial_caps)
        app.config["CHAIN_ENGINE"] = engine

        if engine:
            return jsonify(engine.to_dict())
        return jsonify({"chains": [], "recommended": None, "total_chains": 0})

    @app.route("/api/intel-feed")
    def get_intel_feed():
        """Reconstruct recon events as an ordered intel feed."""
        data = app.config["SCAN_DATA"]
        events = []

        events.append({"type": "phase", "text": "RECON INITIATED"})
        events.append({
            "type": "info",
            "text": f"Target: {data.get('target', 'unknown')} ({data.get('target_type', '')})",
        })

        # Port scan
        port_scan = data.get("port_scan", {})
        if port_scan.get("ports"):
            open_ports = [p for p in port_scan["ports"] if p.get("state") == "open"]
            events.append({"type": "phase", "text": "PORT SCAN"})
            events.append({"type": "discover", "text": f"{len(open_ports)} open ports"})
            for p in open_ports[:10]:
                svc = p.get("service", "unknown")
                ver = p.get("version", "")
                events.append({
                    "type": "discover",
                    "text": f"Port {p['port']}/{svc}{' (' + ver + ')' if ver else ''}",
                })

        # Subdomains
        subs = data.get("subdomains", [])
        if subs:
            events.append({"type": "phase", "text": "SUBDOMAIN ENUM"})
            events.append({"type": "discover", "text": f"{len(subs)} subdomains resolved"})
            for s in subs[:8]:
                events.append({"type": "discover", "text": f"[+] {s['subdomain']} → {s.get('ip', '')}"})

        # Tech
        tech = data.get("tech_stack", {})
        if tech.get("technologies"):
            events.append({"type": "phase", "text": "TECH FINGERPRINT"})
            events.append({"type": "discover", "text": ", ".join(tech["technologies"])})

        # Endpoints
        eps = data.get("endpoints", {})
        if eps.get("endpoints"):
            events.append({"type": "phase", "text": "ENDPOINT DISCOVERY"})
            interesting = [e for e in eps["endpoints"] if e.get("interesting")]
            for ep in interesting[:6]:
                events.append({"type": "exploit", "text": f"[!] {ep['url']} — {ep.get('reason', '')}"})

        # Findings
        analysis = data.get("analysis", {})
        if analysis.get("findings"):
            events.append({"type": "phase", "text": "AI TRIAGE COMPLETE"})
            for f in analysis["findings"]:
                sev = f.get("severity", "INFO")
                if sev == "CRITICAL":
                    events.append({"type": "critical", "text": f"[!!] {f.get('title', '')}"})
                elif sev == "HIGH":
                    events.append({"type": "vuln", "text": f"[!] {f.get('title', '')}"})
                else:
                    events.append({"type": "discover", "text": f"[+] {f.get('title', '')}"})

        # Chain computation results
        engine = app.config.get("CHAIN_ENGINE")
        if engine and engine.chains:
            events.append({"type": "phase", "text": "CHAIN ANALYSIS"})
            events.append({
                "type": "exploit",
                "text": f"{len(engine.chains)} viable attack chains computed",
            })
            for chain in engine.chains[:3]:
                events.append({
                    "type": "critical" if chain.score > 0.6 else "vuln",
                    "text": f"[>] {chain.chain_id}: {chain.impact} (score: {chain.score:.2f})",
                })
            if engine.recommended:
                events.append({
                    "type": "critical",
                    "text": f"[RECOMMENDED] {engine.recommended.action} → {engine.recommended.expected_outcome}",
                })

        events.append({"type": "phase", "text": "OPERATIONAL"})
        return jsonify(events)

    return app


def _build_chain_engine(scan_data):
    """Build and run the chain engine from scan data."""
    analysis = scan_data.get("analysis", {})
    threat_map = analysis.get("threat_map", {})
    findings = analysis.get("findings", [])

    if not threat_map.get("nodes"):
        return None

    engine = ChainEngine(max_depth=8)
    engine.load(threat_map, findings)
    engine.discover_chains()
    return engine


def serve(scan_data, port=8080):
    """Launch the visualization server."""
    info(f"Starting operational interface on http://localhost:{port}")
    app = create_app(scan_data)
    success(f"Interface ready at http://localhost:{port}")
    app.run(host="0.0.0.0", port=port, debug=False)
