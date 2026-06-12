import { useState, useEffect } from "react";
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
  savePNG: () => void;
  users: string[];
  username: string;
  setUsername: Setter<string>;
  room: string;
  createRoom: () => void;
  copyRoomLink: () => void;
};

// SVG inline para cada pincel — estilo Paint
const BRUSH_ICONS: Record<BrushType | "eraser", React.ReactNode> = {
  pen: (
    <svg viewBox="0 0 28 28" width="22" height="22">
      <path d="M6 22 L18 6 L22 10 L10 26 Z" fill="currentColor" opacity="0.85"/>
      <rect x="17.5" y="5" width="5" height="5" rx="1" transform="rotate(45 20 8)" fill="#e8854a"/>
      <line x1="6" y1="22" x2="10" y2="26" stroke="currentColor" strokeWidth="1.5"/>
    </svg>
  ),
  caligraphy1: (
    <svg viewBox="0 0 28 28" width="22" height="22">
      <path d="M5 23 L11 5 L17 5 L11 23 Z" fill="currentColor" opacity="0.85"/>
      <path d="M11 5 L17 5 L23 23 L17 23 Z" fill="currentColor" opacity="0.35"/>
    </svg>
  ),
  caligraphy2: (
    <svg viewBox="0 0 28 28" width="22" height="22">
      <path d="M5 5 L11 5 L23 23 L17 23 Z" fill="currentColor" opacity="0.35"/>
      <path d="M11 5 L17 5 L23 23 L17 23 Z" fill="currentColor" opacity="0.85"/>
    </svg>
  ),
  airbrush: (
    <svg viewBox="0 0 28 28" width="22" height="22">
      <rect x="4" y="11" width="14" height="7" rx="3.5" fill="currentColor" opacity="0.8"/>
      <rect x="16" y="13.5" width="7" height="2" rx="1" fill="currentColor" opacity="0.6"/>
      <circle cx="21" cy="8"  r="1.2" fill="currentColor" opacity="0.5"/>
      <circle cx="24" cy="11" r="1"   fill="currentColor" opacity="0.4"/>
      <circle cx="23" cy="15" r="0.9" fill="currentColor" opacity="0.35"/>
      <circle cx="24" cy="19" r="1"   fill="currentColor" opacity="0.3"/>
      <circle cx="21" cy="22" r="1.2" fill="currentColor" opacity="0.25"/>
    </svg>
  ),
  oil: (
    <svg viewBox="0 0 28 28" width="22" height="22">
      <path d="M13 4 Q16 4 17 8 L15 24 Q14 26 13 26 Q12 26 11 24 L9 8 Q10 4 13 4Z" fill="currentColor" opacity="0.8"/>
      <path d="M10 10 Q13 8 16 10 Q14 12 10 10Z" fill="white" opacity="0.25"/>
      <rect x="12" y="2" width="2" height="4" rx="1" fill="#aaa"/>
    </svg>
  ),
  crayon: (
    <svg viewBox="0 0 28 28" width="22" height="22">
      <path d="M11 4 L17 4 L19 20 L9 20 Z" fill="currentColor" opacity="0.75"/>
      <polygon points="9,20 19,20 14,26" fill="#e8854a"/>
      <line x1="10" y1="8"  x2="18" y2="8"  stroke="white" strokeWidth="0.6" opacity="0.3"/>
      <line x1="10" y1="11" x2="18" y2="12" stroke="white" strokeWidth="0.6" opacity="0.25"/>
      <line x1="10" y1="14" x2="18" y2="14" stroke="white" strokeWidth="0.6" opacity="0.2"/>
    </svg>
  ),
  marker: (
    <svg viewBox="0 0 28 28" width="22" height="22">
      <rect x="10" y="3"  width="8" height="16" rx="2" fill="currentColor" opacity="0.85"/>
      <rect x="11" y="19" width="6" height="3"  rx="1" fill="currentColor" opacity="0.6"/>
      <rect x="12" y="22" width="4" height="4"  rx="0.5" fill="#555"/>
      <rect x="11" y="5"  width="2" height="8"  rx="1" fill="white" opacity="0.2"/>
    </svg>
  ),
  pencil: (
    <svg viewBox="0 0 28 28" width="22" height="22">
      <rect x="12.5" y="3" width="4" height="17" rx="2" fill="currentColor" opacity="0.7"/>
      <polygon points="12.5,20 15.5,20 15.5,26 14,28 12.5,26" fill="#f5d5a0"/>
      <polygon points="13.5,24 15.5,24 14.5,28" fill="#2a1a0a" opacity="0.7"/>
      <rect x="13" y="3" width="1.5" height="12" rx="0.75" fill="white" opacity="0.18"/>
    </svg>
  ),
  watercolor: (
    <svg viewBox="0 0 28 28" width="22" height="22">
      <ellipse cx="14" cy="17" rx="9" ry="7" fill="currentColor" opacity="0.18"/>
      <ellipse cx="14" cy="16" rx="7" ry="5" fill="currentColor" opacity="0.22"/>
      <ellipse cx="14" cy="15" rx="5" ry="4" fill="currentColor" opacity="0.3"/>
      <path d="M13 3 Q15 8 14 14 Q13 8 11 3 Z" fill="currentColor" opacity="0.7"/>
      <rect x="13" y="1" width="2" height="3" rx="1" fill="#aaa"/>
    </svg>
  ),
  eraser: (
    <svg viewBox="0 0 28 28" width="22" height="22">
      <rect x="5" y="12" width="18" height="10" rx="2" fill="#e8e0d8" opacity="0.9"/>
      <rect x="5" y="12" width="8"  height="10" rx="2" fill="#e8854a" opacity="0.85"/>
      <line x1="5" y1="22" x2="23" y2="22" stroke="#bbb" strokeWidth="1.5"/>
    </svg>
  ),
};

