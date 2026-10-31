import { parseSpecText, validateSpec, EXAMPLE_SPEC, SPEC_PROMPT, validateScript, safeFilename, localPlan, normalizeDurations, checkPlan, buildCues, buildSrt, validateSrt, CATALOG, CATALOG_ALL } from "./toonstory-lib.js";
import { planAI, genImage, demoImage, cfg, saveCfg, genSpec, testarConexao } from "./toonstory-ai.js";
import { PROVEDORES } from "./toonstory-provedores.js";
import { renderVideo, supportsRender } from "./toonstory-render.js";
import { paintScene } from "./toonstory-cena.js";

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
let wakeLock = null;
async function step(j, status, progress) { j.status = status; j.progress = progress; await saveJob(j); if (current === j.id) route(); }
function playDoneSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const now = ctx.currentTime;
    const beep = (freq, t0, dur, vol = 0.15) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = "sine"; o.frequency.value = freq;
      g.gain.setValueAtTime(vol, t0); g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
      o.connect(g); g.connect(ctx.destination); o.start(t0); o.stop(t0 + dur);
    };
    beep(880, now, 0.12); beep(1175, now + 0.14, 0.18);
    setTimeout(() => ctx.close?.(), 800);
  } catch {}
}
function askKeepScreenOn() {
  return new Promise((resolve) => {
    const saved = localStorage.getItem("ts.wake");
    if (saved === "1") return resolve(true);
    if (saved === "0") return resolve(false);
    const el = document.createElement("div");
    el.id = "wakeask";
    el.innerHTML = `<div class="card" role="dialog" aria-modal="true">
      <h2>Tela ligada</h2>
      <p>Deixar a tela ligada durante a criação do vídeo?</p>
      <p class="hint">Evita que o celular desligue a tela no meio da geração.</p>
      <div class="row" style="justify-content:center;margin-top:16px;gap:10px">
        <button id="wk-yes">Ativar</button>
        <button class="ghost" id="wk-no">Não</button>
      </div>
    </div>`;
    document.body.append(el);
    const done = (v) => { localStorage.setItem("ts.wake", v ? "1" : "0"); el.remove(); resolve(v); };
    $("#wk-yes", el).onclick = () => done(true);
    $("#wk-no", el).onclick = () => done(false);
  });
}
async function holdWake(on) {
  try { await wakeLock?.release?.(); } catch {}
  wakeLock = null;
  if (!on || !navigator.wakeLock?.request) return;
  try { wakeLock = await navigator.wakeLock.request("screen"); } catch {}
}
async function run(id) {
  if (running.has(id)) return; const ac = new AbortController(); running.set(id, ac);
  let j;
  try {
    j = await getJob(id); if (!j) throw new Error("Projeto não encontrado");
    const keep = await askKeepScreenOn();
    await holdWake(keep);
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
      if (j.params.json) continue;
      if (s.status === "completed" && await getBlob(`img:${id}:${s.idx}`)) continue;
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
    const bitmaps = j.params.json ? [] : await Promise.all(j.scenes.map(async (s) => createImageBitmap(await getBlob(`img:${id}:${s.idx}`))));
    const cues = j.params.subtitles ? buildCues(j.scenes) : null;
    const v = await renderVideo({ wake: keep, fast: !localStorage.getItem("ts.nofast"), painter: j.params.json ? (g, i, u, W, H) => paintScene(g, j.scenes[i].spec, i, u, W, H) : undefined, scenes: j.scenes, bitmaps, demo: j.scenes.map((s) => s.demo), W: j.params.W, H: j.params.H, cues, signal: ac.signal, onProgress: (p) => { const bar = $("#pbar"); if (bar) bar.style.width = `${75 + p * 24}%`; } });
    const cq = buildCues(j.scenes), chk = cq.length ? validateSrt(buildSrt(cq), j.params.targetSeconds * 1000) : { ok: true }; if (!chk.ok) throw new Error("SRT inválido: " + chk.errors[0]);
    await putBlob(`video:${id}`, v.blob); const back = await getBlob(`video:${id}`);
    if (!back || back.size !== v.blob.size) throw new Error("Falha ao salvar o vídeo (armazenamento do navegador cheio?)");
    j.video = { size: v.blob.size, type: v.type, ext: v.type.includes("mp4") ? "mp4" : "webm" }; j.error = null;
    await step(j, "completed", 100); playDoneSound(); toast("Vídeo pronto!", "ok"); notify("Seu vídeo foi gerado e já está pronto!", id);
  } catch (e) { if (j) { j.status = "failed"; j.error = e.message; await saveJob(j); } if (!gone.has(id)) { toast(e.message, "er"); if (e.message !== "Cancelado") notify("Não consegui terminar o vídeo: " + e.message, id); } if (current === id) route(); }
  finally { await holdWake(false); running.delete(id); if (current === id) route(); }
}
async function recover() { for (const j of await allJobs()) if (!["completed", "failed"].includes(j.status) && !running.has(j.id)) { j.status = "failed"; j.error = "Interrompido (a aba foi fechada). Clique em Retomar."; await saveJob(j); } }

