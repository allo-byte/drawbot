import { useState } from "react";
import type { Layer } from "./Canvas";

const BLEND_MODES: { id: string; label: string }[] = [
  {id:"normal",       label:"Normal"},
  {id:"multiply",     label:"Multiplicar"},
  {id:"screen",       label:"Pantalla"},
  {id:"overlay",      label:"Superposición"},
  {id:"darken",       label:"Oscurecer"},
  {id:"lighten",      label:"Aclarar"},
  {id:"color-dodge",  label:"Subexp. color"},
  {id:"color-burn",   label:"Sobrexp. color"},
  {id:"hard-light",   label:"Luz fuerte"},
  {id:"soft-light",   label:"Luz suave"},
  {id:"difference",   label:"Diferencia"},
  {id:"exclusion",    label:"Exclusión"},
  {id:"hue",          label:"Tono"},
  {id:"color",        label:"Color"},
  {id:"add",          label:"Añadir"},
  {id:"subtract",     label:"Restar"},
  {id:"divide",       label:"Dividir"},
  {id:"lighter-color",label:"Color más claro"},
];

type Props = {
  layers:        Layer[];
  activeLayerId: number;
  myUserId:      string;
  layerLimit:    number;
  onSelect:      (id: number) => void;
  onAdd:         () => void;
  onDelete:      (id: number) => void;
  onToggleVisibility: (id: number) => void;
  onToggleLock:  (id: number) => void;
  onRename:      (id: number, name: string) => void;
  onReorder:     (fromIdx: number, toIdx: number) => void;
  onOpacity:     (id: number, opacity: number) => void;
  onMerge:       (topLayerId: number) => void;
  onBlendMode:   (id: number, mode: string) => void;
};

function userColor(name: string) {
  const colors = ["#e05d5d","#e09a3a","#d4c94a","#5dbe6e","#4ab8d4","#7070dd","#c46edd","#dd6eaa"];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length];
}

function Avatar({ name, size = 18 }: { name: string; size?: number }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: "50%",
      background: userColor(name), color: "#fff",
      display: "flex", alignItems: "center", justifyContent: "center",
      fontSize: size * 0.42, fontWeight: "bold", flexShrink: 0,
    }}>{name.trim().slice(0,2).toUpperCase()||"?"}</div>
  );
}

