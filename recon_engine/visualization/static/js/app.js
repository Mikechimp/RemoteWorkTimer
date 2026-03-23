/**
 * RECON OPERATIONAL INTERFACE — Application Controller
 *
 * Boot sequence, data hydration, intel feed, focus mode,
 * chain engine integration, simulation, operation mode.
 */

(function () {
    'use strict';

    let map;
    let scanData = {};
    let findings = [];
    let summary = {};
    let chainData = {};  // computed chains from engine
    let startTime = Date.now();
    let operationMode = false;

    // ============================================================
    // BOOT SEQUENCE
    // ============================================================

    const BOOT_LINES = [
        { text: 'RECON ENGINE v2.0.0', cls: 'ok', delay: 0 },
        { text: 'Loading kernel modules...', cls: 'ok', delay: 80 },
        { text: 'NET    [ok] socket interface', cls: 'ok', delay: 140 },
        { text: 'DNS    [ok] resolver initialized', cls: 'ok', delay: 200 },
        { text: 'SCAN   [ok] port scanner ready', cls: 'ok', delay: 280 },
        { text: 'ENUM   [ok] subdomain engine loaded', cls: 'ok', delay: 350 },
        { text: 'TECH   [ok] fingerprint database (2847 signatures)', cls: 'ok', delay: 420 },
        { text: 'DISC   [ok] endpoint discovery module', cls: 'ok', delay: 500 },
        { text: 'AI     [ok] analysis engine connected', cls: 'ok', delay: 600 },
        { text: 'CHAIN  [ok] attack chain engine loaded', cls: 'ok', delay: 680 },
        { text: 'SCORE  [ok] scoring system initialized', cls: 'ok', delay: 740 },
        { text: 'VIZ    [ok] threat map renderer', cls: 'ok', delay: 800 },
        { text: '', cls: 'ok', delay: 860 },
        { text: 'Fetching scan data...', cls: 'warn', delay: 950 },
    ];

    function runBootSequence() {
        const container = document.getElementById('boot-lines');
        const statusText = document.getElementById('boot-status-text');

        BOOT_LINES.forEach((line) => {
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
                    addBootLine(container, (chainData.total_chains || 0) + ' attack chains computed.', 'ready');
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
            }, 1100);
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
        const [summaryRes, findingsRes, mapRes, fullRes, chainsRes] = await Promise.all([
            fetch('/api/summary').then(r => r.json()),
            fetch('/api/findings').then(r => r.json()),
            fetch('/api/threat-map').then(r => r.json()),
            fetch('/api/scan-data').then(r => r.json()),
            fetch('/api/chains').then(r => r.json()),
        ]);
        summary = summaryRes;
        findings = findingsRes;
        scanData = fullRes;
        scanData._mapData = mapRes;
        chainData = chainsRes;
    }

    // ============================================================
    // INTERFACE INIT
    // ============================================================

    function initInterface() {
        populateStatusBar();
        populateComputedChains();
        populateFindings();
        populateActions();
        populateRecommended();
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

        document.getElementById('sb-crit').textContent =
            findings.filter(f => f.severity === 'CRITICAL').length;
        document.getElementById('sb-high').textContent =
            findings.filter(f => f.severity === 'HIGH').length;
        document.getElementById('sb-chains').textContent = chainData.total_chains || 0;
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

    // ---- Recommended Action Bar ----

    function populateRecommended() {
        const rec = chainData.recommended;
        const bar = document.getElementById('recommended-bar');
        if (!rec) {
            bar.classList.add('hidden');
            return;
        }
        bar.classList.remove('hidden');
        document.getElementById('rec-action').textContent = rec.action;
        document.getElementById('rec-outcome').textContent = rec.expected_outcome;
        document.getElementById('rec-confidence').textContent = `(${Math.round(rec.confidence * 100)}%)`;
    }

    // ---- Computed Chains (primary tab) ----

    function populateComputedChains() {
        const list = document.getElementById('chains-list');
        list.innerHTML = '';

        const chains = chainData.chains || [];
        if (chains.length === 0) {
            // Fall back to AI-generated chains
            populateLegacyChains(list);
            return;
        }

        for (const chain of chains) {
            const el = document.createElement('div');
            el.className = 'computed-chain';
            el.dataset.chainId = chain.chain_id;

            const scoreCls = chain.score > 0.6 ? 'high-score' :
                             chain.score > 0.35 ? 'med-score' : 'low-score';

            const stepsHtml = (chain.steps || []).map(s => {
                const iconCls = s.node_type === 'vulnerability' ? 'vuln' :
                                s.node_type === 'service' ? 'service' : 'target';
                const icon = s.node_type === 'vulnerability' ? '◆' :
                             s.node_type === 'target' ? '⬡' : '●';
                const caps = s.capabilities_gained?.length
                    ? '+' + s.capabilities_gained.join(', +')
                    : '';
                return `<div class="cc-step">
                    <span class="cc-step-icon ${iconCls}">${icon}</span>
                    ${esc(s.node_label)}
                    ${caps ? `<span class="cc-step-caps">${esc(caps)}</span>` : ''}
                </div>`;
            }).join('');

            el.innerHTML = `
                <div class="cc-head">
                    <span class="cc-id">${chain.chain_id}</span>
                    <span class="cc-impact">${esc(chain.impact)}</span>
                    <span class="cc-score ${scoreCls}">${(chain.score * 100).toFixed(0)}</span>
                </div>
                <div class="cc-meta">
                    <span>${chain.length} steps</span>
                    <span>conf: ${(chain.confidence * 100).toFixed(0)}%</span>
                </div>
                <div class="cc-steps">${stepsHtml}</div>
                <div class="cc-actions">
                    <button class="cc-btn focus" data-chain-id="${chain.chain_id}">FOCUS</button>
                    <button class="cc-btn simulate" data-chain-id="${chain.chain_id}">SIMULATE</button>
                </div>
            `;

            // Click to highlight
            el.addEventListener('click', (e) => {
                if (e.target.classList.contains('cc-btn')) return;
                selectChain(chain);
            });

            list.appendChild(el);
        }

        // Wire up FOCUS and SIMULATE buttons
        list.querySelectorAll('.cc-btn.focus').forEach(btn => {
            btn.addEventListener('click', () => {
                const chain = chains.find(c => c.chain_id === btn.dataset.chainId);
                if (chain) focusChain(chain);
            });
        });

        list.querySelectorAll('.cc-btn.simulate').forEach(btn => {
            btn.addEventListener('click', () => {
                const chain = chains.find(c => c.chain_id === btn.dataset.chainId);
                if (chain) simulateChain(chain);
            });
        });
    }

    function populateLegacyChains(list) {
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

    // ---- Chain Selection & Focus ----

    function selectChain(chain) {
        // Highlight in list
        document.querySelectorAll('.computed-chain').forEach(el => {
            el.classList.toggle('active', el.dataset.chainId === chain.chain_id);
        });

        // Highlight on map
        if (map) {
            map.highlightChain(chain.node_ids || []);
        }
    }

    function focusChain(chain) {
        if (!map) return;
        const nodeIds = chain.node_ids || [];
        if (nodeIds.length === 0) return;

        // Enter focus mode on first vulnerability node
        const vulnId = (chain.steps || []).find(s => s.node_type === 'vulnerability')?.node_id;
        const targetNode = map.nodes.find(n => n.id === (vulnId || nodeIds[0]));
        if (targetNode) {
            map.enterFocus(targetNode);
        } else {
            map.highlightChain(nodeIds);
        }
    }

    // ---- Simulation ----

    function simulateChain(chain) {
        if (!map) return;
        const nodeIds = chain.node_ids || [];
        if (nodeIds.length === 0) return;

        map.startSimulation(nodeIds);
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
    // OPERATION MODE
    // ============================================================

    function toggleOperationMode() {
        operationMode = !operationMode;
        const toggle = document.getElementById('mode-toggle');
        const label = document.getElementById('mode-toggle-label');
        const modeText = document.getElementById('sb-mode');

        if (operationMode) {
            toggle.classList.add('active');
            label.textContent = 'OP';
            modeText.textContent = 'OPERATION';
            modeText.className = 'sb-mode exploiting';
            document.body.classList.add('operation-mode');

            // Collect all exploitable node IDs from chains
            const exploitable = new Set();
            for (const chain of (chainData.chains || [])) {
                for (const nid of (chain.node_ids || [])) {
                    exploitable.add(nid);
                }
            }
            map.setOperationMode(true, exploitable);
        } else {
            toggle.classList.remove('active');
            label.textContent = 'OP';
            modeText.textContent = 'RECON';
            modeText.className = 'sb-mode';
            document.body.classList.remove('operation-mode');
            map.setOperationMode(false);
        }
    }

    // ============================================================
    // INTEL FEED
    // ============================================================

    function buildIntelFeed() {
        const feed = document.getElementById('intel-feed');
        const events = [];

        events.push({ type: 'phase', text: '— RECON INITIATED —' });
        events.push({ type: 'info', text: `Target acquired: ${scanData.target || 'unknown'}` });

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
        }

        if (scanData.subdomains?.length) {
            events.push({ type: 'phase', text: '— SUBDOMAIN ENUM —' });
            events.push({ type: 'discover', text: `${scanData.subdomains.length} subdomains resolved` });
            for (const s of scanData.subdomains.slice(0, 6)) {
                events.push({ type: 'discover', text: `[+] ${s.subdomain} → ${s.ip}` });
            }
        }

        if (scanData.tech_stack?.technologies?.length) {
            events.push({ type: 'phase', text: '— TECH FINGERPRINT —' });
            events.push({
                type: 'discover',
                text: `Stack: ${scanData.tech_stack.technologies.join(', ')}`
            });
        }

        if (scanData.endpoints?.endpoints?.length) {
            events.push({ type: 'phase', text: '— ENDPOINT DISCOVERY —' });
            const interesting = scanData.endpoints.endpoints.filter(e => e.interesting);
            for (const ep of interesting.slice(0, 6)) {
                events.push({ type: 'exploit', text: `[!] ${ep.url} — ${ep.reason}` });
            }
        }

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

        // Chain computation results
        const chains = chainData.chains || [];
        if (chains.length) {
            events.push({ type: 'phase', text: '— CHAIN ANALYSIS —' });
            events.push({ type: 'exploit', text: `${chains.length} viable attack chains computed` });
            for (const chain of chains.slice(0, 3)) {
                events.push({
                    type: chain.score > 0.6 ? 'critical' : 'vuln',
                    text: `[>] ${chain.chain_id}: ${chain.impact} (score: ${(chain.score * 100).toFixed(0)})`
                });
            }
            if (chainData.recommended) {
                events.push({
                    type: 'critical',
                    text: `[RECOMMENDED] ${chainData.recommended.action} → ${chainData.recommended.expected_outcome}`
                });
            }
        }

        events.push({ type: 'phase', text: '— OPERATIONAL —' });

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
                const compromised = map.compromisedNodes.has(n.id) ? ' COMPROMISED' : '';
                tooltip.innerHTML = `
                    <div class="tt-label">${esc(n.label || '')}</div>
                    <div class="tt-type">${n.type || ''}${compromised ? ' <span style="color:var(--critical)">' + compromised + '</span>' : ''}</div>
                    ${n.details ? `<div class="tt-detail">${esc(n.details)}</div>` : ''}
                    ${n.confidence ? `<div class="tt-detail">Confidence: ${(n.confidence * 100).toFixed(0)}%</div>` : ''}
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
            if (!operationMode) {
                document.getElementById('sb-mode').textContent = 'FOCUS';
                document.getElementById('sb-mode').className = 'sb-mode exploiting';
            }

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
            if (!operationMode) {
                document.getElementById('sb-mode').textContent = 'RECON';
                document.getElementById('sb-mode').className = 'sb-mode';
            }
        });

        // Simulation events
        canvas.addEventListener('sim-start', e => {
            document.getElementById('sim-overlay').classList.remove('hidden');
            document.getElementById('sim-step-label').textContent = 'Initiating...';

            const progress = document.getElementById('sim-progress');
            progress.innerHTML = '';
            const nodeIds = e.detail.nodeIds || [];
            nodeIds.forEach((id, i) => {
                if (i > 0) {
                    const arrow = document.createElement('span');
                    arrow.className = 'sim-arrow';
                    arrow.textContent = '→';
                    progress.appendChild(arrow);
                }
                const node = map.nodes.find(n => n.id === id);
                const tag = document.createElement('span');
                tag.className = 'sim-node';
                tag.dataset.nodeId = id;
                tag.textContent = node?.label || id;
                progress.appendChild(tag);
            });

            appendIntelEntry(
                document.getElementById('intel-feed'),
                'phase', '— SIMULATION STARTED —'
            );
        });

        canvas.addEventListener('sim-step', e => {
            const { step, nodeId, nodeLabel, total } = e.detail;
            document.getElementById('sim-step-label').textContent =
                `Step ${step + 1}/${total}: ${nodeLabel}`;

            // Update progress nodes
            document.querySelectorAll('.sim-node').forEach(el => {
                if (el.dataset.nodeId === nodeId) {
                    el.classList.remove('active');
                    el.classList.add('completed');
                }
            });

            // Mark next as active
            const nextIdx = step + 1;
            const nextId = map.simChain[nextIdx];
            if (nextId) {
                document.querySelectorAll('.sim-node').forEach(el => {
                    if (el.dataset.nodeId === nextId) {
                        el.classList.add('active');
                    }
                });
            }

            // Intel feed
            const msgs = [
                `[+] ${nodeLabel} — access gained`,
                `[!] Capability escalation achieved`,
            ];
            const msg = step === total - 1 ? `[!!] ${nodeLabel} — COMPROMISED` : msgs[0];
            appendIntelEntry(
                document.getElementById('intel-feed'),
                step === total - 1 ? 'critical' : 'exploit',
                msg
            );
        });

        canvas.addEventListener('sim-complete', () => {
            document.getElementById('sim-step-label').textContent = 'COMPLETE';
            appendIntelEntry(
                document.getElementById('intel-feed'),
                'critical', '[!!] Simulation complete — chain fully exploited'
            );
        });

        canvas.addEventListener('sim-stop', () => {
            document.getElementById('sim-overlay').classList.add('hidden');
        });

        // Controls
        document.getElementById('btn-zoom-in').addEventListener('click', () => map.zoomIn());
        document.getElementById('btn-zoom-out').addEventListener('click', () => map.zoomOut());
        document.getElementById('btn-reset').addEventListener('click', () => {
            map.resetView();
            map.exitFocus();
            map.highlightChain(null);
            document.querySelectorAll('.computed-chain').forEach(el => el.classList.remove('active'));
        });
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
        document.getElementById('focus-exit').addEventListener('click', () => map.exitFocus());

        // Simulation stop
        document.getElementById('sim-stop').addEventListener('click', () => map.stopSimulation());

        // Operation mode toggle
        document.getElementById('mode-toggle').addEventListener('click', toggleOperationMode);

        // Recommended bar buttons
        document.getElementById('rec-simulate').addEventListener('click', () => {
            const rec = chainData.recommended;
            if (rec) {
                const chain = (chainData.chains || []).find(c => c.chain_id === rec.chain_id);
                if (chain) simulateChain(chain);
            }
        });

        document.getElementById('rec-focus').addEventListener('click', () => {
            const rec = chainData.recommended;
            if (rec) {
                const chain = (chainData.chains || []).find(c => c.chain_id === rec.chain_id);
                if (chain) focusChain(chain);
            }
        });

        // Keyboard
        document.addEventListener('keydown', e => {
            if (e.key === 'Escape') {
                if (map.simulating) map.stopSimulation();
                else if (map.focusActive) map.exitFocus();
                closeDrawer();
                map.highlightChain(null);
                document.querySelectorAll('.computed-chain').forEach(el => el.classList.remove('active'));
            }
            // 'O' toggles operation mode
            if (e.key === 'o' && !e.ctrlKey && !e.metaKey && document.activeElement === document.body) {
                toggleOperationMode();
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
