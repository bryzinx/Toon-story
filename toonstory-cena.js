// Desenha uma cena do JSON em canvas (vetorial, sem rede). paintScene(g, cena, índice, u 0..1, W, H)
const ease = (u) => u * u * (3 - 2 * u), TAU = Math.PI * 2;
const PRE = { night_city: ["#0b1030", "#2a2f6b", "#1a1a2e", "buildings"], forest: ["#7ec8e3", "#cdeccf", "#2d6a4f", "trees"], room: ["#f6d6a8", "#f2b880", "#8d5a3b", "window"], space: ["#04030f", "#251a52", "#120d2e", "stars"], beach: ["#6ec6ff", "#c9f0ff", "#f1d9a0", "sun"], park: ["#8fd3f4", "#e6f7ff", "#58b368", "clouds"], street: ["#9fb0bd", "#d9e2e8", "#4b5563", "street"], science: ["#021526", "#0b3a5c", "#04243b", "grid"] };
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
  if (deco === "street") {
    for (let i = 0; i < 3; i++) { const hx = i * W * 0.36 - 10 * q, hw = W * 0.34, hh = H * 0.2, by = H * 0.78; rect(g, hx, by - hh, hw, hh, ["#f2c9a0", "#c9d8a8", "#e8b4a0"][i]); g.beginPath(); g.moveTo(hx - 8 * q, by - hh); g.lineTo(hx + hw / 2, by - hh - H * 0.07); g.lineTo(hx + hw + 8 * q, by - hh); g.closePath(); g.fillStyle = "#b8392b"; g.fill(); rect(g, hx + hw * 0.2, by - hh * 0.7, hw * 0.2, hh * 0.4, "#5b8cc7"); rect(g, hx + hw * 0.6, by - hh * 0.7, hw * 0.2, hh * 0.4, "#5b8cc7"); }
    rect(g, 0, H * 0.78, W, H * 0.04, "#c9c3b6"); for (const px of [0.2, 0.7]) rect(g, W * px, H * 0.55, 8 * q, H * 0.23, "#6b5b4b");
    g.strokeStyle = "#374151"; g.lineWidth = 2 * q; g.beginPath(); g.moveTo(0, H * 0.58); g.lineTo(W, H * 0.6); g.stroke();
  }
  if (deco === "grid") { g.strokeStyle = "rgba(80,200,255,.13)"; g.lineWidth = q; for (let x = 0; x < W; x += 40 * q) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); } for (let y = 0; y < H; y += 40 * q) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); } }
  g.fillStyle = ground; g.fillRect(-W, H * 0.82, W * 3, H);
  if (deco === "street") for (let x = 0; x < W; x += 140 * q) rect(g, x, H * 0.92, 70 * q, 6 * q, "#e5e7eb");
}
const cache = new Map();
function layer(sc, idx, W, H) { // fundo estático desenhado 1 vez por cena (animação mais leve e sem tremor)
  const k = `${idx}|${W}|${H}|${JSON.stringify(sc.background)}`; let c = cache.get(k);
  if (!c) { c = document.createElement("canvas"); c.width = W; c.height = H; bg(c.getContext("2d"), sc.background, idx, W, H); if (cache.size > 60) cache.delete(cache.keys().next().value); cache.set(k, c); }
  return c;
}
function prop(g, p, W, H) {
  const S = H * 0.08 * (p.scale || 1), x = (p.x ?? 0.5) * W, y = (p.y ?? 0.5) * H;
  if (p.type === "sun") { circ(g, x, y, S, "#fde047"); g.strokeStyle = "#fde047"; g.lineWidth = S * 0.12; for (let i = 0; i < 8; i++) { g.beginPath(); g.moveTo(x + Math.cos(i * TAU / 8) * S * 1.25, y + Math.sin(i * TAU / 8) * S * 1.25); g.lineTo(x + Math.cos(i * TAU / 8) * S * 1.6, y + Math.sin(i * TAU / 8) * S * 1.6); g.stroke(); } }
  if (p.type === "moon") { g.save(); g.beginPath(); g.arc(x, y, S, 0, TAU); g.clip(); g.beginPath(); g.rect(x - 2 * S, y - 2 * S, 4 * S, 4 * S); g.moveTo(x + S * 1.3, y - S * 0.2); g.arc(x + S * 0.4, y - S * 0.2, S * 0.9, 0, TAU); g.fillStyle = "#f1f5f9"; g.fill("evenodd"); g.restore(); }
  if (p.type === "star") { g.beginPath(); for (let i = 0; i < 10; i++) { const r = i % 2 ? S * 0.4 : S, a = -Math.PI / 2 + i * Math.PI / 5; g.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r); } g.closePath(); g.fillStyle = "#fde047"; g.fill(); }
  if (p.type === "tree") { rect(g, x - S * 0.15, y - S * 1.2, S * 0.3, S * 1.2, "#7c4a21"); circ(g, x, y - S * 1.6, S * 0.8, "#2f9e44"); circ(g, x - S * 0.5, y - S * 1.2, S * 0.55, "#37b24d"); circ(g, x + S * 0.5, y - S * 1.2, S * 0.55, "#37b24d"); }
  if (p.type === "house") { rect(g, x - S, y - S * 1.3, S * 2, S * 1.3, "#f4a261", 6); g.beginPath(); g.moveTo(x - S * 1.2, y - S * 1.3); g.lineTo(x, y - S * 2.3); g.lineTo(x + S * 1.2, y - S * 1.3); g.closePath(); g.fillStyle = "#c0392b"; g.fill(); rect(g, x - S * 0.2, y - S * 0.7, S * 0.4, S * 0.7, "#6b3e26"); }
  if (p.type === "cloud") { for (const [dx, dy, r] of [[0, 0, 0.7], [0.7, 0.1, 0.55], [-0.7, 0.1, 0.55], [0.3, -0.3, 0.6]]) circ(g, x + dx * S, y + dy * S, r * S, "rgba(255,255,255,.92)"); }
  if (p.type === "arrow") { g.fillStyle = "#e11d2e"; g.fillRect(x - S, y - S * 0.2, S * 1.4, S * 0.4); g.beginPath(); g.moveTo(x + S * 0.4, y - S * 0.6); g.lineTo(x + S * 1.1, y); g.lineTo(x + S * 0.4, y + S * 0.6); g.closePath(); g.fill(); }
  if (p.type === "sign") { rect(g, x - S * 0.07, y, S * 0.14, S * 1.6, "#4b5563"); rect(g, x - S * 1.2, y - S * 1.1, S * 2.4, S * 1.2, "#0f3d2e", S * 0.1); g.strokeStyle = "#e5e7eb"; g.lineWidth = S * 0.06; g.strokeRect(x - S * 1.1, y - S * 1.0, S * 2.2, S * 1.0); g.fillStyle = "#fb923c"; g.font = `bold ${S * 0.5}px sans-serif`; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(p.label || "", x, y - S * 0.5, S * 2); }
  if (p.type === "heart") { g.beginPath(); g.moveTo(x, y + S * 0.9); g.bezierCurveTo(x - S * 1.6, y - S * 0.2, x - S * 0.6, y - S * 1.3, x, y - S * 0.45); g.bezierCurveTo(x + S * 0.6, y - S * 1.3, x + S * 1.6, y - S * 0.2, x, y + S * 0.9); g.fillStyle = "#ef4444"; g.fill(); }
}
function face(g, emo, S, cx, cy, robot, t = 0, talk = false) {
  const bl = t % 3.4 > 3.28; // pisca a cada ~3,4 s
  if (emo === "angry") emo = "neutral";
  const er = emo === "surprised" ? S * 0.1 : S * 0.07; g.fillStyle = "#1f2937";
  for (const sx of [-1, 1]) { const ex = cx + sx * S * 0.18; if (bl) { g.strokeStyle = "#1f2937"; g.lineWidth = S * 0.04; g.beginPath(); g.moveTo(ex - er, cy); g.lineTo(ex + er, cy); g.stroke(); } else if (robot) g.fillRect(ex - er, cy - er, er * 2, er * 2); else circ(g, ex, cy, er, "#1f2937"); }
  if (talk && emo !== "sad") { const o = Math.abs(Math.sin(t * 9)); g.beginPath(); g.ellipse(cx, cy + S * 0.24, S * 0.1, S * (0.03 + 0.07 * o), 0, 0, TAU); g.fillStyle = "#7f1d1d"; g.fill(); return; }
  g.strokeStyle = "#1f2937"; g.lineWidth = S * 0.045; g.lineCap = "round"; g.beginPath();
  if (emo === "sad") g.arc(cx, cy + S * 0.3, S * 0.12, Math.PI * 1.1, Math.PI * 1.9);
  else if (emo === "surprised") { g.arc(cx, cy + S * 0.22, S * 0.07, 0, TAU); g.fillStyle = "#1f2937"; g.fill(); }
  else if (emo === "neutral") { g.moveTo(cx - S * 0.1, cy + S * 0.22); g.lineTo(cx + S * 0.1, cy + S * 0.22); }
  else g.arc(cx, cy + S * 0.14, S * 0.14, 0.15 * Math.PI, 0.85 * Math.PI);
  g.stroke();
}
function limb(g, x, y, ang, len, w, col) { g.strokeStyle = col; g.lineWidth = w; g.lineCap = "round"; g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.sin(ang) * len, y + Math.cos(ang) * len); g.stroke(); }
function seg(g, x, y, a, l, w, col) { limb(g, x, y, a, l, w, col); return [x + Math.sin(a) * l, y + Math.cos(a) * l]; }
function hero(g, c, S, t, act, emo, talk) { // personagem principal: corpo articulado (braço e perna em 2 segmentos), sobrancelhas, olhos com pupila, pisca e boca falando
  const U = S * 0.78, skin = c.skin || "#c98f5e", shirt = c.color || "#2f6fd6", shorts = c.color2 || "#cf2e3a", run = act === "run", mv = act === "walk" || run;
  const sA = mv ? Math.sin(t * (run ? 14 : 9)) : act === "dance" ? Math.sin(t * 6) : 0, amp = run ? 0.9 : 0.5, ink = "#3b1f12";
  g.save(); if (run) g.rotate(0.12);
  for (const s of [-1, 1]) { const a = sA * s * amp, bend = Math.max(0, -sA * s) * (run ? 1.1 : 0.55), [kx, ky] = seg(g, s * U * 0.2, -U * 1.05, a, U * 0.5, U * 0.22, skin), [fx, fy] = seg(g, kx, ky, a - bend, U * 0.5, U * 0.2, skin); g.fillStyle = "#f1f5f9"; g.beginPath(); g.ellipse(fx + U * 0.1, fy, U * 0.22, U * 0.09, 0, 0, TAU); g.fill(); }
  rect(g, -U * 0.34, -U * 1.3, U * 0.68, U * 0.55, shorts, U * 0.06); rect(g, -U * 0.4, -U * 2.25, U * 0.8, U * 1.1, shirt, U * 0.1);
  for (const s of [-1, 1]) {
    let a1 = s * 0.14 - sA * s * (mv ? amp : 0.25), a2 = a1 + Math.max(0, sA * s) * 0.5 + 0.15;
    if (act === "wave" && s === 1) { a1 = 2.5; a2 = 2.5 + Math.sin(t * 10) * 0.7; } else if (emo === "surprised") { a1 = s * 1.0; a2 = s * 1.2; }
    const [ex, ey] = seg(g, s * U * 0.47, -U * 2.05, a1, U * 0.55, U * 0.2, skin), [hx, hy] = seg(g, ex, ey, a2, U * 0.5, U * 0.18, skin); circ(g, hx, hy, U * 0.13, skin);
  }
  rect(g, -U * 0.1, -U * 2.45, U * 0.2, U * 0.25, skin); circ(g, -U * 0.5, -U * 2.8, U * 0.1, skin); circ(g, U * 0.5, -U * 2.8, U * 0.1, skin); circ(g, 0, -U * 2.85, U * 0.5, skin);
  g.beginPath(); g.arc(0, -U * 2.9, U * 0.52, Math.PI * 1.03, TAU - 0.03); g.closePath(); g.fillStyle = "#1a1a1a"; g.fill();
  const bl = t % 3.4 > 3.28, ey = -U * 2.82;
  for (const s of [-1, 1]) {
    const ex = s * U * 0.19; g.beginPath(); g.ellipse(ex, ey, U * 0.14, bl ? U * 0.02 : U * 0.17, 0, 0, TAU); g.fillStyle = "#fff"; g.fill(); g.strokeStyle = "#111"; g.lineWidth = U * 0.025; g.stroke();
    if (!bl) circ(g, ex + Math.sin(t * 0.8) * U * 0.03, ey, U * (emo === "surprised" ? 0.05 : 0.07), "#111");
    const y0 = emo === "surprised" ? -U * 3.27 : -U * 3.15, [yi, yo] = { happy: [0, -0.04], sad: [-0.08, 0.02], angry: [0.06, -0.06], surprised: [0, 0] }[emo] || [0, 0];
    g.strokeStyle = "#1a1a1a"; g.lineWidth = U * 0.05; g.lineCap = "round"; g.beginPath(); g.moveTo(s * U * 0.08, y0 + yi * U); g.lineTo(s * U * 0.31, y0 + yo * U); g.stroke();
  }
  g.strokeStyle = ink; g.lineWidth = U * 0.045; g.lineCap = "round"; g.beginPath();
  if (talk && emo !== "sad") { const o = Math.abs(Math.sin(t * 9)); g.ellipse(0, -U * 2.55, U * 0.1, U * (0.03 + 0.09 * o), 0, 0, TAU); g.fillStyle = "#5b1a1a"; g.fill(); }
  else if (emo === "surprised") { g.ellipse(0, -U * 2.52, U * 0.08, U * 0.12, 0, 0, TAU); g.fillStyle = "#5b1a1a"; g.fill(); }
  else if (emo === "sad") g.arc(0, -U * 2.4, U * 0.14, 1.15 * Math.PI, 1.85 * Math.PI);
  else if (emo === "happy") g.arc(0, -U * 2.62, U * 0.16, 0.15 * Math.PI, 0.85 * Math.PI);
  else { g.moveTo(-U * 0.14, -U * 2.52); g.lineTo(U * 0.14, -U * 2.52); }
  g.stroke(); g.restore();
}
function character(g, c, t, u, W, H, talk) {
  const S = H * 0.11 * (c.scale || 1), act = c.action || "idle", dx = c.dx ?? (c.action === "run" ? 0.45 : 0.2), emo = c.emotion || "happy";
  let x = (c.x ?? 0.5) * W, y = (c.y ?? 0.78) * H, bob = Math.sin(t * 4) * S * 0.03, rot = 0, sw = 0, wave = false;
  if (act === "walk" || act === "run") { x += dx * W * ease(u); sw = Math.sin(t * 9); bob = Math.abs(sw) * -S * 0.05; }
  if (act === "jump") y -= Math.abs(Math.sin(u * Math.PI * 2 * Math.max(1, Math.round(t / u / 2 || 1)))) * S * 0.8;
  if (act === "dance") { rot = Math.sin(t * 6) * 0.12; bob = -Math.abs(Math.sin(t * 6)) * S * 0.08; sw = Math.sin(t * 6); }
  wave = act === "wave";
  g.save(); g.translate(x, y + bob); if ((act === "walk" || act === "run") && dx < 0) g.scale(-1, 1); g.rotate(rot);
  g.fillStyle = "rgba(0,0,0,.22)"; g.beginPath(); g.ellipse(0, -bob, S * 0.6, S * 0.1, 0, 0, TAU); g.fill();
  const arms = (sy, col, w) => { limb(g, -S * 0.42, sy, sw * 0.7 + 0.3, S * 0.7, w, col); limb(g, S * 0.42, sy, wave ? 2.5 + Math.sin(t * 10) * 0.5 : -sw * 0.7 - 0.3, S * 0.7, w, col); };
  if (c.type === "cat") {
    const col = c.color || "#f59e0b", col2 = c.color2 || "#fde68a";
    g.strokeStyle = col; g.lineWidth = S * 0.16; g.lineCap = "round"; g.beginPath(); g.moveTo(S * 0.4, -S * 0.4); g.quadraticCurveTo(S * 1, -S * 0.5 + Math.sin(t * 5) * S * 0.2, S * 0.8, -S * 1.1); g.stroke();
    limb(g, -S * 0.2, -S * 0.2, sw * 0.5, S * 0.35, S * 0.2, col); limb(g, S * 0.2, -S * 0.2, -sw * 0.5, S * 0.35, S * 0.2, col);
    g.beginPath(); g.ellipse(0, -S * 0.65, S * 0.5, S * 0.6, 0, 0, TAU); g.fillStyle = col; g.fill(); g.beginPath(); g.ellipse(0, -S * 0.55, S * 0.28, S * 0.4, 0, 0, TAU); g.fillStyle = col2; g.fill();
    arms(-S * 0.8, col, S * 0.15);
    for (const sx of [-1, 1]) { g.beginPath(); g.moveTo(sx * S * 0.15, -S * 1.7); g.lineTo(sx * S * 0.5, -S * 2.05); g.lineTo(sx * S * 0.5, -S * 1.5); g.closePath(); g.fillStyle = col; g.fill(); }
    circ(g, 0, -S * 1.45, S * 0.52, col); face(g, emo, S, 0, -S * 1.5, false, t, talk);
    g.strokeStyle = "#374151"; g.lineWidth = S * 0.02; for (const sx of [-1, 1]) for (const k of [-1, 1]) { g.beginPath(); g.moveTo(sx * S * 0.3, -S * 1.32); g.lineTo(sx * S * 0.7, -S * 1.32 + k * S * 0.08); g.stroke(); }
  } else if (c.type === "hero") { hero(g, c, S, t, act, emo, talk);
  } else if (c.type === "robot") {
    const col = c.color || "#94a3b8", col2 = c.color2 || "#22d3ee";
    limb(g, -S * 0.22, -S * 0.5, sw * 0.4, S * 0.5, S * 0.22, "#64748b"); limb(g, S * 0.22, -S * 0.5, -sw * 0.4, S * 0.5, S * 0.22, "#64748b");
    rect(g, -S * 0.45, -S * 1.3, S * 0.9, S * 0.85, col, S * 0.08); rect(g, -S * 0.2, -S * 1.1, S * 0.4, S * 0.3, col2, S * 0.05); arms(-S * 1.2, "#64748b", S * 0.16);
    rect(g, -S * 0.42, -S * 2.1, S * 0.84, S * 0.7, col, S * 0.1); g.strokeStyle = "#64748b"; g.lineWidth = S * 0.05; g.beginPath(); g.moveTo(0, -S * 2.1); g.lineTo(0, -S * 2.4); g.stroke(); circ(g, 0, -S * 2.42, S * 0.07, col2);
    face(g, emo, S, 0, -S * 1.78, true, t, talk);
  } else {
    const girl = c.type === "girl", shirt = c.color || (girl ? "#ec4899" : "#3b82f6"), hair = c.color2 || (girl ? "#f59e0b" : "#4b2e1e"), skin = "#f2c9a0";
    limb(g, -S * 0.17, -S * 0.7, sw * 0.5, S * 0.7, S * 0.2, "#334155"); limb(g, S * 0.17, -S * 0.7, -sw * 0.5, S * 0.7, S * 0.2, "#334155");
    if (girl) { g.beginPath(); g.moveTo(-S * 0.3, -S * 1.5); g.lineTo(S * 0.3, -S * 1.5); g.lineTo(S * 0.55, -S * 0.7); g.lineTo(-S * 0.55, -S * 0.7); g.closePath(); g.fillStyle = shirt; g.fill(); } else rect(g, -S * 0.35, -S * 1.5, S * 0.7, S * 0.85, shirt, S * 0.12);
    arms(-S * 1.4, skin, S * 0.15); rect(g, -S * 0.07, -S * 1.65, S * 0.14, S * 0.2, skin);
    if (girl) { circ(g, -S * 0.42, -S * 2.0, S * 0.22, hair); circ(g, S * 0.42, -S * 2.0, S * 0.22, hair); }
    circ(g, 0, -S * 2.0, S * 0.46, skin); g.beginPath(); g.arc(0, -S * 2.05, S * 0.5, Math.PI, TAU); g.fillStyle = hair; g.fill(); face(g, emo, S, 0, -S * 1.98, false, t, talk);
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
function fx(g, f, t, W, H) {
  const q = W / 540;
  if (f === "speed") { g.strokeStyle = "rgba(255,255,255,.55)"; g.lineWidth = 3 * q; for (let i = 0; i < 14; i++) { const y = (i * 0.071 + 0.05) * H, x = (((t * 2.5 + i * 0.37) % 1.4) - 0.2) * W; g.beginPath(); g.moveTo(x, y); g.lineTo(x + W * 0.28, y); g.stroke(); } }
  if (f === "particles") for (let i = 0; i < 40; i++) { const x = ((i * 0.618 + t * (0.1 + (i % 5) * 0.03)) % 1) * W, y = ((i * 0.382 + Math.sin(t * 2 + i) * 0.02 + 1) % 1) * H; circ(g, x, y, (3 + (i % 3)) * q, i % 2 ? "#60a5fa" : "#ef4444"); }
  if (f === "shockwave") { g.lineWidth = 3 * q; for (let i = 0; i < 4; i++) { const ph = (t * 0.6 + i * 0.25) % 1; g.strokeStyle = `rgba(103,232,249,${1 - ph})`; g.beginPath(); g.arc(W / 2, H * 0.55, ph * W * 0.8, 0, TAU); g.stroke(); } }
}
export function paintScene(g, sc, idx, u, W, H) {
  const t = u * sc.durationSec, m = typeof sc.camera === "string" ? sc.camera : sc.camera?.move, F = sc.fx || []; let z = 1, px = 0, py = 0;
  if (m === "push_in") z = 1 + 0.12 * ease(u); if (m === "pull_out") z = 1.12 - 0.12 * ease(u); if (m === "pan_left") { z = 1.08; px = (0.5 - u) * 0.06 * W; } if (m === "pan_right") { z = 1.08; px = (u - 0.5) * 0.06 * W; }
  if (F.includes("shake")) { z = Math.max(z, 1.04); px += Math.sin(t * 50) * 0.008 * W; py += Math.cos(t * 43) * 0.008 * H; }
  g.save(); g.translate(W / 2 + px, H / 2 + py); g.scale(z, z); g.translate(-W / 2, -H / 2);
  g.drawImage(layer(sc, idx, W, H), 0, 0); (sc.props || []).forEach((p) => prop(g, p, W, H));
  const first = sc.characters?.[0];
  [...(sc.characters || [])].sort((a, b) => (a.y ?? 0.78) - (b.y ?? 0.78)).forEach((c) => character(g, c, t, u, W, H, c.talk ?? (c === first && !!sc.narration)));
  F.forEach((f) => fx(g, f, t, W, H)); g.restore(); (sc.texts || []).forEach((tx) => caption(g, tx, t, W, H));
}
