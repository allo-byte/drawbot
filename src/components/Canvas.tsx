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

  colorRef.current   = color;
  sizeRef.current    = brushSize;
  opacityRef.current = opacity;
  eraserRef.current  = eraser;

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
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    strokesRef.current.forEach((s) => drawStroke(ctx, s));
    cursorsRef.current.forEach((cursor) => {
      ctx.beginPath();
      ctx.fillStyle = "#00ff88";
      ctx.arc(cursor.x, cursor.y, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "white";
      ctx.font = "12px Arial";
      ctx.fillText(cursor.userId, cursor.x + 10, cursor.y - 10);
    });
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    canvas.width  = window.innerWidth;
    canvas.height = window.innerHeight;

    const room = new URLSearchParams(window.location.search).get("room") || "default";

    // En producción el WS está en la misma URL que el frontend
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

    const getPos = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };

    const startDrawing = (e: PointerEvent) => {
      currentStrokeRef.current = {
        points: [getPos(e)],
        color:   colorRef.current,
        size:    sizeRef.current,
        opacity: opacityRef.current,
        eraser:  eraserRef.current,
      };
    };

    const draw = (e: PointerEvent) => {
      if (!currentStrokeRef.current) return;
      const pos = getPos(e);
      if (wsRef.current?.readyState === WebSocket.OPEN)
        wsRef.current.send(JSON.stringify({ type: "cursor", x: pos.x, y: pos.y }));
      currentStrokeRef.current.points.push(pos);
      const ctx = canvas.getContext("2d");
      if (ctx) drawStroke(ctx, currentStrokeRef.current);
    };

    const stopDrawing = () => {
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

    const savePNG = () => {
      const link = document.createElement("a");
      link.download = `drawbot-${Date.now()}.png`;
      link.href = canvas.toDataURL("image/png");
      link.click();
    };

    onReady?.(savePNG);

    return () => {
      wsRef.current?.close();
      canvas.removeEventListener("pointerdown", startDrawing);
      canvas.removeEventListener("pointermove", draw);
      canvas.removeEventListener("pointerup",   stopDrawing);
      canvas.removeEventListener("pointerleave", stopDrawing);
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
      }}
    />
  );
}