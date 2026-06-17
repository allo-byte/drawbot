import { useState, useEffect, useCallback, useRef } from "react";
import Canvas from "./components/Canvas";
import type { BrushType, CanvasSize, Layer } from "./components/Canvas";
import Toolbar from "./components/Toolbar";
import type { Shortcuts } from "./components/Toolbar";
import { DEFAULT_SHORTCUTS } from "./components/Toolbar";
import LayerPanel from "./components/LayerPanel";
import ProfilePanel, { getStoredProfile, saveProfile } from "./components/ProfilePanel";
import type { Profile } from "./components/ProfilePanel";

type Stroke = {
  points: {x:number;y:number}[];
  color: string; size: number; opacity: number;
  eraser: boolean; brushType?: BrushType; layerId?: number;
};

const MAX_HISTORY       = 50;
const MAX_COLOR_HISTORY = 8;

// Límite de capas por tamaño de lienzo
function getLayerLimit(canvasSize: { w:number; h:number } | null): number {
  if (!canvasSize) return 12;
  const px = canvasSize.w * canvasSize.h;
  if (px <= 1920*1080) return 10;
  if (px <= 2048*2048) return 8;
  if (px <= 2480*3508) return 6;
  if (px <= 3840*2160) return 4;
  return 2;
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
  const [users,        setUsers      ] = useState<string[]>([]);
  const [profile,      setProfileRaw ] = useState<Profile>(getStoredProfile);
  const [showProfile,  setShowProfile] = useState(false);
  const username = profile.username;

  const handleSaveProfile = (p: Profile) => {
    setProfileRaw(p);
    saveProfile(p);
    // Cambiar nombre en tiempo real sin reconectar
    if (p.username !== profile.username)
      (Canvas as any)._rename?.(p.username);
  };

  const [connStatus, setConnStatus] = useState<"connected"|"disconnected"|"reconnecting">("reconnecting");

  // ── Capas ────────────────────────────────────────────────────────────────
  const [layers,        setLayers       ] = useState<Layer[]>([]);
  const [activeLayerId, setActiveLayerId] = useState<number>(-1);
  // myUserId asignado por el servidor al hacer join
  const [myUserId,      setMyUserId     ] = useState<string>("");

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
    const current = api.getMyStrokes();
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
    const current = api.getMyStrokes();
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
  const myLayers   = layers.filter(l => l.ownerId === myUserId);
  const layerLimit = getLayerLimit(canvasSize);

  const pushLayerUpdate = (newLayers: Layer[]) => {
    setLayers(newLayers);
    (Canvas as any)._sendWS?.({ type: "layer_update", layers: newLayers.filter(l => l.ownerId === myUserId) });
  };

  const handleAddLayer = () => {
    if (myLayers.length >= layerLimit) return;
    (Canvas as any)._sendWS?.({
      type:    "layer_add",
      name:    `Capa ${myLayers.length + 1}`,
      canvasW: canvasSize?.w ?? 0,
      canvasH: canvasSize?.h ?? 0,
    });
  };

  // Merge: fusionar capa superior con la de abajo (con undo)
  const handleMergeLayers = (topLayerId: number) => {
    const myIdx   = myLayers.findIndex(l => l.id === topLayerId);
    if (myIdx <= 0) return; // no hay capa debajo
    const bottomLayer = myLayers[myIdx - 1];
    const topLayer    = myLayers[myIdx];

    // Snapshot para undo — guardamos los strokes antes del merge
    const snapBefore = layers.map(l => ({ ...l }));

    // Ejecutar merge visual en el canvas
    (Canvas as any)._mergeLayers?.(bottomLayer.id, topLayer.id);

    // Mover strokes de la capa superior a la inferior
    const updated = layers.map(l => {
      if (l.id === topLayer.id) return null; // eliminar capa superior
      return l;
    }).filter(Boolean) as typeof layers;

    pushLayerUpdate(updated);
    if (activeLayerId === topLayerId) setActiveLayerId(bottomLayer.id);

    // Registrar en el undo stack
    undoStackRef.current = [...undoStackRef.current.slice(-50), snapBefore as any];
    setUndoLen(undoStackRef.current.length);
  };

  // Cambiar blend mode de una capa
  const handleBlendMode = (id: number, blendMode: string) => {
    const updated = layers.map(l =>
      l.id === id && l.ownerId === myUserId ? { ...l, blendMode: blendMode as any } : l
    );
    pushLayerUpdate(updated);
  };

  const handleDeleteLayer = (id: number) => {
    if (myLayers.length <= 1) return;
    (Canvas as any)._sendWS?.({ type: "layer_delete", layerId: id });
    // Optimista: cambiar activeLayer si era la eliminada
    if (activeLayerId === id) {
      const remaining = myLayers.filter(l => l.id !== id);
      if (remaining.length > 0) setActiveLayerId(remaining[remaining.length - 1].id);
    }
  };

  const handleToggleVisibility = (id: number) => {
    const updated = layers.map(l => l.id===id && l.ownerId===myUserId ? {...l, visible:!l.visible} : l);
    setLayers(updated);
    const myUpdated = updated.filter(l => l.ownerId === myUserId);
    (Canvas as any)._sendWS?.({ type: "layer_update", layers: myUpdated });
  };

  const handleToggleLock = (id: number) => {
    const updated = layers.map(l => l.id===id && l.ownerId===myUserId ? {...l, locked:!l.locked} : l);
    setLayers(updated);
    const myUpdated = updated.filter(l => l.ownerId === myUserId);
    (Canvas as any)._sendWS?.({ type: "layer_update", layers: myUpdated });
  };

  const handleRename = (id: number, name: string) => {
    const updated = layers.map(l => l.id===id && l.ownerId===myUserId ? {...l, name} : l);
    setLayers(updated);
    const myUpdated = updated.filter(l => l.ownerId === myUserId);
    (Canvas as any)._sendWS?.({ type: "layer_update", layers: myUpdated });
  };

  const handleReorder = (fromIdx: number, toIdx: number) => {
    // Reordenar localmente solo mis capas
    const mine = [...myLayers];
    const [moved] = mine.splice(fromIdx, 1);
    mine.splice(toIdx, 0, moved);
    const others = layers.filter(l => l.ownerId !== myUserId);
    setLayers([...others, ...mine]);
    (Canvas as any)._sendWS?.({ type: "layer_reorder", fromIdx, toIdx });
  };

  const handleLayerOpacity = (id: number, opacity: number) => {
    const updated = layers.map(l => l.id===id && l.ownerId===myUserId ? {...l, opacity} : l);
    setLayers(updated);
    const myUpdated = updated.filter(l => l.ownerId === myUserId);
    (Canvas as any)._sendWS?.({ type: "layer_update", layers: myUpdated });
  };

  // Callback desde Canvas cuando llegan eventos WS de capas
  const handleLayerEvent = useCallback((event: {
    type: string;
    layers?: Layer[];
    layer?: Layer;
    layerId?: number;
    myUserId?: string;
    ownerId?: string;
    order?: number[];
  }) => {
    if (event.type === "init_layers") {
      setLayers(event.layers || []);
      if (event.myUserId) setMyUserId(event.myUserId);
      // Seleccionar mi primera capa como activa
      const mine = (event.layers || []).filter(l => l.ownerId === event.myUserId);
      if (mine.length > 0) setActiveLayerId(mine[0].id);
    }
    if (event.type === "layer_added") {
      const l = event.layer!;
      setLayers(prev => {
        if (prev.find(x => x.id === l.id)) return prev;
        const next = [...prev, l];
        // Si es mía, seleccionarla
        if (l.ownerId === myUserId) setActiveLayerId(l.id);
        return next;
      });
    }
    if (event.type === "layer_update") {
      setLayers(prev => {
        const incoming = event.layers || [];
        const ownerId  = event.ownerId!;
        const others   = prev.filter(l => l.ownerId !== ownerId);
        return [...others, ...incoming];
      });
    }
    if (event.type === "layer_deleted") {
      setLayers(prev => prev.filter(l => l.id !== event.layerId));
    }
    if (event.type === "layer_reorder") {
      setLayers(prev => {
        const ownerId = event.ownerId!;
        const order   = event.order!;
        const others  = prev.filter(l => l.ownerId !== ownerId);
        const mine    = order.map(id => prev.find(l => l.id === id)!).filter(Boolean);
        return [...others, ...mine];
      });
    }
  }, [myUserId]);

  const room = new URLSearchParams(window.location.search).get("room") || "default";
  const createRoom = () => { window.location.href = `/?room=${Math.random().toString(36).substring(2,8)}`; };
  const copyRoomLink = async () => { await navigator.clipboard.writeText(window.location.href); alert("✅ Enlace copiado"); };

  // activeLayerId válido: si no existe entre mis capas, usar el primero
  const safeActiveId = myLayers.find(l => l.id === activeLayerId)
    ? activeLayerId
    : (myLayers[0]?.id ?? -1);

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
        setBgColor={(c: string) => { setBgColor(c); (Canvas as any)._sendBgColor?.(c); }}
        savePNG={savePNG}
        users={users} username={username}
        profile={profile}
        onShowProfile={() => setShowProfile(true)}
        connStatus={connStatus}
        room={room} createRoom={createRoom} copyRoomLink={copyRoomLink}
      />
      {showProfile && (
        <ProfilePanel
          profile={profile}
          users={users}
          onSave={handleSaveProfile}
          onClose={() => setShowProfile(false)}
        />
      )}
      <Canvas
        color={color} username={username}
        brushSize={brushSize} opacity={opacity}
        eraser={eraser} brushType={brushType}
        panMode={panMode} bgColor={bgColor}
        canvasSize={canvasSize}
        layers={layers}
        activeLayerId={safeActiveId}
        setUsers={setUsers}
        onReady={(saveFn, _uploadFn) => setSavePNG(() => saveFn)}
        onBgColor={(c) => setBgColor(c)}
        onStrokeAdded={onStrokeAdded}
        onStrokeFinished={onStrokeFinished}
        onLayerEvent={handleLayerEvent}
        onConnectionChange={setConnStatus}
      />
      {myUserId && (
        <LayerPanel
          layers={layers}
          activeLayerId={safeActiveId}
          myUserId={myUserId}
          layerLimit={layerLimit}
          onSelect={setActiveLayerId}
          onAdd={handleAddLayer}
          onDelete={handleDeleteLayer}
          onToggleVisibility={handleToggleVisibility}
          onToggleLock={handleToggleLock}
          onRename={handleRename}
          onReorder={handleReorder}
          onOpacity={handleLayerOpacity}
          onMerge={handleMergeLayers}
          onBlendMode={handleBlendMode}
        />
      )}
    </>
  );
}

export default App;