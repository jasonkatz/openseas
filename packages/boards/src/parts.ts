/**
 * Vector versions of the sprite atlases' pieces, for when an atlas cannot load and for lab kinds
 * the atlases do not draw. Each is drawn in the sprites' manner: a dark navy contour, a lit upper
 * left, and a silhouette of its own, so every kind still reads apart without color (CLAUDE.md
 * rule 6). Presentation only. All painters work in a unit box: `size` CSS pixels centred on (cx, cy).
 */

const INK = "#0b1526";
const STEEL = 0x9aa3b0;
const STEEL_DEEP = 0x4b5361;
const CREAM = 0xd8ccae;

const css = (c: number, alpha = 1): string => `rgba(${(c >> 16) & 0xff},${(c >> 8) & 0xff},${c & 0xff},${alpha})`;
const shade = (c: number, t: number): number => {
  const to = t < 0 ? 0x000000 : 0xffffff;
  const k = Math.abs(t);
  const ch = (shift: number): number => Math.round(((c >> shift) & 0xff) * (1 - k) + ((to >> shift) & 0xff) * k);
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
};

type Ctx = CanvasRenderingContext2D;

/** Pixels in one unit while a part paints: canvas shadows blur in pixels, not in the transform. */
let unitPx = 1;
const blur = (units: number): number => units * unitPx;

/** Run `draw` with the origin at the box centre and one unit equal to the box size. */
function unit(ctx: Ctx, cx: number, cy: number, size: number, draw: () => void): void {
  ctx.save();
  unitPx = size;
  ctx.translate(cx, cy);
  ctx.scale(size, size);
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  draw();
  ctx.restore();
}

/** A body fill lit from the upper left. */
function lit(ctx: Ctx, color: number, x0 = -0.4, y0 = -0.4, x1 = 0.4, y1 = 0.4): CanvasGradient {
  const g = ctx.createLinearGradient(x0, y0, x1, y1);
  g.addColorStop(0, css(shade(color, 0.32)));
  g.addColorStop(0.5, css(color));
  g.addColorStop(1, css(shade(color, -0.3)));
  return g;
}

/** Fill the current path with `fill` and give it the sprites' contour. */
function body(ctx: Ctx, fill: string | CanvasGradient, line = 0.045, rule: CanvasFillRule = "nonzero"): void {
  ctx.fillStyle = fill;
  ctx.fill(rule);
  ctx.lineWidth = line;
  ctx.strokeStyle = INK;
  ctx.stroke();
}

function glint(ctx: Ctx, x: number, y: number, r: number, alpha = 0.6): void {
  ctx.beginPath();
  ctx.ellipse(x, y, r * 1.4, r * 0.7, -0.6, 0, Math.PI * 2);
  ctx.fillStyle = `rgba(255,255,255,${alpha})`;
  ctx.fill();
}

function poly(ctx: Ctx, pts: ReadonlyArray<readonly [number, number]>): void {
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
  ctx.closePath();
}

function rrect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  const k = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + k, y);
  ctx.arcTo(x + w, y, x + w, y + h, k);
  ctx.arcTo(x + w, y + h, x, y + h, k);
  ctx.arcTo(x, y + h, x, y, k);
  ctx.arcTo(x, y, x + w, y, k);
  ctx.closePath();
}

function rivet(ctx: Ctx, x: number, y: number, r: number): void {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = css(STEEL);
  ctx.fill();
  ctx.lineWidth = r * 0.5;
  ctx.strokeStyle = INK;
  ctx.stroke();
}

// ---- Cooling's parts

