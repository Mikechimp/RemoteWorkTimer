/**
 * RECON OPERATIONAL INTERFACE — Application Controller
 *
 * Boot sequence, data hydration, intel feed, focus mode,
 * chain reactions, drawer, and all UI orchestration.
 */

(function () {
    'use strict';

    let map;
    let scanData = {};
    let findings = [];
    let summary = {};
    let startTime = Date.now();
    let intelQueue = [];

    // ============================================================
    // BOOT SEQUENCE
    // ============================================================

    const BOOT_LINES = [
        { text: 'RECON ENGINE v1.0.0', cls: 'ok', delay: 0 },
        { text: 'Loading kernel modules...', cls: 'ok', delay: 80 },
        { text: 'NET    [ok] socket interface', cls: 'ok', delay: 140 },
        { text: 'DNS    [ok] resolver initialized', cls: 'ok', delay: 200 },
        { text: 'SCAN   [ok] port scanner ready', cls: 'ok', delay: 280 },
        { text: 'ENUM   [ok] subdomain engine loaded', cls: 'ok', delay: 350 },
        { text: 'TECH   [ok] fingerprint database (2847 signatures)', cls: 'ok', delay: 420 },
        { text: 'DISC   [ok] endpoint discovery module', cls: 'ok', delay: 500 },
        { text: 'AI     [ok] analysis engine connected', cls: 'ok', delay: 600 },
        { text: 'VIZ    [ok] threat map renderer', cls: 'ok', delay: 680 },
        { text: '', cls: 'ok', delay: 750 },
        { text: 'Fetching scan data...', cls: 'warn', delay: 850 },
    ];

    function runBootSequence() {
        const container = document.getElementById('boot-lines');
        const statusText = document.getElementById('boot-status-text');

        BOOT_LINES.forEach((line, i) => {
            setTimeout(() => {
                const el = document.createElement('div');
                el.className = 'boot-line ' + line.cls;
                el.textContent = line.text;
                container.appendChild(el);
                container.scrollTop = container.scrollHeight;
            }, line.delay);
        });

        return new Promise(resolve => {
            setTimeout(async () => {
                statusText.textContent = 'LOADING DATA';
                try {
                    await loadData();
                    addBootLine(container, 'Data loaded. ' + findings.length + ' findings.', 'ready');
                    statusText.textContent = 'READY';

                    setTimeout(() => {
                        const boot = document.getElementById('boot-sequence');
                        boot.style.opacity = '0';
                        setTimeout(() => {
                            boot.classList.add('hidden');
                            document.getElementById('interface').classList.remove('hidden');
                            initInterface();
                        }, 400);
                    }, 600);
                } catch (err) {
                    addBootLine(container, 'ERROR: ' + err.message, 'warn');
                    statusText.textContent = 'FAILED';
                }
                resolve();
            }, 1000);
        });
    }

    function addBootLine(container, text, cls) {
        const el = document.createElement('div');
        el.className = 'boot-line ' + cls;
        el.textContent = text;
        container.appendChild(el);
    }

    // ============================================================
    // DATA LOADING
    // ============================================================

    async function loadData() {
        const [summaryRes, findingsRes, mapRes, fullRes] = await Promise.all([
            fetch('/api/summary').then(r => r.json()),
            fetch('/api/findings').then(r => r.json()),
            fetch('/api/threat-map').then(r => r.json()),
            fetch('/api/scan-data').then(r => r.json()),
        ]);
        summary = summaryRes;
        findings = findingsRes;
        scanData = fullRes;
        scanData._mapData = mapRes;
    }

    // ============================================================
    // INTERFACE INIT
    // ============================================================

    function initInterface() {
        populateStatusBar();
        populateFindings();
        populateChains();
        populateActions();
        initThreatMap();
        setupEvents();
        startElapsedTimer();
        buildIntelFeed();
    }

    // ---- Status Bar ----

    function populateStatusBar() {
        document.getElementById('sb-target').textContent = scanData.target || '—';

        const score = summary.risk_score || 0;
        const fill = document.getElementById('threat-fill');
        const val = document.getElementById('threat-score');
        fill.style.width = score + '%';
        val.textContent = score;

        if (score >= 70) {
            fill.style.background = 'var(--critical)';
            val.style.color = 'var(--critical)';
        } else if (score >= 45) {
            fill.style.background = 'var(--high)';
            val.style.color = 'var(--high)';
        } else if (score >= 20) {
            fill.style.background = 'var(--medium)';
            val.style.color = 'var(--medium)';
        } else {
            fill.style.background = 'var(--accent)';
            val.style.color = 'var(--accent)';
        }

        document.getElementById('sb-total').textContent = findings.length;
        document.getElementById('sb-crit').textContent =
            findings.filter(f => f.severity === 'CRITICAL').length;
        document.getElementById('sb-high').textContent =
            findings.filter(f => f.severity === 'HIGH').length;
    }

    function startElapsedTimer() {
        const el = document.getElementById('sb-time');
        setInterval(() => {
            const s = Math.floor((Date.now() - startTime) / 1000);
            const m = Math.floor(s / 60);
            el.textContent =
                String(m).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
        }, 1000);
    }

    // ---- Findings ----

    function populateFindings() {
        const list = document.getElementById('findings-list');
        list.innerHTML = '';
        for (const f of findings) {
            const sev = (f.severity || 'INFO').toLowerCase();
            const el = document.createElement('div');
            el.className = 'finding-item';
            el.dataset.severity = sev;
            el.dataset.id = f.id || '';

            const exploit = (f.exploitability || '').toLowerCase();
            let exploitCls = '';
            if (exploit.includes('easy')) exploitCls = 'easy';
            else if (exploit.includes('moderate')) exploitCls = 'moderate';

            el.innerHTML = `
                <div class="finding-sev-bar ${sev}"></div>
                <div class="finding-body">
                    <div class="finding-header">
                        <span class="finding-sev-tag ${sev}">${(f.severity || 'INFO').toUpperCase()}</span>
                        <span class="finding-title">${esc(f.title || 'Untitled')}</span>
                    </div>
                    <div class="finding-asset">${esc(f.affected_asset || '')}</div>
                    ${f.exploitability ? `<div class="finding-exploit ${exploitCls}">${esc(f.exploitability)}</div>` : ''}
                </div>
            `;

            el.addEventListener('click', () => {
                openDrawer(f);
                // Focus the map on this finding's node
                const node = map.nodes.find(n =>
                    n.label?.toLowerCase().includes(f.title?.toLowerCase()?.slice(0, 20)) ||
                    n.id?.toLowerCase() === f.id?.toLowerCase()
                );
                if (node && node.type === 'vulnerability') {
                    map.enterFocus(node);
                }
            });

            list.appendChild(el);
        }
    }

    // ---- Chains ----

    function populateChains() {
        const list = document.getElementById('chains-list');
        list.innerHTML = '';
        for (const chain of (summary.attack_chains || [])) {
            const sev = (chain.severity || 'MEDIUM').toLowerCase();
            const el = document.createElement('div');
            el.className = 'chain-card';

            const steps = (chain.steps || []).map((s, i) =>
                `<div class="chain-step-item"><span class="chain-step-num">${i + 1}.</span> ${esc(s)}</div>`
            ).join('');

            el.innerHTML = `
                <div class="chain-card-head">
                    <span class="chain-sev finding-sev-tag ${sev}">${chain.severity || 'MED'}</span>
                    <span class="chain-name">${esc(chain.name || '')}</span>
                    <span class="chain-likelihood">${esc(chain.likelihood || '')}</span>
                </div>
                <div class="chain-steps-list">${steps}</div>
            `;
            list.appendChild(el);
        }
    }

    // ---- Actions ----

    function populateActions() {
        const list = document.getElementById('actions-list');
        list.innerHTML = '';
        for (const step of (summary.next_steps || [])) {
            const tools = (step.tools || []).map(t =>
                `<span class="action-tool">${esc(t)}</span>`
            ).join('');

            const el = document.createElement('div');
            el.className = 'action-item';
            el.innerHTML = `
                <div class="action-priority">${step.priority || '?'}</div>
                <div class="action-body">
                    <div class="action-text">${esc(step.action || '')}</div>
                    <div class="action-reason">${esc(step.reason || '')}</div>
                    <div class="action-tools">${tools}</div>
                </div>
            `;
            list.appendChild(el);
        }
    }

    // ============================================================
    // INTEL FEED
    // ============================================================

    function buildIntelFeed() {
        const feed = document.getElementById('intel-feed');

        // Reconstruct events from scan data
        const events = [];
        const t = () => {
            const d = new Date();
            return String(d.getHours()).padStart(2, '0') + ':' +
                   String(d.getMinutes()).padStart(2, '0') + ':' +
                   String(d.getSeconds()).padStart(2, '0');
        };

        events.push({ type: 'phase', text: '— RECON INITIATED —' });
        events.push({ type: 'info', text: `Target acquired: ${scanData.target || 'unknown'}` });

        // Port scan results
        if (scanData.port_scan) {
            events.push({ type: 'phase', text: '— PORT SCAN —' });
            const ports = scanData.port_scan.ports || [];
            const openPorts = ports.filter(p => p.state === 'open');
            events.push({ type: 'discover', text: `${openPorts.length} open ports identified` });
            for (const p of openPorts.slice(0, 8)) {
                events.push({
                    type: 'discover',
                    text: `Port ${p.port}/${p.service}${p.version ? ' (' + p.version + ')' : ''}`
                });
            }
            if (openPorts.length > 8) {
                events.push({ type: 'info', text: `... +${openPorts.length - 8} more ports` });
            }
        }

        // Subdomains
        if (scanData.subdomains?.length) {
            events.push({ type: 'phase', text: '— SUBDOMAIN ENUM —' });
            events.push({ type: 'discover', text: `${scanData.subdomains.length} subdomains resolved` });
            for (const s of scanData.subdomains.slice(0, 6)) {
                events.push({ type: 'discover', text: `[+] ${s.subdomain} → ${s.ip}` });
            }
        }

        // Tech stack
        if (scanData.tech_stack?.technologies?.length) {
            events.push({ type: 'phase', text: '— TECH FINGERPRINT —' });
            events.push({
                type: 'discover',
                text: `Stack: ${scanData.tech_stack.technologies.join(', ')}`
            });
        }

        // Endpoints
        if (scanData.endpoints?.endpoints?.length) {
            events.push({ type: 'phase', text: '— ENDPOINT DISCOVERY —' });
            const interesting = scanData.endpoints.endpoints.filter(e => e.interesting);
            for (const ep of interesting.slice(0, 6)) {
                events.push({ type: 'exploit', text: `[!] ${ep.url} — ${ep.reason}` });
            }
            events.push({
                type: 'discover',
                text: `${scanData.endpoints.endpoints.length} endpoints, ${interesting.length} flagged`
            });
        }

        // AI findings
        if (findings.length) {
            events.push({ type: 'phase', text: '— AI TRIAGE COMPLETE —' });
            for (const f of findings) {
                const sev = f.severity || 'INFO';
                if (sev === 'CRITICAL') {
                    events.push({ type: 'critical', text: `[!!] ${f.title}` });
                } else if (sev === 'HIGH') {
                    events.push({ type: 'vuln', text: `[!] ${f.title}` });
                } else {
                    events.push({ type: 'discover', text: `[+] ${f.title}` });
                }
            }
        }

        events.push({ type: 'phase', text: '— OPERATIONAL —' });

        // Stream events with delay for realism
        events.forEach((ev, i) => {
            setTimeout(() => {
                appendIntelEntry(feed, ev.type, ev.text);
            }, i * 120);
        });
    }

    function appendIntelEntry(feed, type, text) {
        const el = document.createElement('div');
        el.className = `intel-entry type-${type}`;

        const ts = document.createElement('span');
        ts.className = 'timestamp';
        const now = new Date();
        ts.textContent = String(now.getHours()).padStart(2, '0') + ':' +
                         String(now.getMinutes()).padStart(2, '0') + ':' +
                         String(now.getSeconds()).padStart(2, '0');

        el.appendChild(ts);
        el.appendChild(document.createTextNode(text));
        feed.appendChild(el);
        feed.scrollTop = feed.scrollHeight;

        // Flicker on critical
        if (type === 'critical') {
            document.body.classList.add('flicker-once');
            setTimeout(() => document.body.classList.remove('flicker-once'), 300);
        }
    }

    // ============================================================
    // THREAT MAP
    // ============================================================

    function initThreatMap() {
        const canvas = document.getElementById('threat-map');
        map = new ThreatMap(canvas);

        const mapData = scanData._mapData || { nodes: [], edges: [] };
        map.setData(mapData.nodes || [], mapData.edges || []);
        map.start();

        // Tooltip
        const tooltip = document.getElementById('node-tooltip');
        canvas.addEventListener('node-hover', e => {
            if (e.detail?.node) {
                const n = e.detail.node;
                const stateLabel = (n.state || 'discovered').toUpperCase();
                tooltip.innerHTML = `
                    <div class="tt-label">${esc(n.label || '')}</div>
                    <div class="tt-type">${n.type || ''}</div>
                    ${n.details ? `<div class="tt-detail">${esc(n.details)}</div>` : ''}
                    <span class="tt-state ${n.state || 'discovered'}">${stateLabel}</span>
                `;
                tooltip.style.left = (e.detail.x + 12) + 'px';
                tooltip.style.top = (e.detail.y + 12) + 'px';
                tooltip.classList.remove('hidden');
            } else {
                tooltip.classList.add('hidden');
            }
        });

        // Double-click: enter focus mode + open drawer
        canvas.addEventListener('node-dblclick', e => {
            const node = e.detail;
            if (node.type === 'vulnerability') {
                map.enterFocus(node);
                const match = findings.find(f =>
                    f.title?.toLowerCase().includes(node.label?.toLowerCase()?.slice(0, 15)) ||
                    node.label?.toLowerCase().includes(f.id?.toLowerCase())
                );
                if (match) openDrawer(match);
            }
        });

        // Focus mode events
        canvas.addEventListener('focus-enter', e => {
            const overlay = document.getElementById('focus-overlay');
            overlay.classList.remove('hidden');
            document.getElementById('focus-title').textContent = e.detail.node.label || '';
            document.getElementById('sb-mode').textContent = 'FOCUS';
            document.getElementById('sb-mode').className = 'sb-mode exploiting';

            // Build chain visualization
            const chainEl = document.getElementById('focus-chain');
            chainEl.innerHTML = '';
            const chainIds = e.detail.chainIds || [];
            chainIds.forEach((id, i) => {
                const n = map.nodes.find(n => n.id === id);
                if (!n) return;
                if (i > 0) {
                    const arrow = document.createElement('span');
                    arrow.className = 'chain-arrow';
                    arrow.textContent = '→';
                    chainEl.appendChild(arrow);
                }
                const tag = document.createElement('span');
                tag.className = 'chain-node' + (n === e.detail.node ? ' active' : '');
                tag.textContent = n.label || n.id;
                chainEl.appendChild(tag);
            });
        });

        canvas.addEventListener('focus-exit', () => {
            document.getElementById('focus-overlay').classList.add('hidden');
            document.getElementById('sb-mode').textContent = 'RECON';
            document.getElementById('sb-mode').className = 'sb-mode';
        });

        // Controls
        document.getElementById('btn-zoom-in').addEventListener('click', () => map.zoomIn());
        document.getElementById('btn-zoom-out').addEventListener('click', () => map.zoomOut());
        document.getElementById('btn-reset').addEventListener('click', () => { map.resetView(); map.exitFocus(); });
        document.getElementById('btn-labels').addEventListener('click', () => map.toggleLabels());
    }

    // ============================================================
    // DETAIL DRAWER
    // ============================================================

    function openDrawer(finding) {
        const drawer = document.getElementById('detail-drawer');
        const sev = (finding.severity || 'INFO').toLowerCase();

        document.getElementById('drawer-sev').className = `drawer-sev finding-sev-tag ${sev}`;
        document.getElementById('drawer-sev').textContent = (finding.severity || 'INFO').toUpperCase();
        document.getElementById('drawer-id').textContent = finding.id || '';
        document.getElementById('drawer-title').textContent = finding.title || 'Untitled';

        const body = document.getElementById('drawer-body');
        body.innerHTML = '';

        const sections = [
            ['DESCRIPTION', finding.description, 'p'],
            ['AFFECTED ASSET', finding.affected_asset, 'p'],
            ['EVIDENCE', finding.evidence, 'pre'],
            ['EXPLOITABILITY', finding.exploitability, 'p'],
            ['IMPACT', finding.impact, 'p'],
            ['RECOMMENDATION', finding.recommendation, 'p'],
            ['TEST NEXT', finding.test_next, 'pre'],
        ];

        for (const [title, content, tag] of sections) {
            if (!content) continue;
            const sec = document.createElement('div');
            sec.className = 'drawer-section';
            sec.innerHTML = `<div class="drawer-section-head">${title}</div>`;
            const el = document.createElement(tag);
            el.textContent = content;
            sec.appendChild(el);
            body.appendChild(sec);
        }

        // CVEs
        if (finding.cve_references?.length) {
            const sec = document.createElement('div');
            sec.className = 'drawer-section';
            sec.innerHTML = `<div class="drawer-section-head">CVE REFERENCES</div>`;
            const cves = document.createElement('div');
            cves.className = 'drawer-cves';
            for (const cve of finding.cve_references) {
                const tag = document.createElement('span');
                tag.className = 'drawer-cve';
                tag.textContent = cve;
                cves.appendChild(tag);
            }
            sec.appendChild(cves);
            body.appendChild(sec);
        }

        // Show drawer
        drawer.classList.remove('hidden');
        requestAnimationFrame(() => drawer.classList.add('open'));
    }

    function closeDrawer() {
        const drawer = document.getElementById('detail-drawer');
        drawer.classList.remove('open');
        setTimeout(() => drawer.classList.add('hidden'), 260);
    }

    // ============================================================
    // EVENTS
    // ============================================================

    function setupEvents() {
        // Tabs
        document.querySelectorAll('.ops-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                document.querySelectorAll('.ops-tab').forEach(t => t.classList.remove('active'));
                document.querySelectorAll('.ops-content').forEach(c => c.classList.remove('active'));
                tab.classList.add('active');
                document.getElementById('tab-' + tab.dataset.tab).classList.add('active');
            });
        });

        // Severity filter
        document.querySelectorAll('.sev-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.sev-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                const sev = btn.dataset.sev;
                document.querySelectorAll('.finding-item').forEach(item => {
                    item.style.display = (sev === 'all' || item.dataset.severity === sev) ? '' : 'none';
                });
            });
        });

        // Drawer close
        document.getElementById('drawer-close').addEventListener('click', closeDrawer);

        // Focus exit
        document.getElementById('focus-exit').addEventListener('click', () => {
            map.exitFocus();
        });

        // Keyboard
        document.addEventListener('keydown', e => {
            if (e.key === 'Escape') {
                if (map.focusActive) map.exitFocus();
                closeDrawer();
            }
        });
    }

    // ============================================================
    // UTILITY
    // ============================================================

    function esc(str) {
        const d = document.createElement('div');
        d.textContent = str || '';
        return d.innerHTML;
    }

    // ============================================================
    // START
    // ============================================================

    document.addEventListener('DOMContentLoaded', runBootSequence);
})();
