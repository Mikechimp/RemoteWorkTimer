/**
 * THREAT MAP — Operational Network Visualization
 *
 * Force-directed graph with:
 * - Organic breathing motion (nodes subtly shift)
 * - Critical node instability (jitter, pulse distortion)
 * - Attack path animation (active exploitation feel)
 * - Focus mode (isolate attack chains)
 * - Weighted drag (nodes feel heavy)
 * - State-driven node rendering (discovered → weaponized)
 */

class ThreatMap {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.nodes = [];
        this.edges = [];
        this.showLabels = true;

        // Camera
        this.camera = { x: 0, y: 0, zoom: 1 };
        this.targetCamera = { x: 0, y: 0, zoom: 1 };

        // Interaction
        this.hoveredNode = null;
        this.selectedNode = null;
        this.focusedNode = null; // Focus mode target
        this.dragNode = null;
        this.dragVelocity = { x: 0, y: 0 };
        this.isPanning = false;
        this.lastMouse = { x: 0, y: 0 };
        this.mouse = { x: 0, y: 0 };

        // Focus mode
        this.focusActive = false;
        this.focusChain = []; // node ids in the active chain
        this.focusFade = 0; // 0 = normal, 1 = fully focused

        // Animation
        this.time = 0;
        this.frameCount = 0;
        this.animationId = null;

        // Breathing simulation
        this.breathPhase = 0;

        // Colors — tactical palette
        this.palette = {
            critical: '#c41230',
            high: '#b83a1a',
            medium: '#8a6d1b',
            low: '#1a5c8a',
            info: '#3d3f4a',
            neutral: '#4a4d5a',
            target: '#c8cad0',
            service: '#2a7a3a',
            endpoint: '#3a6a8a',
            subdomain: '#5a5a8a',
            accent: '#3a8a9e',
            attackPath: '#c41230',
            connection: 'rgba(58, 138, 158, 0.12)',
            dataFlow: 'rgba(42, 122, 58, 0.15)',
        };