function cog(ctx: Ctx, color: number): void {
  const teeth = 8;
  const pts: Array<[number, number]> = [];
  for (let i = 0; i < teeth; i++) {
    const a = (i / teeth) * Math.PI * 2;
    const half = Math.PI / teeth;
    for (const [da, r] of [
      [-half * 0.95, 0.33],
      [-half * 0.45, 0.45],
      [half * 0.45, 0.45],
      [half * 0.95, 0.33],
    ] as const) pts.push([Math.cos(a + da) * r, Math.sin(a + da) * r]);
  }
  poly(ctx, pts);
  ctx.moveTo(0.15, 0);
  ctx.arc(0, 0, 0.15, 0, Math.PI * 2, true);
  body(ctx, lit(ctx, color), 0.045, "evenodd");
  ctx.beginPath();
  ctx.arc(0, 0, 0.19, 0, Math.PI * 2);
  ctx.arc(0, 0, 0.14, 0, Math.PI * 2, true);
  ctx.fillStyle = css(STEEL);
  ctx.fill("evenodd");
  ctx.beginPath();
  ctx.arc(0, 0, 0.19, 0, Math.PI * 2);
  ctx.lineWidth = 0.025;
  ctx.strokeStyle = INK;
  ctx.stroke();
  glint(ctx, -0.22, -0.24, 0.05, 0.45);
}

function valve(ctx: Ctx, color: number): void {
  ctx.beginPath();
  ctx.arc(0, 0, 0.44, 0, Math.PI * 2);
  ctx.arc(0, 0, 0.33, 0, Math.PI * 2, true);
  body(ctx, lit(ctx, color), 0.045, "evenodd");
  for (let i = 0; i < 3; i++) {
    const a = -Math.PI / 2 + (i * Math.PI * 2) / 3;
    ctx.save();
    ctx.rotate(a);
    rrect(ctx, 0.05, -0.05, 0.3, 0.1, 0.04);
    body(ctx, css(shade(color, -0.08)), 0.035);
    ctx.restore();
  }
  ctx.beginPath();
  ctx.arc(0, 0, 0.1, 0, Math.PI * 2);
  body(ctx, lit(ctx, STEEL, -0.1, -0.1, 0.1, 0.1), 0.035);
  glint(ctx, -0.27, -0.27, 0.05, 0.45);
}

function bolt(ctx: Ctx, color: number): void {
  ctx.save();
  ctx.rotate(0.6);
  // Threaded shank, then the hex head over it.
  rrect(ctx, -0.12, -0.12, 0.24, 0.56, 0.05);
  body(ctx, lit(ctx, color, -0.12, 0, 0.12, 0));
  ctx.lineWidth = 0.028;
  ctx.strokeStyle = css(shade(color, -0.45));
  for (let y = -0.04; y < 0.4; y += 0.075) {
    ctx.beginPath();
    ctx.moveTo(-0.11, y + 0.03);
    ctx.lineTo(0.11, y - 0.02);
    ctx.stroke();
  }
  poly(ctx, [
    [-0.24, -0.34],
    [-0.12, -0.45],
    [0.12, -0.45],
    [0.24, -0.34],
    [0.24, -0.14],
    [-0.24, -0.14],
  ]);
  body(ctx, lit(ctx, color, -0.24, -0.45, 0.24, -0.14));
  ctx.beginPath();
  ctx.moveTo(-0.08, -0.45);
  ctx.lineTo(-0.08, -0.14);
  ctx.moveTo(0.08, -0.45);
  ctx.lineTo(0.08, -0.14);
  ctx.lineWidth = 0.022;
  ctx.strokeStyle = css(shade(color, -0.35));
  ctx.stroke();
  ctx.restore();
  glint(ctx, -0.12, -0.3, 0.045, 0.5);
}

function fuse(ctx: Ctx, color: number): void {
  rrect(ctx, -0.3, -0.15, 0.6, 0.3, 0.06);
  body(ctx, lit(ctx, color, 0, -0.15, 0, 0.15));
  for (const x of [-0.45, 0.29]) {
    rrect(ctx, x, -0.19, 0.16, 0.38, 0.07);
    body(ctx, lit(ctx, STEEL, 0, -0.19, 0, 0.19));
  }
  // The glowing element in its window.
  rrect(ctx, -0.2, -0.06, 0.4, 0.12, 0.05);
  ctx.fillStyle = "#3a1a08";
  ctx.fill();
  rrect(ctx, -0.17, -0.025, 0.34, 0.05, 0.025);
  ctx.fillStyle = "#ffe08a";
  ctx.shadowColor = "#ffb347";
  ctx.shadowBlur = blur(0.08);
  ctx.fill();
  ctx.shadowBlur = 0;
}

