import { useState, useEffect, useRef, useCallback } from 'react';

export function GraphView({ isLight, onSelectConcept }) {
  const canvasRef = useRef(null);
  const [graphData, setGraphData] = useState({ nodes: [], links: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [saveStatus, setSaveStatus] = useState('');
  const [selectedNode, setSelectedNode] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [reloadKey, setReloadKey] = useState(0);

  // Transform and state refs for smooth 60fps canvas interaction
  const transformRef = useRef({ x: 0, y: 0, k: 1 });
  const nodesRef = useRef([]);
  const linksRef = useRef([]);
  const draggingNodeRef = useRef(null);
  const isPanningRef = useRef(false);
  const panStartRef = useRef({ x: 0, y: 0 });
  const animFrameRef = useRef(null);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const res = await fetch('http://localhost:8000/graph/data');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        
        if (!active) return;
        const rawNodes = data.nodes || [];
        const rawLinks = data.links || [];

        const width = canvasRef.current ? canvasRef.current.clientWidth : 800;
        const height = canvasRef.current ? canvasRef.current.clientHeight : 600;
        const centerX = width / 2;
        const centerY = height / 2;

        const videoNodes = rawNodes.filter((n) => n.type === 'Video');
        const conceptNodes = rawNodes.filter((n) => n.type !== 'Video');

        const initializedNodes = rawNodes.map((n) => {
          if (typeof n.x === 'number' && typeof n.y === 'number') {
            return { ...n, x: n.x, y: n.y, vx: 0, vy: 0, radius: n.type === 'Video' ? 24 : 16 };
          }

          if (n.type === 'Video') {
            const idx = videoNodes.indexOf(n);
            const angle = (idx / Math.max(videoNodes.length, 1)) * 2 * Math.PI;
            const radius = 160;
            return {
              ...n,
              x: centerX + radius * Math.cos(angle),
              y: centerY + radius * Math.sin(angle),
              vx: 0,
              vy: 0,
              radius: 24,
            };
          } else {
            const idx = conceptNodes.indexOf(n);
            const angle = (idx / Math.max(conceptNodes.length, 1)) * 2 * Math.PI;
            const radius = 320 + (idx % 3) * 60;
            return {
              ...n,
              x: centerX + radius * Math.cos(angle),
              y: centerY + radius * Math.sin(angle),
              vx: 0,
              vy: 0,
              radius: 16,
            };
          }
        });

        nodesRef.current = initializedNodes;
        linksRef.current = rawLinks;
        setGraphData({ nodes: initializedNodes, links: rawLinks });
        setLoading(false);
      } catch (err) {
        if (!active) return;
        setError(err instanceof Error ? err.message : 'Failed to load graph data');
        setLoading(false);
      }
    };
    load();
    return () => {
      active = false;
    };
  }, [reloadKey]);

  // Persist current coordinates to Neo4j
  const handleSaveCoordinates = async () => {
    setSaveStatus('Saving coordinates...');
    try {
      const payload = {
        coordinates: nodesRef.current.map((n) => ({
          id: n.id,
          x: Math.round(n.x * 10) / 10,
          y: Math.round(n.y * 10) / 10,
        })),
      };

      const res = await fetch('http://localhost:8000/graph/coordinates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setSaveStatus('Saved in Neo4j!');
      setTimeout(() => setSaveStatus(''), 2500);
    } catch {
      setSaveStatus('Failed to save coordinates');
      setTimeout(() => setSaveStatus(''), 3000);
    }
  };

  // Canvas drawing loop
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();

    if (canvas.width !== rect.width * dpr || canvas.height !== rect.height * dpr) {
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
    }

    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, rect.width, rect.height);

    const { x: tx, y: ty, k } = transformRef.current;
    ctx.translate(tx, ty);
    ctx.scale(k, k);

    const nodes = nodesRef.current;
    const links = linksRef.current;
    const nodeMap = new Map(nodes.map((n) => [n.id, n]));

    const isDark = !isLight;
    const edgeColor = isDark ? 'rgba(255, 255, 255, 0.15)' : 'rgba(0, 0, 0, 0.12)';
    const edgeHighlight = isDark ? '#ffffff' : '#000000';
    const textColor = isDark ? '#ffffff' : '#09090b';
    const textMuted = isDark ? '#888888' : '#71717a';

    // Draw Edges
    for (const link of links) {
      const source = nodeMap.get(link.source);
      const target = nodeMap.get(link.target);
      if (!source || !target) continue;

      const isConnectedToSelected =
        selectedNode && (selectedNode.id === source.id || selectedNode.id === target.id);

      ctx.beginPath();
      ctx.moveTo(source.x, source.y);
      ctx.lineTo(target.x, target.y);
      ctx.strokeStyle = isConnectedToSelected ? edgeHighlight : edgeColor;
      ctx.lineWidth = isConnectedToSelected ? 2 : 1;
      ctx.stroke();

      // Draw arrow
      const angle = Math.atan2(target.y - source.y, target.x - source.x);
      const targetRadius = target.radius || 18;
      const arrowX = target.x - Math.cos(angle) * (targetRadius + 4);
      const arrowY = target.y - Math.sin(angle) * (targetRadius + 4);

      ctx.save();
      ctx.translate(arrowX, arrowY);
      ctx.rotate(angle);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(-6, -3.5);
      ctx.lineTo(-6, 3.5);
      ctx.closePath();
      ctx.fillStyle = isConnectedToSelected ? edgeHighlight : edgeColor;
      ctx.fill();
      ctx.restore();

      // Draw relation label if selected or zoomed in
      if (isConnectedToSelected || k > 1.2) {
        const midX = (source.x + target.x) / 2;
        const midY = (source.y + target.y) / 2;
        ctx.font = '10px monospace';
        ctx.fillStyle = textMuted;
        ctx.textAlign = 'center';
        ctx.fillText(link.relation, midX, midY - 4);
      }
    }

    // Draw Nodes
    for (const node of nodes) {
      const isSelected = selectedNode?.id === node.id;
      const isVideo = node.type === 'Video';
      const isMatch =
        searchQuery && node.label.toLowerCase().includes(searchQuery.toLowerCase());

      ctx.save();
      ctx.translate(node.x, node.y);

      if (isVideo) {
        // Video Node: sleek rounded square badge
        const size = 44;
        ctx.beginPath();
        ctx.roundRect(-size / 2, -size / 2, size, size, 12);

        ctx.fillStyle = isDark ? '#141414' : '#ffffff';
        ctx.fill();
        ctx.lineWidth = isSelected ? 3 : isMatch ? 2.5 : 1.5;
        ctx.strokeStyle = isSelected
          ? '#ffffff'
          : isMatch
          ? '#f59e0b'
          : isDark
          ? '#333333'
          : '#d1d5db';
        ctx.stroke();

        // Video camera icon
        ctx.fillStyle = isDark ? '#ffffff' : '#000000';
        ctx.beginPath();
        // Camera body
        ctx.roundRect(-10, -6, 14, 12, 2);
        ctx.fill();
        // Camera lens triangle
        ctx.beginPath();
        ctx.moveTo(5, -3);
        ctx.lineTo(10, -6);
        ctx.lineTo(10, 6);
        ctx.lineTo(5, 3);
        ctx.closePath();
        ctx.fill();
      } else {
        // Concept Node: smooth pill / circle
        const radius = node.radius || 16;
        ctx.beginPath();
        ctx.arc(0, 0, radius, 0, 2 * Math.PI);

        ctx.fillStyle = isDark ? '#1a1a1a' : '#f3f4f6';
        ctx.fill();
        ctx.lineWidth = isSelected ? 2.5 : isMatch ? 2.5 : 1;
        ctx.strokeStyle = isSelected
          ? '#ffffff'
          : isMatch
          ? '#f59e0b'
          : isDark
          ? '#383838'
          : '#e5e7eb';
        ctx.stroke();

        // Inner dot
        ctx.beginPath();
        ctx.arc(0, 0, 4, 0, 2 * Math.PI);
        ctx.fillStyle = isDark ? '#737373' : '#9ca3af';
        ctx.fill();
      }

      // Node label
      ctx.font = isVideo ? '600 11.5px sans-serif' : '500 11px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = isSelected ? textColor : textMuted;

      const labelText =
        node.label.length > 22 ? node.label.substring(0, 20) + '…' : node.label;
      ctx.fillText(labelText, 0, isVideo ? 32 : 24);

      ctx.restore();
    }

    ctx.restore();
  }, [isLight, selectedNode, searchQuery]);

  // Request animation frame loop
  useEffect(() => {
    let active = true;
    const loop = () => {
      if (!active) return;
      draw();
      animFrameRef.current = requestAnimationFrame(loop);
    };
    loop();
    return () => {
      active = false;
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, [draw]);

  // Screen coordinate to graph space coordinate
  const screenToGraph = (screenX, screenY) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const { x: tx, y: ty, k } = transformRef.current;
    return {
      x: (screenX - rect.left - tx) / k,
      y: (screenY - rect.top - ty) / k,
    };
  };

  // Find node at coordinate
  const findNodeAt = (graphX, graphY) => {
    for (let i = nodesRef.current.length - 1; i >= 0; i--) {
      const node = nodesRef.current[i];
      const radius = node.type === 'Video' ? 26 : 20;
      const dx = graphX - node.x;
      const dy = graphY - node.y;
      if (dx * dx + dy * dy <= radius * radius) {
        return node;
      }
    }
    return null;
  };

  // Mouse / Touch handlers for Dragging & Panning
  const handleMouseDown = (e) => {
    const { x: gx, y: gy } = screenToGraph(e.clientX, e.clientY);
    const hitNode = findNodeAt(gx, gy);

    if (hitNode) {
      draggingNodeRef.current = hitNode;
      setSelectedNode(hitNode);
    } else {
      isPanningRef.current = true;
      panStartRef.current = {
        x: e.clientX - transformRef.current.x,
        y: e.clientY - transformRef.current.y,
      };
      setSelectedNode(null);
    }
  };

  const handleMouseMove = (e) => {
    if (draggingNodeRef.current) {
      const { x: gx, y: gy } = screenToGraph(e.clientX, e.clientY);
      draggingNodeRef.current.x = gx;
      draggingNodeRef.current.y = gy;
    } else if (isPanningRef.current) {
      transformRef.current.x = e.clientX - panStartRef.current.x;
      transformRef.current.y = e.clientY - panStartRef.current.y;
    }
  };

  const handleMouseUp = () => {
    draggingNodeRef.current = null;
    isPanningRef.current = false;
  };

  const handleWheel = (e) => {
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
    const newK = Math.max(0.2, Math.min(3.5, transformRef.current.k * zoomFactor));

    // Zoom centered on cursor
    transformRef.current.x = mouseX - (mouseX - transformRef.current.x) * (newK / transformRef.current.k);
    transformRef.current.y = mouseY - (mouseY - transformRef.current.y) * (newK / transformRef.current.k);
    transformRef.current.k = newK;
  };

  const handleResetZoom = () => {
    transformRef.current = { x: 0, y: 0, k: 1 };
    setSelectedNode(null);
  };

  // Find relationships for selected node
  const connectedLinks = selectedNode
    ? graphData.links.filter(
        (l) => l.source === selectedNode.id || l.target === selectedNode.id
      )
    : [];

  return (
    <div className="graph-view-container">
      {/* Top Controls Bar */}
      <div className="graph-toolbar">
        <div className="graph-title-block">
          <span className="graph-badge">Neo4j</span>
          <h3>Knowledge graph</h3>
          <span className="graph-count">
            {graphData.nodes.length} nodes, {graphData.links.length} relations
          </span>
        </div>

        <div className="graph-actions-block">
          <div className="graph-search">
            <input
              type="text"
              placeholder="Search concepts or videos..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button
                type="button"
                className="search-clear"
                onClick={() => setSearchQuery('')}
              >
                ×
              </button>
            )}
          </div>

          <button
            type="button"
            className="action-btn"
            title="Reset zoom and pan"
            onClick={handleResetZoom}
          >
            Reset
          </button>

          <button
            type="button"
            className="action-btn primary"
            title="Save node coordinates to Neo4j"
            onClick={handleSaveCoordinates}
          >
            Save layout
          </button>
        </div>
      </div>

      {saveStatus && <div className="save-toast">{saveStatus}</div>}

      {/* Main Canvas Area */}
      <div className="canvas-wrapper">
        {loading && <div className="graph-status-overlay">Loading Neo4j graph...</div>}
        {error && (
          <div className="graph-status-overlay error">
            <p>{error}</p>
            <button type="button" onClick={() => setReloadKey((k) => k + 1)} className="action-btn">
              Retry
            </button>
          </div>
        )}
        <canvas
          ref={canvasRef}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onWheel={handleWheel}
        />

        {/* Legend */}
        <div className="graph-legend">
          <div className="legend-item">
            <span className="legend-box video" />
            <span>Video node</span>
          </div>
          <div className="legend-item">
            <span className="legend-box concept" />
            <span>Concept node</span>
          </div>
          <div className="legend-item">
            <span className="legend-line" />
            <span>Relationship</span>
          </div>
        </div>
      </div>

      {/* Node Inspector Drawer */}
      {selectedNode && (
        <div className="node-inspector">
          <div className="inspector-header">
            <div>
              <span className={`inspector-tag ${selectedNode.type.toLowerCase()}`}>
                {selectedNode.type}
              </span>
              <h4>{selectedNode.label}</h4>
            </div>
            <button
              type="button"
              className="close-btn"
              onClick={() => setSelectedNode(null)}
            >
              ×
            </button>
          </div>

          <div className="inspector-content">
            <p className="coord-info">
              Coordinates: x={Math.round(selectedNode.x)}, y={Math.round(selectedNode.y)}
            </p>

            <div className="connections-list">
              <h5>Connected facts ({connectedLinks.length}):</h5>
              {connectedLinks.length === 0 ? (
                <p className="empty-relations">No direct connections recorded.</p>
              ) : (
                connectedLinks.map((link, idx) => {
                  const isOutgoing = link.source === selectedNode.id;
                  const otherId = isOutgoing ? link.target : link.source;
                  const otherNode = graphData.nodes.find((n) => n.id === otherId);
                  const otherLabel = otherNode ? otherNode.label : otherId;

                  return (
                    <div key={idx} className="relation-row">
                      <span className="rel-tag">{link.relation}</span>
                      <span className="rel-target">
                        {isOutgoing ? '→ ' : '← '}
                        {otherLabel}
                      </span>
                    </div>
                  );
                })
              )}
            </div>

            {onSelectConcept && (
              <button
                type="button"
                className="ask-concept-btn"
                onClick={() => onSelectConcept(selectedNode.label)}
              >
                Ask in chat about &quot;{selectedNode.label}&quot;
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
