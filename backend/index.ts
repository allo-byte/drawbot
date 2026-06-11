import {
  WebSocketServer,
  WebSocket,
} from "ws";

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

const wss = new WebSocketServer({
  port: 3001,
});

const rooms = new Map<
  string,
  Set<WebSocket>
>();

const roomStrokes = new Map<
  string,
  Stroke[]
>();

// ✅ FIXED: Map<roomId, Map<userId, username>>
// Antes era Set<{userId, username}> — el .delete() en un Set de objetos
// nunca funciona porque compara referencias, no valores.
const roomUsers = new Map<
  string,
  Map<string, string>
>();

console.log(
  "🚀 DrawBot Server running on :3001"
);

wss.on(
  "connection",
  (ws: WebSocket) => {
    let roomId = "default";
    let username = "Invitado";

    const userId = Math.random()
      .toString(36)
      .substring(2, 9);

    ws.on(
      "message",
      (message: Buffer) => {
        const data = JSON.parse(
          message.toString()
        );

        if (data.type === "join") {
          username =
            data.username ||
            "Invitado";

          roomId = data.room;

          if (!rooms.has(roomId)) {
            rooms.set(
              roomId,
              new Set()
            );
          }

          if (!roomStrokes.has(roomId)) {
            roomStrokes.set(
              roomId,
              []
            );
          }

          if (!roomUsers.has(roomId)) {
            // ✅ FIXED: Map en vez de Set
            roomUsers.set(
              roomId,
              new Map()
            );
          }

          rooms
            .get(roomId)
            ?.add(ws);

          // ✅ FIXED: set(userId, username) — borrado O(1) y confiable
          roomUsers
            .get(roomId)
            ?.set(userId, username);

          ws.send(
            JSON.stringify({
              type: "init",
              strokes:
                roomStrokes.get(
                  roomId
                ) || [],
            })
          );

          ws.send(
            JSON.stringify({
              type: "user",
              userId: username,
            })
          );

          // ✅ FIXED: Array.from del Map
          const users = Array.from(
            roomUsers.get(roomId)?.values() || []
          );

          rooms
            .get(roomId)
            ?.forEach((client) => {
              if (
                client.readyState ===
                WebSocket.OPEN
              ) {
                client.send(
                  JSON.stringify({
                    type: "users",
                    users,
                  })
                );
              }
            });

          console.log(
            `👤 ${username} joined room ${roomId} (total: ${roomUsers.get(roomId)?.size})`
          );

          return;
        }

        if (data.type === "stroke") {
          roomStrokes
            .get(roomId)
            ?.push(data.stroke);
        }

        if (data.type === "clear") {
          // Borra trazos del servidor
          roomStrokes.set(roomId, []);

          // Broadcast a todos en la sala (incluido quien limpió)
          rooms.get(roomId)?.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
              client.send(
                JSON.stringify({ type: "clear" })
              );
            }
          });

          return;
        }

        if (data.type === "cursor") {
          const room =
            rooms.get(roomId);

          if (!room) return;

          room.forEach(
            (client) => {
              if (
                client !== ws &&
                client.readyState ===
                  WebSocket.OPEN
              ) {
                client.send(
                  JSON.stringify({
                    type: "cursor",
                    x: data.x,
                    y: data.y,
                    userId,
                    username,
                  })
                );
              }
            }
          );

          return;
        }

        const room =
          rooms.get(roomId);

        if (!room) return;

        room.forEach((client) => {
          if (
            client !== ws &&
            client.readyState ===
              WebSocket.OPEN
          ) {
            client.send(
              JSON.stringify(data)
            );
          }
        });
      }
    );

    ws.on("close", () => {
      rooms
        .get(roomId)
        ?.delete(ws);

      // ✅ FIXED: delete por key (userId) — funciona siempre
      roomUsers
        .get(roomId)
        ?.delete(userId);

      const users = Array.from(
        roomUsers.get(roomId)?.values() || []
      );

      rooms
        .get(roomId)
        ?.forEach((client) => {
          if (
            client.readyState ===
            WebSocket.OPEN
          ) {
            client.send(
              JSON.stringify({
                type: "users",
                users,
              })
            );
          }
        });

      console.log(
        `👋 ${username} left room ${roomId} (total: ${roomUsers.get(roomId)?.size})`
      );
    });
  }
);