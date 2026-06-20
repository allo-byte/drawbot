import { useState, useRef, useCallback } from "react";
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
  onOpacityLive: (id: number, opacity: number) => void; // actualiza sin WS ni re-render global
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

// Slider de opacidad ultra fluido:
// - El valor LOCAL se guarda en un ref (sin re-render)
// - compositeNow lo lee directo via onOpacityLive que actualiza layersRef
// - Solo al soltar (pointerup) se propaga a React + WS
function OpacitySlider({ layerId, initialOpacity, onLive, onCommit }: {
  layerId: number;
  initialOpacity: number;
  onLive:   (id: number, v: number) => void;
  onCommit: (id: number, v: number) => void;
}) {
  const valRef  = useRef(Math.round(initialOpacity * 100));
  const trackRef = useRef<HTMLDivElement>(null);
  // FIX (slider no fluido): cachear el rect del track aquí, calculado UNA
  // sola vez al iniciar el arrastre (pointerdown), en vez de llamar
  // getBoundingClientRect() en cada pixel de movimiento del mouse/dedo.
  // getBoundingClientRect fuerza un layout reflow del navegador — barato
  // una vez, pero notablemente costoso si se repite decenas de veces por
  // segundo durante un arrastre, especialmente dentro de un panel con
  // scroll y muchos elementos como el de capas. El track no se mueve
  // mientras se arrastra, así que cachearlo es seguro.
  const cachedRectRef = useRef<{ top: number; height: number } | null>(null);
  const [display, setDisplay] = useState(Math.round(initialOpacity * 100));

  const calc = useCallback((clientY: number) => {
    const rect = cachedRectRef.current;
    if (!rect) return;
    const pct  = 1 - Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
    const val  = Math.round(pct * 100);
    if (val === valRef.current) return;
    valRef.current = val;
    setDisplay(val);           // solo re-render del slider, no de App
    onLive(layerId, val / 100); // actualiza layersRef directo → compositeNow ve el valor nuevo
  }, [layerId, onLive]);

  // FIX (slider de opacidad bugeado / no responde): el código anterior
  // usaba e.currentTarget dentro de los listeners onMove/onUp, que se
  // ejecutan en un momento DIFERENTE al evento original de React. React
  // recicla el objeto de evento sintético (event pooling) después de que
  // el handler de onPointerDown termina, así que para cuando el usuario
  // suelta el dedo/mouse, e.currentTarget ya puede ser null —
  // provocando "Cannot read properties of null (reading
  // 'releasePointerCapture')" y dejando el slider completamente
  // congelado a partir de ese primer intento fallido.
  // Solución: capturar la referencia real del elemento DOM en una
  // variable normal (el propio nodo, no el evento sintético) ANTES de
  // crear los listeners diferidos, y usar esa variable en vez de
  // e.currentTarget dentro de onMove/onUp.
  const handlePointer = useCallback((e: React.PointerEvent) => {
    const el = e.currentTarget as HTMLDivElement; // referencia real al nodo DOM, estable
    el.setPointerCapture(e.pointerId);

    // FIX (slider no fluido): calcular el rect UNA vez aquí, al iniciar el
    // arrastre — no en cada movimiento.
    const rect = el.getBoundingClientRect();
    cachedRectRef.current = { top: rect.top, height: rect.height };
    calc(e.clientY);

    // FIX (slider no fluido, parte 2): los eventos pointermove pueden
    // disparar mucho más rápido que la tasa de refresco real de la
    // pantalla (hasta cientos de veces por segundo en algunos touchpads/
    // mouses de alta frecuencia). Procesar cada uno individualmente
    // saturaba el hilo principal con trabajo redundante. rafPendingRef
    // asegura que solo se procese el movimiento más reciente una vez por
    // frame de animación, que es la cadencia natural de la pantalla.
    let rafPending = false;
    let lastClientY = e.clientY;
    const onMove = (ev: PointerEvent) => {
      lastClientY = ev.clientY;
      if (rafPending) return;
      rafPending = true;
      requestAnimationFrame(() => {
        rafPending = false;
        calc(lastClientY);
      });
    };
    const onUp = (ev: PointerEvent) => {
      // FIX: usar la variable `el` capturada arriba, nunca e.currentTarget
      // dentro de este closure — el evento React original ya no es válido.
      try { el.releasePointerCapture(ev.pointerId); } catch {}
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup",   onUp);
      cachedRectRef.current = null;
      onCommit(layerId, valRef.current / 100); // propagar a React + WS al soltar
    };
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup",   onUp);
  }, [layerId, calc, onCommit]);

  const pct = display;
  return (
    <div style={{padding:"8px 12px 10px", borderTop:"0.5px solid #1a1a1a", flexShrink:0}}>
      <div style={{
        fontSize:9, color:"#383838", textTransform:"uppercase", letterSpacing:".06em",
        marginBottom:5, display:"flex", justifyContent:"space-between",
      }}>
        <span>Opacidad</span>
        <span style={{color:"#555"}}>{display}%</span>
      </div>
      <div ref={trackRef}
        style={{
          position:"relative", height:3, borderRadius:2,
          background:"#1e1e1e", cursor:"pointer", touchAction:"none",
        }}
        onPointerDown={handlePointer}
      >
        <div style={{
          position:"absolute", left:0, top:0, bottom:0,
          width:`${pct}%`, borderRadius:2, background:"#7070dd",
          pointerEvents:"none",
        }}/>
        <div style={{
          position:"absolute", top:"50%", left:`${pct}%`,
          transform:"translate(-50%,-50%)",
          width:11, height:11, borderRadius:"50%",
          background:"#7070dd", border:"1.5px solid #aaaaff",
          pointerEvents:"none",
        }}/>
      </div>
    </div>
  );
}

