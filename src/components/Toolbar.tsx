import { useState, useEffect } from "react";
import type { Dispatch, SetStateAction } from "react";

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
  savePNG: () => void;
  users: string[];
  username: string;
  setUsername: Setter<string>;
  room: string;
  createRoom: () => void;
  copyRoomLink: () => void;
};

export default function Toolbar({
  color, setColor, brushSize, setBrushSize,
  opacity, setOpacity, eraser, setEraser, savePNG,
  users, username, setUsername, room, createRoom, copyRoomLink,
}: Props) {
  const [open, setOpen] = useState(false);
  const [hex, setHex] = useState(color);

  useEffect(() => setHex(color), [color]);

  const hexToRgb = (h: string) => {
    const r = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(h);
    if (!r) return { r: 255, g: 255, b: 255 };
    return { r: parseInt(r[1], 16), g: parseInt(r[2], 16), b: parseInt(r[3], 16) };
  };

  const rgb = hexToRgb(color);

  const updateRGB = (channel: "r" | "g" | "b", value: number) => {
    const next = { ...rgb };
    next[channel] = Math.max(0, Math.min(255, value));
    setColor("#" + [next.r, next.g, next.b].map((v) => v.toString(16).padStart(2, "0")).join(""));
  };

  return (
    <>
      <style>{`
        .tb-pill {
          position: fixed;
          top: 12px;
          left: 50%;
          transform: translateX(-50%);
          z-index: 1000;
          background: #1e1e1e;
          border: 0.5px solid #3a3a3a;
          border-radius: 999px;
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 8px 14px;
          cursor: pointer;
          user-select: none;
          box-shadow: 0 2px 12px rgba(0,0,0,0.5);
          white-space: nowrap;
          -webkit-tap-highlight-color: transparent;
          touch-action: manipulation;
        }
        .tb-panel {
          position: fixed;
          top: 58px;
          left: 50%;
          transform: translateX(-50%);
          z-index: 1000;
          background: #1e1e1e;
          border: 0.5px solid #3a3a3a;
          border-radius: 16px;
          padding: 14px 16px;
          display: flex;
          flex-direction: column;
          gap: 12px;
          box-shadow: 0 4px 20px rgba(0,0,0,0.6);
          width: min(92vw, 480px);
          box-sizing: border-box;
        }
        .tb-row {
          display: flex;
          align-items: center;
          flex-wrap: wrap;
          gap: 8px;
        }
        .tb-divider-h {
          width: 100%;
          height: 1px;
          background: #2e2e2e;
        }
        .tb-divider-v {
          width: 1px;
          height: 22px;
          background: #3a3a3a;
          flex-shrink: 0;
        }
        .tb-icon-btn {
          width: 36px;
          height: 36px;
          border-radius: 50%;
          border: 0.5px solid #3a3a3a;
          background: #2a2a2a;
          color: #aaa;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          font-size: 17px;
          flex-shrink: 0;
          -webkit-tap-highlight-color: transparent;
          touch-action: manipulation;
        }
        .tb-icon-btn.active {
          border: 1.5px solid #7070dd;
          background: #2a2a5a;
          color: #aaaaff;
        }
        .tb-small-btn {
          background: #2a2a2a;
          border: 0.5px solid #3a3a3a;
          border-radius: 8px;
          color: #aaa;
          font-size: 13px;
          padding: 6px 12px;
          cursor: pointer;
          -webkit-tap-highlight-color: transparent;
          touch-action: manipulation;
        }
        .tb-label { color: #888; font-size: 12px; min-width: 18px; }
        .tb-slider { width: 80px; }
        .tb-num {
          width: 46px;
          background: #2a2a2a;
          border: 0.5px solid #444;
          border-radius: 6px;
          font-size: 13px;
          padding: 5px 4px;
          text-align: center;
        }
        .tb-text-input {
          background: #2a2a2a;
          border: 0.5px solid #444;
          border-radius: 8px;
          color: #ccc;
          font-size: 14px;
          padding: 7px 10px;
          flex: 1;
          min-width: 0;
        }
        @media (max-width: 480px) {
          .tb-slider { width: 60px; }
          .tb-num { width: 40px; font-size: 12px; }
          .tb-small-btn { font-size: 12px; padding: 6px 8px; }
        }
      `}</style>

      {/* Pill */}
      <div className="tb-pill" onClick={() => setOpen((o) => !o)}>
        <div style={{
          width: 16, height: 16, borderRadius: "50%",
          background: color, border: "1.5px solid #555", flexShrink: 0,
        }} />
        <span style={{ color: "#aaa", fontSize: 14 }}>
          {eraser ? "🧽" : "✏️"} {brushSize}px
        </span>
        <span style={{ color: "#00ff88", fontSize: 13 }}>👥 {users.length}</span>
        <span style={{ color: "#666", fontSize: 13 }}>{open ? "▲" : "▼"}</span>
      </div>

      {/* Panel */}
      {open && (
        <div className="tb-panel" onClick={(e) => e.stopPropagation()}>

          {/* Color */}
          <div className="tb-row">
            <input
              type="color" value={color}
              onChange={(e) => setColor(e.target.value)}
              style={{ width: 32, height: 32, border: "none", background: "none", cursor: "pointer", padding: 0, flexShrink: 0 }}
            />
            <input
              value={hex}
              onChange={(e) => {
                setHex(e.target.value);
                if (/^#[0-9A-Fa-f]{6}$/.test(e.target.value)) setColor(e.target.value);
              }}
              style={{ width: 76, background: "#2a2a2a", border: "0.5px solid #444", borderRadius: 6, color: "#ccc", fontSize: 13, padding: "5px 6px" }}
            />
            <input type="number" min={0} max={255} value={rgb.r}
              onChange={(e) => updateRGB("r", Number(e.target.value))}
              className="tb-num" style={{ color: "#f88" }} />
            <input type="number" min={0} max={255} value={rgb.g}
              onChange={(e) => updateRGB("g", Number(e.target.value))}
              className="tb-num" style={{ color: "#8f8" }} />
            <input type="number" min={0} max={255} value={rgb.b}
              onChange={(e) => updateRGB("b", Number(e.target.value))}
              className="tb-num" style={{ color: "#88f" }} />
          </div>

          {/* Tamaño + opacidad + herramientas */}
          <div className="tb-row">
            <span className="tb-label">📏</span>
            <input type="range" min={1} max={100} value={brushSize}
              onChange={(e) => setBrushSize(Number(e.target.value))}
              className="tb-slider" />
            <span className="tb-label" style={{ minWidth: 32 }}>{brushSize}px</span>

            <div className="tb-divider-v" />

            <span className="tb-label">🌫</span>
            <input type="range" min={0} max={100} value={Math.round(opacity * 100)}
              onChange={(e) => setOpacity(Number(e.target.value) / 100)}
              className="tb-slider" />
            <span className="tb-label" style={{ minWidth: 32 }}>{Math.round(opacity * 100)}%</span>

            <div className="tb-divider-v" />

            <div className={`tb-icon-btn${!eraser ? " active" : ""}`}
              onClick={() => setEraser(false)}>✏️</div>
            <div className={`tb-icon-btn${eraser ? " active" : ""}`}
              onClick={() => setEraser(true)}>🧽</div>
            <div className="tb-icon-btn" onClick={savePNG}>💾</div>
          </div>

          <div className="tb-divider-h" />

          {/* Sala */}
          <div className="tb-row">
            <span style={{ color: "#888", fontSize: 13 }}>Sala:</span>
            <span style={{ color: "#ccc", fontSize: 13, fontFamily: "monospace" }}>{room}</span>
            <button className="tb-small-btn" onClick={createRoom}>➕ Nueva</button>
            <button className="tb-small-btn" onClick={copyRoomLink}>🔗 Copiar</button>
          </div>

          {/* Usuario + online */}
          <div className="tb-row">
            <input
              value={username}
              onChange={(e) => {
                setUsername(e.target.value);
                localStorage.setItem("drawbot-name", e.target.value);
              }}
              placeholder="Tu nombre"
              className="tb-text-input"
            />
            <span style={{ color: "#00ff88", fontSize: 14, fontWeight: "bold", whiteSpace: "nowrap" }}>
              👥 {users.length} online
            </span>
          </div>

        </div>
      )}
    </>
  );
}