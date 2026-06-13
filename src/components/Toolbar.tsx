import { useState, useEffect, useRef } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { BrushType } from "./Canvas";

type Setter<T> = Dispatch<SetStateAction<T>> | ((v: T) => void);

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
  savePNG: () => void;
  users: string[];
  username: string;
  setUsername: Setter<string>;
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

// Slider vertical reutilizable
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
        {/* Track bg */}
        <div style={{ position:"absolute", left:"50%", top:0, bottom:0, width:6,
          transform:"translateX(-50%)", borderRadius:3, background:"#222" }}/>
        {/* Fill */}
        <div style={{ position:"absolute", left:"50%", bottom:0, width:6,
          transform:"translateX(-50%)", borderRadius:3,
          height:`${pct}%`, background:color }}/>
        {/* Thumb */}
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

export default function Toolbar({
  color, setColor, brushSize, setBrushSize,
  opacity, setOpacity, eraser, setEraser,
  brushType, setBrushType, bgColor, setBgColor,
  panMode, setPanMode,
  savePNG, users, username, setUsername, room, createRoom, copyRoomLink,
}: Props) {
  const [showBrushes,  setShowBrushes ] = useState(false);
  const [showColor,    setShowColor   ] = useState(false);
  const [showUsers,    setShowUsers   ] = useState(false);
  const [showRoom,     setShowRoom    ] = useState(false);
  const [editingNick,  setEditingNick ] = useState(false);
  const [nickDraft,    setNickDraft   ] = useState(username);
  const [hex,          setHex         ] = useState(color);
  const nickRef = useRef<HTMLInputElement>(null);

  useEffect(() => setHex(color), [color]);
  useEffect(() => { if (editingNick) nickRef.current?.focus(); }, [editingNick]);

  const saveNick = () => {
    const t = nickDraft.trim() || "Invitado";
    setNickDraft(t); setUsername(t);
    localStorage.setItem("drawbot-name", t);
    setEditingNick(false);
    window.location.reload();
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

  return (
    <>
      <style>{`
        /* ── Reset inputs ── */
        .tb * { box-sizing: border-box; }
        input[type=number]::-webkit-inner-spin-button { opacity:1; }

        /* ── Barra superior ── */
        .tb-top {
          position: fixed; top: 0; left: 0; right: 0;
          height: 52px; z-index: 1000;
          background: rgba(18,18,18,0.92);
          backdrop-filter: blur(12px);
          border-bottom: 0.5px solid #2a2a2a;
          display: flex; align-items: center;
          padding: 0 12px; gap: 8px;
        }

        /* ── Barra izquierda (sliders) ── */
        .tb-left {
          position: fixed; left: 0; top: 52px; bottom: 0;
          width: 52px; z-index: 999;
          background: rgba(18,18,18,0.88);
          backdrop-filter: blur(12px);
          border-right: 0.5px solid #2a2a2a;
          display: flex; flex-direction: column;
          align-items: center; justify-content: center;
          gap: 24px; padding: 16px 0;
        }

        /* ── Botones de toolbar ── */
        .tb-btn {
          width: 36px; height: 36px; border-radius: 10px;
          border: 0.5px solid #333; background: #1e1e1e;
          color: #aaa; display: flex; align-items: center;
          justify-content: center; cursor: pointer; flex-shrink: 0;
          font-size: 16px; transition: background .12s, border-color .12s;
          -webkit-tap-highlight-color: transparent;
          touch-action: manipulation;
        }
        .tb-btn:hover { background: #2a2a2a; border-color: #555; }
        .tb-btn.active { background: #2a2a5a; border-color: #7070dd; color: #aaaaff; }
        .tb-btn.eraser-active { background: #3a2a2a; border-color: #dd7070; color: #ffaaaa; }

        /* ── Color swatch ── */
        .tb-color-btn {
          width: 32px; height: 32px; border-radius: 50%;
          border: 2px solid #555; cursor: pointer; flex-shrink: 0;
          transition: transform .12s, border-color .12s;
          -webkit-tap-highlight-color: transparent;
        }
        .tb-color-btn:hover { transform: scale(1.1); border-color: #aaa; }

        /* ── Separador ── */
        .tb-sep {
          width: 1px; height: 28px; background: #2e2e2e; flex-shrink: 0;
        }
        .tb-sep-h {
          height: 1px; width: 28px; background: #2e2e2e; flex-shrink: 0;
        }

        /* ── Paneles flotantes ── */
        .tb-panel {
          position: fixed; z-index: 1100;
          background: rgba(22,22,22,0.97);
          border: 0.5px solid #333; border-radius: 14px;
          box-shadow: 0 8px 32px rgba(0,0,0,0.7);
          padding: 14px;
        }

        /* Panel pinceles — aparece bajo la barra */
        .tb-panel-brushes {
          top: 60px; left: 50%; transform: translateX(-50%);
          width: min(92vw, 380px);
        }

        /* Panel color — aparece bajo el swatch */
        .tb-panel-color {
          top: 60px; left: 60px;
          width: 300px;
        }

        /* Panel usuarios */
        .tb-panel-users {
          top: 60px; right: 12px;
          width: 220px;
        }

        /* Panel sala */
        .tb-panel-room {
          top: 60px; right: 12px;
          width: 260px;
        }

        /* ── Grid de pinceles ── */
        .tb-brushgrid {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 6px;
        }
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

        /* ── Slider label ── */
        .tb-slider-label {
          font-size: 10px; color: #555; text-align: center;
          writing-mode: horizontal-tb;
        }
        .tb-slider-val {
          font-size: 11px; color: #888; text-align: center; min-width: 32px;
        }

        /* ── Color panel inputs ── */
        .tb-num {
          width: 52px; background: #1a1a1a; border: 0.5px solid #333;
          border-radius: 6px; color: #ccc; font-size: 12px;
          padding: 4px; text-align: center;
        }
        .tb-hex {
          width: 88px; background: #1a1a1a; border: 0.5px solid #333;
          border-radius: 6px; color: #ccc; font-size: 12px;
          padding: 4px 6px;
        }

        /* ── Usuario ── */
        .tb-user-item {
          display: flex; align-items: center; gap: 8px;
          padding: 6px 8px; border-radius: 8px;
        }
        .tb-user-item:hover { background: #1e1e1e; }
        .tb-you { font-size: 10px; color: #7070dd; background: #1e1e3a;
          border-radius: 4px; padding: 1px 5px; }

        /* ── Nick edit ── */
        .tb-nick-input {
          background: #1a1a1a; border: 0.5px solid #444; border-radius: 8px;
          color: #ccc; font-size: 13px; padding: 6px 8px; flex: 1;
          outline: none;
        }
        .tb-nick-input:focus { border-color: #7070dd; }

        /* ── Small btn ── */
        .tb-small-btn {
          background: #1e1e1e; border: 0.5px solid #333; border-radius: 8px;
          color: #aaa; font-size: 12px; padding: 5px 10px; cursor: pointer;
          -webkit-tap-highlight-color: transparent;
        }
        .tb-small-btn:hover { background: #2a2a2a; }
        .tb-confirm-btn {
          background: #1e3a1e; border-color: #3a7a3a; color: #8f8;
        }

        /* ── Fondo swatches ── */
        .tb-bg-swatch {
          width: 22px; height: 22px; border-radius: 5px; cursor: pointer;
          border: 1.5px solid #444; flex-shrink: 0;
          transition: transform .1s;
        }
        .tb-bg-swatch:hover { transform: scale(1.15); }
        .tb-bg-swatch.sel { border-color: #7070dd; }

        /* ── Overlay para cerrar paneles ── */
        .tb-overlay {
          position: fixed; inset: 0; z-index: 1050;
        }

        /* ── Label de sección ── */
        .tb-section {
          font-size: 10px; color: #555; text-transform: uppercase;
          letter-spacing: .06em; margin-bottom: 8px;
        }

        /* ── Avatar stack ── */
        .tb-avatar-stack { display: flex; }
        .tb-avatar-stack > * { margin-left: -5px; }
        .tb-avatar-stack > *:first-child { margin-left: 0; }

        @media (max-width: 480px) {
          .tb-panel-brushes { left: 52px; transform: none; width: calc(100vw - 64px); }
          .tb-panel-color { left: 52px; width: calc(100vw - 64px); }
        }
      `}</style>

      {/* ═══════════════════════════════════════════════
          BARRA SUPERIOR
      ═══════════════════════════════════════════════ */}
      <div className="tb-top">

        {/* Avatar + nick */}
        <div style={{ display:"flex", alignItems:"center", gap:6, cursor:"pointer" }}
          onClick={() => { setShowUsers(u=>!u); setShowBrushes(false); setShowColor(false); setShowRoom(false); }}>
          <UserAvatar name={username} size={30} />
        </div>

        <div className="tb-sep"/>

        {/* Color del pincel */}
        <div className="tb-color-btn"
          style={{ background: color }}
          onClick={() => { setShowColor(c=>!c); setShowBrushes(false); setShowUsers(false); setShowRoom(false); }}
        />

        {/* Selector de pincel activo */}
        <div className={`tb-btn${showBrushes ? " active" : ""}`}
          onClick={() => { setShowBrushes(b=>!b); setShowColor(false); setShowUsers(false); setShowRoom(false); }}
          title="Pinceles">
          {eraser ? BRUSH_ICONS.eraser : BRUSH_ICONS[brushType]}
        </div>

        {/* Nombre del pincel activo */}
        <span style={{ color:"#666", fontSize:12, flexShrink:0 }}>
          {eraser ? "Borrador" : (activeBrush?.label ?? "Pincel")}
        </span>

        <div className="tb-sep"/>

        {/* Herramienta mano */}
        <div className={`tb-btn${panMode ? " active" : ""}`}
          onClick={() => { setPanMode(!panMode); if (!panMode) setEraser(false); }}
          title="Mover lienzo" style={{ fontSize:16 }}>
          ✋
        </div>

        {/* Borrador */}
        <div className={`tb-btn${eraser && !panMode ? " eraser-active" : ""}`}
          onClick={() => { setEraser(!eraser); setPanMode(false); }} title="Borrador">
          {BRUSH_ICONS.eraser}
        </div>

        {/* Spacer */}
        <div style={{ flex:1 }}/>

        {/* Usuarios */}
        <div className="tb-avatar-stack" style={{ cursor:"pointer" }}
          onClick={() => { setShowUsers(u=>!u); setShowBrushes(false); setShowColor(false); setShowRoom(false); }}>
          {users.slice(0,3).map((u,i) => <UserAvatar key={i} name={u} size={26}/>)}
        </div>
        <span style={{ color:"#00ff88", fontSize:12, marginLeft:4 }}>{users.length}</span>

        <div className="tb-sep"/>

        {/* Sala */}
        <div className={`tb-btn${showRoom ? " active" : ""}`}
          onClick={() => { setShowRoom(r=>!r); setShowBrushes(false); setShowColor(false); setShowUsers(false); }}
          title="Sala" style={{ fontSize:14 }}>
          🔗
        </div>

        {/* Guardar */}
        <div className="tb-btn" onClick={savePNG} title="Guardar PNG" style={{ fontSize:14 }}>
          💾
        </div>

      </div>

      {/* ═══════════════════════════════════════════════
          BARRA IZQUIERDA — tamaño y opacidad
      ═══════════════════════════════════════════════ */}
      <div className="tb-left">

        <VSlider value={brushSize} min={1} max={200}
          onChange={v => setBrushSize(v)} color="#7070dd" label="TAM"/>
        <div className="tb-sep-h"/>
        <VSlider value={Math.round(opacity*100)} min={0} max={100}
          onChange={v => setOpacity(v/100)} color="#e09a3a" label="OPA"/>

      </div>

      {/* ═══════════════════════════════════════════════
          PANEL PINCELES
      ═══════════════════════════════════════════════ */}
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
          </div>
        </>
      )}

      {/* ═══════════════════════════════════════════════
          PANEL COLOR
      ═══════════════════════════════════════════════ */}
      {showColor && (
        <>
          <div className="tb-overlay" onClick={() => setShowColor(false)}/>
          <div className="tb-panel tb-panel-color" style={{ zIndex:1100 }}>

            {/* Color picker nativo grande */}
            <div style={{ display:"flex", justifyContent:"center", marginBottom:10 }}>
              <input type="color" value={color} onChange={e => setColor(e.target.value)}
                style={{ width:80, height:80, border:"none", background:"none",
                  cursor:"pointer", padding:0, borderRadius:10 }} />
            </div>

            {/* Hex */}
            <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:8 }}>
              <span style={{ color:"#555", fontSize:11 }}>HEX</span>
              <input value={hex}
                onChange={e => { setHex(e.target.value); if(/^#[0-9A-Fa-f]{6}$/.test(e.target.value)) setColor(e.target.value); }}
                style={{ flex:1, background:"#1a1a1a", border:"0.5px solid #333",
                  borderRadius:6, color:"#ccc", fontSize:13, padding:"5px 8px" }} />
            </div>
            {/* RGB */}
            <div style={{ display:"flex", gap:6, marginBottom:10 }}>
              {(["r","g","b"] as const).map((ch,i) => (
                <div key={ch} style={{ flex:1, display:"flex", flexDirection:"column", gap:3 }}>
                  <span style={{ color:["#f88","#8f8","#88f"][i], fontSize:10, textAlign:"center" }}>
                    {ch.toUpperCase()}
                  </span>
                  <input type="number" min={0} max={255} value={rgb[ch]}
                    onChange={e => updateRGB(ch, Number(e.target.value))}
                    style={{ width:"100%", background:"#1a1a1a", border:`0.5px solid ${["#f88","#8f8","#88f"][i]}40`,
                      borderRadius:6, color:["#f88","#8f8","#88f"][i], fontSize:13,
                      padding:"5px 4px", textAlign:"center" }} />
                </div>
              ))}
            </div>

            {/* Color de fondo */}
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

      {/* ═══════════════════════════════════════════════
          PANEL USUARIOS
      ═══════════════════════════════════════════════ */}
      {showUsers && (
        <>
          <div className="tb-overlay" onClick={() => setShowUsers(false)}/>
          <div className="tb-panel tb-panel-users" style={{ zIndex:1100 }}>

            <div className="tb-section">Tu perfil</div>
            {editingNick ? (
              <div style={{ display:"flex", gap:6, marginBottom:12 }}>
                <input ref={nickRef} value={nickDraft}
                  onChange={e => setNickDraft(e.target.value)}
                  onKeyDown={e => { if(e.key==="Enter") saveNick(); if(e.key==="Escape") setEditingNick(false); }}
                  maxLength={24} placeholder="Tu nombre" className="tb-nick-input" />
                <button className="tb-small-btn tb-confirm-btn" onClick={saveNick}>✓</button>
                <button className="tb-small-btn" onClick={() => setEditingNick(false)}>✕</button>
              </div>
            ) : (
              <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:12,
                cursor:"pointer", padding:"6px 8px", borderRadius:8, background:"#1a1a1a" }}
                onClick={() => { setNickDraft(username); setEditingNick(true); }}>
                <UserAvatar name={username} size={28}/>
                <span style={{ color:"#ccc", fontSize:13, flex:1 }}>{username}</span>
                <span style={{ color:"#555", fontSize:11 }}>✏️</span>
              </div>
            )}

            <div style={{ borderTop:"0.5px solid #2e2e2e", paddingTop:10 }}>
              <div className="tb-section">En sala ({users.length})</div>
              {users.map((u,i) => (
                <div key={i} className="tb-user-item">
                  <UserAvatar name={u} size={26}/>
                  <span style={{ color:"#ccc", fontSize:13, flex:1 }}>{u}</span>
                  {u===username && <span className="tb-you">tú</span>}
                </div>
              ))}
            </div>

          </div>
        </>
      )}

      {/* ═══════════════════════════════════════════════
          PANEL SALA
      ═══════════════════════════════════════════════ */}
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
              <button className="tb-small-btn" style={{ flex:1 }} onClick={createRoom}>➕ Nueva sala</button>
              <button className="tb-small-btn" style={{ flex:1 }} onClick={copyRoomLink}>🔗 Copiar link</button>
            </div>
          </div>
        </>
      )}

    </>
  );
}