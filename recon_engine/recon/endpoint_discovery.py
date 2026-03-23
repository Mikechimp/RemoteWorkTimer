"""Endpoint and path discovery module."""

import re
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from urllib.parse import urljoin, urlparse

import requests
from bs4 import BeautifulSoup

from recon_engine.utils.logger import info, success, warn, get_progress


COMMON_PATHS = [
    # Admin and login
    "/admin", "/administrator", "/login", "/signin", "/auth",
    "/wp-admin", "/wp-login.php", "/admin/login",
    "/dashboard", "/panel", "/console",
    # API endpoints
    "/api", "/api/v1", "/api/v2", "/api/v3",
    "/graphql", "/graphiql",
    "/swagger", "/swagger-ui", "/swagger.json",
    "/openapi.json", "/api-docs", "/docs",
    # Config and info leaks
    "/robots.txt", "/sitemap.xml", "/.well-known/security.txt",
    "/.env", "/config.json", "/config.yml", "/config.xml",
    "/web.config", "/crossdomain.xml",
    "/package.json", "/composer.json",
    "/.git/HEAD", "/.git/config",
    "/.svn/entries", "/.hg/",
    "/debug", "/trace", "/info", "/health", "/status",
    "/server-status", "/server-info",
    "/.htaccess", "/.htpasswd",
    "/phpinfo.php", "/info.php",
    "/backup", "/backup.sql", "/dump.sql",
    "/db", "/database",
    # Development
    "/test", "/testing", "/staging", "/dev",
    "/debug", "/_debug", "/__debug__",
    "/elmah.axd", "/trace.axd",
    # Common frameworks
    "/actuator", "/actuator/health", "/actuator/env",
    "/wp-json/wp/v2/users",
    "/xmlrpc.php",
    "/cgi-bin/",
    "/.well-known/openid-configuration",
]


@dataclass
class Endpoint:
    url: str
    status_code: int
    content_length: int = 0
    redirect_url: str = ""
    title: str = ""
    interesting: bool = False
    reason: str = ""

    def to_dict(self):
        return {
            "url": self.url,
            "status_code": self.status_code,
            "content_length": self.content_length,
            "redirect_url": self.redirect_url,
            "title": self.title,
            "interesting": self.interesting,
            "reason": self.reason,
        }


@dataclass
class EndpointResults:
    base_url: str
    endpoints: list = field(default_factory=list)
    crawled_links: list = field(default_factory=list)
    js_files: list = field(default_factory=list)
    forms: list = field(default_factory=list)

    def to_dict(self):
        return {
            "base_url": self.base_url,
            "endpoints": [e.to_dict() for e in self.endpoints],
            "crawled_links": self.crawled_links,
            "js_files": self.js_files,
            "forms": self.forms,
        }


def _check_path(base_url, path, timeout=5):
    """Check if a path exists and gather info."""
    url = urljoin(base_url, path)
    try:
        resp = requests.get(
            url, timeout=timeout, allow_redirects=False, verify=False,
        )

        redirect_url = ""
        if resp.status_code in (301, 302, 303, 307, 308):
            redirect_url = resp.headers.get("Location", "")

        title = ""
        if "text/html" in resp.headers.get("Content-Type", ""):
            if "<title>" in resp.text.lower():
                start = resp.text.lower().index("<title>") + 7
                end = resp.text.lower().index("</title>", start)
                title = resp.text[start:end].strip()[:100]

        interesting = False
        reason = ""

        # Flag interesting findings
        if resp.status_code == 200:
            if any(p in path for p in [".env", ".git", "config", "backup", "dump"]):
                interesting = True
                reason = "Sensitive file exposed"
            elif any(p in path for p in ["phpinfo", "server-status", "server-info", "actuator"]):
                interesting = True
                reason = "Debug/info endpoint exposed"
            elif any(p in path for p in ["swagger", "api-docs", "graphiql", "openapi"]):
                interesting = True
                reason = "API documentation exposed"
            elif any(p in path for p in ["admin", "dashboard", "panel", "console"]):
                interesting = True
                reason = "Admin interface found"

        if resp.status_code == 403:
            interesting = True
            reason = "Forbidden (exists but protected)"

        if resp.status_code not in (404, 410, 503):
            return Endpoint(
                url=url,
                status_code=resp.status_code,
                content_length=len(resp.content),
                redirect_url=redirect_url,
                title=title,
                interesting=interesting,
                reason=reason,
            )
    except Exception:
        pass
    return None


def _crawl_page(base_url, timeout=10):
    """Crawl the main page for links, JS files, and forms."""
    links = set()
    js_files = set()
    forms = []

    try:
        resp = requests.get(base_url, timeout=timeout, verify=False)
        soup = BeautifulSoup(resp.text, "html.parser")
        base_domain = urlparse(base_url).netloc

        # Extract links
        for tag in soup.find_all("a", href=True):
            href = tag["href"]
            full_url = urljoin(base_url, href)
            if base_domain in urlparse(full_url).netloc:
                links.add(full_url)

        # Extract JS files
        for tag in soup.find_all("script", src=True):
            src = tag["src"]
            full_url = urljoin(base_url, src)
            js_files.add(full_url)

        # Extract forms
        for form in soup.find_all("form"):
            action = form.get("action", "")
            method = form.get("method", "GET").upper()
            inputs = []
            for inp in form.find_all(["input", "textarea", "select"]):
                inputs.append({
                    "name": inp.get("name", ""),
                    "type": inp.get("type", "text"),
                    "id": inp.get("id", ""),
                })
            forms.append({
                "action": urljoin(base_url, action) if action else base_url,
                "method": method,
                "inputs": inputs,
            })

        # Extract API endpoints from JS
        for js_url in js_files:
            try:
                js_resp = requests.get(js_url, timeout=5, verify=False)
                # Find API paths in JS
                api_patterns = re.findall(
                    r'["\']/(api/[a-zA-Z0-9/_-]+)["\']', js_resp.text
                )
                for path in api_patterns:
                    links.add(urljoin(base_url, "/" + path))
            except Exception:
                pass

    except Exception as e:
        warn(f"Crawl failed: {e}")

    return links, js_files, forms


def run(target, config):
    """Discover endpoints on the target."""
    base_url = target if target.startswith("http") else f"https://{target}"

    info(f"Discovering endpoints on {base_url}")

    results = EndpointResults(base_url=base_url)

    # Crawl main page
    info("Crawling main page for links and resources")
    crawled_links, js_files, forms = _crawl_page(base_url)
    results.crawled_links = sorted(crawled_links)
    results.js_files = sorted(js_files)
    results.forms = forms

    # Brute-force common paths
    info(f"Testing {len(COMMON_PATHS)} common paths")
    with get_progress() as progress:
        task = progress.add_task("Discovering endpoints...", total=len(COMMON_PATHS))
        with ThreadPoolExecutor(max_workers=config.max_threads) as executor:
            futures = {
                executor.submit(_check_path, base_url, path): path
                for path in COMMON_PATHS
            }
            for future in as_completed(futures):
                progress.advance(task)
                result = future.result()
                if result is not None:
                    results.endpoints.append(result)

    results.endpoints.sort(key=lambda e: (not e.interesting, e.status_code))

    interesting = len([e for e in results.endpoints if e.interesting])
    success(
        f"Found {len(results.endpoints)} endpoints "
        f"({interesting} interesting), "
        f"{len(results.crawled_links)} crawled links, "
        f"{len(results.js_files)} JS files"
    )

    return results
