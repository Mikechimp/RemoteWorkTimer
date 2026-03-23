/**
 * Threat Map - Interactive Canvas-based Network Visualization
 * A game-like, GPU-accelerated threat map renderer.
 */

class ThreatMap {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.nodes = [];
        this.edges = [];
        this.particles = [];
        this.showLabels = true;
        this.showParticles = true;

        // Camera
        this.camera = { x: 0, y: 0, zoom: 1 };
        this.targetCamera = { x: 0, y: 0, zoom: 1 };

        // Interaction
        this.hoveredNode = null;
        this.selectedNode = null;
        this.dragNode = null;
        this.isDragging = false;
        this.isPanning = false;
        this.lastMouse = { x: 0, y: 0 };
        this.mouse = { x: 0, y: 0 };

        // Animation
        this.time = 0;
        this.animationId = null;

        // Colors
        this.severityColors = {
            critical: '#ff0040',
            high: '#ff4444',
            medium: '#ffaa00',
            low: '#00aaff',
            info: '#4a5568',
            neutral: '#ffffff',
        };

        this.typeColors = {
            target: '#ffffff',
            service: '#00ff88',
            vulnerability: '#ff4444',
            endpoint: '#8855ff',
            subdomain: '#00aaff',
        };

        this._setupCanvas();
        this._setupEvents();
    }

    _setupCanvas() {
        const resize = () => {
            const rect = this.canvas.parentElement.getBoundingClientRect();
            this.canvas.width = rect.width * window.devicePixelRatio;
            this.canvas.height = rect.height * window.devicePixelRatio;
            this.canvas.style.width = rect.width + 'px';
            this.canvas.style.height = rect.height + 'px';
            this.ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
        };
        resize();
        window.addEventListener('resize', resize);
    }

    _setupEvents() {
        this.canvas.addEventListener('mousemove', (e) => this._onMouseMove(e));
        this.canvas.addEventListener('mousedown', (e) => this._onMouseDown(e));
        this.canvas.addEventListener('mouseup', (e) => this._onMouseUp(e));
        this.canvas.addEventListener('wheel', (e) => this._onWheel(e));
        this.canvas.addEventListener('dblclick', (e) => this._onDblClick(e));
    }

    _screenToWorld(sx, sy) {
        const rect = this.canvas.getBoundingClientRect();
        return {
            x: (sx - rect.width / 2) / this.camera.zoom + this.camera.x,
            y: (sy - rect.height / 2) / this.camera.zoom + this.camera.y,
        };
    }

    _worldToScreen(wx, wy) {
        const rect = this.canvas.getBoundingClientRect();
        return {
            x: (wx - this.camera.x) * this.camera.zoom + rect.width / 2,
            y: (wy - this.camera.y) * this.camera.zoom + rect.height / 2,
        };
    }

    _getNodeAt(sx, sy) {
        const world = this._screenToWorld(sx, sy);
        for (let i = this.nodes.length - 1; i >= 0; i--) {
            const node = this.nodes[i];
            const dx = world.x - node.x;
            const dy = world.y - node.y;
            const r = node.radius || 20;
            if (dx * dx + dy * dy < r * r) return node;
        }
        return null;
    }

    _onMouseMove(e) {
        const rect = this.canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        this.mouse = { x: mx, y: my };

        if (this.dragNode) {
            const world = this._screenToWorld(mx, my);
            this.dragNode.x = world.x;
            this.dragNode.y = world.y;
            this.dragNode.fx = world.x;
            this.dragNode.fy = world.y;
        } else if (this.isPanning) {
            const dx = (mx - this.lastMouse.x) / this.camera.zoom;
            const dy = (my - this.lastMouse.y) / this.camera.zoom;
            this.camera.x -= dx;
            this.camera.y -= dy;
            this.targetCamera.x = this.camera.x;
            this.targetCamera.y = this.camera.y;
        }

        this.lastMouse = { x: mx, y: my };
        this.hoveredNode = this._getNodeAt(mx, my);
        this.canvas.style.cursor = this.hoveredNode ? 'pointer' : (this.isPanning ? 'grabbing' : 'grab');

        // Dispatch tooltip event
        if (this.hoveredNode) {
            this.canvas.dispatchEvent(new CustomEvent('node-hover', {
                detail: { node: this.hoveredNode, x: e.clientX, y: e.clientY }
            }));
        } else {
            this.canvas.dispatchEvent(new CustomEvent('node-hover', { detail: null }));
        }
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
            this.selectedNode = null;
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

    _onWheel(e) {
        e.preventDefault();
        const delta = e.deltaY > 0 ? 0.9 : 1.1;
        this.targetCamera.zoom = Math.max(0.2, Math.min(5, this.targetCamera.zoom * delta));
    }

    _onDblClick(e) {
        const rect = this.canvas.getBoundingClientRect();
        const node = this._getNodeAt(e.clientX - rect.left, e.clientY - rect.top);
        if (node) {
            this.canvas.dispatchEvent(new CustomEvent('node-dblclick', { detail: node }));
        }
    }

    setData(nodes, edges) {
        // Layout nodes if no positions
        this.nodes = nodes.map((n, i) => {
            const angle = (i / nodes.length) * Math.PI * 2;
            const isTarget = n.type === 'target';
            const radius = isTarget ? 0 : 150 + Math.random() * 200;
            return {
                ...n,
                x: n.x || Math.cos(angle) * radius,
                y: n.y || Math.sin(angle) * radius,
                vx: 0,
                vy: 0,
                radius: isTarget ? 30 : this._getNodeSize(n),
                color: this._getNodeColor(n),
                glowIntensity: n.severity === 'critical' ? 1 : (n.severity === 'high' ? 0.7 : 0.3),
                pulsePhase: Math.random() * Math.PI * 2,
            };
        });

        this.edges = edges.map(e => ({
            ...e,
            sourceNode: this.nodes.find(n => n.id === e.source),
            targetNode: this.nodes.find(n => n.id === e.target),
        })).filter(e => e.sourceNode && e.targetNode);

        // Initialize particles along edges
        this._initParticles();

        // Start simulation
        this._simulate();
    }

    _getNodeSize(node) {
        const sizes = { critical: 22, high: 18, medium: 15, low: 12, info: 10, neutral: 12 };
        return sizes[node.severity] || 14;
    }

    _getNodeColor(node) {
        if (node.type === 'vulnerability') {
            return this.severityColors[node.severity] || '#ff4444';
        }
        return this.typeColors[node.type] || '#ffffff';
    }

    _initParticles() {
        this.particles = [];
        for (const edge of this.edges) {
            if (edge.type === 'attack_path') {
                for (let i = 0; i < 3; i++) {
                    this.particles.push({
                        edge,
                        progress: Math.random(),
                        speed: 0.003 + Math.random() * 0.005,
                        size: 2 + Math.random() * 2,
                    });
                }
            } else {
                this.particles.push({
                    edge,
                    progress: Math.random(),
                    speed: 0.001 + Math.random() * 0.002,
                    size: 1.5,
                });
            }
        }
    }

    _simulate() {
        // Simple force-directed layout
        for (let iter = 0; iter < 100; iter++) {
            // Repulsion between all nodes
            for (let i = 0; i < this.nodes.length; i++) {
                for (let j = i + 1; j < this.nodes.length; j++) {
                    const a = this.nodes[i];
                    const b = this.nodes[j];
                    let dx = b.x - a.x;
                    let dy = b.y - a.y;
                    let dist = Math.sqrt(dx * dx + dy * dy) || 1;
                    let force = 5000 / (dist * dist);
                    let fx = (dx / dist) * force;
                    let fy = (dy / dist) * force;
                    if (!a.fx) { a.x -= fx; a.y -= fy; }
                    if (!b.fx) { b.x += fx; b.y += fy; }
                }
            }

            // Attraction along edges
            for (const edge of this.edges) {
                const a = edge.sourceNode;
                const b = edge.targetNode;
                if (!a || !b) continue;
                let dx = b.x - a.x;
                let dy = b.y - a.y;
                let dist = Math.sqrt(dx * dx + dy * dy) || 1;
                let force = (dist - 120) * 0.01;
                let fx = (dx / dist) * force;
                let fy = (dy / dist) * force;
                if (!a.fx) { a.x += fx; a.y += fy; }
                if (!b.fx) { b.x -= fx; b.y -= fy; }
            }
        }
    }

    zoomIn() { this.targetCamera.zoom = Math.min(5, this.targetCamera.zoom * 1.3); }
    zoomOut() { this.targetCamera.zoom = Math.max(0.2, this.targetCamera.zoom * 0.7); }
    resetView() { this.targetCamera = { x: 0, y: 0, zoom: 1 }; }
    toggleLabels() { this.showLabels = !this.showLabels; }
    toggleParticles() { this.showParticles = !this.showParticles; }

    start() {
        const animate = () => {
            this.time += 0.016;
            this._update();
            this._render();
            this.animationId = requestAnimationFrame(animate);
        };
        animate();
    }

    stop() {
        if (this.animationId) cancelAnimationFrame(this.animationId);
    }

    _update() {
        // Smooth camera
        this.camera.x += (this.targetCamera.x - this.camera.x) * 0.1;
        this.camera.y += (this.targetCamera.y - this.camera.y) * 0.1;
        this.camera.zoom += (this.targetCamera.zoom - this.camera.zoom) * 0.1;

        // Update particles
        if (this.showParticles) {
            for (const p of this.particles) {
                p.progress += p.speed;
                if (p.progress > 1) p.progress -= 1;
            }
        }
    }

    _render() {
        const ctx = this.ctx;
        const rect = this.canvas.getBoundingClientRect();
        const w = rect.width;
        const h = rect.height;

        ctx.clearRect(0, 0, w, h);

        // Background scanlines
        ctx.fillStyle = 'rgba(0, 240, 255, 0.005)';
        for (let y = 0; y < h; y += 4) {
            ctx.fillRect(0, y, w, 1);
        }

        ctx.save();
        ctx.translate(w / 2, h / 2);
        ctx.scale(this.camera.zoom, this.camera.zoom);
        ctx.translate(-this.camera.x, -this.camera.y);

        // Draw edges
        this._renderEdges(ctx);

        // Draw particles
        if (this.showParticles) {
            this._renderParticles(ctx);
        }

        // Draw nodes
        this._renderNodes(ctx);

        ctx.restore();
    }

    _renderEdges(ctx) {
        for (const edge of this.edges) {
            const a = edge.sourceNode;
            const b = edge.targetNode;
            if (!a || !b) continue;

            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);

            if (edge.type === 'attack_path') {
                ctx.strokeStyle = 'rgba(255, 0, 64, 0.4)';
                ctx.lineWidth = 2;
                ctx.setLineDash([8, 4]);
            } else if (edge.type === 'data_flow') {
                ctx.strokeStyle = 'rgba(0, 255, 136, 0.3)';
                ctx.lineWidth = 1.5;
                ctx.setLineDash([4, 4]);
            } else {
                ctx.strokeStyle = 'rgba(0, 240, 255, 0.15)';
                ctx.lineWidth = 1;
                ctx.setLineDash([]);
            }

            ctx.stroke();
            ctx.setLineDash([]);

            // Edge label
            if (this.showLabels && edge.label && this.camera.zoom > 0.6) {
                const mx = (a.x + b.x) / 2;
                const my = (a.y + b.y) / 2;
                ctx.font = '9px "Share Tech Mono", monospace';
                ctx.fillStyle = 'rgba(136, 146, 164, 0.6)';
                ctx.textAlign = 'center';
                ctx.fillText(edge.label, mx, my - 5);
            }
        }
    }

    _renderParticles(ctx) {
        for (const p of this.particles) {
            const a = p.edge.sourceNode;
            const b = p.edge.targetNode;
            if (!a || !b) continue;

            const x = a.x + (b.x - a.x) * p.progress;
            const y = a.y + (b.y - a.y) * p.progress;

            const color = p.edge.type === 'attack_path' ? '#ff0040' : '#00f0ff';
            const alpha = Math.sin(p.progress * Math.PI) * 0.8;

            ctx.beginPath();
            ctx.arc(x, y, p.size, 0, Math.PI * 2);
            ctx.fillStyle = color;
            ctx.globalAlpha = alpha;
            ctx.fill();

            // Glow
            ctx.beginPath();
            ctx.arc(x, y, p.size * 3, 0, Math.PI * 2);
            ctx.fillStyle = color;
            ctx.globalAlpha = alpha * 0.2;
            ctx.fill();

            ctx.globalAlpha = 1;
        }
    }

    _renderNodes(ctx) {
        for (const node of this.nodes) {
            const pulse = Math.sin(this.time * 2 + node.pulsePhase) * 0.3 + 0.7;
            const isHovered = node === this.hoveredNode;
            const isSelected = node === this.selectedNode;
            const r = node.radius * (isHovered ? 1.3 : 1);

            // Outer glow
            const glowSize = r * 2.5 * node.glowIntensity * pulse;
            const gradient = ctx.createRadialGradient(node.x, node.y, r * 0.5, node.x, node.y, glowSize);
            gradient.addColorStop(0, node.color + '40');
            gradient.addColorStop(1, node.color + '00');
            ctx.beginPath();
            ctx.arc(node.x, node.y, glowSize, 0, Math.PI * 2);
            ctx.fillStyle = gradient;
            ctx.fill();

            // Selection ring
            if (isSelected) {
                ctx.beginPath();
                ctx.arc(node.x, node.y, r + 8, 0, Math.PI * 2);
                ctx.strokeStyle = '#00f0ff';
                ctx.lineWidth = 2;
                ctx.setLineDash([4, 4]);
                ctx.lineDashOffset = -this.time * 20;
                ctx.stroke();
                ctx.setLineDash([]);
            }

            // Node body
            if (node.type === 'target') {
                // Hexagon for target
                this._drawHexagon(ctx, node.x, node.y, r, node.color, pulse);
            } else if (node.type === 'vulnerability') {
                // Diamond for vulnerabilities
                this._drawDiamond(ctx, node.x, node.y, r, node.color, pulse);
            } else {
                // Circle for everything else
                ctx.beginPath();
                ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
                const bodyGrad = ctx.createRadialGradient(
                    node.x - r * 0.3, node.y - r * 0.3, 0,
                    node.x, node.y, r
                );
                bodyGrad.addColorStop(0, node.color);
                bodyGrad.addColorStop(1, node.color + '80');
                ctx.fillStyle = bodyGrad;
                ctx.fill();
                ctx.strokeStyle = node.color;
                ctx.lineWidth = 1.5;
                ctx.stroke();
            }

            // Icon/text inside node
            ctx.font = `bold ${r * 0.7}px "Rajdhani", sans-serif`;
            ctx.fillStyle = '#ffffff';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            const icons = { target: '◎', service: '⬡', vulnerability: '⚠', endpoint: '◇', subdomain: '◆' };
            ctx.fillText(icons[node.type] || '●', node.x, node.y);

            // Label
            if (this.showLabels && this.camera.zoom > 0.5) {
                ctx.font = '11px "Share Tech Mono", monospace';
                ctx.fillStyle = isHovered ? '#ffffff' : 'rgba(224, 224, 224, 0.8)';
                ctx.textAlign = 'center';

                // Text background
                const label = node.label || '';
                const metrics = ctx.measureText(label);
                const padding = 4;
                ctx.fillStyle = 'rgba(10, 10, 15, 0.8)';
                ctx.fillRect(
                    node.x - metrics.width / 2 - padding,
                    node.y + r + 6,
                    metrics.width + padding * 2,
                    14
                );

                ctx.fillStyle = isHovered ? '#00f0ff' : 'rgba(224, 224, 224, 0.8)';
                ctx.fillText(label, node.x, node.y + r + 16);
            }
        }
    }

    _drawHexagon(ctx, x, y, r, color, pulse) {
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
            const angle = (Math.PI / 3) * i - Math.PI / 6;
            const px = x + r * Math.cos(angle);
            const py = y + r * Math.sin(angle);
            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.fillStyle = color + '60';
        ctx.fill();
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.stroke();

        // Inner hexagon
        ctx.beginPath();
        const ir = r * 0.6 * pulse;
        for (let i = 0; i < 6; i++) {
            const angle = (Math.PI / 3) * i;
            const px = x + ir * Math.cos(angle);
            const py = y + ir * Math.sin(angle);
            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.strokeStyle = color + '80';
        ctx.lineWidth = 1;
        ctx.stroke();
    }

    _drawDiamond(ctx, x, y, r, color, pulse) {
        ctx.beginPath();
        ctx.moveTo(x, y - r);
        ctx.lineTo(x + r * 0.8, y);
        ctx.lineTo(x, y + r);
        ctx.lineTo(x - r * 0.8, y);
        ctx.closePath();
        ctx.fillStyle = color + '50';
        ctx.fill();
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.stroke();
    }
}
