import { WebSocketServer, WebSocket } from "ws";
import { createServer } from "http";
import { readFileSync, existsSync } from "fs";
import { join, extname } from "path";

type Point = { x: number; y: number };
type Stroke = {
  points:   Point[];
  color:    string;
  size:     number;
  opacity:  number;
  eraser:   boolean;
  layerId?: number;
};

type Layer = {
  id:        number;
  name:      string;
  visible:   boolean;
  opacity:   number;
  locked:    boolean;
  ownerId:   string;   // userId interno
  ownerName: string;   // nombre visible
};

const port     = Number(process.env.PORT) || 3001;
const distPath = join(process.cwd(), "dist");

console.log(`📁 Serving dist from: ${distPath}`);
console.log(`🚀 PeonyPaint running on :${port}`);

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
  let urlPath  = req.url?.split("?")[0] || "/";
  let filePath = join(distPath, urlPath === "/" ? "index.html" : urlPath);
  if (!existsSync(filePath)) filePath = join(distPath, "index.html");
  try {
    const content = readFileSync(filePath);
    const ext     = extname(filePath);
    res.writeHead(200, { "Content-Type": mimeTypes[ext] || "application/octet-stream" });
    res.end(content);
  } catch {
    res.writeHead(404); res.end("Not found");
  }
});

const wss = new WebSocketServer({ server: httpServer });

const rooms       = new Map<string, Set<WebSocket>>();
const roomStrokes = new Map<string, Stroke[]>();
const roomUsers   = new Map<string, Map<string, string>>();   // userId → username
const roomBgColor = new Map<string, string>();
const roomLayers  = new Map<string, Layer[]>();

let globalLayerId = 100; // IDs altos para evitar colisión con cliente

function broadcast(roomId: string, sender: WebSocket | null, msg: object) {
  rooms.get(roomId)?.forEach(c => {
    if (c !== sender && c.readyState === WebSocket.OPEN)
      c.send(JSON.stringify(msg));
  });
}

function broadcastAll(roomId: string, msg: object) {
  rooms.get(roomId)?.forEach(c => {
    if (c.readyState === WebSocket.OPEN) c.send(JSON.stringify(msg));
  });
}

