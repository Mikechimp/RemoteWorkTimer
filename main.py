#!/usr/bin/env python3
"""
AI Recon & Vulnerability Triage Engine
=======================================
Automated reconnaissance with AI-powered vulnerability analysis
and interactive threat map visualization.

Usage:
    python main.py scan <target> [options]
    python main.py visualize <results.json>
"""

import json
import sys

import click

from recon_engine.utils.config import Config
from recon_engine.utils.logger import banner, info, error, success
from recon_engine.orchestrator import run_scan
from recon_engine.visualization.server import serve


@click.group()
@click.version_option(version="1.0.0", prog_name="AI Recon Engine")
def cli():
    """AI Recon & Vulnerability Triage Engine"""
    pass


@cli.command()
@click.argument("target")
@click.option("--top-ports", default=1000, help="Number of top ports to scan")
@click.option("--aggressive", is_flag=True, help="Enable aggressive scanning (slower, more detail)")
@click.option("--threads", default=10, help="Max concurrent threads")
@click.option("--output", default="./output", help="Output directory")
@click.option("--no-viz", is_flag=True, help="Skip launching visualization server")
@click.option("--viz-port", default=8080, help="Visualization server port")
@click.option("--api-key", default=None, help="Anthropic API key (or set ANTHROPIC_API_KEY env)")
def scan(target, top_ports, aggressive, threads, output, no_viz, viz_port, api_key):
    """Run full recon scan against a target.

    TARGET can be a domain (example.com), IP (1.2.3.4), or IP range (1.2.3.0/24).

    Examples:
        python main.py scan example.com
        python main.py scan 192.168.1.0/24 --aggressive
        python main.py scan target.com --top-ports 100 --threads 20
    """
    config = Config(
        target=target,
        top_ports=top_ports,
        aggressive_scan=aggressive,
        max_threads=threads,
        output_dir=output,
        viz_port=viz_port,
    )

    if api_key:
        config.anthropic_api_key = api_key

    try:
        config.validate()
    except ValueError as e:
        error(str(e))
        sys.exit(1)

    scan_data, output_file = run_scan(config)

    if not no_viz:
        info(f"\nLaunching interactive threat map...")
        serve(scan_data, port=viz_port)


@cli.command()
@click.argument("results_file", type=click.Path(exists=True))
@click.option("--port", default=8080, help="Server port")
def visualize(results_file, port):
    """Launch the interactive threat map for existing scan results.

    Examples:
        python main.py visualize output/recon_example.com_20240101_120000.json
    """
    banner()
    info(f"Loading results from {results_file}")

    with open(results_file, "r") as f:
        scan_data = json.load(f)

    success(f"Loaded scan data for target: {scan_data.get('target', 'Unknown')}")
    serve(scan_data, port=port)


@cli.command()
def info_cmd():
    """Show tool information and requirements."""
    banner()
    click.echo()
    click.echo("Required tools (optional, enhances scanning):")
    click.echo("  - nmap: Advanced port scanning and service detection")
    click.echo()
    click.echo("Required API keys:")
    click.echo("  - ANTHROPIC_API_KEY: For AI-powered vulnerability analysis")
    click.echo()
    click.echo("Quick start:")
    click.echo("  1. cp .env.example .env")
    click.echo("  2. Edit .env and add your API key")
    click.echo("  3. pip install -r requirements.txt")
    click.echo("  4. python main.py scan <target>")


if __name__ == "__main__":
    cli()
