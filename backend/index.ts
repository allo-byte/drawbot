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

// process.cwd() en Railway devuelve /app/backend (el root directory)
// ../dist sube un nivel a /app/dist donde está el frontend buildeado
const distPath = join(process.cwd(), "../dist");

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

const rooms       = new Map<string, Set<WebSocket>>();
const roomStrokes = new Map<string, Stroke[]>();
const roomUsers   = new Map<string, Map<string, string>>();

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

      ws.send(JSON.stringify({ type: "init", strokes: roomStrokes.get(roomId) || [] }));
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
      roomStrokes.get(roomId)?.push(data.stroke);
    }

    if (data.type === "clear") {
      roomStrokes.set(roomId, []);
      rooms.get(roomId)?.forEach((c) => {
        if (c.readyState === WebSocket.OPEN)
          c.send(JSON.stringify({ type: "clear" }));
      });
      return;
    }

    if (data.type === "cursor") {
      rooms.get(roomId)?.forEach((c) => {
        if (c !== ws && c.readyState === WebSocket.OPEN)
          c.send(JSON.stringify({ type: "cursor", x: data.x, y: data.y, userId, username }));
      });
      return;
    }

    rooms.get(roomId)?.forEach((c) => {
      if (c !== ws && c.readyState === WebSocket.OPEN)
        c.send(JSON.stringify(data));
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