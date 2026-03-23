"""Flask server for the interactive threat map visualization."""

import json
import os

from flask import Flask, render_template, jsonify, send_from_directory

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

    return app


def serve(scan_data, port=8080):
    """Launch the visualization server."""
    info(f"Starting threat map visualization on http://localhost:{port}")
    app = create_app(scan_data)
    success(f"Threat map ready at http://localhost:{port}")
    app.run(host="0.0.0.0", port=port, debug=False)
