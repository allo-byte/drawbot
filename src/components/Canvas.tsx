import { useEffect, useRef } from "react";

type Point = { x: number; y: number };
type Stroke = {
  points: Point[];
  color: string;
  size: number;
  opacity: number;
  eraser: boolean;
};
type Cursor = { x: number; y: number; userId: string };

type Props = {
  color: string;
  brushSize: number;
  opacity: number;
  eraser: boolean;
  username: string;
  setUsers?: (users: string[]) => void;
  onReady?: (saveFn: () => void) => void;
};

export default function Canvas({
  color, brushSize, opacity, eraser, username, setUsers, onReady,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const cursorsRef = useRef<Map<string, Cursor>>(new Map());
  const strokesRef = useRef<Stroke[]>([]);
  const currentStrokeRef = useRef<Stroke | null>(null);

  const colorRef   = useRef(color);
  const sizeRef    = useRef(brushSize);
  const opacityRef = useRef(opacity);
  const eraserRef  = useRef(eraser);

  // viewport transform
  const viewRef = useRef({ x: 0, y: 0, scale: 1 });

  colorRef.current   = color;
  sizeRef.current    = brushSize;
  opacityRef.current = opacity;
  eraserRef.current  = eraser;

  // screen → world coords
  const toWorld = (sx: number, sy: number) => {
    const v = viewRef.current;
    return { x: (sx - v.x) / v.scale, y: (sy - v.y) / v.scale };
  };

  const drawStroke = (ctx: CanvasRenderingContext2D, stroke: Stroke) => {
    if (stroke.points.length < 2) return;
    ctx.beginPath();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = stroke.size;
    if (stroke.eraser) {
      ctx.globalCompositeOperation = "destination-out";
      ctx.globalAlpha = 1;
    } else {
      ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = stroke.opacity;
      ctx.strokeStyle = stroke.color;
    }
    ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
    for (let i = 1; i < stroke.points.length; i++)
      ctx.lineTo(stroke.points[i].x, stroke.points[i].y);
    ctx.stroke();
    ctx.closePath();
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
  };

  const redraw = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const v = viewRef.current;

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.restore();

    // aplicar dpr + viewport transform
    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.translate(v.x, v.y);
    ctx.scale(v.scale, v.scale);

    strokesRef.current.forEach((s) => drawStroke(ctx, s));

    // cursores de otros usuarios
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
      if (data.type === "init")   { strokesRef.current = data.strokes || []; redraw(); return; }
      if (data.type === "users")  { setUsers?.(data.users || []); return; }
      if (data.type === "stroke") { strokesRef.current.push(data.stroke); redraw(); return; }
      if (data.type === "clear")  { strokesRef.current = []; redraw(); return; }
      if (data.type === "cursor") {
        cursorsRef.current.set(data.userId, { x: data.x, y: data.y, userId: data.username });
        redraw();
      }
    };

    const getScreenPos = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };

    // ── Dibujo ──────────────────────────────────────────────────────────────

    const startDrawing = (e: PointerEvent) => {
      if (e.isPrimary === false) return; // ignorar segundo dedo
      const screen = getScreenPos(e);
      const world = toWorld(screen.x, screen.y);
      currentStrokeRef.current = {
        points: [world],
        color:   colorRef.current,
        size:    sizeRef.current,
        opacity: opacityRef.current,
        eraser:  eraserRef.current,
      };
    };

    const draw = (e: PointerEvent) => {
      if (e.isPrimary === false) return;
      if (!currentStrokeRef.current) return;
      const screen = getScreenPos(e);
      const world = toWorld(screen.x, screen.y);
      if (wsRef.current?.readyState === WebSocket.OPEN)
        wsRef.current.send(JSON.stringify({ type: "cursor", x: world.x, y: world.y }));
      currentStrokeRef.current.points.push(world);
      redraw();
      // dibuja trazo activo encima
      const ctx = canvas.getContext("2d");
      if (ctx) {
        const v = viewRef.current;
        ctx.save();
        ctx.scale(dpr, dpr);
        ctx.translate(v.x, v.y);
        ctx.scale(v.scale, v.scale);
        drawStroke(ctx, currentStrokeRef.current);
        ctx.restore();
      }
    };

    const stopDrawing = (e: PointerEvent) => {
      if (e.isPrimary === false) return;
      if (!currentStrokeRef.current) return;
      const stroke = currentStrokeRef.current;
      strokesRef.current.push(stroke);
      if (wsRef.current?.readyState === WebSocket.OPEN)
        wsRef.current.send(JSON.stringify({ type: "stroke", stroke }));
      currentStrokeRef.current = null;
      redraw();
    };

    canvas.addEventListener("pointerdown", startDrawing);
    canvas.addEventListener("pointermove", draw);
    canvas.addEventListener("pointerup",   stopDrawing);
    canvas.addEventListener("pointerleave", stopDrawing);

    // ── Zoom con rueda del mouse (PC) ────────────────────────────────────────

    const MIN_SCALE = 0.25;
    const MAX_SCALE = 8;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const v = viewRef.current;
      const delta = e.deltaY < 0 ? 1.1 : 0.9;
      const newScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, v.scale * delta));
      // zoom centrado en el cursor
      viewRef.current = {
        x: mx - (mx - v.x) * (newScale / v.scale),
        y: my - (my - v.y) * (newScale / v.scale),
        scale: newScale,
      };
      redraw();
    };

    canvas.addEventListener("wheel", onWheel, { passive: false });

    // ── Pinch zoom + pan con dos dedos (touch) ───────────────────────────────

    let lastTouchDist = 0;
    let lastTouchMid  = { x: 0, y: 0 };
    let isPinching    = false;

    const getTouchDist = (t1: Touch, t2: Touch) => {
      const dx = t1.clientX - t2.clientX;
      const dy = t1.clientY - t2.clientY;
      return Math.sqrt(dx * dx + dy * dy);
    };

    const getTouchMid = (t1: Touch, t2: Touch, rect: DOMRect) => ({
      x: (t1.clientX + t2.clientX) / 2 - rect.left,
      y: (t1.clientY + t2.clientY) / 2 - rect.top,
    });

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        e.preventDefault();
        isPinching = true;
        currentStrokeRef.current = null; // cancelar trazo activo
        const rect = canvas.getBoundingClientRect();
        lastTouchDist = getTouchDist(e.touches[0], e.touches[1]);
        lastTouchMid  = getTouchMid(e.touches[0], e.touches[1], rect);
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        e.preventDefault();
        const rect = canvas.getBoundingClientRect();
        const dist = getTouchDist(e.touches[0], e.touches[1]);
        const mid  = getTouchMid(e.touches[0], e.touches[1], rect);
        const v    = viewRef.current;

        const scaleRatio = dist / lastTouchDist;
        const newScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, v.scale * scaleRatio));

        // zoom + pan simultáneos
        viewRef.current = {
          x: mid.x - (lastTouchMid.x - v.x) * (newScale / v.scale) - (lastTouchMid.x - mid.x),
          y: mid.y - (lastTouchMid.y - v.y) * (newScale / v.scale) - (lastTouchMid.y - mid.y),
          scale: newScale,
        };

        lastTouchDist = dist;
        lastTouchMid  = mid;
        redraw();
      }
    };

    const onTouchEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) isPinching = false;
    };

    canvas.addEventListener("touchstart", onTouchStart, { passive: false });
    canvas.addEventListener("touchmove",  onTouchMove,  { passive: false });
    canvas.addEventListener("touchend",   onTouchEnd);

    // ── Guardar PNG ──────────────────────────────────────────────────────────

    const savePNG = () => {
      // exportar con zoom reseteado para imagen limpia
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
      canvas.removeEventListener("pointerdown", startDrawing);
      canvas.removeEventListener("pointermove", draw);
      canvas.removeEventListener("pointerup",   stopDrawing);
      canvas.removeEventListener("pointerleave", stopDrawing);
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("touchstart", onTouchStart);
      canvas.removeEventListener("touchmove",  onTouchMove);
      canvas.removeEventListener("touchend",   onTouchEnd);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{
        width: "100vw",
        height: "100vh",
        background: "#111",
        display: "block",
        touchAction: "none",
        WebkitUserSelect: "none",
        userSelect: "none",
        // @ts-ignore
        WebkitTouchCallout: "none",
      }}
    />
  );
}