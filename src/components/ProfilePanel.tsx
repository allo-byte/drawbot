import { useState, useRef, useEffect } from "react";

// Avatares predeterminados — emojis como placeholders hasta que tengas los assets
// Cuando tengas las imágenes, cambia AVATARS por URLs de imágenes
export const AVATARS = [
  { id: "a1", emoji: "🐱", label: "Gato"      },
  { id: "a2", emoji: "🐶", label: "Perro"     },
  { id: "a3", emoji: "🦊", label: "Zorro"     },
  { id: "a4", emoji: "🐺", label: "Lobo"      },
  { id: "a5", emoji: "🐸", label: "Rana"      },
  { id: "a6", emoji: "🐻", label: "Oso"       },
  { id: "a7", emoji: "🐼", label: "Panda"     },
  { id: "a8", emoji: "🦁", label: "León"      },
  { id: "a9", emoji: "🐯", label: "Tigre"     },
  { id:"a10", emoji: "🐨", label: "Koala"     },
  { id:"a11", emoji: "🦝", label: "Mapache"   },
  { id:"a12", emoji: "🐰", label: "Conejo"    },
  { id:"a13", emoji: "🦋", label: "Mariposa"  },
  { id:"a14", emoji: "🐙", label: "Pulpo"     },
  { id:"a15", emoji: "🦄", label: "Unicornio" },
  { id:"a16", emoji: "🐲", label: "Dragón"    },
];

export type Profile = {
  username:  string;
  avatarId:  string;   // id del avatar predeterminado
  avatarUrl: string;   // URL si subió foto propia (vacío si usa predeterminado)
};

export function getStoredProfile(): Profile {
  try {
    const raw = localStorage.getItem("peonypaint-profile");
    if (raw) return JSON.parse(raw);
  } catch {}
  return { username: "Invitado", avatarId: "a1", avatarUrl: "" };
}

export function saveProfile(p: Profile) {
  localStorage.setItem("peonypaint-profile", JSON.stringify(p));
  // Compatibilidad con el sistema anterior
  localStorage.setItem("drawbot-name", p.username);
}

export function AvatarDisplay({
  profile, size = 32, style
}: { profile: Profile; size?: number; style?: React.CSSProperties }) {
  if (profile.avatarUrl) {
    return (
      <img
        src={profile.avatarUrl}
        style={{
          width: size, height: size, borderRadius: "50%",
          objectFit: "cover", flexShrink: 0,
          border: "1.5px solid rgba(255,255,255,0.15)",
          ...style,
        }}
      />
    );
  }
  const av = AVATARS.find(a => a.id === profile.avatarId) || AVATARS[0];
  return (
    <div style={{
      width: size, height: size, borderRadius: "50%",
      background: "#1e1e2e", border: "1.5px solid #333",
      display: "flex", alignItems: "center", justifyContent: "center",
      fontSize: size * 0.52, flexShrink: 0, lineHeight: 1,
      ...style,
    }}>{av.emoji}</div>
  );
}

// Avatar para usuarios remotos (solo tienen username, no profile completo)
export function RemoteAvatar({ username, size = 28 }: { username: string; size?: number }) {
  const colors = ["#e05d5d","#e09a3a","#d4c94a","#5dbe6e","#4ab8d4","#7070dd","#c46edd","#dd6eaa"];
  let hash = 0;
  for (let i = 0; i < username.length; i++) hash = username.charCodeAt(i) + ((hash << 5) - hash);
  const bg = colors[Math.abs(hash) % colors.length];
  return (
    <div style={{
      width: size, height: size, borderRadius: "50%",
      background: bg, color: "#fff",
      display: "flex", alignItems: "center", justifyContent: "center",
      fontSize: size * 0.38, fontWeight: "bold", flexShrink: 0,
      border: "1.5px solid rgba(255,255,255,0.15)",
    }}>{username.trim().slice(0,2).toUpperCase() || "?"}</div>
  );
}

type Props = {
  profile:   Profile;
  users:     string[];
  onSave:    (p: Profile) => void;
  onClose:   () => void;
};

