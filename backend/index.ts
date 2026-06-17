import { WebSocketServer, WebSocket } from "ws";
import { createServer } from "http";
import { readFileSync, existsSync } from "fs";
import { join, extname } from "path";

type Point  = { x: number; y: number };
type Stroke = { points: Point[]; color: string; size: number; opacity: number; eraser: boolean; layerId?: number; _uid?: string; };
type Layer  = { id: number; name: string; visible: boolean; opacity: number; locked: boolean; ownerId: string; ownerName: string; blendMode?: string; };

const port     = Number(process.env.PORT) || 3001;
const distPath = join(process.cwd(), "dist");
const MAX_STROKES = 6000; // límite por sala

const mimeTypes: Record<string, string> = {
  ".html":"text/html",".js":"application/javascript",".css":"text/css",
  ".png":"image/png",".svg":"image/svg+xml",".ico":"image/x-icon",
  ".json":"application/json",".woff":"font/woff",".woff2":"font/woff2",
};

const httpServer = createServer((req, res) => {
  let p = req.url?.split("?")[0] || "/";
  let f = join(distPath, p === "/" ? "index.html" : p);
  if (!existsSync(f)) f = join(distPath, "index.html");
  try {
    const ext = extname(f);
    res.writeHead(200, { "Content-Type": mimeTypes[ext] || "application/octet-stream" });
    res.end(readFileSync(f));
  } catch { res.writeHead(404); res.end("Not found"); }
});

const wss = new WebSocketServer({ server: httpServer });

const rooms       = new Map<string, Set<WebSocket>>();
const roomStrokes = new Map<string, Stroke[]>();
const roomUsers   = new Map<string, Map<string, string>>();
const roomBgColor = new Map<string, string>();
const roomLayers  = new Map<string, Layer[]>();
// Throttle de cursores: userId → último timestamp enviado
const cursorThrottle = new Map<string, number>();
const CURSOR_MS = 50; // máx 20 cursores/s por usuario

let globalLayerId = 100;

// FIX #10: serializar UNA vez para broadcast
function broadcast(roomId: string, sender: WebSocket | null, msg: object) {
  const str = JSON.stringify(msg);
  rooms.get(roomId)?.forEach(c => {
    if (c !== sender && c.readyState === WebSocket.OPEN) c.send(str);
  });
}
function broadcastAll(roomId: string, msg: object) {
  const str = JSON.stringify(msg);
  rooms.get(roomId)?.forEach(c => { if (c.readyState === WebSocket.OPEN) c.send(str); });
}

function getLayerLimit(canvasW: number, canvasH: number): number {
  const px = canvasW * canvasH;
  if (px === 0)          return 12;
  if (px <= 1920*1080)   return 10;
  if (px <= 2048*2048)   return 8;
  if (px <= 2480*3508)   return 6;
  if (px <= 3840*2160)   return 4;
  return 2;
}

