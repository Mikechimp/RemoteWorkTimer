# AI Recon & Vulnerability Triage Engine

Automated reconnaissance with AI-powered vulnerability analysis and an interactive, game-like threat map visualization.

## What It Does

Give it a **domain**, **IP address**, or **IP range** and it will:

1. **Run recon automatically** — port scanning, subdomain enumeration, tech stack detection, endpoint discovery
2. **Collect raw data** — ports, services, versions, banners, subdomains, technologies, endpoints, forms, JS files
3. **AI-analyze everything** — Claude identifies vulnerabilities, prioritizes by severity, maps attack chains
4. **Output actionable results:**
   - What matters (prioritized findings with CVE references)
   - What to test next (specific commands and techniques)
   - What's probably exploitable (attack chains with likelihood ratings)
   - **Interactive threat map** — a visual, game-like network graph with animated attack paths, glowing nodes, and drill-down details

## Quick Start

```bash
# Clone and install
pip install -r requirements.txt

# Set up your API key
cp .env.example .env
# Edit .env and add your ANTHROPIC_API_KEY

# Run a scan
python main.py scan example.com

# View previous results
python main.py visualize output/recon_example.com_20240101_120000.json
```

## Usage

```bash
# Basic scan
python main.py scan target.com

# Aggressive scan with more ports
python main.py scan target.com --aggressive --top-ports 5000

# Fast scan with more threads
python main.py scan 192.168.1.1 --threads 50

# Scan without launching visualization
python main.py scan target.com --no-viz

# Custom output directory
python main.py scan target.com --output ./results

# Pass API key directly
python main.py scan target.com --api-key sk-ant-...
```

## Recon Modules

| Module | What It Does |
|--------|-------------|
| **Port Scanner** | Scans ports via nmap (or socket fallback), grabs service banners and versions |
| **Subdomain Enum** | Brute-force + certificate transparency (crt.sh) subdomain discovery |
| **Tech Detector** | Identifies frameworks, servers, languages, CMSes from headers/HTML/cookies |
| **Endpoint Discovery** | Finds admin panels, API docs, config leaks, git repos, debug endpoints |

## AI Analysis

The AI engine sends all collected recon data to Claude, which returns:

- **Prioritized findings** with severity ratings (CRITICAL → INFO)
- **Attack chains** showing how findings combine into exploitable paths
- **Threat map data** for the interactive visualization
- **Next steps** with specific tools and commands to run

## Threat Map

The interactive visualization renders as a cyberpunk-styled network graph:

- **Hexagons** = targets, **Diamonds** = vulnerabilities, **Circles** = services/endpoints
- **Animated particles** flow along attack paths
- **Glow intensity** reflects severity
- Click nodes for details, double-click vulnerabilities for full finding info
- Filter findings by severity, zoom/pan the map, toggle labels and particles

## Requirements

- Python 3.10+
- Anthropic API key
- Optional: nmap (for enhanced port scanning)

## Disclaimer

This tool is intended for **authorized security testing only**. Always obtain proper authorization before scanning any target. Unauthorized scanning may violate laws and regulations.
