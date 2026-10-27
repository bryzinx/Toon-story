// Integrações. Chaves ficam só no localStorage do navegador e vão apenas ao provedor.
// FILL: modelos mudam; ajuste em Integrações se um deles for descontinuado.
import { checkPlan } from "./toonstory-lib.js";
const rd = () => { try { return JSON.parse(localStorage.getItem("ts.cfg") || "{}"); } catch { return {}; } };
export const cfg = () => ({ gemini: "", groq: "", geminiModel: "gemini-2.5-flash", groqModel: "llama-3.3-70b-versatile", ...rd() });
export const saveCfg = (c) => localStorage.setItem("ts.cfg", JSON.stringify(c));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
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
const parse = (t) => JSON.parse(t.replace(/^```(?:json)?|```$/g, "").trim());
export async function planAI(script, p) {
  const c = cfg();
  if (c.gemini) {
    const r = await http(`https://generativelanguage.googleapis.com/v1beta/models/${c.geminiModel}:generateContent`, { method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": c.gemini }, body: JSON.stringify({ systemInstruction: { parts: [{ text: sys(p.targetSeconds, p.characterDescription, p.style) }] }, contents: [{ parts: [{ text: script }] }], generationConfig: { responseMimeType: "application/json" } }) });
    return { source: "gemini", scenes: checkPlan(parse((await r.json()).candidates[0].content.parts[0].text)) };
  }
  if (c.groq) {
    const r = await http("https://api.groq.com/openai/v1/chat/completions", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${c.groq}` }, body: JSON.stringify({ model: c.groqModel, response_format: { type: "json_object" }, messages: [{ role: "system", content: sys(p.targetSeconds, p.characterDescription, p.style) }, { role: "user", content: script }] }) });
    return { source: "groq", scenes: checkPlan(parse((await r.json()).choices[0].message.content)) };
  }
  return null;
}
// Imagem: serviço gratuito sem chave. Seed fixa por projeto + ficha do personagem no prompt = consistência parcial.
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
