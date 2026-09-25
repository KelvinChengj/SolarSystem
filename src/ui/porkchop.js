// Porkchop 發射窗口圖：出發日期 × 飛行時間的熱度圖 + 等值線，滑鼠提示與點選。
// 單一色相的順序色階：數值越低（越省 Δv）越亮，超出範圍者退回背景色。

import { fmtDate } from './format.js';

const SURFACE = '#070b14';
const INK_2 = '#a3b0c6';
const INK_3 = '#6c7a93';
const GRID = 'rgba(146, 172, 219, 0.12)';

// OKLab → sRGB（用於產生感知均勻的色階）
function oklabToRgb(L, a, b) {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ ** 3, m = m_ ** 3, s = s_ ** 3;
  const r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const bb = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
  const enc = (x) => {
    const c = Math.max(0, Math.min(1, x));
    return Math.round(255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055));
  };
  return [enc(r), enc(g), enc(bb)];
}

/** 青綠色單一色相色階：t = 0（接近背景）→ 1（最亮）。 */
export function rampColor(t) {
  const L = 0.2 + 0.72 * t;
  const C = 0.025 + 0.1 * Math.sin(Math.PI * Math.min(1, t * 0.9 + 0.1));
  const h = (186 * Math.PI) / 180;
  return oklabToRgb(L, C * Math.cos(h), C * Math.sin(h));
}

const METRICS = {
  dvTotal: { label: '總 Δv', unit: 'km/s', span: (v) => Math.max(4, v * 0.9), digits: 2 },
  c3: { label: '出發 C3', unit: 'km²/s²', span: (v) => Math.max(30, v * 2), digits: 1 },
  vinfArr: { label: '抵達 v∞', unit: 'km/s', span: (v) => Math.max(4, v * 1.5), digits: 2 },
};

function niceStep(x) {
  const p = Math.pow(10, Math.floor(Math.log10(x)));
  const m = x / p;
  return (m < 1.5 ? 1 : m < 3 ? 2 : m < 3.5 ? 2.5 : m < 7.5 ? 5 : 10) * p;
}

export class PorkchopChart {
  constructor(canvas, tooltip, { onSelect } = {}) {
    this.canvas = canvas;
    this.tooltip = tooltip;
    this.onSelect = onSelect;
    this.metric = 'dvTotal';
    this.grid = null;
    this.selection = null;
    this.hover = null;
    this.margin = { l: 56, r: 14, t: 14, b: 44 };
    canvas.addEventListener('pointermove', (e) => this.onMove(e));
    canvas.addEventListener('pointerleave', () => { this.hover = null; this.tooltip.hidden = true; this.draw(); });
    canvas.addEventListener('click', (e) => this.onClick(e));
    new ResizeObserver(() => this.draw()).observe(canvas);
  }

  setData(grid) {
    this.grid = grid;
    this.draw();
  }

  setMetric(m) {
    this.metric = m;
    this.draw();
  }

  setSelection(jdDep, tof) {
    this.selection = jdDep != null ? { jdDep, tof } : null;
    this.draw();
  }

  values() {
    return this.grid[this.metric];
  }

  domain() {
    const vals = this.values();
    let vmin = Infinity;
    for (const v of vals) if (Number.isFinite(v) && v < vmin) vmin = v;
    const span = METRICS[this.metric].span(vmin);
    return [vmin, vmin + span];
  }

  plotRect() {
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    const { l, r, t, b } = this.margin;
    return { x: l, y: t, w: Math.max(10, w - l - r), h: Math.max(10, h - t - b), W: w, H: h };
  }

  xOf(jd) {
    const g = this.grid, p = this.plotRect();
    return p.x + ((jd - g.jdStart) / (g.jdEnd - g.jdStart)) * p.w;
  }

  yOf(tof) {
    const g = this.grid, p = this.plotRect();
    return p.y + p.h - ((tof - g.tofMin) / (g.tofMax - g.tofMin)) * p.h;
  }

  draw() {
    const c = this.canvas;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = c.clientWidth, H = c.clientHeight;
    if (!W || !H) return;
    if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) {
      c.width = Math.round(W * dpr);
      c.height = Math.round(H * dpr);
    }
    const ctx = c.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = SURFACE;
    ctx.fillRect(0, 0, W, H);
    if (!this.grid) return;
    const g = this.grid;
    const p = this.plotRect();
    const vals = this.values();
    const [vmin, vmax] = this.domain();