export default function ProfilePanel({ profile, users, onSave, onClose }: Props) {
  const [draft,      setDraft     ] = useState<Profile>({ ...profile });
  const [tab,        setTab       ] = useState<"avatar"|"upload">("avatar");
  const [uploading,  setUploading ] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => { nameRef.current?.focus(); }, []);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    const reader = new FileReader();
    reader.onload = (ev) => {
      const src = ev.target?.result as string;
      // Comprimir a 128x128
      const img = new Image();
      img.onload = () => {
        const c = document.createElement("canvas");
        c.width = c.height = 128;
        const ctx = c.getContext("2d")!;
        // Crop cuadrado centrado
        const min = Math.min(img.width, img.height);
        const sx  = (img.width  - min) / 2;
        const sy  = (img.height - min) / 2;
        ctx.drawImage(img, sx, sy, min, min, 0, 0, 128, 128);
        const url = c.toDataURL("image/jpeg", 0.85);
        setDraft(d => ({ ...d, avatarUrl: url, avatarId: "" }));
        setUploading(false);
      };
      img.src = src;
    };
    reader.readAsDataURL(file);
  };

  const handleSave = () => {
    const p = { ...draft, username: draft.username.trim() || "Invitado" };
    onSave(p);
    onClose();
  };

  return (
    <>
      <style>{`
        .pp-wrap {
          position:fixed; top:60px; left:4px;
          width:300px;
          background:rgba(14,14,14,0.98);
          border:0.5px solid #2a2a2a;
          border-radius:14px;
          box-shadow:0 8px 32px rgba(0,0,0,0.7);
          z-index:1100;
          overflow:hidden;
          font-family:system-ui,sans-serif;
        }
        .pp-header {
          padding:14px 16px 10px;
          border-bottom:0.5px solid #1e1e1e;
          display:flex; align-items:center; gap:10px;
        }
        .pp-preview-name {
          font-size:13px; color:#ccc; font-weight:500;
          white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
        }
        .pp-preview-sub { font-size:10px; color:#444; margin-top:1px; }
        .pp-body { padding:14px 16px; }
        .pp-label { font-size:10px; color:#444; text-transform:uppercase; letter-spacing:.07em; margin-bottom:6px; }
        .pp-input {
          width:100%; background:#111; border:0.5px solid #333;
          border-radius:8px; color:#ccc; font-size:13px;
          padding:8px 10px; outline:none; box-sizing:border-box;
          transition:border-color .12s;
        }
        .pp-input:focus { border-color:#7070dd; }
        .pp-tabs {
          display:flex; gap:4px; margin:14px 0 10px;
        }
        .pp-tab {
          flex:1; padding:6px; border-radius:7px;
          background:#111; border:0.5px solid #2a2a2a;
          color:#555; font-size:11px; cursor:pointer;
          text-align:center; transition:all .12s;
        }
        .pp-tab.active { background:#1e1e3a; border-color:#7070dd; color:#aaaaff; }
        .pp-avatar-grid {
          display:grid; grid-template-columns:repeat(8,1fr); gap:4px;
          max-height:130px; overflow-y:auto; padding:2px;
        }
        .pp-avatar-grid::-webkit-scrollbar { width:3px; }
        .pp-avatar-grid::-webkit-scrollbar-thumb { background:#2a2a2a; border-radius:2px; }
        .pp-av-item {
          aspect-ratio:1; border-radius:8px;
          background:#1a1a1a; border:1.5px solid transparent;
          display:flex; align-items:center; justify-content:center;
          font-size:22px; cursor:pointer; transition:all .12s;
        }
        .pp-av-item:hover { background:#222; border-color:#444; transform:scale(1.08); }
        .pp-av-item.sel { border-color:#7070dd; background:#1e1e3a; }
        .pp-upload-area {
          border:1.5px dashed #2a2a2a; border-radius:10px;
          padding:20px; text-align:center; cursor:pointer;
          transition:border-color .12s, background .12s;
        }
        .pp-upload-area:hover { border-color:#555; background:#111; }
        .pp-upload-icon { font-size:28px; margin-bottom:6px; }
        .pp-upload-hint { font-size:11px; color:#444; }
        .pp-upload-preview {
          width:80px; height:80px; border-radius:50%;
          object-fit:cover; border:2px solid #7070dd;
          display:block; margin:0 auto 8px;
        }
        .pp-footer {
          padding:10px 16px 14px;
          border-top:0.5px solid #1a1a1a;
          display:flex; gap:8px;
        }
        .pp-btn {
          flex:1; padding:8px; border-radius:8px;
          font-size:13px; cursor:pointer; transition:all .12s;
        }
        .pp-btn-cancel {
          background:#111; border:0.5px solid #2a2a2a; color:#555;
        }
        .pp-btn-cancel:hover { border-color:#444; color:#888; }
        .pp-btn-save {
          background:#1e1e3a; border:0.5px solid #7070dd; color:#aaaaff;
        }
        .pp-btn-save:hover { background:#2a2a5a; }
        .pp-sep { height:0.5px; background:#1a1a1a; margin:12px 0 10px; }
        .pp-users-title { font-size:10px; color:#333; text-transform:uppercase; letter-spacing:.07em; margin-bottom:6px; }
        .pp-user-row { display:flex; align-items:center; gap:8px; padding:4px 0; }
        .pp-user-name { font-size:12px; color:#555; }
        .pp-you { font-size:9px; color:#7070dd; background:#1e1e3a; border-radius:4px; padding:1px 5px; }
      `}</style>

      <div className="pp-wrap">
        {/* Header con preview */}
        <div className="pp-header">
          <AvatarDisplay profile={draft} size={40}/>
          <div style={{flex:1, minWidth:0}}>
            <div className="pp-preview-name">{draft.username || "Invitado"}</div>
            <div className="pp-preview-sub">Tu perfil en PeonyPaint</div>
          </div>
        </div>

        <div className="pp-body">
          {/* Nombre */}
          <div className="pp-label">Nombre</div>
          <input
            ref={nameRef}
            className="pp-input"
            value={draft.username}
            maxLength={24}
            placeholder="Tu nombre..."
            onChange={e => setDraft(d => ({ ...d, username: e.target.value }))}
            onKeyDown={e => { if (e.key==="Enter") handleSave(); e.stopPropagation(); }}
          />

          {/* Tabs avatar */}
          <div className="pp-tabs">
            <div className={`pp-tab${tab==="avatar"?" active":""}`} onClick={() => setTab("avatar")}>
              Avatares
            </div>
            <div className={`pp-tab${tab==="upload"?" active":""}`} onClick={() => setTab("upload")}>
              Foto propia
            </div>
          </div>

          {tab === "avatar" && (
            <div className="pp-avatar-grid">
              {AVATARS.map(av => (
                <div
                  key={av.id}
                  className={`pp-av-item${draft.avatarId===av.id && !draft.avatarUrl?" sel":""}`}
                  title={av.label}
                  onClick={() => setDraft(d => ({ ...d, avatarId: av.id, avatarUrl: "" }))}
                >
                  {av.emoji}
                </div>
              ))}
            </div>
          )}

          {tab === "upload" && (
            <div>
              {draft.avatarUrl ? (
                <div style={{textAlign:"center"}}>
                  <img src={draft.avatarUrl} className="pp-upload-preview"/>
                  <button
                    className="pp-tab"
                    style={{width:"100%", marginTop:4}}
                    onClick={() => setDraft(d => ({ ...d, avatarUrl: "", avatarId: "a1" }))}
                  >Quitar foto</button>
                </div>
              ) : (
                <div
                  className="pp-upload-area"
                  onClick={() => fileRef.current?.click()}
                >
                  <div className="pp-upload-icon">{uploading ? "⏳" : "📷"}</div>
                  <div className="pp-upload-hint">
                    {uploading ? "Procesando..." : "Toca para subir imagen"}
                  </div>
                </div>
              )}
              <input
                ref={fileRef} type="file"
                accept="image/*" style={{display:"none"}}
                onChange={handleFile}
              />
            </div>
          )}

          {/* Usuarios en sala */}
          {users.length > 0 && (
            <>
              <div className="pp-sep"/>
              <div className="pp-users-title">En sala ({users.length})</div>
              {users.slice(0,6).map((u,i) => (
                <div key={i} className="pp-user-row">
                  <RemoteAvatar username={u} size={22}/>
                  <span className="pp-user-name">{u}</span>
                  {u === draft.username && <span className="pp-you">tú</span>}
                </div>
              ))}
              {users.length > 6 && (
                <div style={{fontSize:10, color:"#333", marginTop:4}}>+{users.length-6} más</div>
              )}
            </>
          )}
        </div>

        <div className="pp-footer">
          <button className="pp-btn pp-btn-cancel" onClick={onClose}>Cancelar</button>
          <button className="pp-btn pp-btn-save" onClick={handleSave}>Guardar</button>
        </div>
      </div>
    </>
  );
}