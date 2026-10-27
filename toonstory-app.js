import { validateScript, safeFilename, localPlan, normalizeDurations, checkPlan, buildCues, buildSrt, validateSrt } from "./toonstory-lib.js";
import { planAI, genImage, demoImage, cfg, saveCfg } from "./toonstory-ai.js";
import { renderVideo, supportsRender } from "./toonstory-render.js";

const $ = (s, r = document) => r.querySelector(s), view = $("#view");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const LBL = { queued: "Na fila", planning: "Planejando", generating: "Gerando cenas", rendering: "Renderizando", completed: "Concluído", failed: "Falhou" };
function toast(msg, kind = "") { const t = Object.assign(document.createElement("div"), { className: `toast ${kind}`, textContent: msg }); $("#toasts").append(t); setTimeout(() => t.remove(), 5000); }

// ---- armazenamento (IndexedDB): projetos e arquivos ficam no navegador ----
const dbp = new Promise((res, rej) => { const q = indexedDB.open("toonstory", 1); q.onupgradeneeded = () => { q.result.createObjectStore("jobs", { keyPath: "id" }); q.result.createObjectStore("blobs"); }; q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
const tx = async (st, mode, fn) => { const d = await dbp; return new Promise((res, rej) => { const r = fn(d.transaction(st, mode).objectStore(st)); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); };
const gone = new Set(); // ids excluídos: impede o pipeline de recriar o projeto
const saveJob = (j) => gone.has(j.id) ? Promise.resolve() : (j.updatedAt = Date.now(), tx("jobs", "readwrite", (s) => s.put(j)));
const getJob = (id) => tx("jobs", "readonly", (s) => s.get(id));
const allJobs = async () => (await tx("jobs", "readonly", (s) => s.getAll())).sort((a, b) => b.createdAt - a.createdAt);
const putBlob = (k, b) => tx("blobs", "readwrite", (s) => s.put(b, k));
const getBlob = (k) => tx("blobs", "readonly", (s) => s.get(k));
async function delJob(id) { gone.add(id); const j = await getJob(id); for (const s of j?.scenes || []) await tx("blobs", "readwrite", (x) => x.delete(`img:${id}:${s.idx}`)); await tx("blobs", "readwrite", (x) => x.delete(`video:${id}`)); await tx("jobs", "readwrite", (x) => x.delete(id)); }

// ---- pipeline: queued → planning → generating → rendering → completed | failed ----
const running = new Map(); let ready = false;
let current = null;
async function step(j, status, progress) { j.status = status; j.progress = progress; await saveJob(j); if (current === j.id) route(); }
async function run(id) {
  if (running.has(id)) return; const ac = new AbortController(); running.set(id, ac);
  let j;
  try {
    j = await getJob(id); if (!j) throw new Error("Projeto não encontrado");
    if (!j.scenes.length) {
      await step(j, "planning", 5);
      let p = null; try { p = await planAI(j.script, j.params); } catch (e) { toast(`IA de planejamento falhou (${e.message}); usando regras locais.`, "er"); }
      const plan = p?.scenes || checkPlan({ scenes: localPlan(j.script, j.params.targetSeconds, j.params.characterDescription, j.params.style) });
      j.planSource = p?.source || "local";
      j.scenes = normalizeDurations(plan, j.params.targetSeconds).map((s) => ({ ...s, status: "pending", attempts: 0, demo: false, error: null }));
      const sum = j.scenes.reduce((a, s) => a + s.durationMs, 0); if (sum !== j.params.targetSeconds * 1000) throw new Error("Soma das durações inválida");
    }
    await step(j, "generating", 10);
    for (const s of j.scenes) {
      if (s.status === "completed" && await getBlob(`img:${id}:${s.idx}`)) continue; // retomada: só o que falta
      s.status = "pending"; let ok = false;
      while (s.attempts < 3 && !ok) {
        if (ac.signal.aborted) throw new Error("Cancelado");
        s.attempts++; s.status = "generating"; await saveJob(j); if (current === id) route();
        try {
          const demo = j.params.demo, blob = demo ? await demoImage(s.idx) : await genImage(`${s.visualPrompt}. ${s.action}. Character: ${j.params.characterDescription.slice(0, 250)}. Style: ${j.params.style.slice(0, 120)}`, j.seed, ac.signal);
          await putBlob(`img:${id}:${s.idx}`, blob); s.demo = demo; s.status = "completed"; s.error = null; ok = true;
        } catch (e) { s.error = e.message; s.status = "failed"; await sleep(1500 * s.attempts); }
      }
      j.progress = 10 + Math.round((60 * j.scenes.filter((x) => x.status === "completed").length) / j.scenes.length); await saveJob(j); if (current === id) route();
      if (!ok) throw new Error(`Cena ${s.idx + 1} falhou: ${s.error}. Clique em "Retomar" para tentar só as pendentes.`);
    }
    await step(j, "rendering", 75);
    const bitmaps = await Promise.all(j.scenes.map(async (s) => createImageBitmap(await getBlob(`img:${id}:${s.idx}`))));
    const cues = j.params.subtitles ? buildCues(j.scenes) : null;
    const v = await renderVideo({ scenes: j.scenes, bitmaps, demo: j.scenes.map((s) => s.demo), W: j.params.W, H: j.params.H, cues, signal: ac.signal, onProgress: (p) => { const bar = $("#pbar"); if (bar) bar.style.width = `${75 + p * 24}%`; } });
    const srt = buildSrt(buildCues(j.scenes)), chk = validateSrt(srt, j.params.targetSeconds * 1000); if (!chk.ok) throw new Error("SRT inválido: " + chk.errors[0]);
    await putBlob(`video:${id}`, v.blob); const back = await getBlob(`video:${id}`);
    if (!back || back.size !== v.blob.size) throw new Error("Falha ao salvar o vídeo (armazenamento do navegador cheio?)");
    j.video = { size: v.blob.size, type: v.type, ext: v.type.includes("mp4") ? "mp4" : "webm" }; j.error = null;
    await step(j, "completed", 100); toast("Vídeo pronto!", "ok");
  } catch (e) { if (j) { j.status = "failed"; j.error = e.message; await saveJob(j); } if (!gone.has(id)) toast(e.message, "er"); if (current === id) route(); }
  finally { running.delete(id); if (current === id) route(); }
}
async function recover() { for (const j of await allJobs()) if (!["completed", "failed"].includes(j.status) && !running.has(j.id)) { j.status = "failed"; j.error = "Interrompido (a aba foi fechada). Clique em Retomar."; await saveJob(j); } }

// ---- download seguro ----
async function download(id, kind) {
  const j = await getJob(id); if (!j || j.status !== "completed") return toast("O vídeo ainda não terminou de renderizar.", "er");
  let blob, name;
  if (kind === "video") { blob = await getBlob(`video:${id}`); if (!blob || blob.size <= 0 || blob.size !== j.video?.size) return toast("Arquivo ausente ou corrompido neste navegador. Use Retomar para renderizar de novo (as imagens são reaproveitadas).", "er"); name = safeFilename(j.title, j.video.ext); }
  else if (kind === "srt") { blob = new Blob([buildSrt(buildCues(j.scenes))], { type: "application/x-subrip;charset=utf-8" }); name = safeFilename(j.title, "srt"); }
  else { blob = new Blob([j.script], { type: "text/plain;charset=utf-8" }); name = safeFilename(j.title, "txt"); }
  const url = URL.createObjectURL(blob), a = Object.assign(document.createElement("a"), { href: url, download: name }); document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 120000);
}

// ---- views ----
const badge = (s) => `<span class="badge ${s}">${LBL[s]}</span>`;
async function vDash() { const js = await allJobs(), n = (s) => js.filter((j) => j.status === s).length; return `<h1>Dashboard</h1><div class="grid"><div class="card stat"><b>${js.length}</b>Projetos</div><div class="card stat"><b>${n("completed")}</b>Concluídos</div><div class="card stat"><b>${js.filter((j) => !["completed", "failed"].includes(j.status)).length}</b>Em andamento</div><div class="card stat"><b>${n("failed")}</b>Falhas</div></div><div class="card"><h2>Recentes</h2>${list(js.slice(0, 5))}<a class="btn" href="#/new">Criar novo vídeo</a></div>`; }
const list = (js) => js.length ? `<div class="list">${js.map((j) => `<a href="#/job/${j.id}"><span>${esc(j.title)}</span>${badge(j.status)}</a>`).join("")}</div>` : `<p class="hint">Nenhum projeto ainda.</p>`;
async function vProjects() { const js = await allJobs(); return `<h1>Projetos</h1><div class="card">${list(js)}</div>`; }
function vNew() {
  const c = cfg(), src = c.gemini ? "Gemini" : c.groq ? "Groq" : "regras locais (sem IA)";
  return `<h1>Novo vídeo</h1>${supportsRender() ? "" : `<div class="card warn">Este navegador não grava vídeo. Use Chrome ou Edge.</div>`}
<form id="f" class="card"><label>Título (opcional)</label><input name="title" maxlength="80">
<label>Roteiro <span class="cnt hint" id="cnt">0 / 5000</span></label><textarea name="script" id="script" maxlength="5000" placeholder="Cole aqui o roteiro de ~90 segundos (cerca de 200 a 250 palavras)"></textarea>
<div class="row"><div><label>Nome do personagem</label><input name="cn" maxlength="60" required></div><div><label>Estilo visual</label><input name="style" value="stylized 3D animation, Pixar-like, soft lighting" maxlength="200" required></div></div>
<label>Descrição do personagem (mesma em todas as cenas)</label><textarea name="cd" style="min-height:80px" maxlength="600" required placeholder="Ex.: gato laranja de olhos verdes, jaqueta azul e mochila vermelha"></textarea>
<div class="row"><div><label>Duração</label><select name="dur"><option value="90" selected>90 segundos</option><option value="60">60 segundos</option><option value="45">45 segundos</option></select></div><div><label>Proporção</label><select disabled><option>9:16 (vertical)</option></select></div><div><label>Resolução</label><select name="res"><option value="540x960">540×960 (leve)</option><option value="720x1280" selected>720×1280 (recomendada)</option><option value="1080x1920">1080×1920 (pesada no celular)</option></select></div></div>
<label class="chk"><input type="checkbox" name="subs" checked> Legendas embutidas no vídeo (o SRT sai sempre, separado)</label>
<label class="chk"><input type="checkbox" disabled> Efeitos sonoros (indisponível nesta versão — o vídeo sai sem áudio)</label>
<label class="chk"><input type="checkbox" name="demo"> Modo demonstração (sem IA de imagem, marcado "DEMO")</label>
<p class="hint">Planejamento: ${src}. Imagens: serviço gratuito Pollinations. Mantenha a aba aberta e a tela ligada durante a geração.</p>
<button id="go" ${supportsRender() ? "" : "disabled"}>Gerar vídeo</button></form>`;
}
async function vJob(id, bag) {
  current = id; const j = await getJob(id); if (!j) return `<h1>Projeto não encontrado</h1>`;
  const live = running.has(id), done = j.status === "completed", vb = done ? await getBlob(`video:${id}`) : null, okv = vb && vb.size > 0 && vb.size === j.video?.size;
  const mk = (b) => { const u = URL.createObjectURL(b); bag.push(u); return u; }, imgs = {};
  for (const s of j.scenes) { const b = await getBlob(`img:${id}:${s.idx}`); if (b) imgs[s.idx] = mk(b); }
  const vurl = okv ? mk(vb) : "";
  return `<h1>${esc(j.title)}</h1><div class="card"><div>${badge(j.status)} <span class="hint">${j.progress}% · planejamento: ${esc(j.planSource || "—")}</span></div><div class="bar"><i id="pbar" style="width:${j.progress}%"></i></div>
${j.error ? `<p style="color:var(--er)">${esc(j.error)}</p>` : ""}
<div class="row" style="gap:8px">${done && okv ? `<button data-a="dl-video">Baixar ${j.video.ext.toUpperCase()}</button>` : ""}${done ? `<button class="ghost" data-a="dl-srt">Baixar SRT</button><button class="ghost" data-a="dl-txt">Roteiro .txt</button>` : ""}${!live && j.status !== "completed" ? `<button data-a="resume">Retomar</button>` : ""}${!live && done ? `<button class="ghost" data-a="rerender">Renderizar de novo</button>` : ""}${live ? `<button class="danger" data-a="cancel">Cancelar</button>` : ""}<button class="ghost danger" data-a="del">Excluir</button></div>
${done && !okv ? `<p class="warn card">O arquivo não está mais neste navegador. Clique em "Renderizar de novo" (reaproveita as imagens).</p>` : ""}
${done ? `${okv ? `<video id="pv" controls playsinline src="${vurl}"></video>` : ""}<p class="hint">${(j.video.size / 1048576).toFixed(1)} MB · ${j.params.W}×${j.params.H} · sem áudio. Para a dublagem no ElevenLabs, use o roteiro e o SRT; uma nova voz pode exigir ajuste de tempos. Os arquivos ficam neste navegador até você excluir.</p>` : ""}</div>
<div class="card"><h2>Cenas (${j.scenes.length})</h2><div class="scenes">${j.scenes.map((s) => `<div class="sc">${imgs[s.idx] ? `<img src="${imgs[s.idx]}" alt="">` : `<img alt="">`}<div><b>${s.idx + 1}</b> ${s.status === "completed" ? "✓" : s.status === "failed" ? `✗ ${esc(s.error)}` : s.status === "generating" ? "…" : "·"} <span class="hint">${(s.durationMs / 1000).toFixed(1)}s${s.demo ? " · DEMO" : ""}</span><br>${esc(s.narration)}${s.status === "failed" ? `<br><button class="ghost" data-a="retry" data-i="${s.idx}">Tentar cena</button>` : ""}</div></div>`).join("")}</div></div>`;
}
function vSettings() { return `<h1>Configurações</h1><div class="card"><p>Projetos e vídeos ficam guardados <b>neste navegador</b> (IndexedDB), sem prazo, até você excluir. Trocar de aparelho ou limpar os dados do navegador apaga tudo — baixe os arquivos que quiser guardar.</p><button class="danger" id="wipe">Apagar todos os projetos</button></div>`; }
function vInteg() {
  const c = cfg(); return `<h1>Integrações</h1><div class="card"><h2>Planejamento de cenas</h2><p class="hint">Chaves grátis. Ficam só neste navegador e vão direto ao provedor. Sem chave, o app usa regras locais.</p>
<label>Gemini — chave (aistudio.google.com/apikey)</label><input id="kg" type="password" value="${esc(c.gemini)}" autocomplete="off"><label>Modelo Gemini</label><input id="mg" value="${esc(c.geminiModel)}">
<label>Groq — chave (console.groq.com/keys)</label><input id="kq" type="password" value="${esc(c.groq)}" autocomplete="off"><label>Modelo Groq</label><input id="mq" value="${esc(c.groqModel)}"><br><br><button id="sv">Salvar</button></div>
<div class="card"><h2>Imagens</h2><p>Pollinations (sem chave). Animação real de vídeo por IA não está integrada: o movimento é de câmera sobre imagens.</p></div>`;
}

// ---- router e eventos ----
let rt = 0, urls = [];
async function route() {
  if (!ready) return; const my = ++rt, bag = [];
  const [, r, arg] = (location.hash || "#/").match(/^#\/?([^/]*)\/?(.*)$/) || [];
  document.querySelectorAll("#nav a").forEach((a) => a.classList.toggle("on", a.dataset.r === (r || "")));
  if (r !== "job") current = null;
  const html = r === "new" ? vNew() : r === "projects" ? await vProjects() : r === "job" ? await vJob(arg, bag) : r === "settings" ? vSettings() : r === "integrations" ? vInteg() : await vDash();
  if (my !== rt || (r === "new" && $("#f"))) return bag.forEach(URL.revokeObjectURL); // render mais novo em andamento / não apagar o formulário
  urls.forEach(URL.revokeObjectURL); urls = bag;
  view.innerHTML = html; bind(r, arg);
}
function bind(r, id) {
  if (r === "new") {
    const ta = $("#script"), upd = () => ($("#cnt").textContent = `${ta.value.length} / 5000`); ta.oninput = upd; upd();
    $("#f").onsubmit = async (e) => { try { await submit(e); } catch (x) { toast("Erro ao criar projeto: " + x.message, "er"); const b = $("#go"); if (b) { b.disabled = false; b.textContent = "Gerar vídeo"; } } };
    const submit = async (e) => {
      e.preventDefault(); const f = new FormData(e.target), v = validateScript(f.get("script")), btn = $("#go");
      if (!v.ok) return toast(v.error, "er"); if (btn.disabled) return;
      const [W, H] = f.get("res").split("x").map(Number), params = { targetSeconds: +f.get("dur"), W, H, subtitles: f.get("subs") === "on", demo: f.get("demo") === "on", characterDescription: `${f.get("cn")}, ${f.get("cd")}`.slice(0, 700), style: f.get("style") };
      const key = JSON.stringify([v.text, params]), recent = (await allJobs()).find((j) => j.key === key && Date.now() - j.createdAt < 120000 && j.status !== "failed");
      btn.disabled = true; btn.textContent = "Criando…";
      if (recent) { toast("Já existe um projeto igual criado agora; abrindo."); return (location.hash = `#/job/${recent.id}`); }
      const j = { id: crypto.randomUUID(), key, title: (f.get("title") || v.text.slice(0, 40)).trim(), script: v.text, params, seed: Math.floor(Math.random() * 1e6), status: "queued", progress: 0, scenes: [], createdAt: Date.now() };
      await saveJob(j); run(j.id); location.hash = `#/job/${j.id}`;
    };
  }
  if (r === "job") view.onclick = async (e) => {
    const b = e.target.closest("button[data-a]"); if (!b) return; const a = b.dataset.a, j = await getJob(id);
    if (a.startsWith("dl-")) return download(id, a.slice(3));
    if (a === "resume") { j.error = null; j.scenes.forEach((s) => s.status === "failed" && (s.attempts = 0)); await saveJob(j); run(id); route(); }
    if (a === "retry") { const s = j.scenes[+b.dataset.i]; s.attempts = 0; s.status = "pending"; await saveJob(j); run(id); }
    if (a === "rerender") { j.status = "queued"; await saveJob(j); run(id); route(); }
    if (a === "cancel") running.get(id)?.abort();
    if (a === "del" && confirm("Excluir este projeto?")) { running.get(id)?.abort(); await delJob(id); location.hash = "#/projects"; }
  };
  if (r === "integrations") $("#sv").onclick = () => { saveCfg({ gemini: $("#kg").value.trim(), geminiModel: $("#mg").value.trim(), groq: $("#kq").value.trim(), groqModel: $("#mq").value.trim() }); toast("Salvo.", "ok"); };
  if (r === "settings") $("#wipe").onclick = async () => { if (confirm("Apagar tudo?")) { for (const j of await allJobs()) await delJob(j.id); toast("Tudo apagado.", "ok"); } };
}
window.addEventListener("hashchange", route);
window.addEventListener("beforeunload", (e) => { if (running.size) { e.preventDefault(); e.returnValue = ""; } });
try { await dbp; await recover(); ready = true; } catch (e) { view.innerHTML = `<div class="card warn">Armazenamento do navegador indisponível (${esc(e.message || e)}). Saia da aba anônima ou libere o armazenamento do site.</div>`; }
route();
