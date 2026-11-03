// MP4 mínimo (1 faixa de vídeo, sem áudio, moov antes do mdat) + gravação rápida quadro a quadro (WebCodecs).
const u32 = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255], u16 = (n) => [(n >> 8) & 255, n & 255], str = (s) => [...s].map((c) => c.charCodeAt(0));
const flat = (a) => a.flatMap((x) => (x instanceof Uint8Array ? Array.from(x) : Array.isArray(x) ? flat(x) : [x]));
const box = (t, ...p) => { const b = flat(p); return Uint8Array.from([...u32(8 + b.length), ...str(t), ...b]); };
const full = (t, v, f, ...p) => box(t, v, (f >> 16) & 255, (f >> 8) & 255, f & 255, ...p);
const MAT = [...u32(0x10000), ...u32(0), ...u32(0), ...u32(0), ...u32(0x10000), ...u32(0), ...u32(0), ...u32(0), ...u32(0x40000000)];
// samples: [{ d: Uint8Array (formato avcC/length-prefixed), key: bool }]; description: avcC (kind "avc"); retorna Uint8Array
export function muxParts(samples, width, height, fps, description, kind = "avc") { // partes do arquivo, sem copiar os quadros (economiza memória)
  if (!samples.length) throw new Error("sem quadros");
  if (kind === "avc" && !description) throw new Error("sem avcC");
  const N = samples.length, ts = fps * 1000, dur = N * 1000, bytes = samples.reduce((a, s) => a + s.d.length, 0), keys = samples.map((s, i) => (s.key ? i + 1 : 0)).filter(Boolean);
  const head = [new Array(6).fill(0), u16(1), u16(0), u16(0), u32(0), u32(0), u32(0), u16(width), u16(height), u32(0x480000), u32(0x480000), u32(0), u16(1), new Array(32).fill(0), u16(0x18), u16(0xffff)];
  const entry = kind === "avc" ? box("avc1", ...head, box("avcC", description)) : box("vp09", ...head, full("vpcC", 1, 0, 0, height > 1280 ? 41 : 40, 0x82, 1, 1, 1, u16(0)));
  const moov = (off) => box("moov", full("mvhd", 0, 0, u32(0), u32(0), u32(ts), u32(dur), u32(0x10000), u16(0x100), u16(0), u32(0), u32(0), MAT, new Array(24).fill(0), u32(2)),
    box("trak", full("tkhd", 0, 3, u32(0), u32(0), u32(1), u32(0), u32(dur), u32(0), u32(0), u16(0), u16(0), u16(0), u16(0), MAT, u32(width << 16), u32(height << 16)),
      box("mdia", full("mdhd", 0, 0, u32(0), u32(0), u32(ts), u32(dur), u16(0x55c4), u16(0)), full("hdlr", 0, 0, u32(0), str("vide"), u32(0), u32(0), u32(0), [86, 105, 100, 0]),
        box("minf", full("vmhd", 0, 1, u16(0), u16(0), u16(0), u16(0)), box("dinf", full("dref", 0, 0, u32(1), full("url ", 0, 1))),
          box("stbl", full("stsd", 0, 0, u32(1), entry), full("stts", 0, 0, u32(1), u32(N), u32(1000)), full("stss", 0, 0, u32(keys.length), keys.map(u32)),
            full("stsc", 0, 0, u32(1), u32(1), u32(N), u32(1)), full("stsz", 0, 0, u32(0), u32(N), samples.map((s) => u32(s.d.length))), full("stco", 0, 0, u32(1), u32(off)))))));
  const ftyp = box("ftyp", str("isom"), u32(512), str("isom"), str("iso2"), str("avc1"), str("mp41")), off = ftyp.length + moov(0).length + 8, m = moov(off), mh = Uint8Array.from([...u32(8 + bytes), ...str("mdat")]);
  return [ftyp, m, mh, ...samples.map((s) => s.d)];
}
export function muxMp4(...args) { const parts = muxParts(...args), out = new Uint8Array(parts.reduce((a, x) => a + x.length, 0)); let p = 0; for (const x of parts) { out.set(x, p); p += x.length; } return out; }
// vídeos longos (> 5 min) usam menos bits por segundo para caber na memória
export async function encodeFast({ c, draw, total, W, H, onProgress, signal }) {
  const fps = 30, cands = [["avc", "avc1.640028"], ["avc", "avc1.4D0028"], ["avc", "avc1.42E028"], ["vp9", "vp09.00.10.08"]]; let cfg, kind;
  for (const [k, codec] of cands) { const base = { codec, width: W, height: H, bitrate: total > 3e5 ? (W >= 1080 ? 3e6 : 1.5e6) : W >= 1080 ? 8e6 : 5e6, framerate: fps, ...(k === "avc" ? { avc: { format: "avc" } } : {}) }; try { if ((await VideoEncoder.isConfigSupported(base)).supported) { cfg = base; kind = k; break; } } catch {} }
  if (!cfg) throw new Error("nenhum codec de vídeo disponível");
  const samples = []; let desc = null, err = null;
  const enc = new VideoEncoder({ error: (e) => (err = e), output: (ch, meta) => { const d = new Uint8Array(ch.byteLength); ch.copyTo(d); samples.push({ d, key: ch.type === "key" }); const x = meta?.decoderConfig?.description; if (x && !desc) desc = ArrayBuffer.isView(x) ? new Uint8Array(x.buffer, x.byteOffset, x.byteLength).slice() : new Uint8Array(x).slice(); } });
  enc.configure(cfg); const n = Math.round((total / 1000) * fps);
  for (let i = 0; i < n; i++) {
    if (signal?.aborted) { try { enc.close(); } catch {} throw new Error("Cancelado"); }
    if (err) throw err;
    draw((i * 1000) / fps); const f = new VideoFrame(c, { timestamp: Math.round((i * 1e6) / fps), duration: Math.round(1e6 / fps) });
    enc.encode(f, { keyFrame: i % 60 === 0 }); f.close();
    while (enc.encodeQueueSize > 6) await new Promise((r) => setTimeout(r, 1));
    if (i % 10 === 0) { onProgress?.(i / n); await new Promise((r) => setTimeout(r)); }
  }
  await enc.flush(); enc.close(); if (err) throw err; onProgress?.(1);
  const blob = new Blob(muxParts(samples, W, H, fps, desc, kind), { type: "video/mp4" });
  await new Promise((res, rej) => { const v = document.createElement("video"), u = URL.createObjectURL(blob), end = (e) => { URL.revokeObjectURL(u); e ? rej(e) : res(); }; v.muted = true;
    v.onloadedmetadata = () => (Math.abs(v.duration * 1000 - total) < 700 && v.videoWidth === W ? end() : end(new Error("MP4 com duração ou tamanho inesperados")));
    v.onerror = () => end(new Error("MP4 ilegível")); setTimeout(() => end(new Error("verificação do MP4 expirou")), 8000); v.src = u; });
  return { blob, type: "video/mp4" };
}
