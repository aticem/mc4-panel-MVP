import React, { useState, useEffect, useCallback, useRef, memo, useMemo } from 'react';
import './App.css';

// Import custom hooks and components
import useDailyLog from './hooks/useDailyLog';
import useChartExport from './hooks/useChartExport';
import SubmitModal from './components/SubmitModal';
import ProgressStats from './components/ProgressStats';
import HistoryModal from './components/HistoryModal';

// Panel states: null (none), 'mc4' (blue - installed), 'terminated' (green - string terminated)
const PANEL_STATES = {
  NONE: null,
  MC4_INSTALLED: 'mc4',
  TERMINATED: 'terminated'
};

// SVG Note Marker component - renders inside SVG (optimized - no filters)
const SvgNoteMarker = memo(({ note, isSelected, viewBoxWidth, onClick }) => {
  // Calculate zoom level: higher zoom = smaller viewBox width
  // Base canvas width is ~1200, so zoom factor = 1200 / viewBoxWidth
  const zoomFactor = 1200 / viewBoxWidth;
  
  // Scale radius based on zoom: zoom in = smaller radius
  const baseRadius = 4; // Base radius at normal zoom
  const radius = Math.max(1.5, baseRadius / Math.sqrt(zoomFactor));
  const innerRadius = radius * 0.4;
  
  return (
    <g 
      onClick={(e) => {
        e.stopPropagation();
        onClick(note);
      }}
      style={{ cursor: 'pointer' }}
    >
      <circle
        cx={note.svgX}
        cy={note.svgY}
        r={isSelected ? radius * 1.4 : radius}
        fill={isSelected ? '#9b59b6' : '#e74c3c'}
        stroke={isSelected ? '#8e44ad' : '#c0392b'}
        strokeWidth={isSelected ? radius * 0.3 : radius * 0.15}
      />
      <circle
        cx={note.svgX}
        cy={note.svgY}
        r={innerRadius}
        fill="white"
        pointerEvents="none"
      />
    </g>
  );
});

// Note Editor component - HTML overlay for editing
function NoteEditor({ note, onUpdate, onDelete, onClose, screenX, screenY }) {
  const [text, setText] = useState(note.text);

  const handleSave = () => {
    if (text.trim()) {
      onUpdate(note.id, text);
    }
    onClose();
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSave();
    }
    if (e.key === 'Escape') {
      setText(note.text);
      onClose();
    }
  };

  return (
    <div 
      className="note-editor"
      style={{ 
        left: screenX, 
        top: screenY,
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <textarea
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Write a note..."
      />
      <div className="note-actions">
        <button onClick={handleSave}>Save</button>
        <button onClick={() => onDelete(note.id)}>Delete</button>
        <button onClick={() => { setText(note.text); onClose(); }}>✕</button>
      </div>
    </div>
  );
}

// Optimized Panel Component with Half-Split Click Areas
const Panel = memo(({ feature, index, state, toSvgCoords }) => {
  const coords = feature.geometry.coordinates;
  if (!coords || coords.length < 2) return null;
  
  const [isHovered, setIsHovered] = useState(false);
  const text = feature.properties.text;
  
  // 1. Convert to SVG points
  const uniqueCoords = (coords.length > 0 && 
    Math.abs(coords[0][0] - coords[coords.length-1][0]) < 1e-9 && 
    Math.abs(coords[0][1] - coords[coords.length-1][1]) < 1e-9)
      ? coords.slice(0, -1) 
      : coords;
      
  const svgPts = uniqueCoords.map(c => toSvgCoords(c[0], c[1]));
  const pointsStr = svgPts.map(p => `${p.x},${p.y}`).join(' ');
  
  // 2. Identify edges and find 2 shortest (Ends)
  const edges = [];
  for (let i = 0; i < svgPts.length; i++) {
    const p1 = svgPts[i];
    const p2 = svgPts[(i + 1) % svgPts.length];
    const len = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    edges.push({ p1, p2, len, center: { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 } });
  }
  
  edges.sort((a, b) => a.len - b.len);
  const shortEdges = edges.slice(0, 2);
  shortEdges.sort((a, b) => (a.center.x - b.center.x) || (a.center.y - b.center.y));
  
  const leftEdge = shortEdges[0];
  const rightEdge = shortEdges[1];
  
  // Calculate panel center
  const center = {
    x: svgPts.reduce((sum, p) => sum + p.x, 0) / svgPts.length,
    y: svgPts.reduce((sum, p) => sum + p.y, 0) / svgPts.length
  };
  
  const width = leftEdge ? leftEdge.len : 10;
  const endRadius = Math.max(0.6, Math.min(1.5, width * 0.35)); 
  
  // Calculate inset positions for indicators
  const getInsetPos = (edgeCenter, panelCenter, radius) => {
    const dx = panelCenter.x - edgeCenter.x;
    const dy = panelCenter.y - edgeCenter.y;
    const dist = Math.hypot(dx, dy);
    if (dist === 0) return edgeCenter;
    
    const moveAmt = Math.min(dist / 2, radius * 1.5); 
    const ratio = moveAmt / dist;
    
    return {
      x: edgeCenter.x + dx * ratio,
      y: edgeCenter.y + dy * ratio
    };
  };
  
  const leftPos = leftEdge ? getInsetPos(leftEdge.center, center, endRadius) : center;
  const rightPos = rightEdge ? getInsetPos(rightEdge.center, center, endRadius) : center;

  const currentState = state || {};
  
  return (
    <g 
      className="panel-group"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Main panel shape */}
      <polygon
        points={pointsStr}
        fill={isHovered ? "rgba(71, 85, 105, 0.12)" : "rgba(71, 85, 105, 0.05)"}
        stroke={isHovered ? "#334155" : "#64748b"}
        strokeWidth={isHovered ? 0.4 : 0.25}
        style={{ cursor: 'default' }}
        data-panel-index={index}
      />
      
      {/* Text Label on Hover */}
      {isHovered && text && (
        <text
          x={center.x}
          y={center.y}
          textAnchor="middle"
          dominantBaseline="middle"
          fontSize="1.5"
          fill="#1e293b"
          fontFamily="'Segoe UI', 'Helvetica Neue', Arial, sans-serif"
          fontWeight="600"
          pointerEvents="none"
          style={{ textShadow: '0 0 2px #f8fafc, 0 0 4px #f8fafc' }}
        >
          {text}
        </text>
      )}
      
      {/* Left Indicator */}
      {currentState.left && (
        <circle
          cx={leftPos.x}
          cy={leftPos.y}
          r={endRadius}
          fill={currentState.left === PANEL_STATES.MC4_INSTALLED ? '#0066cc' : '#00aa00'}
          stroke={currentState.left === PANEL_STATES.MC4_INSTALLED ? '#004499' : '#007700'}
          strokeWidth={0.15}
          opacity={0.95}
          pointerEvents="none"
        />
      )}
      
      {/* Right Indicator */}
      {currentState.right && (
        <circle
          cx={rightPos.x}
          cy={rightPos.y}
          r={endRadius}
          fill={currentState.right === PANEL_STATES.MC4_INSTALLED ? '#0066cc' : '#00aa00'}
          stroke={currentState.right === PANEL_STATES.MC4_INSTALLED ? '#004499' : '#007700'}
          strokeWidth={0.15}
          opacity={0.95}
          pointerEvents="none"
        />
      )}
    </g>
  );
}, (prevProps, nextProps) => {
  return (
    prevProps.index === nextProps.index &&
    prevProps.state === nextProps.state && 
    prevProps.toSvgCoords === nextProps.toSvgCoords &&
    prevProps.feature === nextProps.feature
  );
});

