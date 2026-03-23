"""Subdomain enumeration module."""

import socket
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field

import dns.resolver
import requests

from recon_engine.utils.logger import info, success, warn, get_progress


COMMON_SUBDOMAINS = [
    "www", "mail", "ftp", "localhost", "webmail", "smtp", "pop", "ns1", "ns2",
    "dns", "dns1", "dns2", "mx", "mx1", "mx2", "blog", "dev", "staging",
    "api", "app", "admin", "portal", "git", "gitlab", "github", "jenkins",
    "ci", "cd", "test", "testing", "stage", "prod", "production", "beta",
    "alpha", "demo", "sandbox", "vpn", "remote", "ssh", "ftp", "sftp",
    "db", "database", "mysql", "postgres", "redis", "mongo", "elastic",
    "kibana", "grafana", "prometheus", "cdn", "static", "assets", "media",
    "images", "img", "docs", "wiki", "help", "support", "status", "monitor",
    "auth", "login", "sso", "oauth", "id", "accounts", "dashboard",
    "internal", "intranet", "corp", "corporate", "office", "exchange",
    "owa", "autodiscover", "lyncdiscover", "sip", "meet", "conference",
    "shop", "store", "checkout", "payment", "billing", "crm", "erp",
    "jira", "confluence", "slack", "teams", "zoom", "webex",
    "s3", "aws", "azure", "cloud", "gcp", "k8s", "kubernetes", "docker",
    "registry", "vault", "consul", "nomad", "terraform",
]


@dataclass
class SubdomainResult:
    subdomain: str
    ip: str = ""
    status_code: int = 0
    title: str = ""
    cname: str = ""

    def to_dict(self):
        return {
            "subdomain": self.subdomain,
            "ip": self.ip,
            "status_code": self.status_code,
            "title": self.title,
            "cname": self.cname,
        }


def _resolve_subdomain(subdomain):
    """Try to resolve a subdomain and get basic info."""
    try:
        answers = dns.resolver.resolve(subdomain, "A")
        ip = answers[0].to_text()

        cname = ""
        try:
            cname_answers = dns.resolver.resolve(subdomain, "CNAME")
            cname = cname_answers[0].to_text()
        except Exception:
            pass

        status_code = 0
        title = ""
        try:
            resp = requests.get(
                f"https://{subdomain}",
                timeout=5,
                allow_redirects=True,
                verify=False,
            )
            status_code = resp.status_code
            if "<title>" in resp.text.lower():
                start = resp.text.lower().index("<title>") + 7
                end = resp.text.lower().index("</title>", start)
                title = resp.text[start:end].strip()[:100]
        except Exception:
            try:
                resp = requests.get(
                    f"http://{subdomain}",
                    timeout=5,
                    allow_redirects=True,
                )
                status_code = resp.status_code
                if "<title>" in resp.text.lower():
                    start = resp.text.lower().index("<title>") + 7
                    end = resp.text.lower().index("</title>", start)
                    title = resp.text[start:end].strip()[:100]
            except Exception:
                pass

        return SubdomainResult(
            subdomain=subdomain,
            ip=ip,
            status_code=status_code,
            title=title,
            cname=cname,
        )
    except (dns.resolver.NXDOMAIN, dns.resolver.NoAnswer, dns.resolver.NoNameservers):
        return None
    except Exception:
        return None


def _fetch_crtsh(domain):
    """Fetch subdomains from crt.sh certificate transparency logs."""
    subdomains = set()
    try:
        resp = requests.get(
            f"https://crt.sh/?q=%.{domain}&output=json",
            timeout=15,
        )
        if resp.status_code == 200:
            for entry in resp.json():
                name = entry.get("name_value", "")
                for sub in name.split("\n"):
                    sub = sub.strip().lower()
                    if sub.endswith(f".{domain}") or sub == domain:
                        subdomains.add(sub)
            info(f"crt.sh returned {len(subdomains)} entries")
    except Exception as e:
        warn(f"crt.sh query failed: {e}")
    return subdomains


def run(domain, config):
    """Run subdomain enumeration against a domain."""
    info(f"Enumerating subdomains for {domain}")

    # Gather candidate subdomains
    candidates = set()

    # From wordlist
    for prefix in COMMON_SUBDOMAINS:
        candidates.add(f"{prefix}.{domain}")

    # From certificate transparency
    ct_subs = _fetch_crtsh(domain)
    candidates.update(ct_subs)

    info(f"Testing {len(candidates)} subdomain candidates")

    results = []
    with get_progress() as progress:
        task = progress.add_task("Resolving subdomains...", total=len(candidates))
        with ThreadPoolExecutor(max_workers=config.max_threads) as executor:
            futures = {
                executor.submit(_resolve_subdomain, sub): sub
                for sub in candidates
            }
            for future in as_completed(futures):
                progress.advance(task)
                result = future.result()
                if result is not None:
                    results.append(result)

    results.sort(key=lambda r: r.subdomain)
    success(f"Found {len(results)} live subdomains")
    return results