const BRUSHES: { type: BrushType; label: string }[] = [
  { type: "pen",         label: "Pincel"      },
  { type: "caligraphy1", label: "Calig. /"    },
  { type: "caligraphy2", label: "Calig. \\"   },
  { type: "airbrush",    label: "Aerógrafo"   },
  { type: "oil",         label: "Óleo"        },
  { type: "crayon",      label: "Crayón"      },
  { type: "marker",      label: "Rotulador"   },
  { type: "pencil",      label: "Lápiz"       },
  { type: "watercolor",  label: "Acuarela"    },
];

export default function Toolbar({
  color, setColor, brushSize, setBrushSize,
  opacity, setOpacity, eraser, setEraser,
  brushType, setBrushType, bgColor, setBgColor,
  savePNG, users, username, setUsername, room, createRoom, copyRoomLink,
}: Props) {
  const [open, setOpen] = useState(false);
  const [hex,  setHex ] = useState(color);

  useEffect(() => setHex(color), [color]);

  const hexToRgb = (h: string) => {
    const rx = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(h);
    if (!rx) return { r: 255, g: 255, b: 255 };
    return { r: parseInt(rx[1], 16), g: parseInt(rx[2], 16), b: parseInt(rx[3], 16) };
  };
  const rgb = hexToRgb(color);
  const updateRGB = (ch: "r" | "g" | "b", val: number) => {
    const n = { ...rgb }; n[ch] = Math.max(0, Math.min(255, val));
    setColor("#" + [n.r, n.g, n.b].map((v) => v.toString(16).padStart(2, "0")).join(""));
  };

  const activeBrushLabel = eraser ? "Borrador" : (BRUSHES.find(b => b.type === brushType)?.label ?? "Pincel");

  return (
    <>
      <style>{`
        .tb-pill {
          position:fixed; top:12px; left:50%; transform:translateX(-50%);
          z-index:1000; background:#1e1e1e; border:0.5px solid #3a3a3a;
          border-radius:999px; display:flex; align-items:center; gap:6px;
          padding:8px 14px; cursor:pointer; user-select:none;
          box-shadow:0 2px 12px rgba(0,0,0,0.5); white-space:nowrap;
          -webkit-tap-highlight-color:transparent; touch-action:manipulation;
        }
        .tb-panel {
          position:fixed; top:58px; left:50%; transform:translateX(-50%);
          z-index:1000; background:#1e1e1e; border:0.5px solid #3a3a3a;
          border-radius:16px; padding:14px 16px;
          display:flex; flex-direction:column; gap:12px;
          box-shadow:0 4px 20px rgba(0,0,0,0.6);
          width:min(92vw,520px); box-sizing:border-box;
        }
        .tb-row { display:flex; align-items:center; flex-wrap:wrap; gap:8px; }
        .tb-dh  { width:100%; height:1px; background:#2e2e2e; }
        .tb-dv  { width:1px; height:22px; background:#3a3a3a; flex-shrink:0; }
        .tb-label { color:#888; font-size:12px; min-width:18px; }

        /* ── Cuadrícula de pinceles ── */
        .tb-brushgrid {
          display:grid;
          grid-template-columns: repeat(5, 1fr);
          gap:5px; width:100%;
        }
        .tb-brushbtn {
          display:flex; flex-direction:column; align-items:center; gap:3px;
          padding:7px 4px; border-radius:10px;
          border:1px solid #333; background:#252525;
          cursor:pointer; color:#bbb;
          -webkit-tap-highlight-color:transparent; touch-action:manipulation;
          transition:background .12s, border-color .12s;
          min-width:0;
        }
        .tb-brushbtn .lbl { font-size:9px; color:#666; text-align:center; line-height:1.2; }
        .tb-brushbtn.active { border-color:#7070dd; background:#2a2a5a; color:#aaaaff; }
        .tb-brushbtn.active .lbl { color:#9999ee; }
        .tb-brushbtn:hover { background:#2e2e2e; }

        .tb-icon-btn {
          width:36px; height:36px; border-radius:50%;
          border:0.5px solid #3a3a3a; background:#2a2a2a; color:#aaa;
          display:flex; align-items:center; justify-content:center;
          cursor:pointer; font-size:17px; flex-shrink:0;
          -webkit-tap-highlight-color:transparent; touch-action:manipulation;
        }
        .tb-icon-btn.active { border:1.5px solid #7070dd; background:#2a2a5a; color:#aaaaff; }
        .tb-small-btn {
          background:#2a2a2a; border:0.5px solid #3a3a3a; border-radius:8px;
          color:#aaa; font-size:13px; padding:6px 12px; cursor:pointer;
          -webkit-tap-highlight-color:transparent; touch-action:manipulation;
        }
        .tb-num {
          width:46px; background:#2a2a2a; border:0.5px solid #444;
          border-radius:6px; font-size:13px; padding:5px 4px; text-align:center;
        }
        .tb-slider { width:80px; }
        .tb-text-input {
          background:#2a2a2a; border:0.5px solid #444; border-radius:8px;
          color:#ccc; font-size:14px; padding:7px 10px; flex:1; min-width:0;
        }
        .tb-section { color:#555; font-size:10px; text-transform:uppercase;
          letter-spacing:.06em; width:100%; margin-bottom:-2px; }
        .tb-bg-swatch {
          width:28px; height:28px; border-radius:6px; border:1.5px solid #555;
          cursor:pointer; flex-shrink:0; position:relative; overflow:hidden;
        }
        .tb-bg-swatch::before {
          content:''; position:absolute; inset:0;
          background-image:
            linear-gradient(45deg,#444 25%,transparent 25%),
            linear-gradient(-45deg,#444 25%,transparent 25%),
            linear-gradient(45deg,transparent 75%,#444 75%),
            linear-gradient(-45deg,transparent 75%,#444 75%);
          background-size:8px 8px;
          background-position:0 0,0 4px,4px -4px,-4px 0;
        }
        .tb-bg-inner { position:absolute; inset:0; }
        @media(max-width:480px){
          .tb-slider{width:56px}
          .tb-num{width:38px;font-size:12px}
          .tb-small-btn{font-size:12px;padding:5px 7px}
          .tb-brushgrid{grid-template-columns:repeat(5,1fr)}
        }
      `}</style>

      {/* ── PILL ── */}
      <div className="tb-pill" onClick={() => setOpen(o => !o)}>
        <div style={{ width:16, height:16, borderRadius:"50%", background:color, border:"1.5px solid #555", flexShrink:0 }} />
        <span style={{ color:"#aaa", fontSize:14 }}>
          <span style={{ display:"inline-flex", verticalAlign:"middle", marginRight:3 }}>
            {BRUSH_ICONS[eraser ? "eraser" : brushType]}
          </span>
          {activeBrushLabel} · {brushSize}px
        </span>
        <span style={{ color:"#00ff88", fontSize:13 }}>👥 {users.length}</span>
        <span style={{ color:"#666", fontSize:13 }}>{open ? "▲" : "▼"}</span>
      </div>

      {/* ── PANEL ── */}
      {open && (
        <div className="tb-panel" onClick={e => e.stopPropagation()}>

          {/* Color de pincel */}
          <div className="tb-row">
            <input type="color" value={color} onChange={e => setColor(e.target.value)}
              style={{ width:32, height:32, border:"none", background:"none", cursor:"pointer", padding:0, flexShrink:0 }} />
            <input value={hex}
              onChange={e => { setHex(e.target.value); if(/^#[0-9A-Fa-f]{6}$/.test(e.target.value)) setColor(e.target.value); }}
              style={{ width:76, background:"#2a2a2a", border:"0.5px solid #444", borderRadius:6, color:"#ccc", fontSize:13, padding:"5px 6px" }} />
            {(["r","g","b"] as const).map((ch, i) => (
              <input key={ch} type="number" min={0} max={255} value={rgb[ch]}
                onChange={e => updateRGB(ch, Number(e.target.value))}
                className="tb-num"
                style={{ color: ["#f88","#8f8","#88f"][i] }} />
            ))}
          </div>

          {/* Tamaño + opacidad */}
          <div className="tb-row">
            <span className="tb-label">📏</span>
            <input type="range" min={1} max={100} value={brushSize}
              onChange={e => setBrushSize(Number(e.target.value))} className="tb-slider" />
            <span className="tb-label" style={{ minWidth:32 }}>{brushSize}px</span>
            <div className="tb-dv"/>
            <span className="tb-label">💧</span>
            <input type="range" min={0} max={100} value={Math.round(opacity*100)}
              onChange={e => setOpacity(Number(e.target.value)/100)} className="tb-slider" />
            <span className="tb-label" style={{ minWidth:32 }}>{Math.round(opacity*100)}%</span>
          </div>

          {/* Cuadrícula de pinceles */}
          <div className="tb-section">Pincel</div>
          <div className="tb-brushgrid">
            {BRUSHES.map(b => (
              <div key={b.type}
                className={`tb-brushbtn${!eraser && brushType === b.type ? " active" : ""}`}
                onClick={() => { setBrushType(b.type); setEraser(false); }}>
                {BRUSH_ICONS[b.type]}
                <span className="lbl">{b.label}</span>
              </div>
            ))}
            <div className={`tb-brushbtn${eraser ? " active" : ""}`}
              onClick={() => setEraser(true)}>
              {BRUSH_ICONS.eraser}
              <span className="lbl">Borrar</span>
            </div>
          </div>

          <div className="tb-dh"/>

          {/* Color de fondo */}
          <div className="tb-row">
            <span style={{ color:"#888", fontSize:13, flexShrink:0 }}>Fondo:</span>
            <div className="tb-bg-swatch">
              <div className="tb-bg-inner" style={{ background:bgColor }} />
              <input type="color" value={bgColor} onChange={e => setBgColor(e.target.value)}
                style={{ position:"absolute", inset:0, opacity:0, width:"100%", height:"100%", cursor:"pointer", padding:0, border:"none" }} />
            </div>
            <input value={bgColor}
              onChange={e => { if(/^#[0-9A-Fa-f]{6}$/.test(e.target.value)||e.target.value.length<=7) setBgColor(e.target.value); }}
              style={{ width:72, background:"#2a2a2a", border:"0.5px solid #444", borderRadius:6, color:"#ccc", fontSize:13, padding:"5px 6px" }} />
            {["#111111","#ffffff","#1a1a2e","#f5f0e8","#0d1117","#2d1b33"].map(c => (
              <div key={c} onClick={() => setBgColor(c)} style={{
                width:20, height:20, borderRadius:4, background:c, cursor:"pointer", flexShrink:0,
                border: bgColor===c ? "2px solid #7070dd" : "1px solid #555",
              }} />
            ))}
          </div>

          {/* Guardar */}
          <div className="tb-row">
            <div className="tb-icon-btn" onClick={savePNG} title="Guardar PNG">💾</div>
            <span style={{ color:"#666", fontSize:12 }}>Guardar imagen</span>
          </div>

          <div className="tb-dh"/>

          {/* Sala */}
          <div className="tb-row">
            <span style={{ color:"#888", fontSize:13 }}>Sala:</span>
            <span style={{ color:"#ccc", fontSize:13, fontFamily:"monospace" }}>{room}</span>
            <button className="tb-small-btn" onClick={createRoom}>➕ Nueva</button>
            <button className="tb-small-btn" onClick={copyRoomLink}>🔗 Copiar</button>
          </div>

          {/* Usuario + online */}
          <div className="tb-row">
            <input value={username}
              onChange={e => { setUsername(e.target.value); localStorage.setItem("drawbot-name", e.target.value); }}
              placeholder="Tu nombre" className="tb-text-input" />
            <span style={{ color:"#00ff88", fontSize:14, fontWeight:"bold", whiteSpace:"nowrap" }}>
              👥 {users.length} online
            </span>
          </div>

        </div>
      )}
    </>
  );
}