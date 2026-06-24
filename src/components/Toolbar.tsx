import { useState, useEffect, useRef } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { BrushType, CanvasSize } from "./Canvas";
import { AvatarDisplay, RemoteAvatar } from "./ProfilePanel";
import type { Profile } from "./ProfilePanel";

type Setter<T> = Dispatch<SetStateAction<T>> | ((v: T) => void);

export type Shortcuts = {
  undo: string;
  redo: string;
  eraser: string;
  pan: string;
  save: string;
  flip: string;
};

export const DEFAULT_SHORTCUTS: Shortcuts = {
  undo:   "ctrl+z",
  redo:   "ctrl+y",
  eraser: "e",
  pan:    "h",
  save:   "ctrl+s",
  flip:   "shift+h",
};

type Props = {
  color: string;
  setColor: Setter<string>;
  brushSize: number;
  setBrushSize: Setter<number>;
  opacity: number;
  setOpacity: Setter<number>;
  eraser: boolean;
  setEraser: Setter<boolean>;
  brushType: BrushType;
  setBrushType: Setter<BrushType>;
  bgColor: string;
  setBgColor: Setter<string>;
  panMode: boolean;
  setPanMode: Setter<boolean>;
  // FEATURE: voltear lienzo (vista local)
  flippedX: boolean;
  onFlipHorizontal: () => void;
  // FEATURE: crosshair configurable desde Ajustes
  crosshairConfig: { shape: "circle"|"cross"|"dot"; size: number; enabled: boolean };
  setCrosshairConfig: (cfg: Partial<{ shape: "circle"|"cross"|"dot"; size: number; enabled: boolean }>) => void;
  // FEATURE: estabilización de trazo — slider 0-100, vive en el panel de pinceles
  smoothing: number;
  setSmoothing: (value: number) => void;
  canvasSize: CanvasSize;
  setCanvasSize: Setter<CanvasSize>;
  colorHistory: string[];
  shortcuts: Shortcuts;
  setShortcuts: (s: Shortcuts | ((prev: Shortcuts) => Shortcuts)) => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  savePNG: () => void;
  users: string[];
  username: string;
  profile?: Profile;
  onShowProfile?: () => void;
  connStatus?: "connected"|"disconnected"|"reconnecting";
  room: string;
  createRoom: () => void;
  copyRoomLink: () => void;
};

const BRUSH_ICONS: Record<BrushType | "eraser", React.ReactNode> = {
  pen: (
    <svg viewBox="0 0 28 28" width="20" height="20">
      <path d="M6 22 L18 6 L22 10 L10 26 Z" fill="currentColor" opacity="0.85"/>
      <rect x="17.5" y="5" width="5" height="5" rx="1" transform="rotate(45 20 8)" fill="#e8854a"/>
      <line x1="6" y1="22" x2="10" y2="26" stroke="currentColor" strokeWidth="1.5"/>
    </svg>
  ),
  caligraphy1: (
    <svg viewBox="0 0 28 28" width="20" height="20">
      <path d="M5 23 L11 5 L17 5 L11 23 Z" fill="currentColor" opacity="0.85"/>
      <path d="M11 5 L17 5 L23 23 L17 23 Z" fill="currentColor" opacity="0.35"/>
    </svg>
  ),
  caligraphy2: (
    <svg viewBox="0 0 28 28" width="20" height="20">
      <path d="M5 5 L11 5 L23 23 L17 23 Z" fill="currentColor" opacity="0.35"/>
      <path d="M11 5 L17 5 L23 23 L17 23 Z" fill="currentColor" opacity="0.85"/>
    </svg>
  ),
  airbrush: (
    <svg viewBox="0 0 28 28" width="20" height="20">
      <rect x="4" y="11" width="14" height="7" rx="3.5" fill="currentColor" opacity="0.8"/>
      <rect x="16" y="13.5" width="7" height="2" rx="1" fill="currentColor" opacity="0.6"/>
      <circle cx="21" cy="8" r="1.2" fill="currentColor" opacity="0.5"/>
      <circle cx="24" cy="11" r="1" fill="currentColor" opacity="0.4"/>
      <circle cx="23" cy="15" r="0.9" fill="currentColor" opacity="0.35"/>
      <circle cx="24" cy="19" r="1" fill="currentColor" opacity="0.3"/>
      <circle cx="21" cy="22" r="1.2" fill="currentColor" opacity="0.25"/>
    </svg>
  ),
  oil: (
    <svg viewBox="0 0 28 28" width="20" height="20">
      <path d="M13 4 Q16 4 17 8 L15 24 Q14 26 13 26 Q12 26 11 24 L9 8 Q10 4 13 4Z" fill="currentColor" opacity="0.8"/>
      <path d="M10 10 Q13 8 16 10 Q14 12 10 10Z" fill="white" opacity="0.25"/>
      <rect x="12" y="2" width="2" height="4" rx="1" fill="#aaa"/>
    </svg>
  ),
  crayon: (
    <svg viewBox="0 0 28 28" width="20" height="20">
      <path d="M11 4 L17 4 L19 20 L9 20 Z" fill="currentColor" opacity="0.75"/>
      <polygon points="9,20 19,20 14,26" fill="#e8854a"/>
      <line x1="10" y1="8" x2="18" y2="8" stroke="white" strokeWidth="0.6" opacity="0.3"/>
      <line x1="10" y1="11" x2="18" y2="12" stroke="white" strokeWidth="0.6" opacity="0.25"/>
      <line x1="10" y1="14" x2="18" y2="14" stroke="white" strokeWidth="0.6" opacity="0.2"/>
    </svg>
  ),
  marker: (
    <svg viewBox="0 0 28 28" width="20" height="20">
      <rect x="10" y="3" width="8" height="16" rx="2" fill="currentColor" opacity="0.85"/>
      <rect x="11" y="19" width="6" height="3" rx="1" fill="currentColor" opacity="0.6"/>
      <rect x="12" y="22" width="4" height="4" rx="0.5" fill="#555"/>
      <rect x="11" y="5" width="2" height="8" rx="1" fill="white" opacity="0.2"/>
    </svg>
  ),
  pencil: (
    <svg viewBox="0 0 28 28" width="20" height="20">
      <rect x="12.5" y="3" width="4" height="17" rx="2" fill="currentColor" opacity="0.7"/>
      <polygon points="12.5,20 15.5,20 15.5,26 14,28 12.5,26" fill="#f5d5a0"/>
      <polygon points="13.5,24 15.5,24 14.5,28" fill="#2a1a0a" opacity="0.7"/>
      <rect x="13" y="3" width="1.5" height="12" rx="0.75" fill="white" opacity="0.18"/>
    </svg>
  ),
  eraser: (
    <svg viewBox="0 0 28 28" width="20" height="20">
      <rect x="5" y="12" width="18" height="10" rx="2" fill="#e8e0d8" opacity="0.9"/>
      <rect x="5" y="12" width="8" height="10" rx="2" fill="#e8854a" opacity="0.85"/>
      <line x1="5" y1="22" x2="23" y2="22" stroke="#bbb" strokeWidth="1.5"/>
    </svg>
  ),
};

