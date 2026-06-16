import { useState, useEffect, useCallback, useRef } from "react";
import Canvas from "./components/Canvas";
import type { BrushType, CanvasSize, Layer } from "./components/Canvas";
import Toolbar from "./components/Toolbar";
import type { Shortcuts } from "./components/Toolbar";
import { DEFAULT_SHORTCUTS } from "./components/Toolbar";
import LayerPanel from "./components/LayerPanel";

type Stroke = {
  points: {x:number;y:number}[];
  color: string;
  size: number;
  opacity: number;
  eraser: boolean;
  brushType?: BrushType;
  layerId?: number;
};

const MAX_HISTORY       = 50;
const MAX_COLOR_HISTORY = 8;

let nextLayerId = 2; // 1 ya está usado por la capa inicial

function makeLayer(id: number, name: string): Layer {
  return { id, name, visible: true, opacity: 1, locked: false };
}

function App() {
  const [color,      setColorRaw ] = useState("#ffffff");
  const [brushSize,  setBrushSize] = useState(5);
  const [opacity,    setOpacity  ] = useState(1);
  const [eraser,     setEraser   ] = useState(false);
  const [brushType,  setBrushType] = useState<BrushType>("pen");
  const [panMode,    setPanMode  ] = useState(false);
  const [bgColor,    setBgColor  ] = useState("#111111");
  const [canvasSize, setCanvasSize] = useState<CanvasSize>(null);
  const [savePNG,    setSavePNG  ] = useState<() => void>(() => () => {});
  const [users,      setUsers    ] = useState<string[]>([]);
  const [username,   setUsername ] = useState(
    localStorage.getItem("drawbot-name") || "Invitado"
  );

  // ── Capas ────────────────────────────────────────────────────────────────
  const [layers, setLayers] = useState<Layer[]>([
    makeLayer(1, "Capa 1"),
  ]);
  const [activeLayerId, setActiveLayerId] = useState(1);

  const [colorHistory, setColorHistory] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem("drawbot-colors") || "[]"); }
    catch { return []; }
  });

  const [shortcuts, setShortcutsRaw] = useState<Shortcuts>(() => {
    try {
      const saved = localStorage.getItem("drawbot-shortcuts");
      return saved ? { ...DEFAULT_SHORTCUTS, ...JSON.parse(saved) } : DEFAULT_SHORTCUTS;
    } catch { return DEFAULT_SHORTCUTS; }
  });

  const setShortcuts = (s: Shortcuts | ((prev: Shortcuts) => Shortcuts)) => {
    const next = typeof s === "function" ? s(shortcuts) : s;
    setShortcutsRaw(next);
    localStorage.setItem("drawbot-shortcuts", JSON.stringify(next));
  };

  // ── Undo/Redo ────────────────────────────────────────────────────────────
  const undoStackRef = useRef<Stroke[][]>([]);
  const redoStackRef = useRef<Stroke[][]>([]);
  const [undoLen, setUndoLen] = useState(0);
  const [redoLen, setRedoLen] = useState(0);

  const canvasApiRef = useRef<{
    getMyStrokes: () => Stroke[];
    setMyStrokes: (s: Stroke[]) => void;
  } | null>(null);

  const setColor = useCallback((c: string) => setColorRaw(c), []);

  const onStrokeFinished = useCallback((strokeColor: string) => {
    if (!strokeColor || strokeColor === "eraser") return;
    setColorHistory(prev => {
      if (prev[0] === strokeColor) return prev;
      const next = [strokeColor, ...prev.filter(x => x !== strokeColor)].slice(0, MAX_COLOR_HISTORY);
      localStorage.setItem("drawbot-colors", JSON.stringify(next));
      return next;
    });
  }, []);

  const onStrokeAdded = useCallback((
    getMyStrokes: () => Stroke[],
    setMyStrokes: (s: Stroke[]) => void
  ) => {
    canvasApiRef.current = { getMyStrokes, setMyStrokes };
    const snapshot = getMyStrokes().slice(0, -1);
    undoStackRef.current = [...undoStackRef.current.slice(-MAX_HISTORY), snapshot];
    redoStackRef.current = [];
    setUndoLen(undoStackRef.current.length);
    setRedoLen(0);
  }, []);

  const handleUndo = useCallback(() => {
    const api = canvasApiRef.current;
    if (!api || undoStackRef.current.length === 0) return;
    const current  = api.getMyStrokes();
    redoStackRef.current = [...redoStackRef.current, [...current]];
    const snapshot = undoStackRef.current[undoStackRef.current.length - 1];
    undoStackRef.current = undoStackRef.current.slice(0, -1);
    api.setMyStrokes(snapshot);
    setUndoLen(undoStackRef.current.length);
    setRedoLen(redoStackRef.current.length);
  }, []);

  const handleRedo = useCallback(() => {
    const api = canvasApiRef.current;
    if (!api || redoStackRef.current.length === 0) return;
    const current  = api.getMyStrokes();
    undoStackRef.current = [...undoStackRef.current, [...current]];
    const snapshot = redoStackRef.current[redoStackRef.current.length - 1];
    redoStackRef.current = redoStackRef.current.slice(0, -1);
    api.setMyStrokes(snapshot);
    setUndoLen(undoStackRef.current.length);
    setRedoLen(redoStackRef.current.length);
  }, []);

  const handleUndoRef = useRef(handleUndo);
  const handleRedoRef = useRef(handleRedo);
  const savePNGRef    = useRef(savePNG);
  handleUndoRef.current = handleUndo;
  handleRedoRef.current = handleRedo;
  savePNGRef.current    = savePNG;

  // ── Atajos teclado ───────────────────────────────────────────────────────
  useEffect(() => {
    const match = (e: KeyboardEvent, shortcut: string) => {
      const parts = shortcut.split("+");
      const key   = parts[parts.length - 1];
      const ctrl  = parts.includes("ctrl");
      const shift = parts.includes("shift");
      return (
        e.key.toLowerCase() === key &&
        !!(e.ctrlKey || e.metaKey) === ctrl &&
        e.shiftKey === shift
      );
    };
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (match(e, shortcuts.undo))   { e.preventDefault(); handleUndoRef.current(); }
      if (match(e, shortcuts.redo))   { e.preventDefault(); handleRedoRef.current(); }
      if (match(e, shortcuts.save))   { e.preventDefault(); savePNGRef.current(); }
      if (match(e, shortcuts.eraser)) { setEraser(v => !v); setPanMode(false); }
      if (match(e, shortcuts.pan))    { setPanMode(v => !v); setEraser(false); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [shortcuts]);

  useEffect(() => {
    const onUndo = () => handleUndoRef.current();
    const onRedo = () => handleRedoRef.current();
    window.addEventListener("drawbot:undo", onUndo);
    window.addEventListener("drawbot:redo", onRedo);
    return () => {
      window.removeEventListener("drawbot:undo", onUndo);
      window.removeEventListener("drawbot:redo", onRedo);
    };
  }, []);

  // ── Layer handlers ───────────────────────────────────────────────────────
  const pushLayerUpdate = (newLayers: Layer[]) => {
    setLayers(newLayers);
    (Canvas as any)._sendLayerUpdate?.(newLayers);
  };

  const handleAddLayer = () => {
    const id   = nextLayerId++;
    const name = `Capa ${id}`;
    const nl   = [...layers, makeLayer(id, name)];
    pushLayerUpdate(nl);
    setActiveLayerId(id);
  };

  const handleDeleteLayer = (id: number) => {
    if (layers.length <= 1) return;
    const nl = layers.filter(l => l.id !== id);
    pushLayerUpdate(nl);
    if (activeLayerId === id) setActiveLayerId(nl[nl.length - 1].id);
  };

  const handleToggleVisibility = (id: number) => {
    const nl = layers.map(l => l.id===id ? {...l, visible:!l.visible} : l);
    pushLayerUpdate(nl);
  };

  const handleToggleLock = (id: number) => {
    const nl = layers.map(l => l.id===id ? {...l, locked:!l.locked} : l);
    pushLayerUpdate(nl);
  };

  const handleRename = (id: number, name: string) => {
    const nl = layers.map(l => l.id===id ? {...l, name} : l);
    pushLayerUpdate(nl);
  };

  const handleReorder = (fromIdx: number, toIdx: number) => {
    const nl = [...layers];
    const [moved] = nl.splice(fromIdx, 1);
    nl.splice(toIdx, 0, moved);
    pushLayerUpdate(nl);
  };

  const handleLayerOpacity = (id: number, opacity: number) => {
    const nl = layers.map(l => l.id===id ? {...l, opacity} : l);
    pushLayerUpdate(nl);
  };

  // Capas recibidas desde el servidor (para sincronización colaborativa)
  const handleLayersUpdate = useCallback((newLayers: Layer[]) => {
    setLayers(newLayers);
    // Ajustar nextLayerId para evitar colisiones
    const maxId = Math.max(...newLayers.map(l => l.id));
    if (maxId >= nextLayerId) nextLayerId = maxId + 1;
  }, []);

  const room = new URLSearchParams(window.location.search).get("room") || "default";

  const createRoom = () => {
    const newRoom = Math.random().toString(36).substring(2, 8);
    window.location.href = `/?room=${newRoom}`;
  };

  const copyRoomLink = async () => {
    await navigator.clipboard.writeText(window.location.href);
    alert("✅ Enlace copiado");
  };

  return (
    <>
      <Toolbar
        color={color} setColor={setColor}
        brushSize={brushSize} setBrushSize={setBrushSize}
        opacity={opacity} setOpacity={setOpacity}
        eraser={eraser} setEraser={setEraser}
        brushType={brushType} setBrushType={setBrushType}
        panMode={panMode} setPanMode={setPanMode}
        canvasSize={canvasSize} setCanvasSize={setCanvasSize}
        colorHistory={colorHistory}
        shortcuts={shortcuts} setShortcuts={setShortcuts}
        onUndo={handleUndo} onRedo={handleRedo}
        canUndo={undoLen > 0} canRedo={redoLen > 0}
        bgColor={bgColor}
        setBgColor={(c: string) => { setBgColor(c); (Canvas as any)._sendBgColor(c); }}
        savePNG={savePNG}
        users={users} username={username} setUsername={setUsername}
        room={room} createRoom={createRoom} copyRoomLink={copyRoomLink}
      />
      <Canvas
        color={color} username={username}
        brushSize={brushSize} opacity={opacity}
        eraser={eraser} brushType={brushType}
        panMode={panMode} bgColor={bgColor}
        canvasSize={canvasSize}
        layers={layers}
        activeLayerId={activeLayerId}
        setUsers={setUsers}
        onReady={(saveFn, _uploadFn) => setSavePNG(() => saveFn)}
        onBgColor={(c) => setBgColor(c)}
        onStrokeAdded={onStrokeAdded}
        onStrokeFinished={onStrokeFinished}
        onLayersUpdate={handleLayersUpdate}
      />
      <LayerPanel
        layers={layers}
        activeLayerId={activeLayerId}
        onSelect={setActiveLayerId}
        onAdd={handleAddLayer}
        onDelete={handleDeleteLayer}
        onToggleVisibility={handleToggleVisibility}
        onToggleLock={handleToggleLock}
        onRename={handleRename}
        onReorder={handleReorder}
        onOpacity={handleLayerOpacity}
      />
    </>
  );
}

export default App;