// ---- download seguro ----
async function download(id, kind) {
  const j = await getJob(id); if (!j || j.status !== "completed") return toast("O vídeo ainda não terminou de renderizar.", "er");
  let blob, name;
  if (kind === "video") { blob = await getBlob(`video:${id}`); if (!blob || blob.size <= 0 || blob.size !== j.video?.size) return toast("Arquivo ausente ou corrompido neste navegador. Use Retomar para renderizar de novo (as imagens são reaproveitadas).", "er"); name = safeFilename(j.title, j.video.ext); }
  else if (kind === "srt") { const cq = buildCues(j.scenes); if (!cq.length) return toast("Sem narração neste projeto: não há SRT.", "er"); blob = new Blob([buildSrt(cq)], { type: "application/x-subrip;charset=utf-8" }); name = safeFilename(j.title, "srt"); }
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
<div class="card"><h2>Cenas (${j.scenes.length})</h2><div class="scenes">${j.scenes.map((s) => `<div class="sc">${imgs[s.idx] ? `<img src="${imgs[s.idx]}" alt="">` : j.params.json ? "" : `<img alt="">`}<div><b>${s.idx + 1}</b> ${s.status === "completed" ? "✓" : s.status === "failed" ? `✗ ${esc(s.error)}` : s.status === "generating" ? "…" : "·"} <span class="hint">${(s.durationMs / 1000).toFixed(1)}s${s.demo ? " · DEMO" : ""}</span><br>${esc(s.narration)}${s.status === "failed" ? `<br><button class="ghost" data-a="retry" data-i="${s.idx}">Tentar cena</button>` : ""}</div></div>`).join("")}</div></div>`;
}
function vJson() {
  return `<h1>Vídeo por JSON</h1><div class="card"><p class="hint">Cole o JSON (feito por uma IA ou à mão). O vídeo é desenhado no seu navegador, sem internet e sem chave. Estilo: animação 2D com personagens e cenários prontos.</p>
<label>Seu roteiro (a IA monta o JSON no formato do site)</label><textarea id="rot" style="min-height:110px" placeholder="Cole o roteiro e toque em Gerar JSON com IA"></textarea><button id="jai" style="margin:8px 0">Gerar JSON com IA</button><div class="hint">Usa o provedor escolhido em Integrações. Ou cole o JSON abaixo, feito por qualquer IA.</div>
<textarea id="js" class="mono" spellcheck="false" placeholder='{"version":1,"scenes":[...]}'></textarea><div id="jmsg" class="hint"></div>
<div class="row"><div><label>Resolução</label><select id="jres"><option value="540x960">540×960 (leve)</option><option value="720x1280" selected>720×1280 (recomendada)</option><option value="1080x1920">1080×1920 (pesada no celular)</option></select></div></div>
<label class="chk"><input type="checkbox" id="jsubs" checked> Legendas embutidas (usa o campo "narration"; o SRT sai separado)</label>
<div class="row" style="gap:8px"><button class="ghost" id="jex">Carregar exemplo</button><button class="ghost" id="jcp">Copiar prompt para IA</button><button class="ghost" id="jval">Validar</button><button class="ghost" id="jerrbtn" style="display:none"></button><button id="jgo" ${supportsRender() ? "" : "disabled"}>Gerar vídeo</button></div></div>`;
}
function vCatalog() {
  const cats = Object.keys(CATALOG);
  return `<h1>Catálogo</h1>
<div class="card"><p class="hint">Demonstração visual de tudo que o motor desenha. Clique num card para copiar o JSON e colar na cena.</p>
<input id="csearch" placeholder="Buscar (ex.: cat, tree, park…)" style="margin-bottom:10px">
<div class="row" style="gap:6px;flex-wrap:wrap;margin-bottom:12px" id="cfilters">
<button class="ghost on" data-cat="all">Todos (${CATALOG_ALL.length})</button>
${cats.map((c) => `<button class="ghost" data-cat="${c}">${c} (${CATALOG[c].length})</button>`).join("")}
</div>
<div id="cgrid"></div>
</div>`;
}
const MANUAL = `<details open><summary>1. Começo rápido</summary><ol><li>Abra <b>Ajuda → Instruções para a IA</b> e toque em <b>Copiar instruções</b>.</li><li>Cole na sua IA (ChatGPT, Gemini…) e escreva seu roteiro no final.</li><li>Copie o código que a IA devolver.</li><li>Em <b>{ } JSON</b>, cole, toque em <b>Validar</b> e depois em <b>Gerar vídeo</b>.</li><li>Quando terminar, baixe o MP4 e o SRT.</li></ol></details>
<details><summary>2. Como pedir à IA</summary><p>Exemplo: <code>[instruções copiadas] ROTEIRO: Um menino acorda atrasado e descobre que ganhou super velocidade…</code>. Peça sempre "somente o JSON". Se a IA mandar texto junto, copie só do primeiro <code>{</code> ao último <code>}</code>.</p></details>
<details><summary>3. O que cada campo faz</summary><ul><li><b>background</b>: park, street, night_city, forest, room, space, beach, science (fundo azul de explicação) ou duas cores <code>{"colors":["#112233","#334455"]}</code>.</li><li><b>characters</b>: type (hero, boy, girl, cat, robot), x e y de 0 a 1, emotion (happy, sad, surprised, neutral, angry), action (idle, walk, run, jump, wave, dance), skin (cor da pele, só no hero). Pisca sozinho e fala quando a cena tem narration.</li><li><b>props</b>: sun, moon, star, tree, house, cloud, heart, arrow, sign (com <code>"label":"75°C"</code>).</li><li><b>camera</b>: none, push_in, pull_out, pan_left, pan_right.</li><li><b>fx</b>: shake (tremor), speed (linhas de velocidade), particles, shockwave.</li><li><b>texts</b>: texto grande na cena, com anim fade, pop ou none.</li><li><b>narration</b>: vira legenda. Use <code>*palavra*</code> para destacar em amarelo.</li></ul></details>
<details><summary>4. Dicas de ritmo</summary><ul><li>Cenas de 1 a 3 segundos; troque de cenário ou de câmera a cada frase.</li><li>Legenda curta: 2 a 4 palavras por vez já é feita sozinha.</li><li>Use <b>science</b> com <b>particles</b> ou <b>shockwave</b> para explicar; use <b>shake</b> e <b>speed</b> em ação.</li></ul></details>
<details><summary>5. Problemas comuns</summary><ul><li><b>"JSON incompleto"</b>: a IA cortou a resposta. Toque em <b>Copiar pedido de continuação</b>, peça o resto e una as partes.</li><li><b>Erro com caminho</b> (ex.: <code>scenes[2].characters[0].type</code>): toque em <b>Copiar erro para a IA</b> e cole a versão corrigida.</li><li><b>Vídeo não baixa</b>: espere o status "Concluído". Se disser que o arquivo sumiu, use <b>Renderizar de novo</b>.</li><li><b>Travou no meio</b>: mantenha a aba aberta e a tela ligada; depois use <b>Retomar</b>.</li></ul></details>
<details><summary>6. Dublagem no ElevenLabs</summary><p>O vídeo sai sem áudio. Baixe o <b>roteiro</b> e o <b>SRT</b>, gere a voz e junte num editor. Uma voz nova pode ter outro ritmo e exigir ajuste dos tempos das cenas.</p></details>
<details><summary>7. Limites</summary><ul><li>Use Chrome ou Edge, no celular ou no PC.</li><li>Em Chrome/Edge a gravação é rápida (quadro a quadro); se o navegador não suportar, roda em tempo real (90 s de vídeo ≈ 90 s).</li><li>Os arquivos ficam neste navegador até você excluir.</li></ul></details>`;
function vAjuda(tab) {
  const man = tab === "manual";
  return `<h1>Ajuda</h1><div class="row" style="gap:8px;margin-bottom:12px"><a class="btn ${man ? "ghost" : ""}" href="#/ajuda">Instruções para a IA</a><a class="btn ${man ? "" : "ghost"}" href="#/ajuda/manual">Manual</a></div>` + (man ? MANUAL : `<div class="card"><p>Toque em <b>Copiar instruções</b>, leve para a sua IA e escreva o roteiro no final. Depois cole a resposta em <a href="#/json">{ } JSON</a>.</p><textarea id="ins" class="mono" readonly>${esc(SPEC_PROMPT)}</textarea><br><br><button id="cpins">Copiar instruções</button></div>`);
}
function vSettings() { return `<h1>Configurações</h1><div class="card"><p>Projetos e vídeos ficam guardados <b>neste navegador</b> (IndexedDB), sem prazo, até você excluir. Trocar de aparelho ou limpar os dados do navegador apaga tudo — baixe os arquivos que quiser guardar.</p><button class="danger" id="wipe">Apagar todos os projetos</button></div>`; }
function vInteg() {
  return `<h1>Integrações</h1><div class="card"><h2>IA que escreve o JSON</h2><p class="hint">Escolha um provedor gratuito. Cada pessoa cria a própria chave no link do provedor, e ela fica só neste navegador.</p>
<label>Provedor</label><select id="pv">${PROVEDORES.map((p) => `<option value="${p.id}">${esc(p.nome)}</option>`).join("")}</select><div id="pinfo" class="hint" style="margin-top:6px"></div>
<label id="plk">Chave</label><input id="pk" type="password" autocomplete="off"><div id="pbw"><label>Endereço da API (termina em /v1)</label><input id="pb" placeholder="https://.../v1"></div>
<label>Modelo</label><input id="pm" list="pml" autocomplete="off"><datalist id="pml"></datalist><div id="ptest" class="hint" style="white-space:pre-wrap;margin-top:8px"></div><br>
<div class="row" style="gap:8px"><button id="sv">Salvar</button><button class="ghost" id="tst">Testar conexão</button></div></div>
<div class="card"><h2>Imagens (modo roteiro com imagens)</h2><p>Pollinations, sem chave.</p></div>`;
}

// ---- router e eventos ----
let rt = 0, urls = [];
async function route() {
  if (!ready) return; const my = ++rt, bag = [];
  const [, r, arg] = (location.hash || "#/").match(/^#\/?([^/]*)\/?(.*)$/) || [];
  document.querySelectorAll("#nav a").forEach((a) => a.classList.toggle("on", a.dataset.r === (r || "")));
  if (r !== "job") current = null;
  const html = r === "ajuda" ? vAjuda(arg) : r === "json" ? vJson() : r === "catalog" ? vCatalog() : r === "new" ? vNew() : r === "projects" ? await vProjects() : r === "job" ? await vJob(arg, bag) : r === "settings" ? vSettings() : r === "integrations" ? vInteg() : await vDash();
  if (my !== rt || (r === "new" && $("#f"))) return bag.forEach(URL.revokeObjectURL); // render mais novo em andamento / não apagar o formulário
  urls.forEach(URL.revokeObjectURL); urls = bag;
  view.innerHTML = html; bind(r, arg);
}
function bind(r, id) {
  if (r === "new") {
    const ta = $("#script"), upd = () => ($("#cnt").textContent = `${ta.value.length} / 5000`); ta.oninput = upd; upd();
    $("#f").onsubmit = async (e) => { try { await submit(e); } catch (x) { toast("Erro ao criar projeto: " + x.message, "er"); const b = $("#go"); if (b) { b.disabled = false; b.textContent = "Gerar vídeo"; } } };
    const submit = async (e) => { askPerm();
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
  if (r === "ajuda" && $("#cpins")) $("#cpins").onclick = async () => { try { await navigator.clipboard.writeText(SPEC_PROMPT); } catch { $("#ins").select(); document.execCommand("copy"); } toast("Copiado! Leve isso para a sua IA e cole o roteiro no final.", "ok"); };
  if (r === "catalog") {
    let cat = "all", q = "";
    const preview = (item) => {
      const c = document.createElement("canvas"); c.width = 160; c.height = 160; const g = c.getContext("2d");
      g.fillStyle = "#12121a"; g.fillRect(0, 0, 160, 160);
      try {
        if (item.cat === "characters") paintScene(g, { durationSec: 1, background: "park", characters: [{ ...item.sample, x: 0.5, y: 0.88, scale: 1.4 }], props: [], texts: [], fx: [] }, 0, 0.25, 160, 160);
        else if (item.cat === "props") paintScene(g, { durationSec: 1, background: { colors: ["#1e1e2a", "#2a2a3a"] }, characters: [], props: [{ ...item.sample, x: 0.5, y: 0.5, scale: 2 }], texts: [], fx: [] }, 0, 0, 160, 160);
        else if (item.cat === "backgrounds") paintScene(g, { durationSec: 1, background: item.sample, characters: [], props: [], texts: [], fx: [] }, 0, 0, 160, 160);
        else if (item.cat === "effects") paintScene(g, { durationSec: 2, background: "space", characters: [], props: [], texts: [], fx: [item.sample] }, 0, 0.45, 160, 160);
        else if (item.cat === "actions") paintScene(g, { durationSec: 1, background: "park", characters: [{ type: "hero", x: 0.5, y: 0.88, scale: 1.3, action: item.sample, emotion: "happy", dx: 0.2 }], props: [], texts: [], fx: [] }, 0, 0.4, 160, 160);
        else if (item.cat === "emotions") paintScene(g, { durationSec: 1, background: "park", characters: [{ type: "hero", x: 0.5, y: 0.88, scale: 1.3, action: "idle", emotion: item.sample }], props: [], texts: [], fx: [] }, 0, 0.2, 160, 160);
        else { g.fillStyle = "#a78bfa"; g.font = "bold 16px sans-serif"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(item.label, 80, 80); }
      } catch { g.fillStyle = "#666"; g.font = "13px sans-serif"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(item.label, 80, 80); }
      return c.toDataURL("image/png");
    };
    const render = () => {
      const list = (cat === "all" ? CATALOG_ALL : CATALOG[cat] || []).filter((it) => !q || it.id.includes(q) || it.label.includes(q) || it.cat.includes(q));
      const grid = $("#cgrid"); if (!grid) return;
      grid.innerHTML = list.map((it) => `<div class="card cat-card" data-json="${esc(JSON.stringify(it.sample))}" title="Clique para copiar o JSON">
        <img src="${preview(it)}" alt="${esc(it.label)}" loading="lazy">
        <div class="name">${esc(it.label)}</div>
        <div class="meta">${esc(it.cat)}</div>
      </div>`).join("") || `<p class="hint">Nenhum item encontrado.</p>`;
      grid.querySelectorAll(".cat-card").forEach((el) => {
        el.onclick = async () => { try { await navigator.clipboard.writeText(el.dataset.json); toast("JSON copiado!", "ok"); } catch { toast("Não foi possível copiar.", "er"); } };
      });
    };
    $("#csearch").oninput = (e) => { q = e.target.value.trim().toLowerCase(); render(); };
    $("#cfilters").onclick = (e) => {
      const b = e.target.closest("button[data-cat]"); if (!b) return;
      cat = b.dataset.cat;
      $("#cfilters").querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b));
      render();
    };
    render();
  }
  if (r === "json") {
    const msg = (t, ok) => { const m = $("#jmsg"); m.style.whiteSpace = "pre-wrap"; m.style.color = ok ? "var(--ok)" : "var(--er)"; m.textContent = t; };
    let fix = ""; const eb = $("#jerrbtn");
    const check = () => {
      const txt = $("#js").value, p = parseSpecText(txt); eb.style.display = "none";
      if (!p.ok) { fix = p.truncated ? "Sua resposta foi cortada no meio. Continue EXATAMENTE de onde parou, sem repetir nada, até fechar o JSON." : `Corrija este JSON do ToonStory. Erro: ${p.error}. Responda SOMENTE com o JSON completo e corrigido.\n\n${txt}`; eb.style.display = ""; eb.textContent = p.truncated ? "Copiar pedido de continuação" : "Copiar erro para a IA"; msg(p.error); return null; }
      const v = validateSpec(p.data); if (!v.ok) { fix = `Corrija este JSON do ToonStory. Erros:\n- ${v.errors.join("\n- ")}\nResponda SOMENTE com o JSON completo e corrigido.\n\n${txt}`; eb.style.display = ""; eb.textContent = "Copiar erro para a IA"; msg("Corrija antes de gerar:\n• " + v.errors.join("\n• ")); return null; }
      msg(`✓ JSON válido: ${p.data.scenes.length} cenas, ${v.total}s.`, true); return { d: p.data, total: v.total };
    };
    eb.onclick = async () => { try { await navigator.clipboard.writeText(fix); toast("Copiado. Cole na IA e traga a resposta de volta.", "ok"); } catch { toast("Não consegui copiar automaticamente.", "er"); } };
    $("#jex").onclick = () => { $("#js").value = JSON.stringify(EXAMPLE_SPEC, null, 2); msg(""); };
    $("#jval").onclick = check;
    $("#jai").onclick = async () => { const b = $("#jai"), rot = $("#rot").value.trim(); if (rot.length < 40) return toast("Escreva o roteiro (mínimo 40 caracteres).", "er"); if (b.disabled) return; b.disabled = true;
      try { const r = await genSpec(rot, (t) => { b.textContent = t; }); $("#js").value = r.text; msg(`✓ IA gerou e o site validou: ${r.scenes} cenas, ${r.total}s. Confira e toque em Gerar vídeo.`, true); }
      catch (e) { if (e.last) $("#js").value = e.last; msg(e.message); } finally { b.disabled = false; b.textContent = "Gerar JSON com IA"; } };
    $("#jcp").onclick = async () => { try { await navigator.clipboard.writeText(SPEC_PROMPT); toast("Prompt copiado. Cole na IA e acrescente o seu roteiro no final.", "ok"); } catch { $("#js").value = SPEC_PROMPT; toast("Não deu para copiar; o prompt foi colocado no campo (selecione e copie).", "er"); } };
    $("#jgo").onclick = async () => { askPerm();
      const c = check(), btn = $("#jgo"); if (!c || btn.disabled) return; btn.disabled = true; btn.textContent = "Criando…";
      try {
        const [W, H] = $("#jres").value.split("x").map(Number), subs = $("#jsubs").checked, key = JSON.stringify(["json", $("#js").value.trim(), W, H, subs]);
        const recent = (await allJobs()).find((j) => j.key === key && Date.now() - j.createdAt < 120000 && j.status !== "failed");
        if (recent) { toast("Já existe um projeto igual criado agora; abrindo."); return (location.hash = `#/job/${recent.id}`); }
        let cur = 0; const scenes = c.d.scenes.map((s, i) => { const durationMs = Math.round(s.durationSec * 1000), o = { idx: i, startMs: cur, durationMs, narration: s.narration || "", visualPrompt: "", action: "", spec: s, status: "completed", attempts: 0, demo: false, error: null }; cur += durationMs; return o; });
        const j = { id: crypto.randomUUID(), key, title: (c.d.title || "Vídeo JSON").trim().slice(0, 80), script: scenes.map((s) => s.narration).filter(Boolean).join("\n\n") || "(sem narração)", params: { json: true, targetSeconds: Math.ceil(cur / 1000), W, H, subtitles: subs, demo: false, characterDescription: "", style: "" }, planSource: "json", seed: 0, status: "queued", progress: 0, scenes, createdAt: Date.now() };
        await saveJob(j); run(j.id); location.hash = `#/job/${j.id}`;
      } catch (x) { toast("Erro ao criar projeto: " + x.message, "er"); btn.disabled = false; btn.textContent = "Gerar vídeo"; }
    };
  }
  if (r === "integrations") {
    const c = cfg(), st = { prov: c.prov, keys: { ...c.keys }, models: { ...c.models }, base: c.base }; let live = [];
    const cur = () => PROVEDORES.find((p) => p.id === st.prov) || PROVEDORES[0], put = (k, v) => $(k).setAttribute("value", v);
    const fill = () => { const p = cur(); $("#pv").value = p.id; $("#pinfo").innerHTML = `${p.chave ? `<a href="${p.chave}" target="_blank" rel="noopener">Obter chave grátis ↗</a> · ` : ""}${esc(p.nota)}`; $("#plk").textContent = p.nokey ? "Chave (opcional)" : "Chave"; $("#pk").value = st.keys[p.id] || ""; $("#pbw").style.display = p.id === "outro" ? "" : "none"; $("#pb").value = st.base || ""; $("#pm").value = st.models[p.id] || p.padrao; $("#pml").innerHTML = [...new Set([...p.modelos, ...live])].map((m) => `<option value="${esc(m)}">`).join(""); $("#ptest").textContent = ""; };
    $("#pv").onchange = () => { st.prov = $("#pv").value; live = []; fill(); };
    $("#pk").oninput = () => (st.keys[st.prov] = $("#pk").value.trim()); $("#pb").oninput = () => (st.base = $("#pb").value.trim()); $("#pm").oninput = () => (st.models[st.prov] = $("#pm").value.trim());
    $("#sv").onclick = () => { saveCfg(st); toast("Salvo.", "ok"); };
    $("#tst").onclick = async () => { const p = cur(), b = $("#tst"), out = $("#ptest"); b.disabled = true; out.style.color = ""; out.textContent = "Testando…";
      try { const r = await testarConexao({ base: p.id === "outro" ? st.base : p.base, key: st.keys[p.id], model: st.models[p.id] || p.padrao, nokey: p.nokey }); live = r.modelos; $("#pml").innerHTML = [...new Set([...p.modelos, ...live])].map((m) => `<option value="${esc(m)}">`).join(""); out.style.color = "var(--ok)"; out.textContent = r.modelos.length ? `✓ Conectou. ${r.modelos.length} modelos disponíveis (toque no campo Modelo para ver).` : "✓ Conectou."; }
      catch (e) { out.style.color = "var(--er)"; out.textContent = e.message; } finally { b.disabled = false; } };
    fill();
  }
  if (r === "settings") $("#wipe").onclick = async () => { if (confirm("Apagar tudo?")) { for (const j of await allJobs()) await delJob(j.id); toast("Tudo apagado.", "ok"); } };
}
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && running.size && localStorage.getItem("ts.wake") === "1") holdWake(true); }); // o navegador solta a tela ligada ao ocultar a aba
// ---- avisos: notificação quando o vídeo terminar (a aba precisa continuar aberta; não há servidor) ----
const canNotify = () => "Notification" in window && "serviceWorker" in navigator;
if ("serviceWorker" in navigator) navigator.serviceWorker.register("./toonstory-sw.js").catch(() => {});
async function notify(body, id) {
  if (!canNotify() || Notification.permission !== "granted" || (document.visibilityState === "visible" && document.hasFocus())) return; // já está olhando: basta o aviso na tela
  try { const reg = await navigator.serviceWorker.ready; await reg.showNotification("ToonStory", { body, tag: "ts-" + id, data: { url: location.href.split("#")[0] + "#/job/" + id } }); } catch {}
}
const askPerm = () => { if (canNotify() && Notification.permission === "default" && !localStorage.getItem("ts.nonotif")) Notification.requestPermission().catch(() => {}); };
function askBar() {
  if (!canNotify() || Notification.permission !== "default" || localStorage.getItem("ts.nonotif") || $("#nbar")) return;
  const b = Object.assign(document.createElement("div"), { id: "nbar", className: "card" });
  b.innerHTML = `<b>Avisar quando o vídeo ficar pronto?</b><p class="hint">Mostramos uma notificação quando terminar. A aba do site precisa continuar aberta (pode ficar em segundo plano).</p><div class="row" style="gap:8px"><button id="nyes">Ativar avisos</button><button class="ghost" id="nno">Agora não</button></div>`;
  document.body.append(b);
  $("#nyes").onclick = async () => { try { await Notification.requestPermission(); } catch {} b.remove(); const ok = Notification.permission === "granted"; toast(ok ? "Avisos ativados." : "Avisos não ativados.", ok ? "ok" : ""); };
  $("#nno").onclick = () => { localStorage.setItem("ts.nonotif", "1"); b.remove(); };
}
window.addEventListener("hashchange", route);
window.addEventListener("beforeunload", (e) => { if (running.size) { e.preventDefault(); e.returnValue = ""; } });
function showOnboard() {
  if (localStorage.getItem("ts.onboarded")) return;
  const el = document.createElement("div");
  el.id = "onboard";
  el.innerHTML = `<div class="card" role="dialog" aria-modal="true" aria-labelledby="ob-title">
    <h2 id="ob-title">Bem-vindo ao ToonStory</h2>
    <p>Deseja aprender como utilizar?</p>
    <div class="row">
      <button id="ob-yes">Sim</button>
      <button class="ghost" id="ob-no">Não</button>
    </div>
  </div>`;
  document.body.append(el);
  const done = (go) => { localStorage.setItem("ts.onboarded", "1"); el.remove(); if (go) location.hash = "#/ajuda/manual"; askBar(); };
  $("#ob-yes", el).onclick = () => done(true);
  $("#ob-no", el).onclick = () => done(false);
}
try { await dbp; await recover(); ready = true; } catch (e) { view.innerHTML = `<div class="card warn">Armazenamento do navegador indisponível (${esc(e.message || e)}). Saia da aba anônima ou libere o armazenamento do site.</div>`; }
route();
showOnboard(); if (localStorage.getItem("ts.onboarded")) askBar();