export default function LayerPanel({
  layers, activeLayerId, myUserId, layerLimit,
  onSelect, onAdd, onDelete,
  onToggleVisibility, onToggleLock,
  onRename, onReorder, onOpacity, onOpacityLive, onMerge, onBlendMode,
}: Props) {
  const [editingId,   setEditingId  ] = useState<number|null>(null);
  const [nameDraft,   setNameDraft  ] = useState("");
  const [dragIdx,     setDragIdx    ] = useState<number|null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number|null>(null);
  const [localHidden, setLocalHidden] = useState<Set<number>>(new Set());

  const myLayers    = layers.filter(l => l.ownerId === myUserId);
  const otherLayers = layers.filter(l => l.ownerId !== myUserId);

  const byOwner = new Map<string, { ownerName: string; layers: Layer[] }>();
  for (const l of otherLayers) {
    if (!byOwner.has(l.ownerId)) byOwner.set(l.ownerId, { ownerName: l.ownerName, layers: [] });
    byOwner.get(l.ownerId)!.layers.push(l);
  }

  const toggleLocalHidden = (id: number) => {
    setLocalHidden(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const startRename  = (l: Layer) => { setEditingId(l.id); setNameDraft(l.name); };
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
        .lp-add:hover:not(:disabled) { background:#22224a; border-color:#7070dd; color:#aaaaff; }
        .lp-scroll { flex:1; overflow-y:auto; padding:4px 0 8px; }
        .lp-scroll::-webkit-scrollbar { width:3px; }
        .lp-scroll::-webkit-scrollbar-thumb { background:#232323; border-radius:2px; }
        .lp-section {
          padding:8px 12px 4px; font-size:9px; color:#3a3a3a;
          text-transform:uppercase; letter-spacing:.08em;
          display:flex; align-items:center; gap:6px;
        }
        .lp-section-line { flex:1; height:0.5px; background:#1e1e1e; }
        .lp-item {
          display:flex; align-items:center; gap:5px;
          padding:5px 10px 5px 8px;
          cursor:pointer; border-left:2.5px solid transparent;
          transition:background .1s; position:relative;
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
        .lp-blend-select {
          width:100%; margin-top:2px;
          background:#111; border:0.5px solid #2a2a2a;
          border-radius:4px; color:#555; font-size:9px;
          padding:2px 4px; outline:none; cursor:pointer;
          transition:border-color .12s;
        }
        .lp-blend-select:focus { border-color:#7070dd; color:#aaa; }
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
        .lp-merge-btn {
          width:18px; height:18px; border-radius:4px;
          background:transparent; border:none; color:#3a3a3a;
          font-size:11px; cursor:pointer; padding:0;
          display:flex; align-items:center; justify-content:center;
          transition:all .1s;
        }
        .lp-merge-btn:hover:not(:disabled) { color:#aaaaff; background:#1e1e3a; }
        .lp-merge-btn:disabled { opacity:0.2; cursor:not-allowed; }
        .lp-owner { display:flex; align-items:center; gap:6px; padding:7px 12px 3px 12px; }
        .lp-owner-name { font-size:10px; color:#404040; }
      `}</style>

      <div className="lp-wrap">
        <div className="lp-header">
          <span className="lp-title">Capas</span>
          <div style={{display:"flex",alignItems:"center",gap:5}}>
            <span style={{fontSize:9, color: myLayers.length>=layerLimit?"#e05d5d":"#383838"}}>
              {myLayers.length}/{layerLimit}
            </span>
            <button className="lp-add" onClick={onAdd}
              title={myLayers.length>=layerLimit?`Límite ${layerLimit}`:"Nueva capa"}
              disabled={myLayers.length>=layerLimit}
              style={{opacity:myLayers.length>=layerLimit?0.3:1,
                cursor:myLayers.length>=layerLimit?"not-allowed":"pointer"}}
            >+</button>
          </div>
        </div>

        <div className="lp-scroll">
          <div className="lp-section">
            <span>Mis capas</span>
            <div className="lp-section-line"/>
          </div>

          {[...myLayers].reverse().map((layer, rIdx) => {
            const origIdx = myLayers.length - 1 - rIdx;
            const isActive = layer.id === activeLayerId;
            return (
              <div key={layer.id}
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
                    <input autoFocus className="lp-name-input"
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
                    <div className={`lp-name${!layer.visible?" dim":""}`}
                      onDoubleClick={e => { e.stopPropagation(); startRename(layer); }}
                      title="Doble clic para renombrar"
                    >{layer.name}</div>
                  )}
                  {isActive && (
                    <select className="lp-blend-select"
                      value={layer.blendMode ?? "normal"}
                      onChange={e => { e.stopPropagation(); onBlendMode(layer.id, e.target.value); }}
                      onClick={e => e.stopPropagation()}
                    >
                      {BLEND_MODES.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
                    </select>
                  )}
                </div>
                <div className="lp-ops" onClick={e => e.stopPropagation()}>
                  <button className={`lp-ibtn${layer.visible?" on":""}`}
                    title={layer.visible?"Ocultar":"Mostrar"}
                    onClick={() => onToggleVisibility(layer.id)}
                  >{layer.visible?"👁":"◌"}</button>
                  <button className={`lp-ibtn${layer.locked?" on":""}`}
                    title={layer.locked?"Desbloquear":"Bloquear"}
                    onClick={() => onToggleLock(layer.id)}
                  >{layer.locked?"🔒":"🔓"}</button>
                  <button className="lp-merge-btn"
                    title={origIdx===0?"No hay capa debajo":"Fusionar con capa inferior"}
                    disabled={origIdx===0}
                    onClick={() => onMerge(layer.id)}
                  >⤵</button>
                  {myLayers.length > 1 && (
                    <button className="lp-ibtn del" title="Eliminar"
                      onClick={() => onDelete(layer.id)}
                    >✕</button>
                  )}
                </div>
              </div>
            );
          })}

          {byOwner.size > 0 && (
            <div className="lp-section" style={{marginTop:8}}>
              <span>Sala</span>
              <div className="lp-section-line"/>
            </div>
          )}
          {Array.from(byOwner.entries()).map(([ownerId, { ownerName, layers: ols }]) => (
            <div key={ownerId}>
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
                        style={{fontSize:11, color: hidden?"#333":"#666"}}
                      >{layer.name}</div>
                    </div>
                    <div className="lp-ops">
                      <button className={`lp-ibtn${!hidden?" on":""}`}
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

        {/* Opacidad ultra fluida — sin pasar por React en cada tick */}
        {activeLayer && (
          <OpacitySlider
            key={activeLayer.id}
            layerId={activeLayer.id}
            initialOpacity={activeLayer.opacity}
            onLive={onOpacityLive}
            onCommit={onOpacity}
          />
        )}
      </div>
    </>
  );
}