wss.on("connection", (ws: WebSocket) => {
  let roomId   = "default";
  let username = "Invitado";
  const userId = Math.random().toString(36).substring(2, 9);

  ws.on("message", (raw: Buffer) => {
    let data: any;
    try { data = JSON.parse(raw.toString()); } catch { return; }

    if (data.type === "ping") { ws.send('{"type":"pong"}'); return; }

    if (data.type === "join") {
      username = (data.username || "Invitado").slice(0, 24);
      roomId   = data.room || "default";

      if (!rooms.has(roomId))       rooms.set(roomId, new Set());
      if (!roomStrokes.has(roomId)) roomStrokes.set(roomId, []);
      if (!roomUsers.has(roomId))   roomUsers.set(roomId, new Map());
      if (!roomLayers.has(roomId))  roomLayers.set(roomId, []);

      rooms.get(roomId)!.add(ws);
      roomUsers.get(roomId)!.set(userId, username);

      const layers  = roomLayers.get(roomId)!;
      const myLayer = layers.find(l => l.ownerId === userId);
      if (!myLayer) {
        const nl: Layer = { id: ++globalLayerId, name: "Capa 1", visible: true, opacity: 1, locked: false, ownerId: userId, ownerName: username };
        layers.push(nl);
        broadcast(roomId, ws, { type: "layer_added", layer: nl });
      }

      ws.send(JSON.stringify({
        type: "init",
        strokes:  roomStrokes.get(roomId) || [],
        bgColor:  roomBgColor.get(roomId) || null,
        layers:   roomLayers.get(roomId)  || [],
        myUserId: userId,
      }));

      const users = Array.from(roomUsers.get(roomId)!.values());
      broadcastAll(roomId, { type: "users", users });
      console.log(`👤 ${username}(${userId}) joined ${roomId}`);
      return;
    }

    if (data.type === "rename") {
      const name = (data.username || "Invitado").slice(0, 24);
      username = name;
      roomUsers.get(roomId)?.set(userId, name);
      const layers = roomLayers.get(roomId);
      if (layers) layers.forEach(l => { if (l.ownerId === userId) l.ownerName = name; });
      const users = Array.from(roomUsers.get(roomId)?.values() || []);
      broadcastAll(roomId, { type: "users", users });
      const myLayers = layers?.filter(l => l.ownerId === userId) || [];
      if (myLayers.length) broadcast(roomId, ws, { type: "layer_update", layers: myLayers, ownerId: userId });
      return;
    }

    if (data.type === "stroke") {
      const stroke = { ...data.stroke, _uid: userId };
      const list = roomStrokes.get(roomId)!;
      list.push(stroke);
      // FIX #11: bake automático si se supera el límite
      if (list.length > MAX_STROKES) {
        const keep = Math.floor(MAX_STROKES * 0.8);
        roomStrokes.set(roomId, list.slice(list.length - keep));
      }
      broadcast(roomId, ws, { type: "stroke", stroke: data.stroke, userId });
      return;
    }

    if (data.type === "stroke_update") {
      broadcast(roomId, ws, { ...data, userId });
      return;
    }

    if (data.type === "clear") {
      roomStrokes.set(roomId, []);
      broadcastAll(roomId, { type: "clear" });
      return;
    }

    if (data.type === "bgcolor") {
      roomBgColor.set(roomId, data.color);
      broadcast(roomId, ws, { type: "bgcolor", color: data.color });
      return;
    }

    // FIX #12: throttle de cursores en servidor
    if (data.type === "cursor") {
      const key  = `${roomId}:${userId}`;
      const now  = Date.now();
      const last = cursorThrottle.get(key) || 0;
      if (now - last < CURSOR_MS) return;
      cursorThrottle.set(key, now);
      broadcast(roomId, ws, { type: "cursor", x: data.x, y: data.y, userId, username });
      return;
    }

    // FIX #2 y #9: undo_sync solo envía strokes PROPIOS, reconstruye solo capas afectadas
    if (data.type === "undo_sync") {
      const list   = roomStrokes.get(roomId) || [];
      const others = list.filter((s: any) => s._uid !== userId);
      const mine   = (data.strokes || []).map((s: any) => ({ ...s, _uid: userId }));
      roomStrokes.set(roomId, [...others, ...mine]);
      // Solo enviar los strokes del userId que hizo undo, con las capas afectadas
      const affectedLayers = [...new Set(mine.map((s: any) => s.layerId).filter(Boolean))];
      broadcast(roomId, ws, { type: "undo_sync_remote", strokes: mine, userId, affectedLayers });
      return;
    }

    if (data.type === "layer_add") {
      const layers   = roomLayers.get(roomId)!;
      const myLayers = layers.filter(l => l.ownerId === userId);
      const limit    = getLayerLimit(data.canvasW || 0, data.canvasH || 0);
      if (myLayers.length >= limit) { ws.send(JSON.stringify({ type: "layer_limit_reached", limit })); return; }
      const nl: Layer = {
        id: ++globalLayerId,
        name: (data.name || `Capa ${myLayers.length + 1}`).slice(0, 32),
        visible: true, opacity: 1, locked: false,
        ownerId: userId, ownerName: username,
      };
      layers.push(nl);
      broadcastAll(roomId, { type: "layer_added", layer: nl });
      return;
    }

    if (data.type === "layer_update") {
      const layers   = roomLayers.get(roomId)!;
      const incoming = (data.layers as Layer[]).filter(l => l.ownerId === userId);
      const others   = layers.filter(l => l.ownerId !== userId);
      roomLayers.set(roomId, [...others, ...incoming]);
      broadcast(roomId, ws, { type: "layer_update", layers: incoming, ownerId: userId });
      return;
    }

    if (data.type === "layer_delete") {
      const layers   = roomLayers.get(roomId)!;
      const myLayers = layers.filter(l => l.ownerId === userId);
      if (myLayers.length <= 1) return;
      roomLayers.set(roomId, layers.filter(l => l.id !== data.layerId || l.ownerId !== userId));
      broadcastAll(roomId, { type: "layer_deleted", layerId: data.layerId });
      return;
    }

    if (data.type === "layer_reorder") {
      const layers = roomLayers.get(roomId)!;
      const others = layers.filter(l => l.ownerId !== userId);
      const mine   = layers.filter(l => l.ownerId === userId);
      const { fromIdx, toIdx } = data;
      if (fromIdx < 0 || toIdx < 0 || fromIdx >= mine.length || toIdx >= mine.length) return;
      const r = [...mine];
      const [m] = r.splice(fromIdx, 1);
      if (!m) return;
      r.splice(toIdx, 0, m);
      roomLayers.set(roomId, [...others, ...r]);
      broadcast(roomId, ws, { type: "layer_reorder", ownerId: userId, order: r.map(l => l.id) });
      return;
    }

    // fallback
    broadcast(roomId, ws, { ...data, userId });
  });

  ws.on("close", () => {
    rooms.get(roomId)?.delete(ws);
    roomUsers.get(roomId)?.delete(userId);
    cursorThrottle.delete(`${roomId}:${userId}`);
    const users = Array.from(roomUsers.get(roomId)?.values() || []);
    broadcastAll(roomId, { type: "users", users });
    console.log(`👋 ${username} left ${roomId}`);
  });
});

httpServer.listen(port);
console.log(`🚀 PeonyPaint :${port}`);