// Optimized Boundary Component
const Boundary = memo(({ feature, toSvgCoords }) => {
  const coords = feature.geometry.coordinates;
  if (!coords || coords.length < 2) return null;
  
  const points = coords.map(c => {
    const { x, y } = toSvgCoords(c[0], c[1]);
    return `${x},${y}`;
  }).join(' ');
  
  return (
    <polyline
      points={points}
      fill="none"
      stroke="#475569"
      strokeWidth={0.5}
      strokeDasharray="8,4"
      opacity={0.8}
    />
  );
}, (prevProps, nextProps) => prevProps.feature === nextProps.feature);

const InvPoint = memo(({ feature, toSvgCoords }) => {
  const coords = feature.geometry.coordinates;
  if (!coords || coords.length < 3) return null;
  
  // Calculate bounding box of the LineString
  const svgCoords = coords.map(c => toSvgCoords(c[0], c[1]));
  const xs = svgCoords.map(p => p.x);
  const ys = svgCoords.map(p => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  
  return (
    <rect
      x={minX}
      y={minY}
      width={maxX - minX}
      height={maxY - minY}
      fill="#f59e0b"
      stroke="#d97706"
      strokeWidth={0.3}
      opacity={0.85}
    />
  );
}, (prevProps, nextProps) => prevProps.feature === nextProps.feature);

const TextLabel = memo(({ feature, toSvgCoords }) => {
  const coords = feature.geometry.coordinates;
  const text = feature.properties?.text;
  if (!coords || !text) return null;
  
  const { x, y } = toSvgCoords(coords[0], coords[1]);
  
  return (
    <text
      x={x}
      y={y}
      textAnchor="middle"
      dominantBaseline="middle"
      fontSize="1.2"
      fill="#334155"
      fontFamily="'Segoe UI', 'Helvetica Neue', Arial, sans-serif"
      fontWeight="500"
      pointerEvents="none"
      opacity="0.75"
      style={{
        transition: 'opacity 0.2s ease',
      }}
      onMouseEnter={(e) => {
        e.target.style.opacity = '1';
      }}
      onMouseLeave={(e) => {
        e.target.style.opacity = '0.75';
      }}
    >
      {text}
    </text>
  );
}, (prevProps, nextProps) => prevProps.feature === nextProps.feature);

export default function App() {
  // Custom hooks for daily log and export
  const { dailyLog, addRecord, resetLog } = useDailyLog();
  const { exportToExcel } = useChartExport();
  
  // Submit modal state
  const [isSubmitModalOpen, setIsSubmitModalOpen] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  
  // GeoJSON verileri
  const [panelsData, setPanelsData] = useState(null);
  const [lineData, setLineData] = useState(null);
  const [invPointData, setInvPointData] = useState(null);
  const [textData, setTextData] = useState(null);
  
  // Panel durumları: { panelIndex: { left: state, right: state } }
  const [panelStates, setPanelStates] = useState({});
  
  // History for undo/redo
  const [history, setHistory] = useState([{}]);
  const [historyIndex, setHistoryIndex] = useState(0);
  
  // Notes
  const [notes, setNotes] = useState([]);
  const [isAddingNote, setIsAddingNote] = useState(false);
  
  // Map state
  const [viewBox, setViewBox] = useState({ x: 0, y: 0, width: 1000, height: 800 });
  // Fixed drawing area (geometry coordinates are projected to this area, zoom/pan only affects viewBox)
  const [canvasSize, setCanvasSize] = useState({ width: 1000, height: 800 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });
  
  // Selection box state
  const [isSelecting, setIsSelecting] = useState(false);
  const [selectionStart, setSelectionStart] = useState(null);
  const [selectionEnd, setSelectionEnd] = useState(null);
  const [isUnselectMode, setIsUnselectMode] = useState(false); // Right-click = unselect
  const [clickedElement, setClickedElement] = useState(null); // Track clicked element for panel clicks
  
  // Note selection state (when in note mode)
  const [isNoteSelecting, setIsNoteSelecting] = useState(false);
  const [noteSelectionStart, setNoteSelectionStart] = useState(null);
  const [noteSelectionEnd, setNoteSelectionEnd] = useState(null);
  const [selectedNotes, setSelectedNotes] = useState(new Set()); // IDs of selected notes
  const [editingNote, setEditingNote] = useState(null); // Note being edited
  
  // SVG ref
  const svgRef = useRef(null);
  
  // Bounds for coordinate transformation
  const boundsRef = useRef(null);

  // History refs
  const historyRef = useRef(history);
  const historyIndexRef = useRef(historyIndex);
  
  useEffect(() => {
    historyRef.current = history;
    historyIndexRef.current = historyIndex;
  }, [history, historyIndex]);

  // GeoJSON verilerini yükle
  useEffect(() => {
    Promise.all([
      fetch('/panels.geojson').then(r => r.json()),
      fetch('/line.geojson').then(r => r.json()),
      fetch('/inv point.geojson').then(r => r.json()),
      fetch('/text.geojson').then(r => r.json())
    ]).then(([panels, line, invPoint, text]) => {
      // Spatial join: Match text to panels
      const textPoints = text.features.map(t => ({
        text: t.properties.text,
        coord: t.geometry.coordinates
      }));
      
      panels.features.forEach(panel => {
        const poly = panel.geometry.coordinates;
        // Calculate bbox
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        poly.forEach(p => {
          if (p[0] < minX) minX = p[0];
          if (p[0] > maxX) maxX = p[0];
          if (p[1] < minY) minY = p[1];
          if (p[1] > maxY) maxY = p[1];
        });
        
        // Find text inside
        const matchingText = textPoints.find(t => {
          const tx = t.coord[0], ty = t.coord[1];
          if (tx < minX || tx > maxX || ty < minY || ty > maxY) return false;
          
          let inside = false;
          for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
            const xi = poly[i][0], yi = poly[i][1];
            const xj = poly[j][0], yj = poly[j][1];
            const intersect = ((yi > ty) !== (yj > ty)) &&
              (tx < (xj - xi) * (ty - yi) / (yj - yi + 1e-9) + xi);
            if (intersect) inside = !inside;
          }
          return inside;
        });
        
        if (matchingText) {
          panel.properties.text = matchingText.text;
        }
      });

      setPanelsData(panels);
      setLineData(line);
      setInvPointData(invPoint);
      setTextData(text);
      
      // Bounds hesapla
      const allCoords = [];
      panels.features.forEach(f => {
        if (f.geometry.coordinates) {
          f.geometry.coordinates.forEach(c => allCoords.push(c));
        }
      });
      line.features.forEach(f => {
        if (f.geometry.coordinates) {
          f.geometry.coordinates.forEach(c => allCoords.push(c));
        }
      });
      invPoint.features.forEach(f => {
        if (f.geometry.coordinates) {
          f.geometry.coordinates.forEach(c => allCoords.push(c));
        }
      });
      text.features.forEach(f => {
        if (f.geometry.coordinates) {
          allCoords.push(f.geometry.coordinates);
        }
      });
      
      if (allCoords.length > 0) {
        const lngs = allCoords.map(c => c[0]);
        const lats = allCoords.map(c => c[1]);
        const minLng = Math.min(...lngs);
        const maxLng = Math.max(...lngs);
        const minLat = Math.min(...lats);
        const maxLat = Math.max(...lats);
        
        const padding = 0.001;
        boundsRef.current = {
          minLng: minLng - padding,
          maxLng: maxLng + padding,
          minLat: minLat - padding,
          maxLat: maxLat + padding
        };
        
        const width = 1200;
        const height = 900;
        setCanvasSize({ width, height });
        setViewBox({ x: 0, y: 0, width, height });
      }
    });
  }, []);

  // Koordinat dönüşümü - Stable callback
  const toSvgCoords = useCallback((lng, lat) => {
    if (!boundsRef.current) return { x: 0, y: 0 };
    const { minLng, maxLng, minLat, maxLat } = boundsRef.current;
    const x = ((lng - minLng) / (maxLng - minLng)) * canvasSize.width;
    const y = ((maxLat - lat) / (maxLat - minLat)) * canvasSize.height;
    return { x, y };
  }, [canvasSize.width, canvasSize.height]);

  // Ters koordinat dönüşümü
  const fromSvgCoords = useCallback((svgX, svgY) => {
    if (!boundsRef.current) return { lng: 0, lat: 0 };
    const { minLng, maxLng, minLat, maxLat } = boundsRef.current;
    const lng = (svgX / canvasSize.width) * (maxLng - minLng) + minLng;
    const lat = maxLat - (svgY / canvasSize.height) * (maxLat - minLat);
    return { lng, lat };
  }, [canvasSize.width, canvasSize.height]);

  // Compute counters with useMemo for better performance
  // MC4: Counts both MC4_INSTALLED and TERMINATED (because terminated means MC4 was done first)
  // Termination: Only counts TERMINATED
  const { mc4, termination } = useMemo(() => {
    const totalPanels = panelsData ? panelsData.features.length : 0;
    const totalEnds = totalPanels * 2;
    
    let mc4Completed = 0;
    let terminatedCompleted = 0;
    
    Object.values(panelStates).forEach(state => {
      if (state.left === PANEL_STATES.MC4_INSTALLED || state.left === PANEL_STATES.TERMINATED) mc4Completed++;
      if (state.right === PANEL_STATES.MC4_INSTALLED || state.right === PANEL_STATES.TERMINATED) mc4Completed++;
      if (state.left === PANEL_STATES.TERMINATED) terminatedCompleted++;
      if (state.right === PANEL_STATES.TERMINATED) terminatedCompleted++;
    });
    
    return {
      mc4: { total: totalEnds, completed: mc4Completed, remaining: totalEnds - mc4Completed },
      termination: { total: totalEnds, completed: terminatedCompleted, remaining: totalEnds - terminatedCompleted }
    };
  }, [panelsData, panelStates]);

  // Get SVG coordinates from mouse event - using SVG's built-in coordinate transformation
  const getSvgCoordsFromEvent = useCallback((e) => {
    const svg = svgRef.current;
    if (!svg) return null;
    
    // Use SVG's native coordinate transformation for accuracy
    let point = svg.createSVGPoint();
    point.x = e.clientX;
    point.y = e.clientY;
    
    // Transform screen coordinates to SVG coordinates
    const ctm = svg.getScreenCTM();
    if (!ctm) return null;
    
    const svgPoint = point.matrixTransform(ctm.inverse());
    return { x: svgPoint.x, y: svgPoint.y };
  }, []);

  // Convert canvas coordinates to screen coordinates
  const canvasToScreen = useCallback((canvasX, canvasY) => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const rect = svg.getBoundingClientRect();
    const screenX = ((canvasX - viewBox.x) / viewBox.width) * rect.width + rect.left;
    const screenY = ((canvasY - viewBox.y) / viewBox.height) * rect.height + rect.top;
    return { x: screenX, y: screenY };
  }, [viewBox]);

  // Calculate panel ends (left and right edge centers) for a panel
  const getPanelEnds = useCallback((panelIndex) => {
    if (!panelsData) return null;
    const panel = panelsData.features[panelIndex];
    if (!panel) return null;
    
    const coords = panel.geometry.coordinates;
    const uniqueCoords = (coords.length > 0 && 
      Math.abs(coords[0][0] - coords[coords.length-1][0]) < 1e-9 && 
      Math.abs(coords[0][1] - coords[coords.length-1][1]) < 1e-9)
        ? coords.slice(0, -1) 
        : coords;
    
    const svgPts = uniqueCoords.map(c => toSvgCoords(c[0], c[1]));
    
    // Find the 2 shortest edges (panel ends)
    const edges = [];
    for (let i = 0; i < svgPts.length; i++) {
      const p1 = svgPts[i];
      const p2 = svgPts[(i + 1) % svgPts.length];
      const len = Math.hypot(p2.x - p1.x, p2.y - p1.y);
      edges.push({ p1, p2, len, center: { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 } });
    }
    
    edges.sort((a, b) => a.len - b.len);
    const shortEdges = edges.slice(0, 2);
    shortEdges.sort((a, b) => (a.center.x - b.center.x) || (a.center.y - b.center.y));
    
    // Calculate panel center
    const center = {
      x: svgPts.reduce((sum, p) => sum + p.x, 0) / svgPts.length,
      y: svgPts.reduce((sum, p) => sum + p.y, 0) / svgPts.length
    };
    
    return {
      left: shortEdges[0]?.center || center,
      right: shortEdges[1]?.center || center,
      center,
      allPoints: svgPts
    };
  }, [panelsData, toSvgCoords]);

  // Check if a point is inside the selection box
  const isPointInBox = useCallback((point, minX, maxX, minY, maxY) => {
    return point.x >= minX && point.x <= maxX && point.y >= minY && point.y <= maxY;
  }, []);

  // Segment intersection (axis-agnostic) using orientation test
  const segmentsIntersect = useCallback((p1, p2, q1, q2) => {
    const eps = 1e-6;
    const orient = (a, b, c) => (b.y - a.y) * (c.x - b.x) - (b.x - a.x) * (c.y - b.y);
    const onSegment = (a, b, c) =>
      Math.min(a.x, b.x) - eps <= c.x && c.x <= Math.max(a.x, b.x) + eps &&
      Math.min(a.y, b.y) - eps <= c.y && c.y <= Math.max(a.y, b.y) + eps;

    const o1 = orient(p1, p2, q1);
    const o2 = orient(p1, p2, q2);
    const o3 = orient(q1, q2, p1);
    const o4 = orient(q1, q2, p2);

    if (Math.abs(o1) < eps && onSegment(p1, p2, q1)) return true;
    if (Math.abs(o2) < eps && onSegment(p1, p2, q2)) return true;
    if (Math.abs(o3) < eps && onSegment(q1, q2, p1)) return true;
    if (Math.abs(o4) < eps && onSegment(q1, q2, p2)) return true;

    return (o1 > 0) !== (o2 > 0) && (o3 > 0) !== (o4 > 0);
  }, []);

  // Point in polygon (ray casting) for rectangle->polygon containment checks
  const isPointInPolygon = useCallback((point, poly) => {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i].x, yi = poly[i].y;
      const xj = poly[j].x, yj = poly[j].y;
      const intersect = ((yi > point.y) !== (yj > point.y)) &&
        (point.x < (xj - xi) * (point.y - yi) / (yj - yi + 1e-9) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  }, []);

  // Robust panel vs selection-box intersection (independent of zoom)
  const isPanelInSelection = useCallback((panelIndex, selStart, selEnd) => {
    if (!panelsData || !selStart || !selEnd) return false;
    const ends = getPanelEnds(panelIndex);
    if (!ends || !ends.allPoints || ends.allPoints.length === 0) return false;

    // Selection rectangle corners (axis-aligned)
    const minX = Math.min(selStart.x, selEnd.x);
    const maxX = Math.max(selStart.x, selEnd.x);
    const minY = Math.min(selStart.y, selEnd.y);
    const maxY = Math.max(selStart.y, selEnd.y);
    const rectCorners = [
      { x: minX, y: minY },
      { x: maxX, y: minY },
      { x: maxX, y: maxY },
      { x: minX, y: maxY }
    ];

    // 1) Any panel vertex inside rectangle?
    if (ends.allPoints.some(p => isPointInBox(p, minX, maxX, minY, maxY))) return true;

    // 2) Any rectangle corner inside panel polygon?
    if (rectCorners.some(corner => isPointInPolygon(corner, ends.allPoints))) return true;

    // 3) Any edge intersect?
    const rectEdges = [
      [rectCorners[0], rectCorners[1]],
      [rectCorners[1], rectCorners[2]],
      [rectCorners[2], rectCorners[3]],
      [rectCorners[3], rectCorners[0]]
    ];
    for (let i = 0; i < ends.allPoints.length; i++) {
      const a = ends.allPoints[i];
      const b = ends.allPoints[(i + 1) % ends.allPoints.length];
      for (const [r1, r2] of rectEdges) {
        if (segmentsIntersect(a, b, r1, r2)) return true;
      }
    }

    return false;
  }, [panelsData, getPanelEnds, isPointInBox, isPointInPolygon, segmentsIntersect]);

  // Apply selection to panels
  // Left-click: NONE → MC4 → TERMINATED (no going back to NONE)
  // Right-click: Unselect (set to NONE)
  const applySelection = useCallback((selStart, selEnd, unselect = false) => {
    if (!panelsData || !selStart || !selEnd) return;
    
    // Minimum selection box size check
    const dx = Math.abs(selEnd.x - selStart.x);
    const dy = Math.abs(selEnd.y - selStart.y);
    if (dx < 0.05 && dy < 0.05) return;
    
    let anySelected = false;
    
    setPanelStates(prev => {
      const newStates = { ...prev };
      
      panelsData.features.forEach((_, index) => {
        if (isPanelInSelection(index, selStart, selEnd)) {
          anySelected = true;
          
          const currentLeft = prev[index]?.left || PANEL_STATES.NONE;
          const currentRight = prev[index]?.right || PANEL_STATES.NONE;
          
          let newLeft, newRight;
          
          if (unselect) {
            // Right-click: Clear selection (set to NONE)
            newLeft = PANEL_STATES.NONE;
            newRight = PANEL_STATES.NONE;
          } else {
            // Left-click: NONE → MC4 → TERMINATED (cycle forward only)
            if (currentLeft === PANEL_STATES.NONE) {
              newLeft = PANEL_STATES.MC4_INSTALLED;
            } else if (currentLeft === PANEL_STATES.MC4_INSTALLED) {
              newLeft = PANEL_STATES.TERMINATED;
            } else {
              // Already TERMINATED, stay at TERMINATED
              newLeft = PANEL_STATES.TERMINATED;
            }
            
            if (currentRight === PANEL_STATES.NONE) {
              newRight = PANEL_STATES.MC4_INSTALLED;
            } else if (currentRight === PANEL_STATES.MC4_INSTALLED) {
              newRight = PANEL_STATES.TERMINATED;
            } else {
              // Already TERMINATED, stay at TERMINATED
              newRight = PANEL_STATES.TERMINATED;
            }
          }
          
          newStates[index] = { left: newLeft, right: newRight };
        }
      });
      
      if (anySelected) {
        const newHistory = history.slice(0, historyIndex + 1);
        newHistory.push(newStates);
        setHistory(newHistory);
        setHistoryIndex(newHistory.length - 1);
      }
      
      return newStates;
    });
  }, [panelsData, isPanelInSelection, history, historyIndex]);

  // Updated Panel Click Handler
  const handlePanelClick = useCallback((e, index, side) => {
    if (isAddingNote) return;
    
    setPanelStates(prev => {
      if (side) {
        const currentState = prev[index]?.[side] || PANEL_STATES.NONE;
        let newState;
        
        if (e.detail >= 2) {
          newState = PANEL_STATES.TERMINATED;
        } else {
          if (currentState === PANEL_STATES.NONE) newState = PANEL_STATES.MC4_INSTALLED;
          else if (currentState === PANEL_STATES.MC4_INSTALLED) newState = PANEL_STATES.TERMINATED;
          else newState = PANEL_STATES.NONE;
        }

        const newStates = {
          ...prev,
          [index]: { ...prev[index], [side]: newState }
        };
        
        const currentHist = historyRef.current;
        const curIdx = historyIndexRef.current;
        const newHistory = currentHist.slice(0, curIdx + 1);
        newHistory.push(newStates);
        
        setHistory(newHistory);
        setHistoryIndex(newHistory.length - 1);
        
        return newStates;
      }
      return prev;
    });
  }, [isAddingNote]);

  // Pan and selection handlers
  const handleMouseDown = useCallback((e) => {
    if (isAddingNote) {
      // Note mode
      if (e.button === 0) {
        // Left-click in note mode: Store click position for potential note or selection box
        const coords = getSvgCoordsFromEvent(e);
        if (coords) {
          // Store both SVG coords and original screen coords
          const svg = svgRef.current;
          const rect = svg.getBoundingClientRect();
          setIsNoteSelecting(true);
          setNoteSelectionStart({ 
            ...coords, 
            clientX: e.clientX, 
            clientY: e.clientY,
            screenX: e.clientX - rect.left,
            screenY: e.clientY - rect.top
          });
          setNoteSelectionEnd(coords);
        }
      } else if (e.button === 2) {
        e.preventDefault(); // Prevent context menu
      }
    } else {
      // Normal mode
      if ((e.button === 0 || e.button === 2) && !isAddingNote) {
        // Allow selection on any SVG element (background, panels, etc.)
        if (e.target.closest('svg')) {
          const coords = getSvgCoordsFromEvent(e);
          if (coords) {
            setIsSelecting(true);
            setSelectionStart(coords);
            setSelectionEnd(coords);
            setIsUnselectMode(e.button === 2); // Right-click = unselect mode
            setClickedElement(e.target); // Track clicked element
            if (e.button === 2) {
              e.preventDefault(); // Prevent context menu
            }
          }
        }
      } else if (e.button === 1) {
        // Middle mouse button for panning
        setIsPanning(true);
        setPanStart({ x: e.clientX, y: e.clientY });
        e.preventDefault();
      }
    }
  }, [isAddingNote, viewBox, fromSvgCoords, getSvgCoordsFromEvent]);

  const handleMouseMove = useCallback((e) => {
    if (isNoteSelecting) {
      const coords = getSvgCoordsFromEvent(e);
      if (coords) {
        setNoteSelectionEnd(coords);
      }
    } else if (isSelecting) {
      const coords = getSvgCoordsFromEvent(e);
      if (coords) {
        setSelectionEnd(coords);
      }
    } else if (isPanning) {
      const svg = svgRef.current;
      if (!svg) return;
      
      const rect = svg.getBoundingClientRect();
      const dx = (e.clientX - panStart.x) * (viewBox.width / rect.width);
      const dy = (e.clientY - panStart.y) * (viewBox.height / rect.height);
      
      setViewBox(prev => ({
        ...prev,
        x: prev.x - dx,
        y: prev.y - dy
      }));
      
      setPanStart({ x: e.clientX, y: e.clientY });
    }
  }, [isNoteSelecting, isSelecting, isPanning, panStart, viewBox, getSvgCoordsFromEvent]);

  const handleMouseUp = useCallback((e) => {
    if (isNoteSelecting && noteSelectionStart && noteSelectionEnd) {
      // Check if it was a click (not a drag) - add a note
      const dx = Math.abs(noteSelectionEnd.x - noteSelectionStart.x);
      const dy = Math.abs(noteSelectionEnd.y - noteSelectionStart.y);
      const isClick = dx < 0.05 && dy < 0.05;
      
      if (isClick) {
        // Check if there's already a note at this position (within a small radius)
        const clickRadius = 5; // pixels
        const existingNote = notes.find(note => {
          const distance = Math.hypot(note.svgX - noteSelectionStart.x, note.svgY - noteSelectionStart.y);
          return distance < clickRadius;
        });
        
        if (existingNote) {
          // There's already a note here, open the editor instead of adding a new one
          setEditingNote(existingNote);
        } else {
          // No existing note, add a new one at the exact click position
          // Store SVG coordinates directly for reliable positioning
          const newNote = {
            id: Date.now(),
            svgX: noteSelectionStart.x,  // SVG/canvas coordinate
            svgY: noteSelectionStart.y,  // SVG/canvas coordinate
            text: ''
          };
          
          setNotes(prev => [...prev, newNote]);
          
          // Reset selection state after click
          setIsNoteSelecting(false);
          setNoteSelectionStart(null);
          setNoteSelectionEnd(null);
        }
      } else {
        // It was a drag - highlight notes in selection box
        const minX = Math.min(noteSelectionStart.x, noteSelectionEnd.x);
        const maxX = Math.max(noteSelectionStart.x, noteSelectionEnd.x);
        const minY = Math.min(noteSelectionStart.y, noteSelectionEnd.y);
        const maxY = Math.max(noteSelectionStart.y, noteSelectionEnd.y);
        
        const selectedIds = new Set();
        notes.forEach(note => {
          if (note.svgX >= minX && note.svgX <= maxX && 
              note.svgY >= minY && note.svgY <= maxY) {
            selectedIds.add(note.id);
          }
        });
        setSelectedNotes(selectedIds);
      }
    } else if (isSelecting && selectionStart && selectionEnd) {
      // Check if selection box is too small (click instead of drag)
      const dx = Math.abs(selectionEnd.x - selectionStart.x);
      const dy = Math.abs(selectionEnd.y - selectionStart.y);
      const isClick = dx < 0.05 && dy < 0.05;
      
      if (isClick && clickedElement && clickedElement.dataset.panelIndex) {
        // It was a click on a panel, trigger panel click logic
        const panelIndex = parseInt(clickedElement.dataset.panelIndex);
        
        // Get panel ends to determine which side was clicked
        const ends = getPanelEnds(panelIndex);
        if (ends) {
          // Use the click coordinates to determine side
          const svg = svgRef.current;
          if (svg) {
            let point = svg.createSVGPoint();
            point.x = selectionStart.x; // Use selection start as click position
            point.y = selectionStart.y;
            
            const distLeft = Math.hypot(point.x - ends.left.x, point.y - ends.left.y);
            const distRight = Math.hypot(point.x - ends.right.x, point.y - ends.right.y);
            const side = distLeft < distRight ? 'left' : 'right';
            
            // Apply panel click logic
            setPanelStates(prev => {
              const currentState = prev[panelIndex]?.[side] || PANEL_STATES.NONE;
              let newState;
              
              // Simple click cycle: NONE → MC4 → TERMINATED → NONE
              if (currentState === PANEL_STATES.NONE) newState = PANEL_STATES.MC4_INSTALLED;
              else if (currentState === PANEL_STATES.MC4_INSTALLED) newState = PANEL_STATES.TERMINATED;
              else newState = PANEL_STATES.NONE;
              
              const newStates = {
                ...prev,
                [panelIndex]: { ...prev[panelIndex], [side]: newState }
              };
              
              const currentHist = historyRef.current;
              const curIdx = historyIndexRef.current;
              const newHistory = currentHist.slice(0, curIdx + 1);
              newHistory.push(newStates);
              
              setHistory(newHistory);
              setHistoryIndex(newHistory.length - 1);
              
              return newStates;
            });
          }
        }
      } else {
        // Apply selection
        applySelection(selectionStart, selectionEnd, isUnselectMode);
      }
    }
    setIsNoteSelecting(false);
    setIsSelecting(false);
    // Don't reset note selection here if it's a drag (selection box visible)
    setSelectionStart(null);
    setSelectionEnd(null);
    setIsUnselectMode(false);
    setClickedElement(null);
    setIsPanning(false);
  }, [isNoteSelecting, noteSelectionStart, noteSelectionEnd, isSelecting, selectionStart, selectionEnd, applySelection, isUnselectMode, clickedElement, getPanelEnds, notes, toSvgCoords, viewBox, fromSvgCoords, setSelectedNotes]);

  // Update note
  const updateNote = useCallback((id, text) => {
    setNotes(prev => prev.map(n => n.id === id ? { ...n, text } : n));
  }, []);

  // Delete note
  const deleteNote = useCallback((id) => {
    setNotes(prev => prev.filter(n => n.id !== id));
  }, []);

  // Note: Notes now use SVG coordinates directly, no position recalculation needed

  // Undo
  const undo = useCallback(() => {
    if (historyIndex > 0) {
      setHistoryIndex(historyIndex - 1);
      setPanelStates(history[historyIndex - 1]);
    }
  }, [history, historyIndex]);

  // Redo
  const redo = useCallback(() => {
    if (historyIndex < history.length - 1) {
      setHistoryIndex(historyIndex + 1);
      setPanelStates(history[historyIndex + 1]);
    }
  }, [history, historyIndex]);

  // Zoom function
  const zoom = useCallback((zoomIn, centerX = null, centerY = null) => {
    const svg = svgRef.current;
    if (!svg) return;
    
    const rect = svg.getBoundingClientRect();
    const mouseX = centerX !== null ? centerX : rect.width / 2;
    const mouseY = centerY !== null ? centerY : rect.height / 2;
    
    setViewBox(prev => {
      const svgX = prev.x + (mouseX / rect.width) * prev.width;
      const svgY = prev.y + (mouseY / rect.height) * prev.height;
      
      const zoomFactor = zoomIn ? 0.8 : 1.25;
      const newWidth = prev.width * zoomFactor;
      const newHeight = prev.height * zoomFactor;
      
      const newX = svgX - (mouseX / rect.width) * newWidth;
      const newY = svgY - (mouseY / rect.height) * newHeight;
      
      return { x: newX, y: newY, width: newWidth, height: newHeight };
    });
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'y') {
        e.preventDefault();
        redo();
      }
      if (e.key === '+' || e.key === '=' || e.key === 'NumpadAdd') {
        e.preventDefault();
        zoom(true);
      }
      if (e.key === '-' || e.key === '_' || e.key === 'NumpadSubtract') {
        e.preventDefault();
        zoom(false);
      }
      // Delete key in note mode: delete selected notes
      if (e.key === 'Delete' && isAddingNote) {
        if (selectedNotes.size > 0) {
          // Delete selected notes
          setNotes(prev => prev.filter(note => !selectedNotes.has(note.id)));
          setSelectedNotes(new Set());
        }
        // Reset selection box after deletion
        setIsNoteSelecting(false);
        setNoteSelectionStart(null);
        setNoteSelectionEnd(null);
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [undo, redo, zoom, isAddingNote, selectedNotes]);

  // Native wheel listener
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg || !panelsData) return;
    
    const wheelHandler = (e) => {
      e.preventDefault();
      e.stopPropagation();
      
      const rect = svg.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;
      
      setViewBox(prev => {
        const svgX = prev.x + (mouseX / rect.width) * prev.width;
        const svgY = prev.y + (mouseY / rect.height) * prev.height;
        
        const zoomFactor = e.deltaY > 0 ? 1.1 : 0.9;
        const newWidth = prev.width * zoomFactor;
        const newHeight = prev.height * zoomFactor;
        
        const newX = svgX - (mouseX / rect.width) * newWidth;
        const newY = svgY - (mouseY / rect.height) * newHeight;
        
        return { x: newX, y: newY, width: newWidth, height: newHeight };
      });
    };
    
    svg.addEventListener('wheel', wheelHandler, { passive: false });
    return () => svg.removeEventListener('wheel', wheelHandler);
  }, [panelsData]);

  if (!panelsData || !lineData) {
    return <div className="loading">Loading...</div>;
  }

  return (
    <div className="app">
      <div className="top-panel">
        <ProgressStats mc4={mc4} termination={termination} dailyLog={dailyLog} />
        
        <div className="toolbar">
          <button 
            className="tool-btn"
            onClick={() => setIsSubmitModalOpen(true)}
            title="Submit Daily Work"
          >
            📋
          </button>
          <button 
            className="tool-btn"
            onClick={() => setIsHistoryOpen(true)}
            title="View Submission History"
            disabled={dailyLog.length === 0}
          >
            🗒️
          </button>
          <button 
            className="tool-btn"
            onClick={() => exportToExcel(dailyLog)}
            disabled={dailyLog.length === 0}
            title="Export to Excel"
          >
            📊
          </button>
          <div className="toolbar-divider"></div>
          <button 
            className={`tool-btn ${isAddingNote ? 'active' : ''}`}
            onClick={() => {
              setIsAddingNote(!isAddingNote);
              setSelectedNotes(new Set());
              setIsNoteSelecting(false);
              setNoteSelectionStart(null);
              setNoteSelectionEnd(null);
            }}
            title="Toggle Note Mode"
          >
            📝
          </button>
          {isAddingNote && selectedNotes.size > 0 && (
            <button 
              className="tool-btn"
              onClick={() => {
                setNotes(prev => prev.filter(note => !selectedNotes.has(note.id)));
                setSelectedNotes(new Set());
              }}
              title="Delete Selected Notes"
            >
              🗑️
            </button>
          )}
          <button 
            className="tool-btn"
            onClick={undo}
            disabled={historyIndex <= 0}
            title="Undo (Ctrl+Z)"
          >
            ↩️
          </button>
          <button 
            className="tool-btn"
            onClick={redo}
            disabled={historyIndex >= history.length - 1}
            title="Redo (Ctrl+Y)"
          >
            ↪️
          </button>
        </div>
      </div>
      
      {isAddingNote && (
        <div className="note-mode-bar note-mode-below-legend">
          📝 Note Mode: Click to add, drag to select, press Delete to remove
        </div>
      )}
      
      {/* Submit Modal */}
      <SubmitModal
        isOpen={isSubmitModalOpen}
        onClose={() => setIsSubmitModalOpen(false)}
        onSubmit={addRecord}
        dailyInstalled={mc4.completed}
      />

      <HistoryModal
        isOpen={isHistoryOpen}
        onClose={() => setIsHistoryOpen(false)}
        dailyLog={dailyLog}
      />
      
      {isAddingNote && (
        <div className="note-mode-bar note-mode-below-legend">
          📝 Note Mode: Click to add, drag to select, press Delete to remove
        </div>
      )}
      
      <div className="map-container">
        <svg
          ref={svgRef}
          viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`}
          className={`map-svg ${isPanning ? 'panning' : ''} ${isAddingNote ? 'adding-note' : ''}`}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onContextMenu={(e) => e.preventDefault()}
        >
          <rect
            className="background"
            x={viewBox.x - 1000}
            y={viewBox.y - 1000}
            width={viewBox.width + 2000}
            height={viewBox.height + 2000}
            fill="#f8fafc"
          />
          
          {lineData.features.map((feature, index) => (
            <Boundary key={index} feature={feature} toSvgCoords={toSvgCoords} />
          ))}
          
          {invPointData && invPointData.features.map((feature, index) => (
            <InvPoint key={index} feature={feature} toSvgCoords={toSvgCoords} />
          ))}
          
          {panelsData.features.map((feature, index) => (
            <Panel 
              key={index} 
              index={index} 
              feature={feature} 
              state={panelStates[index]} 
              toSvgCoords={toSvgCoords}
            />
          ))}
          
          {textData && textData.features.map((feature, index) => (
            // Text labels are now handled inside Panel component on hover
            null
          ))}
          
          {/* Selection box rendered INSIDE SVG for accurate coordinate matching */}
          {/* Blue = select (left-click), Red = unselect (right-click) */}
          {isSelecting && selectionStart && selectionEnd && (
            <rect
              x={Math.min(selectionStart.x, selectionEnd.x)}
              y={Math.min(selectionStart.y, selectionEnd.y)}
              width={Math.abs(selectionEnd.x - selectionStart.x)}
              height={Math.abs(selectionEnd.y - selectionStart.y)}
              fill={isUnselectMode ? "rgba(231, 76, 60, 0.15)" : "rgba(52, 152, 219, 0.15)"}
              stroke={isUnselectMode ? "#e74c3c" : "#3498db"}
              strokeWidth={Math.max(0.5, viewBox.width / 500)}
              strokeDasharray={`${viewBox.width / 200},${viewBox.width / 400}`}
              pointerEvents="none"
            />
          )}
          
          {/* Note selection box (purple) */}
          {isNoteSelecting && noteSelectionStart && noteSelectionEnd && (
            <rect
              x={Math.min(noteSelectionStart.x, noteSelectionEnd.x)}
              y={Math.min(noteSelectionStart.y, noteSelectionEnd.y)}
              width={Math.abs(noteSelectionEnd.x - noteSelectionStart.x)}
              height={Math.abs(noteSelectionEnd.y - noteSelectionStart.y)}
              fill="rgba(155, 89, 182, 0.15)"
              stroke="#9b59b6"
              strokeWidth={Math.max(0.5, viewBox.width / 500)}
              strokeDasharray={`${viewBox.width / 200},${viewBox.width / 400}`}
              pointerEvents="none"
            />
          )}
          
          {/* Note markers rendered inside SVG */}
          {notes.map(note => (
            <SvgNoteMarker
              key={note.id}
              note={note}
              isSelected={selectedNotes.has(note.id)}
              viewBoxWidth={viewBox.width}
              onClick={(clickedNote) => setEditingNote(clickedNote)}
            />
          ))}
        </svg>
        
        {/* Note editor as HTML overlay */}
        {editingNote && (() => {
          const svg = svgRef.current;
          if (!svg) return null;
          const rect = svg.getBoundingClientRect();
          const screenX = ((editingNote.svgX - viewBox.x) / viewBox.width) * rect.width;
          const screenY = ((editingNote.svgY - viewBox.y) / viewBox.height) * rect.height;
          return (
            <NoteEditor
              note={editingNote}
              onUpdate={updateNote}
              onDelete={(id) => {
                deleteNote(id);
                setEditingNote(null);
              }}
              onClose={() => setEditingNote(null)}
              screenX={screenX}
              screenY={screenY}
            />
          );
        })()}
      </div>
      
      <div className="legend">
        <div className="legend-item">
          <span className="legend-dot mc4"></span>
          <span>MC4 - Single click: MC4 installed</span>
        </div>
        <div className="legend-item">
          <span className="legend-dot terminated"></span>
          <span>Terminated - Double click: cable terminated</span>
        </div>
      </div>
    </div>
  );
}
