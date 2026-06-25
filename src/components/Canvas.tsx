import { useEffect, useRef } from "react";

type Point = { x: number; y: number };

export type BrushType =
  | "pen" | "caligraphy1" | "caligraphy2"
  | "airbrush" | "oil" | "crayon" | "marker" | "pencil";

// FEATURE: patrón "fillImage" — toda herramienta que produce un resultado
// rasterizado completo en vez de un trazo punto a punto (insertar imagen,
// y en el futuro cubeta/transformar si se reintroducen) se representa como
// un Stroke especial con points:[] y este campo poblado. Esto reutiliza
// gratis toda la persistencia (Supabase), sync por WebSocket, y undo/redo
// ya existentes para strokes normales, sin sistemas paralelos.
type FillImage = {
  data: string;   // dataURL de la imagen ya comprimida
  srcW: number; srcH: number; // tamaño original de la imagen (referencia)
  dstW: number; dstH: number; // tamaño final dibujado en el lienzo
  offsetX?: number; offsetY?: number; // esquina superior izquierda en coords de mundo
};

type Stroke = {
  _sid?: string; // ID único local — clave del fix de undo/redo
  points: Point[];
  color: string; size: number; opacity: number;
  eraser: boolean; brushType?: BrushType; layerId?: number;
  _uid?: string;
  fillImage?: FillImage;
};

export type BlendMode =
  | "normal" | "multiply" | "screen" | "overlay"
  | "darken" | "lighten" | "color-dodge" | "color-burn"
  | "hard-light" | "soft-light" | "difference" | "exclusion"
  | "hue" | "color" | "add" | "subtract" | "divide" | "lighter-color";

export type Layer = {
  id: number; name: string; visible: boolean; opacity: number;
  locked: boolean; ownerId: string; ownerName: string; blendMode?: BlendMode;
  // FEATURE: capa Referencia — su contenido (strokes, imágenes insertadas)
  // jamás se manda al servidor mientras esté activa, ni siquiera la
  // existencia de la capa se revela a otros usuarios de la sala. Pensada
  // para bocetos guía, fotos de pose, paletas de color, etc. que el propio
  // usuario quiere ver/usar mientras dibuja sin compartirlas.
  isReference?: boolean;
};

const BLEND_CSS: Record<string, GlobalCompositeOperation> = {
  "normal":"source-over","multiply":"multiply","screen":"screen","overlay":"overlay",
  "darken":"darken","lighten":"lighten","color-dodge":"color-dodge","color-burn":"color-burn",
  "hard-light":"hard-light","soft-light":"soft-light","difference":"difference","exclusion":"exclusion",
  "hue":"hue","color":"color","add":"lighter","subtract":"difference","divide":"color-dodge","lighter-color":"lighten",
};
function getBlendCSS(mode?: BlendMode): GlobalCompositeOperation { return BLEND_CSS[mode ?? "normal"] ?? "source-over"; }

export type CanvasImage = { id: number; data: string; x: number; y: number; w: number; h: number; };
type Cursor = { x: number; y: number; userId: string };
export type CanvasSize = { w: number; h: number } | null;

type LayerEvent = {
  type: string; layers?: Layer[]; layer?: Layer;
  layerId?: number; myUserId?: string; ownerId?: string; order?: number[];
};

type Props = {
  color: string; brushSize: number; opacity: number;
  eraser: boolean; brushType: BrushType; panMode: boolean;
  username: string; bgColor: string; canvasSize: CanvasSize;
  layers: Layer[]; activeLayerId: number;
  setUsers?: (users: string[]) => void;
  onReady?: (saveFn: () => void, uploadFn: (file: File) => void) => void;
  onBgColor?: (color: string) => void;
  onCanvasSizeFromServer?: (size: { w: number; h: number }) => void;
  onUndoStateChange?: (state: { canUndo: boolean; canRedo: boolean }) => void;
  onStrokeFinished?: (color: string) => void;
  onLayerEvent?: (event: LayerEvent) => void;
  onConnectionChange?: (status: "connected"|"disconnected"|"reconnecting") => void;
};

function hexRgb(hex: string) {
  const c = hex.replace("#","");
  return { r:parseInt(c.slice(0,2),16), g:parseInt(c.slice(2,4),16), b:parseInt(c.slice(4,6),16) };
}
function prng(seed: number) {
  let s = (seed ^ 0xdeadbeef) >>> 0;
  s = Math.imul(s ^ (s>>>16), 0x45d9f3b) >>> 0;
  s = Math.imul(s ^ (s>>>16), 0x45d9f3b) >>> 0;
  return (s>>>0) / 0xffffffff;
}
// Generador simple de IDs únicos por stroke (no requiere uuid lib)
let sidCounter = 0;
function genSid(): string {
  return `${Date.now().toString(36)}-${(sidCounter++).toString(36)}-${Math.random().toString(36).slice(2,7)}`;
}

// FIX (capas/usuarios duplicados en cada refresh): genera un userId una
// sola vez por navegador y lo guarda en localStorage. Cada conexión nueva
// (incluyendo refrescos de página) reusa el mismo ID, así el servidor te
// reconoce como el mismo usuario en vez de crear una identidad/capa nueva
// cada vez. Esto también es necesario para que el undo/redo de una sesión
// anterior siga aplicando correctamente a "tus" capas tras refrescar.
function getOrCreatePersistentUserId(): string {
  const KEY = "peonypaint-client-uid";
  try {
    const existing = localStorage.getItem(KEY);
    if (existing && /^[a-z0-9]{4,12}$/i.test(existing)) return existing;
  } catch {}
  const fresh = Math.random().toString(36).substring(2, 9);
  try { localStorage.setItem(KEY, fresh); } catch {}
  return fresh;
}

// ── FIX (undo/redo no sincronizado): envío con reintento ──────────────────
// El bug real: wsRef.current?.readyState===WebSocket.OPEN se evalúa UNA vez.
// Si el socket está reconectando justo en ese instante (lag, reconexión tras
// inactividad, etc.), el mensaje undo_sync simplemente se descarta sin aviso.
// Localmente el undo se ve bien (ya se aplicó en el canvas), pero el server
// y los demás usuarios nunca se enteran. sendReliable reintenta hasta que
// el socket esté abierto, con un límite de intentos para no encolar para
// siempre si la conexión está realmente caída.
function sendReliable(
  getWs: () => WebSocket | null,
  msg: object,
  maxAttempts = 8,
  delayMs = 250
) {
  let attempts = 0;
  const tryNow = () => {
    const ws = getWs();
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
      return;
    }
    attempts++;
    if (attempts < maxAttempts) {
      setTimeout(tryNow, delayMs);
    }
    // Si se agotan los intentos, el socket sigue cerrado y al reconectar
    // se manda un "join" de nuevo que trae el estado real desde el servidor,
    // así que no queda en un limbo permanente — solo se pierde este undo puntual.
  };
  tryNow();
}

const stampCache = new Map<string, HTMLCanvasElement>();
const STAMP_MAX  = 128;
function getCachedStamp(key: string, dim: number, paint: (sc: CanvasRenderingContext2D, half: number) => void) {
  if (stampCache.has(key)) return stampCache.get(key)!;
  const s = document.createElement("canvas");
  s.width = s.height = dim;
  paint(s.getContext("2d")!, dim/2);
  if (stampCache.size >= STAMP_MAX) stampCache.delete(stampCache.keys().next().value!);
  stampCache.set(key, s);
  return s;
}

const imgCache = new Map<number, HTMLImageElement>();
function getCachedImage(img: CanvasImage): HTMLImageElement | null {
  if (imgCache.has(img.id)) return imgCache.get(img.id)!;
  const el = new Image();
  el.onload = () => imgCache.set(img.id, el);
  el.src = img.data;
  return null;
}

// FEATURE (fillImage): caché paralelo para las imágenes insertadas como
// strokes especiales (patrón fillImage), keyed por _sid del stroke en vez
// de un id numérico de imagen global — porque cada fillImage VIVE dentro
// de un stroke normal, no en la lista separada roomImages/imagesRef.
// onLoaded es opcional: se usa para pedir un repintado en cuanto la imagen
// termine de decodificarse (la primera vez que se ve, antes de eso no hay
// nada que dibujar).
const fillImgCache = new Map<string, HTMLImageElement>();
function getCachedFillImage(sid: string, dataUrl: string, onLoaded?: () => void): HTMLImageElement | null {
  if (fillImgCache.has(sid)) return fillImgCache.get(sid)!;
  const el = new Image();
  el.onload = () => { fillImgCache.set(sid, el); onLoaded?.(); };
  el.src = dataUrl;
  return null;
}

