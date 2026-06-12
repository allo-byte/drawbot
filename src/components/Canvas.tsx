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
  let s = seed ^ 0xdeadbeef;
  s = Math.imul(s ^ (s >>> 16), 0x45d9f3b);
  s = Math.imul(s ^ (s >>> 16), 0x45d9f3b);
  return ((s ^ (s >>> 16)) >>> 0) / 0xffffffff;
}

export default function Canvas({
  color, brushSize, opacity, eraser, brushType, username,
  bgColor, setUsers, onReady, onBgColor,
}: Props) {
  const canvasRef    = useRef<HTMLCanvasElement>(null);
  // Canvas offscreen: acumula todos los strokes terminados
  const offscreenRef = useRef<HTMLCanvasElement | null>(null);

  const wsRef            = useRef<WebSocket | null>(null);
  const cursorsRef       = useRef<Map<string, Cursor>>(new Map());
  const strokesRef       = useRef<Stroke[]>([]);
  const currentStrokeRef = useRef<Stroke | null>(null);
  // Cuántos strokes del offscreen ya están pintados
  const offscreenCountRef = useRef(0);

  const colorRef     = useRef(color);
  const sizeRef      = useRef(brushSize);
  const opacityRef   = useRef(opacity);
  const eraserRef    = useRef(eraser);
  const brushTypeRef = useRef(brushType);
  const bgColorRef   = useRef(bgColor);
  const viewRef      = useRef({ x: 0, y: 0, scale: 1 });
  const touchPointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());

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
  const drawStroke = (ctx: CanvasRenderingContext2D, stroke: Stroke) => {
    if (stroke.points.length < 1) return;
    const bt  = stroke.brushType ?? "pen";
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

    if (bt === "pen") {
      if (stroke.points.length < 2) { ctx.restore(); return; }
      ctx.globalAlpha = stroke.opacity;
      ctx.lineCap = "round"; ctx.lineJoin = "round";
      ctx.lineWidth = sz;
      ctx.strokeStyle = erasing ? "#000" : col;
      ctx.beginPath();
      ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
      for (let i = 1; i < stroke.points.length; i++)
        ctx.lineTo(stroke.points[i].x, stroke.points[i].y);
      ctx.stroke();

    } else if (bt === "caligraphy1") {
      if (stroke.points.length < 2) { ctx.restore(); return; }
      ctx.globalAlpha = stroke.opacity;
      const w = sz, h = Math.max(1, sz * 0.18);
      for (let i = 1; i < stroke.points.length; i++) {
        const a = stroke.points[i-1], bPt = stroke.points[i];
        ctx.save();
        ctx.translate((a.x+bPt.x)/2, (a.y+bPt.y)/2);
        ctx.rotate(Math.PI * 0.75);
        ctx.fillStyle = erasing ? "#000" : col;
        ctx.fillRect(-w/2, -h/2, w, h);
        ctx.restore();
      }

    } else if (bt === "caligraphy2") {
      if (stroke.points.length < 2) { ctx.restore(); return; }
      ctx.globalAlpha = stroke.opacity;
      const w = sz, h = Math.max(1, sz * 0.18);
      for (let i = 1; i < stroke.points.length; i++) {
        const a = stroke.points[i-1], bPt = stroke.points[i];
        ctx.save();
        ctx.translate((a.x+bPt.x)/2, (a.y+bPt.y)/2);
        ctx.rotate(Math.PI * 0.25);
        ctx.fillStyle = erasing ? "#000" : col;
        ctx.fillRect(-w/2, -h/2, w, h);
        ctx.restore();
      }

    } else if (bt === "airbrush") {
      const density = Math.max(12, sz * 3);
      const radius  = sz * 1.8;
      for (let p = 0; p < stroke.points.length; p++) {
        const pt = stroke.points[p];
        ctx.fillStyle = erasing ? "#000" : `rgba(${r},${g},${b},${stroke.opacity * 0.25})`;
        for (let i = 0; i < density; i++) {
          const ang = prng(p*9973+i*6271)*Math.PI*2;
          const rad = Math.sqrt(prng(p*1009+i*7919))*radius;
          ctx.beginPath();
          ctx.arc(pt.x+Math.cos(ang)*rad, pt.y+Math.sin(ang)*rad, 0.6, 0, Math.PI*2);
          ctx.fill();
        }
      }

    } else if (bt === "oil") {
      if (stroke.points.length < 2) { ctx.restore(); return; }
      const bristles = Math.max(4, Math.floor(sz * 0.6));
      for (let b2 = 0; b2 < bristles; b2++) {
        const alphaVar = 0.55 + prng(b2*3571)*0.45;
        ctx.globalAlpha = stroke.opacity * alphaVar;
        ctx.strokeStyle = erasing ? "#000"
          : `rgba(${Math.min(255,r+Math.floor(prng(b2*13)*30-15))},${Math.min(255,g+Math.floor(prng(b2*17)*30-15))},${Math.min(255,b+Math.floor(prng(b2*19)*30-15))},1)`;
        ctx.lineWidth = Math.max(0.8, sz*0.12);
        ctx.lineCap = "round"; ctx.lineJoin = "round";
        ctx.beginPath();
        for (let i = 0; i < stroke.points.length; i++) {
          const pt = stroke.points[i];
          let dx=0, dy=1;
          if (i > 0) {
            dx = pt.x-stroke.points[i-1].x;
            dy = pt.y-stroke.points[i-1].y;
            const len = Math.sqrt(dx*dx+dy*dy)||1;
            dx/=len; dy/=len;
          }
          const px = -dy*(b2/(bristles-1||1)-0.5)*sz + prng(b2*1009+i*503)*sz*0.08;
          const py =  dx*(b2/(bristles-1||1)-0.5)*sz + prng(b2*2003+i*701)*sz*0.08;
          if (i===0) ctx.moveTo(pt.x+px, pt.y+py);
          else       ctx.lineTo(pt.x+px, pt.y+py);
        }
        ctx.stroke();
      }

    } else if (bt === "crayon") {
      if (stroke.points.length < 2) { ctx.restore(); return; }
      const grain = Math.max(3, Math.floor(sz*0.55));
      for (let g2=0; g2<grain; g2++) {
        const offX = (prng(g2*4001)-0.5)*sz*0.9;
        const offY = (prng(g2*5003)-0.5)*sz*0.9;
        ctx.globalAlpha = (0.15+prng(g2*7001)*0.35)*stroke.opacity;
        ctx.strokeStyle = erasing ? "#000" : col;
        ctx.lineWidth = Math.max(0.5, sz*0.09+prng(g2*3007)*sz*0.08);
        ctx.lineCap="round"; ctx.lineJoin="round";
        ctx.beginPath();
        ctx.moveTo(stroke.points[0].x+offX, stroke.points[0].y+offY);
        for (let i=1; i<stroke.points.length; i++) {
          const jx = offX+(prng(g2*1009+i*503)-0.5)*sz*0.15;
          const jy = offY+(prng(g2*2003+i*701)-0.5)*sz*0.15;
          ctx.lineTo(stroke.points[i].x+jx, stroke.points[i].y+jy);
        }
        ctx.stroke();
      }

    } else if (bt === "marker") {
      if (stroke.points.length < 2) { ctx.restore(); return; }
      ctx.globalAlpha = Math.min(1, stroke.opacity*1.1);
      ctx.strokeStyle = erasing ? "#000" : col;
      ctx.lineWidth = sz; ctx.lineCap="square"; ctx.lineJoin="miter";
      ctx.beginPath();
      ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
      for (let i=1; i<stroke.points.length; i++)
        ctx.lineTo(stroke.points[i].x, stroke.points[i].y);
      ctx.stroke();

    } else if (bt === "pencil") {
      if (stroke.points.length < 2) { ctx.restore(); return; }
      const lines = Math.max(2, Math.floor(sz*0.45));
      for (let l=0; l<lines; l++) {
        const offX = (prng(l*2017)-0.5)*sz*0.7;
        const offY = (prng(l*3019)-0.5)*sz*0.7;
        ctx.globalAlpha = (0.08+prng(l*9001)*0.18)*stroke.opacity;
        ctx.strokeStyle = erasing ? "#000" : col;
        ctx.lineWidth = 0.5+prng(l*4001)*0.5;
        ctx.lineCap="round";
        ctx.beginPath();
        ctx.moveTo(stroke.points[0].x+offX, stroke.points[0].y+offY);
        for (let i=1; i<stroke.points.length; i++)
          ctx.lineTo(stroke.points[i].x+offX, stroke.points[i].y+offY);
        ctx.stroke();
      }

    } else if (bt === "watercolor") {
      for (let pass=0; pass<3; pass++) {
        ctx.globalAlpha = stroke.opacity*0.12;
        for (const pt of stroke.points) {
          const spread = sz*(0.9+pass*0.3);
          const grad = ctx.createRadialGradient(
            pt.x+(prng(pass*9901+pt.x*7)-0.5)*sz*0.35,
            pt.y+(prng(pass*8803+pt.y*7)-0.5)*sz*0.35,
            0, pt.x, pt.y, spread
          );
          if (erasing) {
            grad.addColorStop(0,"rgba(0,0,0,0.8)");
            grad.addColorStop(0.6,"rgba(0,0,0,0.2)");
            grad.addColorStop(1,"rgba(0,0,0,0)");
          } else {
            grad.addColorStop(0,`rgba(${r},${g},${b},0.9)`);
            grad.addColorStop(0.5,`rgba(${r},${g},${b},0.3)`);
            grad.addColorStop(1,`rgba(${r},${g},${b},0)`);
          }
          ctx.fillStyle=grad;
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, spread, 0, Math.PI*2);
          ctx.fill();
        }
      }
    }
    ctx.restore();
  };

  // ─── Offscreen: solo pinta los strokes nuevos (incrementalmente) ──────────
  const flushToOffscreen = () => {
    const off = offscreenRef.current;
    if (!off) return;
    const ctx = off.getContext("2d");
    if (!ctx) return;
    const v = viewRef.current;
    const dpr = window.devicePixelRatio || 1;

    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.translate(v.x, v.y);
    ctx.scale(v.scale, v.scale);

    const strokes = strokesRef.current;
    for (let i = offscreenCountRef.current; i < strokes.length; i++) {
      drawStroke(ctx, strokes[i]);
    }
    offscreenCountRef.current = strokes.length;
    ctx.restore();
  };

  // Rebuilds offscreen desde cero (necesario al cambiar bgColor o zoom)
  const rebuildOffscreen = () => {
    const off = offscreenRef.current;
    const canvas = canvasRef.current;
    if (!off || !canvas) return;
    const ctx = off.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const v = viewRef.current;

    ctx.save();
    ctx.setTransform(1,0,0,1,0,0);
    ctx.clearRect(0, 0, off.width, off.height);
    ctx.fillStyle = bgColorRef.current;
    ctx.fillRect(0, 0, off.width, off.height);
    ctx.restore();

    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.translate(v.x, v.y);
    ctx.scale(v.scale, v.scale);
    strokesRef.current.forEach(s => drawStroke(ctx, s));
    ctx.restore();

    offscreenCountRef.current = strokesRef.current.length;
  };

  const applyTransform = (ctx: CanvasRenderingContext2D) => {
    const dpr = window.devicePixelRatio || 1;
    const v = viewRef.current;
    ctx.scale(dpr, dpr);
    ctx.translate(v.x, v.y);
    ctx.scale(v.scale, v.scale);
  };

  // ─── Composite: offscreen + stroke activo + cursores ─────────────────────
  const composite = () => {
    const canvas = canvasRef.current;
    const off = offscreenRef.current;
    if (!canvas || !off) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.save();
    ctx.setTransform(1,0,0,1,0,0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    // Pegar offscreen (ya tiene fondo + strokes terminados)
    ctx.drawImage(off, 0, 0);
    ctx.restore();

    // Stroke activo encima
    if (currentStrokeRef.current) {
      ctx.save();
      applyTransform(ctx);
      drawStroke(ctx, currentStrokeRef.current);
      ctx.restore();
    }

    // Cursores
    const v = viewRef.current;
    ctx.save();
    applyTransform(ctx);
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
  };

  // redraw completo (zoom, bgColor, init)
  const redraw = () => {
    rebuildOffscreen();
    composite();
  };

  useEffect(() => { redraw(); }, [bgColor]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const dpr = window.devicePixelRatio || 1;
    const w = window.innerWidth * dpr;
    const h = window.innerHeight * dpr;
    canvas.width  = w; canvas.height  = h;
    canvas.style.width  = window.innerWidth  + "px";
    canvas.style.height = window.innerHeight + "px";

    // Crear offscreen del mismo tamaño
    const off = document.createElement("canvas");
    off.width = w; off.height = h;
    offscreenRef.current = off;
    // Pintar fondo inicial
    const offCtx = off.getContext("2d")!;
    offCtx.fillStyle = bgColorRef.current;
    offCtx.fillRect(0, 0, w, h);

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
      if (data.type === "users")   { setUsers?.(data.users||[]); return; }
      if (data.type === "stroke")  {
        strokesRef.current.push(data.stroke);
        // Solo pintar el nuevo stroke en offscreen
        flushToOffscreen();
        composite();
        return;
      }
      if (data.type === "clear")   {
        strokesRef.current = [];
        offscreenCountRef.current = 0;
        rebuildOffscreen();
        composite();
        return;
      }
      if (data.type === "bgcolor") { onBgColor?.(data.color); return; }
      if (data.type === "cursor")  {
        cursorsRef.current.set(data.userId, { x:data.x, y:data.y, userId:data.username });
        composite(); // solo composite, offscreen no cambia
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
        composite(); // ← solo composite, NO redraw completo
        return;
      }

      touchPointersRef.current.set(e.pointerId, pos);
      if (touchPointersRef.current.size===2) {
        const info=getPinchInfo();
        const v=viewRef.current;
        const scaleRatio=info.dist/lastPinchDist;
        const newScale=Math.min(MAX_SCALE,Math.max(MIN_SCALE,v.scale*scaleRatio));
        viewRef.current={
          x:info.mid.x-(lastPinchMid.x-v.x)*(newScale/v.scale)-(lastPinchMid.x-info.mid.x),
          y:info.mid.y-(lastPinchMid.y-v.y)*(newScale/v.scale)-(lastPinchMid.y-info.mid.y),
          scale:newScale,
        };
        lastPinchDist=info.dist; lastPinchMid=info.mid;
        redraw(); return; // zoom → rebuild completo
      }

      if (!currentStrokeRef.current) return;
      const world=toWorld(pos.x,pos.y);
      if (wsRef.current?.readyState===WebSocket.OPEN)
        wsRef.current.send(JSON.stringify({type:"cursor",x:world.x,y:world.y}));
      currentStrokeRef.current.points.push(world);
      composite();
    };

    const finishStroke = () => {
      if (!currentStrokeRef.current) return;
      const stroke = currentStrokeRef.current;
      strokesRef.current.push(stroke);
      // Pintar en offscreen y limpiar stroke activo
      flushToOffscreen();
      currentStrokeRef.current = null;
      if (wsRef.current?.readyState===WebSocket.OPEN)
        wsRef.current.send(JSON.stringify({type:"stroke",stroke}));
      composite();
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
      const newScale=Math.min(MAX_SCALE,Math.max(MIN_SCALE,v.scale*delta));
      viewRef.current={
        x:mx-(mx-v.x)*(newScale/v.scale),
        y:my-(my-v.y)*(newScale/v.scale),
        scale:newScale,
      };
      redraw(); // zoom → rebuild
    };

    canvas.addEventListener("pointerdown",   onPointerDown);
    canvas.addEventListener("pointermove",   onPointerMove);
    canvas.addEventListener("pointerup",     onPointerUp);
    canvas.addEventListener("pointercancel", onPointerUp);
    canvas.addEventListener("wheel", onWheel, { passive:false });

    const savePNG = () => {
      const saved={...viewRef.current};
      viewRef.current={x:0,y:0,scale:1};
      redraw();
      const link=document.createElement("a");
      link.download=`drawbot-${Date.now()}.png`;
      link.href=canvas.toDataURL("image/png");
      link.click();
      viewRef.current=saved;
      redraw();
    };
    onReady?.(savePNG);

    return () => {
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