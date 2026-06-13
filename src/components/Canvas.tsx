import { useEffect, useRef } from "react";

type Point = { x: number; y: number };

export type BrushType =
  | "pen"
  | "caligraphy1"
  | "caligraphy2"
  | "airbrush"
  | "oil"
  | "crayon"
  | "marker"
  | "pencil"
  | "watercolor";

type Stroke = {
  points: Point[];
  color: string;
  size: number;
  opacity: number;
  eraser: boolean;
  brushType?: BrushType;
};
type Cursor = { x: number; y: number; userId: string };

type Props = {
  color: string;
  brushSize: number;
  opacity: number;
  eraser: boolean;
  brushType: BrushType;
  username: string;
  bgColor: string;
  setUsers?: (users: string[]) => void;
  onReady?: (saveFn: () => void) => void;
  onBgColor?: (color: string) => void;
};

function hexRgb(hex: string) {
  const c = hex.replace("#", "");
  return {
    r: parseInt(c.slice(0, 2), 16),
    g: parseInt(c.slice(2, 4), 16),
    b: parseInt(c.slice(4, 6), 16),
  };
}

function prng(seed: number) {
  let s = (seed ^ 0xdeadbeef) >>> 0;
  s = Math.imul(s ^ (s >>> 16), 0x45d9f3b) >>> 0;
  s = Math.imul(s ^ (s >>> 16), 0x45d9f3b) >>> 0;
  return (s >>> 0) / 0xffffffff;
}

