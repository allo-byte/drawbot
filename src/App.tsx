import { useState, useEffect, useCallback, useRef, useMemo } from "react";
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
// FIX (undo "deshace 3-4 líneas de golpe"): tiempo mínimo entre ejecuciones
// reales de undo/redo. El botón, el atajo de teclado y el gesto táctil
// pueden todos disparar el mismo evento casi simultáneamente (por ejemplo,
// un click que también triggerea el listener de teclado, o un gesto táctil
// que se detecta dos veces por touch + pointer events). Sin protección,
// cada uno de esos disparos hace pop() del undo stack, deshaciendo varios
// trazos de un solo gesto del usuario.
const UNDO_DEBOUNCE_MS = 180;

function getLayerLimit(cs: CanvasSize): number {
  if (!cs) return 12;
  const px = cs.w * cs.h;
  if (px <= 1920*1080) return 10;
  if (px <= 2048*2048) return 8;
  if (px <= 2480*3508) return 6;
  if (px <= 3840*2160) return 4;
  return 2;
}

function App() {
  const [color,         setColorRaw  ] = useState("#ffffff");
  const [brushSize,     setBrushSize ] = useState(5);
  const [opacity,       setOpacity   ] = useState(1);
  const [eraser,        setEraser    ] = useState(false);
  const [brushType,     setBrushType ] = useState<BrushType>("pen");
  const [panMode,       setPanMode   ] = useState(false);
  const [bgColor,       setBgColor   ] = useState("#111111");
  const [canvasSize,    setCanvasSize] = useState<CanvasSize>({ w: 1024, h: 768 });
  const [savePNG,       setSavePNG   ] = useState<() => void>(() => () => {});
  const [users,         setUsers     ] = useState<string[]>([]);
  const [profile,       setProfileRaw] = useState<Profile>(getStoredProfile);
  const [showProfile,   setShowProfile] = useState(false);
  const [connStatus,    setConnStatus] = useState<"connected"|"disconnected"|"reconnecting">("reconnecting");
  const [layers,        setLayers    ] = useState<Layer[]>([]);
  const [activeLayerId, setActiveLayerId] = useState<number>(-1);

  const myUserIdRef = useRef<string>("");
  const [myUserId,  setMyUserId] = useState<string>("");
  const username = profile.username;

  const [colorHistory, setColorHistory] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem("drawbot-colors") || "[]"); } catch { return []; }
  });

  const [shortcuts, setShortcutsRaw] = useState<Shortcuts>(() => {
    try {
      const s = localStorage.getItem("drawbot-shortcuts");
      return s ? { ...DEFAULT_SHORTCUTS, ...JSON.parse(s) } : DEFAULT_SHORTCUTS;
    } catch { return DEFAULT_SHORTCUTS; }
  });
  const setShortcuts = (s: Shortcuts | ((p: Shortcuts) => Shortcuts)) => {
    const next = typeof s === "function" ? s(shortcuts) : s;
    setShortcutsRaw(next);
    localStorage.setItem("drawbot-shortcuts", JSON.stringify(next));
  };

  // ── Undo / Redo ──────────────────────────────────────────────────────────
  const undoStackRef = useRef<Stroke[][]>([]);
  const redoStackRef = useRef<Stroke[][]>([]);
  const [undoLen, setUndoLen] = useState(0);
  const [redoLen, setRedoLen] = useState(0);
  const canvasApiRef = useRef<{ getMyStrokes: () => Stroke[]; setMyStrokes: (s: Stroke[]) => void } | null>(null);

  // FIX: timestamp del último undo/redo realmente ejecutado, para descartar
  // disparos duplicados que lleguen dentro de la ventana de debounce.
  const lastUndoActionRef = useRef(0);

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

  const onStrokeAdded = useCallback((get: () => Stroke[], set: (s: Stroke[]) => void) => {
    canvasApiRef.current = { getMyStrokes: get, setMyStrokes: set };
    const snap = get().slice(0, -1);
    undoStackRef.current = [...undoStackRef.current.slice(-MAX_HISTORY), snap];
    redoStackRef.current = [];
    setUndoLen(undoStackRef.current.length);
    setRedoLen(0);
  }, []);

  const handleUndo = useCallback(() => {
    // FIX: ignora disparos repetidos que lleguen demasiado rápido seguidos
    // (mismo gesto detectado por más de un listener, doble-click accidental, etc.)
    const now = performance.now();
    if (now - lastUndoActionRef.current < UNDO_DEBOUNCE_MS) return;
    lastUndoActionRef.current = now;

    const api = canvasApiRef.current;
    if (!api || !undoStackRef.current.length) return;
    redoStackRef.current = [...redoStackRef.current, [...api.getMyStrokes()]];
    const snap = undoStackRef.current.pop()!;
    api.setMyStrokes(snap);
    setUndoLen(undoStackRef.current.length);
    setRedoLen(redoStackRef.current.length);
  }, []);

  const handleRedo = useCallback(() => {
    // Mismo debounce que handleUndo — comparten la ventana de tiempo para
    // que un undo seguido inmediatamente de un redo (u otro patrón mixto)
    // no se trate como "rebote" del mismo gesto.
    const now = performance.now();
    if (now - lastUndoActionRef.current < UNDO_DEBOUNCE_MS) return;
    lastUndoActionRef.current = now;

    const api = canvasApiRef.current;
    if (!api || !redoStackRef.current.length) return;
    undoStackRef.current = [...undoStackRef.current, [...api.getMyStrokes()]];
    const snap = redoStackRef.current.pop()!;
    api.setMyStrokes(snap);
    setUndoLen(undoStackRef.current.length);
    setRedoLen(redoStackRef.current.length);
  }, []);

  // Refs siempre frescos — evitan re-crear listeners en cada render
  const handleUndoRef = useRef(handleUndo);
  const handleRedoRef = useRef(handleRedo);
  const savePNGRef    = useRef(savePNG);
  handleUndoRef.current = handleUndo;
  handleRedoRef.current = handleRedo;
  savePNGRef.current    = savePNG;

  // ── Atajos de teclado (Ctrl+Z, Ctrl+Y y cualquier binding configurado) ───
  useEffect(() => {
    const match = (e: KeyboardEvent, sc: string) => {
      const parts = sc.split("+"), key = parts[parts.length - 1];
      return (
        e.key.toLowerCase() === key &&
        !!(e.ctrlKey || e.metaKey) === parts.includes("ctrl") &&
        e.shiftKey === parts.includes("shift")
      );
    };
    const h = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (match(e, shortcuts.undo))   { e.preventDefault(); handleUndoRef.current(); }
      if (match(e, shortcuts.redo))   { e.preventDefault(); handleRedoRef.current(); }
      if (match(e, shortcuts.save))   { e.preventDefault(); savePNGRef.current(); }
      if (match(e, shortcuts.eraser)) { setEraser(v => !v); setPanMode(false); }
      if (match(e, shortcuts.pan))    { setPanMode(v => !v); setEraser(false); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [shortcuts]);

  // ── Gestos táctiles: 2 dedos = undo, 3 dedos = redo ─────────────────────
  // El Canvas dispara estos eventos, App los escucha y ejecuta
  useEffect(() => {
    const u = () => handleUndoRef.current();
    const r = () => handleRedoRef.current();
    window.addEventListener("drawbot:undo", u);
    window.addEventListener("drawbot:redo", r);
    return () => {
      window.removeEventListener("drawbot:undo", u);
      window.removeEventListener("drawbot:redo", r);
    };
  }, []);

  // ── Layer handlers ───────────────────────────────────────────────────────
  const myLayers   = useMemo(() => layers.filter(l => l.ownerId === myUserId), [layers, myUserId]);
  const layerLimit = useMemo(() => getLayerLimit(canvasSize), [canvasSize]);

  const pushLayerUpdate = useCallback((newLayers: Layer[]) => {
    setLayers(newLayers);
    const uid = myUserIdRef.current;
    (Canvas as any)._sendWS?.({ type: "layer_update", layers: newLayers.filter(l => l.ownerId === uid) });
  }, []);

  const handleAddLayer = useCallback(() => {
    if (myLayers.length >= layerLimit) return;
    (Canvas as any)._sendWS?.({
      type: "layer_add",
      name: `Capa ${myLayers.length + 1}`,
      canvasW: canvasSize?.w ?? 0,
      canvasH: canvasSize?.h ?? 0,
    });
  }, [myLayers.length, layerLimit, canvasSize]);

  const handleMergeLayers = useCallback((topId: number) => {
    const myIdx = myLayers.findIndex(l => l.id === topId);
    if (myIdx <= 0) return;
    const bottom = myLayers[myIdx - 1], top = myLayers[myIdx];
    const snapBefore = layers.map(l => ({ ...l }));
    (Canvas as any)._mergeLayers?.(bottom.id, top.id);
    const updated = layers.filter(l => l.id !== top.id);
    pushLayerUpdate(updated);
    if (activeLayerId === topId) setActiveLayerId(bottom.id);
    undoStackRef.current = [...undoStackRef.current.slice(-MAX_HISTORY), snapBefore as any];
    setUndoLen(undoStackRef.current.length);
  }, [myLayers, layers, activeLayerId, pushLayerUpdate]);

  const handleBlendMode = useCallback((id: number, blendMode: string) => {
    const uid = myUserIdRef.current;
    pushLayerUpdate(layers.map(l => l.id === id && l.ownerId === uid ? { ...l, blendMode: blendMode as any } : l));
  }, [layers, pushLayerUpdate]);

  const handleDeleteLayer = useCallback((id: number) => {
    if (myLayers.length <= 1) return;
    (Canvas as any)._sendWS?.({ type: "layer_delete", layerId: id });
    if (activeLayerId === id) {
      const rem = myLayers.filter(l => l.id !== id);
      if (rem.length) setActiveLayerId(rem[rem.length - 1].id);
    }
  }, [myLayers, activeLayerId]);

  const handleToggleVisibility = useCallback((id: number) => {
    const uid = myUserIdRef.current;
    const updated = layers.map(l => l.id === id && l.ownerId === uid ? { ...l, visible: !l.visible } : l);
    setLayers(updated);
    (Canvas as any)._sendWS?.({ type: "layer_update", layers: updated.filter(l => l.ownerId === uid) });
  }, [layers]);

  const handleToggleLock = useCallback((id: number) => {
    const uid = myUserIdRef.current;
    const updated = layers.map(l => l.id === id && l.ownerId === uid ? { ...l, locked: !l.locked } : l);
    setLayers(updated);
    (Canvas as any)._sendWS?.({ type: "layer_update", layers: updated.filter(l => l.ownerId === uid) });
  }, [layers]);

  const handleRenameLayer = useCallback((id: number, name: string) => {
    const uid = myUserIdRef.current;
    const updated = layers.map(l => l.id === id && l.ownerId === uid ? { ...l, name } : l);
    setLayers(updated);
    (Canvas as any)._sendWS?.({ type: "layer_update", layers: updated.filter(l => l.ownerId === uid) });
  }, [layers]);

  const handleReorder = useCallback((fromIdx: number, toIdx: number) => {
    const uid = myUserIdRef.current;
    const mine = [...myLayers];
    const [m] = mine.splice(fromIdx, 1);
    mine.splice(toIdx, 0, m);
    setLayers([...layers.filter(l => l.ownerId !== uid), ...mine]);
    (Canvas as any)._sendWS?.({ type: "layer_reorder", fromIdx, toIdx });
  }, [myLayers, layers]);

  // Commit: propaga a React state + WS (solo al soltar el slider)
  const handleLayerOpacity = useCallback((id: number, op: number) => {
    const uid = myUserIdRef.current;
    const updated = layers.map(l => l.id === id && l.ownerId === uid ? { ...l, opacity: op } : l);
    setLayers(updated);
    (Canvas as any)._sendWS?.({ type: "layer_update", layers: updated.filter(l => l.ownerId === uid) });
  }, [layers]);

  // Live: actualiza layersRef directo en Canvas SIN pasar por React
  // compositeNow lo lee en el mismo frame → slider 60fps sin re-renders de App
  const handleLayerOpacityLive = useCallback((id: number, op: number) => {
    (Canvas as any)._setLayerOpacityLive?.(id, op);
  }, []);

  const handleLayerEvent = useCallback((event: {
    type: string; layers?: Layer[]; layer?: Layer;
    layerId?: number; myUserId?: string; ownerId?: string; order?: number[];
  }) => {
    const uid = myUserIdRef.current;
    if (event.type === "init_layers") {
      setLayers(event.layers || []);
      if (event.myUserId) {
        myUserIdRef.current = event.myUserId;
        setMyUserId(event.myUserId);
        const mine = (event.layers || []).filter(l => l.ownerId === event.myUserId);
        if (mine.length) setActiveLayerId(mine[0].id);
      }
    }
    else if (event.type === "layer_added") {
      const l = event.layer!;
      setLayers(prev => {
        if (prev.find(x => x.id === l.id)) return prev;
        if (l.ownerId === uid) setActiveLayerId(l.id);
        return [...prev, l];
      });
    }
    else if (event.type === "layer_update") {
      const incoming = event.layers || [], ownerId = event.ownerId!;
      setLayers(prev => [...prev.filter(l => l.ownerId !== ownerId), ...incoming]);
    }
    else if (event.type === "layer_deleted") {
      setLayers(prev => prev.filter(l => l.id !== event.layerId));
    }
    else if (event.type === "layer_reorder") {
      const { ownerId, order } = event;
      if (!order) return;
      setLayers(prev => {
        const others    = prev.filter(l => l.ownerId !== ownerId);
        const reordered = order.map(id => prev.find(l => l.id === id)!).filter(Boolean);
        return [...others, ...reordered];
      });
    }
  }, []);

  const handleSaveProfile = useCallback((p: Profile) => {
    setProfileRaw(p);
    saveProfile(p);
    if (p.username !== profile.username) (Canvas as any)._rename?.(p.username);
  }, [profile.username]);

  const safeActiveId = useMemo(
    () => myLayers.find(l => l.id === activeLayerId) ? activeLayerId : (myLayers[0]?.id ?? -1),
    [myLayers, activeLayerId]
  );

  const room         = useMemo(() => new URLSearchParams(window.location.search).get("room") || "default", []);
  const createRoom   = useCallback(() => { window.location.href = `/?room=${Math.random().toString(36).substring(2, 8)}`; }, []);
  const copyRoomLink = useCallback(async () => { await navigator.clipboard.writeText(window.location.href); alert("✅ Enlace copiado"); }, []);

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
        profile={profile} onShowProfile={() => setShowProfile(true)}
        connStatus={connStatus}
        room={room} createRoom={createRoom} copyRoomLink={copyRoomLink}
      />
      {showProfile && (
        <ProfilePanel
          profile={profile} users={users}
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
        layers={layers} activeLayerId={safeActiveId}
        setUsers={setUsers}
        onReady={(fn) => setSavePNG(() => fn)}
        onBgColor={(c) => setBgColor(c)}
        onStrokeAdded={onStrokeAdded}
        onStrokeFinished={onStrokeFinished}
        onLayerEvent={handleLayerEvent}
        onConnectionChange={setConnStatus}
      />
      {myUserId && (
        <LayerPanel
          layers={layers} activeLayerId={safeActiveId}
          myUserId={myUserId} layerLimit={layerLimit}
          onSelect={setActiveLayerId}
          onAdd={handleAddLayer}
          onDelete={handleDeleteLayer}
          onToggleVisibility={handleToggleVisibility}
          onToggleLock={handleToggleLock}
          onRename={handleRenameLayer}
          onReorder={handleReorder}
          onOpacity={handleLayerOpacity}
          onOpacityLive={handleLayerOpacityLive}
          onMerge={handleMergeLayers}
          onBlendMode={handleBlendMode}
        />
      )}
    </>
  );
}

export default App;