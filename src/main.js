// 太陽系航道模擬器 — 介面與模擬時鐘。

import './styles.css';
import { AU_KM, BODIES, DAY_S, DEG, GM_SUN, J2000_JD, LAUNCH_SITES, RAD, TARGET_IDS } from './physics/constants.js';
import { heliocentricState, moonGeocentricState, planetElements } from './physics/ephemeris.js';
import { stateToElements } from './physics/kepler.js';
import {
  computePorkchop, defaultSearchRange, departureDeltaV, designTransfer, findBestWindow, hohmann, massRatio,
  nextHohmannWindow, phaseAngle, simulateFreeFlight, simulateMission, transferFromGrid,
} from './physics/mission.js';
import { gravityBreakdown, sphereOfInfluence } from './physics/nbody.js';
import { poleVector } from './physics/orientation.js';
import { calendarFromJd, jdFromUnixMs, parseUtcString, ttMinusUtc, ttToUTC, utcToTT } from './physics/time.js';
import { vadd, vangle, vnorm, vscale, vsub } from './physics/vec.js';
import { SolarScene } from './render/scene.js';
import { $, $$, el, fillKv } from './ui/dom.js';
import { fmt, fmtDate, fmtDateTime, fmtDays, fmtDistance, fmtDuration, fmtKm, lightTimeText } from './ui/format.js';
import { PorkchopChart } from './ui/porkchop.js';

const RATES = [
  { label: '即時 1×', s: 1 },
  { label: '1 分/秒', s: 60 },
  { label: '10 分/秒', s: 600 },
  { label: '1 時/秒', s: 3600 },
  { label: '6 時/秒', s: 21600 },
  { label: '1 天/秒', s: DAY_S },
  { label: '3 天/秒', s: 3 * DAY_S },
  { label: '10 天/秒', s: 10 * DAY_S },
  { label: '30 天/秒', s: 30 * DAY_S },
  { label: '100 天/秒', s: 100 * DAY_S },
  { label: '1 年/秒', s: 365.25 * DAY_S },
];
const RATE_INDEX = (label) => RATES.findIndex((r) => r.label === label);
const JD_MIN = 625673.5; // 西元前 3000 年
const JD_MAX = 2816787.5; // 西元 3000 年

const nowJd = () => utcToTT(jdFromUnixMs(Date.now()));
const secOf = (jd) => (jd - J2000_JD) * DAY_S;
const jdOf = (s) => J2000_JD + s / DAY_S;

const state = {
  jd: nowJd(),
  playing: true,
  reverse: false,
  rateIndex: RATE_INDEX('3 天/秒'),
  autoSlow: true,
  target: 'mars',
  arrivalMode: 'capture',
  site: 'ksc',
  transfer: null,
  mission: null,
  grid: null,
  busy: false,
  focus: 'sun',
};

// ───────────────────────────── 場景 ─────────────────────────────
const scene = new SolarScene($('#stage'), {
  onFocusChange: (id) => {
    state.focus = id;
    renderBodyList();
    renderInfo(true);
  },
});
scene.camera.position.set(0, 3.1 * AU_KM * Math.sin(40 * DEG), 3.1 * AU_KM * Math.cos(40 * DEG));

// ───────────────────────────── 通知 ─────────────────────────────
let toastTimer = 0;
function toast(msg, ms = 3200) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('is-on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('is-on'), ms);
}

// ───────────────────────────── 時間控制 ─────────────────────────────
const rateSelect = $('#rate-select');
RATES.forEach((r, i) => rateSelect.append(el('option', { value: i }, r.label)));
function setRate(i) {
  state.rateIndex = Math.max(0, Math.min(RATES.length - 1, i));
  rateSelect.value = String(state.rateIndex);
}
setRate(state.rateIndex);
rateSelect.addEventListener('change', () => setRate(+rateSelect.value));