export default function Canvas({
  color, brushSize, opacity, eraser, brushType, username,
  bgColor, setUsers, onReady, onBgColor,
}: Props) {
  const canvasRef        = useRef<HTMLCanvasElement>(null);
  const offscreenRef     = useRef<HTMLCanvasElement | null>(null);
  const wsRef            = useRef<WebSocket | null>(null);
  const cursorsRef       = useRef<Map<string, Cursor>>(new Map());
  const strokesRef       = useRef<Stroke[]>([]);
  const currentStrokeRef = useRef<Stroke | null>(null);
  const offscreenCountRef = useRef(0);

  // RAF: pendiente de dibujar
  const rafRef           = useRef<number | null>(null);
  const dirtyRef         = useRef(false);

  const colorRef     = useRef(color);
  const sizeRef      = useRef(brushSize);
  const opacityRef   = useRef(opacity);
  const eraserRef    = useRef(eraser);
  const brushTypeRef = useRef(brushType);
  const bgColorRef   = useRef(bgColor);
  const viewRef      = useRef({ x: 0, y: 0, scale: 1 });
  const touchPointersRef = useRef<Map<number, {x:number;y:number}>>(new Map());

  colorRef.current     = color;
  sizeRef.current      = brushSize;
  opacityRef.current   = opacity;
  eraserRef.current    = eraser;
  brushTypeRef.current = brushType;
  bgColorRef.current   = bgColor;

  const MIN_SCALE = 0.25;
  const MAX_SCALE = 8;

  const toWorld = (sx: number, sy: number) => {
    const v = viewRef.current;
    return { x: (sx - v.x) / v.scale, y: (sy - v.y) / v.scale };
  };

  // ─── Motor de pinceles ────────────────────────────────────────────────────
  // Dibuja SOLO los puntos desde `fromIndex` en adelante (incremental)
  const drawStrokeFrom = (
    ctx: CanvasRenderingContext2D,
    stroke: Stroke,
    fromIndex: number
  ) => {
    const pts = stroke.points;
    if (pts.length < 1) return;
    const bt = stroke.brushType ?? "pen";
    const col = stroke.color;
    const sz  = stroke.size;
    const { r, g, b } = hexRgb(col);
    const erasing = stroke.eraser;

    ctx.save();
    if (erasing) {
      ctx.globalCompositeOperation = "destination-out";
      ctx.globalAlpha = 1;
    } else {
      ctx.globalCompositeOperation = "source-over";
    }

    // Para pinceles de línea: necesitamos un punto anterior para conectar
    const start = Math.max(fromIndex === 0 ? 0 : fromIndex - 1, 0);

    // ── Helper stamp ─────────────────────────────────────────────────────────
    const makeStamp = (dim: number, paint: (sc: CanvasRenderingContext2D) => void) => {
      const s = document.createElement("canvas");
      s.width = s.height = dim;
      paint(s.getContext("2d")!);
      return s;
    };

    if (bt === "pen") {
      if (pts.length < 2) { ctx.restore(); return; }
      ctx.globalAlpha = stroke.opacity;
      ctx.lineCap = "round"; ctx.lineJoin = "round";
      ctx.lineWidth = sz;
      ctx.strokeStyle = erasing ? "#000" : col;
      ctx.beginPath();
      ctx.moveTo(pts[start].x, pts[start].y);
      for (let i = start + 1; i < pts.length; i++)
        ctx.lineTo(pts[i].x, pts[i].y);
      ctx.stroke();

    } else if (bt === "caligraphy1" || bt === "caligraphy2") {
      if (pts.length < 2) { ctx.restore(); return; }
      ctx.globalAlpha = stroke.opacity;
      const angle = bt === "caligraphy1" ? Math.PI * 0.75 : Math.PI * 0.25;
      const w = sz, h = Math.max(1, sz * 0.18);
      const dim = Math.ceil(Math.sqrt(w*w + h*h)) + 4;
      const half = dim / 2;
      const stamp = makeStamp(dim, sc => {
        sc.fillStyle = erasing ? "#000" : col;
        sc.translate(half, half);
        sc.rotate(angle);
        sc.fillRect(-w/2, -h/2, w, h);
      });
      for (let i = Math.max(start, 1); i < pts.length; i++) {
        const a = pts[i-1], bPt = pts[i];
        ctx.drawImage(stamp, (a.x+bPt.x)/2 - half, (a.y+bPt.y)/2 - half);
      }

    } else if (bt === "airbrush") {
      // Stamp: disco de puntos pre-renderizado, luego drawImage rotado por punto
      const density = Math.max(8, Math.floor(sz * 2));
      const radius  = sz * 1.8;
      const dim = Math.ceil(radius * 2) + 4;
      const half = dim / 2;
      const stamp = makeStamp(dim, sc => {
        sc.fillStyle = erasing ? `rgba(0,0,0,${stroke.opacity * 0.22})`
                                : `rgba(${r},${g},${b},${stroke.opacity * 0.22})`;
        for (let i = 0; i < density; i++) {
          const ang = prng(i*6271) * Math.PI * 2;
          const rad = Math.sqrt(prng(i*7919)) * radius;
          sc.beginPath();
          sc.arc(half + Math.cos(ang)*rad, half + Math.sin(ang)*rad, 0.7, 0, Math.PI*2);
          sc.fill();
        }
      });
      for (let p = start; p < pts.length; p++) {
        const pt = pts[p];
        const ang = prng(p * 9973) * Math.PI * 2;
        ctx.save();
        ctx.translate(pt.x, pt.y);
        ctx.rotate(ang);
        ctx.drawImage(stamp, -half, -half);
        ctx.restore();
      }

    } else if (bt === "oil") {
      if (pts.length < 2) { ctx.restore(); return; }
      const bristles = Math.max(4, Math.floor(sz * 0.6));
      ctx.lineCap = "round"; ctx.lineJoin = "round";
      ctx.lineWidth = Math.max(0.8, sz * 0.12);
      for (let b2 = 0; b2 < bristles; b2++) {
        ctx.globalAlpha = stroke.opacity * (0.55 + prng(b2*3571)*0.45);
        const dr = Math.min(255, r + Math.floor(prng(b2*13)*30 - 15));
        const dg = Math.min(255, g + Math.floor(prng(b2*17)*30 - 15));
        const db2 = Math.min(255, b + Math.floor(prng(b2*19)*30 - 15));
        ctx.strokeStyle = erasing ? "#000" : `rgb(${dr},${dg},${db2})`;
        const t = bristles > 1 ? b2/(bristles-1) - 0.5 : 0;
        ctx.beginPath();
        let moved = false;
        for (let i = start; i < pts.length; i++) {
          const pt = pts[i];
          let dx = 0, dy = 1;
          if (i > 0) {
            dx = pt.x - pts[i-1].x; dy = pt.y - pts[i-1].y;
            const len = Math.sqrt(dx*dx + dy*dy) || 1; dx /= len; dy /= len;
          }
          const px = -dy*t*sz + prng(b2*1009+i*503)*sz*0.06;
          const py =  dx*t*sz + prng(b2*2003+i*701)*sz*0.06;
          if (!moved) { ctx.moveTo(pt.x+px, pt.y+py); moved = true; }
          else          ctx.lineTo(pt.x+px, pt.y+py);
        }
        ctx.stroke();
      }

    } else if (bt === "crayon") {
      if (pts.length < 2) { ctx.restore(); return; }
      const grain = Math.max(3, Math.floor(sz * 0.5));
      ctx.lineCap = "round"; ctx.lineJoin = "round";
      for (let g2 = 0; g2 < grain; g2++) {
        const offX = (prng(g2*4001) - 0.5) * sz * 0.85;
        const offY = (prng(g2*5003) - 0.5) * sz * 0.85;
        ctx.globalAlpha = (0.12 + prng(g2*7001)*0.3) * stroke.opacity;
        ctx.strokeStyle = erasing ? "#000" : col;
        ctx.lineWidth = Math.max(0.4, sz*0.08 + prng(g2*3007)*sz*0.07);
        ctx.beginPath();
        ctx.moveTo(pts[start].x + offX, pts[start].y + offY);
        for (let i = start + 1; i < pts.length; i++) {
          const jx = offX + (prng(g2*1009+i*503) - 0.5) * sz * 0.12;
          const jy = offY + (prng(g2*2003+i*701) - 0.5) * sz * 0.12;
          ctx.lineTo(pts[i].x + jx, pts[i].y + jy);
        }
        ctx.stroke();
      }

    } else if (bt === "marker") {
      if (pts.length < 2) { ctx.restore(); return; }
      ctx.globalAlpha = Math.min(1, stroke.opacity*1.1);
      ctx.strokeStyle = erasing ? "#000" : col;
      ctx.lineWidth = sz; ctx.lineCap="square"; ctx.lineJoin="miter";
      ctx.beginPath();
      ctx.moveTo(pts[start].x, pts[start].y);
      for (let i=start+1; i<pts.length; i++)
        ctx.lineTo(pts[i].x, pts[i].y);
      ctx.stroke();

    } else if (bt === "pencil") {
      if (pts.length < 2) { ctx.restore(); return; }
      const lines = Math.max(2, Math.floor(sz * 0.4));
      ctx.lineCap = "round";
      for (let l = 0; l < lines; l++) {
        const offX = (prng(l*2017) - 0.5) * sz * 0.65;
        const offY = (prng(l*3019) - 0.5) * sz * 0.65;
        ctx.globalAlpha = (0.07 + prng(l*9001)*0.15) * stroke.opacity;
        ctx.strokeStyle = erasing ? "#000" : col;
        ctx.lineWidth = 0.4 + prng(l*4001) * 0.5;
        ctx.beginPath();
        ctx.moveTo(pts[start].x + offX, pts[start].y + offY);
        for (let i = start + 1; i < pts.length; i++)
          ctx.lineTo(pts[i].x + offX, pts[i].y + offY);
        ctx.stroke();
      }

    } else if (bt === "watercolor") {
      // Stamp pre-renderizado: un solo gradiente radial en canvas pequeño,
      // luego drawImage por cada punto → sin createRadialGradient en el loop
      const passes = [
        { spread: sz * 0.9,  alpha: stroke.opacity * 0.13 },
        { spread: sz * 1.15, alpha: stroke.opacity * 0.09 },
        { spread: sz * 1.45, alpha: stroke.opacity * 0.06 },
      ];

      for (let pi = 0; pi < passes.length; pi++) {
        const { spread, alpha } = passes[pi];
        const dim = Math.ceil(spread * 2) + 2;

        // Crear stamp una sola vez por pass
        const stamp = document.createElement("canvas");
        stamp.width = stamp.height = dim;
        const sc = stamp.getContext("2d")!;
        const cx = dim / 2, cy = dim / 2;
        const grad = sc.createRadialGradient(cx, cy, 0, cx, cy, spread);
        if (erasing) {
          grad.addColorStop(0,   "rgba(0,0,0,0.9)");
          grad.addColorStop(0.5, "rgba(0,0,0,0.3)");
          grad.addColorStop(1,   "rgba(0,0,0,0)");
        } else {
          grad.addColorStop(0,   `rgba(${r},${g},${b},1)`);
          grad.addColorStop(0.45,`rgba(${r},${g},${b},0.35)`);
          grad.addColorStop(1,   `rgba(${r},${g},${b},0)`);
        }
        sc.fillStyle = grad;
        sc.fillRect(0, 0, dim, dim);

        ctx.globalAlpha = alpha;
        for (let p = start; p < pts.length; p++) {
          const pt = pts[p];
          // Pequeño jitter reproducible para efecto aguado
          const jx = (prng(pi*9901 + p*7)  - 0.5) * sz * 0.28;
          const jy = (prng(pi*8803 + p*11) - 0.5) * sz * 0.28;
          ctx.drawImage(stamp, pt.x + jx - cx, pt.y + jy - cy);
        }
      }
    }
    ctx.restore();
  };

  // Dibujo completo del stroke (para flush a offscreen)
  const drawStroke = (ctx: CanvasRenderingContext2D, stroke: Stroke) =>
    drawStrokeFrom(ctx, stroke, 0);

  // ─── Offscreen ────────────────────────────────────────────────────────────
  const getOffCtx = () => {
    const off = offscreenRef.current;
    if (!off) return null;
    return off.getContext("2d");
  };

  const offTransform = (ctx: CanvasRenderingContext2D) => {
    const dpr = window.devicePixelRatio || 1;
    const v = viewRef.current;
    ctx.scale(dpr, dpr);
    ctx.translate(v.x, v.y);
    ctx.scale(v.scale, v.scale);
  };

  const flushToOffscreen = () => {
    const ctx = getOffCtx(); if (!ctx) return;
    const strokes = strokesRef.current;
    ctx.save(); offTransform(ctx);
    for (let i = offscreenCountRef.current; i < strokes.length; i++)
      drawStroke(ctx, strokes[i]);
    offscreenCountRef.current = strokes.length;
    ctx.restore();
  };

  const rebuildOffscreen = () => {
    const off = offscreenRef.current; if (!off) return;
    const ctx = off.getContext("2d"); if (!ctx) return;
    ctx.save();
    ctx.setTransform(1,0,0,1,0,0);
    ctx.clearRect(0, 0, off.width, off.height);
    ctx.fillStyle = bgColorRef.current;
    ctx.fillRect(0, 0, off.width, off.height);
    ctx.restore();
    ctx.save(); offTransform(ctx);
    strokesRef.current.forEach(s => drawStroke(ctx, s));
    ctx.restore();
    offscreenCountRef.current = strokesRef.current.length;
  };

  // ─── Composite (display) — se llama solo desde RAF ────────────────────────
  const compositeNow = () => {
    const canvas = canvasRef.current;
    const off = offscreenRef.current;
    if (!canvas || !off) return;
    const ctx = canvas.getContext("2d"); if (!ctx) return;

    ctx.save();
    ctx.setTransform(1,0,0,1,0,0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(off, 0, 0);
    ctx.restore();

    if (currentStrokeRef.current) {
      const dpr = window.devicePixelRatio || 1;
      const v = viewRef.current;
      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.translate(v.x, v.y);
      ctx.scale(v.scale, v.scale);
      drawStroke(ctx, currentStrokeRef.current);
      ctx.restore();
    }

    const v = viewRef.current;
    const dpr = window.devicePixelRatio || 1;
    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.translate(v.x, v.y);
    ctx.scale(v.scale, v.scale);
    cursorsRef.current.forEach((cursor) => {
      ctx.beginPath();
      ctx.fillStyle = "#00ff88";
      ctx.arc(cursor.x, cursor.y, 6/v.scale, 0, Math.PI*2);
      ctx.fill();
      ctx.fillStyle = "white";
      ctx.font = `${12/v.scale}px Arial`;
      ctx.fillText(cursor.userId, cursor.x+10/v.scale, cursor.y-10/v.scale);
    });
    ctx.restore();

    dirtyRef.current = false;
    rafRef.current = null;
  };

  // Solicitar un frame — coalesce múltiples eventos en uno solo
  const requestFrame = () => {
    if (rafRef.current !== null) return; // ya hay uno pendiente
    dirtyRef.current = true;
    rafRef.current = requestAnimationFrame(compositeNow);
  };

  const redraw = () => { rebuildOffscreen(); requestFrame(); };

  useEffect(() => { redraw(); }, [bgColor]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const dpr = window.devicePixelRatio || 1;
    const W = window.innerWidth * dpr;
    const H = window.innerHeight * dpr;
    canvas.width = W; canvas.height = H;
    canvas.style.width  = window.innerWidth  + "px";
    canvas.style.height = window.innerHeight + "px";

    const off = document.createElement("canvas");
    off.width = W; off.height = H;
    offscreenRef.current = off;
    const offCtx = off.getContext("2d")!;
    offCtx.fillStyle = bgColorRef.current;
    offCtx.fillRect(0, 0, W, H);

    const room = new URLSearchParams(window.location.search).get("room") || "default";
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = import.meta.env.VITE_WS_URL || `${protocol}//${window.location.host}`;
    wsRef.current = new WebSocket(wsUrl);

    wsRef.current.onopen = () => {
      wsRef.current?.send(JSON.stringify({ type:"join", room, username }));
    };

    wsRef.current.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === "init") {
        strokesRef.current = data.strokes || [];
        offscreenCountRef.current = 0;
        if (data.bgColor) onBgColor?.(data.bgColor);
        redraw(); return;
      }
      if (data.type === "users")  { setUsers?.(data.users||[]); return; }
      if (data.type === "stroke") {
        strokesRef.current.push(data.stroke);
        flushToOffscreen();
        requestFrame();
        return;
      }
      if (data.type === "clear") {
        strokesRef.current = [];
        offscreenCountRef.current = 0;
        rebuildOffscreen();
        requestFrame();
        return;
      }
      if (data.type === "bgcolor") { onBgColor?.(data.color); return; }
      if (data.type === "cursor") {
        cursorsRef.current.set(data.userId, { x:data.x, y:data.y, userId:data.username });
        requestFrame();
      }
    };

    let lastPinchDist = 0;
    let lastPinchMid  = { x:0, y:0 };

    const getPinchInfo = () => {
      const pts = Array.from(touchPointersRef.current.values());
      const dx = pts[1].x-pts[0].x, dy = pts[1].y-pts[0].y;
      return { dist:Math.sqrt(dx*dx+dy*dy), mid:{x:(pts[0].x+pts[1].x)/2,y:(pts[0].y+pts[1].y)/2} };
    };

    const startStroke = (pos:{x:number;y:number}) => {
      const world = toWorld(pos.x, pos.y);
      currentStrokeRef.current = {
        points:[world], color:colorRef.current, size:sizeRef.current,
        opacity:opacityRef.current, eraser:eraserRef.current, brushType:brushTypeRef.current,
      };
    };

    const onPointerDown = (e: PointerEvent) => {
      canvas.setPointerCapture(e.pointerId);
      const rect = canvas.getBoundingClientRect();
      const pos = { x:e.clientX-rect.left, y:e.clientY-rect.top };
      if (e.pointerType==="pen"||e.pointerType==="mouse") { startStroke(pos); return; }
      touchPointersRef.current.set(e.pointerId, pos);
      if (touchPointersRef.current.size===2) {
        currentStrokeRef.current=null;
        const info=getPinchInfo(); lastPinchDist=info.dist; lastPinchMid=info.mid; return;
      }
      if (touchPointersRef.current.size===1) startStroke(pos);
    };

    const onPointerMove = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      const pos = { x:e.clientX-rect.left, y:e.clientY-rect.top };

      if (e.pointerType==="pen"||e.pointerType==="mouse") {
        if (!currentStrokeRef.current) return;
        const world = toWorld(pos.x, pos.y);
        if (wsRef.current?.readyState===WebSocket.OPEN)
          wsRef.current.send(JSON.stringify({type:"cursor",x:world.x,y:world.y}));
        currentStrokeRef.current.points.push(world);
        requestFrame(); // ← solo pide frame, no dibuja ahora
        return;
      }

      touchPointersRef.current.set(e.pointerId, pos);
      if (touchPointersRef.current.size===2) {
        const info=getPinchInfo();
        const v=viewRef.current;
        const sr=info.dist/lastPinchDist;
        const ns=Math.min(MAX_SCALE,Math.max(MIN_SCALE,v.scale*sr));
        viewRef.current={
          x:info.mid.x-(lastPinchMid.x-v.x)*(ns/v.scale)-(lastPinchMid.x-info.mid.x),
          y:info.mid.y-(lastPinchMid.y-v.y)*(ns/v.scale)-(lastPinchMid.y-info.mid.y),
          scale:ns,
        };
        lastPinchDist=info.dist; lastPinchMid=info.mid;
        redraw(); return;
      }

      if (!currentStrokeRef.current) return;
      const world=toWorld(pos.x,pos.y);
      if (wsRef.current?.readyState===WebSocket.OPEN)
        wsRef.current.send(JSON.stringify({type:"cursor",x:world.x,y:world.y}));
      currentStrokeRef.current.points.push(world);
      requestFrame();
    };

    const finishStroke = () => {
      if (!currentStrokeRef.current) return;
      const stroke = currentStrokeRef.current;
      strokesRef.current.push(stroke);
      flushToOffscreen();
      currentStrokeRef.current = null;
      if (wsRef.current?.readyState===WebSocket.OPEN)
        wsRef.current.send(JSON.stringify({type:"stroke",stroke}));
      requestFrame();
    };

    const onPointerUp = (e: PointerEvent) => {
      if (e.pointerType==="touch") touchPointersRef.current.delete(e.pointerId);
      if (currentStrokeRef.current && touchPointersRef.current.size===0) finishStroke();
      if ((e.pointerType==="pen"||e.pointerType==="mouse") && currentStrokeRef.current) finishStroke();
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect=canvas.getBoundingClientRect();
      const mx=e.clientX-rect.left, my=e.clientY-rect.top;
      const v=viewRef.current;
      const delta=e.deltaY<0?1.12:0.9;
      const ns=Math.min(MAX_SCALE,Math.max(MIN_SCALE,v.scale*delta));
      viewRef.current={ x:mx-(mx-v.x)*(ns/v.scale), y:my-(my-v.y)*(ns/v.scale), scale:ns };
      redraw();
    };

    canvas.addEventListener("pointerdown",   onPointerDown);
    canvas.addEventListener("pointermove",   onPointerMove);
    canvas.addEventListener("pointerup",     onPointerUp);
    canvas.addEventListener("pointercancel", onPointerUp);
    canvas.addEventListener("wheel", onWheel, { passive:false });

    const savePNG = () => {
      const saved={...viewRef.current};
      viewRef.current={x:0,y:0,scale:1};
      rebuildOffscreen();
      const link=document.createElement("a");
      link.download=`drawbot-${Date.now()}.png`;
      link.href=(offscreenRef.current as HTMLCanvasElement).toDataURL("image/png");
      link.click();
      viewRef.current=saved;
      redraw();
    };
    onReady?.(savePNG);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      wsRef.current?.close();
      canvas.removeEventListener("pointerdown",   onPointerDown);
      canvas.removeEventListener("pointermove",   onPointerMove);
      canvas.removeEventListener("pointerup",     onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerUp);
      canvas.removeEventListener("wheel", onWheel);
    };
  }, []);

  (Canvas as any)._sendBgColor = (color: string) => {
    if (wsRef.current?.readyState===WebSocket.OPEN)
      wsRef.current.send(JSON.stringify({type:"bgcolor",color}));
  };

  return (
    <canvas
      ref={canvasRef}
      style={{
        width:"100vw", height:"100vh", display:"block",
        touchAction:"none", WebkitUserSelect:"none", userSelect:"none",
        // @ts-ignore
        WebkitTouchCallout:"none",
      }}
    />
  );
}