// FEATURE: iconos para las herramientas nuevas del panel de pinceles
const TOOL_ICONS = {
  flip: (
    <svg viewBox="0 0 28 28" width="20" height="20">
      <line x1="14" y1="3" x2="14" y2="25" stroke="currentColor" strokeWidth="1.2" strokeDasharray="2,2" opacity="0.5"/>
      <path d="M14 6 L6 10 L6 18 L14 22 Z" fill="currentColor" opacity="0.75"/>
      <path d="M14 6 L22 10 L22 18 L14 22 Z" fill="currentColor" opacity="0.35"/>
      <path d="M3 14 L7 11 L7 17 Z" fill="currentColor" opacity="0.6"/>
      <path d="M25 14 L21 11 L21 17 Z" fill="currentColor" opacity="0.6"/>
    </svg>
  ),
};

const BRUSHES: { type: BrushType; label: string }[] = [
  { type: "pen",         label: "Pincel"    },
  { type: "caligraphy1", label: "Calig. /"  },
  { type: "caligraphy2", label: "Calig. \\" },
  { type: "airbrush",    label: "Aerógrafo" },
  { type: "oil",         label: "Óleo"      },
  { type: "crayon",      label: "Crayón"    },
  { type: "marker",      label: "Rotulador" },
  { type: "pencil",      label: "Lápiz"     },
];

function userColor(name: string) {
  const colors = ["#e05d5d","#e09a3a","#d4c94a","#5dbe6e","#4ab8d4","#7070dd","#c46edd","#dd6eaa"];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length];
}

function UserAvatar({ name, size = 28 }: { name: string; size?: number }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: "50%",
      background: userColor(name), color: "#fff",
      display: "flex", alignItems: "center", justifyContent: "center",
      fontSize: size * 0.38, fontWeight: "bold", flexShrink: 0,
      border: "1.5px solid rgba(255,255,255,0.15)",
    }}>{name.trim().slice(0, 2).toUpperCase() || "?"}</div>
  );
}

function VSlider({ value, min, max, onChange, color = "#7070dd", label }: {
  value: number; min: number; max: number;
  onChange: (v: number) => void; color?: string; label?: string;
}) {
  const pct = ((value - min) / (max - min)) * 100;
  const trackRef = useRef<HTMLDivElement>(null);

  const handlePointer = (e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    const calc = (ev: PointerEvent) => {
      const rect = trackRef.current!.getBoundingClientRect();
      const t = 1 - Math.max(0, Math.min(1, (ev.clientY - rect.top) / rect.height));
      onChange(Math.round(min + t * (max - min)));
    };
    const up = (ev: PointerEvent) => {
      e.currentTarget.releasePointerCapture(ev.pointerId);
      e.currentTarget.removeEventListener("pointermove", calc as any);
      e.currentTarget.removeEventListener("pointerup", up as any);
    };
    (e.currentTarget as HTMLDivElement).addEventListener("pointermove", calc as any);
    (e.currentTarget as HTMLDivElement).addEventListener("pointerup", up as any);
    calc(e.nativeEvent as PointerEvent);
  };

  return (
    <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:6, userSelect:"none" }}>
      {label && <span style={{ fontSize:9, color:"#555", textTransform:"uppercase", letterSpacing:".06em" }}>{label}</span>}
      <div ref={trackRef}
        style={{ position:"relative", width:28, height:220, cursor:"ns-resize",
          display:"flex", alignItems:"center", justifyContent:"center", touchAction:"none" }}
        onPointerDown={handlePointer}>
        <div style={{ position:"absolute", left:"50%", top:0, bottom:0, width:6,
          transform:"translateX(-50%)", borderRadius:3, background:"#222" }}/>
        <div style={{ position:"absolute", left:"50%", bottom:0, width:6,
          transform:"translateX(-50%)", borderRadius:3,
          height:`${pct}%`, background:color }}/>
        <div style={{ position:"absolute", left:"50%", transform:"translateX(-50%)",
          top:`${100-pct}%`, marginTop:-12,
          width:24, height:24, borderRadius:"50%",
          background:"#1e1e1e", border:`2.5px solid ${color}`,
          boxShadow:`0 0 0 3px ${color}22, 0 2px 8px rgba(0,0,0,0.6)` }}/>
      </div>
      <span style={{ fontSize:11, color:"#888", minWidth:32, textAlign:"center" }}>
        {value}{label==="OPA" ? "%" : ""}
      </span>
    </div>
  );
}

