"""Attack chain discovery engine.

Traverses the target graph using capability-based reasoning to find
all viable exploitation paths from initial state to high-impact outcomes.

This is the core computation engine. It does not render anything.
"""

from dataclasses import dataclass, field

from recon_engine.analysis.capability_model import (
    CapabilityState,
    DEFAULT_INITIAL_CAPABILITIES,
    CRITICAL_CAPABILITIES,
    build_capability_map,
)
from recon_engine.analysis.scoring import score_chain


@dataclass
class ChainStep:
    """A single step in an attack chain."""
    node_id: str
    node_label: str
    node_type: str
    severity: str
    capabilities_required: list
    capabilities_gained: list
    confidence: float
    cumulative_capabilities: set = field(default_factory=set)

    def to_dict(self):
        return {
            "node_id": self.node_id,
            "node_label": self.node_label,
            "node_type": self.node_type,
            "severity": self.severity,
            "capabilities_required": self.capabilities_required,
            "capabilities_gained": self.capabilities_gained,
            "confidence": round(self.confidence, 3),
            "cumulative_capabilities": sorted(self.cumulative_capabilities),
        }


@dataclass
class AttackChain:
    """A complete attack chain — ordered steps from initial to outcome."""
    chain_id: str
    steps: list  # list of ChainStep
    final_capabilities: set = field(default_factory=set)
    score: float = 0.0
    impact: str = ""
    confidence: float = 0.0

    def to_dict(self):
        return {
            "chain_id": self.chain_id,
            "steps": [s.to_dict() for s in self.steps],
            "final_capabilities": sorted(self.final_capabilities),
            "score": round(self.score, 3),
            "impact": self.impact,
            "confidence": round(self.confidence, 3),
            "node_ids": [s.node_id for s in self.steps],
            "length": len(self.steps),
        }


@dataclass
class RecommendedAction:
    """The best next action to take from current state."""
    action: str
    node_id: str
    expected_outcome: str
    confidence: float
    chain_id: str  # which chain this action belongs to
    capabilities_gained: list

    def to_dict(self):
        return {
            "action": self.action,
            "node_id": self.node_id,
            "expected_outcome": self.expected_outcome,
            "confidence": round(self.confidence, 3),
            "chain_id": self.chain_id,
            "capabilities_gained": self.capabilities_gained,
        }


