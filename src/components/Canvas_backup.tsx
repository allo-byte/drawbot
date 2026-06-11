import { useEffect, useRef } from "react";

type Point = {
  x: number;
  y: number;
};

type Stroke = {
  points: Point[];
  color: string;
  size: number;
  opacity: number;
  eraser: boolean;
};

type Props = {
  color: string;
  brushSize: number;
  opacity: number;
  eraser: boolean;

  onReady?: (
    clearFn: () => void,
    undoFn: () => void,
    redoFn: () => void,
    saveFn: () => void
  ) => void;
};

export default function Canvas({
  color,
  brushSize,
  opacity,
  eraser,
  onReady,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const strokesRef = useRef<Stroke[]>([]);
  const redoRef = useRef<Stroke[]>([]);
  const currentStrokeRef = useRef<Stroke | null>(null);

  const colorRef = useRef(color);
  const sizeRef = useRef(brushSize);
  const opacityRef = useRef(opacity);
  const eraserRef = useRef(eraser);

  colorRef.current = color;
  sizeRef.current = brushSize;
  opacityRef.current = opacity;
  eraserRef.current = eraser;

  const redraw = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    strokesRef.current.forEach((stroke) => {
      if (stroke.points.length < 2) return;

      ctx.beginPath();
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.lineWidth = stroke.size;

      if (stroke.eraser) {
        ctx.globalCompositeOperation =
          "destination-out";
        ctx.globalAlpha = 1;
      } else {
        ctx.globalCompositeOperation =
          "source-over";
        ctx.globalAlpha = stroke.opacity;
        ctx.strokeStyle = stroke.color;
      }

      ctx.moveTo(
        stroke.points[0].x,
        stroke.points[0].y
      );

      for (
        let i = 1;
        i < stroke.points.length;
        i++
      ) {
        ctx.lineTo(
          stroke.points[i].x,
          stroke.points[i].y
        );
      }

      ctx.stroke();
      ctx.closePath();
    });

    ctx.globalCompositeOperation =
      "source-over";
    ctx.globalAlpha = 1;
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    const getPos = (e: PointerEvent) => {
      const rect =
        canvas.getBoundingClientRect();

      return {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      };
    };

    const startDrawing = (
      e: PointerEvent
    ) => {
      const pos = getPos(e);

      currentStrokeRef.current = {
        points: [pos],
        color: colorRef.current,
        size: sizeRef.current,
        opacity: opacityRef.current,
        eraser: eraserRef.current,
      };
    };

    const drawCurrentStroke = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const stroke =
        currentStrokeRef.current;

      if (!stroke) return;
      if (stroke.points.length < 2)
        return;

      ctx.beginPath();
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.lineWidth = stroke.size;

      if (stroke.eraser) {
        ctx.globalCompositeOperation =
          "destination-out";
        ctx.globalAlpha = 1;
      } else {
        ctx.globalCompositeOperation =
          "source-over";
        ctx.globalAlpha = stroke.opacity;
        ctx.strokeStyle = stroke.color;
      }

      ctx.moveTo(
        stroke.points[0].x,
        stroke.points[0].y
      );

      for (
        let i = 1;
        i < stroke.points.length;
        i++
      ) {
        ctx.lineTo(
          stroke.points[i].x,
          stroke.points[i].y
        );
      }

      ctx.stroke();
      ctx.closePath();

      ctx.globalCompositeOperation =
        "source-over";
      ctx.globalAlpha = 1;
    };

    const draw = (e: PointerEvent) => {
      if (!currentStrokeRef.current)
        return;

      const pos = getPos(e);

      currentStrokeRef.current.points.push(
        pos
      );

      redraw();
      drawCurrentStroke();
    };

    const stopDrawing = () => {
      if (!currentStrokeRef.current)
        return;

      strokesRef.current.push(
        currentStrokeRef.current
      );

      redoRef.current = [];
      currentStrokeRef.current = null;

      redraw();
    };

    canvas.addEventListener(
      "pointerdown",
      startDrawing
    );

    canvas.addEventListener(
      "pointermove",
      draw
    );

    canvas.addEventListener(
      "pointerup",
      stopDrawing
    );

    canvas.addEventListener(
      "pointerleave",
      stopDrawing
    );

    const clearCanvas = () => {
      strokesRef.current = [];
      redoRef.current = [];
      redraw();
    };

    const undo = () => {
      const stroke =
        strokesRef.current.pop();

      if (!stroke) return;

      redoRef.current.push(stroke);
      redraw();
    };

    const redo = () => {
      const stroke =
        redoRef.current.pop();

      if (!stroke) return;

      strokesRef.current.push(stroke);
      redraw();
    };

    const savePNG = () => {
      const canvas =
        canvasRef.current;

      if (!canvas) return;

      const link =
        document.createElement("a");

      link.download =
        `drawbot-${Date.now()}.png`;

      link.href =
        canvas.toDataURL("image/png");

      link.click();
    };

    onReady?.(
      clearCanvas,
      undo,
      redo,
      savePNG
    );

    return () => {
      canvas.removeEventListener(
        "pointerdown",
        startDrawing
      );

      canvas.removeEventListener(
        "pointermove",
        draw
      );

      canvas.removeEventListener(
        "pointerup",
        stopDrawing
      );

      canvas.removeEventListener(
        "pointerleave",
        stopDrawing
      );
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