from setuptools import setup, find_packages

setup(
    name="ai-recon-engine",
    version="1.0.0",
    description="AI Recon & Vulnerability Triage Engine",
    packages=find_packages(),
    python_requires=">=3.10",
    install_requires=[
        "anthropic>=0.40.0",
        "python-nmap>=0.7.1",
        "requests>=2.31.0",
        "flask>=3.0.0",
        "python-dotenv>=1.0.0",
        "rich>=13.7.0",
        "dnspython>=2.6.0",
        "beautifulsoup4>=4.12.0",
        "click>=8.1.0",
    ],
    entry_points={
        "console_scripts": [
            "ai-recon=main:cli",
        ],
    },
)
