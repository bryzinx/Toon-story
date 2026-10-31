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
    const parts = splitCues(sc.narration, 20, 1); if (!parts.length) continue;
    const w = parts.map((p) => Math.max(1, p.replace(/\s/g, "").length)), tot = w.reduce((a, b) => a + b, 0), end = sc.startMs + sc.durationMs;
    let cur = sc.startMs;
    parts.forEach((text, i) => {
      const last = i === parts.length - 1, e = last ? end : Math.min(Math.max(cur + Math.round((sc.durationMs * w[i]) / tot), cur + 1), end);
      out.push({ startMs: cur, endMs: e, text }); cur = e;
    });
  }
  return out;
}
export const buildSrt = (cues) => cues.map((c, i) => `${i + 1}\n${srtTime(c.startMs)} --> ${srtTime(c.endMs)}\n${c.text.replace(/\*/g, "")}`).join("\n\n") + "\n";
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

// ===== Modo JSON (toonstory v1) =====
export const CHARS = ["hero", "boy", "girl", "cat", "robot"], EMOS = ["happy", "sad", "surprised", "neutral", "angry"], ACTS = ["idle", "walk", "run", "jump", "wave", "dance", "fly"],
  BGS = ["night_city", "forest", "room", "space", "beach", "park", "street", "science"], PROPS = ["sun", "moon", "star", "tree", "house", "cloud", "heart", "arrow", "sign", "dragon", "car", "sword", "tree_proc", "house_proc", "rocket", "fish", "bird"], FX = ["shake", "speed", "particles", "shockwave"], CAMS = ["none", "push_in", "pull_out", "pan_left", "pan_right"], ANIMS = ["fade", "pop", "none"];
export const SHAPES = ["circle", "ellipse", "rect", "triangle", "polygon", "line", "arc", "path", "star"];
export const PROC_TEMPLATES = ["dragon", "car", "sword", "tree_proc", "house_proc", "rocket", "fish", "bird"];
const HEX = /^#[0-9a-fA-F]{6}$/;

