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
