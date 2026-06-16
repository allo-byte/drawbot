import { useEffect, useRef } from "react";

type Point = { x: number; y: number };

export type BrushType =
  | "pen" | "caligraphy1" | "caligraphy2"
  | "airbrush" | "oil" | "crayon" | "marker" | "pencil";

type Stroke = {
  points:    Point[];
  color:     string;
  size:      number;
  opacity:   number;
  eraser:    boolean;
  brushType?: BrushType;
};

export type CanvasImage = {
  id:   number;
  data: string;   // base64 JPEG
  x:    number;
  y:    number;
  w:    number;
  h:    number;
};

type Cursor = { x: number; y: number; userId: string };
export type CanvasSize = { w: number; h: number } | null;

type Props = {
  color:      string;
  brushSize:  number;   // 1-2000
  opacity:    number;
  eraser:     boolean;
  brushType:  BrushType;
  panMode:    boolean;
  username:   string;
  bgColor:    string;
  canvasSize: CanvasSize;
  setUsers?:  (users: string[]) => void;
  onReady?:   (saveFn: () => void, uploadFn: (file: File) => void) => void;
  onBgColor?: (color: string) => void;
  onStrokeAdded?: (
    getMyStrokes: () => Stroke[],
    setMyStrokes:  (s: Stroke[]) => void
  ) => void;
  onStrokeFinished?: (color: string) => void;
};

// ─── utils ───────────────────────────────────────────────────────────────────
function hexRgb(hex: string) {
  const c = hex.replace("#", "");
  return { r: parseInt(c.slice(0,2),16), g: parseInt(c.slice(2,4),16), b: parseInt(c.slice(4,6),16) };
}
function prng(seed: number) {
  let s = (seed ^ 0xdeadbeef) >>> 0;
  s = Math.imul(s ^ (s >>> 16), 0x45d9f3b) >>> 0;
  s = Math.imul(s ^ (s >>> 16), 0x45d9f3b) >>> 0;
  return (s >>> 0) / 0xffffffff;
}

// ─── stamp cache ─────────────────────────────────────────────────────────────
const stampCache = new Map<string, HTMLCanvasElement>();
const STAMP_MAX  = 128;
function getCachedStamp(key: string, dim: number, paint: (sc: CanvasRenderingContext2D, half: number) => void) {
  if (stampCache.has(key)) return stampCache.get(key)!;
  const s = document.createElement("canvas");
  s.width = s.height = dim;
  paint(s.getContext("2d")!, dim / 2);
  if (stampCache.size >= STAMP_MAX) stampCache.delete(stampCache.keys().next().value!);
  stampCache.set(key, s);
  return s;
}

// ─── image cache ─────────────────────────────────────────────────────────────
const imgCache = new Map<number, HTMLImageElement>();
function getCachedImage(img: CanvasImage): HTMLImageElement | null {
  if (imgCache.has(img.id)) return imgCache.get(img.id)!;
  const el = new Image();
  el.onload = () => imgCache.set(img.id, el);
  el.src = img.data;
  return null; // se pintará en el próximo frame
}

const WORLD_W = 4096;
const WORLD_H = 4096;

