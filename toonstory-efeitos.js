// Efeitos visuais, iluminação e qualidade. Tudo é função do tempo (sem estado), então o vídeo sai igual em qualquer gravação.
const TAU = Math.PI * 2, fr = (n) => n - Math.floor(n), hash = (i, s = 0) => fr(Math.sin(i * 127.1 + s * 311.7) * 43758.5453), ease = (u) => u * u * (3 - 2 * u);
const QMAP = { leve: 0.4, normal: 1, alta: 1.6 };
let QUALITY = QMAP[(typeof localStorage !== "undefined" && localStorage.getItem("ts.quality")) || "normal"] ?? 1;
export function setQuality(name) { QUALITY = QMAP[name] ?? 1; }
const cnt = (n) => Math.max(4, Math.round(n * QUALITY)), dot = (g, x, y, r, f) => { g.beginPath(); g.arc(x, y, Math.max(0.1, r), 0, TAU); g.fillStyle = f; g.fill(); };
const glow = (g, fn) => { g.save(); g.globalCompositeOperation = "lighter"; try { fn(); } finally { g.restore(); } };
const E = {
  rain(g, t, W, H) { const q = W / 540; g.strokeStyle = "rgba(190,215,255,.6)"; g.lineWidth = 1.5 * q; g.beginPath(); for (let i = 0, n = cnt(120); i < n; i++) { const ph = fr(hash(i, 1) + t * (1.2 + hash(i, 2) * 0.6)), x = hash(i) * W * 1.2 - W * 0.1 - ph * H * 0.15, y = ph * H * 1.1 - H * 0.05; g.moveTo(x, y); g.lineTo(x - 6 * q, y + 18 * q); } g.stroke(); },
  snow(g, t, W, H) { const q = W / 540; for (let i = 0, n = cnt(90); i < n; i++) dot(g, hash(i) * W + Math.sin(t + i) * 20 * q, fr(hash(i, 1) + t * (0.08 + hash(i, 2) * 0.1)) * H, (1.5 + hash(i, 3) * 2.5) * q, "rgba(255,255,255,.88)"); },
  smoke(g, t, W, H, p) { const q = W / 540, px = p?.x ?? 0.5, py = p?.y ?? 0.7; for (let i = 0, n = cnt(14); i < n; i++) { const ph = fr(i / n + t * 0.25); dot(g, px * W + Math.sin(ph * 6 + i) * 60 * q * ph, py * H - ph * H * 0.35, (14 + ph * 50) * q, `rgba(120,120,128,${0.38 * (1 - ph)})`); } },
  sparks(g, t, W, H, p) { const q = W / 540, px = p?.x ?? 0.5, py = p?.y ?? 0.75; glow(g, () => { for (let i = 0, n = cnt(36); i < n; i++) { const ph = fr((i / n) * 0.7 + t * 1.1 + hash(i) * 0.3), a = -Math.PI / 2 + (hash(i, 1) - 0.5) * 1.6, v = (120 + hash(i, 2) * 160) * q; dot(g, px * W + Math.cos(a) * v * ph, py * H + Math.sin(a) * v * ph + 260 * q * ph * ph, (2 + hash(i, 3) * 2) * q, `rgba(255,${170 + Math.round(hash(i, 4) * 70)},60,${1 - ph})`); } }); },
  leaves(g, t, W, H) { const q = W / 540, C = ["#65a30d", "#d97706", "#b45309", "#4d7c0f"]; for (let i = 0, n = cnt(24); i < n; i++) { g.save(); g.translate(fr(hash(i) + t * 0.04) * W + Math.sin(t * 2 + i) * 30 * q, fr(hash(i, 1) + t * (0.1 + hash(i, 2) * 0.08)) * H); g.rotate(t * 2 + i); g.beginPath(); g.ellipse(0, 0, 9 * q, 4 * q, 0, 0, TAU); g.fillStyle = C[i % 4]; g.fill(); g.restore(); } },
  bubbles(g, t, W, H) { const q = W / 540; for (let i = 0, n = cnt(24); i < n; i++) { const ph = fr(hash(i, 1) + t * (0.08 + hash(i, 2) * 0.08)), x = hash(i) * W + Math.sin(t * 2 + i) * 12 * q, y = H * (1.05 - ph * 1.15), r = (4 + hash(i, 3) * 12) * q; dot(g, x, y, r, "rgba(255,255,255,.12)"); g.strokeStyle = "rgba(255,255,255,.7)"; g.lineWidth = 1.5 * q; g.beginPath(); g.arc(x, y, r, 0, TAU); g.stroke(); dot(g, x - r * 0.35, y - r * 0.35, r * 0.22, "rgba(255,255,255,.8)"); } },
  confetti(g, t, W, H) { const q = W / 540, C = ["#ef4444", "#f59e0b", "#22c55e", "#3b82f6", "#a855f7", "#ec4899"]; for (let i = 0, n = cnt(70); i < n; i++) { g.save(); g.translate(hash(i) * W + Math.sin(t * 2 + i) * 25 * q, fr(hash(i, 1) + t * (0.2 + hash(i, 2) * 0.25)) * H); g.rotate(t * 5 + i); g.fillStyle = C[i % 6]; g.fillRect(-4 * q, -2 * q, 8 * q, 4 * q); g.restore(); } },
  fireworks(g, t, W, H) { const q = W / 540; glow(g, () => { for (let j = 0; j < 3; j++) { const b = Math.floor(t / 1.3) - j, age = t - b * 1.3; if (b < 0 || age > 1.6) continue; const ox = (0.2 + hash(b) * 0.6) * W, oy = (0.15 + hash(b, 1) * 0.3) * H, hue = Math.round(hash(b, 2) * 360); for (let i = 0, n = cnt(30); i < n; i++) { const a = (i / n) * TAU, r = (20 + age * 140 * (0.6 + hash(i, b) * 0.4)) * q; dot(g, ox + Math.cos(a) * r, oy + Math.sin(a) * r + 60 * q * age * age, 2.5 * q, `hsla(${hue},100%,65%,${Math.max(0, 1 - age / 1.6)})`); } } }); },
  godrays(g, t, W, H) { glow(g, () => { for (let i = 0; i < 5; i++) { const a = 0.55 + i * 0.16 + Math.sin(t * 0.6 + i) * 0.04, len = H * 1.4, gr = g.createLinearGradient(W * 0.1, -H * 0.05, W * 0.1 + Math.cos(a) * len, -H * 0.05 + Math.sin(a) * len); gr.addColorStop(0, "rgba(255,240,180,.26)"); gr.addColorStop(1, "rgba(255,240,180,0)"); g.beginPath(); g.moveTo(W * 0.1, -H * 0.05); g.lineTo(W * 0.1 + Math.cos(a - 0.05) * len, -H * 0.05 + Math.sin(a - 0.05) * len); g.lineTo(W * 0.1 + Math.cos(a + 0.05) * len, -H * 0.05 + Math.sin(a + 0.05) * len); g.closePath(); g.fillStyle = gr; g.fill(); } }); },
  vignette(g, t, W, H) { const gr = g.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.25, W / 2, H / 2, Math.max(W, H) * 0.78); gr.addColorStop(0, "rgba(0,0,0,0)"); gr.addColorStop(1, "rgba(0,0,0,.6)"); g.fillStyle = gr; g.fillRect(-W, -H, W * 3, H * 3); },
  lightning(g, t, W, H) { const q = W / 540, tt = t % 2.6, k = Math.floor(t / 2.6); if (tt < 0.15 || (tt > 0.3 && tt < 0.38)) { g.fillStyle = `rgba(255,255,255,${tt < 0.15 ? 0.5 * (1 - tt / 0.15) : 0.3})`; g.fillRect(-W, -H, W * 3, H * 3); } if (tt < 0.15) glow(g, () => { g.strokeStyle = "rgba(220,230,255,.95)"; g.lineWidth = 4 * q; g.beginPath(); let x = (0.3 + hash(k) * 0.4) * W; g.moveTo(x, 0); for (let i = 1; i <= 8; i++) { x += (hash(k, i) - 0.5) * 70 * q; g.lineTo(x, (i / 8) * H * 0.62); } g.stroke(); }); },
};
export const EFFECT_NAMES = Object.keys(E);
export function drawEffect(g, name, t, W, H, pos) { // true se o efeito é daqui; mantém o estado do canvas equilibrado mesmo com erro
  const f = E[name]; if (!f) return false; g.save(); try { f(g, t, W, H, pos); } catch { /* efeito falhou: ignora */ } finally { g.restore(); } return true;
}
export function grade(g, light, W, H) { // iluminação da cena (cor sobre tudo)
  if (!light || light === "day") return; g.save();
  try {
    const R = [-W, -H, W * 3, H * 3];
    if (light === "night") { g.globalCompositeOperation = "multiply"; g.fillStyle = "rgba(14,22,84,.5)"; g.fillRect(...R); }
    else if (light === "sunset") { const gr = g.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, "rgba(120,60,160,.24)"); gr.addColorStop(1, "rgba(255,120,40,.3)"); g.fillStyle = gr; g.fillRect(...R); }
    else if (light === "warm") { g.fillStyle = "rgba(255,170,60,.15)"; g.fillRect(...R); }
    else if (light === "cold") { g.fillStyle = "rgba(70,140,255,.17)"; g.fillRect(...R); }
    else if (light === "neon") { g.fillStyle = "rgba(30,10,60,.3)"; g.fillRect(...R); g.globalCompositeOperation = "lighter"; for (const [x, c] of [[0, "rgba(255,40,200,.32)"], [W, "rgba(40,220,255,.3)"]]) { const gr = g.createRadialGradient(x, H * 0.5, 0, x, H * 0.5, W * 0.9); gr.addColorStop(0, c); gr.addColorStop(1, "rgba(0,0,0,0)"); g.fillStyle = gr; g.fillRect(...R); } }
  } finally { g.restore(); }
}
export const transitionShift = (tr, t, W) => { const k = Math.min(1, t / 0.4); return { k, px: tr === "slide" && k < 1 ? (1 - ease(k)) * W * 0.6 : 0, zoom: tr === "zoom" && k < 1 ? 1 + 0.25 * (1 - ease(k)) : 1 }; };
export function transitionOverlay(g, tr, k, W, H) { if ((tr === "fade" || tr === "flash") && k < 1) { g.save(); g.globalAlpha = 1 - k; g.fillStyle = tr === "fade" ? "#000" : "#fff"; g.fillRect(0, 0, W, H); g.restore(); } }
