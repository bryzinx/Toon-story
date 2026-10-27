// Funções puras (testadas com `node --test tests/`).
export const SCRIPT_MIN = 40, SCRIPT_MAX = 5000;
export function validateScript(raw) {
  if (typeof raw !== "string") return { ok: false, error: "O roteiro precisa ser texto." };
  const text = raw.normalize("NFC").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  if (!text) return { ok: false, error: "O roteiro está vazio." };
  if (text.length < SCRIPT_MIN) return { ok: false, error: `Roteiro muito curto (mínimo ${SCRIPT_MIN} caracteres).` };
  if (text.length > SCRIPT_MAX) return { ok: false, error: `Roteiro muito longo (máximo ${SCRIPT_MAX}).` };
  if (text.split(/\s+/).length < 8) return { ok: false, error: "Use pelo menos 8 palavras." };
  if (((text.match(/\p{L}/gu) || []).length / text.length) < 0.5) return { ok: false, error: "O texto não parece um roteiro válido." };
  return { ok: true, text };
}
export function safeFilename(base, ext, fb = "video") {
  const s = String(base).normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60).replace(/-+$/, "");
  return `${s || fb}.${ext}`;
}
export function localPlan(script, targetSec, character, style) {
  let sents = (script.match(/[^.!?…\n]+[.!?…]*/g) || [script]).map((s) => s.trim()).filter(Boolean);
  if (sents.length < 3) { // roteiro curto/sem pontuação: divide por palavras
    const w = script.split(/\s+/).filter(Boolean), k = Math.max(3, Math.min(6, Math.floor(w.length / 3)));
    sents = Array.from({ length: k }, (_, i) => w.slice(Math.floor((i * w.length) / k), Math.floor(((i + 1) * w.length) / k)).join(" ")).filter(Boolean);
  }
  const n = Math.max(3, Math.min(sents.length, Math.round(targetSec / 8), 14));
  const groups = Array.from({ length: n }, () => []);
  sents.forEach((s, i) => groups[Math.min(n - 1, Math.floor((i * n) / sents.length))].push(s));
  return groups.filter((g) => g.length).map((g) => {
    const narration = g.join(" ");
    return { narration, visualPrompt: narration.slice(0, 200), action: "slow camera push-in", durationSec: Math.max(2, narration.length / 14) };
  });
}
export function normalizeDurations(scenes, targetSec) {
  const sum = scenes.reduce((a, s) => a + s.durationSec, 0), T = Math.round(targetSec * 1000);
  const d = scenes.map((s) => Math.max(1000, Math.round((s.durationSec / sum) * T)));
  d[d.length - 1] += T - d.reduce((a, b) => a + b, 0);
  let c = 0;
  return scenes.map((s, i) => { const { durationSec, ...r } = s; const o = { ...r, idx: i, startMs: c, durationMs: d[i] }; c += d[i]; return o; });
}
export function checkPlan(p) {
  if (!p || !Array.isArray(p.scenes) || p.scenes.length < 3) throw new Error("Plano inválido: menos de 3 cenas.");
  return p.scenes.map((s) => {
    if (!s.narration || !s.visualPrompt) throw new Error("Plano inválido: cena sem narração ou prompt visual.");
    return { narration: String(s.narration), visualPrompt: String(s.visualPrompt), action: String(s.action || "câmera lenta"), durationSec: Math.min(15, Math.max(2, Number(s.durationSec) || 6)) };
  });
}
const pad = (n, w = 2) => String(n).padStart(w, "0");
export function srtTime(ms) { const t = Math.max(0, Math.round(ms)); return `${pad(Math.floor(t / 36e5))}:${pad(Math.floor((t % 36e5) / 6e4))}:${pad(Math.floor((t % 6e4) / 1e3))},${pad(t % 1000, 3)}`; }
export function splitCues(text, max = 42, maxLines = 2) {
  const lines = []; let cur = "";
  for (const w of text.replace(/\s+/g, " ").trim().split(" ").filter(Boolean)) {
    if (!cur) cur = w; else if (cur.length + 1 + w.length <= max) cur += " " + w; else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  const out = []; for (let i = 0; i < lines.length; i += maxLines) out.push(lines.slice(i, i + maxLines).join("\n"));
  return out;
}
export function buildCues(scenes) {
  const out = [];
  for (const sc of scenes) {
    const parts = splitCues(sc.narration); if (!parts.length) continue;
    const w = parts.map((p) => Math.max(1, p.replace(/\s/g, "").length)), tot = w.reduce((a, b) => a + b, 0), end = sc.startMs + sc.durationMs;
    let cur = sc.startMs;
    parts.forEach((text, i) => {
      const last = i === parts.length - 1, e = last ? end : Math.min(Math.max(cur + Math.round((sc.durationMs * w[i]) / tot), cur + 1), end);
      out.push({ startMs: cur, endMs: e, text }); cur = e;
    });
  }
  return out;
}
export const buildSrt = (cues) => cues.map((c, i) => `${i + 1}\n${srtTime(c.startMs)} --> ${srtTime(c.endMs)}\n${c.text}`).join("\n\n") + "\n";
export function validateSrt(srt, totalMs, tol = 500) {
  const errors = [], body = srt.replace(/\r\n/g, "\n").trim(); if (!body) return { ok: false, errors: ["SRT vazio"] };
  const re = /^(\d+)\n(\d{2}):(\d{2}):(\d{2}),(\d{3}) --> (\d{2}):(\d{2}):(\d{2}),(\d{3})\n[\s\S]+$/, ms = (h, m, s, x) => ((+h * 60 + +m) * 60 + +s) * 1000 + +x;
  let prev = 0;
  body.split(/\n\n+/).forEach((b, i) => {
    const g = re.exec(b); if (!g) return errors.push(`bloco ${i + 1}: formato inválido`);
    const a = ms(g[2], g[3], g[4], g[5]), z = ms(g[6], g[7], g[8], g[9]);
    if (+g[1] !== i + 1) errors.push(`bloco ${i + 1}: índice fora de sequência`);
    if (a >= z) errors.push(`bloco ${i + 1}: início >= fim`);
    if (a < prev) errors.push(`bloco ${i + 1}: sobreposição`);
    if (z > totalMs + tol) errors.push(`bloco ${i + 1}: passa da duração`);
    prev = z;
  });
  return { ok: !errors.length, errors };
}
