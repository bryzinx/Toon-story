// Desenha uma cena do JSON em canvas (vetorial, sem rede). paintScene(g, cena, índice, u 0..1, W, H)
const ease = (u) => u * u * (3 - 2 * u), TAU = Math.PI * 2;
const PRE = { night_city: ["#0b1030", "#2a2f6b", "#1a1a2e", "buildings"], forest: ["#7ec8e3", "#cdeccf", "#2d6a4f", "trees"], room: ["#f6d6a8", "#f2b880", "#8d5a3b", "window"], space: ["#04030f", "#251a52", "#120d2e", "stars"], beach: ["#6ec6ff", "#c9f0ff", "#f1d9a0", "sun"], park: ["#8fd3f4", "#e6f7ff", "#58b368", "clouds"] };
const rng = (seed) => { let s = (seed + 1) * 9301; return () => ((s = (s * 9301 + 49297) % 233280) / 233280); };
const circ = (g, x, y, r, f) => { g.beginPath(); g.arc(x, y, r, 0, TAU); g.fillStyle = f; g.fill(); };
const rect = (g, x, y, w, h, f, r = 0) => { g.beginPath(); g.roundRect(x, y, w, h, r); g.fillStyle = f; g.fill(); };

function bg(g, b, idx, W, H) {
  let top, bot, ground, deco;
  if (b && typeof b === "object") { [top, bot] = b.colors; ground = "rgba(0,0,0,.25)"; deco = "none"; } else [top, bot, ground, deco] = PRE[b] || PRE.park;
  const gr = g.createLinearGradient(0, 0, 0, H * 0.82); gr.addColorStop(0, top); gr.addColorStop(1, bot); g.fillStyle = gr; g.fillRect(-W, -H, W * 3, H * 3);
  const r = rng(idx), q = W / 540; // q: escala por largura
  if (deco === "stars") for (let i = 0; i < 70; i++) circ(g, r() * W, r() * H * 0.8, (1 + r() * 2.5) * q, "rgba(255,255,255,.85)");
  if (deco === "buildings") { for (let i = 0; i < 9; i++) { const bw = W / 8, bh = H * (0.15 + r() * 0.3); rect(g, i * bw, H * 0.82 - bh, bw - 4, bh, "rgba(0,0,0,.4)"); for (let k = 0; k < 6; k++) if (r() > 0.4) rect(g, i * bw + 8 * q + (k % 3) * bw * 0.28, H * 0.82 - bh + 10 * q + Math.floor(k / 3) * 30 * q, 10 * q, 14 * q, "#fde68a"); } for (let i = 0; i < 40; i++) circ(g, r() * W, r() * H * 0.4, 1.5 * q, "rgba(255,255,255,.8)"); }
  if (deco === "sun") circ(g, W * 0.8, H * 0.15, W * 0.1, "#fde047");
  if (deco === "clouds") for (let i = 0; i < 3; i++) prop(g, { type: "cloud", x: 0.2 + i * 0.3, y: 0.12 + r() * 0.12 }, W, H);
  if (deco === "trees") for (let i = 0; i < 4; i++) prop(g, { type: "tree", x: 0.1 + i * 0.27, y: 0.82, scale: 1.4 }, W, H);
  if (deco === "window") { rect(g, W * 0.6, H * 0.18, W * 0.3, H * 0.2, "#bfe3ff", 8); g.fillStyle = "#8d5a3b"; g.fillRect(W * 0.75 - 3, H * 0.18, 6, H * 0.2); }
  g.fillStyle = ground; g.fillRect(-W, H * 0.82, W * 3, H);
}
function prop(g, p, W, H) {
  const S = H * 0.08 * (p.scale || 1), x = (p.x ?? 0.5) * W, y = (p.y ?? 0.5) * H;
  if (p.type === "sun") { circ(g, x, y, S, "#fde047"); g.strokeStyle = "#fde047"; g.lineWidth = S * 0.12; for (let i = 0; i < 8; i++) { g.beginPath(); g.moveTo(x + Math.cos(i * TAU / 8) * S * 1.25, y + Math.sin(i * TAU / 8) * S * 1.25); g.lineTo(x + Math.cos(i * TAU / 8) * S * 1.6, y + Math.sin(i * TAU / 8) * S * 1.6); g.stroke(); } }
  if (p.type === "moon") { g.save(); g.beginPath(); g.arc(x, y, S, 0, TAU); g.clip(); g.beginPath(); g.rect(x - 2 * S, y - 2 * S, 4 * S, 4 * S); g.moveTo(x + S * 1.3, y - S * 0.2); g.arc(x + S * 0.4, y - S * 0.2, S * 0.9, 0, TAU); g.fillStyle = "#f1f5f9"; g.fill("evenodd"); g.restore(); }
  if (p.type === "star") { g.beginPath(); for (let i = 0; i < 10; i++) { const r = i % 2 ? S * 0.4 : S, a = -Math.PI / 2 + i * Math.PI / 5; g.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r); } g.closePath(); g.fillStyle = "#fde047"; g.fill(); }
  if (p.type === "tree") { rect(g, x - S * 0.15, y - S * 1.2, S * 0.3, S * 1.2, "#7c4a21"); circ(g, x, y - S * 1.6, S * 0.8, "#2f9e44"); circ(g, x - S * 0.5, y - S * 1.2, S * 0.55, "#37b24d"); circ(g, x + S * 0.5, y - S * 1.2, S * 0.55, "#37b24d"); }
  if (p.type === "house") { rect(g, x - S, y - S * 1.3, S * 2, S * 1.3, "#f4a261", 6); g.beginPath(); g.moveTo(x - S * 1.2, y - S * 1.3); g.lineTo(x, y - S * 2.3); g.lineTo(x + S * 1.2, y - S * 1.3); g.closePath(); g.fillStyle = "#c0392b"; g.fill(); rect(g, x - S * 0.2, y - S * 0.7, S * 0.4, S * 0.7, "#6b3e26"); }
  if (p.type === "cloud") { for (const [dx, dy, r] of [[0, 0, 0.7], [0.7, 0.1, 0.55], [-0.7, 0.1, 0.55], [0.3, -0.3, 0.6]]) circ(g, x + dx * S, y + dy * S, r * S, "rgba(255,255,255,.92)"); }
  if (p.type === "heart") { g.beginPath(); g.moveTo(x, y + S * 0.9); g.bezierCurveTo(x - S * 1.6, y - S * 0.2, x - S * 0.6, y - S * 1.3, x, y - S * 0.45); g.bezierCurveTo(x + S * 0.6, y - S * 1.3, x + S * 1.6, y - S * 0.2, x, y + S * 0.9); g.fillStyle = "#ef4444"; g.fill(); }
}
function face(g, emo, S, cx, cy, robot) {
  const er = emo === "surprised" ? S * 0.1 : S * 0.07; g.fillStyle = "#1f2937";
  for (const sx of [-1, 1]) { if (robot) g.fillRect(cx + sx * S * 0.18 - er, cy - er, er * 2, er * 2); else circ(g, cx + sx * S * 0.18, cy, er, "#1f2937"); }
  g.strokeStyle = "#1f2937"; g.lineWidth = S * 0.045; g.lineCap = "round"; g.beginPath();
  if (emo === "sad") g.arc(cx, cy + S * 0.3, S * 0.12, Math.PI * 1.1, Math.PI * 1.9);
  else if (emo === "surprised") { g.arc(cx, cy + S * 0.22, S * 0.07, 0, TAU); g.fillStyle = "#1f2937"; g.fill(); }
  else if (emo === "neutral") { g.moveTo(cx - S * 0.1, cy + S * 0.22); g.lineTo(cx + S * 0.1, cy + S * 0.22); }
  else g.arc(cx, cy + S * 0.14, S * 0.14, 0.15 * Math.PI, 0.85 * Math.PI);
  g.stroke();
}
function limb(g, x, y, ang, len, w, col) { g.strokeStyle = col; g.lineWidth = w; g.lineCap = "round"; g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.sin(ang) * len, y + Math.cos(ang) * len); g.stroke(); }
function character(g, c, t, u, W, H) {
  const S = H * 0.11 * (c.scale || 1), act = c.action || "idle", dx = c.dx ?? 0.2, emo = c.emotion || "happy";
  let x = (c.x ?? 0.5) * W, y = (c.y ?? 0.78) * H, bob = Math.sin(t * 4) * S * 0.03, rot = 0, sw = 0, wave = false;
  if (act === "walk") { x += dx * W * ease(u); sw = Math.sin(t * 9); bob = Math.abs(sw) * -S * 0.05; }
  if (act === "jump") y -= Math.abs(Math.sin(u * Math.PI * 2 * Math.max(1, Math.round(t / u / 2 || 1)))) * S * 0.8;
  if (act === "dance") { rot = Math.sin(t * 6) * 0.12; bob = -Math.abs(Math.sin(t * 6)) * S * 0.08; sw = Math.sin(t * 6); }
  wave = act === "wave";
  g.save(); g.translate(x, y + bob); if (act === "walk" && dx < 0) g.scale(-1, 1); g.rotate(rot);
  g.fillStyle = "rgba(0,0,0,.22)"; g.beginPath(); g.ellipse(0, -bob, S * 0.6, S * 0.1, 0, 0, TAU); g.fill();
  const arms = (sy, col, w) => { limb(g, -S * 0.42, sy, sw * 0.7 + 0.3, S * 0.7, w, col); limb(g, S * 0.42, sy, wave ? 2.5 + Math.sin(t * 10) * 0.5 : -sw * 0.7 - 0.3, S * 0.7, w, col); };
  if (c.type === "cat") {
    const col = c.color || "#f59e0b", col2 = c.color2 || "#fde68a";
    g.strokeStyle = col; g.lineWidth = S * 0.16; g.lineCap = "round"; g.beginPath(); g.moveTo(S * 0.4, -S * 0.4); g.quadraticCurveTo(S * 1, -S * 0.5 + Math.sin(t * 5) * S * 0.2, S * 0.8, -S * 1.1); g.stroke();
    limb(g, -S * 0.2, -S * 0.2, sw * 0.5, S * 0.35, S * 0.2, col); limb(g, S * 0.2, -S * 0.2, -sw * 0.5, S * 0.35, S * 0.2, col);
    g.beginPath(); g.ellipse(0, -S * 0.65, S * 0.5, S * 0.6, 0, 0, TAU); g.fillStyle = col; g.fill(); g.beginPath(); g.ellipse(0, -S * 0.55, S * 0.28, S * 0.4, 0, 0, TAU); g.fillStyle = col2; g.fill();
    arms(-S * 0.8, col, S * 0.15);
    for (const sx of [-1, 1]) { g.beginPath(); g.moveTo(sx * S * 0.15, -S * 1.7); g.lineTo(sx * S * 0.5, -S * 2.05); g.lineTo(sx * S * 0.5, -S * 1.5); g.closePath(); g.fillStyle = col; g.fill(); }
    circ(g, 0, -S * 1.45, S * 0.52, col); face(g, emo, S, 0, -S * 1.5);
    g.strokeStyle = "#374151"; g.lineWidth = S * 0.02; for (const sx of [-1, 1]) for (const k of [-1, 1]) { g.beginPath(); g.moveTo(sx * S * 0.3, -S * 1.32); g.lineTo(sx * S * 0.7, -S * 1.32 + k * S * 0.08); g.stroke(); }
  } else if (c.type === "robot") {
    const col = c.color || "#94a3b8", col2 = c.color2 || "#22d3ee";
    limb(g, -S * 0.22, -S * 0.5, sw * 0.4, S * 0.5, S * 0.22, "#64748b"); limb(g, S * 0.22, -S * 0.5, -sw * 0.4, S * 0.5, S * 0.22, "#64748b");
    rect(g, -S * 0.45, -S * 1.3, S * 0.9, S * 0.85, col, S * 0.08); rect(g, -S * 0.2, -S * 1.1, S * 0.4, S * 0.3, col2, S * 0.05); arms(-S * 1.2, "#64748b", S * 0.16);
    rect(g, -S * 0.42, -S * 2.1, S * 0.84, S * 0.7, col, S * 0.1); g.strokeStyle = "#64748b"; g.lineWidth = S * 0.05; g.beginPath(); g.moveTo(0, -S * 2.1); g.lineTo(0, -S * 2.4); g.stroke(); circ(g, 0, -S * 2.42, S * 0.07, col2);
    face(g, emo, S, 0, -S * 1.78, true);
  } else {
    const girl = c.type === "girl", shirt = c.color || (girl ? "#ec4899" : "#3b82f6"), hair = c.color2 || (girl ? "#f59e0b" : "#4b2e1e"), skin = "#f2c9a0";
    limb(g, -S * 0.17, -S * 0.7, sw * 0.5, S * 0.7, S * 0.2, "#334155"); limb(g, S * 0.17, -S * 0.7, -sw * 0.5, S * 0.7, S * 0.2, "#334155");
    if (girl) { g.beginPath(); g.moveTo(-S * 0.3, -S * 1.5); g.lineTo(S * 0.3, -S * 1.5); g.lineTo(S * 0.55, -S * 0.7); g.lineTo(-S * 0.55, -S * 0.7); g.closePath(); g.fillStyle = shirt; g.fill(); } else rect(g, -S * 0.35, -S * 1.5, S * 0.7, S * 0.85, shirt, S * 0.12);
    arms(-S * 1.4, skin, S * 0.15); rect(g, -S * 0.07, -S * 1.65, S * 0.14, S * 0.2, skin);
    if (girl) { circ(g, -S * 0.42, -S * 2.0, S * 0.22, hair); circ(g, S * 0.42, -S * 2.0, S * 0.22, hair); }
    circ(g, 0, -S * 2.0, S * 0.46, skin); g.beginPath(); g.arc(0, -S * 2.05, S * 0.5, Math.PI, TAU); g.fillStyle = hair; g.fill(); face(g, emo, S, 0, -S * 1.98);
  }
  g.restore();
}
function wrap(g, text, max) { const out = []; for (const par of text.split("\n")) { let cur = ""; for (const w of par.split(" ")) { const t = cur ? cur + " " + w : w; if (cur && g.measureText(t).width > max) { out.push(cur); cur = w; } else cur = t; } out.push(cur); } return out; }
function caption(g, tx, t, W, H) {
  const fs = Math.round(W * (tx.size || 0.06)), a = tx.anim || "fade", k = a === "none" ? 1 : Math.min(1, t / (a === "pop" ? 0.35 : 0.5));
  g.save(); g.globalAlpha = a === "fade" ? k : 1; g.translate(W * (tx.x ?? 0.5), H * (tx.y ?? 0.2)); if (a === "pop") g.scale(ease(k), ease(k));
  g.font = `bold ${fs}px sans-serif`; g.textAlign = "center"; g.textBaseline = "middle"; g.lineJoin = "round"; g.lineWidth = fs * 0.18; g.fillStyle = tx.color || "#ffffff"; g.strokeStyle = "rgba(0,0,0,.75)";
  const ls = wrap(g, tx.text, W * 0.88); ls.forEach((l, i) => { const y = (i - (ls.length - 1) / 2) * fs * 1.2; g.strokeText(l, 0, y); g.fillText(l, 0, y); }); g.restore();
}
export function paintScene(g, sc, idx, u, W, H) {
  const t = u * sc.durationSec, m = typeof sc.camera === "string" ? sc.camera : sc.camera?.move; let z = 1, px = 0;
  if (m === "push_in") z = 1 + 0.12 * ease(u); if (m === "pull_out") z = 1.12 - 0.12 * ease(u); if (m === "pan_left") { z = 1.08; px = (0.5 - u) * 0.06 * W; } if (m === "pan_right") { z = 1.08; px = (u - 0.5) * 0.06 * W; }
  g.save(); g.translate(W / 2 + px, H / 2); g.scale(z, z); g.translate(-W / 2, -H / 2);
  bg(g, sc.background, idx, W, H); (sc.props || []).forEach((p) => prop(g, p, W, H)); [...(sc.characters || [])].sort((a, b) => (a.y ?? 0.78) - (b.y ?? 0.78)).forEach((c) => character(g, c, t, u, W, H));
  g.restore(); (sc.texts || []).forEach((tx) => caption(g, tx, t, W, H));
}