function crystal(ctx: Ctx, color: number): void {
  const pts: Array<[number, number]> = [
    [-0.04, -0.46],
    [0.2, -0.24],
    [0.18, 0.28],
    [0.02, 0.46],
    [-0.21, 0.22],
    [-0.2, -0.27],
  ];
  poly(ctx, pts);
  body(ctx, lit(ctx, color));
  // Facets: a ridge down the middle and a lighter left face.
  poly(ctx, [
    [-0.04, -0.46],
    [-0.02, 0.0],
    [0.02, 0.46],
    [-0.21, 0.22],
    [-0.2, -0.27],
  ]);
  ctx.fillStyle = css(shade(color, 0.28), 0.6);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(-0.04, -0.46);
  ctx.lineTo(-0.02, 0);
  ctx.lineTo(0.02, 0.46);
  ctx.moveTo(-0.02, 0);
  ctx.lineTo(0.2, -0.24);
  ctx.moveTo(-0.02, 0);
  ctx.lineTo(-0.21, 0.22);
  ctx.lineWidth = 0.02;
  ctx.strokeStyle = css(shade(color, -0.4), 0.8);
  ctx.stroke();
  poly(ctx, pts);
  ctx.lineWidth = 0.045;
  ctx.strokeStyle = INK;
  ctx.stroke();
  glint(ctx, -0.11, -0.25, 0.05, 0.6);
}

function coil(ctx: Ctx, color: number): void {
  // A spring: back halves of each turn first, darker, then the front halves over them.
  const turns = 4;
  const rx = 0.3;
  const ry = 0.1;
  const y0 = -0.3;
  const step = 0.2;
  const tube = (front: boolean): void => {
    for (let i = 0; i < turns; i++) {
      const y = y0 + i * step;
      ctx.beginPath();
      if (front) ctx.ellipse(0, y, rx, ry, 0.12, 0, Math.PI);
      else ctx.ellipse(0, y, rx, ry, 0.12, Math.PI, Math.PI * 2);
      ctx.lineWidth = 0.13;
      ctx.strokeStyle = INK;
      ctx.stroke();
      ctx.lineWidth = 0.08;
      ctx.strokeStyle = css(front ? color : shade(color, -0.35));
      ctx.stroke();
      if (front) {
        ctx.lineWidth = 0.025;
        ctx.strokeStyle = css(shade(color, 0.45), 0.8);
        ctx.beginPath();
        ctx.ellipse(0, y - 0.015, rx, ry, 0.12, 0.25 * Math.PI, 0.7 * Math.PI);
        ctx.stroke();
      }
    }
  };
  tube(false);
  tube(true);
}

function chip(ctx: Ctx, color: number): void {
  // Pins first, two a side, then the chamfered body and its dark die.
  for (const k of [-0.12, 0.12]) {
    for (const [x, y, w, h] of [
      [k - 0.05, -0.44, 0.1, 0.12],
      [k - 0.05, 0.32, 0.1, 0.12],
      [-0.44, k - 0.05, 0.12, 0.1],
      [0.32, k - 0.05, 0.12, 0.1],
    ] as const) {
      rrect(ctx, x, y, w, h, 0.02);
      body(ctx, css(STEEL), 0.03);
    }
  }
  const c = 0.08;
  poly(ctx, [
    [-0.33 + c, -0.33],
    [0.33 - c, -0.33],
    [0.33, -0.33 + c],
    [0.33, 0.33 - c],
    [0.33 - c, 0.33],
    [-0.33 + c, 0.33],
    [-0.33, 0.33 - c],
    [-0.33, -0.33 + c],
  ]);
  body(ctx, lit(ctx, color));
  rrect(ctx, -0.15, -0.15, 0.3, 0.3, 0.03);
  body(ctx, "#1b1d24", 0.03);
  glint(ctx, -0.22, -0.22, 0.04, 0.5);
}

// ---- Cooling's specials, drawn over the special plate

