import { WebSocketServer, WebSocket } from "ws";
import { createServer } from "http";
import { readFileSync, existsSync } from "fs";
import { join, extname } from "path";
import { Pool } from "pg";

type Point  = { x: number; y: number };
type Stroke = { _sid?: string; points: Point[]; color: string; size: number; opacity: number; eraser: boolean; layerId?: number; _uid?: string; };
type Layer  = { id: number; name: string; visible: boolean; opacity: number; locked: boolean; ownerId: string; ownerName: string; blendMode?: string; };

const port     = Number(process.env.PORT) || 3001;
const distPath = join(process.cwd(), "dist");
const MAX_STROKES = 6000;

// ─── DB (persistencia real — sobrevive reinicios de Render) ─────────────────
const DATABASE_URL = process.env.DATABASE_URL;
const db = DATABASE_URL ? new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 8000,
}) : null;

if (!db) console.warn("⚠️  DATABASE_URL no configurada — los datos NO persistirán entre reinicios");

async function initDB() {
  if (!db) return;
  await db.query(`
    CREATE TABLE IF NOT EXISTS rooms (
      id TEXT PRIMARY KEY,
      bg_color TEXT NOT NULL DEFAULT '#111111',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS layers (
      id BIGINT PRIMARY KEY,
      room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      visible BOOLEAN NOT NULL DEFAULT TRUE,
      opacity REAL NOT NULL DEFAULT 1,
      locked BOOLEAN NOT NULL DEFAULT FALSE,
      owner_id TEXT NOT NULL,
      owner_name TEXT NOT NULL,
      blend_mode TEXT DEFAULT 'normal'
    );
    CREATE TABLE IF NOT EXISTS strokes (
      sid TEXT PRIMARY KEY,
      room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
      layer_id BIGINT,
      user_id TEXT NOT NULL,
      data JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS images (
      id BIGSERIAL PRIMARY KEY,
      room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
      data TEXT NOT NULL,
      x FLOAT NOT NULL, y FLOAT NOT NULL, w FLOAT NOT NULL, h FLOAT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_strokes_room ON strokes(room_id);
    CREATE INDEX IF NOT EXISTS idx_layers_room  ON layers(room_id);
    CREATE INDEX IF NOT EXISTS idx_images_room  ON images(room_id);
  `);
  console.log("✅ DB lista — persistencia activa");
}

