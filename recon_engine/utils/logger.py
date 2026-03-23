"""Rich console logging for the recon engine."""

from rich.console import Console
from rich.panel import Panel
from rich.table import Table
from rich.progress import Progress, SpinnerColumn, TextColumn, BarColumn
from rich.theme import Theme

custom_theme = Theme({
    "info": "cyan",
    "warning": "yellow",
    "danger": "bold red",
    "success": "bold green",
    "recon": "bold magenta",
})

console = Console(theme=custom_theme)


def banner():
    console.print(Panel.fit(
        "[bold cyan]"
        "    ___    ____   ____                      \n"
        "   /   |  /  _/  / __ \\___  _________  ____ \n"
        "  / /| |  / /   / /_/ / _ \\/ ___/ __ \\/ __ \\\n"
        " / ___ |_/ /   / _, _/  __/ /__/ /_/ / / / /\n"
        "/_/  |_/___/  /_/ |_|\\___/\\___/\\____/_/ /_/ \n"
        "[/bold cyan]\n"
        "[bold white]AI Recon & Vulnerability Triage Engine[/bold white]\n"
        "[dim]Automated recon. AI-powered analysis. Interactive threat maps.[/dim]",
        border_style="cyan",
    ))


def section(title):
    console.print(f"\n[recon]{'━' * 60}[/recon]")
    console.print(f"[recon]  ▶ {title}[/recon]")
    console.print(f"[recon]{'━' * 60}[/recon]\n")


def info(msg):
    console.print(f"[info]  ℹ {msg}[/info]")


def success(msg):
    console.print(f"[success]  ✓ {msg}[/success]")


def warn(msg):
    console.print(f"[warning]  ⚠ {msg}[/warning]")


def error(msg):
    console.print(f"[danger]  ✗ {msg}[/danger]")


def finding(severity, title, detail=""):
    colors = {
        "critical": "bold red",
        "high": "red",
        "medium": "yellow",
        "low": "blue",
        "info": "dim",
    }
    color = colors.get(severity.lower(), "white")
    console.print(f"  [{color}][{severity.upper()}][/{color}] {title}")
    if detail:
        console.print(f"    [dim]{detail}[/dim]")


def results_table(title, headers, rows):
    table = Table(title=title, show_lines=True, border_style="cyan")
    for h in headers:
        table.add_column(h, style="bold")
    for row in rows:
        table.add_row(*[str(c) for c in row])
    console.print(table)


def get_progress():
    return Progress(
        SpinnerColumn(),
        TextColumn("[progress.description]{task.description}"),
        BarColumn(),
        TextColumn("[progress.percentage]{task.percentage:>3.0f}%"),
        console=console,
    )