        this._setupCanvas();
        this._setupEvents();
    }

    // ---- SETUP ----

    _setupCanvas() {
        const resize = () => {
            const r = this.canvas.parentElement.getBoundingClientRect();
            const dpr = window.devicePixelRatio || 1;
            this.canvas.width = r.width * dpr;
            this.canvas.height = r.height * dpr;
            this.canvas.style.width = r.width + 'px';
            this.canvas.style.height = r.height + 'px';
            this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            this.width = r.width;
            this.height = r.height;
        };
        resize();
        window.addEventListener('resize', resize);
    }

    _setupEvents() {
        const c = this.canvas;
        c.addEventListener('mousemove', e => this._onMouseMove(e));
        c.addEventListener('mousedown', e => this._onMouseDown(e));
        c.addEventListener('mouseup', e => this._onMouseUp(e));
        c.addEventListener('mouseleave', () => this._onMouseLeave());
        c.addEventListener('wheel', e => this._onWheel(e), { passive: false });
        c.addEventListener('dblclick', e => this._onDblClick(e));
    }

    // ---- COORDINATE TRANSFORMS ----

    _screenToWorld(sx, sy) {
        return {
            x: (sx - this.width / 2) / this.camera.zoom + this.camera.x,
            y: (sy - this.height / 2) / this.camera.zoom + this.camera.y,
        };
    }

    _worldToScreen(wx, wy) {
        return {
            x: (wx - this.camera.x) * this.camera.zoom + this.width / 2,
            y: (wy - this.camera.y) * this.camera.zoom + this.height / 2,
        };
    }

    _getNodeAt(sx, sy) {
        const w = this._screenToWorld(sx, sy);
        for (let i = this.nodes.length - 1; i >= 0; i--) {
            const n = this.nodes[i];
            const dx = w.x - n.x;
            const dy = w.y - n.y;
            const r = (n.radius || 16) + 4;
            if (dx * dx + dy * dy < r * r) return n;
        }
        return null;
    }

    // ---- EVENTS ----

    _onMouseMove(e) {
        const rect = this.canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        this.mouse = { x: mx, y: my };

        if (this.dragNode) {
            // Weighted drag — node follows with inertia
            const w = this._screenToWorld(mx, my);
            const dx = w.x - this.dragNode.x;
            const dy = w.y - this.dragNode.y;
            // Heavier nodes drag slower
            const weight = this.dragNode.type === 'target' ? 0.3 : 0.5;
            this.dragNode.x += dx * weight;
            this.dragNode.y += dy * weight;
            this.dragNode.fx = this.dragNode.x;
            this.dragNode.fy = this.dragNode.y;
        } else if (this.isPanning) {
            const dx = (mx - this.lastMouse.x) / this.camera.zoom;
            const dy = (my - this.lastMouse.y) / this.camera.zoom;
            this.camera.x -= dx;
            this.camera.y -= dy;
            this.targetCamera.x = this.camera.x;
            this.targetCamera.y = this.camera.y;
        }

        this.lastMouse = { x: mx, y: my };
        const prev = this.hoveredNode;
        this.hoveredNode = this._getNodeAt(mx, my);

        if (this.hoveredNode !== prev) {
            if (this.hoveredNode) {
                this.canvas.dispatchEvent(new CustomEvent('node-hover', {
                    detail: { node: this.hoveredNode, x: e.clientX, y: e.clientY }
                }));
            } else {
                this.canvas.dispatchEvent(new CustomEvent('node-hover', { detail: null }));
            }
        }

        this.canvas.style.cursor = this.hoveredNode ? 'pointer' :
            (this.isPanning ? 'grabbing' : 'crosshair');
    }

    _onMouseDown(e) {
        const rect = this.canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        const node = this._getNodeAt(mx, my);

        if (node) {
            this.dragNode = node;
            this.selectedNode = node;
            this.canvas.dispatchEvent(new CustomEvent('node-select', { detail: node }));
        } else {
            this.isPanning = true;
            if (!this.focusActive) this.selectedNode = null;
        }
        this.lastMouse = { x: mx, y: my };
    }

    _onMouseUp() {
        if (this.dragNode) {
            delete this.dragNode.fx;
            delete this.dragNode.fy;
        }
        this.dragNode = null;
        this.isPanning = false;
    }

    _onMouseLeave() {
        this.hoveredNode = null;
        this.canvas.dispatchEvent(new CustomEvent('node-hover', { detail: null }));
    }

    _onWheel(e) {
        e.preventDefault();
        const factor = e.deltaY > 0 ? 0.92 : 1.08;
        this.targetCamera.zoom = Math.max(0.15, Math.min(4, this.targetCamera.zoom * factor));
    }

    _onDblClick(e) {
        const rect = this.canvas.getBoundingClientRect();
        const node = this._getNodeAt(e.clientX - rect.left, e.clientY - rect.top);
        if (node) {
            this.canvas.dispatchEvent(new CustomEvent('node-dblclick', { detail: node }));
        }
    }

    // ---- DATA ----

    setData(nodes, edges) {
        this.nodes = nodes.map((n, i) => {
            const isTarget = n.type === 'target';
            const angle = (i / nodes.length) * Math.PI * 2;
            const dist = isTarget ? 0 : 120 + Math.random() * 180;
            return {
                ...n,
                x: n.x || Math.cos(angle) * dist,
                y: n.y || Math.sin(angle) * dist,
                vx: 0,
                vy: 0,
                radius: isTarget ? 24 : this._nodeRadius(n),
                state: n.state || this._inferState(n),
                breathOffset: Math.random() * Math.PI * 2,
                jitterPhase: Math.random() * Math.PI * 2,
                // Visual opacity — used for focus mode fade
                opacity: 1,
                targetOpacity: 1,
            };
        });

        this.edges = edges.map(e => ({
            ...e,
            sourceNode: this.nodes.find(n => n.id === e.source),
            targetNode: this.nodes.find(n => n.id === e.target),
            particleProgress: Math.random(),
            particleSpeed: e.type === 'attack_path' ? (0.004 + Math.random() * 0.003) : (0.001 + Math.random() * 0.002),
        })).filter(e => e.sourceNode && e.targetNode);

        this._runLayout();
    }

    _nodeRadius(n) {
        if (n.type === 'vulnerability') {
            const map = { critical: 18, high: 15, medium: 13, low: 11, info: 9 };
            return map[n.severity] || 13;
        }
        return 11;
    }

    _inferState(n) {
        if (n.type === 'vulnerability') {
            if (n.severity === 'critical') return 'weaponized';
            if (n.severity === 'high') return 'exploitable';
            return 'analyzed';
        }
        return 'discovered';
    }

    _runLayout() {
        for (let iter = 0; iter < 120; iter++) {
            // Repulsion
            for (let i = 0; i < this.nodes.length; i++) {
                for (let j = i + 1; j < this.nodes.length; j++) {
                    const a = this.nodes[i], b = this.nodes[j];
                    let dx = b.x - a.x, dy = b.y - a.y;
                    let d = Math.sqrt(dx * dx + dy * dy) || 1;
                    let f = 4000 / (d * d);
                    let fx = (dx / d) * f, fy = (dy / d) * f;
                    if (!a.fx) { a.x -= fx; a.y -= fy; }
                    if (!b.fx) { b.x += fx; b.y += fy; }
                }
            }
            // Attraction
            for (const e of this.edges) {
                const a = e.sourceNode, b = e.targetNode;
                if (!a || !b) continue;
                let dx = b.x - a.x, dy = b.y - a.y;
                let d = Math.sqrt(dx * dx + dy * dy) || 1;
                let f = (d - 100) * 0.008;
                let fx = (dx / d) * f, fy = (dy / d) * f;
                if (!a.fx) { a.x += fx; a.y += fy; }
                if (!b.fx) { b.x -= fx; b.y -= fy; }
            }
        }
    }

    // ---- FOCUS MODE ----

    enterFocus(node) {
        if (!node) return;
        this.focusActive = true;
        this.focusedNode = node;

        // Find all nodes in this attack chain
        const chainIds = new Set([node.id]);
        const findConnected = (nodeId, depth) => {
            if (depth > 6) return;
            for (const e of this.edges) {
                if (e.type === 'attack_path' || e.type === 'connection') {
                    if (e.source === nodeId && !chainIds.has(e.target)) {
                        chainIds.add(e.target);
                        findConnected(e.target, depth + 1);
                    }
                    if (e.target === nodeId && !chainIds.has(e.source)) {
                        chainIds.add(e.source);
                        findConnected(e.source, depth + 1);
                    }
                }
            }
        };
        findConnected(node.id, 0);
        this.focusChain = chainIds;

        // Set target opacities
        for (const n of this.nodes) {
            n.targetOpacity = chainIds.has(n.id) ? 1 : 0.06;
        }

        // Pan to center the focused node
        this.targetCamera.x = node.x;
        this.targetCamera.y = node.y;
        this.targetCamera.zoom = Math.max(this.camera.zoom, 1.2);

        this.canvas.dispatchEvent(new CustomEvent('focus-enter', {
            detail: { node, chainIds: [...chainIds] }
        }));
    }

    exitFocus() {
        this.focusActive = false;
        this.focusedNode = null;
        this.focusChain = [];
        for (const n of this.nodes) {
            n.targetOpacity = 1;
        }
        this.canvas.dispatchEvent(new CustomEvent('focus-exit'));
    }

    // ---- CONTROLS ----

    zoomIn() { this.targetCamera.zoom = Math.min(4, this.targetCamera.zoom * 1.25); }
    zoomOut() { this.targetCamera.zoom = Math.max(0.15, this.targetCamera.zoom * 0.75); }
    resetView() { this.targetCamera = { x: 0, y: 0, zoom: 1 }; }
    toggleLabels() { this.showLabels = !this.showLabels; }

    // ---- ANIMATION LOOP ----

    start() {
        let lastTime = performance.now();
        const loop = (now) => {
            const dt = Math.min((now - lastTime) / 1000, 0.05);
            lastTime = now;
            this.time += dt;
            this.frameCount++;
            this._update(dt);
            this._render();
            this.animationId = requestAnimationFrame(loop);
        };
        this.animationId = requestAnimationFrame(loop);
    }

    stop() {
        if (this.animationId) cancelAnimationFrame(this.animationId);
    }

    _update(dt) {
        // Smooth camera
        this.camera.x += (this.targetCamera.x - this.camera.x) * 4 * dt;
        this.camera.y += (this.targetCamera.y - this.camera.y) * 4 * dt;
        this.camera.zoom += (this.targetCamera.zoom - this.camera.zoom) * 4 * dt;

        // Breathing
        this.breathPhase += dt * 0.4;

        // Update nodes
        for (const n of this.nodes) {
            // Fade opacity toward target
            n.opacity += (n.targetOpacity - n.opacity) * 3 * dt;

            // Breathing motion — very subtle organic shift
            if (!n.fx) {
                const bx = Math.sin(this.breathPhase + n.breathOffset) * 0.15;
                const by = Math.cos(this.breathPhase * 0.7 + n.breathOffset) * 0.1;
                n.x += bx;
                n.y += by;
            }

            // Critical jitter — unstable feeling
            if (n.severity === 'critical' && n.type === 'vulnerability') {
                const jitter = Math.sin(this.time * 15 + n.jitterPhase);
                n.jitterX = jitter * 1.2;
                n.jitterY = Math.cos(this.time * 12 + n.jitterPhase) * 0.8;
            } else if (n.severity === 'high' && n.type === 'vulnerability') {
                n.jitterX = Math.sin(this.time * 8 + n.jitterPhase) * 0.4;
                n.jitterY = Math.cos(this.time * 6 + n.jitterPhase) * 0.3;
            } else {
                n.jitterX = 0;
                n.jitterY = 0;
            }
        }

        // Update edge particles
        for (const e of this.edges) {
            e.particleProgress += e.particleSpeed;
            if (e.particleProgress > 1) e.particleProgress -= 1;
        }
    }

    // ---- RENDERING ----

    _render() {
        const ctx = this.ctx;
        ctx.clearRect(0, 0, this.width, this.height);

        ctx.save();
        ctx.translate(this.width / 2, this.height / 2);
        ctx.scale(this.camera.zoom, this.camera.zoom);
        ctx.translate(-this.camera.x, -this.camera.y);

        this._renderEdges(ctx);
        this._renderNodes(ctx);

        ctx.restore();
    }

    _renderEdges(ctx) {
        for (const e of this.edges) {
            const a = e.sourceNode, b = e.targetNode;
            if (!a || !b) continue;

            const opacity = Math.min(a.opacity, b.opacity);
            if (opacity < 0.02) continue;

            const ax = a.x + (a.jitterX || 0);
            const ay = a.y + (a.jitterY || 0);
            const bx = b.x + (b.jitterX || 0);
            const by = b.y + (b.jitterY || 0);

            ctx.globalAlpha = opacity;

            if (e.type === 'attack_path') {
                this._renderAttackPath(ctx, ax, ay, bx, by, e);
            } else if (e.type === 'data_flow') {
                ctx.beginPath();
                ctx.moveTo(ax, ay);
                ctx.lineTo(bx, by);
                ctx.strokeStyle = this.palette.dataFlow;
                ctx.lineWidth = 1;
                ctx.setLineDash([3, 5]);
                ctx.stroke();
                ctx.setLineDash([]);
            } else {
                ctx.beginPath();
                ctx.moveTo(ax, ay);
                ctx.lineTo(bx, by);
                ctx.strokeStyle = this.palette.connection;
                ctx.lineWidth = 0.8;
                ctx.stroke();
            }

            // Edge label
            if (this.showLabels && e.label && this.camera.zoom > 0.7 && opacity > 0.3) {
                const mx = (ax + bx) / 2, my = (ay + by) / 2;
                ctx.font = '8px "JetBrains Mono", monospace';
                ctx.fillStyle = `rgba(107, 110, 122, ${opacity * 0.5})`;
                ctx.textAlign = 'center';
                ctx.fillText(e.label, mx, my - 4);
            }

            ctx.globalAlpha = 1;
        }
    }

    _renderAttackPath(ctx, ax, ay, bx, by, edge) {
        // Main line — dashed, pulsing
        const pulse = Math.sin(this.time * 2) * 0.15 + 0.4;

        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(bx, by);
        ctx.strokeStyle = `rgba(196, 18, 48, ${pulse})`;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([6, 4]);
        ctx.lineDashOffset = -this.time * 30;
        ctx.stroke();
        ctx.setLineDash([]);

        // Faint glow under the line
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(bx, by);
        ctx.strokeStyle = `rgba(196, 18, 48, ${pulse * 0.15})`;
        ctx.lineWidth = 6;
        ctx.stroke();

        // Particle moving along path
        const p = edge.particleProgress;
        const px = ax + (bx - ax) * p;
        const py = ay + (by - ay) * p;
        const alpha = Math.sin(p * Math.PI) * 0.9;

        // Particle core
        ctx.beginPath();
        ctx.arc(px, py, 2, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(196, 18, 48, ${alpha})`;
        ctx.fill();

        // Particle glow
        ctx.beginPath();
        ctx.arc(px, py, 6, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(196, 18, 48, ${alpha * 0.2})`;
        ctx.fill();

        // Direction indicator (small arrow)
        if (this.camera.zoom > 0.5) {
            const mx = (ax + bx) / 2, my = (ay + by) / 2;
            const angle = Math.atan2(by - ay, bx - ax);
            ctx.save();
            ctx.translate(mx, my);
            ctx.rotate(angle);
            ctx.beginPath();
            ctx.moveTo(4, 0);
            ctx.lineTo(-2, -2.5);
            ctx.lineTo(-2, 2.5);
            ctx.closePath();
            ctx.fillStyle = `rgba(196, 18, 48, ${pulse * 0.6})`;
            ctx.fill();
            ctx.restore();
        }
    }

    _renderNodes(ctx) {
        // Sort: render focused/selected nodes last (on top)
        const sorted = [...this.nodes].sort((a, b) => {
            if (a === this.selectedNode) return 1;
            if (b === this.selectedNode) return -1;
            return 0;
        });

        for (const n of sorted) {
            if (n.opacity < 0.02) continue;

            const nx = n.x + (n.jitterX || 0);
            const ny = n.y + (n.jitterY || 0);
            const r = n.radius;
            const isHovered = n === this.hoveredNode;
            const isSelected = n === this.selectedNode;
            const isFocused = this.focusActive && this.focusChain.has?.(n.id);

            ctx.globalAlpha = n.opacity;

            // Severity glow — only for critical/high vulnerabilities
            if (n.type === 'vulnerability' && (n.severity === 'critical' || n.severity === 'high')) {
                const glowColor = n.severity === 'critical' ? this.palette.critical : this.palette.high;
                const glowPulse = Math.sin(this.time * (n.severity === 'critical' ? 3 : 2) + n.breathOffset) * 0.3 + 0.5;
                const glowR = r * 2.5 * glowPulse;
                const grad = ctx.createRadialGradient(nx, ny, r * 0.3, nx, ny, glowR);
                grad.addColorStop(0, this._hex2rgba(glowColor, 0.15 * glowPulse));
                grad.addColorStop(1, this._hex2rgba(glowColor, 0));
                ctx.beginPath();
                ctx.arc(nx, ny, glowR, 0, Math.PI * 2);
                ctx.fillStyle = grad;
                ctx.fill();
            }

            // Selection ring
            if (isSelected) {
                ctx.beginPath();
                ctx.arc(nx, ny, r + 6, 0, Math.PI * 2);
                ctx.strokeStyle = 'rgba(58, 138, 158, 0.4)';
                ctx.lineWidth = 1;
                ctx.setLineDash([3, 3]);
                ctx.lineDashOffset = -this.time * 15;
                ctx.stroke();
                ctx.setLineDash([]);
            }

            // Node shape
            const color = this._nodeColor(n);

            if (n.type === 'target') {
                this._drawTarget(ctx, nx, ny, r, color, n);
            } else if (n.type === 'vulnerability') {
                this._drawVulnerability(ctx, nx, ny, r, color, n);
            } else {
                this._drawService(ctx, nx, ny, r, color, n);
            }

            // State indicator — tiny dot below the node
            if (this.camera.zoom > 0.6 && n.opacity > 0.4) {
                const stateColors = {
                    discovered: '#3a8a9e',
                    analyzed: '#8a6d1b',
                    exploitable: '#b83a1a',
                    weaponized: '#c41230',
                };
                const sc = stateColors[n.state] || '#3d3f4a';
                ctx.beginPath();
                ctx.arc(nx, ny + r + 5, 1.5, 0, Math.PI * 2);
                ctx.fillStyle = sc;
                ctx.fill();
            }

            // Label
            if (this.showLabels && this.camera.zoom > 0.45 && n.opacity > 0.3) {
                const label = n.label || '';
                ctx.font = '9px "JetBrains Mono", monospace';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'top';

                const tw = ctx.measureText(label).width;
                const lx = nx - tw / 2 - 3;
                const ly = ny + r + 8;

                ctx.fillStyle = `rgba(8, 9, 13, ${n.opacity * 0.85})`;
                ctx.fillRect(lx, ly, tw + 6, 13);

                ctx.fillStyle = isHovered
                    ? `rgba(200, 202, 208, ${n.opacity})`
                    : `rgba(107, 110, 122, ${n.opacity * 0.8})`;
                ctx.fillText(label, nx, ly + 2);
            }

            ctx.globalAlpha = 1;
        }
    }

    // ---- NODE SHAPES ----

    _drawTarget(ctx, x, y, r, color, node) {
        // Hexagon — solid, heavy, hardened
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
            const a = (Math.PI / 3) * i - Math.PI / 6;
            const px = x + r * Math.cos(a);
            const py = y + r * Math.sin(a);
            if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.closePath();

        // Fill — solid with slight gradient
        const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
        grad.addColorStop(0, 'rgba(20, 21, 29, 0.9)');
        grad.addColorStop(1, 'rgba(12, 13, 18, 0.95)');
        ctx.fillStyle = grad;
        ctx.fill();

        // Border — double stroke for hardened feel
        ctx.strokeStyle = `rgba(200, 202, 208, 0.5)`;
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Inner hex
        ctx.beginPath();
        const ir = r * 0.65;
        for (let i = 0; i < 6; i++) {
            const a = (Math.PI / 3) * i;
            const px = x + ir * Math.cos(a);
            const py = y + ir * Math.sin(a);
            if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.strokeStyle = 'rgba(200, 202, 208, 0.15)';
        ctx.lineWidth = 0.5;
        ctx.stroke();

        // Center crosshair
        ctx.beginPath();
        ctx.moveTo(x - 4, y); ctx.lineTo(x + 4, y);
        ctx.moveTo(x, y - 4); ctx.lineTo(x, y + 4);
        ctx.strokeStyle = 'rgba(200, 202, 208, 0.3)';
        ctx.lineWidth = 0.5;
        ctx.stroke();
    }

    _drawVulnerability(ctx, x, y, r, color, node) {
        // Diamond — fractured, unstable
        const distortion = node.severity === 'critical'
            ? Math.sin(this.time * 6 + node.jitterPhase) * 1.5
            : (node.severity === 'high' ? Math.sin(this.time * 3) * 0.5 : 0);

        ctx.beginPath();
        ctx.moveTo(x + distortion, y - r);
        ctx.lineTo(x + r * 0.75, y + distortion * 0.5);
        ctx.lineTo(x - distortion * 0.3, y + r);
        ctx.lineTo(x - r * 0.75, y - distortion * 0.3);
        ctx.closePath();

        // Fill
        ctx.fillStyle = this._hex2rgba(color, 0.12);
        ctx.fill();

        // Border
        ctx.strokeStyle = this._hex2rgba(color, 0.7);
        ctx.lineWidth = 1.2;
        ctx.stroke();

        // Fracture lines for critical
        if (node.severity === 'critical') {
            ctx.beginPath();
            ctx.moveTo(x - r * 0.3, y - r * 0.4);
            ctx.lineTo(x + r * 0.1, y + r * 0.1);
            ctx.lineTo(x + r * 0.4, y + r * 0.5);
            ctx.strokeStyle = this._hex2rgba(color, 0.25);
            ctx.lineWidth = 0.5;
            ctx.stroke();
        }
    }

    _drawService(ctx, x, y, r, color, node) {
        // Circle — lightweight, subtle flicker for instability
        const flicker = node.type === 'endpoint'
            ? (Math.sin(this.time * 4 + node.breathOffset) > 0.8 ? 0.7 : 1)
            : 1;

        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);

        ctx.fillStyle = this._hex2rgba(color, 0.08 * flicker);
        ctx.fill();

        ctx.strokeStyle = this._hex2rgba(color, 0.4 * flicker);
        ctx.lineWidth = 0.8;
        ctx.stroke();
    }

    // ---- HELPERS ----

    _nodeColor(n) {
        if (n.type === 'vulnerability') {
            return this.palette[n.severity] || this.palette.info;
        }
        return this.palette[n.type] || this.palette.neutral;
    }

    _hex2rgba(hex, alpha) {
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        return `rgba(${r},${g},${b},${alpha})`;
    }

    // ---- INJECT NODE (for AI materialization) ----

    injectNode(nodeData) {
        const n = {
            ...nodeData,
            x: (Math.random() - 0.5) * 200,
            y: (Math.random() - 0.5) * 200,
            vx: 0, vy: 0,
            radius: nodeData.type === 'target' ? 24 : this._nodeRadius(nodeData),
            state: nodeData.state || this._inferState(nodeData),
            breathOffset: Math.random() * Math.PI * 2,
            jitterPhase: Math.random() * Math.PI * 2,
            opacity: 0, // Start invisible, fade in
            targetOpacity: this.focusActive ? 0.06 : 1,
        };

        // Materialize: fade in over time
        n.targetOpacity = 1;
        this.nodes.push(n);
        return n;
    }

    injectEdge(edgeData) {
        const e = {
            ...edgeData,
            sourceNode: this.nodes.find(n => n.id === edgeData.source),
            targetNode: this.nodes.find(n => n.id === edgeData.target),
            particleProgress: 0,
            particleSpeed: edgeData.type === 'attack_path' ? 0.005 : 0.002,
        };
        if (e.sourceNode && e.targetNode) {
            this.edges.push(e);
        }
    }
}