wss.on("connection", (ws: WebSocket) => {
  let roomId   = "default";
  let username = "Invitado";
  const userId = Math.random().toString(36).substring(2, 9);

  ws.on("message", (message: Buffer) => {
    const data = JSON.parse(message.toString());

    // ── JOIN ────────────────────────────────────────────────────────────────
    if (data.type === "join") {
      username = data.username || "Invitado";
      roomId   = data.room;

      if (!rooms.has(roomId))       rooms.set(roomId, new Set());
      if (!roomStrokes.has(roomId)) roomStrokes.set(roomId, []);
      if (!roomUsers.has(roomId))   roomUsers.set(roomId, new Map());
      if (!roomLayers.has(roomId))  roomLayers.set(roomId, []);

      rooms.get(roomId)!.add(ws);
      roomUsers.get(roomId)!.set(userId, username);

      // Crear capa inicial para este usuario si no tiene ninguna
      const layers  = roomLayers.get(roomId)!;
      const myLayer = layers.find(l => l.ownerId === userId);
      if (!myLayer) {
        const newLayer: Layer = {
          id:        ++globalLayerId,
          name:      "Capa 1",
          visible:   true,
          opacity:   1,
          locked:    false,
          ownerId:   userId,
          ownerName: username,
        };
        layers.push(newLayer);
        // Notificar a los demás que hay una capa nueva
        broadcast(roomId, ws, { type: "layer_added", layer: newLayer });
      }

      // Enviar estado completo al nuevo usuario
      ws.send(JSON.stringify({
        type:     "init",
        strokes:  roomStrokes.get(roomId) || [],
        bgColor:  roomBgColor.get(roomId) || null,
        layers:   roomLayers.get(roomId)  || [],
        myUserId: userId,
      }));
      ws.send(JSON.stringify({ type: "user", userId: username }));

      const users = Array.from(roomUsers.get(roomId)!.values());
      broadcastAll(roomId, { type: "users", users });

      console.log(`👤 ${username}(${userId}) joined ${roomId}`);
      return;
    }

    // ── STROKE ──────────────────────────────────────────────────────────────
    if (data.type === "stroke") {
      const stroke = { ...data.stroke, _uid: userId };
      roomStrokes.get(roomId)?.push(stroke);
      broadcast(roomId, ws, { type: "stroke", stroke: data.stroke, userId });
      return;
    }

    // ── STROKE STREAMING ────────────────────────────────────────────────────
    if (data.type === "stroke_update") {
      broadcast(roomId, ws, { ...data, userId });
      return;
    }

    // ── CLEAR ───────────────────────────────────────────────────────────────
    if (data.type === "clear") {
      roomStrokes.set(roomId, []);
      broadcastAll(roomId, { type: "clear" });
      return;
    }

    // ── BGCOLOR ─────────────────────────────────────────────────────────────
    if (data.type === "bgcolor") {
      roomBgColor.set(roomId, data.color);
      broadcast(roomId, ws, { type: "bgcolor", color: data.color });
      return;
    }

    // ── CURSOR ──────────────────────────────────────────────────────────────
    if (data.type === "cursor") {
      broadcast(roomId, ws, { type: "cursor", x: data.x, y: data.y, userId, username });
      return;
    }

    // ── UNDO SYNC ───────────────────────────────────────────────────────────
    if (data.type === "undo_sync") {
      const list   = roomStrokes.get(roomId) || [];
      const others = list.filter((s: any) => s._uid !== userId);
      const mine   = (data.strokes || []).map((s: any) => ({ ...s, _uid: userId }));
      roomStrokes.set(roomId, [...others, ...mine]);
      broadcast(roomId, ws, { type: "reload_strokes", strokes: roomStrokes.get(roomId) });
      return;
    }

    // ── LAYER: añadir capa propia ────────────────────────────────────────────
    if (data.type === "layer_add") {
      const layers = roomLayers.get(roomId)!;
      const newLayer: Layer = {
        id:        ++globalLayerId,
        name:      data.name || `Capa ${layers.filter(l=>l.ownerId===userId).length+1}`,
        visible:   true,
        opacity:   1,
        locked:    false,
        ownerId:   userId,
        ownerName: username,
      };
      layers.push(newLayer);
      broadcastAll(roomId, { type: "layer_added", layer: newLayer });
      return;
    }

    // ── LAYER: actualizar capas propias ──────────────────────────────────────
    if (data.type === "layer_update") {
      const layers   = roomLayers.get(roomId)!;
      const incoming = (data.layers as Layer[]).filter(l => l.ownerId === userId);
      // Reemplazar solo las capas de este usuario
      const others   = layers.filter(l => l.ownerId !== userId);
      const updated  = [...others, ...incoming];
      roomLayers.set(roomId, updated);
      broadcast(roomId, ws, { type: "layer_update", layers: incoming, ownerId: userId });
      return;
    }

    // ── LAYER: eliminar capa propia ──────────────────────────────────────────
    if (data.type === "layer_delete") {
      const layers = roomLayers.get(roomId)!;
      const myLayers = layers.filter(l => l.ownerId === userId);
      if (myLayers.length <= 1) return; // mínimo 1 capa
      const updated = layers.filter(l => l.id !== data.layerId || l.ownerId !== userId);
      roomLayers.set(roomId, updated);
      broadcastAll(roomId, { type: "layer_deleted", layerId: data.layerId });
      return;
    }

    // ── LAYER: reordenar capas propias ───────────────────────────────────────
    if (data.type === "layer_reorder") {
      const layers  = roomLayers.get(roomId)!;
      const others  = layers.filter(l => l.ownerId !== userId);
      const mine    = layers.filter(l => l.ownerId === userId);
      const { fromIdx, toIdx } = data;
      if (fromIdx < 0 || toIdx < 0 || fromIdx >= mine.length || toIdx >= mine.length) return;
      const reordered = [...mine];
      const [moved]   = reordered.splice(fromIdx, 1);
      reordered.splice(toIdx, 0, moved!);
      roomLayers.set(roomId, [...others, ...reordered]);
      broadcast(roomId, ws, { type: "layer_reorder", ownerId: userId, order: reordered.map(l=>l.id) });
      return;
    }

    // Fallback broadcast
    broadcast(roomId, ws, { ...data, userId });
  });

  ws.on("close", () => {
    rooms.get(roomId)?.delete(ws);
    roomUsers.get(roomId)?.delete(userId);
    // NO eliminamos las capas del usuario — sus trazos deben seguir visibles
    const users = Array.from(roomUsers.get(roomId)?.values() || []);
    broadcastAll(roomId, { type: "users", users });
    console.log(`👋 ${username} left ${roomId}`);
  });
});

httpServer.listen(port);