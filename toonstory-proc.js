// Procedural geometry + composite objects for ToonStory
// Pure Canvas 2D — no external assets. Used by paintScene.

const TAU = Math.PI * 2;
const HEX = /^#[0-9a-fA-F]{6}$/;

export const SHAPES = ["circle", "ellipse", "rect", "triangle", "polygon", "line", "arc", "path", "star"];

/** Draw a single primitive in local space (caller applies transform). */
export function drawShape(g, part) {
  const shape = part.shape || part.type || "rect";
  const fill = part.color || part.fill || "#888888";
  const stroke = part.stroke || null;
  const lw = part.lineWidth ?? part.strokeWidth ?? 2;
  const op = part.opacity != null ? part.opacity : 1;
  g.save();
  g.globalAlpha *= op;
  if (part.shadow) {
    g.shadowColor = part.shadow.color || "rgba(0,0,0,.35)";
    g.shadowBlur = part.shadow.blur ?? 8;
    g.shadowOffsetX = part.shadow.x ?? 0;
    g.shadowOffsetY = part.shadow.y ?? 4;
  }
  g.beginPath();
  if (shape === "circle") {
    const r = part.r ?? (part.width || 20) / 2;
    g.arc(0, 0, r, 0, TAU);
  } else if (shape === "ellipse") {
    const rx = (part.width || 40) / 2, ry = (part.height || 20) / 2;
    g.ellipse(0, 0, rx, ry, 0, 0, TAU);
  } else if (shape === "rect") {
    const w = part.width || 40, h = part.height || 30, rr = part.radius || 0;
    if (rr && g.roundRect) g.roundRect(-w / 2, -h / 2, w, h, rr);
    else g.rect(-w / 2, -h / 2, w, h);
  } else if (shape === "triangle") {
    const w = part.width || 40, h = part.height || 40;
    g.moveTo(0, -h / 2); g.lineTo(w / 2, h / 2); g.lineTo(-w / 2, h / 2); g.closePath();
  } else if (shape === "star") {
    const spikes = part.spikes || 5, or = part.r || part.width / 2 || 20, ir = or * (part.inner || 0.45);
    for (let i = 0; i < spikes * 2; i++) {
      const rad = (i * Math.PI) / spikes - Math.PI / 2, r = i % 2 === 0 ? or : ir;
      const x = Math.cos(rad) * r, y = Math.sin(rad) * r;
      i === 0 ? g.moveTo(x, y) : g.lineTo(x, y);
    }
    g.closePath();
  } else if (shape === "polygon" && Array.isArray(part.points)) {
    part.points.forEach((pt, i) => {
      const x = Array.isArray(pt) ? pt[0] : pt.x, y = Array.isArray(pt) ? pt[1] : pt.y;
      i === 0 ? g.moveTo(x, y) : g.lineTo(x, y);
    });
    g.closePath();
  } else if (shape === "line" && Array.isArray(part.points) && part.points.length >= 2) {
    part.points.forEach((pt, i) => {
      const x = Array.isArray(pt) ? pt[0] : pt.x, y = Array.isArray(pt) ? pt[1] : pt.y;
      i === 0 ? g.moveTo(x, y) : g.lineTo(x, y);
    });
  } else if (shape === "arc") {
    const r = part.r || 30;
    g.arc(0, 0, r, part.start ?? 0, part.end ?? Math.PI, !!part.ccw);
  } else if (shape === "path" && Array.isArray(part.commands)) {
    for (const cmd of part.commands) {
      const t = cmd[0], a = cmd.slice(1);
      if (t === "M") g.moveTo(a[0], a[1]);
      else if (t === "L") g.lineTo(a[0], a[1]);
      else if (t === "Q") g.quadraticCurveTo(a[0], a[1], a[2], a[3]);
      else if (t === "C") g.bezierCurveTo(a[0], a[1], a[2], a[3], a[4], a[5]);
      else if (t === "Z") g.closePath();
    }
  } else {
    // fallback rect
    const w = part.width || 30, h = part.height || 30;
    g.rect(-w / 2, -h / 2, w, h);
  }
  if (shape !== "line" && shape !== "arc") {
    if (part.gradient && Array.isArray(part.gradient.colors)) {
      const grd = g.createLinearGradient(-20, -20, 20, 20);
      part.gradient.colors.forEach((c, i, arr) => grd.addColorStop(i / Math.max(1, arr.length - 1), c));
      g.fillStyle = grd;
    } else g.fillStyle = fill;
    if (part.fill !== false && shape !== "line") g.fill();
  }
  if (stroke || shape === "line" || shape === "arc") {
    g.strokeStyle = stroke || fill;
    g.lineWidth = lw;
    g.lineCap = "round";
    g.lineJoin = "round";
    g.stroke();
  }
  g.restore();
}