export function parseSpecText(t) {
  const s = String(t).replace(/<think>[\s\S]*?<\/think>/g, "").trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  if (!s) return { ok: false, error: "Cole o JSON no campo." };
  try { const a = s.indexOf("{"), b = s.lastIndexOf("}"); return { ok: true, data: JSON.parse(a >= 0 && b > a ? s.slice(a, b + 1) : s) }; } catch (e) { const a = s.indexOf("{"), z = s.lastIndexOf("}"); if (a > 0 && z > a) { try { return { ok: true, data: JSON.parse(s.slice(a, z + 1)) }; } catch {} } const cut = !s.endsWith("}"); return { ok: false, truncated: cut, error: (cut ? "JSON incompleto (a IA cortou a resposta): " : "JSON inválido: ") + e.message }; }
}
export function validateSpec(d) {
  const err = [], add = (p, m) => { if (err.length < 10) err.push(`${p}: ${m}`); };
  const num = (v, a, b) => typeof v === "number" && Number.isFinite(v) && v >= a && v <= b;
  const one = (p, v, l) => { if (!l.includes(v)) add(p, `"${v}" inválido; use ${l.join(" | ")}`); };
  const opt = (p, v, a, b) => { if (v !== undefined && !num(v, a, b)) add(p, `número entre ${a} e ${b}`); };
  const hex = (p, v) => { if (v !== undefined && !HEX.test(v)) add(p, 'cor no formato "#rrggbb"'); };
  const list = (p, v, max) => { if (v === undefined) return []; if (!Array.isArray(v)) { add(p, "precisa ser uma lista"); return []; } if (v.length > max) add(p, `máximo ${max} itens`); return v.slice(0, max); };
  if (!d || typeof d !== "object" || Array.isArray(d)) return { ok: false, errors: ["raiz: precisa ser um objeto JSON { ... }"], total: 0 };
  if (d.version !== 1 && d.version !== 2) add("version", "deve ser 1 ou 2");
  if (d.title !== undefined && (typeof d.title !== "string" || d.title.length > 80)) add("title", "texto de até 80 caracteres");
  if (!Array.isArray(d.scenes) || !d.scenes.length || d.scenes.length > 40) return { ok: false, errors: [...err, "scenes: lista de 1 a 40 cenas"], total: 0 };
  let total = 0;
  d.scenes.forEach((s, i) => {
    const P = `scenes[${i}]`; if (!s || typeof s !== "object" || Array.isArray(s)) return add(P, "precisa ser um objeto");
    if (num(s.durationSec, 1, 30)) total += s.durationSec; else add(P + ".durationSec", "número entre 1 e 30");
    if (s.narration !== undefined && (typeof s.narration !== "string" || s.narration.length > 600)) add(P + ".narration", "texto de até 600 caracteres");
    const b = s.background;
    if (typeof b === "string") one(P + ".background", b, BGS); else if (b !== undefined && !(b && Array.isArray(b.colors) && b.colors.length === 2 && b.colors.every((c) => HEX.test(c)))) add(P + ".background", `preset (${BGS.join(" | ")}) ou {"colors":["#rrggbb","#rrggbb"]}`);
    list(P + ".characters", s.characters, 4).forEach((c, j) => { const Q = `${P}.characters[${j}]`; if (!c || typeof c !== "object") return add(Q, "precisa ser objeto"); one(Q + ".type", c.type, CHARS); opt(Q + ".x", c.x, 0, 1); opt(Q + ".y", c.y, 0, 1); opt(Q + ".scale", c.scale, 0.3, 3); opt(Q + ".dx", c.dx, -0.6, 0.6); if (c.emotion !== undefined) one(Q + ".emotion", c.emotion, EMOS); if (c.action !== undefined) one(Q + ".action", c.action, ACTS); hex(Q + ".color", c.color); hex(Q + ".color2", c.color2); hex(Q + ".skin", c.skin); if (c.talk !== undefined && typeof c.talk !== "boolean") add(Q + ".talk", "true ou false"); });
    list(P + ".props", s.props, 12).forEach((c, j) => {
      const Q = `${P}.props[${j}]`; if (!c || typeof c !== "object") return add(Q, "precisa ser objeto");
      const okType = c.type && (PROPS.includes(c.type) || SHAPES.includes(c.type) || PROC_TEMPLATES.includes(c.type));
      const okProc = c.template && PROC_TEMPLATES.includes(c.template) || Array.isArray(c.parts) || (c.shape && SHAPES.includes(c.shape));
      if (!okType && !okProc) add(Q + ".type", `use prop (${PROPS.join(" | ")}) ou template procedural (${PROC_TEMPLATES.join(" | ")}) ou shape (${SHAPES.join(" | ")}) ou parts[]`);
      opt(Q + ".x", c.x, 0, 1); opt(Q + ".y", c.y, 0, 1); opt(Q + ".scale", c.scale, 0.2, 4); opt(Q + ".rotation", c.rotation, -6.3, 6.3);
      if (c.label !== undefined && (typeof c.label !== "string" || c.label.length > 16)) add(Q + ".label", "texto de até 16 caracteres");
      hex(Q + ".color", c.color);
    });
    list(P + ".objects", s.objects, 12).forEach((c, j) => {
      const Q = `${P}.objects[${j}]`; if (!c || typeof c !== "object") return add(Q, "precisa ser objeto");
      const ok = (c.template && PROC_TEMPLATES.includes(c.template)) || Array.isArray(c.parts) || (c.shape && SHAPES.includes(c.shape));
      if (!ok) add(Q, "informe template, shape ou parts[]");
      opt(Q + ".x", c.x, 0, 1); opt(Q + ".y", c.y, 0, 1); opt(Q + ".scale", c.scale, 0.2, 5); opt(Q + ".rotation", c.rotation, -6.3, 6.3); hex(Q + ".color", c.color);
    });

    list(P + ".texts", s.texts, 4).forEach((c, j) => { const Q = `${P}.texts[${j}]`; if (!c || typeof c !== "object") return add(Q, "precisa ser objeto"); if (typeof c.text !== "string" || !c.text.trim() || c.text.length > 120) add(Q + ".text", "texto de 1 a 120 caracteres"); opt(Q + ".x", c.x, 0, 1); opt(Q + ".y", c.y, 0, 1); opt(Q + ".size", c.size, 0.02, 0.15); hex(Q + ".color", c.color); if (c.anim !== undefined) one(Q + ".anim", c.anim, ANIMS); });
    list(P + ".fx", s.fx, 3).forEach((f, j) => one(`${P}.fx[${j}]`, f, FX));
    const m = s.camera === undefined ? undefined : typeof s.camera === "string" ? s.camera : s.camera?.move; if (m !== undefined) one(P + ".camera", m, CAMS);
  });
  if (!err.length && (total < 5 || total > 180)) add("scenes", `a soma das durações é ${total}s; use entre 5 e 180`);
  return { ok: !err.length, errors: err, total };
}
export const EXAMPLE_SPEC = { version: 2, title: "Dragão e o herói", scenes: [
  { durationSec: 3, background: "park", narration: "Um *dragão* apareceu no parque.", camera: "push_in", characters: [{ type: "hero", x: 0.25, y: 0.78, emotion: "surprised", action: "idle" }], props: [{ type: "dragon", x: 0.7, y: 0.55, scale: 1.4 }], texts: [{ text: "Surpresa!", y: 0.18, anim: "pop" }] },
  { durationSec: 3, background: "space", narration: "O herói *voou* atrás dele.", camera: "pan_right", characters: [{ type: "hero", x: 0.3, y: 0.5, emotion: "happy", action: "fly", dx: 0.25 }], props: [{ type: "rocket", x: 0.75, y: 0.4, scale: 1.1 }], fx: ["particles"] },
  { durationSec: 3, background: "street", narration: "Depois foram de *carro*.", characters: [{ type: "hero", x: 0.35, y: 0.78, action: "wave", emotion: "happy" }], props: [{ type: "car", x: 0.65, y: 0.78, scale: 1.3 }], texts: [{ text: "Fim", y: 0.22, size: 0.08, anim: "fade" }] },
] };
export const SPEC_PROMPT = `Converta o roteiro abaixo em JSON para o ToonStory. Responda SOMENTE com o JSON, sem texto extra e sem markdown.
Regras: "version":1 ou 2; "scenes" com 1 a 40 cenas; cada cena tem "durationSec" (1 a 30; soma total entre 5 e 180), "narration", "background" (${BGS.join(" | ")} ou {"colors":["#rrggbb","#rrggbb"]}), "characters" (até 4: type ${CHARS.join(" | ")}, x/y 0-1, scale, emotion ${EMOS.join(" | ")}, action ${ACTS.join(" | ")}, dx, color, skin), "props" (type: clássicos ${PROPS.filter((p)=>!PROC_TEMPLATES.includes(p)).join(" | ")} OU templates procedurais ${PROC_TEMPLATES.join(" | ")} OU shape ${SHAPES.join(" | ")}; também aceita "template","parts","shape","rotation","color"), "objects" (opcional: composite procedural com template/parts/shape), "texts", "camera" (${CAMS.join(" | ")}), "fx" (${FX.join(" | ")}). Em narration use *palavra*. Preferir cenas curtas 1-3s.
Exemplo: ${JSON.stringify(EXAMPLE_SPEC)}
ROTEIRO:
`;