class ChainEngine:
    """Graph-based attack chain discovery and ranking engine.

    Takes the threat map graph (nodes + edges) enriched with
    pre/postconditions, and computes all viable exploitation paths.
    """

    def __init__(self, max_depth=8):
        self.max_depth = max_depth
        self.nodes = {}       # id -> node dict
        self.edges = []       # list of edge dicts
        self.cap_map = {}     # id -> NodeCapabilities
        self.adj = {}         # id -> list of (neighbor_id, edge)
        self.chains = []      # computed chains
        self.recommended = None  # best next action

    def load(self, threat_map, findings):
        """Load graph data and build capability map.

        Args:
            threat_map: dict with 'nodes' and 'edges' lists
            findings: list of finding dicts from AI analysis
        """
        nodes_list = threat_map.get("nodes", [])
        edges_list = threat_map.get("edges", [])

        self.nodes = {n["id"]: n for n in nodes_list}
        self.edges = edges_list

        # Build adjacency list (directed — follow edge direction)
        self.adj = {nid: [] for nid in self.nodes}
        for e in edges_list:
            src = e.get("source")
            tgt = e.get("target")
            if src in self.adj:
                self.adj[src].append((tgt, e))
            # For non-attack paths, allow bidirectional traversal
            if e.get("type") != "attack_path" and tgt in self.adj:
                self.adj[tgt].append((src, e))

        # Build capability map
        self.cap_map = build_capability_map(nodes_list, findings)

    def discover_chains(self, initial_capabilities=None):
        """Discover all viable attack chains from initial state.

        Uses DFS with capability tracking. Prevents loops. Limits depth.

        Returns:
            list of AttackChain, sorted by score descending
        """
        if initial_capabilities is None:
            initial_state = CapabilityState()
        else:
            initial_state = CapabilityState(capabilities=set(initial_capabilities))

        all_chains = []
        chain_counter = [0]

        # Start from every entry point (targets, services with network_access precondition)
        entry_points = self._find_entry_points(initial_state)

        for entry_id in entry_points:
            self._explore(
                entry_id,
                initial_state,
                [],
                set(),
                all_chains,
                chain_counter,
            )

        # Score and rank
        for chain in all_chains:
            score_chain(chain, self.nodes)

        all_chains.sort(key=lambda c: c.score, reverse=True)

        # Deduplicate — remove chains that are strict subsets of higher-scoring ones
        self.chains = self._deduplicate(all_chains)

        # Compute recommended action
        self.recommended = self._compute_recommended(initial_state)

        return self.chains

    def _find_entry_points(self, state):
        """Find all nodes reachable from initial capability state."""
        entries = []
        for nid, cap in self.cap_map.items():
            if cap.can_exploit(state):
                entries.append(nid)
        return entries

    def _explore(self, node_id, state, path, visited, results, counter):
        """DFS exploration with capability tracking."""
        if node_id in visited:
            return
        if len(path) >= self.max_depth:
            return
        if node_id not in self.cap_map:
            return

        cap = self.cap_map[node_id]
        node = self.nodes.get(node_id, {})

        # Check if we can exploit this node
        if not cap.can_exploit(state):
            return

        # Apply postconditions
        new_state = cap.apply(state)
        gained = list(new_state.capabilities - state.capabilities)

        step = ChainStep(
            node_id=node_id,
            node_label=node.get("label", node_id),
            node_type=node.get("type", "unknown"),
            severity=node.get("severity", "info"),
            capabilities_required=cap.preconditions,
            capabilities_gained=gained,
            confidence=cap.confidence,
            cumulative_capabilities=set(new_state.capabilities),
        )

        new_path = path + [step]
        new_visited = visited | {node_id}

        # If we gained new capabilities, this is a valid chain segment
        if gained or node.get("type") == "vulnerability":
            # Record chain if it reaches something meaningful
            if self._is_meaningful_chain(new_path, new_state):
                counter[0] += 1
                chain = AttackChain(
                    chain_id=f"CHAIN-{counter[0]:03d}",
                    steps=list(new_path),
                    final_capabilities=set(new_state.capabilities),
                )
                results.append(chain)

        # Continue exploring neighbors
        for neighbor_id, edge in self.adj.get(node_id, []):
            self._explore(
                neighbor_id, new_state, new_path, new_visited,
                results, counter,
            )

    def _is_meaningful_chain(self, path, state):
        """A chain is meaningful if it gains capabilities beyond initial."""
        if len(path) < 1:
            return False
        # Must include at least one vulnerability
        has_vuln = any(s.node_type == "vulnerability" for s in path)
        if not has_vuln:
            return False
        # Must have gained something beyond initial
        gained = state.capabilities - DEFAULT_INITIAL_CAPABILITIES
        return len(gained) > 0

    def _deduplicate(self, chains):
        """Remove chains that are strict subsets of higher-scoring ones."""
        if not chains:
            return []

        result = []
        seen_node_sets = []

        for chain in chains:
            node_set = frozenset(s.node_id for s in chain.steps)
            # Keep if not a subset of any already-kept chain
            is_subset = any(node_set <= existing for existing in seen_node_sets)
            if not is_subset:
                result.append(chain)
                seen_node_sets.append(node_set)

            # Cap at 20 chains
            if len(result) >= 20:
                break

        return result

    def _compute_recommended(self, initial_state):
        """Compute the single best next action from current state."""
        if not self.chains:
            return None

        best_chain = self.chains[0]
        if not best_chain.steps:
            return None

        # Find the first actionable step (vulnerability type)
        for step in best_chain.steps:
            if step.node_type == "vulnerability":
                gained_str = ", ".join(step.capabilities_gained) if step.capabilities_gained else "access"
                return RecommendedAction(
                    action=f"Exploit {step.node_label}",
                    node_id=step.node_id,
                    expected_outcome=gained_str,
                    confidence=step.confidence,
                    chain_id=best_chain.chain_id,
                    capabilities_gained=step.capabilities_gained,
                )

        # Fallback to first step
        step = best_chain.steps[0]
        return RecommendedAction(
            action=f"Investigate {step.node_label}",
            node_id=step.node_id,
            expected_outcome=", ".join(step.capabilities_gained) or "reconnaissance",
            confidence=step.confidence,
            chain_id=best_chain.chain_id,
            capabilities_gained=step.capabilities_gained,
        )

    def get_chain_for_node(self, node_id):
        """Get the best chain that passes through a specific node."""
        for chain in self.chains:
            if any(s.node_id == node_id for s in chain.steps):
                return chain
        return None

    def get_recommended_from_state(self, current_capabilities):
        """Recompute recommended action from a different capability state."""
        state = CapabilityState(capabilities=set(current_capabilities))
        return self._compute_recommended(state)

    def to_dict(self):
        """Serialize full engine state for API response."""
        return {
            "chains": [c.to_dict() for c in self.chains],
            "recommended": self.recommended.to_dict() if self.recommended else None,
            "total_chains": len(self.chains),
        }
