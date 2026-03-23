/**
 * AI Recon - Application Controller
 * Fetches data and wires up the UI.
 */

(function() {
    'use strict';

    let threatMap;
    let scanData = {};
    let findings = [];

    // Boot sequence
    async function init() {
        try {
            // Fetch all data
            const [summaryRes, findingsRes, threatMapRes, fullDataRes] = await Promise.all([
                fetch('/api/summary'),
                fetch('/api/findings'),
                fetch('/api/threat-map'),
                fetch('/api/scan-data'),
            ]);

            const summary = await summaryRes.json();
            findings = await findingsRes.json();
            const mapData = await threatMapRes.json();
            scanData = await fullDataRes.json();

            // Populate UI
            populateSummary(summary);
            populateFindings(findings);
            initThreatMap(mapData);
            setupEventListeners();

            // Hide loading screen
            setTimeout(() => {
                document.getElementById('loading-screen').style.opacity = '0';
                setTimeout(() => {
                    document.getElementById('loading-screen').classList.add('hidden');
                    document.getElementById('app').classList.remove('hidden');
                }, 500);
            }, 2000);

        } catch (err) {
            console.error('Failed to initialize:', err);
            document.querySelector('.loading-text').textContent = 'Error loading data: ' + err.message;
        }
    }

    function populateSummary(summary) {
        // Target name
        const target = scanData.target || 'Unknown';
        document.getElementById('target-name').textContent = target;

        // Risk score
        const score = summary.risk_score || 0;
        const riskFill = document.getElementById('risk-fill');
        const riskValue = document.getElementById('risk-score');
        riskFill.style.width = score + '%';
        riskValue.textContent = score;

        if (score >= 75) {
            riskFill.style.background = 'linear-gradient(90deg, #ff4444, #ff0040)';
            riskValue.style.color = '#ff0040';
        } else if (score >= 50) {
            riskFill.style.background = 'linear-gradient(90deg, #ffaa00, #ff4444)';
            riskValue.style.color = '#ffaa00';
        } else if (score >= 25) {
            riskFill.style.background = 'linear-gradient(90deg, #00aaff, #ffaa00)';
            riskValue.style.color = '#00aaff';
        } else {
            riskFill.style.background = 'linear-gradient(90deg, #00ff88, #00aaff)';
            riskValue.style.color = '#00ff88';
        }

        // Stats
        document.getElementById('stat-findings').textContent = findings.length;
        document.getElementById('stat-critical').textContent =
            findings.filter(f => f.severity === 'CRITICAL').length;
        document.getElementById('stat-high').textContent =
            findings.filter(f => f.severity === 'HIGH').length;

        // Executive summary
        document.getElementById('exec-summary').textContent =
            summary.executive_summary || 'No summary available.';

        // Attack surface
        const surface = summary.attack_surface || {};
        const surfaceEl = document.getElementById('attack-surface');
        surfaceEl.innerHTML = '';
        const metrics = [
            ['Entry Points', surface.total_entry_points || 0],
            ['Services', surface.external_services || 0],
            ['Web Apps', surface.web_applications || 0],
            ['Interesting', surface.interesting_endpoints || 0],
        ];
        for (const [label, value] of metrics) {
            surfaceEl.innerHTML += `
                <div class="surface-card">
                    <div class="surface-value">${value}</div>
                    <div class="surface-label">${label.toUpperCase()}</div>
                </div>`;
        }

        // Attack chains
        const chainsEl = document.getElementById('attack-chains');
        chainsEl.innerHTML = '';
        for (const chain of (summary.attack_chains || [])) {
            const stepsHtml = (chain.steps || [])
                .map(s => `<li class="chain-step">${s}</li>`).join('');
            chainsEl.innerHTML += `
                <div class="chain-card">
                    <div class="chain-name">
                        <span class="finding-severity severity-${chain.severity?.toLowerCase() || 'medium'}">${chain.severity || 'MEDIUM'}</span>
                        ${chain.name}
                    </div>
                    <ul class="chain-steps">${stepsHtml}</ul>
                </div>`;
        }

        // Next steps
        const stepsEl = document.getElementById('next-steps');
        stepsEl.innerHTML = '';
        for (const step of (summary.next_steps || [])) {
            const toolsHtml = (step.tools || [])
                .map(t => `<span class="tool-tag">${t}</span>`).join('');
            stepsEl.innerHTML += `
                <div class="next-step">
                    <div class="step-priority">${step.priority || '?'}</div>
                    <div>
                        <div class="step-action">${step.action || ''}</div>
                        <div class="step-reason">${step.reason || ''}</div>
                        <div class="step-tools">${toolsHtml}</div>
                    </div>
                </div>`;
        }
    }

    function populateFindings(findingsList) {
        const container = document.getElementById('findings-list');
        container.innerHTML = '';

        for (const finding of findingsList) {
            const sev = (finding.severity || 'INFO').toLowerCase();
            const card = document.createElement('div');
            card.className = `finding-card ${sev}`;
            card.dataset.severity = sev;
            card.innerHTML = `
                <span class="finding-severity severity-${sev}">${finding.severity || 'INFO'}</span>
                <div class="finding-title">${finding.title || 'Untitled'}</div>
                <div class="finding-asset">${finding.affected_asset || ''}</div>
            `;
            card.addEventListener('click', () => showFindingModal(finding));
            container.appendChild(card);
        }
    }

    function showFindingModal(finding) {
        const modal = document.getElementById('detail-modal');
        const body = document.getElementById('modal-body');
        const sev = (finding.severity || 'INFO').toLowerCase();

        body.innerHTML = `
            <span class="finding-severity severity-${sev}">${finding.severity}</span>
            <span class="finding-severity" style="margin-left:8px;background:rgba(136,85,255,0.2);color:#8855ff">${finding.id || ''}</span>
            <h2 class="modal-finding-title">${finding.title}</h2>

            <div class="modal-section">
                <h3>DESCRIPTION</h3>
                <p>${finding.description || 'N/A'}</p>
            </div>

            <div class="modal-section">
                <h3>AFFECTED ASSET</h3>
                <p>${finding.affected_asset || 'N/A'}</p>
            </div>

            <div class="modal-section">
                <h3>EVIDENCE</h3>
                <pre>${finding.evidence || 'N/A'}</pre>
            </div>

            <div class="modal-section">
                <h3>EXPLOITABILITY</h3>
                <p>${finding.exploitability || 'N/A'}</p>
            </div>

            <div class="modal-section">
                <h3>IMPACT</h3>
                <p>${finding.impact || 'N/A'}</p>
            </div>

            <div class="modal-section">
                <h3>RECOMMENDATION</h3>
                <p>${finding.recommendation || 'N/A'}</p>
            </div>

            ${finding.cve_references?.length ? `
            <div class="modal-section">
                <h3>CVE REFERENCES</h3>
                <p>${finding.cve_references.join(', ')}</p>
            </div>` : ''}

            <div class="modal-section">
                <h3>TEST NEXT</h3>
                <pre>${finding.test_next || 'N/A'}</pre>
            </div>
        `;

        modal.classList.remove('hidden');
    }

    function initThreatMap(mapData) {
        const canvas = document.getElementById('threat-map');
        threatMap = new ThreatMap(canvas);
        threatMap.setData(mapData.nodes || [], mapData.edges || []);
        threatMap.start();

        // Tooltip
        const tooltip = document.getElementById('node-tooltip');
        canvas.addEventListener('node-hover', (e) => {
            if (e.detail && e.detail.node) {
                const node = e.detail.node;
                tooltip.innerHTML = `
                    <div class="tooltip-title">${node.label}</div>
                    <div class="tooltip-detail">Type: ${node.type}</div>
                    <div class="tooltip-detail">Severity: ${node.severity || 'N/A'}</div>
                    ${node.details ? `<div class="tooltip-detail">${node.details}</div>` : ''}
                `;
                tooltip.style.left = (e.detail.x + 15) + 'px';
                tooltip.style.top = (e.detail.y + 15) + 'px';
                tooltip.classList.remove('hidden');
            } else {
                tooltip.classList.add('hidden');
            }
        });

        // Node double-click -> find matching finding
        canvas.addEventListener('node-dblclick', (e) => {
            const node = e.detail;
            if (node.type === 'vulnerability') {
                const match = findings.find(f =>
                    f.title?.toLowerCase().includes(node.label?.toLowerCase()) ||
                    node.label?.toLowerCase().includes(f.id?.toLowerCase())
                );
                if (match) showFindingModal(match);
            }
        });

        // Controls
        document.getElementById('btn-zoom-in').addEventListener('click', () => threatMap.zoomIn());
        document.getElementById('btn-zoom-out').addEventListener('click', () => threatMap.zoomOut());
        document.getElementById('btn-reset').addEventListener('click', () => threatMap.resetView());
        document.getElementById('btn-toggle-labels').addEventListener('click', () => threatMap.toggleLabels());
        document.getElementById('btn-toggle-particles').addEventListener('click', () => threatMap.toggleParticles());
    }

    function setupEventListeners() {
        // Severity filter buttons
        document.querySelectorAll('.filter-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                const filter = btn.dataset.filter;
                document.querySelectorAll('.finding-card').forEach(card => {
                    if (filter === 'all' || card.dataset.severity === filter) {
                        card.style.display = '';
                    } else {
                        card.style.display = 'none';
                    }
                });
            });
        });

        // Modal close
        document.querySelector('.modal-close').addEventListener('click', () => {
            document.getElementById('detail-modal').classList.add('hidden');
        });
        document.getElementById('detail-modal').addEventListener('click', (e) => {
            if (e.target === e.currentTarget) {
                e.currentTarget.classList.add('hidden');
            }
        });

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                document.getElementById('detail-modal').classList.add('hidden');
            }
        });
    }

    // Start
    document.addEventListener('DOMContentLoaded', init);
})();