async function dbLoadRoom(roomId: string) {
  if (!db) return { strokes: [], layers: [], images: [], bgColor: "#111111" };
  const [s, l, i, r] = await Promise.all([
    db.query(`SELECT sid, layer_id, user_id, data FROM strokes WHERE room_id=$1 ORDER BY created_at`, [roomId]),
    db.query(`SELECT * FROM layers WHERE room_id=$1`, [roomId]),
    db.query(`SELECT id, data, x, y, w, h FROM images WHERE room_id=$1`, [roomId]),
    db.query(`SELECT bg_color FROM rooms WHERE id=$1`, [roomId]),
  ]);
  const strokes = s.rows.map(row => ({ ...row.data, _sid: row.sid, layerId: row.layer_id, _uid: row.user_id }));
  const layers: Layer[] = l.rows.map(row => ({
    id: Number(row.id), name: row.name, visible: row.visible, opacity: row.opacity,
    locked: row.locked, ownerId: row.owner_id, ownerName: row.owner_name, blendMode: row.blend_mode,
  }));
  return { strokes, layers, images: i.rows, bgColor: r.rows[0]?.bg_color ?? "#111111" };
}
async function dbEnsureRoom(roomId: string) {
  if (!db) return;
  await db.query(`INSERT INTO rooms(id) VALUES($1) ON CONFLICT(id) DO NOTHING`, [roomId]);
}
async function dbSaveStroke(roomId: string, userId: string, stroke: any) {
  if (!db) return;
  const { _uid, _sid, layerId, ...clean } = stroke;
  try {
    await db.query(
      `INSERT INTO strokes(sid, room_id, layer_id, user_id, data) VALUES($1,$2,$3,$4,$5)
       ON CONFLICT (sid) DO NOTHING`,
      [_sid, roomId, layerId ?? null, userId, JSON.stringify(clean)]
    );
  } catch (e) { console.error("dbSaveStroke", e); }
}
async function dbSyncUserStrokes(roomId: string, userId: string, strokes: any[]) {
  if (!db) return;
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query(`DELETE FROM strokes WHERE room_id=$1 AND user_id=$2`, [roomId, userId]);
    for (const s of strokes) {
      const { _uid, _sid, layerId, ...clean } = s;
      await client.query(
        `INSERT INTO strokes(sid, room_id, layer_id, user_id, data) VALUES($1,$2,$3,$4,$5)`,
        [_sid, roomId, layerId ?? null, userId, JSON.stringify(clean)]
      );
    }
    await client.query("COMMIT");
  } catch (e) { await client.query("ROLLBACK"); console.error("dbSyncUserStrokes", e); }
  finally { client.release(); }
}
async function dbClearRoom(roomId: string) {
  if (!db) return;
  await db.query(`DELETE FROM strokes WHERE room_id=$1`, [roomId]);
  await db.query(`DELETE FROM images  WHERE room_id=$1`, [roomId]);
}
async function dbSetBg(roomId: string, color: string) {
  if (!db) return;
  await db.query(`UPDATE rooms SET bg_color=$1, updated_at=NOW() WHERE id=$2`, [color, roomId]);
}
async function dbAddLayer(roomId: string, layer: Layer) {
  if (!db) return;
  await db.query(
    `INSERT INTO layers(id,room_id,name,visible,opacity,locked,owner_id,owner_name,blend_mode)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(id) DO NOTHING`,
    [layer.id, roomId, layer.name, layer.visible, layer.opacity, layer.locked, layer.ownerId, layer.ownerName, layer.blendMode ?? "normal"]
  );
}
async function dbUpdateLayers(roomId: string, layers: Layer[]) {
  if (!db) return;
  for (const l of layers) {
    await db.query(
      `UPDATE layers SET name=$1, visible=$2, opacity=$3, locked=$4, owner_name=$5, blend_mode=$6 WHERE id=$7 AND room_id=$8`,
      [l.name, l.visible, l.opacity, l.locked, l.ownerName, l.blendMode ?? "normal", l.id, roomId]
    );
  }
}
async function dbDeleteLayer(layerId: number) {
  if (!db) return;
  await db.query(`DELETE FROM layers WHERE id=$1`, [layerId]);
  await db.query(`DELETE FROM strokes WHERE layer_id=$1`, [layerId]);
}
async function dbAddImage(roomId: string, img: { data: string; x: number; y: number; w: number; h: number }) {
  if (!db) return null;
  const res = await db.query(
    `INSERT INTO images(room_id,data,x,y,w,h) VALUES($1,$2,$3,$4,$5,$6) RETURNING id`,
    [roomId, img.data, img.x, img.y, img.w, img.h]
  );
  return Number(res.rows[0].id);
}
async function dbDeleteImage(id: number) {
  if (!db) return;
  await db.query(`DELETE FROM images WHERE id=$1`, [id]);
}

// ─── HTTP estático ────────────────────────────────────────────────────────
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

// ─── Cache en memoria (espejo de la DB, para velocidad) ──────────────────
const rooms       = new Map<string, Set<WebSocket>>();
const roomStrokes = new Map<string, Stroke[]>();
const roomUsers   = new Map<string, Map<string, string>>();
const roomBgColor = new Map<string, string>();
const roomLayers  = new Map<string, Layer[]>();
const roomLoaded  = new Map<string, boolean>(); // si ya se cargó de DB
const cursorThrottle = new Map<string, number>();
const CURSOR_MS = 50;

let globalLayerId = 100;