function zap(ctx: Ctx): void {
  for (const y of [-0.36, 0.24]) {
    rrect(ctx, -0.12, y, 0.24, 0.12, 0.03);
    body(ctx, lit(ctx, STEEL, 0, y, 0, y + 0.12), 0.03);
  }
  poly(ctx, [
    [0.06, -0.24],
    [-0.12, 0.03],
    [0.0, 0.03],
    [-0.06, 0.24],
    [0.13, -0.04],
    [0.01, -0.04],
  ]);
  ctx.shadowColor = "#ffd84a";
  ctx.shadowBlur = blur(0.1);
  body(ctx, "#f5d021", 0.035);
  ctx.shadowBlur = 0;
}

function horseshoe(ctx: Ctx): void {
  ctx.beginPath();
  ctx.arc(0, -0.04, 0.28, Math.PI, 0);
  ctx.lineTo(0.28, 0.3);
  ctx.lineTo(0.12, 0.3);
  ctx.lineTo(0.12, -0.04);
  ctx.arc(0, -0.04, 0.12, 0, Math.PI, true);
  ctx.lineTo(-0.12, 0.3);
  ctx.lineTo(-0.28, 0.3);
  ctx.closePath();
  body(ctx, lit(ctx, 0xa66cf5), 0.04);
  for (const x of [-0.28, 0.12]) {
    rrect(ctx, x, 0.2, 0.16, 0.12, 0.02);
    body(ctx, css(CREAM), 0.03);
  }
}

function rock(ctx: Ctx, glow: boolean): void {
  const pts: Array<[number, number]> = [
    [-0.3, -0.12],
    [-0.14, -0.3],
    [0.12, -0.3],
    [0.31, -0.1],
    [0.28, 0.18],
    [0.08, 0.32],
    [-0.2, 0.28],
    [-0.33, 0.08],
  ];
  poly(ctx, pts);
  body(ctx, lit(ctx, 0x5d6068), 0.04);
  ctx.beginPath();
  ctx.moveTo(-0.24, 0.02);
  ctx.lineTo(-0.06, -0.04);
  ctx.lineTo(0.04, 0.08);
  ctx.lineTo(0.22, 0.02);
  ctx.moveTo(-0.06, -0.04);
  ctx.lineTo(0.02, -0.22);
  if (glow) {
    ctx.shadowColor = "#ff8a2a";
    ctx.shadowBlur = blur(0.06);
    ctx.lineWidth = 0.035;
    ctx.strokeStyle = "#ffa040";
  } else {
    ctx.lineWidth = 0.025;
    ctx.strokeStyle = "rgba(10,12,18,0.7)";
  }
  ctx.stroke();
  ctx.shadowBlur = 0;
}

// ---- Engines' pellets: a riveted cream rim round a colored face with its own emblem

