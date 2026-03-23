"""Technology stack detection module."""

import re
from dataclasses import dataclass, field

import requests
from bs4 import BeautifulSoup

from recon_engine.utils.logger import info, success, warn


# Signature patterns for technology detection
TECH_SIGNATURES = {
    "headers": {
        "X-Powered-By": {
            "Express": "Express.js",
            "PHP": "PHP",
            "ASP.NET": "ASP.NET",
            "Next.js": "Next.js",
        },
        "Server": {
            "nginx": "Nginx",
            "Apache": "Apache",
            "Microsoft-IIS": "IIS",
            "cloudflare": "Cloudflare",
            "LiteSpeed": "LiteSpeed",
            "gunicorn": "Gunicorn",
            "Werkzeug": "Werkzeug/Flask",
        },
        "X-AspNet-Version": {"": "ASP.NET"},
        "X-Generator": {
            "WordPress": "WordPress",
            "Drupal": "Drupal",
        },
    },
    "html_patterns": [
        (r'wp-content|wp-includes', "WordPress"),
        (r'Drupal\.settings', "Drupal"),
        (r'Joomla!', "Joomla"),
        (r'shopify\.com', "Shopify"),
        (r'cdn\.shopify', "Shopify"),
        (r'react', "React"),
        (r'__next', "Next.js"),
        (r'__nuxt', "Nuxt.js"),
        (r'ng-version', "Angular"),
        (r'vue\.js|vue\.min\.js|vue\.runtime', "Vue.js"),
        (r'svelte', "Svelte"),
        (r'jquery', "jQuery"),
        (r'bootstrap', "Bootstrap"),
        (r'tailwindcss|tailwind', "Tailwind CSS"),
        (r'cloudflare', "Cloudflare"),
        (r'google-analytics|gtag|GA_TRACKING', "Google Analytics"),
        (r'hotjar', "Hotjar"),
        (r'stripe\.js|stripe\.com', "Stripe"),
        (r'recaptcha', "reCAPTCHA"),
        (r'firebase', "Firebase"),
        (r'aws-sdk|amazonaws', "AWS"),
        (r'laravel', "Laravel"),
        (r'django', "Django"),
        (r'rails', "Ruby on Rails"),
        (r'spring', "Spring"),
    ],
    "cookie_patterns": {
        "PHPSESSID": "PHP",
        "JSESSIONID": "Java/Tomcat",
        "ASP.NET_SessionId": "ASP.NET",
        "csrftoken": "Django",
        "_rails": "Ruby on Rails",
        "laravel_session": "Laravel",
        "wordpress_": "WordPress",
        "wp-": "WordPress",
    },
}


@dataclass
class TechResult:
    url: str
    technologies: list = field(default_factory=list)
    headers_raw: dict = field(default_factory=dict)
    cookies: list = field(default_factory=list)
    meta_tags: dict = field(default_factory=dict)
    security_headers: dict = field(default_factory=dict)

    def to_dict(self):
        return {
            "url": self.url,
            "technologies": self.technologies,
            "headers_raw": self.headers_raw,
            "cookies": self.cookies,
            "meta_tags": self.meta_tags,
            "security_headers": self.security_headers,
        }


SECURITY_HEADERS = [
    "Strict-Transport-Security",
    "Content-Security-Policy",
    "X-Content-Type-Options",
    "X-Frame-Options",
    "X-XSS-Protection",
    "Referrer-Policy",
    "Permissions-Policy",
    "Cross-Origin-Opener-Policy",
    "Cross-Origin-Resource-Policy",
]


def _detect_from_headers(headers):
    """Detect technologies from HTTP response headers."""
    techs = set()
    for header_name, patterns in TECH_SIGNATURES["headers"].items():
        value = headers.get(header_name, "")
        if not value:
            continue
        for pattern, tech in patterns.items():
            if pattern == "" or pattern.lower() in value.lower():
                techs.add(tech)
    return techs


def _detect_from_html(html):
    """Detect technologies from HTML content."""
    techs = set()
    html_lower = html.lower()
    for pattern, tech in TECH_SIGNATURES["html_patterns"]:
        if re.search(pattern, html_lower):
            techs.add(tech)
    return techs


def _detect_from_cookies(cookies):
    """Detect technologies from cookie names."""
    techs = set()
    for cookie_name, tech in TECH_SIGNATURES["cookie_patterns"].items():
        for cookie in cookies:
            if cookie_name.lower() in cookie.lower():
                techs.add(tech)
    return techs


def _check_security_headers(headers):
    """Check which security headers are present/missing."""
    result = {}
    for header in SECURITY_HEADERS:
        value = headers.get(header, "")
        result[header] = {
            "present": bool(value),
            "value": value,
        }
    return result


def _extract_meta(soup):
    """Extract interesting meta tags."""
    meta = {}
    for tag in soup.find_all("meta"):
        name = tag.get("name", tag.get("property", ""))
        content = tag.get("content", "")
        if name and content:
            meta[name] = content[:200]
    return meta


def run(target, config):
    """Detect technologies used by the target."""
    urls = []
    if target.startswith("http"):
        urls.append(target)
    else:
        urls.extend([f"https://{target}", f"http://{target}"])

    all_techs = set()
    result = TechResult(url=target)

    for url in urls:
        try:
            info(f"Probing {url}")
            resp = requests.get(url, timeout=10, allow_redirects=True, verify=False)

            result.url = str(resp.url)
            result.headers_raw = dict(resp.headers)
            result.cookies = [f"{c.name}={c.value}" for c in resp.cookies]

            # Detect from headers
            header_techs = _detect_from_headers(resp.headers)
            all_techs.update(header_techs)

            # Detect from HTML
            html_techs = _detect_from_html(resp.text)
            all_techs.update(html_techs)

            # Detect from cookies
            cookie_techs = _detect_from_cookies(
                [c.name for c in resp.cookies]
            )
            all_techs.update(cookie_techs)

            # Security headers
            result.security_headers = _check_security_headers(resp.headers)

            # Meta tags
            soup = BeautifulSoup(resp.text, "html.parser")
            result.meta_tags = _extract_meta(soup)

            break  # Successfully got response

        except requests.exceptions.SSLError:
            warn(f"SSL error on {url}, trying next")
        except requests.exceptions.ConnectionError:
            warn(f"Connection failed to {url}")
        except Exception as e:
            warn(f"Error probing {url}: {e}")

    result.technologies = sorted(all_techs)
    success(f"Detected {len(result.technologies)} technologies")
    return result