    // 熱度圖：以 nx × ny 像素繪製後平滑放大
    const off = document.createElement('canvas');
    off.width = g.nx;
    off.height = g.ny;
    const octx = off.getContext('2d');
    const img = octx.createImageData(g.nx, g.ny);
    const bg = [7, 11, 20];
    for (let j = 0; j < g.ny; j++) {
      for (let i = 0; i < g.nx; i++) {
        const v = vals[j * g.nx + i];
        const k = ((g.ny - 1 - j) * g.nx + i) * 4;
        let col = bg;
        if (Number.isFinite(v) && v <= vmax) col = rampColor(1 - (v - vmin) / (vmax - vmin));
        else if (Number.isFinite(v)) col = [12, 20, 28];
        img.data[k] = col[0]; img.data[k + 1] = col[1]; img.data[k + 2] = col[2]; img.data[k + 3] = 255;
      }
    }
    octx.putImageData(img, 0, 0);
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    const cellW = p.w / (g.nx - 1), cellH = p.h / (g.ny - 1);
    ctx.beginPath();
    ctx.rect(p.x, p.y, p.w, p.h);
    ctx.clip();
    ctx.drawImage(off, p.x - cellW / 2, p.y - cellH / 2, p.w + cellW, p.h + cellH);

    // 等值線（marching squares）
    const step = niceStep((vmax - vmin) / 7);
    const levels = [];
    for (let L = Math.ceil(vmin / step) * step; L <= vmax + 1e-9; L += step) levels.push(L);
    const px = (i) => p.x + (i / (g.nx - 1)) * p.w;
    const py = (j) => p.y + p.h - (j / (g.ny - 1)) * p.h;
    const labels = [];
    levels.forEach((L, li) => {
      ctx.beginPath();
      let best = null;
      for (let j = 0; j < g.ny - 1; j++) {
        for (let i = 0; i < g.nx - 1; i++) {
          const a = vals[j * g.nx + i], b = vals[j * g.nx + i + 1];
          const cc = vals[(j + 1) * g.nx + i + 1], d = vals[(j + 1) * g.nx + i];
          if (!(Number.isFinite(a) && Number.isFinite(b) && Number.isFinite(cc) && Number.isFinite(d))) continue;
          const pts = [];
          const edge = (v0, v1, x0, y0, x1, y1) => {
            if ((v0 < L) !== (v1 < L)) {
              const t = (L - v0) / (v1 - v0);
              pts.push([x0 + (x1 - x0) * t, y0 + (y1 - y0) * t]);
            }
          };
          edge(a, b, px(i), py(j), px(i + 1), py(j));
          edge(b, cc, px(i + 1), py(j), px(i + 1), py(j + 1));
          edge(cc, d, px(i + 1), py(j + 1), px(i), py(j + 1));
          edge(d, a, px(i), py(j + 1), px(i), py(j));
          for (let k = 0; k + 1 < pts.length; k += 2) {
            ctx.moveTo(pts[k][0], pts[k][1]);
            ctx.lineTo(pts[k + 1][0], pts[k + 1][1]);
            if (li % 2 === 0) {
              const mx = (pts[k][0] + pts[k + 1][0]) / 2, my = (pts[k][1] + pts[k + 1][1]) / 2;
              const score = Math.abs(mx - (p.x + p.w * 0.62)) + Math.abs(my - (p.y + p.h * 0.4)) * 0.6;
              if (!best || score < best.score) best = { x: mx, y: my, score };
            }
          }
        }
      }
      ctx.strokeStyle = li === 0 ? 'rgba(236, 250, 248, 0.75)' : 'rgba(220, 236, 240, 0.32)';
      ctx.lineWidth = 1;
      ctx.stroke();
      if (best && !labels.some((q) => Math.hypot(q.x - best.x, q.y - best.y) < 34)) labels.push({ ...best, text: METRICS[this.metric].digits === 1 ? L.toFixed(0) : L.toFixed(1) });
    });
    ctx.font = '10.5px "IBM Plex Mono", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const q of labels) {
      const tw = ctx.measureText(q.text).width + 6;
      ctx.fillStyle = 'rgba(7, 11, 20, 0.8)';
      ctx.fillRect(q.x - tw / 2, q.y - 7, tw, 14);
      ctx.fillStyle = INK_2;
      ctx.fillText(q.text, q.x, q.y);
    }
    ctx.restore();

    // 座標軸
    ctx.strokeStyle = GRID;
    ctx.lineWidth = 1;
    ctx.strokeRect(p.x + 0.5, p.y + 0.5, p.w - 1, p.h - 1);
    ctx.fillStyle = INK_3;
    ctx.font = '10.5px "IBM Plex Mono", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    // x：以月份為刻度
    const months = [];
    const d0 = new Date((g.jdStart - 2440587.5) * 86400000);
    let d = new Date(Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth() + 1, 1));
    const jdOfDate = (dt) => dt.getTime() / 86400000 + 2440587.5;
    while (jdOfDate(d) <= g.jdEnd) { months.push(new Date(d)); d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)); }
    const every = Math.max(1, Math.ceil(months.length / Math.max(2, Math.floor(p.w / 70))));
    months.forEach((m, k) => {
      const x = this.xOf(jdOfDate(m));
      ctx.beginPath();
      ctx.moveTo(x + 0.5, p.y + p.h);
      ctx.lineTo(x + 0.5, p.y + p.h + (k % every === 0 ? 5 : 3));
      ctx.strokeStyle = 'rgba(146, 172, 219, 0.35)';
      ctx.stroke();
      if (k % every === 0) ctx.fillText(`${m.getUTCFullYear()}-${String(m.getUTCMonth() + 1).padStart(2, '0')}`, x, p.y + p.h + 7);
    });
    ctx.fillStyle = INK_2;
    ctx.font = '11.5px "Noto Sans TC", sans-serif';
    ctx.fillText('出發日期 (UTC)', p.x + p.w / 2, p.y + p.h + 24);
    // y：飛行時間
    const ys = niceStep((g.tofMax - g.tofMin) / 6);
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.font = '10.5px "IBM Plex Mono", monospace';
    ctx.fillStyle = INK_3;
    for (let v = Math.ceil(g.tofMin / ys) * ys; v <= g.tofMax; v += ys) {
      const y = this.yOf(v);
      ctx.fillText(String(v), p.x - 7, y);
      ctx.beginPath();
      ctx.moveTo(p.x - 4, y + 0.5);
      ctx.lineTo(p.x, y + 0.5);
      ctx.strokeStyle = 'rgba(146, 172, 219, 0.35)';
      ctx.stroke();
    }
    ctx.save();
    ctx.translate(13, p.y + p.h / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center';
    ctx.fillStyle = INK_2;
    ctx.font = '11.5px "Noto Sans TC", sans-serif';
    ctx.fillText('飛行時間（天）', 0, 0);
    ctx.restore();

    // 最佳點與目前選擇
    if (g.best) {
      const bx = this.xOf(g.best.jdDep), by = this.yOf(g.best.tofDays);
      const best = this.bestOfMetric();
      const x = best ? this.xOf(best.jdDep) : bx, y = best ? this.yOf(best.tof) : by;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(x, y, 6, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(x, y, 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.font = '11px "Noto Sans TC", sans-serif';
      ctx.textAlign = 'left';
      ctx.fillStyle = '#e6ecf6';
      ctx.fillText('最低', x + 9, y - 1);
    }
    if (this.selection) {
      const x = this.xOf(this.selection.jdDep), y = this.yOf(this.selection.tof);
      if (x >= p.x && x <= p.x + p.w && y >= p.y && y <= p.y + p.h) {
        ctx.strokeStyle = '#f3c66b';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(x - 9, y); ctx.lineTo(x - 3, y); ctx.moveTo(x + 3, y); ctx.lineTo(x + 9, y);
        ctx.moveTo(x, y - 9); ctx.lineTo(x, y - 3); ctx.moveTo(x, y + 3); ctx.lineTo(x, y + 9);
        ctx.stroke();
      }
    }
    // 滑鼠十字線
    if (this.hover) {
      ctx.strokeStyle = 'rgba(230, 236, 246, 0.35)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(this.hover.x + 0.5, p.y); ctx.lineTo(this.hover.x + 0.5, p.y + p.h);
      ctx.moveTo(p.x, this.hover.y + 0.5); ctx.lineTo(p.x + p.w, this.hover.y + 0.5);
      ctx.stroke();
    }
  }

  bestOfMetric() {
    const g = this.grid;
    const vals = this.values();
    let bi = -1, bv = Infinity;
    for (let k = 0; k < vals.length; k++) if (vals[k] < bv) { bv = vals[k]; bi = k; }
    if (bi < 0) return null;
    const i = bi % g.nx, j = Math.floor(bi / g.nx);
    return { i, j, jdDep: g.jdDep[i], tof: g.tof[j], value: bv };
  }

  /** 局部最小值（5×5 鄰域）作為「最佳方案」表格。 */
  topSolutions(n = 8) {
    const g = this.grid;
    const vals = g.dvTotal;
    const out = [];
    for (let j = 0; j < g.ny; j++) {
      for (let i = 0; i < g.nx; i++) {
        const v = vals[j * g.nx + i];
        if (!Number.isFinite(v)) continue;
        let isMin = true;
        for (let dj = -3; dj <= 3 && isMin; dj++) {
          for (let di = -3; di <= 3; di++) {
            const ii = i + di, jj = j + dj;
            if ((di || dj) && ii >= 0 && jj >= 0 && ii < g.nx && jj < g.ny && vals[jj * g.nx + ii] < v) { isMin = false; break; }
          }
        }
        if (isMin) out.push({ i, j, v });
      }
    }
    out.sort((a, b) => a.v - b.v);
    return out.slice(0, n).map((o) => ({ ...o, jdDep: g.jdDep[o.i], tof: g.tof[o.j], c3: g.c3[o.j * g.nx + o.i] }));
  }

  cellAt(e) {
    if (!this.grid) return null;
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left, y = e.clientY - rect.top;
    const p = this.plotRect();
    if (x < p.x || x > p.x + p.w || y < p.y || y > p.y + p.h) return null;
    const g = this.grid;
    const i = Math.round(((x - p.x) / p.w) * (g.nx - 1));
    const j = Math.round(((p.y + p.h - y) / p.h) * (g.ny - 1));
    return { i, j, x, y };
  }

  onMove(e) {
    const cell = this.cellAt(e);
    if (!cell) {
      this.hover = null;
      this.tooltip.hidden = true;
      this.draw();
      return;
    }
    this.hover = cell;
    this.draw();
    const g = this.grid;
    const k = cell.j * g.nx + cell.i;
    const jd = g.jdDep[cell.i], tof = g.tof[cell.j];
    const m = METRICS[this.metric];
    const val = this.values()[k];
    const tt = this.tooltip;
    tt.replaceChildren();
    const head = document.createElement('div');
    const b = document.createElement('b');
    b.textContent = Number.isFinite(val) ? val.toFixed(m.digits) : '—';
    head.append(b, document.createTextNode(` ${m.unit} ${m.label}`));
    tt.append(head);
    const rows = [
      ['出發', fmtDate(jd)],
      ['抵達', fmtDate(jd + tof)],
      ['飛行時間', `${tof.toFixed(0)} 天`],
      ['C3', `${g.c3[k]?.toFixed(1)} km²/s²`],
      ['抵達 v∞', `${g.vinfArr[k]?.toFixed(2)} km/s`],
      ['總 Δv', `${g.dvTotal[k]?.toFixed(2)} km/s`],
    ];
    for (const [a, v] of rows) {
      const r = document.createElement('div');
      r.className = 'row';
      const s1 = document.createElement('span'); s1.textContent = a;
      const s2 = document.createElement('span'); s2.textContent = v;
      r.append(s1, s2);
      tt.append(r);
    }
    tt.hidden = false;
    const cw = this.canvas.clientWidth;
    const left = cell.x + 14 + 190 > cw ? cell.x - 200 : cell.x + 14;
    tt.style.left = `${Math.max(0, left)}px`;
    tt.style.top = `${Math.max(0, cell.y - 20)}px`;
  }

  onClick(e) {
    const cell = this.cellAt(e);
    if (cell) this.onSelect?.(cell.i, cell.j);
  }

  /** 色階圖例 HTML。 */
  renderScale(el) {
    if (!this.grid) return;
    const [vmin, vmax] = this.domain();
    const m = METRICS[this.metric];
    const stops = [];
    for (let k = 0; k <= 10; k++) {
      const [r, g, b] = rampColor(1 - k / 10);
      stops.push(`rgb(${r},${g},${b}) ${k * 10}%`);
    }
    el.replaceChildren();
    const title = document.createElement('div');
    title.className = 'scale__title';
    title.textContent = `${m.label}（${m.unit}）· 越亮越省`;
    const bar = document.createElement('div');
    bar.className = 'scale__bar';
    bar.style.background = `linear-gradient(90deg, ${stops.join(',')})`;
    const ticks = document.createElement('div');
    ticks.className = 'scale__ticks';
    for (const v of [vmin, (vmin + vmax) / 2, vmax]) {
      const s = document.createElement('span');
      s.textContent = v.toFixed(m.digits === 1 ? 0 : 1);
      ticks.append(s);
    }
    el.append(title, bar, ticks);
  }
}