function disc(ctx: Ctx, color: number, emblem: "trefoil" | "rings" | "spokes" | "hex"): void {
  ctx.beginPath();
  ctx.arc(0, 0, 0.44, 0, Math.PI * 2);
  body(ctx, lit(ctx, CREAM));
  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 4 + (i * Math.PI) / 2;
    rivet(ctx, Math.cos(a) * 0.39, Math.sin(a) * 0.39, 0.03);
  }
  ctx.beginPath();
  ctx.arc(0, 0, 0.33, 0, Math.PI * 2);
  body(ctx, lit(ctx, color), 0.035);
  const ink = css(shade(color, -0.6));
  ctx.fillStyle = ink;
  ctx.strokeStyle = ink;
  switch (emblem) {
    case "trefoil":
      for (let i = 0; i < 3; i++) {
        ctx.save();
        ctx.rotate((i * Math.PI * 2) / 3);
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.quadraticCurveTo(0.22, -0.04, 0.2, -0.22);
        ctx.quadraticCurveTo(0.08, -0.12, 0, 0);
        ctx.fill();
        ctx.restore();
      }
      break;
    case "rings":
      ctx.lineWidth = 0.045;
      ctx.beginPath();
      ctx.arc(0, 0, 0.2, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, 0, 0.09, 0, Math.PI * 2);
      ctx.stroke();
      for (let i = 0; i < 3; i++) {
        const a = -Math.PI / 2 + (i * Math.PI * 2) / 3;
        ctx.beginPath();
        ctx.arc(Math.cos(a) * 0.2, Math.sin(a) * 0.2, 0.045, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    case "spokes":
      ctx.lineWidth = 0.07;
      for (let i = 0; i < 3; i++) {
        const a = -Math.PI / 2 + (i * Math.PI * 2) / 3;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(Math.cos(a) * 0.25, Math.sin(a) * 0.25);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(0, 0, 0.08, 0, Math.PI * 2);
      ctx.fill();
      break;
    case "hex": {
      ctx.lineWidth = 0.045;
      const pts: Array<[number, number]> = [];
      for (let i = 0; i < 6; i++) pts.push([Math.cos((i * Math.PI) / 3) * 0.2, Math.sin((i * Math.PI) / 3) * 0.2]);
      poly(ctx, pts);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, 0, 0.06, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
  }
  glint(ctx, -0.14, -0.17, 0.05, 0.45);
}

// ---- Gunnery's pieces

function cell(ctx: Ctx, color: number): void {
  rrect(ctx, -0.2, -0.3, 0.4, 0.6, 0.06);
  body(ctx, lit(ctx, color, -0.2, 0, 0.2, 0));
  for (const y of [-0.42, 0.28]) {
    rrect(ctx, -0.24, y, 0.48, 0.14, 0.05);
    body(ctx, lit(ctx, STEEL, -0.24, 0, 0.24, 0), 0.035);
  }
  rrect(ctx, -0.07, -0.18, 0.14, 0.36, 0.05);
  body(ctx, "#3a1a08", 0.025);
  ctx.fillStyle = "#ffd36a";
  for (let i = 0; i < 4; i++) {
    rrect(ctx, -0.045, -0.14 + i * 0.075, 0.09, 0.045, 0.015);
    ctx.fill();
  }
}

function sabotShell(ctx: Ctx, color: number): void {
  // An open split shell seen end-on: a thick C with a band, its hollow showing.
  ctx.beginPath();
  ctx.arc(0, 0, 0.38, 0.55, Math.PI * 2 - 0.55);
  ctx.arc(0, 0, 0.2, Math.PI * 2 - 0.55, 0.55, true);
  ctx.closePath();
  body(ctx, lit(ctx, color));
  ctx.beginPath();
  ctx.arc(0, 0, 0.2, 0, Math.PI * 2);
  ctx.fillStyle = "#14171d";
  ctx.fill();
  ctx.beginPath();
  ctx.arc(0, 0, 0.29, 0.6, Math.PI * 2 - 0.6);
  ctx.lineWidth = 0.07;
  ctx.strokeStyle = css(STEEL_DEEP);
  ctx.stroke();
  glint(ctx, -0.2, -0.22, 0.05, 0.5);
}

function slug(ctx: Ctx, color: number, flame = false): void {
  ctx.save();
  if (!flame) ctx.rotate(0.75);
  if (flame) {
    ctx.beginPath();
    ctx.moveTo(-0.06, 0.28);
    ctx.quadraticCurveTo(0, 0.5, 0.06, 0.28);
    ctx.fillStyle = "#ffb347";
    ctx.fill();
  }
  ctx.beginPath();
  ctx.moveTo(-0.12, 0.3);
  ctx.lineTo(-0.12, -0.08);
  ctx.quadraticCurveTo(-0.11, -0.3, 0, -0.42);
  ctx.quadraticCurveTo(0.11, -0.3, 0.12, -0.08);
  ctx.lineTo(0.12, 0.3);
  ctx.closePath();
  body(ctx, lit(ctx, color, -0.12, 0, 0.12, 0));
  rrect(ctx, -0.125, 0.1, 0.25, 0.1, 0.01);
  body(ctx, "#c0703c", 0.03);
  ctx.restore();
}

function jug(ctx: Ctx, color: number): void {
  // Handle on top, hose looping off the side, then the steel frame and the glass of coolant.
  ctx.beginPath();
  ctx.moveTo(-0.12, -0.26);
  ctx.lineTo(-0.12, -0.4);
  ctx.lineTo(0.12, -0.4);
  ctx.lineTo(0.12, -0.26);
  ctx.lineWidth = 0.1;
  ctx.strokeStyle = INK;
  ctx.stroke();
  ctx.lineWidth = 0.055;
  ctx.strokeStyle = css(STEEL);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(0.3, -0.12);
  ctx.bezierCurveTo(0.48, -0.12, 0.48, 0.16, 0.3, 0.16);
  ctx.lineWidth = 0.09;
  ctx.strokeStyle = INK;
  ctx.stroke();
  ctx.lineWidth = 0.05;
  ctx.strokeStyle = css(shade(color, -0.1));
  ctx.stroke();
  rrect(ctx, -0.32, -0.28, 0.64, 0.64, 0.08);
  body(ctx, lit(ctx, STEEL));
  rrect(ctx, -0.24, -0.2, 0.48, 0.44, 0.05);
  body(ctx, "#cfe8f2", 0.03);
  rrect(ctx, -0.24, -0.06, 0.48, 0.3, 0.05);
  ctx.fillStyle = css(color);
  ctx.fill();
  for (const [x, y, r] of [
    [-0.1, 0.08, 0.03],
    [0.05, 0.14, 0.02],
    [0.12, 0.02, 0.025],
  ] as const) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255,255,255,0.6)";
    ctx.fill();
  }
}

// ---- Space Battle

function fighter(ctx: Ctx, raider: boolean): void {
  const hull = raider ? 0xa9493a : CREAM;
  const stripe = raider ? 0x5a5d66 : 0x2f8f86;
  const glass = raider ? 0xd9a43a : 0x3f78b0;
  const flame = raider ? "#ffb347" : "#7fe9ff";
  // Thruster flames under everything.
  for (const x of [-0.1, 0.1]) {
    ctx.beginPath();
    ctx.moveTo(x - 0.05, 0.36);
    ctx.quadraticCurveTo(x, 0.5, x + 0.05, 0.36);
    ctx.fillStyle = flame;
    ctx.fill();
  }
  if (raider) {
    // A forked prow and one fuel tank slung to starboard: a different silhouette from the captain's.
    rrect(ctx, 0.22, -0.16, 0.13, 0.36, 0.06);
    body(ctx, lit(ctx, STEEL), 0.035);
    poly(ctx, [
      [-0.2, 0.36],
      [-0.24, -0.05],
      [-0.14, -0.44],
      [-0.06, -0.2],
      [0.06, -0.2],
      [0.14, -0.44],
      [0.24, -0.05],
      [0.2, 0.36],
    ]);
  } else {
    // Wide rounded nose with two side pods.
    for (const x of [-0.36, 0.24]) {
      rrect(ctx, x, -0.02, 0.12, 0.3, 0.06);
      body(ctx, lit(ctx, CREAM), 0.035);
    }
    ctx.beginPath();
    ctx.moveTo(-0.22, 0.36);
    ctx.lineTo(-0.25, 0.0);
    ctx.quadraticCurveTo(-0.2, -0.32, 0, -0.44);
    ctx.quadraticCurveTo(0.2, -0.32, 0.25, 0.0);
    ctx.lineTo(0.22, 0.36);
    ctx.closePath();
  }
  body(ctx, lit(ctx, hull));
  ctx.fillStyle = css(stripe);
  if (raider) ctx.fillRect(-0.05, -0.12, 0.1, 0.44);
  else {
    ctx.fillRect(-0.24, 0.06, 0.48, 0.07);
    ctx.fillRect(-0.04, -0.4, 0.08, 0.24);
  }
  ctx.beginPath();
  ctx.ellipse(0, -0.06, 0.085, 0.13, 0, 0, Math.PI * 2);
  body(ctx, lit(ctx, glass, -0.08, -0.18, 0.08, 0.06), 0.03);
  glint(ctx, -0.03, -0.12, 0.025, 0.7);
  for (const x of [-0.14, 0.06]) {
    rrect(ctx, x, 0.3, 0.08, 0.08, 0.02);
    body(ctx, css(STEEL_DEEP), 0.025);
  }
}

function asteroid(ctx: Ctx): void {
  const pts: Array<[number, number]> = [
    [-0.36, -0.08],
    [-0.24, -0.32],
    [0.02, -0.4],
    [0.28, -0.28],
    [0.4, -0.02],
    [0.3, 0.28],
    [0.04, 0.4],
    [-0.26, 0.32],
    [-0.4, 0.12],
  ];
  poly(ctx, pts);
  body(ctx, lit(ctx, 0x8f8a84));
  for (const [x, y, r] of [
    [-0.08, -0.08, 0.11],
    [0.18, 0.12, 0.07],
    [-0.2, 0.18, 0.05],
    [0.14, -0.2, 0.05],
  ] as const) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(40,36,34,0.45)";
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x + r * 0.2, y + r * 0.2, r * 0.8, Math.PI * 1.1, Math.PI * 1.9);
    ctx.lineWidth = 0.02;
    ctx.strokeStyle = "rgba(255,255,255,0.25)";
    ctx.stroke();
  }
}