/** Apply local transform then draw part or children. */
export function drawPart(g, part, t = 0) {
  if (!part) return;
  const x = part.x || 0, y = part.y || 0;
  let rot = part.rotation || part.rot || 0;
  let sc = part.scale != null ? part.scale : 1;
  // simple procedural motion hooks
  if (part.spin) rot += t * part.spin;
  if (part.bob) y += Math.sin(t * (part.bobSpeed || 4) + (part.phase || 0)) * part.bob;
  if (part.flap) rot += Math.sin(t * (part.flapSpeed || 8) + (part.phase || 0)) * part.flap;
  g.save();
  g.translate(x, y);
  if (rot) g.rotate(rot);
  if (sc !== 1) g.scale(sc, sc);
  if (part.parts && part.parts.length) {
    const ordered = [...part.parts].sort((a, b) => (a.z || 0) - (b.z || 0));
    for (const ch of ordered) drawPart(g, ch, t);
  } else {
    drawShape(g, part);
  }
  g.restore();
}

/** Built-in composite templates (geometry only). */
export const TEMPLATES = {
  car: {
    name: "Carro",
    parts: [
      { id: "body", shape: "rect", width: 120, height: 36, color: "#e11d48", radius: 8, y: 0, z: 1 },
      { id: "cabin", shape: "rect", width: 60, height: 28, color: "#93c5fd", radius: 6, x: 10, y: -22, z: 2 },
      { id: "wheelL", shape: "circle", r: 14, color: "#1f2937", x: -35, y: 18, z: 3, spin: 0 },
      { id: "wheelR", shape: "circle", r: 14, color: "#1f2937", x: 40, y: 18, z: 3 },
      { id: "hubL", shape: "circle", r: 5, color: "#9ca3af", x: -35, y: 18, z: 4 },
      { id: "hubR", shape: "circle", r: 5, color: "#9ca3af", x: 40, y: 18, z: 4 },
      { id: "light", shape: "rect", width: 10, height: 8, color: "#fde047", x: 58, y: -2, radius: 2, z: 2 },
    ],
  },
  dragon: {
    name: "Dragão",
    parts: [
      { id: "tail", shape: "polygon", points: [[-90, 10], [-40, 0], [-90, -8], [-70, 0]], color: "#166534", z: 0 },
      { id: "body", shape: "ellipse", width: 100, height: 48, color: "#22c55e", z: 1 },
      { id: "belly", shape: "ellipse", width: 60, height: 28, color: "#86efac", y: 6, z: 2 },
      { id: "wingL", shape: "polygon", points: [[-10, -10], [-70, -50], [10, -25]], color: "#14532d", z: 0, flap: 0.25, flapSpeed: 6, phase: 0 },
      { id: "wingR", shape: "polygon", points: [[10, -10], [70, -50], [-5, -25]], color: "#14532d", z: 0, flap: 0.25, flapSpeed: 6, phase: Math.PI },
      { id: "neck", shape: "ellipse", width: 28, height: 36, color: "#16a34a", x: 45, y: -18, z: 2 },
      { id: "head", shape: "ellipse", width: 36, height: 28, color: "#22c55e", x: 68, y: -28, z: 3 },
      { id: "jaw", shape: "ellipse", width: 22, height: 12, color: "#4ade80", x: 78, y: -18, z: 3 },
      { id: "eye", shape: "circle", r: 4, color: "#fef08a", x: 74, y: -32, z: 4 },
      { id: "pupil", shape: "circle", r: 2, color: "#111", x: 75, y: -32, z: 5 },
      { id: "horn1", shape: "triangle", width: 8, height: 16, color: "#bbf7d0", x: 60, y: -42, z: 3 },
      { id: "horn2", shape: "triangle", width: 8, height: 14, color: "#bbf7d0", x: 68, y: -44, z: 3 },
      { id: "leg1", shape: "rect", width: 10, height: 22, color: "#15803d", x: -20, y: 28, radius: 3, z: 1 },
      { id: "leg2", shape: "rect", width: 10, height: 22, color: "#15803d", x: 20, y: 28, radius: 3, z: 1 },
    ],
  },
  sword: {
    name: "Espada",
    parts: [
      { id: "blade", shape: "rect", width: 12, height: 70, color: "#e5e7eb", y: -25, radius: 2, z: 1 },
      { id: "tip", shape: "triangle", width: 12, height: 14, color: "#f3f4f6", y: -62, z: 1 },
      { id: "guard", shape: "rect", width: 36, height: 8, color: "#a78bfa", y: 12, radius: 2, z: 2 },
      { id: "grip", shape: "rect", width: 10, height: 28, color: "#7c3aed", y: 30, radius: 3, z: 1 },
      { id: "pommel", shape: "circle", r: 6, color: "#fbbf24", y: 48, z: 2 },
    ],
  },
  tree_proc: {
    name: "Árvore",
    parts: [
      { id: "trunk", shape: "rect", width: 18, height: 50, color: "#78350f", y: 20, radius: 3, z: 1 },
      { id: "fol1", shape: "circle", r: 28, color: "#166534", y: -20, z: 2 },
      { id: "fol2", shape: "circle", r: 22, color: "#15803d", x: -18, y: -10, z: 2 },
      { id: "fol3", shape: "circle", r: 22, color: "#16a34a", x: 18, y: -10, z: 2 },
    ],
  },
  house_proc: {
    name: "Casa",
    parts: [
      { id: "wall", shape: "rect", width: 90, height: 55, color: "#fcd34d", y: 10, radius: 2, z: 1 },
      { id: "roof", shape: "triangle", width: 110, height: 40, color: "#b91c1c", y: -30, z: 2 },
      { id: "door", shape: "rect", width: 18, height: 28, color: "#78350f", y: 22, radius: 2, z: 2 },
      { id: "win", shape: "rect", width: 18, height: 16, color: "#7dd3fc", x: -25, y: 5, radius: 2, z: 2 },
    ],
  },
  rocket: {
    name: "Foguete",
    parts: [
      { id: "body", shape: "rect", width: 28, height: 70, color: "#f8fafc", radius: 8, z: 1 },
      { id: "nose", shape: "triangle", width: 28, height: 24, color: "#ef4444", y: -47, z: 2 },
      { id: "finL", shape: "polygon", points: [[-14, 25], [-30, 40], [-14, 40]], color: "#3b82f6", z: 0 },
      { id: "finR", shape: "polygon", points: [[14, 25], [30, 40], [14, 40]], color: "#3b82f6", z: 0 },
      { id: "window", shape: "circle", r: 7, color: "#38bdf8", y: -10, z: 3 },
      { id: "flame", shape: "triangle", width: 16, height: 22, color: "#f97316", y: 48, z: 0, bob: 4, bobSpeed: 20 },
    ],
  },
  fish: {
    name: "Peixe",
    parts: [
      { id: "body", shape: "ellipse", width: 70, height: 36, color: "#38bdf8", z: 1 },
      { id: "tail", shape: "polygon", points: [[-35, 0], [-55, -16], [-55, 16]], color: "#0ea5e9", z: 0, flap: 0.3, flapSpeed: 10 },
      { id: "fin", shape: "triangle", width: 16, height: 14, color: "#0284c7", y: -16, z: 2 },
      { id: "eye", shape: "circle", r: 4, color: "#fff", x: 18, y: -4, z: 3 },
      { id: "pupil", shape: "circle", r: 2, color: "#111", x: 19, y: -4, z: 4 },
    ],
  },
  bird: {
    name: "Pássaro",
    parts: [
      { id: "body", shape: "ellipse", width: 40, height: 24, color: "#f59e0b", z: 1 },
      { id: "head", shape: "circle", r: 10, color: "#fbbf24", x: 22, y: -6, z: 2 },
      { id: "beak", shape: "triangle", width: 12, height: 8, color: "#ea580c", x: 34, y: -4, z: 2 },
      { id: "wing", shape: "ellipse", width: 36, height: 14, color: "#d97706", y: -4, z: 0, flap: 0.4, flapSpeed: 12 },
      { id: "tail", shape: "triangle", width: 14, height: 18, color: "#b45309", x: -24, y: 2, z: 0 },
      { id: "eye", shape: "circle", r: 2, color: "#111", x: 24, y: -8, z: 3 },
    ],
  },
};

