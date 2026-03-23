"""Port scanning and service detection module."""

import json
import socket
import subprocess
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field

from recon_engine.utils.logger import info, success, warn, error, get_progress


@dataclass
class PortResult:
    port: int
    state: str
    service: str = ""
    version: str = ""
    banner: str = ""


@dataclass
class ScanResults:
    target: str
    ports: list = field(default_factory=list)
    os_guess: str = ""
    scan_type: str = ""

    def to_dict(self):
        return {
            "target": self.target,
            "os_guess": self.os_guess,
            "scan_type": self.scan_type,
            "ports": [
                {
                    "port": p.port,
                    "state": p.state,
                    "service": p.service,
                    "version": p.version,
                    "banner": p.banner,
                }
                for p in self.ports
            ],
        }


def _grab_banner(host, port, timeout=3):
    """Grab service banner from an open port."""
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(timeout)
        sock.connect((host, port))
        sock.send(b"HEAD / HTTP/1.1\r\nHost: %b\r\n\r\n" % host.encode())
        banner = sock.recv(1024).decode(errors="ignore").strip()
        sock.close()
        return banner[:200]
    except Exception:
        return ""


def _check_port(host, port, timeout=2):
    """Check if a single port is open using raw sockets."""
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(timeout)
        result = sock.connect_ex((host, port))
        sock.close()
        return port if result == 0 else None
    except Exception:
        return None


def scan_with_nmap(target, top_ports=1000, aggressive=False):
    """Run nmap scan if available."""
    try:
        import nmap
        nm = nmap.PortScanner()

        args = f"-sV --top-ports {top_ports}"
        if aggressive:
            args += " -A"

        info(f"Running nmap scan on {target} ({args})")
        nm.scan(target, arguments=args)

        results = ScanResults(target=target, scan_type="nmap")

        for host in nm.all_hosts():
            if "osmatch" in nm[host]:
                matches = nm[host]["osmatch"]
                if matches:
                    results.os_guess = matches[0].get("name", "")

            for proto in nm[host].all_protocols():
                ports = nm[host][proto].keys()
                for port in sorted(ports):
                    port_info = nm[host][proto][port]
                    results.ports.append(PortResult(
                        port=port,
                        state=port_info.get("state", ""),
                        service=port_info.get("name", ""),
                        version=f"{port_info.get('product', '')} {port_info.get('version', '')}".strip(),
                    ))

        return results

    except ImportError:
        warn("python-nmap not available, falling back to socket scan")
        return None
    except Exception as e:
        warn(f"nmap scan failed: {e}, falling back to socket scan")
        return None


def scan_with_sockets(target, ports=None, max_threads=100):
    """Fallback port scanner using raw sockets."""
    if ports is None:
        ports = list(range(1, 1025)) + [
            1433, 1521, 2049, 3306, 3389, 5432, 5900, 6379,
            8000, 8080, 8443, 8888, 9090, 9200, 27017,
        ]

    results = ScanResults(target=target, scan_type="socket")
    open_ports = []

    info(f"Socket scanning {target} ({len(ports)} ports)")

    with get_progress() as progress:
        task = progress.add_task("Scanning ports...", total=len(ports))
        with ThreadPoolExecutor(max_workers=max_threads) as executor:
            futures = {
                executor.submit(_check_port, target, port): port
                for port in ports
            }
            for future in as_completed(futures):
                progress.advance(task)
                result = future.result()
                if result is not None:
                    open_ports.append(result)

    for port in sorted(open_ports):
        banner = _grab_banner(target, port)
        service = _guess_service(port)
        results.ports.append(PortResult(
            port=port,
            state="open",
            service=service,
            banner=banner,
        ))

    return results


def _guess_service(port):
    """Guess service name from common port numbers."""
    common = {
        21: "ftp", 22: "ssh", 23: "telnet", 25: "smtp", 53: "dns",
        80: "http", 110: "pop3", 111: "rpc", 135: "msrpc", 139: "netbios",
        143: "imap", 443: "https", 445: "smb", 993: "imaps", 995: "pop3s",
        1433: "mssql", 1521: "oracle", 2049: "nfs", 3306: "mysql",
        3389: "rdp", 5432: "postgresql", 5900: "vnc", 6379: "redis",
        8000: "http-alt", 8080: "http-proxy", 8443: "https-alt",
        8888: "http-alt", 9090: "http-alt", 9200: "elasticsearch",
        27017: "mongodb",
    }
    return common.get(port, "unknown")


def run(target, config):
    """Execute port scanning with best available method."""
    results = scan_with_nmap(
        target,
        top_ports=config.top_ports,
        aggressive=config.aggressive_scan,
    )

    if results is None:
        results = scan_with_sockets(target, max_threads=config.max_threads)

    open_count = len([p for p in results.ports if p.state == "open"])
    success(f"Port scan complete: {open_count} open ports found")

    return results