function broadcast(roomId: string, sender: WebSocket | null, msg: object) {
  const str = JSON.stringify(msg);
  rooms.get(roomId)?.forEach(c => { if (c !== sender && c.readyState === WebSocket.OPEN) c.send(str); });
}
function broadcastAll(roomId: string, msg: object) {
  const str = JSON.stringify(msg);
  rooms.get(roomId)?.forEach(c => { if (c.readyState === WebSocket.OPEN) c.send(str); });
}
function getLayerLimit(canvasW: number, canvasH: number): number {
  const px = canvasW * canvasH;
  if (px === 0) return 12;
  if (px <= 1920*1080) return 10;
  if (px <= 2048*2048) return 8;
  if (px <= 2480*3508) return 6;
  if (px <= 3840*2160) return 4;
  return 2;
}

// Asegura que la sala esté cargada en memoria desde DB (solo la primera vez)
async function ensureRoomLoaded(roomId: string) {
  if (roomLoaded.get(roomId)) return;
  await dbEnsureRoom(roomId);
  const { strokes, layers, images, bgColor } = await dbLoadRoom(roomId);
  roomStrokes.set(roomId, strokes as Stroke[]);
  roomLayers.set(roomId, layers);
  roomBgColor.set(roomId, bgColor);
  // Guardamos images en una Map separada simple (no había antes)
  roomImagesCache.set(roomId, images.map((r: any) => ({ id: Number(r.id), data: r.data, x: r.x, y: r.y, w: r.w, h: r.h })));
  roomLoaded.set(roomId, true);
  // Ajustar globalLayerId para no colisionar con IDs ya existentes
  for (const l of layers) if (l.id > globalLayerId) globalLayerId = l.id;
}
const roomImagesCache = new Map<string, any[]>();

