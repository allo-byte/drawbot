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
  const viewRef    = useRef({ x: 0, y: 0, scale: 1 });

  // solo dedos (touch) para pinch — lápiz nunca entra aquí
  const touchPointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());

  colorRef.current   = color;
  sizeRef.current    = brushSize;
  opacityRef.current = opacity;
  eraserRef.current  = eraser;

  const MIN_SCALE = 0.25;
  const MAX_SCALE = 8;

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

    const onPointerDown = (e: PointerEvent) => {
      canvas.setPointerCapture(e.pointerId);
      const rect = canvas.getBoundingClientRect();
      const pos = { x: e.clientX - rect.left, y: e.clientY - rect.top };

      // lápiz o mouse → siempre dibuja, ignora pinch
      if (e.pointerType === "pen" || e.pointerType === "mouse") {
        const world = toWorld(pos.x, pos.y);
        currentStrokeRef.current = {
          points: [world],
          color:   colorRef.current,
          size:    sizeRef.current,
          opacity: opacityRef.current,
          eraser:  eraserRef.current,
        };
        return;
      }

      // dedo → rastrear para pinch
      touchPointersRef.current.set(e.pointerId, pos);

      if (touchPointersRef.current.size === 2) {
        currentStrokeRef.current = null;
        const info = getPinchInfo();
        lastPinchDist = info.dist;
        lastPinchMid  = info.mid;
        return;
      }

      if (touchPointersRef.current.size === 1) {
        const world = toWorld(pos.x, pos.y);
        currentStrokeRef.current = {
          points: [world],
          color:   colorRef.current,
          size:    sizeRef.current,
          opacity: opacityRef.current,
          eraser:  eraserRef.current,
        };
      }
    };

    const onPointerMove = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      const pos = { x: e.clientX - rect.left, y: e.clientY - rect.top };

      if (e.pointerType === "pen" || e.pointerType === "mouse") {
        if (!currentStrokeRef.current) return;
        const world = toWorld(pos.x, pos.y);
        if (wsRef.current?.readyState === WebSocket.OPEN)
          wsRef.current.send(JSON.stringify({ type: "cursor", x: world.x, y: world.y }));
        currentStrokeRef.current.points.push(world);
        redraw();
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.save();
          applyTransform(ctx);
          drawStroke(ctx, currentStrokeRef.current);
          ctx.restore();
        }
        return;
      }

      // dedo
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
        redraw();
        return;
      }

      if (!currentStrokeRef.current) return;
      const world = toWorld(pos.x, pos.y);
      if (wsRef.current?.readyState === WebSocket.OPEN)
        wsRef.current.send(JSON.stringify({ type: "cursor", x: world.x, y: world.y }));
      currentStrokeRef.current.points.push(world);
      redraw();
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.save();
        applyTransform(ctx);
        drawStroke(ctx, currentStrokeRef.current);
        ctx.restore();
      }
    };

    const onPointerUp = (e: PointerEvent) => {
      if (e.pointerType === "touch") {
        touchPointersRef.current.delete(e.pointerId);
      }

      if (currentStrokeRef.current && touchPointersRef.current.size === 0) {
        const stroke = currentStrokeRef.current;
        strokesRef.current.push(stroke);
        if (wsRef.current?.readyState === WebSocket.OPEN)
          wsRef.current.send(JSON.stringify({ type: "stroke", stroke }));
        currentStrokeRef.current = null;
        redraw();
      }

      // lápiz o mouse suelto
      if ((e.pointerType === "pen" || e.pointerType === "mouse") && currentStrokeRef.current) {
        const stroke = currentStrokeRef.current;
        strokesRef.current.push(stroke);
        if (wsRef.current?.readyState === WebSocket.OPEN)
          wsRef.current.send(JSON.stringify({ type: "stroke", stroke }));
        currentStrokeRef.current = null;
        redraw();
      }
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