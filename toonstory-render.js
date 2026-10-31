// Renderiza no navegador: Ken Burns + fusão entre cenas + legendas opcionais. Sem áudio.
const FADE = 600, ease = (u) => u * u * (3 - 2 * u);
export const supportsRender = () => typeof MediaRecorder !== "undefined" && !!HTMLCanvasElement.prototype.captureStream;
import { encodeFast } from "./toonstory-mp4.js";
export async function renderVideo({ scenes, bitmaps = [], demo = [], W, H, cues, onProgress, signal, painter, fast = true, wake = false }) {
  const total = scenes.reduce((a, s) => a + s.durationMs, 0);
  const c = document.createElement("canvas"); c.width = W; c.height = H; const g = c.getContext("2d");
  const mime = ["video/mp4;codecs=avc1", "video/mp4", "video/webm;codecs=vp9", "video/webm"].find((m) => MediaRecorder.isTypeSupported(m));
  if (!mime) throw new Error("Este navegador não grava vídeo. Use Chrome ou Edge.");
  const rec = new MediaRecorder(c.captureStream(30), { mimeType: mime, videoBitsPerSecond: total > 3e5 ? (W >= 1080 ? 3e6 : 1.5e6) : W >= 1080 ? 8e6 : 5e6 }), chunks = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  let wl = null; if (wake) try { wl = await navigator.wakeLock?.request("screen"); } catch {}
  const frame = (i, u) => {
    if (painter) return painter(g, i, u, W, H);
    const b = bitmaps[i], z = i % 2 ? 1.15 - 0.15 * ease(u) : 1 + 0.15 * ease(u), s = Math.max(W / b.width, H / b.height) * z, dw = b.width * s, dh = b.height * s;
    g.drawImage(b, (W - dw) / 2 + (i % 2 ? -1 : 1) * (u - 0.5) * 0.04 * W, (H - dh) / 2, dw, dh);
    if (demo[i]) { g.fillStyle = "rgba(0,0,0,.55)"; g.fillRect(0, H * 0.04, W, W * 0.08); g.fillStyle = "#fff"; g.font = `bold ${W * 0.04}px sans-serif`; g.textAlign = "center"; g.fillText("DEMO – não gerado por IA", W / 2, H * 0.04 + W * 0.055); }
  };
  const draw = (t) => {
    let k = scenes.findIndex((s) => t >= s.startMs && t < s.startMs + s.durationMs); if (k < 0) k = scenes.length - 1; const s = scenes[k];
    g.globalAlpha = 1; g.fillStyle = "#000"; g.fillRect(0, 0, W, H); frame(k, Math.min(1, (t - s.startMs) / s.durationMs));
    const left = s.startMs + s.durationMs - t;
    if (!painter && scenes[k + 1] && left < FADE) // (modo JSON: corte seco, sem fusão)
     { g.globalAlpha = 1 - left / FADE; frame(k + 1, 0); g.globalAlpha = 1; }
    const cue = cues?.find((q) => t >= q.startMs && t < q.endMs);
    if (cue) sub(g, cue.text, W, H);
  };
  if (fast && typeof VideoEncoder !== "undefined" && typeof VideoFrame !== "undefined") { // gravação rápida, quadro a quadro
    try { const r = await encodeFast({ c, draw, total, W, H, onProgress, signal }); wl?.release?.(); bitmaps.forEach((b) => b.close?.()); return r; }
    catch (e) { if (e.message === "Cancelado") { wl?.release?.(); bitmaps.forEach((b) => b.close?.()); throw e; } console.warn("Gravação rápida indisponível; usando tempo real:", e.message); }
  }
  return new Promise((res, rej) => {
    const done = () => { wl?.release?.(); bitmaps.forEach((b) => b.close?.()); };
    rec.onerror = (e) => { done(); rej(e.error || new Error("Erro na gravação")); };
    rec.onstop = () => { done(); const blob = new Blob(chunks, { type: mime.split(";")[0] }); blob.size > 10000 ? res({ blob, type: blob.type }) : rej(new Error("Arquivo de vídeo vazio ou incompleto")); };
    rec.start(1000); const t0 = performance.now();
    const tick = () => { try { tick0(); } catch (e) { rec.onstop = done; try { rec.stop(); } catch {} rej(e); } };
    const tick0 = () => {
      if (signal?.aborted) { rec.onstop = done; rec.stop(); return rej(new Error("Cancelado")); }
      const t = performance.now() - t0;
      if (t >= total) { draw(total - 1); onProgress?.(1); return setTimeout(() => rec.stop(), 300); }
      draw(t); onProgress?.(t / total); requestAnimationFrame(tick);
    };
    tick();
  });
}

// Legenda estilo "explicativo": caixa-alta, contorno preto, palavra *destacada* em amarelo, sempre dentro da tela.
export function sub(g, text, W, H) {
  const words = text.replace(/\s+/g, " ").trim().toUpperCase().split(" ").filter(Boolean).map((w) => ({ w: w.replace(/\*/g, ""), hi: w.includes("*") }));
  if (!words.length) return;
  const fam = '"Arial Narrow","Roboto Condensed",Oswald,Impact,sans-serif', maxW = W * 0.84, wd = (l) => g.measureText(l.map((x) => x.w).join(" ")).width;
  let fs = Math.round(W * 0.085), lines;
  for (;;) {
    g.font = `bold ${fs}px ${fam}`; lines = []; let cur = [];
    for (const k of words) { if (cur.length && wd([...cur, k]) > maxW) { lines.push(cur); cur = [k]; } else cur.push(k); }
    lines.push(cur);
    if (fs <= W * 0.04 || (lines.length <= 2 && lines.every((l) => wd(l) <= maxW))) break;
    fs -= 2;
  }
  g.textAlign = "left"; g.textBaseline = "middle"; g.lineJoin = "round"; g.lineWidth = fs * 0.2;
  const lh = fs * 1.15, half = (lh * lines.length) / 2, y0 = Math.min(H * 0.9 - half, Math.max(H * 0.1 + half, H * 0.7)), sp = g.measureText(" ").width;
  lines.forEach((l, i) => {
    const y = y0 + (i - (lines.length - 1) / 2) * lh; let x = (W - wd(l)) / 2;
    const pos = l.map((k) => { const p = x; x += g.measureText(k.w).width + sp; return p; });
    g.strokeStyle = "#000"; l.forEach((k, n) => g.strokeText(k.w, pos[n], y));
    l.forEach((k, n) => { g.fillStyle = k.hi ? "#fbbf24" : "#fff"; g.fillText(k.w, pos[n], y); });
  });
}
