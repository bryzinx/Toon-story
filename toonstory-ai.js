// Integrações de IA. A chave fica só no localStorage deste navegador e vai apenas ao provedor escolhido.
import { checkPlan, parseSpecText, validateSpec, SPEC_PROMPT } from "./toonstory-lib.js";
import { PROVEDORES } from "./toonstory-provedores.js";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rd = (k) => { try { return JSON.parse(localStorage.getItem(k) || "{}"); } catch { return {}; } };
export const cfg = () => { // ts.cfg2: {prov, keys:{id:chave}, models:{id:modelo}, base}; migra o formato antigo (ts.cfg)
  const r = rd("ts.cfg2"); if (r.keys) return { prov: r.prov || "mistral", keys: r.keys, models: r.models || {}, base: r.base || "" };
  const o = rd("ts.cfg"), keys = {}; for (const k of ["mistral", "gemini", "groq"]) if (o[k]) keys[k] = o[k];
  return { prov: Object.keys(keys)[0] || "mistral", keys, models: {}, base: "" };
};
export const saveCfg = (c) => localStorage.setItem("ts.cfg2", JSON.stringify(c));
export function active() {
  const c = cfg(), p = PROVEDORES.find((x) => x.id === c.prov) || PROVEDORES[0];
  return { p, key: c.keys[p.id] || "", model: c.models[p.id] || p.padrao, base: p.id === "outro" ? c.base : p.base };
}
export const ready = () => { const a = active(); return !!a.base && !!a.model && (a.p.nokey || !!a.key); };
async function http(url, opt, tries = 3, ms = 60000, ext) {
  let err;
  for (let i = 0; i < tries; i++) {
    if (ext?.aborted) throw new Error("Cancelado");
    const ac = new AbortController(), t = setTimeout(() => ac.abort(), ms), onAb = () => ac.abort();
    ext?.addEventListener("abort", onAb);
    try { const r = await fetch(url, { ...opt, signal: ac.signal }); if (r.ok) return r; err = new Error(`HTTP ${r.status}`); if (r.status < 500 && r.status !== 429) break; }
    catch (e) { if (ext?.aborted) throw new Error("Cancelado"); err = e.name === "AbortError" ? new Error("Tempo esgotado") : e; }
    finally { clearTimeout(t); ext?.removeEventListener("abort", onAb); }
    if (i < tries - 1) await sleep(1500 * (i + 1));
  }
  throw err;
}
const sys = (sec, ch, st) => `Você é roteirista de animação. Divida o roteiro em cenas para um vídeo vertical de ${sec}s. Responda SOMENTE JSON: {"scenes":[{"narration":"trecho EXATO do roteiro em português","visualPrompt":"descrição visual em INGLÊS, estilo ${st}, personagem: ${ch}","action":"ação/câmera","durationSec":número}]}. 8 a 14 cenas, durações somando ${sec}. Cubra todo o roteiro, sem inventar texto.`;
const parse = (t) => {
  const x = String(t).replace(/<think>[\s\S]*?<\/think>/g, "").replace(/^```(?:json)?|```$/g, "").trim();
  try { return JSON.parse(x); } catch { const a = x.indexOf("{"), b = x.lastIndexOf("}"); if (a >= 0 && b > a) return JSON.parse(x.slice(a, b + 1)); throw new Error("A resposta da IA não é JSON"); }
};
async function chat(msgs, signal) {
  const a = active(); if (!ready()) throw new Error("Escolha o provedor, o modelo e cole a chave em Integrações.");
  const url = `${a.base.replace(/\/$/, "")}/chat/completions`, headers = { "Content-Type": "application/json", ...(a.key ? { Authorization: `Bearer ${a.key}` } : {}) };
  const body = (json) => JSON.stringify({ model: a.model, messages: msgs, ...(json ? { response_format: { type: "json_object" } } : {}) });
  let r; try { r = await http(url, { method: "POST", headers, body: body(true) }, 2, 120000, signal); }
  catch (e) { if (!/HTTP (400|422)/.test(e.message)) throw e; r = await http(url, { method: "POST", headers, body: body(false) }, 2, 120000, signal); } // alguns provedores não aceitam modo JSON
  const t = (await r.json()).choices?.[0]?.message?.content; if (!t) throw new Error("A IA devolveu uma resposta vazia."); return t;
}
export async function planAI(script, p) {
  if (!ready()) return null;
  const t = await chat([{ role: "system", content: sys(p.targetSeconds, p.characterDescription, p.style) }, { role: "user", content: script }]);
  return { source: active().p.id, scenes: checkPlan(parse(t)) };
}
export async function genImage(prompt, seed, signal) {
  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt.slice(0, 600))}?width=576&height=1024&seed=${seed}&nologo=true`;
  const r = await http(url, {}, 2, 90000, signal), b = await r.blob();
  if (!b.type.startsWith("image/") || b.size < 2000) throw new Error("Serviço de imagem devolveu resposta inválida");
  return b;
}
export function demoImage(i, W, H) {
  const c = document.createElement("canvas"); c.width = 576; c.height = 1024; const g = c.getContext("2d");
  const gr = g.createLinearGradient(0, 0, 576, 1024); gr.addColorStop(0, `hsl(${(i * 47) % 360} 55% 28%)`); gr.addColorStop(1, `hsl(${(i * 47 + 80) % 360} 55% 12%)`);
  g.fillStyle = gr; g.fillRect(0, 0, 576, 1024); g.fillStyle = "rgba(255,255,255,.85)"; g.font = "bold 64px sans-serif"; g.textAlign = "center"; g.fillText(`CENA ${i + 1}`, 288, 520);
  return new Promise((r) => c.toBlob(r, "image/png"));
}

// Gera o JSON do vídeo com o provedor escolhido; valida e pede correção até 3 vezes.
export async function genSpec(roteiro, onStatus, signal) {
  if (!ready()) throw new Error("Escolha o provedor, o modelo e cole a chave em Integrações.");
  const msgs = [{ role: "user", content: SPEC_PROMPT + roteiro }]; let last = "";
  for (let i = 0; i < 3; i++) {
    onStatus?.(i ? `Corrigindo o JSON (tentativa ${i + 1} de 3)…` : "Gerando o JSON com a IA…");
    try { last = await chat(msgs, signal); } catch (e) { throw new Error(friendly(e)); }
    const p = parseSpecText(last), v = p.ok ? validateSpec(p.data) : null;
    if (p.ok && v.ok) return { text: JSON.stringify(p.data, null, 2), total: v.total, scenes: p.data.scenes.length };
    msgs.push({ role: "assistant", content: last }, { role: "user", content: p.ok ? `Corrija estes erros e responda SOMENTE com o JSON completo:\n- ${v.errors.join("\n- ")}` : `${p.error}. Responda SOMENTE com o JSON completo e válido.` });
  }
  const e = new Error("A IA não gerou um JSON válido em 3 tentativas."); e.last = last; throw e;
}
// Testa a conexão (lista os modelos do provedor; se não houver /models, faz uma chamada mínima).
export async function testarConexao({ base, key, model, nokey }) {
  if (!base) throw new Error("Informe o endereço da API.");
  if (!nokey && !key) throw new Error("Cole a chave primeiro.");
  const root = base.replace(/\/$/, ""), headers = { "Content-Type": "application/json", ...(key ? { Authorization: `Bearer ${key}` } : {}) };
  try { const j = await (await http(`${root}/models`, { headers }, 1, 20000)).json(); const ids = (j.data || j.models || []).map((m) => String(m.id || m.name || "").replace(/^models\//, "")).filter(Boolean); if (ids.length) return { modelos: ids }; } catch (e) { if (/HTTP 401|HTTP 403|Failed to fetch|NetworkError|Load failed/i.test(e.message)) throw new Error(friendly(e)); }
  try { await http(`${root}/chat/completions`, { method: "POST", headers, body: JSON.stringify({ model, messages: [{ role: "user", content: "Responda apenas: ok" }], max_tokens: 5 }) }, 1, 30000); return { modelos: [] }; } catch (e) { throw new Error(friendly(e)); }
}
function friendly(e) {
  const m = String(e.message || e);
  if (/HTTP 401|HTTP 403/.test(m)) return "A API recusou a chave (" + m + "). Confira a chave em Integrações.";
  if (/HTTP 404/.test(m)) return "Modelo ou endereço não encontrado (404). Use \"Testar conexão\" para ver os modelos disponíveis.";
  if (/HTTP 429/.test(m)) return "Limite de uso da API atingido (429). Espere um pouco ou troque de provedor.";
  if (/HTTP 402/.test(m)) return "O provedor pede crédito para esse modelo (402). Escolha outro modelo.";
  if (/Failed to fetch|NetworkError|Load failed/i.test(m)) return "Não consegui falar com a API: sem internet ou o provedor não aceita chamadas direto do navegador (CORS). Troque de provedor ou use o botão de copiar instruções com outra IA.";
  return m;
}
