import { useEffect, useRef } from "react";

type Point = { x: number; y: number };

export type BrushType =
  | "pen"          // Pincel estándar
  | "caligraphy1"  // Caligráfico plano izquierda (/)
  | "caligraphy2"  // Caligráfico plano derecha (\)
  | "airbrush"     // Aerógrafo
  | "oil"          // Óleo — pinceladas densas con textura
  | "crayon"       // Crayón — textura rugosa
  | "marker"       // Rotulador — sólido, bordes duros
  | "pencil"       // Lápiz natural — fino semitransparente
  | "watercolor";  // Acuarela — aguada con bordes suaves

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

// Helper: parse hex color → {r,g,b}
function hexRgb(hex: string) {
  const c = hex.replace("#", "");
  return {
    r: parseInt(c.slice(0, 2), 16),
    g: parseInt(c.slice(2, 4), 16),
    b: parseInt(c.slice(4, 6), 16),
  };
}

// Reproducible pseudo-random from integer seed
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
  const canvasRef       = useRef<HTMLCanvasElement>(null);
  const wsRef           = useRef<WebSocket | null>(null);
  const cursorsRef      = useRef<Map<string, Cursor>>(new Map());
  const strokesRef      = useRef<Stroke[]>([]);
  const currentStrokeRef = useRef<Stroke | null>(null);

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

  // ─────────────────────────────────────────────────────────────────────────────
  // MOTOR DE PINCELES
  // ─────────────────────────────────────────────────────────────────────────────
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

    // ── 1. PINCEL ESTÁNDAR ─────────────────────────────────────────────────
    if (bt === "pen") {
      if (stroke.points.length < 2) { ctx.restore(); return; }
      ctx.globalAlpha   = stroke.opacity;
      ctx.lineCap       = "round";
      ctx.lineJoin      = "round";
      ctx.lineWidth     = sz;
      ctx.strokeStyle   = erasing ? "#000" : col;
      ctx.beginPath();
      ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
      for (let i = 1; i < stroke.points.length; i++)
        ctx.lineTo(stroke.points[i].x, stroke.points[i].y);
      ctx.stroke();

    // ── 2. CALIGRÁFICO IZQUIERDA (trazo plano ~135°) ───────────────────────
    } else if (bt === "caligraphy1") {
      if (stroke.points.length < 2) { ctx.restore(); return; }
      ctx.globalAlpha = stroke.opacity;
      ctx.strokeStyle = erasing ? "#000" : col;
      ctx.lineJoin    = "round";
      // El truco: ancho máximo en X, mínimo en Y → aspecto diagonal
      const w = sz;
      const h = Math.max(1, sz * 0.18);
      ctx.save();
      ctx.transform(1, 0.7, 0, 1, 0, 0); // cizalla horizontal para ángulo
      ctx.lineWidth = h;
      ctx.lineCap   = "butt";
      ctx.beginPath();
      ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
      for (let i = 1; i < stroke.points.length; i++)
        ctx.lineTo(stroke.points[i].x, stroke.points[i].y);
      // Dibujamos el trazo ancho real usando fillRect en cada segmento
      ctx.restore();
      // Implementación alternativa: rect alargado en ángulo 135°
      for (let i = 1; i < stroke.points.length; i++) {
        const a = stroke.points[i - 1], bPt = stroke.points[i];
        ctx.save();
        ctx.translate((a.x + bPt.x) / 2, (a.y + bPt.y) / 2);
        ctx.rotate(Math.PI * 0.75); // 135°
        ctx.fillStyle = erasing ? "#000" : col;
        ctx.fillRect(-w / 2, -h / 2, w, h);
        ctx.restore();
      }

    // ── 3. CALIGRÁFICO DERECHA (trazo plano ~45°) ─────────────────────────
    } else if (bt === "caligraphy2") {
      if (stroke.points.length < 2) { ctx.restore(); return; }
      ctx.globalAlpha = stroke.opacity;
      const w = sz;
      const h = Math.max(1, sz * 0.18);
      for (let i = 1; i < stroke.points.length; i++) {
        const a = stroke.points[i - 1], bPt = stroke.points[i];
        ctx.save();
        ctx.translate((a.x + bPt.x) / 2, (a.y + bPt.y) / 2);
        ctx.rotate(Math.PI * 0.25); // 45°
        ctx.fillStyle = erasing ? "#000" : col;
        ctx.fillRect(-w / 2, -h / 2, w, h);
        ctx.restore();
      }

    // ── 4. AERÓGRAFO ───────────────────────────────────────────────────────
    } else if (bt === "airbrush") {
      const density = Math.max(12, sz * 3);
      const radius  = sz * 1.8;
      for (let p = 0; p < stroke.points.length; p++) {
        const pt = stroke.points[p];
        ctx.fillStyle = erasing ? "#000" : `rgba(${r},${g},${b},${stroke.opacity * 0.25})`;
        for (let i = 0; i < density; i++) {
          const ang = prng(p * 9973 + i * 6271) * Math.PI * 2;
          const rad = Math.sqrt(prng(p * 1009  + i * 7919)) * radius;
          ctx.beginPath();
          ctx.arc(pt.x + Math.cos(ang) * rad, pt.y + Math.sin(ang) * rad, 0.6, 0, Math.PI * 2);
          ctx.fill();
        }
      }

    // ── 5. ÓLEO ────────────────────────────────────────────────────────────
    } else if (bt === "oil") {
      if (stroke.points.length < 2) { ctx.restore(); return; }
      const bristles = Math.max(4, Math.floor(sz * 0.6));
      for (let b2 = 0; b2 < bristles; b2++) {
        const offset = (b2 / bristles - 0.5) * sz;
        const alphaVar = 0.55 + prng(b2 * 3571) * 0.45;
        ctx.globalAlpha = stroke.opacity * alphaVar;
        ctx.strokeStyle = erasing
          ? "#000"
          : `rgba(${Math.min(255,r + Math.floor(prng(b2*13)*30-15))},${Math.min(255,g+Math.floor(prng(b2*17)*30-15))},${Math.min(255,b+Math.floor(prng(b2*19)*30-15))},1)`;
        ctx.lineWidth = Math.max(0.8, sz * 0.12);
        ctx.lineCap   = "round";
        ctx.lineJoin  = "round";
        ctx.beginPath();
        for (let i = 0; i < stroke.points.length; i++) {
          const pt = stroke.points[i];
          const nx = -Math.sin(0) * offset; // perpendicular approx
          const ny =  Math.cos(0) * offset;
          // Calcular perpendicular real usando segmento anterior/siguiente
          let dx = 0, dy = 1;
          if (i > 0) {
            dx = pt.x - stroke.points[i-1].x;
            dy = pt.y - stroke.points[i-1].y;
            const len = Math.sqrt(dx*dx+dy*dy) || 1;
            dx /= len; dy /= len;
          }
          const px = -dy * offset + prng(b2*1009+i*503) * sz * 0.08;
          const py =  dx * offset + prng(b2*2003+i*701) * sz * 0.08;
          if (i === 0) ctx.moveTo(pt.x + px, pt.y + py);
          else         ctx.lineTo(pt.x + px, pt.y + py);
          void nx; void ny;
        }
        ctx.stroke();
      }

    // ── 6. CRAYÓN ──────────────────────────────────────────────────────────
    } else if (bt === "crayon") {
      if (stroke.points.length < 2) { ctx.restore(); return; }
      const grain = Math.max(3, Math.floor(sz * 0.55));
      for (let g2 = 0; g2 < grain; g2++) {
        const offX = (prng(g2 * 4001) - 0.5) * sz * 0.9;
        const offY = (prng(g2 * 5003) - 0.5) * sz * 0.9;
        const alpha = (0.15 + prng(g2 * 7001) * 0.35) * stroke.opacity;
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = erasing ? "#000" : col;
        ctx.lineWidth   = Math.max(0.5, sz * 0.09 + prng(g2 * 3007) * sz * 0.08);
        ctx.lineCap     = "round";
        ctx.lineJoin    = "round";
        ctx.beginPath();
        ctx.moveTo(stroke.points[0].x + offX, stroke.points[0].y + offY);
        for (let i = 1; i < stroke.points.length; i++) {
          // pequeño jitter por punto para textura rugosa
          const jx = offX + (prng(g2 * 1009 + i * 503) - 0.5) * sz * 0.15;
          const jy = offY + (prng(g2 * 2003 + i * 701) - 0.5) * sz * 0.15;
          ctx.lineTo(stroke.points[i].x + jx, stroke.points[i].y + jy);
        }
        ctx.stroke();
      }

    // ── 7. ROTULADOR ───────────────────────────────────────────────────────
    } else if (bt === "marker") {
      if (stroke.points.length < 2) { ctx.restore(); return; }
      // Un solo trazo opaco, punta cuadrada, sin suavizado
      ctx.globalAlpha = Math.min(1, stroke.opacity * 1.1);
      ctx.strokeStyle = erasing ? "#000" : col;
      ctx.lineWidth   = sz;
      ctx.lineCap     = "square";
      ctx.lineJoin    = "miter";
      ctx.beginPath();
      ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
      for (let i = 1; i < stroke.points.length; i++)
        ctx.lineTo(stroke.points[i].x, stroke.points[i].y);
      ctx.stroke();

    // ── 8. LÁPIZ NATURAL ───────────────────────────────────────────────────
    } else if (bt === "pencil") {
      if (stroke.points.length < 2) { ctx.restore(); return; }
      const lines = Math.max(2, Math.floor(sz * 0.45));
      for (let l = 0; l < lines; l++) {
        const offX = (prng(l * 2017) - 0.5) * sz * 0.7;
        const offY = (prng(l * 3019) - 0.5) * sz * 0.7;
        ctx.globalAlpha = (0.08 + prng(l * 9001) * 0.18) * stroke.opacity;
        ctx.strokeStyle = erasing ? "#000" : col;
        ctx.lineWidth   = 0.5 + prng(l * 4001) * 0.5;
        ctx.lineCap     = "round";
        ctx.beginPath();
        ctx.moveTo(stroke.points[0].x + offX, stroke.points[0].y + offY);
        for (let i = 1; i < stroke.points.length; i++)
          ctx.lineTo(stroke.points[i].x + offX, stroke.points[i].y + offY);
        ctx.stroke();
      }

    // ── 9. ACUARELA ────────────────────────────────────────────────────────
    } else if (bt === "watercolor") {
      const passes = 3;
      for (let pass = 0; pass < passes; pass++) {
        ctx.globalAlpha = stroke.opacity * 0.12;
        for (const pt of stroke.points) {
          const jitter = sz * 0.35;
          const spread = sz * (0.9 + pass * 0.3);
          // blob exterior difuminado
          const grad = ctx.createRadialGradient(
            pt.x + (prng(pass * 9901 + pt.x * 7) - 0.5) * jitter,
            pt.y + (prng(pass * 8803 + pt.y * 7) - 0.5) * jitter,
            0,
            pt.x, pt.y, spread
          );
          if (erasing) {
            grad.addColorStop(0,   "rgba(0,0,0,0.8)");
            grad.addColorStop(0.6, "rgba(0,0,0,0.2)");
            grad.addColorStop(1,   "rgba(0,0,0,0)");
          } else {
            grad.addColorStop(0,   `rgba(${r},${g},${b},0.9)`);
            grad.addColorStop(0.5, `rgba(${r},${g},${b},0.3)`);
            grad.addColorStop(1,   `rgba(${r},${g},${b},0)`);
          }
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, spread, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    ctx.restore();
  };

  // ─────────────────────────────────────────────────────────────────────────────

  const applyTransform = (ctx: CanvasRenderingContext2D) => {
    const dpr = window.devicePixelRatio || 1;
    const v = viewRef.current;
    ctx.scale(dpr, dpr);
    ctx.translate(v.x, v.y);
    ctx.scale(v.scale, v.scale);
  };

  const redraw = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = bgColorRef.current;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
    ctx.save();
    applyTransform(ctx);
    strokesRef.current.forEach((s) => drawStroke(ctx, s));
    const v = viewRef.current;
    cursorsRef.current.forEach((cursor) => {
      ctx.beginPath();
      ctx.fillStyle = "#00ff88";
      ctx.arc(cursor.x, cursor.y, 6 / v.scale, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "white";
      ctx.font = `${12 / v.scale}px Arial`;
      ctx.fillText(cursor.userId, cursor.x + 10 / v.scale, cursor.y - 10 / v.scale);
    });
    ctx.restore();
  };

  useEffect(() => { redraw(); }, [bgColor]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width  = window.innerWidth * dpr;
    canvas.height = window.innerHeight * dpr;
    canvas.style.width  = window.innerWidth + "px";
    canvas.style.height = window.innerHeight + "px";

    const room = new URLSearchParams(window.location.search).get("room") || "default";
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = import.meta.env.VITE_WS_URL || `${protocol}//${window.location.host}`;
    wsRef.current = new WebSocket(wsUrl);

    wsRef.current.onopen = () => {
      wsRef.current?.send(JSON.stringify({ type: "join", room, username }));
    };

    wsRef.current.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === "init") {
        strokesRef.current = data.strokes || [];
        if (data.bgColor) onBgColor?.(data.bgColor);
        redraw(); return;
      }
      if (data.type === "users")   { setUsers?.(data.users || []); return; }
      if (data.type === "stroke")  { strokesRef.current.push(data.stroke); redraw(); return; }
      if (data.type === "clear")   { strokesRef.current = []; redraw(); return; }
      if (data.type === "bgcolor") { onBgColor?.(data.color); return; }
      if (data.type === "cursor")  {
        cursorsRef.current.set(data.userId, { x: data.x, y: data.y, userId: data.username });
        redraw();
      }
    };

    let lastPinchDist = 0;
    let lastPinchMid  = { x: 0, y: 0 };

    const getPinchInfo = () => {
      const pts = Array.from(touchPointersRef.current.values());
      const dx = pts[1].x - pts[0].x;
      const dy = pts[1].y - pts[0].y;
      return {
        dist: Math.sqrt(dx * dx + dy * dy),
        mid: { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 },
      };
    };

    const startStroke = (pos: { x: number; y: number }) => {
      const world = toWorld(pos.x, pos.y);
      currentStrokeRef.current = {
        points:    [world],
        color:     colorRef.current,
        size:      sizeRef.current,
        opacity:   opacityRef.current,
        eraser:    eraserRef.current,
        brushType: brushTypeRef.current,
      };
    };

    const onPointerDown = (e: PointerEvent) => {
      canvas.setPointerCapture(e.pointerId);
      const rect = canvas.getBoundingClientRect();
      const pos = { x: e.clientX - rect.left, y: e.clientY - rect.top };

      if (e.pointerType === "pen" || e.pointerType === "mouse") {
        startStroke(pos); return;
      }
      touchPointersRef.current.set(e.pointerId, pos);
      if (touchPointersRef.current.size === 2) {
        currentStrokeRef.current = null;
        const info = getPinchInfo();
        lastPinchDist = info.dist;
        lastPinchMid  = info.mid;
        return;
      }
      if (touchPointersRef.current.size === 1) startStroke(pos);
    };

    const continueStroke = (pos: { x: number; y: number }) => {
      if (!currentStrokeRef.current) return;
      const world = toWorld(pos.x, pos.y);
      if (wsRef.current?.readyState === WebSocket.OPEN)
        wsRef.current.send(JSON.stringify({ type: "cursor", x: world.x, y: world.y }));
      currentStrokeRef.current.points.push(world);
      redraw();
      const ctx = canvas.getContext("2d");
      if (ctx) { ctx.save(); applyTransform(ctx); drawStroke(ctx, currentStrokeRef.current); ctx.restore(); }
    };

    const onPointerMove = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      const pos = { x: e.clientX - rect.left, y: e.clientY - rect.top };

      if (e.pointerType === "pen" || e.pointerType === "mouse") {
        continueStroke(pos); return;
      }
      touchPointersRef.current.set(e.pointerId, pos);
      if (touchPointersRef.current.size === 2) {
        const info = getPinchInfo();
        const v = viewRef.current;
        const scaleRatio = info.dist / lastPinchDist;
        const newScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, v.scale * scaleRatio));
        viewRef.current = {
          x: info.mid.x - (lastPinchMid.x - v.x) * (newScale / v.scale) - (lastPinchMid.x - info.mid.x),
          y: info.mid.y - (lastPinchMid.y - v.y) * (newScale / v.scale) - (lastPinchMid.y - info.mid.y),
          scale: newScale,
        };
        lastPinchDist = info.dist;
        lastPinchMid  = info.mid;
        redraw(); return;
      }
      continueStroke(pos);
    };

    const finishStroke = () => {
      if (!currentStrokeRef.current) return;
      const stroke = currentStrokeRef.current;
      strokesRef.current.push(stroke);
      if (wsRef.current?.readyState === WebSocket.OPEN)
        wsRef.current.send(JSON.stringify({ type: "stroke", stroke }));
      currentStrokeRef.current = null;
      redraw();
    };

    const onPointerUp = (e: PointerEvent) => {
      if (e.pointerType === "touch") touchPointersRef.current.delete(e.pointerId);
      if (currentStrokeRef.current && touchPointersRef.current.size === 0) finishStroke();
      if ((e.pointerType === "pen" || e.pointerType === "mouse") && currentStrokeRef.current) finishStroke();
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const v = viewRef.current;
      const delta = e.deltaY < 0 ? 1.12 : 0.9;
      const newScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, v.scale * delta));
      viewRef.current = {
        x: mx - (mx - v.x) * (newScale / v.scale),
        y: my - (my - v.y) * (newScale / v.scale),
        scale: newScale,
      };
      redraw();
    };

    canvas.addEventListener("pointerdown",   onPointerDown);
    canvas.addEventListener("pointermove",   onPointerMove);
    canvas.addEventListener("pointerup",     onPointerUp);
    canvas.addEventListener("pointercancel", onPointerUp);
    canvas.addEventListener("wheel", onWheel, { passive: false });

    const savePNG = () => {
      const saved = { ...viewRef.current };
      viewRef.current = { x: 0, y: 0, scale: 1 };
      redraw();
      const link = document.createElement("a");
      link.download = `drawbot-${Date.now()}.png`;
      link.href = canvas.toDataURL("image/png");
      link.click();
      viewRef.current = saved;
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
    if (wsRef.current?.readyState === WebSocket.OPEN)
      wsRef.current.send(JSON.stringify({ type: "bgcolor", color }));
  };

  return (
    <canvas
      ref={canvasRef}
      style={{
        width: "100vw", height: "100vh", display: "block",
        touchAction: "none", WebkitUserSelect: "none", userSelect: "none",
        // @ts-ignore
        WebkitTouchCallout: "none",
      }}
    />
  );
}