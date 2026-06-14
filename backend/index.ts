import { WebSocketServer, WebSocket } from "ws";
import { createServer } from "http";
import { readFileSync, existsSync } from "fs";
import { join, extname } from "path";

type Point = { x: number; y: number };
type Stroke = {
  points: Point[];
  color: string;
  size: number;
  opacity: number;
  eraser: boolean;
};

const port = Number(process.env.PORT) || 3001;
const distPath = join(process.cwd(), "dist");

console.log(`📁 Serving dist from: ${distPath}`);
console.log(`🚀 DrawBot running on :${port}`);

const mimeTypes: Record<string, string> = {
  ".html": "text/html",
  ".js":   "application/javascript",
  ".css":  "text/css",
  ".png":  "image/png",
  ".svg":  "image/svg+xml",
  ".ico":  "image/x-icon",
  ".json": "application/json",
  ".woff": "font/woff",
  ".woff2":"font/woff2",
};

const httpServer = createServer((req, res) => {
  let urlPath = req.url?.split("?")[0] || "/";
  let filePath = join(distPath, urlPath === "/" ? "index.html" : urlPath);

  if (!existsSync(filePath)) {
    filePath = join(distPath, "index.html");
  }

  try {
    const content = readFileSync(filePath);
    const ext = extname(filePath);
    res.writeHead(200, { "Content-Type": mimeTypes[ext] || "application/octet-stream" });
    res.end(content);
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
});

const wss = new WebSocketServer({ server: httpServer });

const rooms        = new Map<string, Set<WebSocket>>();
const roomStrokes  = new Map<string, Stroke[]>();
const roomUsers    = new Map<string, Map<string, string>>();
const roomBgColor  = new Map<string, string>(); // ← nuevo: color de fondo por sala

wss.on("connection", (ws: WebSocket) => {
  let roomId   = "default";
  let username = "Invitado";
  const userId = Math.random().toString(36).substring(2, 9);

  ws.on("message", (message: Buffer) => {
    const data = JSON.parse(message.toString());

    if (data.type === "join") {
      username = data.username || "Invitado";
      roomId   = data.room;

      if (!rooms.has(roomId))       rooms.set(roomId, new Set());
      if (!roomStrokes.has(roomId)) roomStrokes.set(roomId, []);
      if (!roomUsers.has(roomId))   roomUsers.set(roomId, new Map());

      rooms.get(roomId)!.add(ws);
      roomUsers.get(roomId)!.set(userId, username);

      // Enviar estado inicial incluyendo bgColor si existe
      ws.send(JSON.stringify({
        type:    "init",
        strokes: roomStrokes.get(roomId) || [],
        bgColor: roomBgColor.get(roomId) || null,
      }));
      ws.send(JSON.stringify({ type: "user", userId: username }));

      const users = Array.from(roomUsers.get(roomId)!.values());
      rooms.get(roomId)!.forEach((c) => {
        if (c.readyState === WebSocket.OPEN)
          c.send(JSON.stringify({ type: "users", users }));
      });

      console.log(`👤 ${username} joined ${roomId} (${roomUsers.get(roomId)!.size})`);
      return;
    }

    if (data.type === "stroke") {
      const stroke = { ...data.stroke, _uid: userId };
      roomStrokes.get(roomId)?.push(stroke);
    }

    if (data.type === "clear") {
      roomStrokes.set(roomId, []);
      rooms.get(roomId)?.forEach((c) => {
        if (c.readyState === WebSocket.OPEN)
          c.send(JSON.stringify({ type: "clear" }));
      });
      return;
    }

    // ── Nuevo: cambio de color de fondo ─────────────────────────────────────
    if (data.type === "bgcolor") {
      roomBgColor.set(roomId, data.color);
      // Propagar a todos los demás usuarios de la sala
      rooms.get(roomId)?.forEach((c) => {
        if (c !== ws && c.readyState === WebSocket.OPEN)
          c.send(JSON.stringify({ type: "bgcolor", color: data.color }));
      });
      return;
    }
    // ────────────────────────────────────────────────────────────────────────

    if (data.type === "cursor") {
      rooms.get(roomId)?.forEach((c) => {
        if (c !== ws && c.readyState === WebSocket.OPEN)
          c.send(JSON.stringify({ type: "cursor", x: data.x, y: data.y, userId, username }));
      });
      return;
    }

    if (data.type === "stroke_update") {
      rooms.get(roomId)?.forEach((c) => {
        if (c !== ws && c.readyState === WebSocket.OPEN)
          c.send(JSON.stringify({ ...data, userId }));
      });
      return;
    }

    // Undo/redo: el usuario envía sus strokes actualizados
    // El servidor reemplaza sus strokes en el historial de la sala
    if (data.type === "undo_sync") {
      const roomStrokeList = roomStrokes.get(roomId) || [];
      // Quitar todos los strokes anteriores de este userId y poner los nuevos
      const others = roomStrokeList.filter((s: any) => s._uid !== userId);
      const mine   = (data.strokes || []).map((s: any) => ({ ...s, _uid: userId }));
      roomStrokes.set(roomId, [...others, ...mine]);
      // Notificar a los demás para que recarguen
      rooms.get(roomId)?.forEach((c) => {
        if (c !== ws && c.readyState === WebSocket.OPEN)
          c.send(JSON.stringify({ type: "reload_strokes", strokes: roomStrokes.get(roomId) }));
      });
      return;
    }

    rooms.get(roomId)?.forEach((c) => {
      if (c !== ws && c.readyState === WebSocket.OPEN)
        c.send(JSON.stringify({ ...data, userId }));
    });
  });

  ws.on("close", () => {
    rooms.get(roomId)?.delete(ws);
    roomUsers.get(roomId)?.delete(userId);

    const users = Array.from(roomUsers.get(roomId)?.values() || []);
    rooms.get(roomId)?.forEach((c) => {
      if (c.readyState === WebSocket.OPEN)
        c.send(JSON.stringify({ type: "users", users }));
    });

    console.log(`👋 ${username} left ${roomId} (${roomUsers.get(roomId)?.size})`);
  });
});

httpServer.listen(port);