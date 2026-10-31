import test from "node:test"; import assert from "node:assert/strict";
import * as L from "./toonstory-lib.js";
test("roteiro inválido", () => { for (const x of ["", "   ", "curto", null, "1234 5678 ".repeat(10), "palavra ".repeat(1000)]) assert.equal(L.validateScript(x).ok, false); });
test("roteiro válido", () => assert.equal(L.validateScript("Era uma vez um gato curioso que explorava a cidade toda noite.").ok, true));
test("plano local soma 90s exatos e cobre o texto", () => {
  const sc = "Um gato acorda. Ele sai de casa. A cidade brilha. Ele encontra uma luz. Segue a luz. Descobre um portal. Entra nele. Tudo muda. Ele sorri. Fim da noite.";
  const t = L.normalizeDurations(L.checkPlan({ scenes: L.localPlan(sc, 90, "gato", "3D") }), 90);
  assert.equal(t.reduce((a, s) => a + s.durationMs, 0), 90000);
  assert.equal(t.map((s) => s.narration).join(" "), sc);
});
test("plano inválido da IA é rejeitado", () => { assert.throws(() => L.checkPlan({ scenes: [] })); assert.throws(() => L.checkPlan(null)); });
test("SRT válido e erros detectados", () => {
  const sc = [{ startMs: 0, durationMs: 9000, narration: "Era uma vez um gato curioso que adorava explorar os telhados da cidade." }, { startMs: 9000, durationMs: 6000, narration: "Numa noite, ele achou uma luz." }];
  const cues = L.buildCues(sc), srt = L.buildSrt(cues);
  assert.equal(cues.at(-1).endMs, 15000); assert.equal(L.validateSrt(srt, 15000).ok, true);
  assert.equal(L.validateSrt("", 1).ok, false);
  assert.equal(L.validateSrt("1\n00:00:00,000 --> 00:00:02,000\na\n\n2\n00:00:01,000 --> 00:00:03,000\nb\n", 9e3).ok, false);
});
test("nomes de arquivo seguros", () => { assert.equal(L.safeFilename("Ação!", "mp4"), "acao.mp4"); assert.equal(L.safeFilename("../../etc/passwd", "srt"), "etc-passwd.srt"); assert.equal(L.safeFilename("???", "mp4"), "video.mp4"); });
test("roteiro curto/sem pontuação ainda gera ≥3 cenas (regressão)", () => {
  for (const s of ["Um gato acorda cedo e sai de casa para explorar.", "um gato acorda cedo e sai de casa para explorar a cidade grande hoje"]) {
    const t = L.normalizeDurations(L.checkPlan({ scenes: L.localPlan(s, 9, "g", "3D") }), 9);
    assert.ok(t.length >= 3); assert.equal(t.reduce((a, x) => a + x.durationMs, 0), 9000);
    assert.equal(t.map((x) => x.narration).join(" "), s.trim());
  }
});
test("JSON: exemplo é válido; fences markdown são aceitos", () => {
  const v = L.validateSpec(L.EXAMPLE_SPEC); assert.equal(v.ok, true); assert.equal(v.total, 12);
  const p = L.parseSpecText("```json\n" + JSON.stringify(L.EXAMPLE_SPEC) + "\n```"); assert.equal(p.ok, true); assert.equal(L.validateSpec(p.data).ok, true);
});
test("JSON: erros claros com caminho", () => {
  const c = (f) => { const d = structuredClone(L.EXAMPLE_SPEC); f(d); return L.validateSpec(d).errors.join("|"); };
  assert.match(c((d) => (d.version = 2)), /version/);
  assert.match(c((d) => (d.scenes[1].characters[0].type = "dog")), /scenes\[1\]\.characters\[0\]\.type.*dog/);
  assert.match(c((d) => (d.scenes[0].texts[0].color = "red")), /texts\[0\]\.color/);
  assert.match(c((d) => (d.scenes[2].durationSec = 99)), /scenes\[2\]\.durationSec/);
  assert.match(c((d) => (d.scenes[0].background = "lava")), /background/);
  assert.match(c((d) => d.scenes.forEach((s) => (s.durationSec = 1))), /soma das durações/);
  assert.equal(L.validateSpec([]).ok, false); assert.equal(L.validateSpec(null).ok, false); assert.equal(L.parseSpecText("{oi").ok, false); assert.equal(L.parseSpecText("  ").ok, false);
});
test("JSON v2: fx, sign/label, talk, truncado, asterisco", () => {
  const c = (f) => { const d = structuredClone(L.EXAMPLE_SPEC); f(d); return L.validateSpec(d); };
  assert.equal(c((d) => { d.scenes[0].fx = ["shake", "speed"]; d.scenes[0].props.push({ type: "sign", x: .5, y: .5, label: "75°C" }); d.scenes[0].background = "science"; d.scenes[1].background = "street"; d.scenes[0].characters[0].talk = false; }).ok, true);
  assert.match(c((d) => (d.scenes[0].fx = ["boom"])).errors.join(), /fx\[0\]/);
  assert.match(c((d) => (d.scenes[0].props[0].label = "x".repeat(20))).errors.join(), /label/);
  const t = L.parseSpecText('{"version":1,"scenes":[{"durationSec":'); assert.equal(t.ok, false); assert.equal(t.truncated, true);
  assert.equal(L.parseSpecText("{oi}").truncated, false);
  const cq = L.buildCues([{ startMs: 0, durationMs: 4000, narration: "Ele *passou* o som." }]); const srt = L.buildSrt(cq);
  assert.ok(!srt.includes("*")); assert.ok(cq.every((x) => x.text.split("\n").length === 1)); assert.equal(L.validateSrt(srt, 4000).ok, true);
});
import { muxMp4 } from "./toonstory-mp4.js";
test("JSON v3: hero, run, angry, skin", () => {
  const d = structuredClone(L.EXAMPLE_SPEC); d.scenes[0].characters[0] = { type: "hero", x: .4, action: "run", emotion: "angry", skin: "#aa7755", dx: .4 };
  assert.equal(L.validateSpec(d).ok, true); d.scenes[0].characters[0].skin = "marrom"; assert.match(L.validateSpec(d).errors.join(), /skin/);
});
test("MP4: ordem das caixas e offset do mdat", () => {
  const S = Array.from({ length: 5 }, (_, i) => ({ d: new Uint8Array(10 + i).fill(i + 1), key: i === 0 }));
  const m = muxMp4(S, 540, 960, 30, new Uint8Array([1, 0x4d, 0, 0x28, 0xff, 0xe1, 0, 0])); const v = new DataView(m.buffer);
  let p = 0, names = []; while (p < m.length) { names.push(String.fromCharCode(...m.slice(p + 4, p + 8))); p += v.getUint32(p); } assert.equal(p, m.length);
  assert.deepEqual(names, ["ftyp", "moov", "mdat"]);
  const ftyp = v.getUint32(0), moov = v.getUint32(ftyp), off = ftyp + moov + 8, i = m.findIndex((_, k) => String.fromCharCode(...m.slice(k, k + 4)) === "stco");
  assert.equal(v.getUint32(i + 12), off); assert.equal(m[off], 1); assert.equal(m[off + 10], 2);
});
test("parser tolera <think>, texto em volta e cercas", () => {
  const j = JSON.stringify(L.EXAMPLE_SPEC);
  for (const t of [`<think>pensando { }</think>${j}`, `Claro! Aqui está:\n${j}\nEspero que ajude.`, "```json\n" + j + "\n```"]) { const p = L.parseSpecText(t); assert.equal(p.ok, true); assert.equal(L.validateSpec(p.data).ok, true); }
  assert.equal(L.parseSpecText(j.slice(0, 60)).truncated, true);
});
test("provedores: todos têm base https (exceto outro), id único e padrão dentro dos modelos", async () => {
  const { PROVEDORES: P } = await import("./toonstory-provedores.js");
  assert.equal(new Set(P.map((p) => p.id)).size, P.length);
  for (const p of P) { if (p.id === "outro") continue; assert.match(p.base, /^https:\/\/.+/); assert.ok(!p.base.endsWith("/")); assert.ok(p.modelos.includes(p.padrao), p.id); }
});