function vortex(ctx: Ctx): void {
  const core = ctx.createRadialGradient(0, 0, 0, 0, 0, 0.44);
  core.addColorStop(0, "rgba(4,6,20,1)");
  core.addColorStop(0.35, "rgba(40,40,140,0.8)");
  core.addColorStop(1, "rgba(60,70,200,0)");
  ctx.fillStyle = core;
  ctx.beginPath();
  ctx.arc(0, 0, 0.44, 0, Math.PI * 2);
  ctx.fill();
  for (let arm = 0; arm < 4; arm++) {
    ctx.beginPath();
    for (let t = 0; t <= 1; t += 0.05) {
      const a = (arm * Math.PI) / 2 + t * Math.PI * 1.2;
      const r = 0.06 + t * 0.36;
      const x = Math.cos(a) * r;
      const y = Math.sin(a) * r;
      if (t === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.lineWidth = 0.06;
    ctx.strokeStyle = "rgba(110,120,255,0.75)";
    ctx.stroke();
    ctx.lineWidth = 0.02;
    ctx.strokeStyle = "rgba(170,230,255,0.85)";
    ctx.stroke();
  }
}

// ---- the public painters

export type PartName =
  | "cog"
  | "valve"
  | "bolt"
  | "fuse"
  | "crystal"
  | "coil"
  | "chip"
  | "zap"
  | "magnet"
  | "slag"
  | "stone"
  | "disc-trefoil"
  | "disc-rings"
  | "disc-spokes"
  | "disc-hex"
  | "cell"
  | "sabot"
  | "slug"
  | "round"
  | "coolant"
  | "fighter"
  | "raider"
  | "asteroid"
  | "well";

/** Paint `name` into the box of `size` CSS pixels centred on (cx, cy), tinted `color` where it takes one. */
export function paintPart(ctx: Ctx, name: PartName, cx: number, cy: number, size: number, color = 0xb0b8c4): void {
  unit(ctx, cx, cy, size, () => {
    switch (name) {
      case "cog":
        return cog(ctx, color);
      case "valve":
        return valve(ctx, color);
      case "bolt":
        return bolt(ctx, color);
      case "fuse":
        return fuse(ctx, color);
      case "crystal":
        return crystal(ctx, color);
      case "coil":
        return coil(ctx, color);
      case "chip":
        return chip(ctx, color);
      case "zap":
        return zap(ctx);
      case "magnet":
        return horseshoe(ctx);
      case "slag":
        return rock(ctx, true);
      case "stone":
        return rock(ctx, false);
      case "disc-trefoil":
        return disc(ctx, color, "trefoil");
      case "disc-rings":
        return disc(ctx, color, "rings");
      case "disc-spokes":
        return disc(ctx, color, "spokes");
      case "disc-hex":
        return disc(ctx, color, "hex");
      case "cell":
        return cell(ctx, color);
      case "sabot":
        return sabotShell(ctx, color);
      case "slug":
        return slug(ctx, color);
      case "round":
        return slug(ctx, color, true);
      case "coolant":
        return jug(ctx, color);
      case "fighter":
        return fighter(ctx, false);
      case "raider":
        return fighter(ctx, true);
      case "asteroid":
        return asteroid(ctx);
      case "well":
        return vortex(ctx);
    }
  });
}