function fmtShortcut(s: string) {
  return s.split("+").map(k =>
    k === "ctrl" ? "⌘/Ctrl" : k === "shift" ? "⇧" : k.toUpperCase()
  ).join(" + ");
}

export default function Toolbar({
  color, setColor, brushSize, setBrushSize,
  opacity, setOpacity, eraser, setEraser,
  brushType, setBrushType, bgColor, setBgColor,
  panMode, setPanMode,
  flippedX, onFlipHorizontal,
  crosshairConfig, setCrosshairConfig,
  smoothing, setSmoothing,
  canvasSize, setCanvasSize,
  colorHistory, shortcuts, setShortcuts,
  onUndo, onRedo, canUndo, canRedo,
  savePNG, users, username,
  profile, onShowProfile, connStatus,
  room, createRoom, copyRoomLink,
}: Props) {
  const [showBrushes,  setShowBrushes ] = useState(false);
  const [showColor,    setShowColor   ] = useState(false);
  const [showRoom,     setShowRoom    ] = useState(false);
  const [showCanvas,   setShowCanvas  ] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [customW,      setCustomW     ] = useState(1920);
  const [customH,      setCustomH     ] = useState(1080);
  const [hex,          setHex         ] = useState(color);
  const [capturingKey, setCapturingKey] = useState<keyof Shortcuts | null>(null);

  useEffect(() => setHex(color), [color]);

  const closeAll = () => {
    setShowBrushes(false); setShowColor(false);
    setShowRoom(false); setShowCanvas(false); setShowSettings(false);
  };

  const hexToRgb = (h: string) => {
    const rx = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(h);
    if (!rx) return { r:255, g:255, b:255 };
    return { r: parseInt(rx[1],16), g: parseInt(rx[2],16), b: parseInt(rx[3],16) };
  };
  const rgb = hexToRgb(color);
  const updateRGB = (ch: "r"|"g"|"b", val: number) => {
    const n = {...rgb}; n[ch] = Math.max(0,Math.min(255,val));
    setColor("#"+[n.r,n.g,n.b].map(v=>v.toString(16).padStart(2,"0")).join(""));
  };

  const activeBrush = BRUSHES.find(b => b.type === brushType);
  const activeToolIcon  = eraser ? BRUSH_ICONS.eraser : BRUSH_ICONS[brushType];
  const activeToolLabel = eraser ? "Borrador" : (activeBrush?.label ?? "Pincel");

  const handleCaptureKey = (e: React.KeyboardEvent) => {
    if (!capturingKey) return;
    e.preventDefault();
    const parts: string[] = [];
    if (e.ctrlKey || e.metaKey) parts.push("ctrl");
    if (e.shiftKey) parts.push("shift");
    if (e.altKey) parts.push("alt");
    const k = e.key.toLowerCase();
    if (!["control","shift","alt","meta"].includes(k)) parts.push(k);
    if (parts.length === 0) return;
    setShortcuts((prev: Shortcuts) => ({ ...prev, [capturingKey]: parts.join("+") }));
    setCapturingKey(null);
  };

  const SHORTCUT_LABELS: Record<keyof Shortcuts, string> = {
    undo:   "Deshacer",
    redo:   "Rehacer",
    eraser: "Borrador",
    pan:    "Mano/Pan",
    save:   "Guardar PNG",
    flip:   "Voltear lienzo",
  };

  return (
    <>
      <style>{`
        .tb * { box-sizing: border-box; }
        input[type=number]::-webkit-inner-spin-button { opacity:1; }
        .tb-top {
          position: fixed; top: 0; left: 0; right: 0;
          height: 52px; z-index: 1000;
          background: rgba(18,18,18,0.95);
          backdrop-filter: blur(12px);
          border-bottom: 0.5px solid #2a2a2a;
          display: flex; align-items: center;
          padding: 0 12px; gap: 8px;
        }
        .tb-left {
          position: fixed; left: 0; top: 52px; bottom: 0;
          width: 52px; z-index: 999;
          background: rgba(18,18,18,0.92);
          backdrop-filter: blur(12px);
          border-right: 0.5px solid #2a2a2a;
          display: flex; flex-direction: column;
          align-items: center; justify-content: center;
          gap: 24px; padding: 16px 0;
        }
        .tb-btn {
          width: 36px; height: 36px; border-radius: 10px;
          border: 0.5px solid #333; background: #1e1e1e;
          color: #aaa; display: flex; align-items: center;
          justify-content: center; cursor: pointer; flex-shrink: 0;
          font-size: 16px; transition: background .12s, border-color .12s;
          -webkit-tap-highlight-color: transparent; touch-action: manipulation;
        }
        .tb-btn:hover { background: #2a2a2a; border-color: #555; }
        .tb-btn.active { background: #2a2a5a; border-color: #7070dd; color: #aaaaff; }
        .tb-btn.eraser-active { background: #3a2a2a; border-color: #dd7070; color: #ffaaaa; }
        .tb-btn:disabled { opacity: 0.3; cursor: not-allowed; }
        .tb-color-btn {
          width: 32px; height: 32px; border-radius: 50%;
          border: 2px solid #555; cursor: pointer; flex-shrink: 0;
          transition: transform .12s, border-color .12s;
          -webkit-tap-highlight-color: transparent;
        }
        .tb-color-btn:hover { transform: scale(1.1); border-color: #aaa; }
        .tb-sep { width: 1px; height: 28px; background: #2e2e2e; flex-shrink: 0; }
        .tb-sep-h { height: 1px; width: 28px; background: #2e2e2e; flex-shrink: 0; }
        .tb-panel {
          position: fixed; z-index: 1100;
          background: rgba(20,20,20,0.98);
          border: 0.5px solid #333; border-radius: 14px;
          box-shadow: 0 8px 32px rgba(0,0,0,0.7);
          padding: 14px; max-height: 85vh; overflow-y: auto;
        }
        /* FEATURE: scrollbar visible para el panel de Ajustes — el
           contenido (atajos de teclado + sección de crosshair táctil)
           puede exceder fácilmente los 85vh de alto disponible, y la
           scrollbar nativa del navegador suele ser casi invisible sobre
           fondos oscuros, dando la impresión de que no hay scroll. */
        .tb-panel-settings::-webkit-scrollbar { width: 8px; }
        .tb-panel-settings::-webkit-scrollbar-track { background: #161616; border-radius: 8px; }
        .tb-panel-settings::-webkit-scrollbar-thumb {
          background: #3a3a4a; border-radius: 8px; border: 2px solid #161616;
        }
        .tb-panel-settings::-webkit-scrollbar-thumb:hover { background: #4a4a5a; }
        .tb-panel-settings { scrollbar-width: thin; scrollbar-color: #3a3a4a #161616; }
        /* FEATURE: el panel de pinceles ahora también puede crecer
           (slider de estabilización debajo de la grilla), así que aplicamos
           la misma scrollbar visible que ya usa el panel de Ajustes. */
        .tb-panel-brushes::-webkit-scrollbar { width: 8px; }
        .tb-panel-brushes::-webkit-scrollbar-track { background: #161616; border-radius: 8px; }
        .tb-panel-brushes::-webkit-scrollbar-thumb {
          background: #3a3a4a; border-radius: 8px; border: 2px solid #161616;
        }
        .tb-panel-brushes::-webkit-scrollbar-thumb:hover { background: #4a4a5a; }
        .tb-panel-brushes { scrollbar-width: thin; scrollbar-color: #3a3a4a #161616; }
        .tb-panel-brushes { top: 60px; left: 50%; transform: translateX(-50%); width: min(92vw,380px); }
        .tb-panel-color   { top: 60px; left: 60px; width: 300px; }
        .tb-panel-room    { top: 60px; right: 12px; width: 260px; }
        .tb-brushgrid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; }
        .tb-brushbtn {
          display: flex; flex-direction: column; align-items: center;
          gap: 4px; padding: 8px 4px; border-radius: 10px;
          border: 1px solid #2e2e2e; background: #1a1a1a;
          cursor: pointer; color: #bbb;
          transition: background .12s, border-color .12s;
          -webkit-tap-highlight-color: transparent;
        }
        .tb-brushbtn .lbl { font-size: 9px; color: #666; text-align: center; }
        .tb-brushbtn.active { border-color: #7070dd; background: #1e1e3a; color: #aaaaff; }
        .tb-brushbtn.active .lbl { color: #9999ee; }
        .tb-brushbtn:hover { background: #222; }
        .tb-small-btn {
          background: #1e1e1e; border: 0.5px solid #333; border-radius: 8px;
          color: #aaa; font-size: 12px; padding: 5px 10px; cursor: pointer;
          -webkit-tap-highlight-color: transparent;
        }
        .tb-small-btn:hover { background: #2a2a2a; }
        .tb-bg-swatch {
          width: 22px; height: 22px; border-radius: 5px; cursor: pointer;
          border: 1.5px solid #444; flex-shrink: 0; transition: transform .1s;
        }
        .tb-bg-swatch:hover { transform: scale(1.15); }
        .tb-bg-swatch.sel { border-color: #7070dd; }
        .tb-overlay { position: fixed; inset: 0; z-index: 1050; }
        .tb-section { font-size: 10px; color: #555; text-transform: uppercase; letter-spacing: .06em; margin-bottom: 8px; }
        .tb-avatar-stack { display: flex; }
        .tb-avatar-stack > * { margin-left: -5px; }
        .tb-avatar-stack > *:first-child { margin-left: 0; }
        .tb-color-hist { display: flex; gap: 5px; flex-wrap: wrap; margin-top: 8px; }
        .tb-color-hist-swatch {
          width: 24px; height: 24px; border-radius: 6px; cursor: pointer;
          border: 1.5px solid #333; transition: transform .1s, border-color .1s; flex-shrink: 0;
        }
        .tb-color-hist-swatch:hover { transform: scale(1.15); border-color: #aaa; }
        .tb-shortcut-row {
          display: flex; align-items: center; justify-content: space-between;
          padding: 8px 0; border-bottom: 0.5px solid #1e1e1e;
        }
        .tb-shortcut-row:last-child { border-bottom: none; }
        .tb-key-badge {
          background: #1a1a1a; border: 0.5px solid #444;
          border-radius: 6px; color: #aaa; font-size: 11px;
          padding: 3px 8px; font-family: monospace; cursor: pointer;
          transition: border-color .12s;
        }
        .tb-key-badge:hover { border-color: #7070dd; color: #aaaaff; }
        .tb-key-badge.capturing { border-color: #e09a3a; color: #e09a3a; animation: pulse .6s infinite; }
        @keyframes pulse { 0%,100% { opacity:1 } 50% { opacity:.5 } }

        .tb-profile-btn {
          display: flex; align-items: center; gap: 6px;
          cursor: pointer; padding: 3px 6px 3px 3px;
          border-radius: 20px; border: 0.5px solid transparent;
          transition: background .12s, border-color .12s;
          -webkit-tap-highlight-color: transparent;
        }
        .tb-profile-btn:hover { background: #1e1e1e; border-color: #333; }
        .tb-profile-name {
          font-size: 12px; color: #888; max-width: 80px;
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }
        .tb-tool-sep {
          height: 0.5px; background: #2a2a2a; margin: 6px 0;
        }

        @media (max-width: 480px) {
          .tb-panel-brushes { left: 52px; transform: none; width: calc(100vw - 64px); }
          .tb-panel-color { left: 52px; width: calc(100vw - 64px); }
          .tb-profile-name { display: none; }
        }
      `}</style>

      {/* ═══ BARRA SUPERIOR ═══ */}
      <div className="tb-top" onKeyDown={handleCaptureKey} tabIndex={-1}>

        {/* Avatar / Perfil */}
        <div className="tb-profile-btn"
          onClick={() => { closeAll(); onShowProfile?.(); }}>
          {profile
            ? <AvatarDisplay profile={profile} size={30}/>
            : <UserAvatar name={username} size={30}/>
          }
          <span className="tb-profile-name">{username}</span>
        </div>

        <div className="tb-sep"/>

        {/* Color activo */}
        <div className="tb-color-btn" style={{ background: color }}
          onClick={() => { closeAll(); setShowColor(c=>!c); }} />

        {/* Herramienta activa (pincel / borrador / cubeta / licuar) */}
        <div className={`tb-btn${showBrushes ? " active" : ""}`}
          onClick={() => { closeAll(); setShowBrushes(b=>!b); }} title="Pinceles y herramientas">
          {activeToolIcon}
        </div>
        <span style={{ color:"#666", fontSize:12, flexShrink:0 }}>
          {activeToolLabel}
        </span>

        <div className="tb-sep"/>

        {/* Undo / Redo */}
        <div className="tb-btn" onClick={onUndo}
          title={`Deshacer (${fmtShortcut(shortcuts.undo)})`}
          style={{ opacity: canUndo ? 1 : 0.3, fontSize:14 }}>↩️</div>
        <div className="tb-btn" onClick={onRedo}
          title={`Rehacer (${fmtShortcut(shortcuts.redo)})`}
          style={{ opacity: canRedo ? 1 : 0.3, fontSize:14 }}>↪️</div>

        <div className="tb-sep"/>

        {/* Pan / Borrador */}
        <div className={`tb-btn${panMode ? " active" : ""}`}
          onClick={() => setPanMode(!panMode)}
          title={`Mover (${fmtShortcut(shortcuts.pan)})`} style={{ fontSize:16 }}>✋</div>
        <div className={`tb-btn${eraser ? " eraser-active" : ""}`}
          onClick={() => setEraser(!eraser)}
          title={`Borrador (${fmtShortcut(shortcuts.eraser)})`}>
          {BRUSH_ICONS.eraser}
        </div>

        {/* FEATURE: voltear lienzo — toggle directo en la barra, ya que es
            una acción de vista instantánea, no requiere abrir un panel */}
        <div className={`tb-btn${flippedX ? " active" : ""}`}
          onClick={onFlipHorizontal}
          title={`Voltear lienzo, solo tu vista (${fmtShortcut(shortcuts.flip)})`} style={{ fontSize:15 }}>
          {TOOL_ICONS.flip}
        </div>

        <div style={{ flex:1 }}/>

        {/* Stack de usuarios en sala */}
        <div className="tb-avatar-stack" style={{ cursor:"pointer" }}
          onClick={() => { closeAll(); onShowProfile?.(); }}>
          {users.slice(0,3).map((u,i) => <RemoteAvatar key={i} username={u} size={26}/>)}
        </div>
        <span style={{ color:"#00ff88", fontSize:12, marginLeft:4 }}>{users.length}</span>

        {/* Indicador de conexión */}
        <div title={
          connStatus==="connected" ? "Conectado" :
          connStatus==="reconnecting" ? "Reconectando..." : "Sin conexión"
        } style={{
          width:8, height:8, borderRadius:"50%", flexShrink:0,
          background:
            connStatus==="connected"    ? "#00ff88" :
            connStatus==="reconnecting" ? "#e09a3a" : "#e05d5d",
          boxShadow:
            connStatus==="connected"    ? "0 0 6px #00ff8866" :
            connStatus==="reconnecting" ? "0 0 6px #e09a3a66" : "0 0 6px #e05d5d66",
          animation: connStatus==="reconnecting" ? "pulse .8s infinite" : "none",
        }}/>

        <div className="tb-sep"/>

        {/* Sala */}
        <div className={`tb-btn${showRoom ? " active" : ""}`}
          onClick={() => { closeAll(); setShowRoom(r=>!r); }} title="Sala" style={{ fontSize:14 }}>🔗</div>

        {/* Tamaño lienzo */}
        <div className={`tb-btn${showCanvas ? " active" : ""}`}
          onClick={() => { closeAll(); setShowCanvas(c=>!c); }}
          title="Tamaño del lienzo" style={{ flexDirection:"column" as any, gap:1 }}>
          <span style={{fontSize:10}}>⬜</span>
          <span style={{fontSize:7, color:"#666"}}>px</span>
        </div>

        {/* Guardar */}
        <div className="tb-btn" onClick={savePNG}
          title={`Guardar PNG (${fmtShortcut(shortcuts.save)})`} style={{ fontSize:14 }}>💾</div>

        {/* Ajustes */}
        <div className={`tb-btn${showSettings ? " active" : ""}`}
          onClick={() => { closeAll(); setShowSettings(s=>!s); }} title="Ajustes" style={{ fontSize:16 }}>⚙️</div>
      </div>

      {/* ═══ BARRA IZQUIERDA ═══ */}
      <div className="tb-left">
        <VSlider value={brushSize} min={1} max={2000}
          onChange={v => setBrushSize(v)} color="#7070dd" label="TAM"/>
        <div className="tb-sep-h"/>
        <VSlider value={Math.round(opacity*100)} min={0} max={100}
          onChange={v => setOpacity(v/100)} color="#e09a3a" label="OPA"/>
      </div>

      {/* ═══ PANEL PINCELES + HERRAMIENTAS ═══ */}
      {showBrushes && (
        <>
          <div className="tb-overlay" onClick={() => setShowBrushes(false)}/>
          <div className="tb-panel tb-panel-brushes" style={{ zIndex:1100 }}>
            <div className="tb-section">Pincel</div>
            <div className="tb-brushgrid">
              {BRUSHES.map(b => (
                <div key={b.type}
                  className={`tb-brushbtn${!eraser && brushType === b.type ? " active" : ""}`}
                  onClick={() => { setBrushType(b.type); setEraser(false); setShowBrushes(false); }}>
                  {BRUSH_ICONS[b.type]}
                  <span className="lbl">{b.label}</span>
                </div>
              ))}
              <div className={`tb-brushbtn${eraser ? " active" : ""}`}
                onClick={() => { setEraser(true); setShowBrushes(false); }}>
                {BRUSH_ICONS.eraser}
                <span className="lbl">Borrar</span>
              </div>
            </div>

            {/* FEATURE: estabilización de trazo (stroke smoothing). Vive
                aquí, en el panel de pinceles, porque afecta directamente
                "cómo se comporta el trazo" — junto a la elección de pincel,
                no junto a TAM/OPA en la barra izquierda (decisión del
                usuario) ni escondido en Ajustes. 0 = sin suavizado
                (comportamiento idéntico al que ya existía). */}
            <div style={{ marginTop:14, paddingTop:14, borderTop:"0.5px solid #2e2e2e" }}>
              <div style={{
                display:"flex", justifyContent:"space-between", alignItems:"baseline",
                marginBottom:6,
              }}>
                <span style={{ fontSize:10, color:"#555", textTransform:"uppercase", letterSpacing:".06em" }}>
                  Estabilización
                </span>
                <span style={{ fontSize:11, color:"#888" }}>{smoothing}%</span>
              </div>
              <input type="range" min={0} max={100} value={smoothing}
                onChange={e => setSmoothing(Number(e.target.value))}
                style={{ width:"100%", accentColor:"#7070dd" }} />
              <div style={{ fontSize:10, color:"#444", marginTop:4 }}>
                Suaviza el trazo dejando que la tinta "persiga" al puntero. 0 = desactivado.
              </div>
            </div>
          </div>
        </>
      )}

      {/* ═══ PANEL COLOR ═══ */}
      {showColor && (
        <>
          <div className="tb-overlay" onClick={() => setShowColor(false)}/>
          <div className="tb-panel tb-panel-color" style={{ zIndex:1100 }}>
            <div style={{ display:"flex", justifyContent:"center", marginBottom:10 }}>
              <input type="color" value={color} onChange={e => setColor(e.target.value)}
                style={{ width:"100%", height:120, border:"none", background:"none",
                  cursor:"pointer", padding:0, borderRadius:10, display:"block" }} />
            </div>
            <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:8 }}>
              <span style={{ color:"#555", fontSize:11 }}>HEX</span>
              <input value={hex}
                onChange={e => { setHex(e.target.value); if(/^#[0-9A-Fa-f]{6}$/.test(e.target.value)) setColor(e.target.value); }}
                style={{ flex:1, background:"#1a1a1a", border:"0.5px solid #333",
                  borderRadius:6, color:"#ccc", fontSize:13, padding:"5px 8px" }} />
            </div>
            <div style={{ display:"flex", gap:6, marginBottom:10 }}>
              {(["r","g","b"] as const).map((ch,i) => (
                <div key={ch} style={{ flex:1, display:"flex", flexDirection:"column", gap:3 }}>
                  <span style={{ color:["#f88","#8f8","#88f"][i], fontSize:10, textAlign:"center" }}>
                    {ch.toUpperCase()}
                  </span>
                  <input type="number" min={0} max={255} value={rgb[ch]}
                    onChange={e => updateRGB(ch, Number(e.target.value))}
                    style={{ width:"100%", background:"#1a1a1a",
                      border:`0.5px solid ${["#f88","#8f8","#88f"][i]}40`,
                      borderRadius:6, color:["#f88","#8f8","#88f"][i], fontSize:13,
                      padding:"5px 4px", textAlign:"center" }} />
                </div>
              ))}
            </div>
            {colorHistory.length > 0 && (
              <div style={{ borderTop:"0.5px solid #2e2e2e", paddingTop:10, marginBottom:10 }}>
                <div className="tb-section">Recientes</div>
                <div className="tb-color-hist">
                  {colorHistory.map((c, i) => (
                    <div key={i} className="tb-color-hist-swatch"
                      style={{ background: c }} onClick={() => setColor(c)} title={c} />
                  ))}
                </div>
              </div>
            )}
            <div style={{ borderTop:"0.5px solid #2e2e2e", paddingTop:10 }}>
              <div className="tb-section">Fondo</div>
              <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                <div style={{ position:"relative", width:28, height:28, borderRadius:6,
                  border:"1.5px solid #555", overflow:"hidden", flexShrink:0 }}>
                  <div style={{ position:"absolute", inset:0, background:bgColor }}/>
                  <input type="color" value={bgColor} onChange={e => setBgColor(e.target.value)}
                    style={{ position:"absolute", inset:0, opacity:0, width:"100%",
                      height:"100%", cursor:"pointer", padding:0, border:"none" }} />
                </div>
                {["#111111","#ffffff","#1a1a2e","#f5f0e8","#0d1117","#2d1b33"].map(c => (
                  <div key={c} className={`tb-bg-swatch${bgColor===c?" sel":""}`}
                    style={{ background:c }} onClick={() => setBgColor(c)} />
                ))}
              </div>
            </div>
          </div>
        </>
      )}

      {/* ═══ PANEL SALA ═══ */}
      {showRoom && (
        <>
          <div className="tb-overlay" onClick={() => setShowRoom(false)}/>
          <div className="tb-panel tb-panel-room" style={{ zIndex:1100 }}>
            <div className="tb-section">Sala</div>
            <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:10 }}>
              <span style={{ color:"#ccc", fontSize:13, fontFamily:"monospace",
                background:"#1a1a1a", padding:"5px 10px", borderRadius:8, flex:1 }}>{room}</span>
            </div>
            <div style={{ display:"flex", gap:8 }}>
              <button className="tb-small-btn" style={{ flex:1 }} onClick={createRoom}>➕ Nueva</button>
              <button className="tb-small-btn" style={{ flex:1 }} onClick={copyRoomLink}>🔗 Copiar</button>
            </div>
          </div>
        </>
      )}

      {/* ═══ PANEL TAMAÑO LIENZO ═══ */}
      {showCanvas && (
        <>
          <div className="tb-overlay" onClick={() => setShowCanvas(false)}/>
          <div className="tb-panel" style={{ zIndex:1100, top:60, right:12, width:280 }}>
            <div className="tb-section" style={{ marginBottom:10 }}>Tamaño del lienzo</div>
            {[
              { label:"iPad mini",       w:1024, h:768  },
              { label:"HD",              w:1920, h:1080 },
              { label:"4K",              w:3840, h:2160 },
              { label:"Cuadrado 2K",     w:2048, h:2048 },
              { label:"A4 vertical",     w:2480, h:3508 },
              { label:"Story 9:16",      w:1080, h:1920 },
              { label:"Banner web",      w:1500, h:500  },
              { label:"iPad",            w:2388, h:1668 },
            ].map(p => {
              const active = canvasSize?.w===p.w && canvasSize?.h===p.h;
              return (
                <div key={p.label}
                  onClick={() => { setCanvasSize({w:p.w,h:p.h}); setShowCanvas(false); }}
                  style={{ display:"flex", alignItems:"center", justifyContent:"space-between",
                    padding:"8px 10px", borderRadius:8, cursor:"pointer", marginBottom:4,
                    background: active?"#1e1e3a":"#1a1a1a",
                    border:`0.5px solid ${active?"#7070dd":"#2a2a2a"}` }}>
                  <span style={{ color:active?"#aaaaff":"#ccc", fontSize:13 }}>{p.label}</span>
                  <span style={{ color:"#555", fontSize:12 }}>{`${p.w}×${p.h}`}</span>
                </div>
              );
            })}
            <div style={{ marginTop:8, padding:"10px", background:"#1a1a1a",
              borderRadius:8, border:"0.5px solid #2a2a2a" }}>
              <div className="tb-section" style={{ marginBottom:8 }}>Personalizado</div>
              <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                <input type="number" min={1} max={8192} value={customW}
                  onChange={e => setCustomW(Number(e.target.value))}
                  style={{ flex:1, background:"#111", border:"0.5px solid #333",
                    borderRadius:6, color:"#ccc", fontSize:13, padding:"5px 8px", textAlign:"center" }}/>
                <span style={{ color:"#555" }}>×</span>
                <input type="number" min={1} max={8192} value={customH}
                  onChange={e => setCustomH(Number(e.target.value))}
                  style={{ flex:1, background:"#111", border:"0.5px solid #333",
                    borderRadius:6, color:"#ccc", fontSize:13, padding:"5px 8px", textAlign:"center" }}/>
                <button onClick={() => { setCanvasSize({w:customW,h:customH}); setShowCanvas(false); }}
                  style={{ background:"#2a2a5a", border:"0.5px solid #7070dd", borderRadius:8,
                    color:"#aaaaff", fontSize:12, padding:"5px 10px", cursor:"pointer" }}>✓</button>
              </div>
              <div style={{ color:"#444", fontSize:10, marginTop:4, textAlign:"center" }}>máx 8192×8192 px</div>
            </div>
          </div>
        </>
      )}

      {/* ═══ PANEL AJUSTES ═══ */}
      {showSettings && (
        <>
          <div className="tb-overlay" onClick={() => { setShowSettings(false); setCapturingKey(null); }}/>
          <div className="tb-panel tb-panel-settings" style={{ zIndex:1100, top:60, right:12, width:300 }}
            onKeyDown={handleCaptureKey} tabIndex={0}>
            <div className="tb-section" style={{ marginBottom:10 }}>Ajustes — Atajos de teclado</div>
            <div style={{ color:"#555", fontSize:11, marginBottom:12 }}>
              Click en un atajo para reasignarlo, luego presiona la tecla deseada.
            </div>
            {(Object.keys(shortcuts) as (keyof Shortcuts)[]).map(key => (
              <div key={key} className="tb-shortcut-row">
                <span style={{ color:"#ccc", fontSize:13 }}>{SHORTCUT_LABELS[key]}</span>
                <div className={`tb-key-badge${capturingKey===key?" capturing":""}`}
                  onClick={() => setCapturingKey(capturingKey===key ? null : key)}>
                  {capturingKey===key ? "Presiona tecla…" : fmtShortcut(shortcuts[key])}
                </div>
              </div>
            ))}
            <div style={{ marginTop:12, paddingTop:10, borderTop:"0.5px solid #1e1e1e" }}>
              <button className="tb-small-btn" style={{ width:"100%" }}
                onClick={() => {
                  setShortcuts(DEFAULT_SHORTCUTS);
                  localStorage.removeItem("drawbot-shortcuts");
                }}>
                Restaurar predeterminados
              </button>
            </div>

            {/* FEATURE: crosshair táctil — forma y tamaño configurables.
                Solo importa de verdad en dispositivos táctiles (donde no
                existe el cursor CSS "crosshair" nativo del mouse), pero
                se deja disponible siempre por si el usuario quiere
                probarlo o usarlo también con mouse. */}
            <div style={{ marginTop:16, paddingTop:14, borderTop:"0.5px solid #1e1e1e" }}>
              <div className="tb-section" style={{ marginBottom:10 }}>Crosshair táctil</div>

              <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:10 }}>
                <span style={{ color:"#ccc", fontSize:13 }}>Mostrar al dibujar</span>
                <div
                  onClick={() => setCrosshairConfig({ enabled: !crosshairConfig.enabled })}
                  style={{
                    width:38, height:20, borderRadius:10, cursor:"pointer",
                    background: crosshairConfig.enabled ? "#7070dd" : "#2a2a2a",
                    position:"relative", transition:"background .15s", flexShrink:0,
                  }}>
                  <div style={{
                    position:"absolute", top:2, left: crosshairConfig.enabled ? 20 : 2,
                    width:16, height:16, borderRadius:"50%", background:"#fff",
                    transition:"left .15s",
                  }}/>
                </div>
              </div>

              <div style={{ fontSize:10, color:"#555", textTransform:"uppercase", letterSpacing:".06em", marginBottom:6 }}>
                Forma
              </div>
              <div style={{ display:"flex", gap:6, marginBottom:14 }}>
                {([
                  { id: "circle" as const, label: "Círculo" },
                  { id: "cross"  as const, label: "Cruz"    },
                  { id: "dot"    as const, label: "Punto"   },
                ]).map(opt => (
                  <button key={opt.id}
                    onClick={() => setCrosshairConfig({ shape: opt.id })}
                    style={{
                      flex:1, padding:"6px 4px", borderRadius:8, cursor:"pointer",
                      background: crosshairConfig.shape===opt.id ? "#1e1e3a" : "#1a1a1a",
                      border:`0.5px solid ${crosshairConfig.shape===opt.id ? "#7070dd" : "#2a2a2a"}`,
                      color: crosshairConfig.shape===opt.id ? "#aaaaff" : "#888",
                      fontSize:11,
                    }}>
                    {opt.label}
                  </button>
                ))}
              </div>

              <div style={{
                fontSize:10, color:"#555", textTransform:"uppercase", letterSpacing:".06em",
                marginBottom:6, display:"flex", justifyContent:"space-between",
              }}>
                <span>Tamaño</span>
                <span style={{ color:"#888" }}>{crosshairConfig.size}px</span>
              </div>
              <input type="range" min={10} max={80} value={crosshairConfig.size}
                onChange={e => setCrosshairConfig({ size: Number(e.target.value) })}
                style={{ width:"100%", accentColor:"#7070dd" }} />
            </div>
          </div>
        </>
      )}
    </>
  );
}