wss.on("connection", (ws: WebSocket) => {
  let roomId   = "default";
  let username = "Invitado";
  const userId = Math.random().toString(36).substring(2, 9);

  ws.on("message", async (raw: Buffer) => {
    let data: any;
    try { data = JSON.parse(raw.toString()); } catch { return; }

    if (data.type === "ping") { ws.send('{"type":"pong"}'); return; }

    if (data.type === "join") {
      username = (data.username || "Invitado").slice(0, 24);
      roomId   = data.room || "default";

      if (!rooms.has(roomId))     rooms.set(roomId, new Set());
      if (!roomUsers.has(roomId)) roomUsers.set(roomId, new Map());

      rooms.get(roomId)!.add(ws);
      roomUsers.get(roomId)!.set(userId, username);

      try { await ensureRoomLoaded(roomId); }
      catch (e) { console.error("ensureRoomLoaded", e); }

      if (!roomStrokes.has(roomId)) roomStrokes.set(roomId, []);
      if (!roomLayers.has(roomId))  roomLayers.set(roomId, []);

      const layers  = roomLayers.get(roomId)!;
      const myLayer = layers.find(l => l.ownerId === userId);
      if (!myLayer) {
        const nl: Layer = { id: ++globalLayerId, name: "Capa 1", visible: true, opacity: 1, locked: false, ownerId: userId, ownerName: username };
        layers.push(nl);
        dbAddLayer(roomId, nl).catch(e => console.error("dbAddLayer", e));
        broadcast(roomId, ws, { type: "layer_added", layer: nl });
      }

      ws.send(JSON.stringify({
        type: "init",
        strokes:  roomStrokes.get(roomId) || [],
        images:   roomImagesCache.get(roomId) || [],
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
      if (layers) {
        const mine = layers.filter(l => l.ownerId === userId);
        mine.forEach(l => { l.ownerName = name; });
        if (mine.length) dbUpdateLayers(roomId, mine).catch(e => console.error(e));
      }
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
      if (list.length > MAX_STROKES) {
        const keep = Math.floor(MAX_STROKES * 0.8);
        roomStrokes.set(roomId, list.slice(list.length - keep));
      }
      dbSaveStroke(roomId, userId, stroke).catch(e => console.error("dbSaveStroke", e));
      broadcast(roomId, ws, { type: "stroke", stroke: data.stroke, userId });
      return;
    }

    if (data.type === "stroke_update") { broadcast(roomId, ws, { ...data, userId }); return; }

    if (data.type === "clear") {
      roomStrokes.set(roomId, []);
      roomImagesCache.set(roomId, []);
      dbClearRoom(roomId).catch(e => console.error("dbClearRoom", e));
      broadcastAll(roomId, { type: "clear" });
      return;
    }

    if (data.type === "bgcolor") {
      roomBgColor.set(roomId, data.color);
      dbSetBg(roomId, data.color).catch(e => console.error("dbSetBg", e));
      broadcast(roomId, ws, { type: "bgcolor", color: data.color });
      return;
    }

    if (data.type === "cursor") {
      const key = `${roomId}:${userId}`;
      const now = Date.now();
      const last = cursorThrottle.get(key) || 0;
      if (now - last < CURSOR_MS) return;
      cursorThrottle.set(key, now);
      broadcast(roomId, ws, { type: "cursor", x: data.x, y: data.y, userId, username });
      return;
    }

    if (data.type === "undo_sync") {
      const list   = roomStrokes.get(roomId) || [];
      const others = list.filter((s: any) => s._uid !== userId);
      const mine   = (data.strokes || []).map((s: any) => ({ ...s, _uid: userId }));
      roomStrokes.set(roomId, [...others, ...mine]);
      dbSyncUserStrokes(roomId, userId, mine).catch(e => console.error("dbSyncUserStrokes", e));
      const affectedLayers = [...new Set(mine.map((s: any) => s.layerId).filter((v: any) => v != null))];
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
      dbAddLayer(roomId, nl).catch(e => console.error("dbAddLayer", e));
      broadcastAll(roomId, { type: "layer_added", layer: nl });
      return;
    }

    if (data.type === "layer_update") {
      const layers   = roomLayers.get(roomId)!;
      const incoming = (data.layers as Layer[]).filter(l => l.ownerId === userId);
      const others   = layers.filter(l => l.ownerId !== userId);
      roomLayers.set(roomId, [...others, ...incoming]);
      dbUpdateLayers(roomId, incoming).catch(e => console.error("dbUpdateLayers", e));
      broadcast(roomId, ws, { type: "layer_update", layers: incoming, ownerId: userId });
      return;
    }

    if (data.type === "layer_delete") {
      const layers   = roomLayers.get(roomId)!;
      const myLayers = layers.filter(l => l.ownerId === userId);
      if (myLayers.length <= 1) return;
      roomLayers.set(roomId, layers.filter(l => l.id !== data.layerId || l.ownerId !== userId));
      dbDeleteLayer(data.layerId).catch(e => console.error("dbDeleteLayer", e));
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

    if (data.type === "image_add") {
      const dbId = await dbAddImage(roomId, { data: data.data, x: data.x, y: data.y, w: data.w, h: data.h }).catch(e => { console.error("dbAddImage", e); return null; });
      const id = dbId ?? Date.now();
      const img = { id, data: data.data, x: data.x, y: data.y, w: data.w, h: data.h };
      const cache = roomImagesCache.get(roomId) || [];
      cache.push(img);
      roomImagesCache.set(roomId, cache);
      ws.send(JSON.stringify({ type: "image_added", image: img }));
      broadcast(roomId, ws, { type: "image_added", image: img });
      return;
    }
    if (data.type === "image_delete") {
      dbDeleteImage(data.id).catch(e => console.error("dbDeleteImage", e));
      const cache = (roomImagesCache.get(roomId) || []).filter((i: any) => i.id !== data.id);
      roomImagesCache.set(roomId, cache);
      broadcastAll(roomId, { type: "image_deleted", id: data.id });
      return;
    }

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

initDB()
  .then(() => httpServer.listen(port, () => console.log(`🚀 PeonyPaint :${port}`)))
  .catch(e => {
    console.error("DB init failed, arrancando sin persistencia:", e);
    httpServer.listen(port, () => console.log(`🚀 PeonyPaint :${port} (sin DB)`));
  });