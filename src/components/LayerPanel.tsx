import { useState, useRef } from "react";
import type { Layer } from "./Canvas";

type Props = {
  layers:        Layer[];
  activeLayerId: number;
  onSelect:      (id: number) => void;
  onAdd:         () => void;
  onDelete:      (id: number) => void;
  onToggleVisibility: (id: number) => void;
  onToggleLock:  (id: number) => void;
  onRename:      (id: number, name: string) => void;
  onReorder:     (fromIdx: number, toIdx: number) => void;
  onOpacity:     (id: number, opacity: number) => void;
};

export default function LayerPanel({
  layers, activeLayerId,
  onSelect, onAdd, onDelete,
  onToggleVisibility, onToggleLock,
  onRename, onReorder, onOpacity,
}: Props) {
  const [editingId,   setEditingId  ] = useState<number | null>(null);
  const [nameDraft,   setNameDraft  ] = useState("");
  const [dragIdx,     setDragIdx    ] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  const startRename = (layer: Layer) => {
    setEditingId(layer.id);
    setNameDraft(layer.name);
    setTimeout(() => nameRef.current?.focus(), 30);
  };

  const commitRename = (id: number) => {
    const t = nameDraft.trim();
    if (t) onRename(id, t);
    setEditingId(null);
  };

  // Capas mostradas de arriba (última) a abajo (primera) — como Photoshop
  const reversed = [...layers].reverse();

  return (
    <>
      <style>{`
        .lp-wrap {
          position: fixed;
          right: 0; top: 52px; bottom: 0;
          width: 200px;
          background: rgba(16,16,16,0.97);
          border-left: 0.5px solid #282828;
          display: flex; flex-direction: column;
          z-index: 900;
          user-select: none;
        }
        .lp-header {
          display: flex; align-items: center; justify-content: space-between;
          padding: 10px 12px 8px;
          border-bottom: 0.5px solid #222;
          flex-shrink: 0;
        }
        .lp-title {
          font-size: 10px; color: #555;
          text-transform: uppercase; letter-spacing: .07em;
        }
        .lp-add-btn {
          width: 24px; height: 24px; border-radius: 7px;
          background: #1e1e1e; border: 0.5px solid #333;
          color: #888; font-size: 16px; line-height: 1;
          display: flex; align-items: center; justify-content: center;
          cursor: pointer; transition: background .12s, border-color .12s;
          flex-shrink: 0;
        }
        .lp-add-btn:hover { background: #2a2a5a; border-color: #7070dd; color: #aaaaff; }
        .lp-list {
          flex: 1; overflow-y: auto; padding: 6px 0;
        }
        .lp-list::-webkit-scrollbar { width: 4px; }
        .lp-list::-webkit-scrollbar-thumb { background: #2a2a2a; border-radius: 2px; }
        .lp-item {
          display: flex; align-items: center; gap: 6px;
          padding: 6px 10px;
          cursor: pointer;
          transition: background .1s;
          border-left: 2.5px solid transparent;
          position: relative;
        }
        .lp-item:hover { background: #1c1c1c; }
        .lp-item.active {
          background: #1a1a30;
          border-left-color: #7070dd;
        }
        .lp-item.drag-over { background: #222240; }
        .lp-thumb {
          width: 32px; height: 32px; border-radius: 5px;
          background: #222; border: 0.5px solid #333;
          flex-shrink: 0; overflow: hidden;
          display: flex; align-items: center; justify-content: center;
          font-size: 9px; color: #444;
        }
        .lp-info { flex: 1; min-width: 0; }
        .lp-name {
          font-size: 12px; color: #ccc;
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }
        .lp-name.hidden { color: #444; }
        .lp-name.locked { color: #888; }
        .lp-name-input {
          width: 100%; background: #111; border: 0.5px solid #7070dd;
          border-radius: 5px; color: #ccc; font-size: 12px;
          padding: 2px 5px; outline: none;
        }
        .lp-ops {
          display: flex; gap: 2px; align-items: center; flex-shrink: 0;
        }
        .lp-icon-btn {
          width: 20px; height: 20px; border-radius: 5px;
          background: transparent; border: none;
          color: #555; font-size: 12px; cursor: pointer;
          display: flex; align-items: center; justify-content: center;
          transition: color .1s, background .1s;
          padding: 0;
        }
        .lp-icon-btn:hover { color: #ccc; background: #2a2a2a; }
        .lp-icon-btn.active { color: #7070dd; }
        .lp-del-btn:hover { color: #ff6b6b !important; background: #2a1a1a !important; }
        .lp-opacity-row {
          padding: 6px 10px 4px;
          border-top: 0.5px solid #1e1e1e;
          flex-shrink: 0;
        }
        .lp-opacity-label {
          font-size: 9px; color: #444; text-transform: uppercase;
          letter-spacing: .06em; margin-bottom: 4px;
          display: flex; justify-content: space-between;
        }
        .lp-opacity-slider {
          -webkit-appearance: none;
          width: 100%; height: 4px; border-radius: 2px;
          background: #222; outline: none; cursor: pointer;
        }
        .lp-opacity-slider::-webkit-slider-thumb {
          -webkit-appearance: none;
          width: 12px; height: 12px; border-radius: 50%;
          background: #7070dd; border: 1.5px solid #aaaaff;
          cursor: pointer;
        }
        .lp-drag-handle {
          font-size: 11px; color: #333; cursor: grab;
          flex-shrink: 0; padding: 0 2px;
          line-height: 1;
        }
        .lp-drag-handle:hover { color: #555; }
        .lp-drag-handle:active { cursor: grabbing; }
      `}</style>

      <div className="lp-wrap">
        <div className="lp-header">
          <span className="lp-title">Capas</span>
          <button className="lp-add-btn" onClick={onAdd} title="Nueva capa">+</button>
        </div>

        <div className="lp-list">
          {reversed.map((layer, rIdx) => {
            const origIdx = layers.length - 1 - rIdx;
            const isActive = layer.id === activeLayerId;
            return (
              <div
                key={layer.id}
                className={`lp-item${isActive?" active":""}${dragOverIdx===origIdx?" drag-over":""}`}
                onClick={() => onSelect(layer.id)}
                draggable
                onDragStart={() => setDragIdx(origIdx)}
                onDragOver={e => { e.preventDefault(); setDragOverIdx(origIdx); }}
                onDragLeave={() => setDragOverIdx(null)}
                onDrop={() => {
                  if (dragIdx !== null && dragIdx !== origIdx) onReorder(dragIdx, origIdx);
                  setDragIdx(null); setDragOverIdx(null);
                }}
                onDragEnd={() => { setDragIdx(null); setDragOverIdx(null); }}
              >
                {/* Drag handle */}
                <span className="lp-drag-handle" title="Arrastrar">⠿</span>

                {/* Thumbnail placeholder */}
                <div className="lp-thumb">
                  <span>{layer.id}</span>
                </div>

                {/* Name */}
                <div className="lp-info">
                  {editingId === layer.id ? (
                    <input
                      ref={nameRef}
                      className="lp-name-input"
                      value={nameDraft}
                      onChange={e => setNameDraft(e.target.value)}
                      onBlur={() => commitRename(layer.id)}
                      onKeyDown={e => {
                        if (e.key==="Enter") commitRename(layer.id);
                        if (e.key==="Escape") setEditingId(null);
                        e.stopPropagation();
                      }}
                      onClick={e => e.stopPropagation()}
                    />
                  ) : (
                    <div
                      className={`lp-name${!layer.visible?" hidden":""}${layer.locked?" locked":""}`}
                      onDoubleClick={e => { e.stopPropagation(); startRename(layer); }}
                      title="Doble clic para renombrar"
                    >
                      {layer.name}
                    </div>
                  )}
                </div>

                {/* Actions */}
                <div className="lp-ops" onClick={e => e.stopPropagation()}>
                  <button
                    className={`lp-icon-btn${layer.visible?" active":""}`}
                    title={layer.visible ? "Ocultar" : "Mostrar"}
                    onClick={() => onToggleVisibility(layer.id)}
                  >
                    {layer.visible ? "👁" : "🚫"}
                  </button>
                  <button
                    className={`lp-icon-btn${layer.locked?" active":""}`}
                    title={layer.locked ? "Desbloquear" : "Bloquear"}
                    onClick={() => onToggleLock(layer.id)}
                  >
                    {layer.locked ? "🔒" : "🔓"}
                  </button>
                  {layers.length > 1 && (
                    <button
                      className="lp-icon-btn lp-del-btn"
                      title="Eliminar capa"
                      onClick={() => onDelete(layer.id)}
                    >
                      ✕
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Opacidad de capa activa */}
        {(() => {
          const al = layers.find(l => l.id === activeLayerId);
          if (!al) return null;
          return (
            <div className="lp-opacity-row">
              <div className="lp-opacity-label">
                <span>Opacidad de capa</span>
                <span style={{color:"#666"}}>{Math.round(al.opacity * 100)}%</span>
              </div>
              <input
                type="range"
                className="lp-opacity-slider"
                min={0} max={100}
                value={Math.round(al.opacity * 100)}
                onChange={e => onOpacity(al.id, Number(e.target.value) / 100)}
              />
            </div>
          );
        })()}
      </div>
    </>
  );
}