/**
 * Draw a procedural object at normalized scene coords.
 * o = { template?|parts?, x, y, scale, rotation, color? }
 * t = time seconds for motion
 */
export function drawProcedural(g, o, W, H, t = 0) {
  const base = o.template && TEMPLATES[o.template] ? TEMPLATES[o.template] : null;
  const parts = o.parts || base?.parts;
  if (!parts || !parts.length) {
    // single shape object
    if (o.shape || SHAPES.includes(o.type)) {
      const S = H * 0.1 * (o.scale || 1);
      g.save();
      g.translate((o.x ?? 0.5) * W, (o.y ?? 0.5) * H);
      if (o.rotation) g.rotate(o.rotation);
      g.scale(S / 40, S / 40);
      drawShape(g, { ...o, width: o.width || 40, height: o.height || 40 });
      g.restore();
    }
    return;
  }
  const S = H * 0.12 * (o.scale || 1);
  g.save();
  g.translate((o.x ?? 0.5) * W, (o.y ?? 0.5) * H);
  if (o.rotation) g.rotate(o.rotation);
  if (o.facing === -1) g.scale(-1, 1);
  g.scale(S / 50, S / 50);
  // optional global recolor: multiply only if o.color set on root
  const root = { parts: parts.map((p) => (o.color && !p.keepColor ? { ...p, color: p.recolor === false ? p.color : o.color } : p)) };
  drawPart(g, root, t);
  g.restore();
}

/** Resolve prop: known catalog types stay as-is; unknown types try template or procedural. */
export function resolvePropKind(type) {
  if (TEMPLATES[type]) return { kind: "template", template: type };
  if (SHAPES.includes(type)) return { kind: "shape", shape: type };
  return null;
}

export function listTemplates() {
  return Object.keys(TEMPLATES).map((id) => ({ id, name: TEMPLATES[id].name || id }));
}