function setPlaying(p) {
  state.playing = p;
  $('#btn-play').classList.toggle('is-paused', !p);
  $('#btn-play').title = p ? '暫停' : '播放';
}
$('#btn-play').addEventListener('click', () => setPlaying(!state.playing));
$('#btn-reverse').addEventListener('click', () => {
  state.reverse = !state.reverse;
  $('#btn-reverse').setAttribute('aria-pressed', String(state.reverse));
  toast(state.reverse ? '時間倒轉播放' : '時間正向播放', 1500);
});
$('#btn-now').addEventListener('click', () => { jumpTo(nowJd()); toast('已回到目前真實時間', 1500); });
$('#jump-input').addEventListener('change', (e) => {
  const jd = parseUtcString(e.target.value);
  if (jd) jumpTo(utcToTT(jd));
});
function jumpTo(jd) {
  state.jd = Math.max(JD_MIN, Math.min(JD_MAX, jd));
  lastEventCheck = state.jd;
  $('#jump-input').value = fmtDateTimeLocal(state.jd);
}
function fmtDateTimeLocal(jdTT) {
  const c = calendarFromJd(ttToUTC(jdTT));
  if (c.year < 1 || c.year > 9999) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${String(c.year).padStart(4, '0')}-${p(c.month)}-${p(c.day)}T${p(c.hour)}:${p(c.minute)}`;
}

function updateClock() {
  const utc = ttToUTC(state.jd);
  const c = calendarFromJd(utc);
  // 天文年號：0 年 = 西元前 1 年
  const y = c.year <= 0 ? `前${1 - c.year}` : String(c.year).padStart(4, '0');
  $('#clock-date').textContent = `${y}-${String(c.month).padStart(2, '0')}-${String(c.day).padStart(2, '0')}`;
  $('#clock-time').textContent = `${String(c.hour).padStart(2, '0')}:${String(c.minute).padStart(2, '0')}:${String(Math.floor(c.second)).padStart(2, '0')}`;
  $('#clock-jd').textContent = `JD ${state.jd.toFixed(5)} TT`;
  $('#clock-dt').textContent = `TT−UTC ${ttMinusUtc(utc).toFixed(1)} s`;
}

// ───────────────────────────── 顯示選項 ─────────────────────────────
const OPTION_KEY = 'solar-sim-options-v1';
function loadOptions() {
  try { return JSON.parse(localStorage.getItem(OPTION_KEY) || '{}'); } catch { return {}; }
}
function saveOptions() {
  try {
    localStorage.setItem(OPTION_KEY, JSON.stringify({ ...scene.options, autoSlow: state.autoSlow }));
  } catch { /* 瀏覽器可能封鎖儲存 */ }
}
const saved = loadOptions();
for (const [id, key] of [['#opt-orbits', 'orbits'], ['#opt-labels', 'labels'], ['#opt-grid', 'grid'], ['#opt-soi', 'soi'], ['#opt-velocity', 'velocity']]) {
  const input = $(id);
  if (key in saved) input.checked = !!saved[key];
  scene.setOption(key, input.checked);
  input.addEventListener('change', () => { scene.setOption(key, input.checked); saveOptions(); });
}
if ('autoSlow' in saved) $('#opt-autoslow').checked = !!saved.autoSlow;
state.autoSlow = $('#opt-autoslow').checked;
$('#opt-autoslow').addEventListener('change', (e) => { state.autoSlow = e.target.checked; saveOptions(); });
const minpx = $('#opt-minpx');
if (saved.minPx) minpx.value = saved.minPx;
const applyMinPx = () => {
  scene.setOption('minPx', +minpx.value);
  $('#opt-minpx-out').textContent = `${minpx.value} px`;
};
applyMinPx();
minpx.addEventListener('input', () => { applyMinPx(); saveOptions(); });
$('#opt-frame').addEventListener('change', (e) => scene.setOption('trailFrame', e.target.value));

// ───────────────────────────── 天體清單與資訊 ─────────────────────────────
const LIST_IDS = ['sun', 'mercury', 'venus', 'earth', 'moon', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune', 'pluto'];
function renderBodyList() {
  const ul = $('#body-list');
  ul.replaceChildren();
  const ids = state.mission ? [...LIST_IDS, 'spacecraft'] : LIST_IDS;
  for (const id of ids) {
    const b = BODIES[id];
    const name = id === 'spacecraft' ? '太空船' : b.name;
    const color = id === 'spacecraft' ? '#ff7ac6' : b.color;
    const btn = el('button', { type: 'button', class: id === state.focus ? 'is-focus' : '', dataset: { id }, onclick: () => scene.setFocus(id) },
      el('span', { class: 'dot', style: { '--dot': color } }),
      el('span', { class: 'name' }, name),
      el('span', { class: 'meta', 'data-meta': id }, ''));
    btn.querySelector('.dot').style.setProperty('--dot', color);
    ul.append(el('li', {}, btn));
  }
  updateBodyMeta();
}
function updateBodyMeta() {
  for (const node of $$('[data-meta]')) {
    const id = node.dataset.meta;
    if (id === 'sun') node.textContent = '';
    else if (id === 'moon') node.textContent = `${fmt.n0(vnorm(moonGeocentricState(state.jd).r) / 1000)} 千km`;
    else if (id === 'spacecraft') {
      const s = scene.shipState;
      node.textContent = s ? `${(vnorm(s.r) / AU_KM).toFixed(3)} AU` : '未升空';
    } else node.textContent = `${(vnorm(scene.pos[id] ?? heliocentricState(id, state.jd).r) / AU_KM).toFixed(3)} AU`;
  }
}

const TYPE_NAME = { star: '恆星', planet: '行星', dwarf: '矮行星', moon: '衛星' };
const MOON_PHASES = ['新月', '眉月', '上弦月', '盈凸月', '滿月', '虧凸月', '下弦月', '殘月'];

function renderInfo(force = false) {
  const id = state.focus;
  const title = $('#info-title');
  const dl = $('#info-list');
  if (id === 'spacecraft') {
    title.textContent = '太空船狀態';
    const s = scene.shipState;
    if (!s) { fillKv(dl, [['狀態', '尚未升空']]); return; }
    const rows = [['日心距離', fmtDistance(vnorm(s.r))], ['日心速度', `${fmt.n3(vnorm(s.v))} km/s`]];
    const central = s.central ?? null;
    if (central) {
      const cs = heliocentricState(central, state.jd);
      const rr = vsub(s.r, cs.r), vv = vsub(s.v, cs.v);
      const el2 = stateToElements(rr, vv, BODIES[central].gm);
      rows.push(null, [`相對${BODIES[central].name}高度`, fmtKm(Math.max(0, vnorm(rr) - BODIES[central].eqRadius))], ['相對速度', `${fmt.n3(vnorm(vv))} km/s`],
        ['軌道離心率', fmt.n3(el2.e)], ['軌道傾角', `${fmt.n1(el2.i * RAD)}°`, '（黃道）']);
      if (el2.e < 1) rows.push(['軌道週期', fmtDuration(el2.period, false)]);
    } else {
      const o = stateToElements(s.r, s.v, GM_SUN);
      rows.push(null, ['日心軌道 近日點', `${fmt.n3(o.rp / AU_KM)} AU`], ['遠日點', o.e < 1 ? `${fmt.n3(o.ra / AU_KM)} AU` : '∞（雙曲線）'], ['離心率', fmt.n3(o.e)],
        ['比能量', `${fmt.n2(o.energy)} km²/s²`, o.energy > 0 ? '可脫離太陽系' : '受太陽束縛']);
    }
    fillKv(dl, rows);
    return;
  }
  const b = BODIES[id];
  title.textContent = `${b.name} ${b.en}`;
  const R = b.eqRadius;
  const g = (b.gm / (R * R)) * 1000;
  const vesc = Math.sqrt((2 * b.gm) / R);
  const rows = [
    ['類型', TYPE_NAME[b.type]],
    ['赤道半徑', `${fmt.n0(R)} km`],
    ['表面重力', `${fmt.n2(g)} m/s²`, `（${fmt.n2(g / 9.80665)} g）`],
    ['逃逸速度', `${fmt.n2(vesc)} km/s`],
    ['GM', `${b.gm.toExponential(4)} km³/s²`],
  ];
  const period = Math.abs(360 / b.pole.wd) * 24;
  rows.push(['自轉週期', period > 48 ? `${fmt.n1(period / 24)} 天` : `${fmt.n2(period)} 小時`, b.pole.wd < 0 ? '逆行' : '']);
  if (id === 'sun') {
    rows.push(null, ['距地球', fmtDistance(vnorm(scene.pos.earth))], ['光抵達地球', lightTimeText(vnorm(scene.pos.earth))]);
    fillKv(dl, rows);
    return;
  }
  if (id === 'moon') {
    const ms = moonGeocentricState(state.jd);
    const sunDir = vscale(scene.pos.earth, -1);
    const elong = vangle(ms.r, sunDir);
    const phaseAng = Math.PI - elong;
    const illum = (1 + Math.cos(phaseAng)) / 2;
    // 盈虧：月球黃經 − 太陽黃經
    const dLon = ((Math.atan2(ms.r[1], ms.r[0]) - Math.atan2(sunDir[1], sunDir[0])) * RAD + 360) % 360;
    const phaseName = MOON_PHASES[Math.round(dLon / 45) % 8];
    const o = stateToElements(ms.r, ms.v, BODIES.earth.gm + b.gm);
    rows.push(null, ['距地球', fmtKm(vnorm(ms.r))], ['相對地球速度', `${fmt.n3(vnorm(ms.v))} km/s`], ['月相', `${phaseName}`, `照亮 ${fmt.n0(illum * 100)}%`],
      ['軌道離心率', fmt.n3(o.e)], ['恆星月週期', `${fmt.n2(o.period / DAY_S)} 天`], ['影響球半徑', fmtKm(sphereOfInfluence('moon'))]);
    fillKv(dl, rows);
    return;
  }
  const st = heliocentricState(id, state.jd);
  const el0 = planetElements(id, state.jd);
  const r = vnorm(st.r);
  const v = vnorm(st.v);
  const vVisViva = Math.sqrt(GM_SUN * (2 / r - 1 / el0.a));
  const pole = poleVector(id, state.jd);
  const P = (2 * Math.PI * Math.sqrt(el0.a ** 3 / GM_SUN)) / DAY_S;
  const nrm = (() => {
    const h = [st.r[1] * st.v[2] - st.r[2] * st.v[1], st.r[2] * st.v[0] - st.r[0] * st.v[2], st.r[0] * st.v[1] - st.r[1] * st.v[0]];
    return vscale(h, 1 / vnorm(h));
  })();
  const obliq = vangle(pole, nrm) * RAD;
  rows.push(['自轉軸傾角', `${fmt.n1(obliq)}°`]);
  rows.push(null, ['日心距離', `${(r / AU_KM).toFixed(4)} AU`], ['公轉速度', `${fmt.n3(v)} km/s`], ['活力公式預測', `${fmt.n3(vVisViva)} km/s`, 'v² = μ(2/r − 1/a)']);
  if (id !== 'earth') {
    const d = vnorm(vsub(st.r, scene.pos.earth));
    rows.push(['距地球', fmtDistance(d)], ['光行時間', lightTimeText(d)]);
  }
  rows.push(null, ['半長軸 a', `${(el0.a / AU_KM).toFixed(4)} AU`], ['離心率 e', el0.e.toFixed(5)], ['軌道傾角 i', `${fmt.n3(el0.i * RAD)}°`],
    ['公轉週期', P > 730 ? `${fmt.n2(P / 365.25)} 年` : `${fmt.n1(P)} 天`], ['近日點 / 遠日點', `${(el0.a * (1 - el0.e) / AU_KM).toFixed(3)} / ${(el0.a * (1 + el0.e) / AU_KM).toFixed(3)} AU`],
    ['影響球半徑', fmtKm(sphereOfInfluence(id))]);
  fillKv(dl, rows);
}

// ───────────────────────────── 任務規劃 ─────────────────────────────
const targetSel = $('#m-target');
for (const id of TARGET_IDS) targetSel.append(el('option', { value: id }, `${BODIES[id].name} ${BODIES[id].en}`));
targetSel.value = state.target;
const siteSel = $('#m-site');
for (const [k, s] of Object.entries(LAUNCH_SITES)) siteSel.append(el('option', { value: k }, `${s.name} · 北緯 ${s.lat.toFixed(1)}°`));
siteSel.value = state.site;
siteSel.addEventListener('change', () => { state.site = siteSel.value; });

const depInput = $('#m-dep');
const tofInput = $('#m-tof');
const tofRange = $('#m-tof-range');
const parkInput = $('#m-park');
const arrAltInput = $('#m-arrive-alt');
const captureSel = $('#m-capture');
const GIANTS = ['jupiter', 'saturn', 'uranus', 'neptune'];

function setTarget(id, { keepDates = false } = {}) {
  state.target = id;
  targetSel.value = id;
  arrAltInput.value = BODIES[id].parkingAlt;
  // 巨行星的低圓軌道捕獲 Δv 極大，實際任務（如朱諾號）採大橢圓軌道
  captureSel.value = GIANTS.includes(id) ? '0.25' : '0';
  const r = defaultSearchRange(id, state.jd);
  tofRange.min = r.tofMin;
  tofRange.max = r.tofMax;
  if (!keepDates) {
    const h = hohmann('earth', id, state.jd);
    tofInput.value = Math.round(h.tofDays);
  }
  tofRange.value = tofInput.value;
}

$$('.seg__btn[data-mode]').forEach((b) => b.addEventListener('click', () => {
  state.arrivalMode = b.dataset.mode;
  $$('.seg__btn[data-mode]').forEach((x) => {
    x.classList.toggle('is-on', x === b);
    x.setAttribute('aria-checked', String(x === b));
  });
  captureSel.disabled = state.arrivalMode !== 'capture';
  replan();
}));

function readPlanInputs() {
  const jdDep = parseUtcString(depInput.value);
  return {
    to: state.target,
    jdDep: jdDep ? utcToTT(jdDep) : state.jd,
    tofDays: Math.max(5, +tofInput.value || 200),
    parkingAlt: Math.max(150, +parkInput.value || 200),
    arrivalAlt: Math.max(10, +arrAltInput.value || BODIES[state.target].parkingAlt),
    arrivalMode: state.arrivalMode,
    captureApo: +captureSel.value || 0,
  };
}

function setPlanInputs(t) {
  depInput.value = fmtDate(t.jdDep);
  tofInput.value = Math.round(t.tofDays);
  tofRange.value = tofInput.value;
}

/** 依目前輸入重新求解 Lambert 轉移。 */
function replan() {
  const p = readPlanInputs();
  const t = designTransfer(p);
  state.transfer = t;
  scene.setPlannedTransfer(t);
  if (porkchop.grid && porkchop.grid.to === p.to) porkchop.setSelection(p.jdDep, p.tofDays);
  renderTransfer();
}

targetSel.addEventListener('change', async () => {
  setTarget(targetSel.value);
  await searchBest();
});
for (const inp of [depInput, tofInput, parkInput, arrAltInput, captureSel]) inp.addEventListener('change', replan);
tofRange.addEventListener('input', () => { tofInput.value = tofRange.value; replan(); });

function stat(label, value, unit, cls = '') {
  return el('div', { class: `stat ${cls}` }, el('span', { class: 'stat__label' }, label), el('span', { class: 'stat__value' }, value), el('span', { class: 'stat__unit' }, unit));
}

function renderTransfer() {
  const t = state.transfer;
  const sum = $('#transfer-summary');
  const list = $('#transfer-list');
  if (!t) {
    sum.replaceChildren();
    fillKv(list, [['結果', '無法求解（請調整日期或飛行時間）']]);
    return;
  }
  const to = BODIES[t.to];
  sum.replaceChildren(
    stat('飛行時間', fmt.n0(t.tofDays), `天 · ${fmt.n1(t.tofDays / 30.44)} 個月`, 'stat--plan'),
    stat('總 Δv', fmt.n2(t.dvTotal), 'km/s'),
    stat('出發 C3', fmt.n1(t.c3), 'km²/s²'),
  );
  const mr1 = massRatio(t.dvDep, 450);
  const mr2 = massRatio(t.dvArr, 320);
  const rows = [
    ['出發', fmtDateTime(t.jdDep)],
    ['抵達', fmtDateTime(t.jdArr)],
    ['轉移類型', `Type ${t.type} · 轉移角 ${fmt.n1(t.transferAngle)}°`],
    null,
    ['出發 v∞', `${fmt.n3(t.vinfDep)} km/s`],
    ['DLA / RLA', `${fmt.n1(t.dla)}° / ${fmt.n1(t.rla)}°`],
    ['逃逸點火 Δv', `${fmt.n3(t.dvDep)} km/s`, `LEO ${t.parkingAlt} km`],
    ['抵達 v∞', `${fmt.n3(t.vinfArr)} km/s`],
    [t.arrivalMode === 'capture' ? '捕獲 Δv' : '捕獲 Δv（飛掠不需）', `${fmt.n3(t.dvArr)} km/s`, t.arrivalMode !== 'capture' ? ''
      : t.captureRa > t.captureRp * 1.01 ? `橢圓 ${fmtKm(t.arrivalAlt)} × ${fmtKm(t.captureRa - to.eqRadius)}` : `${fmt.n0(t.arrivalAlt)} km 圓軌道`],
    null,
    ['轉移軌道 近日點', `${fmt.n3(t.orbit.rp / AU_KM)} AU`],
    ['轉移軌道 遠日點', t.orbit.e < 1 ? `${fmt.n3(t.orbit.ra / AU_KM)} AU` : '∞'],
    ['離心率 / 傾角', `${fmt.n3(t.orbit.e)} / ${fmt.n2(t.orbit.i * RAD)}°`],
    null,
    ['質量比 (Isp 450 s)', `${fmt.n2(mr1)}`, `推進劑 ${fmt.n0((1 - 1 / mr1) * 100)}%`],
    ['捕獲質量比 (Isp 320 s)', t.arrivalMode === 'capture' ? `${fmt.n2(mr2)}` : '—'],
    ['LEO 質量抵達比例', `${fmt.n1((100 / mr1) / (t.arrivalMode === 'capture' ? mr2 : 1))}%`, `至${to.name}`],
  ];
  fillKv(list, rows);
  // Hohmann 比較
  const h = hohmann('earth', t.to, t.jdDep, { captureApo: t.arrivalMode === 'capture' ? t.captureApo : 0 });
  const phaseNow = phaseAngle('earth', t.to, t.jdDep) * RAD;
  const nw = nextHohmannWindow('earth', t.to, state.jd);
  fillKv($('#hohmann-list'), [
    ['理想飛行時間', fmtDays(h.tofDays)],
    ['理想總 Δv', `${fmt.n3(h.dvTotal)} km/s`],
    ['理想 C3', `${fmt.n2(h.c3)} km²/s²`],
    ['所需相位角', `${fmt.n1(h.phaseDeg)}°`, h.phaseDeg >= 0 ? '目標領先地球' : '目標落後地球'],
    ['出發日相位角', `${fmt.n1(phaseNow)}°`],
    ['會合週期', fmtDays(h.synodicDays)],
    ['下一次相位吻合', nw ? fmtDate(nw) : '—', '（圓軌道估計）'],
  ]);
}

async function searchBest() {
  if (state.busy) return;
  state.busy = true;
  const btn = $('#btn-best');
  btn.disabled = true;
  $('#m-status').textContent = '正在掃描發射窗口…';
  try {
    const p = readPlanInputs();
    const range = defaultSearchRange(p.to, state.jd);
    const res = await findBestWindow({ ...p, ...range, from: 'earth' });
    if (res?.transfer) {
      setPlanInputs(res.transfer);
      state.grid = res.grid;
      replan();
      $('#m-status').textContent = `最佳窗口：${fmtDate(res.transfer.jdDep)} 出發，飛行 ${fmt.n0(res.transfer.tofDays)} 天，總 Δv ${fmt.n2(res.transfer.dvTotal)} km/s。`;
      if (!$('#porkchop').hidden) openPorkchop(false);
    }
  } finally {
    state.busy = false;
    btn.disabled = false;
  }
}
$('#btn-best').addEventListener('click', searchBest);

// ───────────────────────────── Porkchop ─────────────────────────────
const porkchop = new PorkchopChart($('#pc-canvas'), $('#pc-tooltip'), {
  onSelect: (i, j) => {
    const g = porkchop.grid;
    const t = transferFromGrid(g, i, j);
    if (!t) return;
    setPlanInputs(t);
    replan();
    toast(`已選擇：${fmtDate(t.jdDep)} 出發，飛行 ${fmt.n0(t.tofDays)} 天`);
  },
});
$$('.seg__btn[data-metric]').forEach((b) => b.addEventListener('click', () => {
  $$('.seg__btn[data-metric]').forEach((x) => { x.classList.toggle('is-on', x === b); x.setAttribute('aria-checked', String(x === b)); });
  porkchop.setMetric(b.dataset.metric);
  porkchop.renderScale($('#pc-scale'));
}));

let pcAbort = null;
async function computeGrid(range) {
  pcAbort?.abort();
  const ctrl = new AbortController();
  pcAbort = ctrl;
  const prog = $('#pc-progress');
  prog.hidden = false;
  const p = readPlanInputs();
  const grid = await computePorkchop({
    ...p, from: 'earth', ...range, nx: 140, ny: 100, signal: ctrl.signal,
    onProgress: (f) => {
      prog.querySelector('.progress__bar').style.width = `${f * 100}%`;
      prog.querySelector('.progress__text').textContent = `計算中… ${Math.round(f * 100)}%（${140 * 100} 次 Lambert 求解）`;
    },
  });
  prog.hidden = true;
  if (!grid) return;
  state.grid = grid;
  showGrid(grid);
}

function showGrid(grid) {
  porkchop.setData(grid);
  porkchop.renderScale($('#pc-scale'));
  const t = readPlanInputs();
  porkchop.setSelection(t.jdDep, t.tofDays);
  $('#pc-title').textContent = `發射窗口圖 · 地球 → ${BODIES[grid.to].name}`;
  $('#pc-start').value = fmtDate(grid.jdStart);
  $('#pc-end').value = fmtDate(grid.jdEnd);
  $('#pc-tofmin').value = Math.round(grid.tofMin);
  $('#pc-tofmax').value = Math.round(grid.tofMax);
  const tbody = $('#pc-best tbody');
  tbody.replaceChildren();
  for (const s of porkchop.topSolutions(8)) {
    const tr = el('tr', { tabindex: 0, onclick: () => porkchop.onSelect(s.i, s.j), onkeydown: (e) => { if (e.key === 'Enter') porkchop.onSelect(s.i, s.j); } },
      el('td', {}, fmtDate(s.jdDep)), el('td', {}, `${fmt.n0(s.tof)} 天`), el('td', {}, fmt.n1(s.c3)), el('td', {}, fmt.n2(s.v)));
    tbody.append(tr);
  }
}

async function openPorkchop(recompute = true) {
  const box = $('#porkchop');
  box.hidden = false;
  box.classList.add('is-open');
  setSheet('porkchop');
  const p = readPlanInputs();
  const need = recompute && (!state.grid || state.grid.to !== p.to || state.grid.arrivalMode !== p.arrivalMode);
  if (need) {
    const r = defaultSearchRange(p.to, state.jd);
    await computeGrid(r);
  } else if (state.grid) {
    showGrid(state.grid);
  }
}
function closePorkchop() {
  const box = $('#porkchop');
  box.hidden = true;
  box.classList.remove('is-open');
  pcAbort?.abort();
  if (currentSheet === 'porkchop') setSheet('mission');
}
$('#btn-pork').addEventListener('click', () => openPorkchop(true));
$('#pc-close').addEventListener('click', closePorkchop);
$('#pc-recalc').addEventListener('click', () => {
  const s = parseUtcString($('#pc-start').value), e = parseUtcString($('#pc-end').value);
  const tmin = +$('#pc-tofmin').value, tmax = +$('#pc-tofmax').value;
  if (!s || !e || !(e > s) || !(tmax > tmin) || tmin < 5) { toast('範圍不正確：結束須晚於開始，飛行時間下限至少 5 天'); return; }
  computeGrid({ jdStart: utcToTT(s), jdEnd: utcToTT(e), tofMin: tmin, tofMax: tmax });
});

// ───────────────────────────── 發射與 N 體模擬 ─────────────────────────────
const STATUS_TEXT = {
  captured: ['成功進入環繞軌道', 'good'],
  flyby: ['飛掠完成', 'good'],
  impact: ['撞擊天體', 'bad'],
  missed: ['未進入目標影響球', 'warn'],
  coast: ['自由飛行中', 'good'],
};
const STAGE_TEXT = { targeting: 'N 體打靶修正中', refining: 'B 平面精修中', propagating: '完整 N 體積分中', done: '完成' };

async function launch() {
  if (state.busy || !state.transfer) return;
  state.busy = true;
  const btn = $('#btn-launch');
  btn.disabled = true;
  const prog = $('#launch-progress');
  prog.hidden = false;
  const bar = prog.querySelector('.progress__bar');
  const txt = prog.querySelector('.progress__text');
  try {
    const plan = designTransfer(readPlanInputs());
    const m = await simulateMission(plan, {
      siteKey: state.site,
      onProgress: (stage, f) => { bar.style.width = `${Math.min(100, f * 100)}%`; txt.textContent = `${STAGE_TEXT[stage] ?? stage}…`; },
    });
    if (!m) return;
    setMission(m);
    // 跳到升空前 2 分鐘，以慢速觀看發射
    jumpTo(jdOf(m.tLiftoff - 120));
    setRate(RATE_INDEX('1 分/秒'));
    setPlaying(true);
    scene.setFocus('spacecraft');
    toast(`已排定：${fmtDateTime(jdOf(m.tLiftoff))} 自${m.site.name}升空`);
  } finally {
    prog.hidden = true;
    btn.disabled = false;
    state.busy = false;
  }
}
$('#btn-launch').addEventListener('click', launch);

function setMission(m) {
  state.mission = m;
  scene.setMission(m);
  $('#telemetry').hidden = !m;
  requestAnimationFrame(() => updateInsets());
  renderBodyList();
  renderMission();
  lastEventCheck = state.jd;
}

function renderMission() {
  const m = state.mission;
  const isFree = m?.kind === 'free';
  $('#mission-block').hidden = !m || isFree;
  if (!m) return;
  if (isFree) { renderFreeResult(m); return; }
  const [label, kind] = STATUS_TEXT[m.status] ?? [m.status, 'warn'];
  const chip = $('#mission-status');
  chip.textContent = label;
  chip.dataset.kind = kind;
  const tg = m.targeting;
  const to = BODIES[m.plan.to];
  const rows = [
    ['升空', fmtDateTime(jdOf(m.tLiftoff))],
    ['發射場', m.site.name],
    ['停泊軌道傾角', `${fmt.n2(m.geom.inclination * RAD)}°`, `DLA ${fmt.n1(m.geom.dla * RAD)}°`],
    ['逃逸點火', fmtDateTime(jdOf(m.tTMI))],
    ['逃逸點火 Δv', `${fmt.n3(m.dvTMI)} km/s`],
    null,
    ['未修正時的偏差', fmtKm(tg.uncorrectedMiss), '（純圓錐曲線拼接）'],
    ['修正量', `${fmt.n2(tg.dvCorrection)} m/s`, `${tg.iterations}+${tg.refineIterations} 次迭代`],
    ['瞄準誤差', `${fmt.n2(tg.finalAimError)} km`],
  ];
  const arrT = m.capture?.t ?? m.flyby?.t ?? m.impact?.t;
  if (m.capture) {
    const c = m.capture;
    rows.push(null, ['抵達（近拱點）', fmtDateTime(jdOf(c.t))], ['近拱點高度', `${fmt.n1(c.altitude)} km`], ['抵達 v∞', `${fmt.n3(c.vinf)} km/s`],
      ['捕獲 Δv', `${fmt.n3(c.dv)} km/s`]);
    if (c.eccentricity > 0.01) rows.push(['遠拱點高度', fmtKm(c.apoAltitude)], ['軌道離心率', fmt.n3(c.eccentricity)]);
    rows.push(['環繞軌道週期', c.period > 2 * DAY_S ? fmtDays(c.period / DAY_S) : fmtDuration(c.period, false)], ['軌道傾角', `${fmt.n1(c.inclination)}°`, `相對${to.name}赤道`]);
  } else if (m.flyby) {
    const f = m.flyby;
    rows.push(null, ['最接近時刻', fmtDateTime(jdOf(f.t))], ['飛掠高度', `${fmt.n0(f.altitude)} km`], ['v∞', `${fmt.n3(f.vinf)} km/s`], ['偏轉角', `${fmt.n1(f.turnAngle)}°`]);
    if (f.vHelioIn != null) {
      rows.push(['日心速度變化', `${fmt.n2(f.vHelioIn)} → ${fmt.n2(f.vHelioOut)} km/s`], ['重力助推 Δv', `${fmt.n3(f.dvGravityAssist)} km/s`],
        ['飛掠後軌道', f.orbitAfter.e < 1 ? `近 ${fmt.n2(f.orbitAfter.rp / AU_KM)} / 遠 ${fmt.n2(f.orbitAfter.ra / AU_KM)} AU` : '雙曲線：將脫離太陽系']);
    }
  } else if (m.impact) {
    rows.push(null, ['撞擊時刻', fmtDateTime(jdOf(m.impact.t))], ['撞擊天體', BODIES[m.impact.id].name]);
  }
  if (arrT) rows.push(null, ['總飛行時間', fmtDays((arrT - m.tLiftoff) / DAY_S), `${fmt.n1((arrT - m.tLiftoff) / DAY_S / 30.44)} 個月`]);
  rows.push(['任務總 Δv', `${fmt.n3(m.dvTotal)} km/s`]);
  fillKv($('#mission-list'), rows);
  renderTimeline($('#mission-timeline'), m);
}

function renderTimeline(ol, m) {
  ol.replaceChildren();
  const now = secOf(state.jd);
  for (const ev of m.events) {
    const li = el('li', { class: ev.t <= now ? 'is-past' : '' },
      el('button', { type: 'button', onclick: () => gotoEvent(ev) },
        el('span', { class: 'tl-dot' }),
        el('span', { class: 'tl-time' }, `${fmtDateTime(jdOf(ev.t))} · T${fmtDuration(ev.t - m.tLiftoff)}`),
        el('span', { class: 'tl-label' }, ev.label)));
    li.dataset.t = ev.t;
    ol.append(li);
  }
}

function gotoEvent(ev) {
  const lead = { liftoff: 60, parking: 60, tmi: 300, capture: 900, flyby: 1800, impact: 900, approach: 3 * 3600, 'soi-in': 3 * 3600, 'soi-out': 3 * 3600 }[ev.key] ?? 600;
  jumpTo(jdOf(ev.t - lead));
  const slow = { liftoff: '即時 1×', parking: '1 分/秒', tmi: '1 分/秒', capture: '1 分/秒', flyby: '10 分/秒', impact: '1 分/秒' }[ev.key] ?? '1 時/秒';
  setRate(RATE_INDEX(slow));
  setPlaying(true);
  scene.setFocus('spacecraft');
}

$('#btn-goto-launch').addEventListener('click', () => state.mission && gotoEvent(state.mission.events[0]));
$('#btn-goto-arrive').addEventListener('click', () => {
  const m = state.mission;
  if (!m) return;
  const ev = m.events.find((e) => ['capture', 'flyby', 'impact'].includes(e.key)) ?? m.events[m.events.length - 1];
  gotoEvent(ev);
});
$('#btn-follow').addEventListener('click', () => scene.setFocus('spacecraft'));

// 事件通知與自動減速
let lastEventCheck = state.jd;
function checkEvents() {
  const m = state.mission;
  const a = lastEventCheck, b = state.jd;
  lastEventCheck = b;
  if (!m || a === b) return;
  const lo = Math.min(a, b), hi = Math.max(a, b);
  for (const ev of m.events) {
    const jd = jdOf(ev.t);
    if (jd > lo && jd <= hi) {
      toast(ev.label);
      if (state.autoSlow && b > a) {
        const slow = { liftoff: '即時 1×', tmi: '1 分/秒', 'soi-in': '1 時/秒', capture: '1 分/秒', flyby: '10 分/秒', impact: '1 分/秒' }[ev.key];
        if (slow && RATE_INDEX(slow) < state.rateIndex) setRate(RATE_INDEX(slow));
      }
    }
  }
  // 預先減速：即將在一格內跳過重要事件時先把速度降下
  if (state.autoSlow && b > a && state.playing) {
    const rate = RATES[state.rateIndex].s;
    for (const ev of m.events) {
      if (!['tmi', 'capture', 'flyby', 'impact'].includes(ev.key)) continue;
      const dt = ev.t - secOf(b);
      if (dt > 0 && dt < rate * 1.2 && state.rateIndex > RATE_INDEX('1 時/秒')) {
        setRate(RATE_INDEX('1 時/秒'));
        break;
      }
    }
  }
}

// ───────────────────────────── 遙測 ─────────────────────────────
const PHASE_TEXT = { prelaunch: '發射台待命', ascent: '上升段', parking: '停泊軌道滑行', cruise: '行星際巡航', orbit: '環繞軌道', coast: '慣性飛行' };
function renderTelemetry() {
  const m = state.mission;
  if (!m) return;
  const t = secOf(state.jd);
  const s = scene.shipState;
  $('#t-met').textContent = `T${fmtDuration(t - m.tLiftoff)}`;
  let phase = s ? PHASE_TEXT[s.phase] ?? s.phase : (t < m.tLiftoff ? '等待發射' : '任務結束');
  if (s?.phase === 'cruise') {
    const pe = scene.pos.earth;
    const to = m.plan?.to;
    if (vnorm(vsub(s.r, pe)) < sphereOfInfluence('earth')) phase = '地球逃逸雙曲線';
    else if (to && vnorm(vsub(s.r, scene.pos[to])) < sphereOfInfluence(to)) phase = `${BODIES[to].name}接近雙曲線`;
  }
  $('#t-phase').textContent = phase;
  const next = m.events.find((e) => e.t > t);
  $('#t-next').textContent = next ? `下一事件：${next.label}（${fmtDuration(next.t - t, false)} 後）` : '';
  const grid = $('#t-grid');
  if (!s) { grid.replaceChildren(); $('#t-gravity').replaceChildren(); return; }
  const dEarth = vnorm(vsub(s.r, scene.pos.earth));
  const to = m.plan?.to;
  const cells = [
    ['距太陽', fmtDistance(vnorm(s.r))],
    ['距地球', fmtDistance(dEarth)],
  ];
  if (to) cells.push([`距${BODIES[to].name}`, fmtDistance(vnorm(vsub(s.r, scene.pos[to])))]);
  cells.push(['日心速度', `${fmt.n3(vnorm(s.v))} km/s`]);
  const es = heliocentricState('earth', state.jd);
  cells.push(['相對地球速度', `${fmt.n3(vnorm(vsub(s.v, es.v)))} km/s`]);
  cells.push(['通訊延遲', lightTimeText(dEarth)]);
  if (to && m.tArrPlanned > t) cells.push(['距抵達', fmtDays((m.tArrPlanned - t) / DAY_S)]);
  grid.replaceChildren(...cells.map(([k, v]) => el('div', { class: 'tstat' }, el('span', { class: 'tstat__label' }, k), el('span', { class: 'tstat__value' }, v))));
  // 重力加速度分解（對數刻度）
  const gb = gravityBreakdown(m.cache, t, s.r).slice(0, 5);
  const maxA = Math.log10(gb[0].accel * 1e6);
  const minA = maxA - 7;
  const bars = gb.map((g) => {
    const mm = g.accel * 1e6; // mm/s²
    const w = Math.max(2, ((Math.log10(mm) - minA) / (maxA - minA)) * 100);
    const color = BODIES[g.id].color;
    return el('div', { class: 'gbar' },
      el('span', { class: 'gbar__name' }, BODIES[g.id].name),
      el('span', { class: 'gbar__track' }, el('span', { class: 'gbar__fill', style: { width: `${w}%`, background: color } })),
      el('span', { class: 'gbar__val' }, mm >= 0.01 ? `${fmt.n3(mm)} mm/s²` : `${mm.toExponential(1)} mm/s²`));
  });
  $('#t-gravity').replaceChildren(...bars);
  // 所在影響球
  let soiBody = '太陽';
  for (const id of ['moon', 'earth', 'mercury', 'venus', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune', 'pluto']) {
    if (scene.pos[id] && vnorm(vsub(s.r, scene.pos[id])) < sphereOfInfluence(id)) { soiBody = BODIES[id].name; break; }
  }
  $('#t-dominant').textContent = `· 最大引力：${BODIES[gb[0].id].name} · 所在影響球：${soiBody}`;
  // 時間軸過去/未來
  for (const li of $$('#mission-timeline li, #free-timeline li')) li.classList.toggle('is-past', +li.dataset.t <= t);
}

// ───────────────────────────── 自由飛行實驗 ─────────────────────────────
const PRESETS = [
  { name: '霍曼式出發（至火星軌道）', vinf: 2.95, az: 0, el: 0, days: 400 },
  { name: '往內至金星軌道', vinf: 2.5, az: 180, el: 0, days: 250 },
  { name: '至木星軌道', vinf: 8.8, az: 0, el: 0, days: 1200 },
  { name: '脫離太陽系', vinf: 12.6, az: 0, el: 0, days: 4000 },
  { name: '墜向太陽要多快？', vinf: 29.8, az: 180, el: 0, days: 120 },
  { name: '垂直黃道面', vinf: 6, az: 0, el: 90, days: 500 },
];
const fv = $('#f-vinf'), faz = $('#f-az'), fel = $('#f-el'), fdays = $('#f-days');
for (const p of PRESETS) {
  $('#free-presets').append(el('button', { class: 'btn', type: 'button', onclick: () => {
    fv.value = p.vinf; faz.value = p.az; fel.value = p.el; fdays.value = p.days; updateFreePreview();
  } }, p.name));
}
function freeVinfVector() {
  const e = heliocentricState('earth', state.jd);
  const vhat = vscale([e.v[0], e.v[1], 0], 1 / Math.hypot(e.v[0], e.v[1]));
  const side = [-vhat[1], vhat[0], 0];
  const az = +faz.value * DEG, elv = +fel.value * DEG;
  const dir = vadd(vadd(vscale(vhat, Math.cos(elv) * Math.cos(az)), vscale(side, Math.cos(elv) * Math.sin(az))), [0, 0, Math.sin(elv)]);
  return { e, vinfVec: vscale(dir, +fv.value) };
}
function updateFreePreview() {
  $('#f-vinf-out').textContent = (+fv.value).toFixed(2);
  $('#f-az-out').textContent = `${faz.value}°`;
  $('#f-el-out').textContent = `${fel.value}°`;
  const { e, vinfVec } = freeVinfVector();
  const v = vadd(e.v, vinfVec);
  const o = stateToElements(e.r, v, GM_SUN);
  const vesc = Math.sqrt((2 * GM_SUN) / vnorm(e.r));
  fillKv($('#free-preview'), [
    ['逃逸點火 Δv', `${fmt.n3(departureDeltaV(+fv.value, BODIES.earth.gm, BODIES.earth.eqRadius + 200))} km/s`, 'LEO 200 km'],
    ['C3', `${fmt.n2((+fv.value) ** 2)} km²/s²`],
    ['出發日心速度', `${fmt.n2(vnorm(v))} km/s`, `脫離太陽需 ${fmt.n2(vesc)}`],
    ['預估近日點', `${fmt.n3(o.rp / AU_KM)} AU`],
    ['預估遠日點', o.e < 1 ? `${fmt.n3(o.ra / AU_KM)} AU` : '∞（脫離太陽系）'],
    ['預估週期', o.e < 1 ? fmtDays(o.period / DAY_S) : '—'],
  ]);
}
for (const i of [fv, faz, fel]) i.addEventListener('input', updateFreePreview);

async function launchFree() {
  if (state.busy) return;
  state.busy = true;
  $('#btn-free').disabled = true;
  try {
    const m = await simulateFreeFlight({
      jd: state.jd, vinf: +fv.value, azimuthDeg: +faz.value, elevationDeg: +fel.value, durationDays: Math.max(10, +fdays.value || 365), siteKey: state.site,
    });
    setMission(m);
    jumpTo(jdOf(m.tTMI - 600));
    setRate(RATE_INDEX('10 分/秒'));
    setPlaying(true);
    scene.setFocus('spacecraft');
  } finally {
    state.busy = false;
    $('#btn-free').disabled = false;
  }
}
$('#btn-free').addEventListener('click', launchFree);

function renderFreeResult(m) {
  $('#free-result').hidden = false;
  const o = m.orbitEnd;
  const rows = [
    ['狀態', STATUS_TEXT[m.status]?.[0] ?? m.status],
    ['出發', fmtDateTime(jdOf(m.tTMI))],
    ['v∞ / 逃逸 Δv', `${fmt.n2(m.vinf)} / ${fmt.n3(m.dvTMI)} km/s`],
    null,
    ['結束時日心距離', fmtDistance(vnorm(m.trajectory.stateAt(m.trajectory.tEnd).r))],
    ['結束時軌道', o.e < 1 ? `近 ${fmt.n3(o.rp / AU_KM)} / 遠 ${fmt.n3(o.ra / AU_KM)} AU` : '雙曲線（脫離太陽系）'],
    ['離心率', fmt.n3(o.e)],
  ];
  for (const a of m.assists) {
    if (!(a.dvGravityAssist > 0.01)) continue;
    rows.push([`${BODIES[a.id].name}重力助推`, `${fmt.n3(a.dvGravityAssist)} km/s`, `最近 ${fmtKm(a.rp)}`]);
  }
  fillKv($('#free-list'), rows);
  renderTimeline($('#free-timeline'), m);
}

// ───────────────────────────── 分頁與行動版抽屜 ─────────────────────────────
$$('.tab').forEach((tab) => tab.addEventListener('click', () => {
  $$('.tab').forEach((t) => { t.classList.toggle('is-active', t === tab); t.setAttribute('aria-selected', String(t === tab)); });
  $$('.tabpanel').forEach((p) => { p.hidden = p.dataset.panel !== tab.dataset.tab; });
  if (tab.dataset.tab === 'free') updateFreePreview();
}));

let currentSheet = 'mission';
function setSheet(name) {
  currentSheet = name;
  $$('.tabbar button').forEach((b) => b.classList.toggle('is-on', b.dataset.open === name));
  $('#panel-bodies').classList.toggle('is-open', name === 'bodies');
  $('#panel-mission').classList.toggle('is-open', name === 'mission');
  $('#telemetry').classList.toggle('is-open', name === 'telemetry');
  if (name !== 'porkchop' && window.matchMedia('(max-width: 820px)').matches) {
    $('#porkchop').classList.remove('is-open');
  }
  requestAnimationFrame(() => updateInsets());
}
$$('.tabbar button').forEach((b) => b.addEventListener('click', () => {
  const name = b.dataset.open;
  if (name === 'porkchop') openPorkchop(true);
  else setSheet(name === currentSheet ? 'none' : name);
}));
setSheet(window.matchMedia('(max-width: 820px)').matches ? 'none' : 'mission');

// 鍵盤快捷鍵
window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
  if (e.code === 'Space') { e.preventDefault(); setPlaying(!state.playing); }
  else if (e.key === ']' || e.key === '.') setRate(state.rateIndex + 1);
  else if (e.key === '[' || e.key === ',') setRate(state.rateIndex - 1);
  else if (e.key === 'r' || e.key === 'R') $('#btn-reverse').click();
  else if (e.key === 'f' || e.key === 'F') scene.setFocus(state.mission ? 'spacecraft' : 'earth');
  else if (e.key === 'Escape') closePorkchop();
});

// 依面板實際覆蓋範圍調整 3D 投影中心
function updateInsets() {
  const W = window.innerWidth, H = window.innerHeight;
  const vis = (sel) => {
    const n = $(sel);
    if (!n || n.hidden) return null;
    const r = n.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && getComputedStyle(n).display !== 'none' ? r : null;
  };
  const top = vis('.topbar');
  const left = vis('#panel-bodies');
  const right = vis('#panel-mission');
  const tel = vis('#telemetry');
  const pork = vis('#porkchop');
  const mobile = window.matchMedia('(max-width: 820px)').matches;
  const insets = { left: 0, right: 0, top: top ? top.bottom : 0, bottom: 0 };
  if (!mobile) {
    if (left) insets.left = left.right;
    if (right) insets.right = W - right.left;
    if (tel) insets.bottom = H - tel.top;
  } else {
    const sheets = [left, right, tel, pork].filter(Boolean);
    const minTop = Math.min(H, ...sheets.map((r) => r.top), $('.tabbar').getBoundingClientRect().top);
    insets.bottom = H - minTop;
  }
  scene.setViewInsets(insets);
}
window.addEventListener('resize', updateInsets);
new ResizeObserver(updateInsets).observe($('#telemetry'));

// ───────────────────────────── 主迴圈 ─────────────────────────────
let last = performance.now();
let uiTick = 0, listTick = 0;
function frame(now) {
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  if (state.playing) {
    const rate = RATES[state.rateIndex].s * (state.reverse ? -1 : 1);
    state.jd = Math.max(JD_MIN, Math.min(JD_MAX, state.jd + (rate * dt) / DAY_S));
    checkEvents();
  }
  scene.setTime(state.jd);
  scene.update();
  updateClock();
  uiTick += dt;
  listTick += dt;
  if (uiTick > 0.15) {
    uiTick = 0;
    renderInfo();
    renderTelemetry();
  }
  if (listTick > 0.6) {
    listTick = 0;
    updateBodyMeta();
  }
  requestAnimationFrame(frame);
}

// ───────────────────────────── 啟動 ─────────────────────────────
async function boot() {
  updateInsets();
  $('#jump-input').value = fmtDateTimeLocal(state.jd);
  renderBodyList();
  setTarget(state.target);
  depInput.value = fmtDate(state.jd);
  replan();
  updateFreePreview();
  requestAnimationFrame(frame);
  const loadingText = $('#loading-text');
  let hidden = false;
  scene.loadTextures((f, id) => {
    loadingText.textContent = `正在生成行星表面…${Math.round(f * 100)}%`;
    if (!hidden && (id === 'moon' || f >= 1)) {
      hidden = true;
      $('#loading').classList.add('is-done');
    }
  }).catch((err) => {
    console.error(err);
    $('#loading').classList.add('is-done');
  });
  await searchBest();
}
boot();

// 供除錯與自動化測試使用
window.solarSim = { scene, state, jumpTo, setRate, setPlaying };
