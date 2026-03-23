"""Flask server for the operational threat visualization."""

import json
import os

from flask import Flask, render_template, jsonify

from recon_engine.utils.logger import info, success


def create_app(scan_data=None):
    """Create the Flask visualization app."""
    app = Flask(
        __name__,
        template_folder=os.path.join(os.path.dirname(__file__), "templates"),
        static_folder=os.path.join(os.path.dirname(__file__), "static"),
    )

    app.config["SCAN_DATA"] = scan_data or {}

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

        events.append({"type": "phase", "text": "OPERATIONAL"})
        return jsonify(events)

    return app


def serve(scan_data, port=8080):
    """Launch the visualization server."""
    info(f"Starting operational interface on http://localhost:{port}")
    app = create_app(scan_data)
    success(f"Interface ready at http://localhost:{port}")
    app.run(host="0.0.0.0", port=port, debug=False)
