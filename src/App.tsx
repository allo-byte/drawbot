import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import Canvas from "./components/Canvas";
import type { BrushType, CanvasSize, Layer } from "./components/Canvas";
import Toolbar from "./components/Toolbar";
import type { Shortcuts } from "./components/Toolbar";
import { DEFAULT_SHORTCUTS } from "./components/Toolbar";
import LayerPanel from "./components/LayerPanel";
import ProfilePanel, { getStoredProfile, saveProfile } from "./components/ProfilePanel";
import type { Profile } from "./components/ProfilePanel";

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
  const [canvasSize,    setCanvasSizeRaw] = useState<CanvasSize>({ w: 1024, h: 768 });
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

  // ── REDISEÑO undo/redo: autoritativo en el servidor ─────────────────────
  // Ya no hay undoStackRef/redoStackRef ni snapshots locales. El cliente
  // solo mantiene un booleano "puedo deshacer / puedo rehacer" que el
  // servidor le confirma en cada evento. Deshacer/rehacer es simplemente
  // "pedirle al servidor que lo haga" — sin cálculos, sin posibilidad de
  // desincronización entre lo que cree el cliente y lo que pasó realmente.
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  // Debounce: evita que el botón, el atajo de teclado, y el gesto táctil
  // disparen la misma acción más de una vez en una ventana muy corta de
  // tiempo (p.ej. un click que también dispara el listener de teclado).
  const lastUndoActionRef = useRef(0);

  const setColor = useCallback((c: string) => setColorRaw(c), []);

  // FIX (tamaño de lienzo vuelve a default al refrescar): setCanvasSize
  // ahora envía el cambio al servidor además de actualizar el estado local,
  // así la sala recuerda el tamaño elegido para todos los usuarios.
  const setCanvasSize = useCallback((sizeOrFn: CanvasSize | ((prev: CanvasSize) => CanvasSize)) => {
    setCanvasSizeRaw(prev => {
      const next = typeof sizeOrFn === "function" ? (sizeOrFn as any)(prev) : sizeOrFn;
      if (next && (next.w !== prev?.w || next.h !== prev?.h)) {
        (Canvas as any)._sendWS?.({ type: "canvas_resize", w: next.w, h: next.h });
      }
      return next;
    });
  }, []);

  // Cuando el servidor nos informa el tamaño guardado de la sala (al unirnos
  // o cuando otro usuario lo cambia), lo aplicamos SIN volver a enviarlo de
  // vuelta — solo actualizamos el estado local directamente.
  const handleCanvasSizeFromServer = useCallback((size: { w: number; h: number }) => {
    setCanvasSizeRaw(size);
  }, []);

  const onStrokeFinished = useCallback((strokeColor: string) => {
    if (!strokeColor || strokeColor === "eraser") return;
    setColorHistory(prev => {
      if (prev[0] === strokeColor) return prev;
      const next = [strokeColor, ...prev.filter(x => x !== strokeColor)].slice(0, MAX_COLOR_HISTORY);
      localStorage.setItem("drawbot-colors", JSON.stringify(next));
      return next;
    });
  }, []);

  // Canvas nos avisa cuando el servidor confirma un cambio en el estado de
  // undo/redo disponible (al dibujar, al recibir init, o tras un undo/redo
  // de cualquier usuario en la sala que afecte a este usuario).
  const handleUndoStateChange = useCallback((state: { canUndo: boolean; canRedo: boolean }) => {
    setCanUndo(state.canUndo);
    setCanRedo(state.canRedo);
  }, []);

  const handleUndo = useCallback(() => {
    // Ignora disparos repetidos que lleguen demasiado rápido seguidos
    // (mismo gesto detectado por más de un listener, doble-click accidental).
    const now = performance.now();
    if (now - lastUndoActionRef.current < UNDO_DEBOUNCE_MS) return;
    lastUndoActionRef.current = now;
    // Solo le pedimos al servidor que deshaga — él decide qué stroke quitar
    // y le avisa a TODOS (incluido este navegador) cuando ya pasó.
    (Canvas as any)._sendUndo?.();
  }, []);

  const handleRedo = useCallback(() => {
    const now = performance.now();
    if (now - lastUndoActionRef.current < UNDO_DEBOUNCE_MS) return;
    lastUndoActionRef.current = now;
    (Canvas as any)._sendRedo?.();
  }, []);

  // Refs siempre frescos — evitan re-crear listeners en cada render
  const handleUndoRef = useRef(handleUndo);
  const handleRedoRef = useRef(handleRedo);
  const savePNGRef    = useRef(savePNG);
  // handleFlipHorizontal se define más abajo en el archivo (depende del
  // componente Canvas montado); el ref se declara aquí para que el
  // useEffect de atajos de teclado pueda usarlo, y se actualiza con el
  // valor real justo después de que la función exista.
  const handleFlipRef = useRef<() => void>(() => {});
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
      if (match(e, shortcuts.flip))   { e.preventDefault(); handleFlipRef.current(); }
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
    (Canvas as any)._mergeLayers?.(bottom.id, top.id);
    const updated = layers.filter(l => l.id !== top.id);
    pushLayerUpdate(updated);
    if (activeLayerId === topId) setActiveLayerId(bottom.id);
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

  // FEATURE: voltear lienzo (vista local, no afecta a otros usuarios).
  // El estado real vive en Canvas (flipXRef); aquí solo reflejamos un
  // booleano para que el botón de Toolbar pueda mostrarse "activo".
  const [flippedX, setFlippedX] = useState(false);
  const handleFlipHorizontal = useCallback(() => {
    const nowFlipped = (Canvas as any)._toggleFlipX?.();
    setFlippedX(!!nowFlipped);
  }, []);
  // Mantener el ref fresco en cada render para que el atajo de teclado
  // (cuyo listener vive en un useEffect con dependencias distintas)
  // siempre llame a la versión más reciente de esta función.
  handleFlipRef.current = handleFlipHorizontal;

  // El gesto de 4 dedos (detectado dentro de Canvas) dispara este evento
  // para que App.tsx mantenga sincronizado el estado visual del botón.
  useEffect(() => {
    const onFlipGesture = () => handleFlipHorizontal();
    window.addEventListener("drawbot:flipx", onFlipGesture);
    return () => window.removeEventListener("drawbot:flipx", onFlipGesture);
  }, [handleFlipHorizontal]);

  // FEATURE: crosshair configurable (forma + tamaño) — persiste en
  // localStorage para que la preferencia del usuario sobreviva entre
  // sesiones, igual que los atajos de teclado.
  const [crosshairConfig, setCrosshairConfigRaw] = useState<{ shape: "circle"|"cross"|"dot"; size: number; enabled: boolean }>(() => {
    try {
      const saved = localStorage.getItem("drawbot-crosshair");
      if (saved) return JSON.parse(saved);
    } catch {}
    return { shape: "circle", size: 24, enabled: true };
  });
  const setCrosshairConfig = useCallback((cfg: Partial<{ shape: "circle"|"cross"|"dot"; size: number; enabled: boolean }>) => {
    setCrosshairConfigRaw(prev => {
      const next = { ...prev, ...cfg };
      localStorage.setItem("drawbot-crosshair", JSON.stringify(next));
      (Canvas as any)._setCrosshairConfig?.(next);
      return next;
    });
  }, []);
  // Aplicar la configuración guardada en Canvas tan pronto como esté
  // montado — Canvas inicializa su propio ref con un default que puede no
  // coincidir con lo que el usuario guardó en una sesión anterior.
  useEffect(() => {
    (Canvas as any)._setCrosshairConfig?.(crosshairConfig);
  }, []);

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
        canUndo={canUndo} canRedo={canRedo}
        bgColor={bgColor}
        setBgColor={(c: string) => { setBgColor(c); (Canvas as any)._sendBgColor?.(c); }}
        savePNG={savePNG}
        users={users} username={username}
        profile={profile} onShowProfile={() => setShowProfile(true)}
        connStatus={connStatus}
        room={room} createRoom={createRoom} copyRoomLink={copyRoomLink}
        flippedX={flippedX} onFlipHorizontal={handleFlipHorizontal}
        crosshairConfig={crosshairConfig} setCrosshairConfig={setCrosshairConfig}
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
        onCanvasSizeFromServer={handleCanvasSizeFromServer}
        onUndoStateChange={handleUndoStateChange}
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