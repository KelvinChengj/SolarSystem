// 程序化天體貼圖（等距圓柱投影，經度 −180°→+180°、緯度 +90°→−90°）。
// 反照率特徵（火星暗區、月海、木星大紅斑等）依實際經緯度近似配置。

import { makeNoise3, mulberry32 } from './noise.js';

const DEG = Math.PI / 180;

export const hexRgb = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth = (e0, e1, x) => {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};
const shade = (c, k) => [c[0] * k, c[1] * k, c[2] * k];

const yieldFrame = () => new Promise((r) => setTimeout(r, 0));

/**
 * 逐像素繪製球面貼圖。fn(lon, lat, x, y, z) 回傳 [r, g, b] 或 [r, g, b, a]（0–255）。
 * 每約 12 ms 讓出主執行緒一次。
 */
export async function paintSphere(width, height, fn) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(width, height);
  const d = img.data;
  let t0 = performance.now();
  for (let j = 0; j < height; j++) {
    const lat = Math.PI / 2 - ((j + 0.5) / height) * Math.PI;
    const cl = Math.cos(lat), sl = Math.sin(lat);
    for (let i = 0; i < width; i++) {
      const lon = ((i + 0.5) / width) * 2 * Math.PI - Math.PI;
      const c = fn(lon, lat, cl * Math.cos(lon), cl * Math.sin(lon), sl, i, j);
      const k = (j * width + i) * 4;
      d[k] = c[0];
      d[k + 1] = c[1];
      d[k + 2] = c[2];
      d[k + 3] = c.length > 3 ? c[3] : 255;
    }
    if (performance.now() - t0 > 12) {
      await yieldFrame();
      t0 = performance.now();
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

/** 經緯度上的橢圓斑塊權重（含雜訊扭曲的邊緣），中心 (lon0, lat0)、半徑 (rl, rb) 皆為度。 */
function blob(lon, lat, lon0, lat0, rl, rb, warp = 0) {
  let dl = (lon / DEG - lon0);
  dl = ((dl + 540) % 360) - 180;
  dl *= Math.cos(lat);
  const db = lat / DEG - lat0;
  const r = Math.sqrt((dl / rl) ** 2 + (db / rb) ** 2) + warp;
  return 1 - smooth(0.6, 1.0, r);
}

/** 隨機隕石坑（中心經緯度、半徑度數）。 */
function makeCraters(seed, count, minR, maxR) {
  const rand = mulberry32(seed);
  const out = [];
  for (let k = 0; k < count; k++) {
    const z = rand() * 2 - 1;
    out.push({
      lon: (rand() * 360 - 180) * DEG,
      lat: Math.asin(z),
      r: minR * Math.pow(maxR / minR, Math.pow(rand(), 2.2)),
    });
  }
  return out;
}

/** 將隕石坑網格化以加速查詢。 */
function craterField(craters) {
  const cells = new Map();
  const cellDeg = 6;
  const key = (a, b) => a * 1000 + b;
  for (const c of craters) {
    const lonD = c.lon / DEG, latD = c.lat / DEG;
    const reach = c.r / Math.max(0.15, Math.cos(c.lat)) + 1;
    for (let a = Math.floor((lonD - reach) / cellDeg); a <= Math.floor((lonD + reach) / cellDeg); a++) {
      for (let b = Math.floor((latD - c.r - 1) / cellDeg); b <= Math.floor((latD + c.r + 1) / cellDeg); b++) {
        const aa = ((a % 60) + 60) % 60;
        const k = key(aa, b);
        if (!cells.has(k)) cells.set(k, []);
        cells.get(k).push(c);
      }
    }
  }
  return function sample(lon, lat) {
    const lonD = lon / DEG, latD = lat / DEG;
    const a = ((Math.floor(lonD / cellDeg) % 60) + 60) % 60;
    const b = Math.floor(latD / cellDeg);
    const list = cells.get(key(a, b));
    if (!list) return 0;
    let v = 0;
    for (const c of list) {
      let dl = lonD - c.lon / DEG;
      dl = ((dl + 540) % 360) - 180;
      dl *= Math.cos(lat);
      const db = latD - c.lat / DEG;
      const r = Math.sqrt(dl * dl + db * db) / c.r;
      if (r < 1.25) {
        // 坑底較暗、坑緣較亮
        if (r < 0.85) v -= 0.18 * (1 - r * 0.5);
        else v += 0.22 * (1 - Math.abs(r - 1.02) / 0.23);
      }
    }
    return v;
  };
}

// ───────────────────────────── 各天體配方 ─────────────────────────────

export async function mercuryTexture() {
  const { fbm } = makeNoise3(11);
  const craters = craterField(makeCraters(101, 900, 0.6, 7));
  const base = hexRgb('#8f877d'), dark = hexRgb('#5f5952'), light = hexRgb('#b8b0a4');
  return paintSphere(1024, 512, (lon, lat, x, y, z) => {
    const n = fbm(x * 3, y * 3, z * 3, 5);
    let c = n > 0 ? mix(base, light, n * 1.2) : mix(base, dark, -n * 1.4);
    c = shade(c, 1 + craters(lon, lat));
    return c;
  });
}

export async function venusTexture() {
  const { fbm } = makeNoise3(22);
  const a = hexRgb('#cfa968'), b = hexRgb('#efdcaa'), c2 = hexRgb('#e2c283');
  return paintSphere(1024, 512, (lon, lat, x, y, z) => {
    const warp = fbm(x * 2, y * 2, z * 2, 3) * 1.5;
    const band = Math.sin(lat * 7 + warp * 3 + Math.sin(lon * 2 + lat * 4) * 0.8);
    const n = fbm(x * 1.5 + warp, y * 1.5, z * 6, 5);
    const t = clamp01(0.5 + 0.35 * band + 0.5 * n);
    return mix(mix(a, b, t), c2, 0.25 * (1 - Math.abs(lat) / (Math.PI / 2)));
  });
}

export async function moonTexture() {
  const { fbm } = makeNoise3(33);
  const craters = craterField(makeCraters(303, 1400, 0.4, 6));
  const high = hexRgb('#a7a39c'), mare = hexRgb('#57554f'), highDark = hexRgb('#8a867f');
  const maria = [
    [-60, 10, 16, 22], [-50, 32, 14, 11], [-42, -2, 12, 11], [-16, 33, 16, 12], [17, 28, 9, 8],
    [31, 9, 11, 8], [59, 17, 7, 5.5], [51, -8, 8, 9], [35, -15, 5.5, 5], [-17, -21, 11, 9],
    [-39, -24, 6, 5], [0, 56, 40, 4], [4, 13, 4, 3], [-23, -10, 6, 5], [-31, 7, 7, 5],
    [147, 27, 4, 3], [-95, -20, 5, 5], [86, 3, 4, 4],
  ];
  const rays = [
    { lon: -11.4, lat: -43.3, len: 40, w: 0.35 }, // 第谷
    { lon: -20.1, lat: 9.6, len: 18, w: 0.25 }, // 哥白尼
    { lon: -38, lat: 8, len: 10, w: 0.2 }, // 克卜勒
  ];
  return paintSphere(1024, 512, (lon, lat, x, y, z) => {
    const n = fbm(x * 4, y * 4, z * 4, 5);
    let m = 0;
    const w = fbm(x * 3 + 7, y * 3, z * 3, 3) * 0.35;
    for (const [l0, b0, rl, rb] of maria) m = Math.max(m, blob(lon, lat, l0, b0, rl, rb, w));
    let c = mix(mix(high, highDark, clamp01(0.5 - n)), mare, m * 0.9);
    c = shade(c, 1 + 0.12 * n);
    let bright = 0;
    for (const r of rays) {
      let dl = lon / DEG - r.lon;
      dl = (((dl + 540) % 360) - 180) * Math.cos(lat);
      const db = lat / DEG - r.lat;
      const dist = Math.hypot(dl, db);
      if (dist < r.len) {
        const ang = Math.atan2(db, dl);
        const streak = Math.pow(Math.max(0, Math.sin(ang * 23 + r.lon) * Math.sin(ang * 11)), 6);
        bright += r.w * streak * (1 - dist / r.len) + (dist < 1.6 ? 0.5 : 0);
      }
    }
    c = mix(c, [230, 228, 222], clamp01(bright));
    return shade(c, 1 + craters(lon, lat) * (1 - m * 0.6));
  });
}

export async function marsTexture() {
  const { fbm } = makeNoise3(44);
  const craters = craterField(makeCraters(404, 500, 0.4, 4));
  const rust = hexRgb('#b8603a'), bright = hexRgb('#d99a6a'), dark = hexRgb('#5e3524');
  const darkAreas = [
    [70, 10, 12, 16, 0.8], [20, -8, 25, 6, 0.6], [0, -3, 10, 5, 0.6], [-40, -25, 25, 10, 0.55],
    [-30, 47, 18, 12, 0.6], [110, 45, 25, 12, 0.3], [105, -18, 20, 8, 0.6], [145, -25, 25, 8, 0.6],
    [-155, -32, 25, 7, 0.55], [-90, -28, 10, 6, 0.5], [-50, -15, 10, 6, 0.45], [0, -60, 180, 6, 0.3],
    [-75, -10, 18, 2.5, 0.45], [-60, -12, 12, 2.5, 0.4], [-95, -8, 8, 2, 0.35],
  ];
  const brightAreas = [[70, -42, 16, 10, 0.5], [-43, -50, 8, 6, 0.4], [147, 25, 8, 6, 0.25], [-110, 5, 22, 20, 0.2]];
  return paintSphere(1024, 512, (lon, lat, x, y, z) => {
    const n = fbm(x * 3, y * 3, z * 3, 6);
    const w = fbm(x * 2 + 3, y * 2, z * 2, 3) * 0.4;
    let dk = 0, br = 0;
    for (const [l0, b0, rl, rb, s] of darkAreas) dk = Math.max(dk, s * blob(lon, lat, l0, b0, rl, rb, w));
    for (const [l0, b0, rl, rb, s] of brightAreas) br = Math.max(br, s * blob(lon, lat, l0, b0, rl, rb, w));
    let c = mix(rust, bright, clamp01(0.45 + n * 0.9 + br));
    c = mix(c, dark, clamp01(dk * (0.75 + n)));
    // 奧林帕斯山
    const om = blob(lon, lat, -134, 18.6, 4, 4, 0);
    c = mix(c, [200, 120, 80], om * 0.6);
    c = shade(c, 1 + craters(lon, lat) * 0.7);
    // 極冠
    const latD = lat / DEG;
    const capN = smooth(76, 81, latD + n * 6);
    const capS = smooth(80, 85, -latD + n * 6);
    return mix(c, [240, 236, 230], Math.max(capN, capS));
  });
}

function bandColor(bands, latD) {
  for (let k = 0; k < bands.length; k++) {
    const [lo, hi, col] = bands[k];
    if (latD >= lo && latD < hi) {
      const next = bands[Math.min(k + 1, bands.length - 1)][2];
      const edge = smooth(hi - 1.2, hi, latD);
      return mix(col, next, edge * 0.5);
    }
  }
  return bands[bands.length - 1][2];
}

export async function jupiterTexture() {
  const { fbm } = makeNoise3(55);
  const bands = [
    [-90, -50, '#8c7f70'], [-50, -40, '#b39a7d'], [-40, -34, '#cdb898'], [-34, -27, '#a07b5e'],
    [-27, -20, '#e8d6b5'], [-20, -7, '#a4694b'], [-7, 7, '#ebdec3'], [7, 18, '#9f6448'],
    [18, 24, '#e6d3b0'], [24, 31, '#9c7458'], [31, 38, '#d2bd9c'], [38, 50, '#b09a80'], [50, 90, '#8f8171'],
  ].map(([a, b, h]) => [a, b, hexRgb(h)]);
  const grs = hexRgb('#c2623f');
  return paintSphere(2048, 1024, (lon, lat, x, y, z) => {
    const turb = fbm(x * 3, y * 3, z * 12, 4);
    const latD = lat / DEG + turb * 2.2 + Math.sin(lon * 6 + lat * 20) * 0.35;
    let c = bandColor(bands, latD);
    const streak = fbm(x * 2, y * 2, z * 40 + turb * 3, 4);
    c = shade(c, 1 + streak * 0.22);
    // 大紅斑
    const g = blob(lon, lat, 30, -22, 11, 6, turb * 0.25);
    c = mix(c, grs, g * 0.85);
    const ring = blob(lon, lat, 30, -22, 14, 8, turb * 0.2) - g;
    c = mix(c, [236, 222, 196], clamp01(ring) * 0.5);
    // 白色卵形風暴
    for (const [l0, b0] of [[-60, -33], [-20, -34], [100, -41], [160, -33]]) {
      c = mix(c, [240, 234, 222], blob(lon, lat, l0, b0, 2.4, 1.5, 0) * 0.8);
    }
    return c;
  });
}

export async function saturnTexture() {
  const { fbm } = makeNoise3(66);
  const bands = [
    [-90, -60, '#a9a07f'], [-60, -45, '#c4a574'], [-45, -30, '#cdb07a'], [-30, -20, '#e3cf98'],
    [-20, -8, '#d4b77e'], [-8, 8, '#eadba9'], [8, 20, '#d2b47b'], [20, 30, '#e1cc95'],
    [30, 45, '#caae78'], [45, 60, '#bfa272'], [60, 90, '#9fa29a'],
  ].map(([a, b, h]) => [a, b, hexRgb(h)]);
  return paintSphere(1024, 512, (lon, lat, x, y, z) => {
    const turb = fbm(x * 2, y * 2, z * 10, 3);
    const latD = lat / DEG + turb * 1.2;
    let c = bandColor(bands, latD);
    c = shade(c, 1 + fbm(x, y, z * 30, 3) * 0.12);
    return c;
  });
}

export async function uranusTexture() {
  const { fbm } = makeNoise3(77);
  const base = hexRgb('#9fd6dc'), pole = hexRgb('#bfe8ea');
  return paintSphere(512, 256, (lon, lat, x, y, z) => {
    const b = Math.sin(lat * 9) * 0.03 + fbm(x, y, z * 8, 3) * 0.04;
    return shade(mix(base, pole, smooth(40, 75, lat / DEG)), 1 + b);
  });
}

export async function neptuneTexture() {
  const { fbm } = makeNoise3(88);
  const base = hexRgb('#3f66d6'), dark = hexRgb('#2a45a8'), light = hexRgb('#6a90ee');
  return paintSphere(1024, 512, (lon, lat, x, y, z) => {
    const turb = fbm(x * 2, y * 2, z * 8, 4);
    const band = Math.sin(lat * 8 + turb * 2);
    let c = band > 0 ? mix(base, light, band * 0.35) : mix(base, dark, -band * 0.35);
    c = mix(c, hexRgb('#1d2f78'), blob(lon, lat, 0, -22, 9, 5, turb * 0.3) * 0.85);
    const streak = Math.max(0, fbm(x * 3, y * 3, z * 30, 4) - 0.25) * 2.2;
    c = mix(c, [235, 240, 255], clamp01(streak) * smooth(10, 3, Math.abs(lat / DEG + 40)));
    return c;
  });
}

export async function plutoTexture() {
  const { fbm } = makeNoise3(99);
  const base = hexRgb('#c3a585'), heart = hexRgb('#f1e7d6'), dark = hexRgb('#5a3828');
  return paintSphere(512, 256, (lon, lat, x, y, z) => {
    const n = fbm(x * 3, y * 3, z * 3, 5);
    const w = n * 0.3;
    let c = shade(base, 1 + n * 0.25);
    c = mix(c, heart, Math.max(blob(lon, lat, 165, 25, 17, 20, w), 0.85 * blob(lon, lat, -165, 15, 15, 17, w)));
    c = mix(c, dark, blob(lon, lat, 95, -10, 55, 14, w) * 0.85);
    c = mix(c, hexRgb('#d9c8ad'), smooth(55, 70, lat / DEG) * 0.6);
    return c;
  });
}

/** 地球：Natural Earth 陸地多邊形（公有領域）決定海陸，依緯度與雜訊上色。 */
export async function earthTextures(landGeo) {
  const W = 2048, H = 1024;
  const mask = document.createElement('canvas');
  mask.width = W;
  mask.height = H;
  const mctx = mask.getContext('2d');
  mctx.fillStyle = '#000';
  mctx.fillRect(0, 0, W, H);
  mctx.fillStyle = '#fff';
  const px = (lon) => ((lon + 180) / 360) * W;
  const py = (lat) => ((90 - lat) / 180) * H;
  const drawPoly = (rings) => {
    mctx.beginPath();
    for (const ring of rings) {
      ring.forEach(([lo, la], k) => (k === 0 ? mctx.moveTo(px(lo), py(la)) : mctx.lineTo(px(lo), py(la))));
      mctx.closePath();
    }
    mctx.fill('evenodd');
  };
  for (const f of landGeo.features ?? [landGeo]) {
    const g = f.geometry ?? f;
    if (g.type === 'Polygon') drawPoly(g.coordinates);
    else if (g.type === 'MultiPolygon') g.coordinates.forEach(drawPoly);
  }
  const land = mctx.getImageData(0, 0, W, H).data;
  const { fbm } = makeNoise3(2026);
  const ocean = hexRgb('#0d2f63'), oceanDeep = hexRgb('#08204a'), shallow = hexRgb('#1d5a8e');
  const forest = hexRgb('#2e5a2a'), temperate = hexRgb('#4c7038'), desert = hexRgb('#c6a46c');
  const tundra = hexRgb('#6d6a52'), ice = hexRgb('#eef3f6'), savanna = hexRgb('#8f8a4a');

  // 以模糊後的遮罩近似淺海
  const blurCanvas = document.createElement('canvas');
  blurCanvas.width = W / 4;
  blurCanvas.height = H / 4;
  const bctx = blurCanvas.getContext('2d');
  bctx.filter = 'blur(2px)';
  bctx.drawImage(mask, 0, 0, W / 4, H / 4);
  const near = bctx.getImageData(0, 0, W / 4, H / 4).data;

  const surface = await paintSphere(W, H, (lon, lat, x, y, z, i, j) => {
    const isLand = land[(j * W + i) * 4] > 127;
    const latD = lat / DEG;
    const n = fbm(x * 4, y * 4, z * 4, 5);
    if (!isLand) {
      const coast = near[((j >> 2) * (W / 4) + (i >> 2)) * 4] / 255;
      let c = mix(oceanDeep, ocean, clamp01(0.6 + n));
      c = mix(c, shallow, coast * 0.6);
      const seaIce = latD > 78 || latD < -68 ? smooth(0.1, 0.3, n + (Math.abs(latD) - 72) / 20) : 0;
      return mix(c, ice, seaIce * 0.9);
    }
    const a = Math.abs(latD);
    const arid = smooth(0.0, 0.25, n + 0.15 - Math.abs(a - 24) / 22);
    let c;
    if (a < 12) c = mix(forest, savanna, clamp01(arid * 0.8));
    else if (a < 40) c = mix(mix(savanna, temperate, clamp01((a - 30) / 10)), desert, arid);
    else if (a < 58) c = mix(temperate, forest, clamp01(n + 0.5));
    else c = mix(tundra, forest, clamp01((62 - a) / 8));
    c = shade(c, 1 + n * 0.25);
    const greenland = lon / DEG > -75 && lon / DEG < -10 && latD > 60;
    const snow = latD < -60 || greenland ? 1 : smooth(66, 74, a + n * 8);
    return mix(c, ice, snow);
  });

  const { fbm: cfbm } = makeNoise3(7);
  const clouds = await paintSphere(W, H, (lon, lat, x, y, z) => {
    const latD = lat / DEG;
    const warp = cfbm(x * 2, y * 2, z * 2, 3);
    const n = cfbm(x * 3 + warp * 1.5, y * 3 + warp, z * 5, 6);
    const belt = 0.18 * Math.exp(-(latD * latD) / 60) + 0.12 * Math.exp(-((Math.abs(latD) - 52) ** 2) / 120)
      - 0.1 * Math.exp(-((Math.abs(latD) - 25) ** 2) / 80);
    const a = smooth(0.08, 0.42, n + belt);
    return [255, 255, 255, Math.round(a * 235)];
  });
  return { surface, clouds };
}

/** 土星環徑向貼圖（內緣 74,500 km → 外緣 141,000 km）。 */
export function saturnRingTexture() {
  const W = 1024;
  const inner = 74500, outer = 141000;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = 4;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(W, 4);
  const { noise } = makeNoise3(5);
  for (let i = 0; i < W; i++) {
    const r = inner + ((outer - inner) * (i + 0.5)) / W;
    let a = 0, col = [210, 190, 150];
    if (r < 92000) { a = 0.12 + 0.08 * noise(r / 800, 0, 0); col = [150, 140, 125]; } // C 環
    else if (r < 117580) { a = 0.75 + 0.2 * noise(r / 500, 1, 0); col = [226, 208, 170]; } // B 環
    else if (r < 122170) { a = 0.06; col = [120, 110, 100]; } // 卡西尼縫
    else if (r < 136775) { a = 0.5 + 0.12 * noise(r / 400, 2, 0); col = [205, 188, 155]; } // A 環
    if (r > 133400 && r < 133750) a = 0.02; // 恩克縫
    if (Math.abs(r - 140180) < 220) { a = 0.45; col = [220, 210, 190]; } // F 環
    for (let j = 0; j < 4; j++) {
      const k = (j * W + i) * 4;
      img.data[k] = col[0];
      img.data[k + 1] = col[1];
      img.data[k + 2] = col[2];
      img.data[k + 3] = Math.round(clamp01(a) * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  return { canvas, inner, outer };
}

/** 放射狀光暈貼圖。 */
export function glowTexture(stops = [[0, 'rgba(255,240,200,1)'], [0.15, 'rgba(255,200,120,0.55)'], [0.4, 'rgba(255,150,60,0.12)'], [1, 'rgba(255,120,40,0)']]) {
  const S = 256;
  const canvas = document.createElement('canvas');
  canvas.width = S;
  canvas.height = S;
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  for (const [o, c] of stops) g.addColorStop(o, c);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  return canvas;
}

export const TEXTURE_RECIPES = {
  mercury: mercuryTexture,
  venus: venusTexture,
  moon: moonTexture,
  mars: marsTexture,
  jupiter: jupiterTexture,
  saturn: saturnTexture,
  uranus: uranusTexture,
  neptune: neptuneTexture,
  pluto: plutoTexture,
};