const DEFAULT_W = 2388;
const DEFAULT_H = 1668;

export default function Canvas({
  color, brushSize, opacity, eraser, brushType, panMode, username,
  bgColor, canvasSize, layers, activeLayerId,
  setUsers, onReady, onBgColor, onCanvasSizeFromServer, onUndoStateChange, onStrokeFinished, onLayerEvent,
  onConnectionChange,
}: Props) {
  const canvasRef         = useRef<HTMLCanvasElement>(null);
  const layerOffscrRef    = useRef<Map<number, HTMLCanvasElement>>(new Map());
  const layerCtxRef       = useRef<Map<number, CanvasRenderingContext2D>>(new Map());
  const dirtyLayersRef    = useRef<Set<number>>(new Set());
  const remotePreviewsRef = useRef<Map<string, Stroke>>(new Map());
  const wsRef             = useRef<WebSocket | null>(null);
  const cursorsRef        = useRef<Map<string, Cursor>>(new Map());
  const strokesRef        = useRef<Stroke[]>([]);
  const currentStrokeRef  = useRef<Stroke | null>(null);
  const rafRef            = useRef<number | null>(null);
  const imagesRef         = useRef<CanvasImage[]>([]);
  const localHiddenRef    = useRef<Set<number>>(new Set());
  const myUserIdRef       = useRef<string>("");

  const colorRef       = useRef(color);
  const sizeRef        = useRef(brushSize);
  const opacityRef     = useRef(opacity);
  const eraserRef      = useRef(eraser);
  const brushTypeRef   = useRef(brushType);
  const panModeRef     = useRef(panMode);
  const bgColorRef     = useRef(bgColor);
  const canvasSizeRef  = useRef(canvasSize);
  const layersRef      = useRef(layers);
  const activeLayerRef = useRef(activeLayerId);
  const panStartRef    = useRef<{x:number;y:number;vx:number;vy:number}|null>(null);
  const lastSentPtRef  = useRef(0);
  const lastSentMsRef  = useRef(0);
  const viewRef        = useRef({ x:0, y:0, scale:1 });
  // FEATURE: voltear lienzo — solo afecta la VISTA local de este usuario
  // (como un espejo para dibujar mejor), nunca se manda por WS ni se
  // persiste. Los strokes siguen guardándose con sus coordenadas reales
  // sin invertir; solo la transformación de render se invierte en X.
  const flipXRef        = useRef(false);
  // FEATURE: crosshair configurable (forma + tamaño) que sigue el dedo en
  // dispositivos táctiles, donde el cursor CSS "crosshair" no existe.
  const crosshairRef    = useRef<{ shape: "circle"|"cross"|"dot"; size: number; enabled: boolean }>({
    shape: "circle", size: 24, enabled: true,
  });
  const crosshairPosRef = useRef<{x:number;y:number} | null>(null);
  const touchPtrsRef   = useRef<Map<number,{x:number;y:number}>>(new Map());

  // FEATURE: estabilización de trazo (stroke smoothing). 0 = sin suavizado
  // (comportamiento idéntico al actual: el punto pintado es el punto real
  // del puntero). >0 = el punto que se pinta "persigue" al puntero real con
  // un rezago elástico — cada frame se acerca una fracción de la distancia
  // restante. Valor en rango 0–100 (porcentaje), igual estilo que OPA/TAM.
  // smoothedPosRef guarda la posición YA suavizada del trazo en curso (en
  // coordenadas de mundo); se reinicia en cada startStroke().
  const smoothingRef    = useRef(0);
  const smoothedPosRef  = useRef<Point | null>(null);

  // ── FIX gestos: estado de gesto más robusto ─────────────────────────────
  // pendingSingleTouch: guarda el primer toque sin iniciar trazo inmediatamente.
  // Solo se confirma como "trazo de dibujo" tras un pequeño delay (FREEZE_MS)
  // o en cuanto se mueve más de DRAW_THRESHOLD_PX — lo que ocurra primero.
  // Esto da tiempo a que lleguen el 2º/3er dedo antes de comprometernos a dibujar.
  const gestureRef = useRef<{
    time: number;
    maxFingers: number;
    fingerMoves: Map<number, number>;
    drawCommitted: boolean;     // true cuando ya decidimos que es un trazo
    firstPos: {x:number;y:number} | null;
  } | null>(null);
  const pendingDrawTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const onUndoStateChangeRef   = useRef(onUndoStateChange);
  const onStrokeFinishedRef    = useRef(onStrokeFinished);
  const onLayerEventRef        = useRef(onLayerEvent);
  const onConnectionChangeRef  = useRef(onConnectionChange);
  const onCanvasSizeFromServerRef = useRef(onCanvasSizeFromServer);

  colorRef.current = color; sizeRef.current = brushSize; opacityRef.current = opacity;
  eraserRef.current = eraser; brushTypeRef.current = brushType; panModeRef.current = panMode;
  bgColorRef.current = bgColor; canvasSizeRef.current = canvasSize;
  layersRef.current = layers; activeLayerRef.current = activeLayerId;
  onUndoStateChangeRef.current = onUndoStateChange; onStrokeFinishedRef.current = onStrokeFinished;
  onLayerEventRef.current = onLayerEvent; onConnectionChangeRef.current = onConnectionChange;
  onCanvasSizeFromServerRef.current = onCanvasSizeFromServer;

  const MIN_SCALE = 0.05, MAX_SCALE = 10;
  // FREEZE_MS: tiempo que esperamos con 1 dedo quieto antes de comprometer el trazo.
  // Si en ese tiempo llega un 2º/3er dedo, se interpreta como gesto, no como dibujo.
  const FREEZE_MS = 90;
  const DRAW_THRESHOLD_PX = 4;   // mover más que esto con 1 dedo = confirmar dibujo al instante
  const GESTURE_MS  = 500;       // ventana total para considerar tap de 2/3 dedos
  const GESTURE_PX  = 22;        // movimiento máximo tolerado para que cuente como tap
  const STREAM_PTS = 3, STREAM_MS = 32;

  const toWorld = (sx:number, sy:number) => {
    const v = viewRef.current;
    // FEATURE (voltear lienzo): si flipXRef está activo, la pantalla se
    // dibuja espejada en compositeNow. Invertimos sx respecto al ancho
    // visible del canvas ANTES de aplicar la transformación de vista
    // normal, así el punto resultante en coordenadas del lienzo es
    // correcto sin tocar cómo se guardan/envían los strokes.
    const canvas = canvasRef.current;
    const effSx = (flipXRef.current && canvas) ? canvas.clientWidth - sx : sx;
    return { x:(effSx-v.x)/v.scale, y:(sy-v.y)/v.scale };
  };

  // FEATURE: estabilización de trazo — aplica un rezago elástico sobre el
  // punto real en coordenadas de mundo (rawWorld). smoothingRef.current es
  // 0–100; lo mapeamos a una fracción de "alcance" por frame (factor de
  // interpolación hacia el punto real). 0 = sin suavizado (devuelve el
  // punto real tal cual, idéntico al comportamiento previo). Valores altos
  // = el punto pintado se queda más "atrás" respecto al puntero real,
  // dando un trazo más suave pero con más distancia visual entre la punta
  // y la tinta — mismo comportamiento que el "stroke stabilizer" de
  // Procreate/otros editores.
  const applySmoothing = (rawWorld: Point): Point => {
    const amount = smoothingRef.current;
    if (amount <= 0) {
      smoothedPosRef.current = rawWorld;
      return rawWorld;
    }
    const prev = smoothedPosRef.current;
    if (!prev) {
      smoothedPosRef.current = rawWorld;
      return rawWorld;
    }
    // factor pequeño = sigue más de cerca (poco suavizado);
    // factor grande = se queda más atrás (mucho suavizado).
    // amount 1–100 → factor ~0.45 (casi nada de rezago) hasta ~0.04 (mucho rezago)
    const factor = 0.45 - (amount / 100) * 0.41;
    const next = {
      x: prev.x + (rawWorld.x - prev.x) * factor,
      y: prev.y + (rawWorld.y - prev.y) * factor,
    };
    smoothedPosRef.current = next;
    return next;
  };

  const offW = () => canvasSizeRef.current?.w ?? DEFAULT_W;
  const offH = () => canvasSizeRef.current?.h ?? DEFAULT_H;

  const getLayerCanvas = (layerId: number) => {
    if (!layerOffscrRef.current.has(layerId)) {
      const c = document.createElement("canvas");
      c.width = offW(); c.height = offH();
      layerOffscrRef.current.set(layerId, c);
      layerCtxRef.current.set(layerId, c.getContext("2d")!);
    }
    return layerOffscrRef.current.get(layerId)!;
  };
  const getLayerCtx = (layerId: number): CanvasRenderingContext2D => {
    if (!layerCtxRef.current.has(layerId)) {
      const lc = getLayerCanvas(layerId);
      layerCtxRef.current.set(layerId, lc.getContext("2d")!);
    }
    return layerCtxRef.current.get(layerId)!;
  };

  const drawStrokeFrom = (ctx: CanvasRenderingContext2D, stroke: Stroke, fromIndex: number) => {
    // FEATURE (fillImage): un stroke de imagen insertada no tiene puntos
    // (points:[]) — se dibuja entero de una sola vez, sin importar
    // fromIndex (no hay "trazo incremental" que reanudar, es un único
    // rectángulo). Se maneja ANTES del guard de pts.length<1 de abajo,
    // que de otro modo descartaría el stroke por no tener puntos.
    if (stroke.fillImage && stroke._sid) {
      const fi = stroke.fillImage;
      const el = getCachedFillImage(stroke._sid, fi.data, () => requestFrame());
      if (el) {
        ctx.save();
        ctx.globalAlpha = stroke.opacity;
        ctx.drawImage(el, fi.offsetX ?? 0, fi.offsetY ?? 0, fi.dstW, fi.dstH);
        ctx.restore();
      }
      return;
    }
    const pts = stroke.points; if (pts.length < 1) return;
    const bt = stroke.brushType ?? "pen", col = stroke.color, sz = stroke.size;
    const { r,g,b } = hexRgb(col); const erasing = stroke.eraser;
    const start = Math.max(fromIndex === 0 ? 0 : fromIndex-1, 0);
    ctx.save();
    ctx.globalCompositeOperation = erasing ? "destination-out" : "source-over";
    if (erasing) ctx.globalAlpha = 1;
    if (bt === "pen") {
      if (pts.length < 2) { ctx.restore(); return; }
      ctx.globalAlpha = stroke.opacity; ctx.lineCap = "round"; ctx.lineJoin = "round";
      ctx.lineWidth = sz; ctx.strokeStyle = erasing ? "#000" : col;
      ctx.beginPath(); ctx.moveTo(pts[start].x, pts[start].y);
      for (let i=start+1;i<pts.length;i++) ctx.lineTo(pts[i].x,pts[i].y);
      ctx.stroke();
    } else if (bt==="caligraphy1"||bt==="caligraphy2") {
      if (pts.length<2){ctx.restore();return;}
      ctx.globalAlpha=stroke.opacity;
      const angle=bt==="caligraphy1"?Math.PI*0.75:Math.PI*0.25;
      const w=sz,h=Math.max(1,sz*0.18);
      const dim=Math.ceil(Math.sqrt(w*w+h*h))+4, half=dim/2;
      const stamp=getCachedStamp(`${bt}|${sz}|${col}|${erasing}`,dim,(sc)=>{
        sc.fillStyle=erasing?"#000":col; sc.translate(half,half); sc.rotate(angle); sc.fillRect(-w/2,-h/2,w,h);
      });
      for(let i=Math.max(start,1);i<pts.length;i++){
        const a=pts[i-1],bPt=pts[i];
        ctx.drawImage(stamp,(a.x+bPt.x)/2-half,(a.y+bPt.y)/2-half);
      }
    } else if (bt==="airbrush") {
      const density=Math.max(8,Math.floor(sz*2)); const radius=sz*1.8;
      const dim=Math.ceil(radius*2)+4, half=dim/2;
      const stamp=getCachedStamp(`airbrush|${sz}|${r},${g},${b}|${stroke.opacity}|${erasing}`,dim,(sc)=>{
        sc.fillStyle=erasing?`rgba(0,0,0,${stroke.opacity*0.22})`:`rgba(${r},${g},${b},${stroke.opacity*0.22})`;
        for(let i=0;i<density;i++){
          const ang=prng(i*6271)*Math.PI*2, rad=Math.sqrt(prng(i*7919))*radius;
          sc.beginPath();sc.arc(half+Math.cos(ang)*rad,half+Math.sin(ang)*rad,0.7,0,Math.PI*2);sc.fill();
        }
      });
      for(let p=start;p<pts.length;p++){
        const pt=pts[p];
        ctx.save();ctx.translate(pt.x,pt.y);ctx.rotate(prng(p*9973)*Math.PI*2);
        ctx.drawImage(stamp,-half,-half);ctx.restore();
      }
    } else if (bt==="oil") {
      if(pts.length<2){ctx.restore();return;}
      const bristles=Math.max(4,Math.floor(sz*0.6));
      ctx.lineCap="round";ctx.lineJoin="round";ctx.lineWidth=Math.max(0.8,sz*0.12);
      for(let b2=0;b2<bristles;b2++){
        ctx.globalAlpha=stroke.opacity*(0.55+prng(b2*3571)*0.45);
        const dr=Math.min(255,r+Math.floor(prng(b2*13)*30-15));
        const dg=Math.min(255,g+Math.floor(prng(b2*17)*30-15));
        const db2=Math.min(255,b+Math.floor(prng(b2*19)*30-15));
        ctx.strokeStyle=erasing?"#000":`rgb(${dr},${dg},${db2})`;
        const t=bristles>1?b2/(bristles-1)-0.5:0;
        ctx.beginPath();let moved=false;
        for(let i=start;i<pts.length;i++){
          const pt=pts[i];let dx=0,dy=1;
          if(i>0){dx=pt.x-pts[i-1].x;dy=pt.y-pts[i-1].y;const len=Math.sqrt(dx*dx+dy*dy)||1;dx/=len;dy/=len;}
          const px=-dy*t*sz+prng(b2*1009+i*503)*sz*0.06;
          const py= dx*t*sz+prng(b2*2003+i*701)*sz*0.06;
          if(!moved){ctx.moveTo(pt.x+px,pt.y+py);moved=true;}else ctx.lineTo(pt.x+px,pt.y+py);
        }
        ctx.stroke();
      }
    } else if (bt==="crayon") {
      if(pts.length<2){ctx.restore();return;}
      const grain=Math.max(3,Math.floor(sz*0.5));
      ctx.lineCap="round";ctx.lineJoin="round";
      for(let g2=0;g2<grain;g2++){
        const offX=(prng(g2*4001)-0.5)*sz*0.85, offY=(prng(g2*5003)-0.5)*sz*0.85;
        ctx.globalAlpha=(0.12+prng(g2*7001)*0.3)*stroke.opacity;
        ctx.strokeStyle=erasing?"#000":col;
        ctx.lineWidth=Math.max(0.4,sz*0.08+prng(g2*3007)*sz*0.07);
        ctx.beginPath();ctx.moveTo(pts[start].x+offX,pts[start].y+offY);
        for(let i=start+1;i<pts.length;i++){
          ctx.lineTo(pts[i].x+offX+(prng(g2*1009+i*503)-0.5)*sz*0.12,
                     pts[i].y+offY+(prng(g2*2003+i*701)-0.5)*sz*0.12);
        }
        ctx.stroke();
      }
    } else if (bt==="marker") {
      if(pts.length<2){ctx.restore();return;}
      ctx.globalAlpha=Math.min(1,stroke.opacity*1.1);
      ctx.strokeStyle=erasing?"#000":col;
      ctx.lineWidth=sz;ctx.lineCap="square";ctx.lineJoin="miter";
      ctx.beginPath();ctx.moveTo(pts[start].x,pts[start].y);
      for(let i=start+1;i<pts.length;i++) ctx.lineTo(pts[i].x,pts[i].y);
      ctx.stroke();
    } else if (bt==="pencil") {
      if(pts.length<2){ctx.restore();return;}
      const lines=Math.max(2,Math.floor(sz*0.4));
      ctx.lineCap="round";
      for(let l=0;l<lines;l++){
        const offX=(prng(l*2017)-0.5)*sz*0.65, offY=(prng(l*3019)-0.5)*sz*0.65;
        ctx.globalAlpha=(0.07+prng(l*9001)*0.15)*stroke.opacity;
        ctx.strokeStyle=erasing?"#000":col;
        ctx.lineWidth=0.4+prng(l*4001)*0.5;
        ctx.beginPath();ctx.moveTo(pts[start].x+offX,pts[start].y+offY);
        for(let i=start+1;i<pts.length;i++) ctx.lineTo(pts[i].x+offX,pts[i].y+offY);
        ctx.stroke();
      }
    }
    ctx.restore();
  };
  const drawStroke = (ctx: CanvasRenderingContext2D, stroke: Stroke) => drawStrokeFrom(ctx, stroke, 0);

  const rebuildLayerCanvas = (layerId: number) => {
    getLayerCanvas(layerId);
    const ctx = getLayerCtx(layerId);
    ctx.setTransform(1,0,0,1,0,0);
    ctx.clearRect(0, 0, offW(), offH());
    strokesRef.current.filter(s => (s.layerId ?? -1) === layerId).forEach(s => drawStroke(ctx,s));
    dirtyLayersRef.current.delete(layerId);
  };
  const rebuildAllLayers = () => {
    // FIX (undo remoto no se refleja sin refrescar): antes solo se
    // reconstruían las capas listadas en layersRef.current. Pero ese ref
    // puede no incluir todas las capas que ya tienen strokes dibujados —
    // por ejemplo si la capa se creó/vio antes de que este usuario llegara
    // a la sala. Unimos los IDs de layersRef.current con los layerId que
    // aparecen realmente en los strokes, así cualquier canvas de capa con
    // contenido se reconstruye, sin depender de que la lista de capas esté
    // 100% sincronizada en ese instante.
    const ids = new Set(layersRef.current.map(l => l.id));
    strokesRef.current.forEach(s => { if (s.layerId != null) ids.add(s.layerId); });
    ids.forEach(id => rebuildLayerCanvas(id));
    dirtyLayersRef.current.clear();
  };

  const compositeNow = () => {
    const canvas = canvasRef.current; if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    const dpr = window.devicePixelRatio || 1, v = viewRef.current;
    ctx.setTransform(1,0,0,1,0,0); ctx.fillStyle = "#1a1a1a"; ctx.fillRect(0,0,canvas.width,canvas.height);
    ctx.save(); ctx.scale(dpr,dpr);
    // FEATURE (voltear lienzo, vista local): refleja todo el contenido
    // horizontalmente respecto al centro del canvas visible. Puramente
    // visual — no afecta cómo se guardan los strokes ni se sincroniza
    // con otros usuarios (cada uno puede tener su propio flip activo).
    if (flipXRef.current) {
      ctx.translate(canvas.clientWidth, 0);
      ctx.scale(-1, 1);
    }
    ctx.translate(v.x,v.y); ctx.scale(v.scale,v.scale);
    const cs = canvasSizeRef.current;
    const drawContent = (c: CanvasRenderingContext2D) => {
      c.fillStyle = bgColorRef.current; c.fillRect(0,0, offW(), offH());
      for (const img of imagesRef.current) {
        const el = getCachedImage(img);
        if (el) c.drawImage(el, img.x, img.y, img.w, img.h);
      }
      for (const layer of layersRef.current) {
        const isHidden = layer.visible === false || localHiddenRef.current.has(layer.id);
        if (isHidden) continue;
        if (dirtyLayersRef.current.has(layer.id)) rebuildLayerCanvas(layer.id);
        const lc = layerOffscrRef.current.get(layer.id);
        if (!lc) continue;
        c.save(); c.globalAlpha = layer.opacity; c.globalCompositeOperation = getBlendCSS(layer.blendMode);
        c.drawImage(lc, 0,0); c.restore();
      }
    };
    if (cs) {
      ctx.shadowColor = "rgba(0,0,0,0.5)"; ctx.shadowBlur = 20/v.scale;
      ctx.fillStyle = bgColorRef.current; ctx.fillRect(0,0,cs.w,cs.h); ctx.shadowBlur = 0;
      ctx.save(); ctx.beginPath(); ctx.rect(0,0,cs.w,cs.h); ctx.clip();
      drawContent(ctx); ctx.restore();
      ctx.strokeStyle = "rgba(255,255,255,0.12)"; ctx.lineWidth = 1/v.scale; ctx.strokeRect(0,0,cs.w,cs.h);
    } else { drawContent(ctx); }
    if (currentStrokeRef.current) drawStroke(ctx, currentStrokeRef.current);
    remotePreviewsRef.current.forEach(s => { if(s.points.length>1) drawStroke(ctx,s); });
    cursorsRef.current.forEach(cursor => {
      ctx.beginPath(); ctx.fillStyle="#00ff88";
      ctx.arc(cursor.x,cursor.y,6/v.scale,0,Math.PI*2); ctx.fill();
      ctx.fillStyle="white"; ctx.font=`${12/v.scale}px Arial`;
      // FEATURE (voltear lienzo): si la vista está espejada, el texto del
      // nombre quedaría ilegible salvo que lo contrarrestemos con un flip
      // local propio justo para el texto.
      if (flipXRef.current) {
        ctx.save();
        ctx.translate(cursor.x + 10/v.scale, cursor.y - 10/v.scale);
        ctx.scale(-1, 1);
        ctx.fillText(cursor.userId, 0, 0);
        ctx.restore();
      } else {
        ctx.fillText(cursor.userId, cursor.x+10/v.scale, cursor.y-10/v.scale);
      }
    });
    ctx.restore();

    // FEATURE: crosshair táctil — se dibuja DESPUÉS del ctx.restore(), en
    // coordenadas de pantalla puras (no de mundo), porque su tamaño debe
    // ser constante en pixeles visibles sin importar el zoom/pan/flip
    // actual del lienzo. Solo se muestra mientras hay un dedo activo
    // dibujando (currentStrokeRef.current existe) y el dispositivo es
    // táctil — en mouse/pen ya existe el cursor CSS "crosshair" nativo.
    const cpos = crosshairPosRef.current;
    if (cpos && crosshairRef.current.enabled && currentStrokeRef.current) {
      const { shape, size } = crosshairRef.current;
      ctx.save();
      // FIX (crosshair desplazado en iPad/táctil): setTransform(1,0,0,1,0,0)
      // deja el contexto en píxeles FÍSICOS reales del canvas (su
      // resolución interna, canvas.width/height), no en píxeles CSS. Pero
      // cpos viene de getBoundingClientRect() — está en píxeles CSS. Como
      // canvas.width = cssWidth * dpr, hay que multiplicar cpos por dpr
      // para que la posición coincida con el sistema de coordenadas físico
      // que queda activo tras el reset. Sin esto, en un iPad con dpr=2 la
      // cruz aparece a la mitad de distancia real (offset hacia arriba-
      // izquierda), exactamente el síntoma reportado.
      const dx = cpos.x * dpr, dy = cpos.y * dpr;
      const r  = size / 2 * dpr;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.strokeStyle = "rgba(255,255,255,0.85)";
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      ctx.lineWidth = 1.5 * dpr;
      if (shape === "circle") {
        ctx.beginPath();
        ctx.arc(dx, dy, r, 0, Math.PI * 2);
        ctx.stroke();
      } else if (shape === "cross") {
        ctx.beginPath();
        ctx.moveTo(dx - r, dy); ctx.lineTo(dx + r, dy);
        ctx.moveTo(dx, dy - r); ctx.lineTo(dx, dy + r);
        ctx.stroke();
      } else if (shape === "dot") {
        ctx.beginPath();
        ctx.arc(dx, dy, Math.max(2, r / 3), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
    rafRef.current = null;
  };
  const requestFrame = () => { if(rafRef.current!==null)return; rafRef.current=requestAnimationFrame(compositeNow); };
  const redraw = () => requestFrame();
  const redrawFull = () => { rebuildAllLayers(); requestFrame(); };

  useEffect(() => { requestFrame(); }, [bgColor, layers]);

  useEffect(() => {
    if (!canvasSize) return;
    layerOffscrRef.current.forEach((lc, id) => {
      const tmp = document.createElement("canvas");
      tmp.width = lc.width; tmp.height = lc.height;
      tmp.getContext("2d")!.drawImage(lc, 0, 0);
      lc.width = canvasSize.w; lc.height = canvasSize.h;
      lc.getContext("2d")!.drawImage(tmp, 0, 0, tmp.width, tmp.height, 0, 0, canvasSize.w, canvasSize.h);
      layerCtxRef.current.set(id, lc.getContext("2d")!);
    });
    rebuildAllLayers();
    requestFrame();
  }, [canvasSize]);

  useEffect(() => {
    const cs = canvasSize; if(!cs) return;
    const canvas = canvasRef.current; if(!canvas) return;
    const vw=canvas.clientWidth, vh=canvas.clientHeight;
    const scale=Math.min((vw*0.85)/cs.w,(vh*0.85)/cs.h,1);
    viewRef.current={x:(vw-cs.w*scale)/2,y:(vh-cs.h*scale)/2,scale};
    requestFrame();
  }, [canvasSize]);

  useEffect(() => {
    const canvas = canvasRef.current; if(!canvas) return;
    const dpr = window.devicePixelRatio||1;
    const cssW = window.innerWidth - 52 - 200;
    const cssH = window.innerHeight - 52;
    canvas.style.width  = cssW + "px";
    canvas.style.height = cssH + "px";
    canvas.width  = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);

    const room = new URLSearchParams(window.location.search).get("room")||"default";
    const protocol = window.location.protocol==="https:"?"wss:":"ws:";
    const wsUrl = (import.meta as any).env?.VITE_WS_URL||`${protocol}//${window.location.host}`;

    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let reconnectDelay = 1000;
    let intentionalClose = false;
    let pingInterval: ReturnType<typeof setInterval> | null = null;
    const usernameRef = { current: username };

    const connectWS = () => {
      if (intentionalClose) return;
      onConnectionChangeRef.current?.("reconnecting");
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;
      ws.onopen = () => {
        reconnectDelay = 1000;
        onConnectionChangeRef.current?.("connected");
        ws.send(JSON.stringify({type:"join", room, username: usernameRef.current, clientUserId: getOrCreatePersistentUserId()}));
        if (pingInterval) clearInterval(pingInterval);
        pingInterval = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({type:"ping"}));
        }, 20000);
      };
      ws.onclose = () => {
        if (intentionalClose) return;
        if (pingInterval) { clearInterval(pingInterval); pingInterval = null; }
        onConnectionChangeRef.current?.("disconnected");
        reconnectTimer = setTimeout(() => { reconnectDelay = Math.min(reconnectDelay*1.5,10000); connectWS(); }, reconnectDelay);
      };
      ws.onerror = () => ws.close();
      ws.onmessage = handleMessage;
    };

    const handleMessage = (event: MessageEvent) => {
      const data = JSON.parse(event.data);
      if (data.type==="init") {
        // FIX: asegurar que cada stroke recibido tenga _sid (puede venir sin él de la DB)
        strokesRef.current = (data.strokes||[]).map((s: Stroke) => s._sid ? s : {...s, _sid: genSid()});
        imagesRef.current  = data.images ||[];
        if (data.bgColor) onBgColor?.(data.bgColor);
        // FIX (tamaño de lienzo vuelve a default al refrescar): si el
        // servidor ya tiene un tamaño guardado para esta sala, lo aplicamos.
        // Si es null (sala nueva, nadie cambió el tamaño aún), se mantiene
        // el default local de App.tsx sin tocar nada.
        if (data.canvasSize) onCanvasSizeFromServerRef.current?.(data.canvasSize);
        if (data.myUserId) myUserIdRef.current = data.myUserId;
        // REDISEÑO undo/redo autoritativo: el servidor nos dice en el init
        // cuántas acciones de redo tenemos disponibles (redoAvailable). El
        // "puedo deshacer" se deriva de si ya tenemos algún stroke propio en
        // strokesRef.current — si hay al menos uno, hay algo que deshacer.
        if (data.myUserId) {
          const hasOwnStrokes = strokesRef.current.some((s: any) => s._uid === data.myUserId);
          onUndoStateChangeRef.current?.({
            canUndo: hasOwnStrokes,
            canRedo: (data.redoAvailable || 0) > 0,
          });
        }
        onLayerEventRef.current?.({ type:"init_layers", layers: data.layers||[], myUserId: data.myUserId });

        // ── FIX CLAVE (bug de "se pierde todo al refrescar") ──────────────
        // onLayerEventRef dispara setLayers() en App.tsx, pero React no
        // re-renderiza de forma síncrona: layersRef.current todavía tiene
        // el valor VIEJO (vacío, de antes del join) en este mismo tick.
        // redrawFull() de abajo llama a rebuildAllLayers(), que usa
        // layersRef.current para saber qué canvases de capa crear.
        // Si no actualizamos layersRef.current AQUÍ Y AHORA, rebuildAllLayers
        // no encuentra ninguna capa (o las capas equivocadas) y los strokes
        // que sí llegaron en strokesRef.current nunca se pintan en pantalla.
        layersRef.current = data.layers || [];

        const pending=imagesRef.current.filter(img=>!imgCache.has(img.id));
        if(pending.length===0){redrawFull();return;}
        let loaded=0;
        for(const img of pending){
          const el=new Image();
          el.onload=()=>{imgCache.set(img.id,el);if(++loaded===pending.length)redrawFull();};
          el.src=img.data;
        }
        return;
      }
      if(data.type==="pong") return;
      if(data.type==="users"){ setUsers?.(data.users||[]); return; }
      if(data.type==="stroke"){
        const s={...data.stroke, _sid: data.stroke._sid || genSid()} as Stroke;
        strokesRef.current.push(s);
        remotePreviewsRef.current.delete(data.userId||"");
        drawStroke(getLayerCtx(s.layerId??-1),s);
        requestFrame(); return;
      }
      if(data.type==="stroke_update"){
        const uid=data.userId||"unknown", existing=remotePreviewsRef.current.get(uid);
        if(existing) existing.points.push(...data.points);
        else remotePreviewsRef.current.set(uid,{
          points:[...data.points],color:data.color,size:data.size,
          opacity:data.opacity,eraser:data.eraser,brushType:data.brushType,layerId:data.layerId,
        });
        requestFrame(); return;
      }
      if(data.type==="clear"){
        strokesRef.current=[];remotePreviewsRef.current.clear();
        imagesRef.current=[];imgCache.clear();
        layerCtxRef.current.forEach(ctx=>ctx.clearRect(0,0,offW(),offH()));
        requestFrame(); return;
      }
      if(data.type==="bgcolor"){ onBgColor?.(data.color); return; }
      if(data.type==="canvas_resize"){
        onCanvasSizeFromServerRef.current?.({ w: data.w, h: data.h });
        return;
      }
      if(data.type==="reload_strokes"){
        strokesRef.current=(data.strokes||[]).map((s: Stroke) => s._sid ? s : {...s, _sid: genSid()});
        redrawFull(); return;
      }
      // REDISEÑO undo/redo autoritativo: el servidor manda exactamente qué
      // stroke quitar/restaurar (identificado por _sid), en vez de mandar
      // "todos mis strokes restantes". Esto es simple, ligero, e imposible
      // de desincronizar — no hay cálculo de "others vs mine" en el cliente.
      if(data.type==="stroke_removed"){
        strokesRef.current = strokesRef.current.filter((s: any) => s._sid !== data.sid);
        // Forzamos rafRef.current=null para garantizar que requestFrame()
        // SIEMPRE encole un nuevo frame, evitando la condición de carrera
        // con un frame en vuelo que dejaba la pantalla "atascada" sin
        // repintar hasta que ocurriera otro evento (como refrescar).
        rebuildAllLayers();
        rafRef.current = null;
        requestFrame();
        if (data.userId === myUserIdRef.current) {
          const hasOwnStrokes = strokesRef.current.some((s: any) => s._uid === myUserIdRef.current);
          onUndoStateChangeRef.current?.({ canUndo: hasOwnStrokes, canRedo: true });
        }
        return;
      }
      if(data.type==="stroke_restored"){
        const s = { ...data.stroke, _sid: data.stroke._sid || genSid() };
        strokesRef.current.push(s);
        rebuildAllLayers();
        rafRef.current = null;
        requestFrame();
        return;
      }
      if(data.type==="undo_state"){
        if (data.userId === myUserIdRef.current) {
          const hasOwnStrokes = strokesRef.current.some((s: any) => s._uid === myUserIdRef.current);
          onUndoStateChangeRef.current?.({ canUndo: hasOwnStrokes, canRedo: (data.redoAvailable || 0) > 0 });
        }
        return;
      }
      if(data.type==="layer_added"){ onLayerEventRef.current?.(data); getLayerCanvas(data.layer.id); requestFrame(); return; }
      if(data.type==="layer_update"){ onLayerEventRef.current?.(data); requestFrame(); return; }
      if(data.type==="layer_deleted"){ onLayerEventRef.current?.(data); requestFrame(); return; }
      if(data.type==="layer_reorder"){ onLayerEventRef.current?.(data); requestFrame(); return; }
      if(data.type==="image_added"){
        const img=data.image as CanvasImage;
        imagesRef.current=[...imagesRef.current,img];
        const el=new Image();
        el.onload=()=>{imgCache.set(img.id,el);rebuildAllLayers();requestFrame();};
        el.src=img.data; return;
      }
      if(data.type==="image_deleted"){
        imagesRef.current=imagesRef.current.filter(i=>i.id!==data.id);
        imgCache.delete(data.id); rebuildAllLayers(); requestFrame(); return;
      }
      if(data.type==="cursor"){
        cursorsRef.current.set(data.userId,{x:data.x,y:data.y,userId:data.username});
        requestFrame();
      }
    };

    connectWS();

    let lastPinchDist=0, lastPinchMid={x:0,y:0};
    const getPinchInfo=()=>{
      const pts=Array.from(touchPtrsRef.current.values());
      const dx=pts[1].x-pts[0].x,dy=pts[1].y-pts[0].y;
      return{dist:Math.sqrt(dx*dx+dy*dy),mid:{x:(pts[0].x+pts[1].x)/2,y:(pts[0].y+pts[1].y)/2}};
    };

    const startStroke=(pos:{x:number;y:number})=>{
      const lid = activeLayerRef.current;
      const layer = layersRef.current.find(l=>l.id===lid);
      if(!layer || layer.locked || !layer.visible) return;
      const world=toWorld(pos.x,pos.y);
      const cs=canvasSizeRef.current;
      if(cs&&(world.x<0||world.y<0||world.x>cs.w||world.y>cs.h))return;
      // FEATURE (estabilización): reiniciar el punto suavizado al inicio
      // de cada trazo nuevo, para que arranque exactamente donde el
      // usuario tocó/hizo clic (sin rezago inicial heredado de un trazo
      // anterior).
      smoothedPosRef.current = world;
      currentStrokeRef.current={
        _sid: genSid(),
        points:[world],color:colorRef.current,size:sizeRef.current,
        opacity:opacityRef.current,eraser:eraserRef.current,
        brushType:brushTypeRef.current,layerId:lid,
      };
      lastSentPtRef.current=0;lastSentMsRef.current=0;
    };

    const streamStroke=()=>{
      const stroke=currentStrokeRef.current;
      if(!stroke||wsRef.current?.readyState!==WebSocket.OPEN)return;
      const total=stroke.points.length,sent=lastSentPtRef.current,now=performance.now();
      if(total-sent>=STREAM_PTS&&now-lastSentMsRef.current>=STREAM_MS){
        wsRef.current.send(JSON.stringify({
          type:"stroke_update",color:stroke.color,size:stroke.size,
          opacity:stroke.opacity,eraser:stroke.eraser,brushType:stroke.brushType,
          layerId:stroke.layerId,points:stroke.points.slice(sent),
        }));
        lastSentPtRef.current=total;lastSentMsRef.current=now;
      }
    };

    const getPos=(e:PointerEvent)=>{
      const rect=canvas.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };

    const onViewportResize = () => {
      const dpr2 = window.devicePixelRatio || 1;
      const vp = (window as any).visualViewport;
      const vpW = vp ? vp.width : window.innerWidth;
      const vpH = vp ? vp.height : window.innerHeight;
      const cssW2 = vpW - 52 - 200;
      const cssH2 = vpH - 52;
      canvas.style.width = cssW2 + "px";
      canvas.style.height = cssH2 + "px";
      canvas.width = Math.round(cssW2 * dpr2);
      canvas.height = Math.round(cssH2 * dpr2);
      requestFrame();
    };
    if ((window as any).visualViewport) (window as any).visualViewport.addEventListener("resize", onViewportResize);

    // ── FIX PRINCIPAL: gestos táctiles con commit diferido ──────────────
    // Estrategia: con 1 dedo, NO empezamos a dibujar de inmediato.
    // Esperamos FREEZE_MS o un movimiento > DRAW_THRESHOLD_PX.
    // Si en ese tiempo aparece un 2º/3er dedo, es gesto (pinch/undo/redo), no dibujo.
    const clearPendingDrawTimer = () => {
      if (pendingDrawTimerRef.current) { clearTimeout(pendingDrawTimerRef.current); pendingDrawTimerRef.current = null; }
    };

    const commitDrawIfPending = (pos:{x:number;y:number}) => {
      const g = gestureRef.current;
      if (!g || g.drawCommitted) return;
      if (touchPtrsRef.current.size !== 1) return; // ya hay más dedos, no es dibujo
      g.drawCommitted = true;
      clearPendingDrawTimer();
      startStroke(pos);
    };

    const onPointerDown=(e:PointerEvent)=>{
      canvas.setPointerCapture(e.pointerId);
      const pos=getPos(e);

      if(e.pointerType==="pen"||e.pointerType==="mouse"){
        if(panModeRef.current){panStartRef.current={x:pos.x,y:pos.y,vx:viewRef.current.x,vy:viewRef.current.y};return;}
        startStroke(pos);return;
      }

      touchPtrsRef.current.set(e.pointerId,pos);
      const count=touchPtrsRef.current.size;

      if(count===1){
        clearPendingDrawTimer();
        gestureRef.current={
          time:performance.now(), maxFingers:1,
          fingerMoves:new Map([[e.pointerId,0]]),
          drawCommitted:false, firstPos:{...pos},
        };
        // Programar commit automático tras FREEZE_MS si nadie más toca
        pendingDrawTimerRef.current = setTimeout(() => {
          commitDrawIfPending(pos);
        }, FREEZE_MS);
        return;
      }

      // 2+ dedos: cancelar cualquier intento de dibujo pendiente
      clearPendingDrawTimer();
      currentStrokeRef.current=null;
      if(gestureRef.current){
        gestureRef.current.maxFingers=Math.max(gestureRef.current.maxFingers,count);
        gestureRef.current.fingerMoves.set(e.pointerId,0);
        gestureRef.current.drawCommitted = false; // ya no es dibujo, es gesto multi-dedo
      }
      if(count===2){const info=getPinchInfo();lastPinchDist=info.dist;lastPinchMid=info.mid;}
    };

    const onPointerMove=(e:PointerEvent)=>{
      const pos=getPos(e);

      if(e.pointerType==="pen"||e.pointerType==="mouse"){
        if(panModeRef.current&&panStartRef.current){
          viewRef.current={...viewRef.current,x:panStartRef.current.vx+(pos.x-panStartRef.current.x),y:panStartRef.current.vy+(pos.y-panStartRef.current.y)};
          requestFrame();return;
        }
        if(!currentStrokeRef.current)return;
        const rawWorld=toWorld(pos.x,pos.y);
        // FEATURE (estabilización): el punto que se agrega al trazo (y se
        // pinta/sincroniza) es el punto YA suavizado, no el crudo. El
        // cursor de red (cursor remoto que ven los demás) usa el punto
        // crudo, así su posición de "puntero" sigue siendo exacta — solo
        // la TINTA se suaviza, no la posición reportada del cursor.
        if(wsRef.current?.readyState===WebSocket.OPEN) wsRef.current.send(JSON.stringify({type:"cursor",x:rawWorld.x,y:rawWorld.y}));
        const world=applySmoothing(rawWorld);
        currentStrokeRef.current.points.push(world);
        // FEATURE (crosshair táctil): Apple Pencil reporta pointerType
        // "pen", no "touch" — este branch es distinto al de dedos puros
        // de más abajo, y antes nunca actualizaba crosshairPosRef, por lo
        // que la cruz se quedaba "congelada" o no aparecía al dibujar con
        // el lápiz. Solo lo activamos para "pen", no para "mouse" — con
        // mouse ya existe el cursor CSS "crosshair" nativo del navegador.
        if (e.pointerType === "pen") crosshairPosRef.current = pos;
        streamStroke();requestFrame();return;
      }

      const prev=touchPtrsRef.current.get(e.pointerId);
      if(prev&&gestureRef.current){
        const dx=pos.x-prev.x,dy=pos.y-prev.y;
        const dist=Math.sqrt(dx*dx+dy*dy);
        const cur=gestureRef.current.fingerMoves.get(e.pointerId)??0;
        gestureRef.current.fingerMoves.set(e.pointerId,cur+dist);
      }
      touchPtrsRef.current.set(e.pointerId,pos);

      // Si seguimos con 1 solo dedo y se mueve más del umbral, confirmar dibujo YA
      if(touchPtrsRef.current.size===1 && gestureRef.current && !gestureRef.current.drawCommitted){
        const g = gestureRef.current;
        const dx = pos.x - (g.firstPos?.x ?? pos.x);
        const dy = pos.y - (g.firstPos?.y ?? pos.y);
        if (Math.sqrt(dx*dx+dy*dy) > DRAW_THRESHOLD_PX) {
          commitDrawIfPending(pos);
        }
      }

      if(touchPtrsRef.current.size===2){
        clearPendingDrawTimer();
        const info=getPinchInfo(),v=viewRef.current;
        const sr=info.dist/lastPinchDist;
        const ns=Math.min(MAX_SCALE,Math.max(MIN_SCALE,v.scale*sr));
        viewRef.current={
          x:info.mid.x-(lastPinchMid.x-v.x)*(ns/v.scale)-(lastPinchMid.x-info.mid.x),
          y:info.mid.y-(lastPinchMid.y-v.y)*(ns/v.scale)-(lastPinchMid.y-info.mid.y),
          scale:ns,
        };
        lastPinchDist=info.dist;lastPinchMid=info.mid;redraw();return;
      }

      if(!currentStrokeRef.current)return;
      const rawWorld=toWorld(pos.x,pos.y);
      if(wsRef.current?.readyState===WebSocket.OPEN) wsRef.current.send(JSON.stringify({type:"cursor",x:rawWorld.x,y:rawWorld.y}));
      const world=applySmoothing(rawWorld);
      currentStrokeRef.current.points.push(world);
      // FEATURE (crosshair táctil): actualizar la posición en coordenadas
      // de pantalla (no de mundo) para que compositeNow lo dibuje en el
      // lugar correcto sin importar zoom/pan/flip actuales.
      crosshairPosRef.current = pos;
      streamStroke();requestFrame();
    };

    const finishStroke=()=>{
      if(!currentStrokeRef.current)return;
      const stroke=currentStrokeRef.current;
      currentStrokeRef.current=null;
      // FEATURE (estabilización): liberar el punto suavizado para que el
      // siguiente trazo arranque limpio en startStroke().
      smoothedPosRef.current = null;
      const markedStroke = {...stroke, _uid: myUserIdRef.current};
      strokesRef.current.push(markedStroke);
      drawStroke(getLayerCtx(stroke.layerId??-1),stroke);

      // FEATURE (capa Referencia): un trazo a mano dentro de una capa
      // marcada Referencia sigue el mismo principio que las imágenes
      // insertadas en ella — se pinta localmente (ya ocurrió arriba) pero
      // NUNCA se manda por WS. Sin esto, dibujar encima de una imagen de
      // referencia con el pincel normal sí se compartiría, contradiciendo
      // el propósito completo de la capa.
      const layer = layersRef.current.find(l => l.id === stroke.layerId);
      const isRef = !!layer?.isReference;

      if (!isRef && wsRef.current?.readyState===WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({type:"stroke",stroke}));
      }
      if(!stroke.eraser)onStrokeFinishedRef.current?.(stroke.color);
      // REDISEÑO undo/redo: ya no calculamos snapshots locales aquí. El
      // servidor es la única fuente de verdad — dibujar un trazo nuevo
      // simplemente invalida su redo stack server-side automáticamente
      // (ver handler "stroke" en index.ts). El cliente solo necesita saber
      // que ahora SÍ puede deshacer algo, lo cual se refleja al tener al
      // menos un stroke propio en strokesRef.current. Para trazos en una
      // capa Referencia no hay servidor que confirme nada, pero igual
      // reflejamos canUndo=true porque sí existe en strokesRef.current
      // local — Canvas no distingue origen al recorrer ese array para
      // undo/redo (ver más abajo, esto es solo el estado visual del botón).
      onUndoStateChangeRef.current?.({ canUndo: true, canRedo: false });
      requestFrame();
    };

    const onPointerUp=(e:PointerEvent)=>{
      if(e.pointerType==="pen"||e.pointerType==="mouse"){
        panStartRef.current=null;
        if(currentStrokeRef.current)finishStroke();
        return;
      }

      touchPtrsRef.current.delete(e.pointerId);

      if(touchPtrsRef.current.size===0){
        clearPendingDrawTimer();
        if(gestureRef.current){
          const{time,maxFingers,fingerMoves,drawCommitted}=gestureRef.current;
          const elapsed=performance.now()-time;
          gestureRef.current=null;

          // Si ya confirmamos que era dibujo, no evaluar gesto — solo terminar el trazo
          if (drawCommitted) {
            if(currentStrokeRef.current) finishStroke();
            return;
          }

          const maxMove=Math.max(0,...Array.from(fingerMoves.values()));
          if(elapsed<GESTURE_MS && maxMove<GESTURE_PX){
            if(maxFingers===2){ window.dispatchEvent(new CustomEvent("drawbot:undo")); return; }
            if(maxFingers===3){ window.dispatchEvent(new CustomEvent("drawbot:redo")); return; }
            // FEATURE: gesto de 4 dedos voltea el lienzo horizontalmente
            // (vista local). Se dispara como evento — igual que undo/redo
            // — para que App.tsx pueda mantener sincronizado el estado
            // visual del botón de Toolbar con el flip real.
            if(maxFingers===4){ window.dispatchEvent(new CustomEvent("drawbot:flipx")); return; }
          }
        }
      }

      if(currentStrokeRef.current&&touchPtrsRef.current.size===0){
        finishStroke();
        crosshairPosRef.current = null;
        requestFrame();
      }
    };

    const onPointerCancel=(e:PointerEvent)=>{
      touchPtrsRef.current.delete(e.pointerId);
      if(touchPtrsRef.current.size===0){
        clearPendingDrawTimer();
        currentStrokeRef.current=null;
        gestureRef.current=null;
        crosshairPosRef.current=null;
        smoothedPosRef.current=null;
      }
    };

    const onWheel=(e:WheelEvent)=>{
      e.preventDefault();
      const rect=canvas.getBoundingClientRect();
      const mx=e.clientX-rect.left, my=e.clientY-rect.top, v=viewRef.current;
      const delta=e.deltaY<0?1.12:0.9;
      const ns=Math.min(MAX_SCALE,Math.max(MIN_SCALE,v.scale*delta));
      viewRef.current={x:mx-(mx-v.x)*(ns/v.scale),y:my-(my-v.y)*(ns/v.scale),scale:ns};
      redraw();
    };

    canvas.addEventListener("pointerdown",  onPointerDown);
    canvas.addEventListener("pointermove",  onPointerMove);
    canvas.addEventListener("pointerup",    onPointerUp);
    canvas.addEventListener("pointercancel",onPointerCancel);
    canvas.addEventListener("wheel",        onWheel,{passive:false});

    const savePNG=()=>{
      const cs=canvasSizeRef.current;
      const ec=document.createElement("canvas");
      ec.width=cs?cs.w:DEFAULT_W; ec.height=cs?cs.h:DEFAULT_H;
      const ectx=ec.getContext("2d")!;
      ectx.fillStyle=bgColorRef.current; ectx.fillRect(0,0,ec.width,ec.height);
      for(const img of imagesRef.current){
        const el=getCachedImage(img);
        if(el)ectx.drawImage(el,img.x,img.y,img.w,img.h);
      }
      layersRef.current.forEach(layer=>{
        if(!layer.visible)return;
        const lc=layerOffscrRef.current.get(layer.id);if(!lc)return;
        ectx.save();ectx.globalAlpha=layer.opacity;ectx.drawImage(lc,0,0);ectx.restore();
      });
      const link=document.createElement("a");
      link.download=`peonypaint-${Date.now()}.png`;
      link.href=ec.toDataURL("image/png");link.click();
    };

    // FEATURE: uploadImage reescrita — antes insertaba la imagen como un
    // CanvasImage global de la sala (flotando sobre todas las capas, sin
    // pertenecer a ninguna). Ahora se inserta DENTRO de la capa activa,
    // usando el patrón fillImage: se crea un Stroke especial (points:[],
    // fillImage:{...}) que se pinta en el offscreen de esa capa y se
    // intenta sincronizar exactamente como cualquier otro stroke — con una
    // excepción: si la capa activa es Referencia, el stroke se queda
    // 100% local (nunca se manda por WS), igual que cualquier trazo
    // dibujado a mano dentro de una capa Referencia.
    const uploadImage=(file:File)=>{
      const reader=new FileReader();
      reader.onload=(ev)=>{
        const original=ev.target?.result as string;
        const img=new Image();
        img.onload=()=>{
          const lid = activeLayerRef.current;
          const layer = layersRef.current.find(l=>l.id===lid);
          if(!layer || layer.locked) return;

          const maxSide=2048;
          let srcW=img.width, srcH=img.height;
          let w=srcW, h=srcH;
          if(w>maxSide||h>maxSide){const r=Math.min(maxSide/w,maxSide/h);w=Math.round(w*r);h=Math.round(h*r);}
          const tmp=document.createElement("canvas");tmp.width=w;tmp.height=h;
          tmp.getContext("2d")!.drawImage(img,0,0,w,h);
          const compressed=tmp.toDataURL("image/jpeg",0.85);

          // Tamaño de destino en el lienzo: igual lógica que antes (ancho
          // máximo de 800 unidades de mundo, alto proporcional), centrado
          // en el centro de la vista actual.
          const v=viewRef.current;
          const cx=(canvas.clientWidth/2-v.x)/v.scale;
          const cy=(canvas.clientHeight/2-v.y)/v.scale;
          const dstW=Math.min(w,800), dstH=Math.round(h*(dstW/w));
          const offsetX=cx-dstW/2, offsetY=cy-dstH/2;

          const stroke: Stroke = {
            _sid: genSid(),
            points: [],
            color: "#000000", size: 0, opacity: 1, eraser: false,
            layerId: lid,
            fillImage: { data: compressed, srcW, srcH, dstW, dstH, offsetX, offsetY },
          };

          // Pintar localmente de inmediato — idéntico tanto si la capa es
          // Referencia como si no. La diferencia está en lo que pasa
          // DESPUÉS de pintarlo: si se comparte o se queda solo aquí.
          const markedStroke = { ...stroke, _uid: myUserIdRef.current };
          strokesRef.current.push(markedStroke);
          drawStroke(getLayerCtx(lid), stroke);
          requestFrame();

          if (layer.isReference) {
            // FEATURE (capa Referencia): nunca sale del navegador. No hay
            // mensaje WS, no hay entrada en el undo autoritativo del
            // servidor — exactamente como pide el contexto del proyecto
            // ("ni siquiera la existencia de la capa" sale de aquí, y
            // por extensión, nada de su contenido tampoco).
            return;
          }

          if(wsRef.current?.readyState===WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({type:"stroke", stroke}));
          }
          onUndoStateChangeRef.current?.({ canUndo: true, canRedo: false });
        };
        img.src=original;
      };
      reader.readAsDataURL(file);
    };

    onReady?.(savePNG,uploadImage);

    const onResize = () => {
      const dpr2 = window.devicePixelRatio || 1;
      const cssW2 = window.innerWidth - 52 - 200;
      const cssH2 = window.innerHeight - 52;
      canvas.style.width = cssW2 + "px";
      canvas.style.height = cssH2 + "px";
      canvas.width = Math.round(cssW2 * dpr2);
      canvas.height = Math.round(cssH2 * dpr2);
      requestFrame();
    };
    window.addEventListener("resize", onResize);

    return ()=>{
      if(rafRef.current)cancelAnimationFrame(rafRef.current);
      clearPendingDrawTimer();
      canvas.removeEventListener("pointerdown",  onPointerDown);
      canvas.removeEventListener("pointermove",  onPointerMove);
      canvas.removeEventListener("pointerup",    onPointerUp);
      canvas.removeEventListener("pointercancel",onPointerCancel);
      canvas.removeEventListener("wheel",        onWheel);
      window.removeEventListener("resize", onResize);
      if ((window as any).visualViewport) (window as any).visualViewport.removeEventListener("resize", onViewportResize);
      intentionalClose = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (pingInterval) clearInterval(pingInterval);
      wsRef.current?.close();
    };
  },[]);

  (Canvas as any)._mergeLayers = (bottomId: number, topId: number) => {
    const bottomLc = layerOffscrRef.current.get(bottomId);
    const topLc = layerOffscrRef.current.get(topId);
    if (!bottomLc || !topLc) return;
    const topLayer = layersRef.current.find(l => l.id === topId);
    const blendMode = getBlendCSS(topLayer?.blendMode);
    const topOpacity = topLayer?.opacity ?? 1;
    const merged = document.createElement("canvas");
    merged.width = offW(); merged.height = offH();
    const mCtx = merged.getContext("2d")!;
    mCtx.drawImage(bottomLc, 0, 0);
    mCtx.save(); mCtx.globalCompositeOperation = blendMode; mCtx.globalAlpha = topOpacity;
    mCtx.drawImage(topLc, 0, 0); mCtx.restore();
    const bottomCtx = getLayerCtx(bottomId);
    bottomCtx.clearRect(0, 0, offW(), offH());
    bottomCtx.drawImage(merged, 0, 0);
    getLayerCtx(topId).clearRect(0, 0, offW(), offH());
    requestFrame();
  };
  (Canvas as any)._setLayerOpacityLive = (layerId: number, opacity: number) => {
    const layer = layersRef.current.find(l => l.id === layerId);
    if (layer) layer.opacity = opacity;
    requestFrame();
  };
  (Canvas as any)._rename = (name: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) wsRef.current.send(JSON.stringify({type:"rename", username: name}));
  };
  (Canvas as any)._sendBgColor = (color:string) => {
    if(wsRef.current?.readyState===WebSocket.OPEN) wsRef.current.send(JSON.stringify({type:"bgcolor",color}));
  };
  (Canvas as any)._sendWS = (msg: object) => {
    if(wsRef.current?.readyState===WebSocket.OPEN) wsRef.current.send(JSON.stringify(msg));
  };
  // REDISEÑO undo/redo autoritativo: el cliente solo pide la acción, sin
  // calcular ni mandar ningún dato. sendReliable garantiza que el mensaje
  // llegue incluso si el WS está momentáneamente reconectando.
  // NOTA (capa Referencia): undo/redo es autoritativo en SERVIDOR, y los
  // strokes de una capa Referencia nunca llegaron al servidor (ver handler
  // "stroke" en index.ts). Esto significa, por diseño, que deshacer/rehacer
  // NUNCA afecta a lo que dibujaste/insertaste dentro de una capa
  // Referencia — el botón de undo seguirá afectando tu último trazo
  // SINCRONIZADO (de una capa normal), saltándose por completo cualquier
  // trazo de referencia más reciente. Coincide con lo documentado: la capa
  // Referencia no tiene su propio historial de undo/redo, para evitar
  // reintroducir un segundo sistema de historial en paralelo al del server.
  (Canvas as any)._sendUndo = () => {
    sendReliable(() => wsRef.current, { type: "undo" });
  };
  (Canvas as any)._sendRedo = () => {
    sendReliable(() => wsRef.current, { type: "redo" });
  };
  // FEATURE: voltear lienzo — solo vista local, sin WS ni persistencia.
  (Canvas as any)._toggleFlipX = () => {
    flipXRef.current = !flipXRef.current;
    requestFrame();
    return flipXRef.current;
  };
  (Canvas as any)._isFlippedX = () => flipXRef.current;
  // FEATURE: configuración del crosshair desde el panel de Ajustes —
  // forma (círculo/cruz/punto), tamaño en pixeles, y si está habilitado.
  (Canvas as any)._setCrosshairConfig = (cfg: { shape?: "circle"|"cross"|"dot"; size?: number; enabled?: boolean }) => {
    crosshairRef.current = { ...crosshairRef.current, ...cfg };
    requestFrame();
  };
  (Canvas as any)._getCrosshairConfig = () => crosshairRef.current;
  // FEATURE: estabilización de trazo — setter/getter expuestos con el
  // mismo patrón que el crosshair, para que App.tsx pueda aplicar el valor
  // guardado en localStorage tan pronto como Canvas esté montado, y para
  // que Toolbar pueda leer el valor actual si lo necesita.
  (Canvas as any)._setSmoothing = (value: number) => {
    smoothingRef.current = Math.max(0, Math.min(100, value));
  };
  (Canvas as any)._getSmoothing = () => smoothingRef.current;

  return (
    <canvas
      ref={canvasRef}
      style={{
        position:"fixed", top:52, left:52, display:"block",
        cursor:panMode?"grab":"crosshair",
        touchAction:"none", WebkitUserSelect:"none", userSelect:"none",
        // @ts-ignore
        WebkitTouchCallout:"none",
      }}
    />
  );
}