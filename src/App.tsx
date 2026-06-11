import { useState } from "react";
import Canvas from "./components/Canvas";
import Toolbar from "./components/Toolbar";

function App() {
  const [color, setColor] = useState("#ffffff");
  const [brushSize, setBrushSize] = useState(5);
  const [opacity, setOpacity] = useState(1);
  const [eraser, setEraser] = useState(false);
  const [savePNG, setSavePNG] = useState<() => void>(() => () => {});
  const [users, setUsers] = useState<string[]>([]);
  const [username, setUsername] = useState(
    localStorage.getItem("drawbot-name") || "Invitado"
  );

  const room =
    new URLSearchParams(window.location.search).get("room") || "default";

  const createRoom = () => {
    const newRoom = Math.random().toString(36).substring(2, 8);
    window.location.href = `/?room=${newRoom}`;
  };

  const copyRoomLink = async () => {
    await navigator.clipboard.writeText(window.location.href);
    alert("✅ Enlace copiado");
  };

  return (
    <>
      <Toolbar
        color={color}
        setColor={setColor}
        brushSize={brushSize}
        setBrushSize={setBrushSize}
        opacity={opacity}
        setOpacity={setOpacity}
        eraser={eraser}
        setEraser={setEraser}
        savePNG={savePNG}
        users={users}
        username={username}
        setUsername={setUsername}
        room={room}
        createRoom={createRoom}
        copyRoomLink={copyRoomLink}
      />

      <Canvas
        color={color}
        username={username}
        brushSize={brushSize}
        opacity={opacity}
        eraser={eraser}
        setUsers={setUsers}
        onReady={(saveFn) => setSavePNG(() => saveFn)}
      />
    </>
  );
}

export default App;