export default function LayerPanel({
  layers, activeLayerId, myUserId, layerLimit,
  onSelect, onAdd, onDelete,
  onToggleVisibility, onToggleLock,
  onRename, onReorder, onOpacity, onMerge, onBlendMode,
}: Props) {
  const [editingId,    setEditingId   ] = useState<number|null>(null);
  const [nameDraft,    setNameDraft   ] = useState("");
  const [dragIdx,      setDragIdx     ] = useState<number|null>(null);
  const [dragOverIdx,  setDragOverIdx ] = useState<number|null>(null);
  // Visibilidad LOCAL de capas ajenas (no se envía al servidor)
  const [localHidden,  setLocalHidden ] = useState<Set<number>>(new Set());

  const myLayers    = layers.filter(l => l.ownerId === myUserId);
  const otherLayers = layers.filter(l => l.ownerId !== myUserId);

  // Agrupar capas ajenas por dueño
  const byOwner = new Map<string, { ownerName: string; layers: Layer[] }>();
  for (const l of otherLayers) {
    if (!byOwner.has(l.ownerId))
      byOwner.set(l.ownerId, { ownerName: l.ownerName, layers: [] });
    byOwner.get(l.ownerId)!.layers.push(l);
  }

  const toggleLocalHidden = (id: number) => {
    setLocalHidden(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const startRename = (l: Layer) => {
    setEditingId(l.id); setNameDraft(l.name);
  };
  const commitRename = (id: number) => {
    const t = nameDraft.trim();
    if (t) onRename(id, t);
    setEditingId(null);
  };

  const activeLayer = myLayers.find(l => l.id === activeLayerId);

  return (
    <>
      <style>{`
        .lp-wrap {
          position:fixed; right:0; top:52px; bottom:0; width:210px;
          background:rgba(14,14,14,0.97);
          border-left:0.5px solid #252525;
          display:flex; flex-direction:column;
          z-index:900; user-select:none;
          font-family: system-ui, sans-serif;
        }
        .lp-header {
          display:flex; align-items:center; justify-content:space-between;
          padding:10px 12px 8px;
          border-bottom:0.5px solid #1e1e1e; flex-shrink:0;
        }
        .lp-title { font-size:10px; color:#484848; text-transform:uppercase; letter-spacing:.08em; }
        .lp-add {
          width:22px; height:22px; border-radius:6px;
          background:#1a1a1a; border:0.5px solid #2e2e2e;
          color:#777; font-size:15px; display:flex;
          align-items:center; justify-content:center;
          cursor:pointer; transition:all .12s; flex-shrink:0;
        }
        .lp-add:hover { background:#22224a; border-color:#7070dd; color:#aaaaff; }
        .lp-scroll { flex:1; overflow-y:auto; padding:4px 0 8px; }
        .lp-scroll::-webkit-scrollbar { width:3px; }
        .lp-scroll::-webkit-scrollbar-thumb { background:#232323; border-radius:2px; }

        /* Sección */
        .lp-section {
          padding:8px 12px 4px;
          font-size:9px; color:#3a3a3a;
          text-transform:uppercase; letter-spacing:.08em;
          display:flex; align-items:center; gap:6px;
        }
        .lp-section-line { flex:1; height:0.5px; background:#1e1e1e; }

        /* Item de capa */
        .lp-item {
          display:flex; align-items:center; gap:5px;
          padding:5px 10px 5px 8px;
          cursor:pointer; border-left:2.5px solid transparent;
          transition:background .1s;
          position:relative;
        }
        .lp-item:hover { background:#191919; }
        .lp-item.active { background:#181830; border-left-color:#7070dd; }
        .lp-item.drag-over { background:#1e1e38; }
        .lp-item.readonly { cursor:default; padding-left:20px; }

        .lp-handle { font-size:10px; color:#2a2a2a; cursor:grab; padding:0 2px; flex-shrink:0; }
        .lp-handle:hover { color:#444; }
        .lp-handle:active { cursor:grabbing; }

        .lp-thumb {
          width:28px; height:28px; border-radius:4px;
          background:#1c1c1c; border:0.5px solid #2a2a2a;
          flex-shrink:0; display:flex; align-items:center;
          justify-content:center; font-size:8px; color:#383838;
          overflow:hidden;
        }

        .lp-info { flex:1; min-width:0; }
        .lp-name {
          font-size:11.5px; color:#bbb;
          white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
        }
        .lp-name.dim { color:#3a3a3a; }
        .lp-name-input {
          width:100%; background:#111; border:0.5px solid #7070dd;
          border-radius:4px; color:#ccc; font-size:11px;
          padding:2px 4px; outline:none;
        }

        .lp-ops { display:flex; gap:1px; align-items:center; flex-shrink:0; }
        .lp-ibtn {
          width:18px; height:18px; border-radius:4px;
          background:transparent; border:none; color:#3a3a3a;
          font-size:11px; cursor:pointer; padding:0;
          display:flex; align-items:center; justify-content:center;
          transition:all .1s;
        }
        .lp-ibtn:hover { color:#aaa; background:#222; }
        .lp-ibtn.on { color:#7070dd; }
        .lp-ibtn.del:hover { color:#ff5555 !important; background:#1e1010 !important; }

        /* Grupo de otro usuario */
        .lp-owner {
          display:flex; align-items:center; gap:6px;
          padding:7px 12px 3px 12px;
        }
        .lp-owner-name { font-size:10px; color:#404040; }

        /* Opacidad */
        .lp-opa-row {
          padding:8px 12px 10px;
          border-top:0.5px solid #1a1a1a; flex-shrink:0;
        }
        .lp-opa-lbl {
          font-size:9px; color:#383838; text-transform:uppercase;
          letter-spacing:.06em; margin-bottom:5px;
          display:flex; justify-content:space-between;
        }
        .lp-opa-lbl span:last-child { color:#555; }
        input[type=range].lp-slider {
          -webkit-appearance:none; width:100%; height:3px;
          border-radius:2px; background:#1e1e1e; outline:none; cursor:pointer;
        }
        input[type=range].lp-slider::-webkit-slider-thumb {
          -webkit-appearance:none; width:11px; height:11px;
          border-radius:50%; background:#7070dd;
          border:1.5px solid #aaaaff; cursor:pointer;
        }
      `}</style>

      <div className="lp-wrap">
        {/* Header */}
        <div className="lp-header">
          <span className="lp-title">Capas</span>
          <div style={{display:"flex",alignItems:"center",gap:5}}>
            <span style={{fontSize:9, color: myLayers.length>=layerLimit?"#e05d5d":"#383838"}}>
              {myLayers.length}/{layerLimit}
            </span>
            <button
              className="lp-add"
              onClick={onAdd}
              title={myLayers.length>=layerLimit?`Límite de ${layerLimit} capas`:"Nueva capa"}
              disabled={myLayers.length>=layerLimit}
              style={{opacity:myLayers.length>=layerLimit?0.3:1,
                cursor:myLayers.length>=layerLimit?"not-allowed":"pointer"}}
            >+</button>
          </div>
        </div>

        <div className="lp-scroll">
          {/* ── MIS CAPAS ── */}
          <div className="lp-section">
            <span>Mis capas</span>
            <div className="lp-section-line"/>
          </div>

          {[...myLayers].reverse().map((layer, rIdx) => {
            const origIdx = myLayers.length - 1 - rIdx;
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
                <span className="lp-handle">⠿</span>
                <div className="lp-thumb">{layer.id}</div>
                <div className="lp-info">
                  {editingId === layer.id ? (
                    <input
                      autoFocus
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
                      className={`lp-name${!layer.visible?" dim":""}`}
                      onDoubleClick={e => { e.stopPropagation(); startRename(layer); }}
                      title="Doble clic para renombrar"
                    >{layer.name}</div>
                  )}
                  {isActive && (
                    <select
                      className="lp-blend-select"
                      value={layer.blendMode ?? "normal"}
                      onChange={e => { e.stopPropagation(); onBlendMode(layer.id, e.target.value); }}
                      onClick={e => e.stopPropagation()}
                    >
                      {BLEND_MODES.map(m => (
                        <option key={m.id} value={m.id}>{m.label}</option>
                      ))}
                    </select>
                  )}
                </div>
                <div className="lp-ops" onClick={e => e.stopPropagation()}>
                  <button
                    className={`lp-ibtn${layer.visible?" on":""}`}
                    title={layer.visible?"Ocultar":"Mostrar"}
                    onClick={() => onToggleVisibility(layer.id)}
                  >{layer.visible?"👁":"◌"}</button>
                  <button
                    className={`lp-ibtn${layer.locked?" on":""}`}
                    title={layer.locked?"Desbloquear":"Bloquear"}
                    onClick={() => onToggleLock(layer.id)}
                  >{layer.locked?"🔒":"🔓"}</button>
                  <button
                    className="lp-merge-btn"
                    title={origIdx===0 ? "No hay capa debajo" : "Fusionar con capa inferior"}
                    disabled={origIdx===0}
                    onClick={() => onMerge(layer.id)}
                  >⤵</button>
                  {myLayers.length > 1 && (
                    <button
                      className="lp-ibtn del"
                      title="Eliminar"
                      onClick={() => onDelete(layer.id)}
                    >✕</button>
                  )}
                </div>
              </div>
            );
          })}

          {/* ── CAPAS DE OTROS USUARIOS ── */}
          {byOwner.size > 0 && (
            <div className="lp-section" style={{marginTop:8}}>
              <span>Sala</span>
              <div className="lp-section-line"/>
            </div>
          )}
          {Array.from(byOwner.entries()).map(([ownerId, { ownerName, layers: ols }]) => (
            <div key={ownerId}>
              {/* Cabecera del usuario */}
              <div className="lp-owner">
                <Avatar name={ownerName}/>
                <span className="lp-owner-name">{ownerName}</span>
              </div>
              {[...ols].reverse().map(layer => {
                const hidden = localHidden.has(layer.id);
                return (
                  <div key={layer.id} className="lp-item readonly">
                    <div className="lp-thumb" style={{opacity:.5}}>{layer.id}</div>
                    <div className="lp-info">
                      <div className={`lp-name${hidden?" dim":""}`}
                        style={{fontSize:11, color: hidden?"#333":"#666"}}>
                        {layer.name}
                      </div>
                    </div>
                    <div className="lp-ops">
                      {/* Solo toggle visibilidad LOCAL */}
                      <button
                        className={`lp-ibtn${!hidden?" on":""}`}
                        title={hidden?"Mostrar localmente":"Ocultar localmente"}
                        onClick={() => toggleLocalHidden(layer.id)}
                        style={{color: hidden?"#333":"#555"}}
                      >{hidden?"◌":"👁"}</button>
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>

        {/* Opacidad de capa activa */}
        {activeLayer && (
          <div className="lp-opa-row">
            <div className="lp-opa-lbl">
              <span>Opacidad</span>
              <span>{Math.round(activeLayer.opacity*100)}%</span>
            </div>
            <input
              type="range" className="lp-slider"
              min={0} max={100}
              value={Math.round(activeLayer.opacity*100)}
              onChange={e => onOpacity(activeLayer.id, Number(e.target.value)/100)}
            />
          </div>
        )}
      </div>
    </>
  );
}