export default function Canvas({
  color, brushSize, opacity, eraser, brushType, panMode, username,
  bgColor, canvasSize, setUsers, onReady, onBgColor,
  onStrokeAdded, onStrokeFinished,
}: Props) {
  const canvasRef          = useRef<HTMLCanvasElement>(null);
  const offscreenRef       = useRef<HTMLCanvasElement | null>(null);
  const remotePreviewsRef  = useRef<Map<string, Stroke>>(new Map());
  const wsRef              = useRef<WebSocket | null>(null);
  const cursorsRef         = useRef<Map<string, Cursor>>(new Map());
  const strokesRef         = useRef<Stroke[]>([]);
  const myStrokesRef       = useRef<Stroke[]>([]);
  const currentStrokeRef   = useRef<Stroke | null>(null);
  const offscreenCountRef  = useRef(0);
  const rafRef             = useRef<number | null>(null);
  const imagesRef          = useRef<CanvasImage[]>([]);

  const colorRef       = useRef(color);
  const sizeRef        = useRef(brushSize);
  const opacityRef     = useRef(opacity);
  const eraserRef      = useRef(eraser);
  const brushTypeRef   = useRef(brushType);
  const panModeRef     = useRef(panMode);
  const bgColorRef     = useRef(bgColor);
  const canvasSizeRef  = useRef(canvasSize);
  const panStartRef    = useRef<{x:number;y:number;vx:number;vy:number}|null>(null);
  const lastSentPtRef  = useRef(0);
  const lastSentMsRef  = useRef(0);
  const viewRef        = useRef({ x:0, y:0, scale:1 });
  const touchPtrsRef   = useRef<Map<number,{x:number;y:number}>>(new Map());
  const gestureRef     = useRef<{time:number;maxFingers:number;moved:boolean}|null>(null);

  const onStrokeAddedRef    = useRef(onStrokeAdded);
  const onStrokeFinishedRef = useRef(onStrokeFinished);

  colorRef.current      = color;
  sizeRef.current       = brushSize;
  opacityRef.current    = opacity;
  eraserRef.current     = eraser;
  brushTypeRef.current  = brushType;
  panModeRef.current    = panMode;
  bgColorRef.current    = bgColor;
  canvasSizeRef.current = canvasSize;
  onStrokeAddedRef.current    = onStrokeAdded;
  onStrokeFinishedRef.current = onStrokeFinished;

  const MIN_SCALE = 0.05, MAX_SCALE = 10;
  const GESTURE_MS = 350, GESTURE_PX = 12;
  const STREAM_PTS = 3,   STREAM_MS  = 32;

  const toWorld = (sx:number, sy:number) => {
    const v = viewRef.current;
    return { x:(sx-v.x)/v.scale, y:(sy-v.y)/v.scale };
  };

  // ─── drawStrokeFrom ──────────────────────────────────────────────────────
  const drawStrokeFrom = (ctx: CanvasRenderingContext2D, stroke: Stroke, fromIndex: number) => {
    const pts = stroke.points;
    if (pts.length < 1) return;
    const bt      = stroke.brushType ?? "pen";
    const col     = stroke.color;
    const sz      = stroke.size;
    const { r,g,b } = hexRgb(col);
    const erasing = stroke.eraser;
    const start   = Math.max(fromIndex === 0 ? 0 : fromIndex-1, 0);

    ctx.save();
    ctx.globalCompositeOperation = erasing ? "destination-out" : "source-over";
    if (erasing) ctx.globalAlpha = 1;

    if (bt === "pen") {
      if (pts.length < 2) { ctx.restore(); return; }
      ctx.globalAlpha = stroke.opacity;
      ctx.lineCap = "round"; ctx.lineJoin = "round";
      ctx.lineWidth = sz; ctx.strokeStyle = erasing ? "#000" : col;
      ctx.beginPath(); ctx.moveTo(pts[start].x, pts[start].y);
      for (let i=start+1;i<pts.length;i++) ctx.lineTo(pts[i].x,pts[i].y);
      ctx.stroke();

    } else if (bt==="caligraphy1"||bt==="caligraphy2") {
      if (pts.length<2){ctx.restore();return;}
      ctx.globalAlpha=stroke.opacity;
      const angle=bt==="caligraphy1"?Math.PI*0.75:Math.PI*0.25;
      const w=sz,h=Math.max(1,sz*0.18);
      const dim=Math.ceil(Math.sqrt(w*w+h*h))+4, half=dim/2;
      const stamp=getCachedStamp(`${bt}|${sz}|${col}|${erasing}`,dim,(sc)=>{
        sc.fillStyle=erasing?"#000":col;
        sc.translate(half,half);sc.rotate(angle);sc.fillRect(-w/2,-h/2,w,h);
      });
      for(let i=Math.max(start,1);i<pts.length;i++){
        const a=pts[i-1],bPt=pts[i];
        ctx.drawImage(stamp,(a.x+bPt.x)/2-half,(a.y+bPt.y)/2-half);
      }

    } else if (bt==="airbrush") {
      const density=Math.max(8,Math.floor(sz*2));
      const radius=sz*1.8;
      const dim=Math.ceil(radius*2)+4, half=dim/2;
      const stamp=getCachedStamp(`airbrush|${sz}|${r},${g},${b}|${stroke.opacity}|${erasing}`,dim,(sc)=>{
        sc.fillStyle=erasing?`rgba(0,0,0,${stroke.opacity*0.22})`:`rgba(${r},${g},${b},${stroke.opacity*0.22})`;
        for(let i=0;i<density;i++){
          const ang=prng(i*6271)*Math.PI*2;
          const rad=Math.sqrt(prng(i*7919))*radius;
          sc.beginPath();sc.arc(half+Math.cos(ang)*rad,half+Math.sin(ang)*rad,0.7,0,Math.PI*2);sc.fill();
        }
      });
      for(let p=start;p<pts.length;p++){
        const pt=pts[p];
        ctx.save();ctx.translate(pt.x,pt.y);ctx.rotate(prng(p*9973)*Math.PI*2);
        ctx.drawImage(stamp,-half,-half);ctx.restore();
      }

    } else if (bt==="oil") {
      if(pts.length<2){ctx.restore();return;}
      const bristles=Math.max(4,Math.floor(sz*0.6));
      ctx.lineCap="round";ctx.lineJoin="round";ctx.lineWidth=Math.max(0.8,sz*0.12);
      for(let b2=0;b2<bristles;b2++){
        ctx.globalAlpha=stroke.opacity*(0.55+prng(b2*3571)*0.45);
        const dr=Math.min(255,r+Math.floor(prng(b2*13)*30-15));
        const dg=Math.min(255,g+Math.floor(prng(b2*17)*30-15));
        const db2=Math.min(255,b+Math.floor(prng(b2*19)*30-15));
        ctx.strokeStyle=erasing?"#000":`rgb(${dr},${dg},${db2})`;
        const t=bristles>1?b2/(bristles-1)-0.5:0;
        ctx.beginPath();let moved=false;
        for(let i=start;i<pts.length;i++){
          const pt=pts[i];let dx=0,dy=1;
          if(i>0){dx=pt.x-pts[i-1].x;dy=pt.y-pts[i-1].y;const len=Math.sqrt(dx*dx+dy*dy)||1;dx/=len;dy/=len;}
          const px=-dy*t*sz+prng(b2*1009+i*503)*sz*0.06;
          const py= dx*t*sz+prng(b2*2003+i*701)*sz*0.06;
          if(!moved){ctx.moveTo(pt.x+px,pt.y+py);moved=true;}else ctx.lineTo(pt.x+px,pt.y+py);
        }
        ctx.stroke();
      }

    } else if (bt==="crayon") {
      if(pts.length<2){ctx.restore();return;}
      const grain=Math.max(3,Math.floor(sz*0.5));
      ctx.lineCap="round";ctx.lineJoin="round";
      for(let g2=0;g2<grain;g2++){
        const offX=(prng(g2*4001)-0.5)*sz*0.85;
        const offY=(prng(g2*5003)-0.5)*sz*0.85;
        ctx.globalAlpha=(0.12+prng(g2*7001)*0.3)*stroke.opacity;
        ctx.strokeStyle=erasing?"#000":col;
        ctx.lineWidth=Math.max(0.4,sz*0.08+prng(g2*3007)*sz*0.07);
        ctx.beginPath();ctx.moveTo(pts[start].x+offX,pts[start].y+offY);
        for(let i=start+1;i<pts.length;i++){
          ctx.lineTo(pts[i].x+offX+(prng(g2*1009+i*503)-0.5)*sz*0.12,
                     pts[i].y+offY+(prng(g2*2003+i*701)-0.5)*sz*0.12);
        }
        ctx.stroke();
      }

    } else if (bt==="marker") {
      if(pts.length<2){ctx.restore();return;}
      ctx.globalAlpha=Math.min(1,stroke.opacity*1.1);
      ctx.strokeStyle=erasing?"#000":col;
      ctx.lineWidth=sz;ctx.lineCap="square";ctx.lineJoin="miter";
      ctx.beginPath();ctx.moveTo(pts[start].x,pts[start].y);
      for(let i=start+1;i<pts.length;i++) ctx.lineTo(pts[i].x,pts[i].y);
      ctx.stroke();

    } else if (bt==="pencil") {
      if(pts.length<2){ctx.restore();return;}
      const lines=Math.max(2,Math.floor(sz*0.4));
      ctx.lineCap="round";
      for(let l=0;l<lines;l++){
        const offX=(prng(l*2017)-0.5)*sz*0.65;
        const offY=(prng(l*3019)-0.5)*sz*0.65;
        ctx.globalAlpha=(0.07+prng(l*9001)*0.15)*stroke.opacity;
        ctx.strokeStyle=erasing?"#000":col;
        ctx.lineWidth=0.4+prng(l*4001)*0.5;
        ctx.beginPath();ctx.moveTo(pts[start].x+offX,pts[start].y+offY);
        for(let i=start+1;i<pts.length;i++) ctx.lineTo(pts[i].x+offX,pts[i].y+offY);
        ctx.stroke();
      }
    }
    ctx.restore();
  };

  const drawStroke=(ctx:CanvasRenderingContext2D,stroke:Stroke)=>drawStrokeFrom(ctx,stroke,0);

  // ─── offscreen ───────────────────────────────────────────────────────────
  const flushToOffscreen=()=>{
    const off=offscreenRef.current;if(!off)return;
    const ctx=off.getContext("2d");if(!ctx)return;
    for(let i=offscreenCountRef.current;i<strokesRef.current.length;i++)
      drawStroke(ctx,strokesRef.current[i]);
    offscreenCountRef.current=strokesRef.current.length;
  };

  const rebuildOffscreen=()=>{
    const off=offscreenRef.current;if(!off)return;
    const ctx=off.getContext("2d");if(!ctx)return;
    ctx.setTransform(1,0,0,1,0,0);
    ctx.clearRect(0,0,off.width,off.height);
    ctx.fillStyle=bgColorRef.current;
    ctx.fillRect(0,0,off.width,off.height);
    // Dibujar imágenes primero (fondo)
    for(const img of imagesRef.current){
      const el=getCachedImage(img);
      if(el) ctx.drawImage(el,img.x,img.y,img.w,img.h);
    }
    strokesRef.current.forEach(s=>drawStroke(ctx,s));
    offscreenCountRef.current=strokesRef.current.length;
  };

  // ─── composite ───────────────────────────────────────────────────────────
  const compositeNow=()=>{
    const canvas=canvasRef.current, off=offscreenRef.current;
    if(!canvas||!off)return;
    const ctx=canvas.getContext("2d");if(!ctx)return;
    const dpr=window.devicePixelRatio||1, v=viewRef.current;

    ctx.setTransform(1,0,0,1,0,0);
    ctx.fillStyle="#1a1a1a";
    ctx.fillRect(0,0,canvas.width,canvas.height);

    ctx.save();
    ctx.scale(dpr,dpr);
    ctx.translate(v.x,v.y);
    ctx.scale(v.scale,v.scale);

    const cs=canvasSizeRef.current;
    if(cs){
      ctx.shadowColor="rgba(0,0,0,0.5)";ctx.shadowBlur=20/v.scale;
      ctx.fillStyle=bgColorRef.current;ctx.fillRect(0,0,cs.w,cs.h);
      ctx.shadowBlur=0;
      ctx.save();ctx.beginPath();ctx.rect(0,0,cs.w,cs.h);ctx.clip();
      ctx.drawImage(off,0,0);ctx.restore();
      ctx.strokeStyle="rgba(255,255,255,0.12)";ctx.lineWidth=1/v.scale;
      ctx.strokeRect(0,0,cs.w,cs.h);
    } else {
      ctx.drawImage(off,0,0);
    }

    if(currentStrokeRef.current) drawStroke(ctx,currentStrokeRef.current);
    remotePreviewsRef.current.forEach(s=>{if(s.points.length>1)drawStroke(ctx,s);});
    cursorsRef.current.forEach(cursor=>{
      ctx.beginPath();ctx.fillStyle="#00ff88";
      ctx.arc(cursor.x,cursor.y,6/v.scale,0,Math.PI*2);ctx.fill();
      ctx.fillStyle="white";ctx.font=`${12/v.scale}px Arial`;
      ctx.fillText(cursor.userId,cursor.x+10/v.scale,cursor.y-10/v.scale);
    });
    ctx.restore();
    rafRef.current=null;
  };

  const requestFrame=()=>{if(rafRef.current!==null)return;rafRef.current=requestAnimationFrame(compositeNow);};
  const redraw=()=>requestFrame();
  const redrawFull=()=>{rebuildOffscreen();requestFrame();};

  useEffect(()=>{redrawFull();},[bgColor]);
  useEffect(()=>{requestFrame();},[canvasSize]);
  useEffect(()=>{
    const cs=canvasSize;if(!cs)return;
    const canvas=canvasRef.current;if(!canvas)return;
    const vw=canvas.clientWidth,vh=canvas.clientHeight;
    const scale=Math.min((vw*0.85)/cs.w,(vh*0.85)/cs.h,1);
    viewRef.current={x:(vw-cs.w*scale)/2,y:(vh-cs.h*scale)/2,scale};
    requestFrame();
  },[canvasSize]);

  useEffect(()=>{
    const canvas=canvasRef.current;if(!canvas)return;
    const dpr=window.devicePixelRatio||1;
    canvas.width=(window.innerWidth-52)*dpr;
    canvas.height=(window.innerHeight-52)*dpr;
    canvas.style.width=(window.innerWidth-52)+"px";
    canvas.style.height=(window.innerHeight-52)+"px";

    const off=document.createElement("canvas");
    off.width=WORLD_W;off.height=WORLD_H;
    offscreenRef.current=off;
    const offCtx=off.getContext("2d")!;
    offCtx.fillStyle=bgColorRef.current;
    offCtx.fillRect(0,0,WORLD_W,WORLD_H);

    const room=new URLSearchParams(window.location.search).get("room")||"default";
    const protocol=window.location.protocol==="https:"?"wss:":"ws:";
    const wsUrl=(import.meta as any).env?.VITE_WS_URL||`${protocol}//${window.location.host}`;
    wsRef.current=new WebSocket(wsUrl);

    wsRef.current.onopen=()=>{
      wsRef.current?.send(JSON.stringify({type:"join",room,username}));
    };

    wsRef.current.onmessage=(event)=>{
      const data=JSON.parse(event.data);

      if(data.type==="init"){
        strokesRef.current=data.strokes||[];
        imagesRef.current=data.images||[];
        offscreenCountRef.current=0;
        if(data.bgColor) onBgColor?.(data.bgColor);
        // Precargar imágenes antes de redibujar
        const pending=imagesRef.current.filter(img=>!imgCache.has(img.id));
        if(pending.length===0){redrawFull();return;}
        let loaded=0;
        for(const img of pending){
          const el=new Image();
          el.onload=()=>{imgCache.set(img.id,el);if(++loaded===pending.length)redrawFull();};
          el.src=img.data;
        }
        return;
      }
      if(data.type==="users"){setUsers?.(data.users||[]);return;}
      if(data.type==="stroke"){
        strokesRef.current.push(data.stroke);
        remotePreviewsRef.current.delete(data.userId||"");
        flushToOffscreen();requestFrame();return;
      }
      if(data.type==="stroke_update"){
        const uid=data.userId||"unknown";
        const existing=remotePreviewsRef.current.get(uid);
        if(existing) existing.points.push(...data.points);
        else remotePreviewsRef.current.set(uid,{
          points:[...data.points],color:data.color,size:data.size,
          opacity:data.opacity,eraser:data.eraser,brushType:data.brushType,
        });
        requestFrame();return;
      }
      if(data.type==="clear"){
        strokesRef.current=[];remotePreviewsRef.current.clear();
        imagesRef.current=[];imgCache.clear();
        offscreenCountRef.current=0;rebuildOffscreen();requestFrame();return;
      }
      if(data.type==="bgcolor"){onBgColor?.(data.color);return;}
      if(data.type==="reload_strokes"){
        strokesRef.current=data.strokes||[];
        offscreenCountRef.current=0;rebuildOffscreen();requestFrame();return;
      }
      if(data.type==="image_added"){
        const img=data.image as CanvasImage;
        imagesRef.current=[...imagesRef.current,img];
        const el=new Image();
        el.onload=()=>{imgCache.set(img.id,el);rebuildOffscreen();requestFrame();};
        el.src=img.data;
        return;
      }
      if(data.type==="image_deleted"){
        imagesRef.current=imagesRef.current.filter(i=>i.id!==data.id);
        imgCache.delete(data.id);
        rebuildOffscreen();requestFrame();return;
      }
      if(data.type==="cursor"){
        cursorsRef.current.set(data.userId,{x:data.x,y:data.y,userId:data.username});
        requestFrame();
      }
    };

    // ── Pinch ──────────────────────────────────────────────────────────────
    let lastPinchDist=0,lastPinchMid={x:0,y:0};
    const getPinchInfo=()=>{
      const pts=Array.from(touchPtrsRef.current.values());
      const dx=pts[1].x-pts[0].x,dy=pts[1].y-pts[0].y;
      return{dist:Math.sqrt(dx*dx+dy*dy),mid:{x:(pts[0].x+pts[1].x)/2,y:(pts[0].y+pts[1].y)/2}};
    };

    const startStroke=(pos:{x:number;y:number})=>{
      const world=toWorld(pos.x,pos.y);
      const cs=canvasSizeRef.current;
      if(cs&&(world.x<0||world.y<0||world.x>cs.w||world.y>cs.h))return;
      currentStrokeRef.current={
        points:[world],color:colorRef.current,size:sizeRef.current,
        opacity:opacityRef.current,eraser:eraserRef.current,brushType:brushTypeRef.current,
      };
      lastSentPtRef.current=0;lastSentMsRef.current=0;
    };

    const streamStroke=()=>{
      const stroke=currentStrokeRef.current;
      if(!stroke||wsRef.current?.readyState!==WebSocket.OPEN)return;
      const total=stroke.points.length,sent=lastSentPtRef.current,now=performance.now();
      if(total-sent>=STREAM_PTS&&now-lastSentMsRef.current>=STREAM_MS){
        wsRef.current.send(JSON.stringify({
          type:"stroke_update",color:stroke.color,size:stroke.size,
          opacity:stroke.opacity,eraser:stroke.eraser,brushType:stroke.brushType,
          points:stroke.points.slice(sent),
        }));
        lastSentPtRef.current=total;lastSentMsRef.current=now;
      }
    };

    const onPointerDown=(e:PointerEvent)=>{
      canvas.setPointerCapture(e.pointerId);
      const rect=canvas.getBoundingClientRect();
      const pos={x:e.clientX-rect.left,y:e.clientY-rect.top};
      if(e.pointerType==="pen"||e.pointerType==="mouse"){
        if(panModeRef.current){panStartRef.current={x:pos.x,y:pos.y,vx:viewRef.current.x,vy:viewRef.current.y};return;}
        startStroke(pos);return;
      }
      touchPtrsRef.current.set(e.pointerId,pos);
      const count=touchPtrsRef.current.size;
      if(count===1) gestureRef.current={time:performance.now(),maxFingers:1,moved:false};
      else if(gestureRef.current) gestureRef.current.maxFingers=Math.max(gestureRef.current.maxFingers,count);
      if(count===2){currentStrokeRef.current=null;const info=getPinchInfo();lastPinchDist=info.dist;lastPinchMid=info.mid;return;}
      if(count===3){currentStrokeRef.current=null;return;}
      if(count===1) startStroke(pos);
    };

    const onPointerMove=(e:PointerEvent)=>{
      const rect=canvas.getBoundingClientRect();
      const pos={x:e.clientX-rect.left,y:e.clientY-rect.top};
      if(e.pointerType==="pen"||e.pointerType==="mouse"){
        if(panModeRef.current&&panStartRef.current){
          viewRef.current={...viewRef.current,x:panStartRef.current.vx+(pos.x-panStartRef.current.x),y:panStartRef.current.vy+(pos.y-panStartRef.current.y)};
          requestFrame();return;
        }
        if(!currentStrokeRef.current)return;
        const world=toWorld(pos.x,pos.y);
        if(wsRef.current?.readyState===WebSocket.OPEN)
          wsRef.current.send(JSON.stringify({type:"cursor",x:world.x,y:world.y}));
        currentStrokeRef.current.points.push(world);
        streamStroke();requestFrame();return;
      }
      const prev=touchPtrsRef.current.get(e.pointerId);
      if(prev&&gestureRef.current){
        const dx=pos.x-prev.x,dy=pos.y-prev.y;
        if(Math.sqrt(dx*dx+dy*dy)>GESTURE_PX) gestureRef.current.moved=true;
      }
      touchPtrsRef.current.set(e.pointerId,pos);
      if(touchPtrsRef.current.size===2){
        const info=getPinchInfo(),v=viewRef.current;
        const sr=info.dist/lastPinchDist;
        const ns=Math.min(MAX_SCALE,Math.max(MIN_SCALE,v.scale*sr));
        viewRef.current={
          x:info.mid.x-(lastPinchMid.x-v.x)*(ns/v.scale)-(lastPinchMid.x-info.mid.x),
          y:info.mid.y-(lastPinchMid.y-v.y)*(ns/v.scale)-(lastPinchMid.y-info.mid.y),
          scale:ns,
        };
        lastPinchDist=info.dist;lastPinchMid=info.mid;redraw();return;
      }
      if(!currentStrokeRef.current)return;
      const world=toWorld(pos.x,pos.y);
      if(wsRef.current?.readyState===WebSocket.OPEN)
        wsRef.current.send(JSON.stringify({type:"cursor",x:world.x,y:world.y}));
      currentStrokeRef.current.points.push(world);
      streamStroke();requestFrame();
    };

    const finishStroke=()=>{
      if(!currentStrokeRef.current)return;
      const stroke=currentStrokeRef.current;
      currentStrokeRef.current=null;
      strokesRef.current.push(stroke);
      myStrokesRef.current=[...myStrokesRef.current,stroke];
      flushToOffscreen();
      if(wsRef.current?.readyState===WebSocket.OPEN)
        wsRef.current.send(JSON.stringify({type:"stroke",stroke}));
      if(!stroke.eraser) onStrokeFinishedRef.current?.(stroke.color);
      const getMyStrokes=()=>myStrokesRef.current;
      const setMyStrokes=(newMine:Stroke[])=>{
        const others=strokesRef.current.filter(s=>!myStrokesRef.current.includes(s));
        myStrokesRef.current=newMine;
        strokesRef.current=[...others,...newMine];
        offscreenCountRef.current=0;rebuildOffscreen();requestFrame();
        if(wsRef.current?.readyState===WebSocket.OPEN)
          wsRef.current.send(JSON.stringify({type:"undo_sync",strokes:strokesRef.current}));
      };
      onStrokeAddedRef.current?.(getMyStrokes,setMyStrokes);
      requestFrame();
    };

    const onPointerUp=(e:PointerEvent)=>{
      if(e.pointerType==="pen"||e.pointerType==="mouse"){
        panStartRef.current=null;
        if(currentStrokeRef.current) finishStroke();
        return;
      }
      touchPtrsRef.current.delete(e.pointerId);
      if(touchPtrsRef.current.size===0&&gestureRef.current){
        const{time,maxFingers,moved}=gestureRef.current;
        const elapsed=performance.now()-time;
        gestureRef.current=null;
        if(!moved&&elapsed<GESTURE_MS){
          if(maxFingers===2){window.dispatchEvent(new CustomEvent("drawbot:undo"));return;}
          if(maxFingers===3){window.dispatchEvent(new CustomEvent("drawbot:redo"));return;}
        }
      }
      if(currentStrokeRef.current&&touchPtrsRef.current.size===0) finishStroke();
    };

    const onWheel=(e:WheelEvent)=>{
      e.preventDefault();
      const rect=canvas.getBoundingClientRect();
      const mx=e.clientX-rect.left,my=e.clientY-rect.top,v=viewRef.current;
      const delta=e.deltaY<0?1.12:0.9;
      const ns=Math.min(MAX_SCALE,Math.max(MIN_SCALE,v.scale*delta));
      viewRef.current={x:mx-(mx-v.x)*(ns/v.scale),y:my-(my-v.y)*(ns/v.scale),scale:ns};
      redraw();
    };

    canvas.addEventListener("pointerdown",  onPointerDown);
    canvas.addEventListener("pointermove",  onPointerMove);
    canvas.addEventListener("pointerup",    onPointerUp);
    canvas.addEventListener("pointercancel",onPointerUp);
    canvas.addEventListener("wheel",        onWheel,{passive:false});

    // ── savePNG ────────────────────────────────────────────────────────────
    const savePNG=()=>{
      const cs=canvasSizeRef.current;
      if(cs){
        const ec=document.createElement("canvas");ec.width=cs.w;ec.height=cs.h;
        const ectx=ec.getContext("2d")!;
        ectx.fillStyle=bgColorRef.current;ectx.fillRect(0,0,cs.w,cs.h);
        ectx.drawImage(offscreenRef.current!,0,0,cs.w,cs.h,0,0,cs.w,cs.h);
        const link=document.createElement("a");
        link.download=`drawbot-${cs.w}x${cs.h}-${Date.now()}.png`;
        link.href=ec.toDataURL("image/png");link.click();
      } else {
        const link=document.createElement("a");
        link.download=`drawbot-${Date.now()}.png`;
        link.href=(offscreenRef.current as HTMLCanvasElement).toDataURL("image/png");link.click();
      }
    };

    // ── uploadImage ────────────────────────────────────────────────────────
    const uploadImage=(file:File)=>{
      const reader=new FileReader();
      reader.onload=(ev)=>{
        const original=ev.target?.result as string;
        // Comprimir a JPEG antes de enviar
        const img=new Image();
        img.onload=()=>{
          const maxSide=2048;
          let w=img.width,h=img.height;
          if(w>maxSide||h>maxSide){
            const r=Math.min(maxSide/w,maxSide/h);w=Math.round(w*r);h=Math.round(h*r);
          }
          const tmp=document.createElement("canvas");tmp.width=w;tmp.height=h;
          tmp.getContext("2d")!.drawImage(img,0,0,w,h);
          const compressed=tmp.toDataURL("image/jpeg",0.85);
          // Centrar en la vista actual
          const v=viewRef.current;
          const cx=(canvas.clientWidth/2-v.x)/v.scale;
          const cy=(canvas.clientHeight/2-v.y)/v.scale;
          const iw=Math.min(w,800),ih=Math.round(h*(iw/w));
          wsRef.current?.send(JSON.stringify({
            type:"image_add",data:compressed,
            x:cx-iw/2,y:cy-ih/2,w:iw,h:ih,
          }));
        };
        img.src=original;
      };
      reader.readAsDataURL(file);
    };

    onReady?.(savePNG, uploadImage);

    return ()=>{
      if(rafRef.current) cancelAnimationFrame(rafRef.current);
      wsRef.current?.close();
      canvas.removeEventListener("pointerdown",  onPointerDown);
      canvas.removeEventListener("pointermove",  onPointerMove);
      canvas.removeEventListener("pointerup",    onPointerUp);
      canvas.removeEventListener("pointercancel",onPointerUp);
      canvas.removeEventListener("wheel",        onWheel);
    };
  },[]);

  (Canvas as any)._sendBgColor=(color:string)=>{
    if(wsRef.current?.readyState===WebSocket.OPEN)
      wsRef.current.send(JSON.stringify({type:"bgcolor",color}));
  };

  return (
    <canvas
      ref={canvasRef}
      style={{
        position:"fixed",top:52,left:52,
        width:"calc(100vw - 52px)",height:"calc(100vh - 52px)",
        display:"block",cursor:panMode?"grab":"crosshair",
        touchAction:"none",WebkitUserSelect:"none",userSelect:"none",
        // @ts-ignore
        WebkitTouchCallout:"none",
      }}
    />
  );
}