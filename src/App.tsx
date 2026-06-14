import { useState, useEffect, useCallback } from "react";
import Canvas from "./components/Canvas";
import type { BrushType, CanvasSize } from "./components/Canvas";
import Toolbar from "./components/Toolbar";
import type { Shortcuts } from "./components/Toolbar";
import { DEFAULT_SHORTCUTS } from "./components/Toolbar";

// Stroke type para undo/redo
type Stroke = {
  points: {x:number;y:number}[];
  color: string;
  size: number;
  opacity: number;
  eraser: boolean;
  brushType?: BrushType;
};

const MAX_HISTORY = 50;
const MAX_COLOR_HISTORY = 8;

function App() {
  const [color,       setColorRaw   ] = useState("#ffffff");
  const [brushSize,   setBrushSize  ] = useState(5);
  const [opacity,     setOpacity    ] = useState(1);
  const [eraser,      setEraser     ] = useState(false);
  const [brushType,   setBrushType  ] = useState<BrushType>("pen");
  const [panMode,     setPanMode    ] = useState(false);
  const [bgColor,     setBgColor    ] = useState("#111111");
  const [canvasSize,  setCanvasSize ] = useState<CanvasSize>(null);
  const [savePNG,     setSavePNG    ] = useState<() => void>(() => () => {});
  const [users,       setUsers      ] = useState<string[]>([]);
  const [username,    setUsername   ] = useState(
    localStorage.getItem("drawbot-name") || "Invitado"
  );

  // Historial de colores
  const [colorHistory, setColorHistory] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem("drawbot-colors") || "[]"); }
    catch { return []; }
  });

  // Atajos configurables
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

  // Historial undo/redo por usuario (solo strokes del usuario actual)
  const [undoStack, setUndoStack] = useState<Stroke[][]>([]);
  const [redoStack, setRedoStack] = useState<Stroke[][]>([]);

  // Referencia al Canvas para llamar undo/redo
  const [canvasRef, setCanvasRef] = useState<{
    undo: () => void;
    redo: () => void;
    getMyStrokes: () => Stroke[];
    setMyStrokes: (s: Stroke[]) => void;
  } | null>(null);

  // Cambiar color y guardar en historial
  const setColor = useCallback((c: string) => {
    setColorRaw(c);
    setColorHistory(prev => {
      if (prev[0] === c) return prev;
      const next = [c, ...prev.filter(x => x !== c)].slice(0, MAX_COLOR_HISTORY);
      localStorage.setItem("drawbot-colors", JSON.stringify(next));
      return next;
    });
  }, []);

  // Undo
  const handleUndo = useCallback(() => {
    if (!canvasRef) return;
    const myStrokes = canvasRef.getMyStrokes();
    if (myStrokes.length === 0) return;
    const newStrokes = myStrokes.slice(0, -1);
    setUndoStack(prev => [...prev.slice(-MAX_HISTORY), myStrokes]);
    setRedoStack([]);
    canvasRef.setMyStrokes(newStrokes);
  }, [canvasRef]);

  // Redo
  const handleRedo = useCallback(() => {
    if (!canvasRef || undoStack.length === 0) return;
    const prev = undoStack[undoStack.length - 1];
    setUndoStack(s => s.slice(0, -1));
    setRedoStack(s => [...s, canvasRef.getMyStrokes()]);
    canvasRef.setMyStrokes(prev);
  }, [canvasRef, undoStack]);

  // Atajos de teclado globales
  useEffect(() => {
    const match = (e: KeyboardEvent, shortcut: string) => {
      const parts = shortcut.split("+");
      const key = parts[parts.length - 1];
      const ctrl = parts.includes("ctrl");
      const shift = parts.includes("shift");
      return (
        e.key.toLowerCase() === key &&
        !!(e.ctrlKey || e.metaKey) === ctrl &&
        e.shiftKey === shift
      );
    };

    const handler = (e: KeyboardEvent) => {
      // No activar si está escribiendo
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;

      if (match(e, shortcuts.undo))   { e.preventDefault(); handleUndo(); }
      if (match(e, shortcuts.redo))   { e.preventDefault(); handleRedo(); }
      if (match(e, shortcuts.save))   { e.preventDefault(); savePNG(); }
      if (match(e, shortcuts.eraser)) { setEraser(v => !v); setPanMode(false); }
      if (match(e, shortcuts.pan))    { setPanMode(v => !v); setEraser(false); }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [shortcuts, handleUndo, handleRedo, savePNG]);

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
        canUndo={undoStack.length > 0 || (canvasRef?.getMyStrokes().length ?? 0) > 0}
        canRedo={redoStack.length > 0}
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
        setUsers={setUsers}
        onReady={(saveFn) => setSavePNG(() => saveFn)}
        onBgColor={(c) => setBgColor(c)}
        onStrokeAdded={(getMyStrokes, setMyStrokes) => {
          setCanvasRef({ 
            undo: handleUndo, 
            redo: handleRedo,
            getMyStrokes,
            setMyStrokes,
          });
          // Guardar estado para undo
          setUndoStack(prev => [...prev.slice(-MAX_HISTORY), getMyStrokes().slice(0,-1)]);
          setRedoStack([]);
        }}
      />
    </>
  );
}

export default App;