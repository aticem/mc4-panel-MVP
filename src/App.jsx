import { useState, useEffect, useCallback, useRef } from 'react';
import './App.css';

// Panel durumları: null (yok), 'mc4' (mavi - install), 'terminated' (yeşil - string terminated)
const PANEL_STATES = {
  NONE: null,
  MC4_INSTALLED: 'mc4',
  TERMINATED: 'terminated'
};

// Not bileşeni
function Note({ note, onUpdate, onDelete, scale }) {
  const [isEditing, setIsEditing] = useState(false);
  const [text, setText] = useState(note.text);

  const handleSave = () => {
    if (text.trim()) {
      onUpdate(note.id, text);
    }
    setIsEditing(false);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSave();
    }
    if (e.key === 'Escape') {
      setText(note.text);
      setIsEditing(false);
    }
  };

  if (isEditing) {
    return (
      <div 
        className="note-editor"
        style={{ 
          left: note.screenX, 
          top: note.screenY,
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
          <button onClick={handleSave}>✓</button>
          <button onClick={() => onDelete(note.id)}>🗑</button>
          <button onClick={() => { setText(note.text); setIsEditing(false); }}>✕</button>
        </div>
      </div>
    );
  }

  return (
    <div
      className="note-marker"
      style={{ 
        left: note.screenX, 
        top: note.screenY,
      }}
      onClick={(e) => {
        e.stopPropagation();
        setIsEditing(true);
      }}
      title={note.text}
    />
  );
}

export default function App() {
  // GeoJSON verileri
  const [panelsData, setPanelsData] = useState(null);
  const [textData, setTextData] = useState(null);
  const [lineData, setLineData] = useState(null);
  
  // Panel durumları: { panelIndex: { left: state, right: state } }
  const [panelStates, setPanelStates] = useState({});
  
  // History for undo/redo
  const [history, setHistory] = useState([{}]);
  const [historyIndex, setHistoryIndex] = useState(0);
  
  // Notlar
  const [notes, setNotes] = useState([]);
  const [isAddingNote, setIsAddingNote] = useState(false);
  
  // Harita durumu
  const [viewBox, setViewBox] = useState({ x: 0, y: 0, width: 1000, height: 800 });
  // Sabit çizim alanı (geometry koordinatları bu alana projeksiyonlanır, zoom/pan sadece viewBox üzerinde)
  const [canvasSize, setCanvasSize] = useState({ width: 1000, height: 800 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });
  
  // Hover state (for text labels only)
  const [hoveredPanel, setHoveredPanel] = useState(null);
  
  // Selection box state
  const [isSelecting, setIsSelecting] = useState(false);
  const [selectionStart, setSelectionStart] = useState(null);
  const [selectionEnd, setSelectionEnd] = useState(null);
  const [selectionCount, setSelectionCount] = useState(0);
  
  // SVG ref
  const svgRef = useRef(null);
  
  // Bounds for coordinate transformation
  const boundsRef = useRef(null);

  // GeoJSON verilerini yükle
  useEffect(() => {
    Promise.all([
      fetch('/panels.geojson').then(r => r.json()),
      fetch('/text.geojson').then(r => r.json()),
      fetch('/line.geojson').then(r => r.json())
    ]).then(([panels, text, line]) => {
      setPanelsData(panels);
      setTextData(text);
      setLineData(line);
      
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

  // Koordinat dönüşümü
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

  // Compute counters
  const counts = useCallback(() => {
    const totalPanels = panelsData ? panelsData.features.length : 0;
    const totalEnds = totalPanels * 2; // Her panelin 2 ucu var
    
    let mc4Completed = 0;
    let terminatedCompleted = 0;
    
    Object.values(panelStates).forEach(state => {
      if (state.left === PANEL_STATES.MC4_INSTALLED) mc4Completed++;
      if (state.left === PANEL_STATES.TERMINATED) terminatedCompleted++;
      if (state.right === PANEL_STATES.MC4_INSTALLED) mc4Completed++;
      if (state.right === PANEL_STATES.TERMINATED) terminatedCompleted++;
    });
    
    return {
      mc4: { total: totalEnds, completed: mc4Completed, remaining: totalEnds - mc4Completed },
      termination: { total: totalEnds, completed: terminatedCompleted, remaining: totalEnds - terminatedCompleted }
    };
  }, [panelsData, panelStates]);

  // Update panel state and push to history
  const updatePanelState = useCallback((index, side, newState) => {
    setPanelStates(prev => {
      const newStates = {
        ...prev,
        [index]: {
          ...prev[index],
          [side]: newState
        }
      };
      
      // History'e ekle
      const newHistory = history.slice(0, historyIndex + 1);
      newHistory.push(newStates);
      setHistory(newHistory);
      setHistoryIndex(newHistory.length - 1);
      
      return newStates;
    });
  }, [history, historyIndex]);

  // Panel click handler
  const handlePanelClick = useCallback((e, index, panel) => {
    if (isAddingNote) return;
    
    const svg = svgRef.current;
    if (!svg) return;
    
    const rect = svg.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;
    
    // Convert panel coords to SVG
    const coords = panel.geometry.coordinates;
    const svgCoords = coords.map(c => toSvgCoords(c[0], c[1]));
    
    // Get first and last point of the LineString to determine panel direction
    const firstPoint = svgCoords[0];
    const lastPoint = svgCoords[svgCoords.length - 1];
    
    // Panel center
    const centerSvgX = (firstPoint.x + lastPoint.x) / 2;
    const centerSvgY = (firstPoint.y + lastPoint.y) / 2;
    
    // Click to SVG coordinates
    const clickSvgX = viewBox.x + (clickX / rect.width) * viewBox.width;
    const clickSvgY = viewBox.y + (clickY / rect.height) * viewBox.height;
    
    // Calculate distance from click to first and last points
    const distToFirst = Math.hypot(clickSvgX - firstPoint.x, clickSvgY - firstPoint.y);
    const distToLast = Math.hypot(clickSvgX - lastPoint.x, clickSvgY - lastPoint.y);
    
    // The side closer to click gets selected
    const side = distToFirst < distToLast ? 'left' : 'right';
    
    // Current state
    const currentState = panelStates[index]?.[side] || PANEL_STATES.NONE;
    
    // If double click, force cable terminated for that side
    if (e.detail >= 2) {
      updatePanelState(index, side, PANEL_STATES.TERMINATED);
      return;
    }

    // Single click cycle
    let newState;
    if (currentState === PANEL_STATES.NONE) {
      newState = PANEL_STATES.MC4_INSTALLED;
    } else if (currentState === PANEL_STATES.MC4_INSTALLED) {
      newState = PANEL_STATES.TERMINATED;
    } else {
      newState = PANEL_STATES.NONE;
    }
    
    updatePanelState(index, side, newState);
  }, [isAddingNote, panelStates, toSvgCoords, updatePanelState, viewBox]);

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

  // Zoom function - must be defined before keyboard shortcuts
  const zoom = useCallback((zoomIn, centerX = null, centerY = null) => {
    const svg = svgRef.current;
    if (!svg) return;
    
    const rect = svg.getBoundingClientRect();
    
    // If no center provided, use viewport center
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
      
      return {
        x: newX,
        y: newY,
        width: newWidth,
        height: newHeight
      };
    });
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault();
        if (e.shiftKey) {
          redo();
        } else {
          undo();
        }
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'y') {
        e.preventDefault();
        redo();
      }
      // Zoom with + and - keys
      if (e.key === '+' || e.key === '=' || e.key === 'NumpadAdd') {
        e.preventDefault();
        zoom(true);
      }
      if (e.key === '-' || e.key === '_' || e.key === 'NumpadSubtract') {
        e.preventDefault();
        zoom(false);
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [undo, redo, zoom]);

  // Native wheel listener (passive: false)
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg || !panelsData) {
      return;
    }
    
    const wheelHandler = (e) => {
      e.preventDefault();
      e.stopPropagation();
      
      const rect = svg.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;
      
      // Mouse position in viewBox coordinates
      setViewBox(prev => {
        const svgX = prev.x + (mouseX / rect.width) * prev.width;
        const svgY = prev.y + (mouseY / rect.height) * prev.height;
        
        const zoomFactor = e.deltaY > 0 ? 1.1 : 0.9;
        const newWidth = prev.width * zoomFactor;
        const newHeight = prev.height * zoomFactor;
        
        // Keep mouse position fixed
        const newX = svgX - (mouseX / rect.width) * newWidth;
        const newY = svgY - (mouseY / rect.height) * newHeight;
        
        return {
          x: newX,
          y: newY,
          width: newWidth,
          height: newHeight
        };
      });
    };
    
    svg.addEventListener('wheel', wheelHandler, { passive: false });
    
    return () => {
      svg.removeEventListener('wheel', wheelHandler);
    };
  }, [panelsData]);

  // Get SVG coordinates from mouse event
  const getSvgCoordsFromEvent = useCallback((e) => {
    const svg = svgRef.current;
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    const x = viewBox.x + ((e.clientX - rect.left) / rect.width) * viewBox.width;
    const y = viewBox.y + ((e.clientY - rect.top) / rect.height) * viewBox.height;
    return { x, y };
  }, [viewBox]);

  // Convert canvas coordinates to screen coordinates
  const canvasToScreen = useCallback((canvasX, canvasY) => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const rect = svg.getBoundingClientRect();
    const screenX = ((canvasX - viewBox.x) / viewBox.width) * rect.width + rect.left;
    const screenY = ((canvasY - viewBox.y) / viewBox.height) * rect.height + rect.top;
    return { x: screenX, y: screenY };
  }, [viewBox]);

  // Check if a panel is inside the selection box
  const isPanelInSelection = useCallback((panelIndex, selStart, selEnd) => {
    if (!panelsData || !selStart || !selEnd) return false;
    const panel = panelsData.features[panelIndex];
    if (!panel) return false;
    
    const coords = panel.geometry.coordinates;
    const svgCoords = coords.map(c => toSvgCoords(c[0], c[1]));
    const centerX = svgCoords.reduce((sum, c) => sum + c.x, 0) / svgCoords.length;
    const centerY = svgCoords.reduce((sum, c) => sum + c.y, 0) / svgCoords.length;
    
    const minX = Math.min(selStart.x, selEnd.x);
    const maxX = Math.max(selStart.x, selEnd.x);
    const minY = Math.min(selStart.y, selEnd.y);
    const maxY = Math.max(selStart.y, selEnd.y);
    
    return centerX >= minX && centerX <= maxX && centerY >= minY && centerY <= maxY;
  }, [panelsData, toSvgCoords]);

  // Apply selection to panels
  const applySelection = useCallback((selStart, selEnd) => {
    if (!panelsData || !selStart || !selEnd) return;
    
    const selectedIndices = [];
    panelsData.features.forEach((_, index) => {
      if (isPanelInSelection(index, selStart, selEnd)) {
        selectedIndices.push(index);
      }
    });
    
    if (selectedIndices.length === 0) return;
    
    // Check current selection count to decide mc4 or terminated
    const newCount = selectionCount + 1;
    const newState = newCount % 2 === 1 ? PANEL_STATES.MC4_INSTALLED : PANEL_STATES.TERMINATED;
    
    // If applying same selection again (odd/even), clear it
    const shouldClear = newCount % 3 === 0;
    
    setPanelStates(prev => {
      const newStates = { ...prev };
      selectedIndices.forEach(index => {
        if (shouldClear) {
          newStates[index] = { left: PANEL_STATES.NONE, right: PANEL_STATES.NONE };
        } else {
          newStates[index] = { left: newState, right: newState };
        }
      });
      
      // Push to history
      const newHistory = history.slice(0, historyIndex + 1);
      newHistory.push(newStates);
      setHistory(newHistory);
      setHistoryIndex(newHistory.length - 1);
      
      return newStates;
    });
    
    setSelectionCount(shouldClear ? 0 : newCount);
  }, [panelsData, isPanelInSelection, selectionCount, history, historyIndex]);

  // Pan and selection handlers
  const handleMouseDown = useCallback((e) => {
    if (e.button === 0 && !isAddingNote) {
      // Left click on background - start selection box
      if (e.target.tagName === 'svg' || e.target.classList.contains('background')) {
        const coords = getSvgCoordsFromEvent(e);
        if (coords) {
          setIsSelecting(true);
          setSelectionStart(coords);
          setSelectionEnd(coords);
        }
      }
    } else if (e.button === 1) {
      // Middle click for panning
      setIsPanning(true);
      setPanStart({ x: e.clientX, y: e.clientY });
      e.preventDefault();
    }
  }, [isAddingNote, getSvgCoordsFromEvent]);

  const handleMouseMove = useCallback((e) => {
    if (isSelecting) {
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
  }, [isSelecting, isPanning, panStart, viewBox, getSvgCoordsFromEvent]);

  const handleMouseUp = useCallback(() => {
    if (isSelecting && selectionStart && selectionEnd) {
      // Check if selection box is large enough (not just a click)
      const dx = Math.abs(selectionEnd.x - selectionStart.x);
      const dy = Math.abs(selectionEnd.y - selectionStart.y);
      if (dx > 5 || dy > 5) {
        applySelection(selectionStart, selectionEnd);
      }
    }
    setIsSelecting(false);
    setSelectionStart(null);
    setSelectionEnd(null);
    setIsPanning(false);
  }, [isSelecting, selectionStart, selectionEnd, applySelection]);

  // SVG click (for adding notes)
  const handleSvgClick = useCallback((e) => {
    if (!isAddingNote) return;
    
    const svg = svgRef.current;
    if (!svg) return;
    
    const rect = svg.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;
    
    const svgX = viewBox.x + (screenX / rect.width) * viewBox.width;
    const svgY = viewBox.y + (screenY / rect.height) * viewBox.height;
    
    const { lng, lat } = fromSvgCoords(svgX, svgY);
    
    const newNote = {
      id: Date.now(),
      lng,
      lat,
      screenX,
      screenY,
      text: ''
    };
    
    setNotes(prev => [...prev, newNote]);
    setIsAddingNote(false);
  }, [isAddingNote, viewBox, fromSvgCoords]);

  // Not güncelle
  const updateNote = useCallback((id, text) => {
    setNotes(prev => prev.map(n => n.id === id ? { ...n, text } : n));
  }, []);

  // Not sil
  const deleteNote = useCallback((id) => {
    setNotes(prev => prev.filter(n => n.id !== id));
  }, []);

  // Panel çiz
  const renderPanel = useCallback((panel, index) => {
    const coords = panel.geometry.coordinates;
    if (!coords || coords.length < 2) return null;
    
    const points = coords.map(c => {
      const { x, y } = toSvgCoords(c[0], c[1]);
      return `${x},${y}`;
    }).join(' ');
    
    // Get first and last points for positioning
    const svgCoords = coords.map(c => toSvgCoords(c[0], c[1]));
    const firstPoint = svgCoords[0];
    const lastPoint = svgCoords[svgCoords.length - 1];
    
    // Calculate panel length for circle sizing
    const panelLength = Math.hypot(lastPoint.x - firstPoint.x, lastPoint.y - firstPoint.y);
    const endRadius = Math.max(0.6, Math.min(1.5, panelLength * 0.04));
    
    const state = panelStates[index] || {};
    
    // Position circles at first point (left) and last point (right)
    const leftEndX = firstPoint.x;
    const leftEndY = firstPoint.y;
    const rightEndX = lastPoint.x;
    const rightEndY = lastPoint.y;
    
    return (
      <g key={index} className="panel-group">
        {/* Main panel shape - thin CAD-like style */}
        <polygon
          points={points}
          fill="rgba(0,0,0,0.03)"
          stroke="#222"
          strokeWidth={0.15}
          onClick={(e) => handlePanelClick(e, index, panel)}
          style={{ cursor: 'pointer' }}
        />
        
        {/* Sol/Üst uç (MC4/Terminated göstergesi) */}
        {state.left && (
          <circle
            cx={leftEndX}
            cy={leftEndY}
            r={endRadius}
            fill={state.left === PANEL_STATES.MC4_INSTALLED ? '#3498db' : '#2ecc71'}
            stroke={state.left === PANEL_STATES.MC4_INSTALLED ? '#2980b9' : '#27ae60'}
            strokeWidth={0.15}
            opacity={0.9}
            pointerEvents="none"
          />
        )}
        
        {/* Sağ/Alt uç (MC4/Terminated göstergesi) */}
        {state.right && (
          <circle
            cx={rightEndX}
            cy={rightEndY}
            r={endRadius}
            fill={state.right === PANEL_STATES.MC4_INSTALLED ? '#3498db' : '#2ecc71'}
            stroke={state.right === PANEL_STATES.MC4_INSTALLED ? '#2980b9' : '#27ae60'}
            strokeWidth={0.15}
            opacity={0.9}
            pointerEvents="none"
          />
        )}
      </g>
    );
  }, [toSvgCoords, panelStates, handlePanelClick]);

  // Text label (visible on hover, disabled during selection)
  const renderTextLabel = useCallback((feature, index) => {
    if (!feature.geometry.coordinates) return null;
    
    const [lng, lat] = feature.geometry.coordinates;
    const { x, y } = toSvgCoords(lng, lat);
    const text = feature.properties?.text || '';
    // Disable hover when selecting
    const hovered = !isSelecting && hoveredPanel === index;
    const panelForText = panelsData?.features?.[index];
    
    return (
      <g key={`text-${index}`} className="text-label">
        <text
          x={x}
          y={y}
          fontSize="1.8"
          fontWeight="400"
          fill={hovered ? "#333" : "transparent"}
          textAnchor="middle"
          dominantBaseline="middle"
          onMouseEnter={() => !isSelecting && setHoveredPanel(index)}
          onMouseLeave={() => !isSelecting && setHoveredPanel(null)}
          onClick={(e) => {
            if (!isSelecting && panelForText) {
              handlePanelClick(e, index, panelForText);
            }
          }}
          style={{ cursor: isSelecting ? 'crosshair' : (panelForText ? 'pointer' : 'default'), pointerEvents: isSelecting ? 'none' : 'all' }}
        >
          {text}
        </text>
      </g>
    );
  }, [toSvgCoords, hoveredPanel, panelsData, handlePanelClick, isSelecting]);

  // Saha sınırı çiz
  const renderBoundary = useCallback((feature, index) => {
    const coords = feature.geometry.coordinates;
    if (!coords || coords.length < 2) return null;
    
    const points = coords.map(c => {
      const { x, y } = toSvgCoords(c[0], c[1]);
      return `${x},${y}`;
    }).join(' ');
    
    return (
      <polyline
        key={`boundary-${index}`}
        points={points}
        fill="none"
        stroke="#111"
        strokeWidth={0.25}
        strokeDasharray="4,2"
        opacity={0.55}
      />
    );
  }, [toSvgCoords]);

  // Not konumlarını güncelle (zoom/pan değiştiğinde)
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg || notes.length === 0) return;
    
    const rect = svg.getBoundingClientRect();
    
    setNotes(prev => prev.map(note => {
      const { x, y } = toSvgCoords(note.lng, note.lat);
      const screenX = ((x - viewBox.x) / viewBox.width) * rect.width;
      const screenY = ((y - viewBox.y) / viewBox.height) * rect.height;
      return { ...note, screenX, screenY };
    }));
  }, [viewBox, toSvgCoords]);

  const { mc4, termination } = counts();

  if (!panelsData || !textData || !lineData) {
    return <div className="loading">Loading...</div>;
  }

  return (
    <div className="app">
      {/* Top bar */}
      <div className="top-panel">
        <div className="counters">
          <div className="counter-row">
            <span className="counter-label">MC4 Install:</span>
            <span className="counter-item">Total: <strong>{mc4.total}</strong></span>
            <span className="counter-item completed">Done: <strong>{mc4.completed}</strong></span>
            <span className="counter-item remaining">Remaining: <strong>{mc4.remaining}</strong></span>
          </div>
          <div className="counter-row">
            <span className="counter-label">Cable Termination:</span>
            <span className="counter-item">Total: <strong>{termination.total}</strong></span>
            <span className="counter-item completed">Done: <strong>{termination.completed}</strong></span>
            <span className="counter-item remaining">Remaining: <strong>{termination.remaining}</strong></span>
          </div>
        </div>
        
        <div className="toolbar">
          <button 
            className={`tool-btn ${isAddingNote ? 'active' : ''}`}
            onClick={() => setIsAddingNote(!isAddingNote)}
            title="Add Note"
          >
            📝
          </button>
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
      
      {/* SVG Map */}
      <div className="map-container">
        <svg
          ref={svgRef}
          viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`}
          className={`map-svg ${isPanning ? 'panning' : ''} ${isAddingNote ? 'adding-note' : ''}`}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onClick={handleSvgClick}
        >
          {/* Arka plan */}
          <rect
            className="background"
            x={viewBox.x - 1000}
            y={viewBox.y - 1000}
            width={viewBox.width + 2000}
            height={viewBox.height + 2000}
            fill="#f7f7f7"
          />
          
          {/* Site boundaries */}
          {lineData.features.map(renderBoundary)}
          
          {/* Panels */}
          {panelsData.features.map(renderPanel)}
          
          {/* Text labels */}
          {textData.features.map(renderTextLabel)}
        </svg>
        
        {/* Selection box (drawn as div for precise screen positioning) */}
        {isSelecting && selectionStart && selectionEnd && (() => {
          const startScreen = canvasToScreen(selectionStart.x, selectionStart.y);
          const endScreen = canvasToScreen(selectionEnd.x, selectionEnd.y);
          const svg = svgRef.current;
          if (!svg) return null;
          const rect = svg.getBoundingClientRect();
          
          const left = Math.min(startScreen.x, endScreen.x) - rect.left;
          const top = Math.min(startScreen.y, endScreen.y) - rect.top;
          const width = Math.abs(endScreen.x - startScreen.x);
          const height = Math.abs(endScreen.y - startScreen.y);
          
          return (
            <div
              style={{
                position: 'absolute',
                left: `${left}px`,
                top: `${top}px`,
                width: `${width}px`,
                height: `${height}px`,
                backgroundColor: 'rgba(52, 152, 219, 0.15)',
                border: '1px solid #3498db',
                borderStyle: 'dashed',
                pointerEvents: 'none',
                zIndex: 10
              }}
            />
          );
        })()}
        
        {/* Notes (outside SVG, in DOM) */}
        {notes.map(note => (
          <Note
            key={note.id}
            note={note}
            onUpdate={updateNote}
            onDelete={deleteNote}
            scale={viewBox.width / 1200}
          />
        ))}
      </div>
      
      {/* Status bar */}
      {isAddingNote && (
        <div className="status-bar">
          Click the map to add a note. Click the button again to cancel.
        </div>
      )}

      {/* Legend */}
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
