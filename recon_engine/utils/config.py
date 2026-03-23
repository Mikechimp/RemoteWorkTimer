"""Configuration management."""

import os
from dataclasses import dataclass, field
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()


@dataclass
class Config:
    ai_provider: str = os.getenv("AI_PROVIDER", "anthropic")
    anthropic_api_key: str = os.getenv("ANTHROPIC_API_KEY", "")
    openai_api_key: str = os.getenv("OPENAI_API_KEY", "")
    output_dir: str = os.getenv("OUTPUT_DIR", "./output")
    max_threads: int = int(os.getenv("MAX_THREADS", "10"))
    viz_port: int = int(os.getenv("VIZ_PORT", "8080"))

    # Scan settings
    scan_timeout: int = 300
    top_ports: int = 1000
    aggressive_scan: bool = False
    wordlist_path: str = ""

    # Target
    target: str = ""
    target_type: str = ""  # domain, ip, username

    def ensure_output_dir(self):
        Path(self.output_dir).mkdir(parents=True, exist_ok=True)
        return self.output_dir

    def validate(self):
        if not self.anthropic_api_key and self.ai_provider == "anthropic":
            raise ValueError("ANTHROPIC_API_KEY is required when using anthropic provider")
        if not self.openai_api_key and self.ai_provider == "openai":
            raise ValueError("OPENAI_API_KEY is required when using openai provider")
        if not self.target:
            raise ValueError("Target is required")
