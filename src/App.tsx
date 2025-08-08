
import React, { useEffect, useRef, useState } from "react";

// ==============================
// RICARDO SACCO: PROTÓTIPO
// React + HTML Canvas (sem libs externas)
// Controles: ← → p/ mover, ↑ p/ pular, Espaço p/ Megafone, R p/ reiniciar fase
// ==============================

// --- Utilitários ---
const clamp = (v:number, a:number, b:number) => Math.max(a, Math.min(b, v));
const lerp = (a:number, b:number, t:number) => a + (b - a) * t;

// --- Tipos ---
interface Vec { x:number; y:number }
interface Rect { x:number; y:number; w:number; h:number }

// --- Áudio simples (web audio API) ---
function playBeep(freq=440, dur=0.12, type:OscillatorType="square"){
  try{
    const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
    const ctx = new Ctx();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type; o.frequency.value = freq; o.connect(g); g.connect(ctx.destination);
    g.gain.setValueAtTime(0.12, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
    o.start(); o.stop(ctx.currentTime + dur);
  }catch{}
}

// --- Colisão AABB ---
const overlaps = (a:Rect, b:Rect) => !(a.x + a.w < b.x || a.x > b.x + b.w || a.y + a.h < b.y || a.y > b.y + b.h);

// --- Fases ---
// Cada fase possui plataformas, NPCs e um objetivo simples.
const LEVELS = [
  {
    name: "Academia do Aço Perdido",
    goal: "Recupere a Barra Olímpica Dourada",
    width: 2000,
    platforms: [
      {x:0,y:520,w:2200,h:60}, {x:200,y:440,w:200,h:20}, {x:520,y:380,w:180,h:20},
      {x:800,y:330,w:160,h:20}, {x:1050,y:420,w:220,h:20}, {x:1380,y:360,w:220,h:20}
    ],
    collectibles:[{x:1800,y:280,w:24,h:24,label:"Barra"}],
    enemies:[{x:900,y:488,w:40,h:40,patrol:[820,1080]},{x:1450,y:488,w:40,h:40,patrol:[1380,1600]}]
  },
  {
    name: "Clube do Cardio Infinito",
    goal: "Sobreviva às esteiras e alcance a Saída",
    width: 2200,
    platforms: [
      {x:0,y:520,w:2400,h:60}, {x:260,y:470,w:260,h:16}, {x:600,y:430,w:240,h:16},
      {x:880,y:390,w:220,h:16}, {x:1160,y:350,w:260,h:16}, {x:1500,y:310,w:260,h:16}
    ],
    treadmills:[{x:260,y:470,w:260,h:16,dir:1},{x:600,y:430,w:240,h:16,dir:-1},{x:1160,y:350,w:260,h:16,dir:1}],
    collectibles:[{x:1800,y:260,w:24,h:24,label:"Chave"}],
    enemies:[{x:1200,y:488,w:40,h:40,patrol:[1120,1320]}]
  },
  {
    name: "Fortaleza dos Halteres",
    goal: "Derrote o Mestre-Pai-Luloide",
    width: 1800,
    platforms: [
      {x:0,y:520,w:1900,h:60}, {x:450,y:420,w:240,h:18}, {x:820,y:360,w:260,h:18}, {x:1200,y:440,w:260,h:18}
    ],
    boss:{x:1350,y:470,w:60,h:60,hp:6}
  }
] as const;

// --- Input ---
const useKeys = () => {
  const keys = useRef<Record<string, boolean>>({});
  useEffect(() => {
    const down = (e:KeyboardEvent)=>{ keys.current[e.key.toLowerCase()] = true; };
    const up   = (e:KeyboardEvent)=>{ keys.current[e.key.toLowerCase()] = false; };
    window.addEventListener('keydown', down); window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  },[]);
  return keys;
};

// --- Entidades ---
class Player {
  pos:Vec = {x:40, y:480};
  vel:Vec = {x:0, y:0};
  w=36; h=48; onGround=false; face=1; hp=3; inv=0; megaCooldown=0; charge=0;
  reset(p:Vec){ this.pos={...p}; this.vel={x:0,y:0}; this.onGround=false; this.inv=0; this.hp=3; }
}

// --- Componente principal ---
export default function Game(){
  const canvasRef = useRef<HTMLCanvasElement|null>(null);
  const keys = useKeys();
  const [levelIdx,setLevelIdx] = useState(0);
  const [msg,setMsg] = useState("Pressione Espaço para soltar o Megafone!");
  const [paused,setPaused] = useState(false);

  // câmera
  const cam = useRef(0);
  const player = useRef(new Player());

  // reset de nível
  const reset = () => {
    const p = player.current; p.reset({x:40,y:480}); cam.current = 0; setMsg(LEVELS[levelIdx].goal);
  };

  // troca de nível
  const nextLevel = () => {
    setLevelIdx(i=> (i+1)%LEVELS.length);
    setTimeout(()=>reset(), 0);
  };

  useEffect(()=>{ reset(); },[levelIdx]);

  useEffect(()=>{
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext('2d')!;

    let last=0; let raf=0;

    // Mundo
    const G = 1400; // gravidade px/s^2
    const MAX_VX = 220; const JUMP_VY = -520; const FRICTION = 0.85;

    // Estado de inimigos / boss / colecionáveis por nível
    let enemies: Array<any> = JSON.parse(JSON.stringify((LEVELS as any)[levelIdx].enemies || []));
    let boss: any = JSON.parse(JSON.stringify((LEVELS as any)[levelIdx].boss || null));
    let collectibles: Array<any> = JSON.parse(JSON.stringify((LEVELS as any)[levelIdx].collectibles || []));
    let treadmills: Array<any> = JSON.parse(JSON.stringify((LEVELS as any)[levelIdx].treadmills || []));

    const loop = (t:number)=>{
      if(paused){ raf = requestAnimationFrame(loop); return; }
      const dt = Math.min(0.033, (t - last)/1000 || 0.016); last = t;
      const p = player.current; p.inv = Math.max(0, p.inv - dt); p.megaCooldown = Math.max(0, p.megaCooldown - dt);

      // Input
      const left = !!(keys.current["arrowleft"] || keys.current["a"]);
      const right= !!(keys.current["arrowright"]|| keys.current["d"]);
      const up   = !!(keys.current["arrowup"] || keys.current["w"]);
      const space= !!(keys.current[" "] || keys.current["space"]);
      const RKey = !!(keys.current["r"]);

      if(RKey){ reset(); keys.current["r"]=false; }

      if(left) { p.vel.x = clamp(p.vel.x - 14, -MAX_VX, MAX_VX); p.face=-1; }
      if(right){ p.vel.x = clamp(p.vel.x + 14, -MAX_VX, MAX_VX); p.face= 1; }
      if(!left && !right){ p.vel.x *= FRICTION; if(Math.abs(p.vel.x)<1) p.vel.x=0; }

      // pulo
      if(up && p.onGround){ p.vel.y = JUMP_VY; p.onGround=false; playBeep(660,0.08,"sawtooth"); }

      // gravidade
      p.vel.y += G*dt;

      // tentativa de movimento
      const level = LEVELS[levelIdx];
      const plats = level.platforms as Array<Rect>;

      // mover eixo X
      p.pos.x += p.vel.x*dt; p.pos.x = clamp(p.pos.x, 0, level.width - p.w);
      // colisão X
      for(const s of plats){
        const r:Rect = {x:s.x,y:s.y,w:s.w,h:s.h};
        if(overlaps({x:p.pos.x,y:p.pos.y,w:p.w,h:p.h}, r)){
          if(p.vel.x>0) p.pos.x = r.x - p.w; else if(p.vel.x<0) p.pos.x = r.x + r.w;
          p.vel.x = 0;
        }
      }

      // mover eixo Y
      p.pos.y += p.vel.y*dt; p.onGround=false;
      // colisão Y
      for(const s of plats){
        const r:Rect = {x:s.x,y:s.y,w:s.w,h:s.h};
        if(overlaps({x:p.pos.x,y:p.pos.y,w:p.w,h:p.h}, r)){
          if(p.vel.y>0){ p.pos.y = r.y - p.h; p.onGround=true; }
          else if(p.vel.y<0){ p.pos.y = r.y + r.h; }
          p.vel.y = 0;
        }
      }

      // esteiras (movem o jogador quando em cima)
      for(const tm of treadmills||[]){
        const on = overlaps({x:p.pos.x,y:p.pos.y+1,w:p.w,h:p.h}, tm);
        if(on && p.onGround){ p.pos.x += (tm.dir>0? 70:-70)*dt; }
      }

      // Megafone: carregar com espaço, soltar onda quando libera
      if(space){ p.charge = clamp(p.charge + dt, 0, 1.2); }
      else if(p.charge>0){ // libera onda
        const power = p.charge; p.charge = 0; p.megaCooldown = 0.6 + power*0.4; playBeep(200+power*300,0.18,"triangle");
        // empurra/stunna inimigos próximos
        const radius = 120 + power*160; const dir = p.face;
        enemies.forEach(e=>{ const cx = e.x + e.w/2, cy = e.y + e.h/2; const dx=cx-(p.pos.x+p.w/2), dy=cy-(p.pos.y+p.h/2); const d=Math.hypot(dx,dy);
          if(d<radius){ e.vx = 220*dir; e.stun = 0.6 + power*0.5; }
        });
        if(boss){ const cx=boss.x+boss.w/2, cy=boss.y+boss.h/2; const d=Math.hypot(cx-(p.pos.x+p.w/2), cy-(p.pos.y+p.h/2)); if(d<radius){ boss.stun = 0.4 + power*0.4; boss.vx = 300*dir; boss.hp -= (power>0.9?2:1); setMsg(`Acerto no chefe! HP ${boss.hp}`); playBeep(120,0.2,"sine"); }}
      }

      // Inimigos padrão: patrulha
      enemies.forEach(e=>{
        e.stun = Math.max(0, (e.stun||0) - dt);
        if(e.stun>0){ e.x += (e.vx||0)*dt; e.vx *= 0.9; }
        else{
          e.dir = e.dir || 1; const [a,b] = e.patrol; if(!e.vx){ e.vx = 60*e.dir; }
          e.x += e.vx*dt; if(e.x < a){ e.x=a; e.vx = Math.abs(e.vx); } if(e.x > b){ e.x=b; e.vx = -Math.abs(e.vx); }
        }
        // gravidade
        e.vy = (e.vy||0) + G*dt; e.y += e.vy*dt;
        // chão
        for(const s of plats){ const r:Rect={x:s.x,y:s.y,w:s.w,h:s.h}; if(overlaps({x:e.x,y:e.y,w:e.w,h:e.h}, r)){ if(e.vy>0){ e.y = r.y - e.h; e.vy = 0; } }
        }
        // dano ao jogador
        const hit = overlaps({x:p.pos.x,y:p.pos.y,w:p.w,h:p.h}, {x:e.x,y:e.y,w:e.w,h:e.h});
        if(hit && p.inv<=0){ p.hp--; p.inv = 1.0; p.vel.x = (p.pos.x < e.x ? -200:200); p.vel.y = -200; playBeep(90,0.15,"square"); if(p.hp<=0){ setMsg("Você desmaiou! R para reiniciar."); p.pos.y = -9999; }}
      });

      // BOSS
      if(boss){
        boss.stun = Math.max(0,(boss.stun||0)-dt);
        if(boss.stun>0){ boss.x += (boss.vx||0)*dt; boss.vx *= 0.9; }
        else{
          // IA simples: corre para o jogador e salta às vezes
          const dir = Math.sign((p.pos.x) - (boss.x)); boss.vx = lerp(boss.vx||0, dir*120, 0.05);
          boss.x += boss.vx*dt; boss.vy = (boss.vy||0) + G*dt; boss.y += boss.vy*dt;
        }
        // chão
        for(const s of plats){ const r:Rect={x:s.x,y:s.y,w:s.w,h:s.h}; if(overlaps({x:boss.x,y:boss.y,w:boss.w,h:boss.h}, r)){ if(boss.vy>0){ boss.y = r.y - boss.h; boss.vy = 0; } }
        }
        // dano ao player
        const hitB = overlaps({x:p.pos.x,y:p.pos.y,w:p.w,h:p.h}, {x:boss.x,y:boss.y,w:boss.w,h:boss.h});
        if(hitB && p.inv<=0){ p.hp--; p.inv = 1.0; p.vel.x = (p.pos.x < boss.x ? -260:260); p.vel.y = -260; playBeep(70,0.18,"square"); if(p.hp<=0){ setMsg("Derrotado pelo Mestre-Pai-Luloide! R para reiniciar."); p.pos.y=-9999; }}
        if(boss.hp<=0){ setMsg("Chefe derrotado! Parabéns – Fase completa."); }
      }

      // Coletáveis
      collectibles = collectibles.filter(c=>{
        const got = overlaps({x:p.pos.x,y:p.pos.y,w:p.w,h:p.h}, c);
        if(got){ setMsg(`Coletou: ${c.label}!`); playBeep(880,0.1,"triangle"); }
        return !got;
      });

      // Vitória por objetivo simples: coletou tudo e alcançou final do mapa
      const goalComplete = collectibles.length===0 && p.pos.x > level.width - 80;
      if(goalComplete){ setMsg("Objetivo concluído! Avançando..."); nextLevel(); return; }

      // Câmera segue o jogador
      cam.current = Math.max(0, Math.min(level.width - canvas.width, p.pos.x - canvas.width*0.45));

      // ======= RENDER =======
      ctx.clearRect(0,0,canvas.width,canvas.height);
      // Céu
      ctx.fillStyle = "#bde0fe"; ctx.fillRect(0,0,canvas.width,canvas.height);
      // Solo/plataformas
      const drawRect = (r:Rect, color:string)=>{ ctx.fillStyle=color; ctx.fillRect(r.x - cam.current, r.y, r.w, r.h); };
      (level.platforms as Array<Rect>).forEach(s=> drawRect(s, "#2b2d42"));
      (treadmills||[]).forEach(s=>{ drawRect(s, "#495057"); });

      // Coletáveis
      for(const c of collectibles){ ctx.fillStyle = "#ffd166"; ctx.fillRect(c.x - cam.current, c.y, c.w, c.h); ctx.fillStyle="#000"; ctx.font="10px sans-serif"; ctx.fillText(c.label, c.x - cam.current - 6, c.y - 6); }

      // Inimigos
      for(const e of enemies){
        ctx.save(); ctx.translate(e.x - cam.current + e.w/2, e.y + e.h/2);
        const t = (performance.now()/180)% (Math.PI*2);
        ctx.rotate(Math.sin(t)*0.05);
        ctx.fillStyle = "#ef476f"; ctx.fillRect(-e.w/2, -e.h/2, e.w, e.h);
        // carinha
        ctx.fillStyle = "#000"; ctx.fillRect(-10,-8,6,6); ctx.fillRect(4,-8,6,6); ctx.fillRect(-6,6,12,3);
        ctx.restore();
      }

      // Boss
      if(boss){ ctx.fillStyle="#222"; ctx.fillRect(boss.x - cam.current, boss.y, boss.w, boss.h); ctx.fillStyle="#f1fa8c"; ctx.fillRect(boss.x - cam.current + 8, boss.y+10, 12,8); ctx.fillRect(boss.x - cam.current + boss.w-20, boss.y+10, 12,8); ctx.fillStyle="#ffb703"; ctx.fillRect(boss.x - cam.current + 20, boss.y+34, 20,6); // barra de vida
        ctx.fillStyle="#ff006e"; ctx.fillRect(20, 20, 20*boss.hp, 10); ctx.strokeStyle="#000"; ctx.strokeRect(20,20, 20*6,10); }

      // Jogador (cartum exagerado)
      const t = (performance.now()/150)% (Math.PI*2);
      const wobble = Math.sin(t)*2;
      ctx.save();
      ctx.translate(p.pos.x - cam.current, p.pos.y);
      // sombra
      ctx.fillStyle = "rgba(0,0,0,0.2)"; ctx.beginPath(); ctx.ellipse(p.w/2, p.h+6, p.w*0.5, 6, 0, 0, Math.PI*2); ctx.fill();
      // corpo
      ctx.fillStyle = "#ffadad"; ctx.fillRect(0,0,p.w,p.h);
      // cabeça
      ctx.fillStyle = "#ffd6a5"; ctx.fillRect(6,-16,24,20);
      // boca/grito
      ctx.fillStyle = "#000"; ctx.fillRect(18 - (p.face>0?0:8), -4 + wobble*0.2, 10,8);
      // megafone carregando
      if(p.charge>0){
        ctx.fillStyle = "#adb5bd"; const hx = p.face>0? p.w+6 : -14; ctx.fillRect(hx, 6, 12,10);
        const pow = p.charge; ctx.strokeStyle = "#00afb9"; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(hx + (p.face>0?12:-0), 10, 16+pow*20, -0.7, 0.7); ctx.stroke();
      }
      ctx.restore();

      // HUD
      ctx.fillStyle = "#000"; ctx.font = "14px system-ui, sans-serif";
      ctx.fillText(`${level.name} – ${level.goal}`, 20, 50);
      ctx.fillText(`HP: ${p.hp} | Megafone: ${p.megaCooldown>0?"recarregando":"pronto"}`, 20, 70);
      if(msg) ctx.fillText(msg, 20, 90);

      raf = requestAnimationFrame(loop);
    };

    raf = requestAnimationFrame(loop);
    return ()=> cancelAnimationFrame(raf);
  },[levelIdx, paused]);

  return (
    <div style={{display:'flex',flexDirection:'column',alignItems:'center',gap:'12px',padding:'16px'}}>
      <div style={{fontSize:'24px',fontWeight:700}}>Ricardo Sacco, o Bombado Afetado – Protótipo</div>
      <div style={{fontSize:'12px',opacity:0.8}}>Controles: ← → mover · ↑ pular · Espaço megafone · R reinicia fase</div>
      <canvas ref={canvasRef} width={960} height={560} style={{border:'1px solid #d0d0d0',borderRadius:'16px',boxShadow:'0 6px 20px rgba(0,0,0,0.12)'}}/>
      <div style={{display:'flex',gap:'8px'}}>
        <button onClick={()=>setPaused(p=>!p)} style={{padding:'8px 12px',borderRadius:'12px',background:'#111',color:'#fff'}}>{paused?"▶ Retomar":"⏸ Pausar"}</button>
        <button onClick={()=>{ const i=(levelIdx+1)%LEVELS.length; setLevelIdx(i); }} style={{padding:'8px 12px',borderRadius:'12px'}}>Próxima fase</button>
        <button onClick={()=>{ const i=(levelIdx-1+LEVELS.length)%LEVELS.length; setLevelIdx(i); }} style={{padding:'8px 12px',borderRadius:'12px'}}>Fase anterior</button>
      </div>
    </div>
  );
}
