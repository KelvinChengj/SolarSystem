// 主場景：以浮動原點與公里為單位繪製太陽系、太空船與軌跡。

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CSS2DObject, CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { feature } from 'topojson-client';
import landTopo from 'world-atlas/land-50m.json';

import { AU_KM, BODIES, DAY_S, GM_EARTH_MOON, GM_SUN, J2000_JD, MOON_MASS_FRACTION, PLANET_IDS } from '../physics/constants.js';
import { embPosition, heliocentricPosition, heliocentricState, moonGeocentricState, planetElements } from '../physics/ephemeris.js';
import { propagateKepler, solveKepler, stateToElements } from '../physics/kepler.js';
import { moonGeocentric } from '../physics/moon.js';
import { sphereOfInfluence } from '../physics/nbody.js';
import { bodyToEclipticMatrix } from '../physics/orientation.js';
import { createBody, createSoiBubble } from './bodies.js';
import { eclipticMatrixToScene, toScene, dirToScene } from './coords.js';
import { OrbitLine, PathLine } from './lines.js';
import { createSpacecraft } from './spacecraft.js';
import { createStarfield } from './starfield.js';
import { createSun } from './sun.js';
import { earthTextures, TEXTURE_RECIPES } from './textures.js';

const BODY_IDS = ['mercury', 'venus', 'earth', 'moon', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune', 'pluto'];
const LABEL_PRIORITY = ['spacecraft', 'sun', 'jupiter', 'saturn', 'earth', 'mars', 'venus', 'uranus', 'neptune', 'mercury', 'pluto', 'moon'];

const COLORS = {
  plan: '#5ad1c8',
  flight: '#ff9d5c',
  flightFuture: '#b8704a',
};

const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export class SolarScene {
  constructor(container, { onFocusChange } = {}) {
    this.container = container;
    this.onFocusChange = onFocusChange;
    this.jd = J2000_JD;
    this.focusId = 'sun';
    this.origin = [0, 0, 0];
    this.options = { orbits: true, labels: true, grid: true, soi: false, velocity: false, minPx: 4, trailFrame: 'auto' };
    this.mission = null;
    this.planned = null;
    this.pos = {};
    this.lastFrame = performance.now();
    this.animTime = 0;
    this.viewInsets = { left: 0, right: 0, top: 0, bottom: 0 };

    const renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x03050b, 1);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    container.appendChild(renderer.domElement);
    this.renderer = renderer;

    const labelRenderer = new CSS2DRenderer();
    labelRenderer.domElement.className = 'label-layer';
    container.appendChild(labelRenderer.domElement);
    this.labelRenderer = labelRenderer;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(45, 1, 1e-3, 1e11);
    this.camera.position.set(0, 2.2e8, 3.2e8);
    this.controls = new OrbitControls(this.camera, renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.zoomSpeed = 1.4;
    this.controls.rotateSpeed = 0.6;
    this.controls.enablePan = false;
    this.controls.maxDistance = 2.5e10;
    this.controls.target.set(0, 0, 0);

    this.scene.add(new THREE.AmbientLight(0x3a4866, 0.9));
    this.stars = createStarfield();
    this.scene.add(this.stars);

    this.sun = createSun(BODIES.sun.radius);
    this.scene.add(this.sun.group);
    this.sun.mesh.userData.bodyId = 'sun';

    this.bodies = new Map();
    for (const id of BODY_IDS) {
      const obj = createBody(id);
      this.scene.add(obj.group);
      const orbit = new OrbitLine(BODIES[id].color, 721, id === 'moon' ? 0.45 : 0.5);
      this.scene.add(orbit.object);
      const soi = createSoiBubble(BODIES[id].color);
      this.scene.add(soi);
      const label = this.makeLabel(id, BODIES[id].name, BODIES[id].color);
      obj.group.add(label);
      const arrow = new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(), 1, new THREE.Color(BODIES[id].color).getHex(), 0.2, 0.08);
      arrow.visible = false;
      this.scene.add(arrow);
      this.bodies.set(id, { obj, orbit, soi, label, arrow });
    }
    const sunLabel = this.makeLabel('sun', BODIES.sun.name, BODIES.sun.color);
    this.sun.group.add(sunLabel);
    this.sunLabel = sunLabel;

    this.grid = this.makeGrid();
    this.scene.add(this.grid);

    // 太空船與軌跡
    this.ship = createSpacecraft();
    this.ship.group.visible = false;
    this.scene.add(this.ship.group);
    this.shipLabel = this.makeLabel('spacecraft', '太空船', COLORS.flight);
    this.ship.group.add(this.shipLabel);

    this.paths = {
      planned: new PathLine({ color: COLORS.plan, width: 1.6, dashed: true, maxPoints: 1024, opacity: 0.95 }),
      helioFlown: new PathLine({ color: COLORS.flight, width: 2.4 }),
      helioFuture: new PathLine({ color: COLORS.flightFuture, width: 1.4, opacity: 0.7 }),
      depFlown: new PathLine({ color: COLORS.flight, width: 2.2 }),
      depFuture: new PathLine({ color: COLORS.flightFuture, width: 1.3, opacity: 0.7 }),
      arrFlown: new PathLine({ color: COLORS.flight, width: 2.2 }),
      arrFuture: new PathLine({ color: COLORS.flightFuture, width: 1.3, opacity: 0.7 }),
    };
    for (const p of Object.values(this.paths)) {
      p.object.visible = false;
      this.scene.add(p.object);
    }
    this.captureOrbit = new OrbitLine(COLORS.flight, 361, 0.75);
    this.captureOrbit.object.visible = false;
    this.scene.add(this.captureOrbit.object);

    this.markers = {
      depart: this.makeMarker('出發'),
      arrive: this.makeMarker('抵達'),
    };
    for (const m of Object.values(this.markers)) this.scene.add(m);

    this.bindPicking();
    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.tmp = { v: new THREE.Vector3(), v2: new THREE.Vector3(), m: new THREE.Matrix4() };
    this.transition = null;
    this.buf = new Float64Array(8192 * 3);
    this.cameraDistanceHint = null;
  }

  makeLabel(id, text, color) {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'body-label';
    el.dataset.id = id;
    el.style.setProperty('--dot', color);
    el.textContent = text;
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      this.setFocus(id);
    });
    const obj = new CSS2DObject(el);
    obj.center.set(-0.08, 0.5);
    obj.userData.id = id;
    return obj;
  }

  makeMarker(text) {
    const el = document.createElement('div');
    el.className = 'ghost-marker';
    const ring = document.createElement('span');
    ring.className = 'ghost-ring';
    const t = document.createElement('span');
    t.className = 'ghost-text';
    t.textContent = text;
    el.append(ring, t);
    const obj = new CSS2DObject(el);
    obj.visible = false;
    obj.userData.text = t;
    obj.userData.r = null;
    return obj;
  }

  makeGrid() {
    const group = new THREE.Group();
    const mat = new THREE.LineBasicMaterial({ color: 0x2a3b5c, transparent: true, opacity: 0.35, depthWrite: false });
    const radii = [1, 2, 5, 10, 20, 30, 50];
    for (const rAU of radii) {
      const pts = [];
      for (let k = 0; k <= 256; k++) {
        const a = (k / 256) * Math.PI * 2;
        pts.push(new THREE.Vector3(Math.cos(a) * rAU * AU_KM, 0, -Math.sin(a) * rAU * AU_KM));
      }
      group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), mat));
      const el = document.createElement('div');
      el.className = 'grid-label';
      el.textContent = `${rAU} AU`;
      const lab = new CSS2DObject(el);
      lab.position.set(Math.cos(-0.35) * rAU * AU_KM, 0, -Math.sin(-0.35) * rAU * AU_KM);
      group.add(lab);
    }
    const spokes = [];
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      spokes.push(new THREE.Vector3(Math.cos(a) * 0.3 * AU_KM, 0, -Math.sin(a) * 0.3 * AU_KM));
      spokes.push(new THREE.Vector3(Math.cos(a) * 50 * AU_KM, 0, -Math.sin(a) * 50 * AU_KM));
    }
    group.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(spokes), mat));
    const eq = document.createElement('div');
    eq.className = 'grid-label grid-label--equinox';
    eq.textContent = '♈︎ 春分點方向';
    const eqLab = new CSS2DObject(eq);
    eqLab.position.set(1.35 * AU_KM, 0, 0);
    group.add(eqLab);
    group.traverse((o) => { o.frustumCulled = false; });
    return group;
  }

  /** 非同步產生程序化貼圖（先顯示純色球體）。 */
  async loadTextures(onProgress) {
    const ids = ['earth', 'moon', 'mars', 'jupiter', 'saturn', 'venus', 'mercury', 'neptune', 'uranus', 'pluto'];
    const aniso = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    let done = 0;
    for (const id of ids) {
      const entry = this.bodies.get(id);
      if (id === 'earth') {
        const land = feature(landTopo, landTopo.objects.land);
        const { surface, clouds } = await earthTextures(land);
        entry.obj.setTexture(surface, aniso);
        entry.obj.setCloudTexture(clouds);
      } else {
        const canvas = await TEXTURE_RECIPES[id]();
        entry.obj.setTexture(canvas, aniso);
      }
      done++;
      onProgress?.(done / ids.length, id);
    }
  }

  resize() {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.width = w;
    this.height = h;
    this.renderer.setSize(w, h);
    this.labelRenderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.applyViewOffset();
    for (const p of Object.values(this.paths)) p.setResolution(w, h);
  }

  /** 側邊面板遮住畫面時，把投影中心移到可見區域的中央。 */
  setViewInsets(insets) {
    this.viewInsets = { ...this.viewInsets, ...insets };
    this.applyViewOffset();
  }

  applyViewOffset() {
    const { left, right, top, bottom } = this.viewInsets;
    const w = this.width, h = this.height;
    const dx = (left - right) / 2, dy = (top - bottom) / 2;
    if (dx || dy) this.camera.setViewOffset(w, h, -dx, -dy, w, h);
    else this.camera.clearViewOffset();
    this.camera.updateProjectionMatrix();
  }

  bindPicking() {
    const el = this.renderer.domElement;
    const ray = new THREE.Raycaster();
    let down = null;
    el.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY }; });
    el.addEventListener('pointerup', (e) => {
      if (!down) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      down = null;
      if (moved > 5) return;
      const rect = el.getBoundingClientRect();
      const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
      // setViewOffset 已內含於 projectionMatrix，Raycaster 以其反矩陣換算，NDC 仍以整個畫布為準
      ray.setFromCamera(ndc, this.camera);
      const targets = [this.sun.mesh, ...[...this.bodies.values()].map((b) => b.obj.mesh)];
      if (this.ship.group.visible) this.ship.model.traverse((o) => { if (o.isMesh) targets.push(o); });
      const hit = ray.intersectObjects(targets, false)[0];
      if (hit) {
        const id = hit.object.userData.bodyId ?? 'spacecraft';
        this.setFocus(id);
      }
    });
    el.addEventListener('dblclick', () => this.zoomToFocus());
  }

  // ───────────────────────────── 狀態設定 ─────────────────────────────

  setTime(jd) {
    this.jd = jd;
  }

  setOption(key, value) {
    this.options[key] = value;
  }

  /** 設定焦點天體，並平滑移動視角。 */
  setFocus(id, { zoom = true } = {}) {
    if (id === 'spacecraft' && !this.mission) return;
    const from = this.focusId;
    if (from === id && !zoom) return;
    const fromPos = this.focusPosition(from) ?? this.origin.slice();
    this.focusId = id;
    this.transition = {
      fromPos, toId: id, t: 0, dur: 1.4,
      fromDist: this.camera.position.length(),
      toDist: zoom ? this.defaultDistance(id) : this.camera.position.length(),
      fromDir: this.camera.position.clone().normalize(),
      toDir: zoom ? this.preferredDirection(id) : null,
    };
    this.onFocusChange?.(id);
  }

  /** 聚焦時的建議觀看方向（場景座標單位向量）：行星取向陽側 3/4 相位，太空船自軌道面上方俯視。 */
  preferredDirection(id) {
    const up = new THREE.Vector3(0, 1, 0);
    const toSun = (p) => new THREE.Vector3(-p[0], -p[2], p[1]).normalize();
    if (id === 'sun') return null;
    if (id === 'spacecraft') {
      const s = this.shipState ?? (this.mission ? this.mission.stateAt((this.jd - J2000_JD) * DAY_S) : null);
      if (!s?.central || !s.rel) return null;
      const cs = heliocentricState(s.central, this.jd);
      const vrel = [s.v[0] - cs.v[0], s.v[1] - cs.v[1], s.v[2] - cs.v[2]];
      const h = new THREE.Vector3().crossVectors(dirToScene(new THREE.Vector3(), s.rel), dirToScene(new THREE.Vector3(), vrel)).normalize();
      if (h.y < 0) h.negate();
      const out = dirToScene(new THREE.Vector3(), s.rel).normalize();
      return out.multiplyScalar(0.55).add(h.multiplyScalar(0.7)).add(toSun(s.r).multiplyScalar(0.35)).normalize();
    }
    const p = this.pos[id];
    if (!p) return null;
    const sun = toSun(p);
    const side = new THREE.Vector3().crossVectors(up, sun).normalize();
    return sun.multiplyScalar(0.72).add(side.multiplyScalar(0.55)).add(up.multiplyScalar(0.42)).normalize();
  }

  zoomToFocus() {
    this.transition = {
      fromPos: this.origin.slice(), toId: this.focusId, t: 0, dur: 1.0,
      fromDist: this.camera.position.length(), toDist: this.defaultDistance(this.focusId, true),
      fromDir: this.camera.position.clone().normalize(), toDir: null,
    };
  }

  /** 設定鏡頭與焦點的距離（km）。 */
  setCameraDistance(d) {
    if (this.transition) this.transition.toDist = d;
    else this.camera.position.setLength(d);
  }

  defaultDistance(id, close = false) {
    if (id === 'sun') return close ? BODIES.sun.radius * 8 : 3.1 * AU_KM;
    if (id === 'spacecraft') {
      const s = this.shipState;
      if (s?.central) return Math.max(BODIES[s.central].eqRadius * 5, Math.hypot(...(s.rel ?? [0, 0, 0])) * 3.2);
      return close ? 2e4 : 6e6;
    }
    const b = BODIES[id];
    return b ? b.eqRadius * (id === 'saturn' ? 7 : 5.2) : AU_KM;
  }

  /** 設定已規劃的 Lambert 轉移（顯示虛線）。 */
  setPlannedTransfer(plan) {
    this.planned = plan;
    if (!plan) return;
    const n = 400;
    const pts = new Float64Array(n * 3);
    const tof = plan.tofDays * DAY_S;
    for (let k = 0; k < n; k++) {
      const s = propagateKepler(plan.r1, plan.v1, (tof * k) / (n - 1), GM_SUN);
      pts[3 * k] = s.r[0]; pts[3 * k + 1] = s.r[1]; pts[3 * k + 2] = s.r[2];
    }
    this.plannedPts = pts;
  }

  /** 設定完整模擬任務（N 體軌跡）。 */
  setMission(mission) {
    this.mission = mission;
    this.shipState = null;
    if (!mission) {
      if (this.focusId === 'spacecraft') this.setFocus('earth');
      return;
    }
    const traj = mission.trajectory;
    const n = traj.length;
    this.helio = { t: Float64Array.from(traj.t), r: Float64Array.from(traj.r), n };
    const cache = mission.cache;
    const buildRel = (bodyId, tStart, tEnd, extraBefore = null) => {
      const soi = sphereOfInfluence(bodyId);
      const ts = [], rs = [];
      const rb = [0, 0, 0];
      if (extraBefore) for (const e of extraBefore) { ts.push(e.t); rs.push(e.rel[0], e.rel[1], e.rel[2]); }
      for (let i = 0; i < n; i++) {
        const t = traj.t[i];
        if (t < tStart || t > tEnd) continue;
        cache.position(bodyId, t, rb);
        const d = [traj.r[3 * i] - rb[0], traj.r[3 * i + 1] - rb[1], traj.r[3 * i + 2] - rb[2]];
        if (Math.hypot(d[0], d[1], d[2]) > 3 * soi) continue;
        ts.push(t); rs.push(d[0], d[1], d[2]);
      }
      return { body: bodyId, t: Float64Array.from(ts), r: Float64Array.from(rs), n: ts.length };
    };
    // 出發段：上升 + 停泊軌道滑行（每 20 秒取樣）+ 地球附近軌跡
    const pre = [];
    for (let t = mission.tLiftoff; t < mission.tTMI; t += 20) {
      const s = mission.stateAt(t);
      if (s?.rel) pre.push({ t, rel: s.rel });
    }
    this.depRel = buildRel('earth', mission.tTMI, mission.tTMI + 60 * DAY_S, pre);
    const to = mission.plan?.to;
    this.arrRel = to ? buildRel(to, mission.tArrPlanned - 400 * DAY_S, Infinity) : null;
    if (mission.capture) {
      const c = mission.capture;
      const pts = new Float64Array(361 * 3);
      for (let k = 0; k <= 360; k++) {
        const s = propagateKepler(c.rRel, c.vRel, (c.period * k) / 360, c.mu);
        pts.set(s.r, 3 * k);
      }
      this.capturePts = pts;
    } else {
      this.capturePts = null;
    }
  }

  // ───────────────────────────── 每格更新 ─────────────────────────────

  computePositions() {
    const jd = this.jd;
    const emb = embPosition(jd);
    const mg = moonGeocentric(jd);
    this.moonGeo = mg;
    this.pos.sun = [0, 0, 0];
    this.pos.earth = [emb[0] - MOON_MASS_FRACTION * mg[0], emb[1] - MOON_MASS_FRACTION * mg[1], emb[2] - MOON_MASS_FRACTION * mg[2]];
    const k = 1 - MOON_MASS_FRACTION;
    this.pos.moon = [emb[0] + k * mg[0], emb[1] + k * mg[1], emb[2] + k * mg[2]];
    this.emb = emb;
    for (const id of PLANET_IDS) if (id !== 'earth') this.pos[id] = heliocentricPosition(id, jd);
    const tSec = (jd - J2000_JD) * DAY_S;
    this.shipState = this.mission ? this.mission.stateAt(tSec) : null;
    if (this.shipState) this.pos.spacecraft = this.shipState.r;
  }

  focusPosition(id) {
    if (id === 'spacecraft') {
      if (this.shipState) return this.shipState.r;
      // 太空船尚未出現（例如升空前很久）時，暫以地球為中心
      return this.mission ? this.pos.earth : null;
    }
    return this.pos[id] ?? null;
  }

  worldPerPx(distKm) {
    return (distKm * 2 * Math.tan((this.camera.fov * Math.PI) / 360)) / this.height;
  }

  update() {
    const nowMs = performance.now();
    const dt = Math.min((nowMs - this.lastFrame) / 1000, 0.1);
    this.lastFrame = nowMs;
    this.animTime += dt;
    this.computePositions();
    const camDist = this.camera.position.length();

    // 焦點（浮動原點）與平滑轉場
    let focusPos = this.focusPosition(this.focusId);
    if (!focusPos) { this.focusId = 'sun'; focusPos = this.pos.sun; }
    if (this.transition) {
      const tr = this.transition;
      tr.t += dt;
      const s = ease(Math.min(1, tr.t / tr.dur));
      this.origin = [
        tr.fromPos[0] + (focusPos[0] - tr.fromPos[0]) * s,
        tr.fromPos[1] + (focusPos[1] - tr.fromPos[1]) * s,
        tr.fromPos[2] + (focusPos[2] - tr.fromPos[2]) * s,
      ];
      const d = Math.exp(Math.log(tr.fromDist) + (Math.log(tr.toDist) - Math.log(tr.fromDist)) * s);
      if (tr.toDir) {
        const dir = tr.fromDir.clone().lerp(tr.toDir, s);
        if (dir.lengthSq() < 1e-8) dir.copy(tr.toDir);
        this.camera.position.copy(dir.normalize());
      }
      this.camera.position.setLength(d);
      if (tr.t >= tr.dur) this.transition = null;
    } else {
      this.origin = focusPos.slice();
    }
    const origin = this.origin;
    const focusR = this.focusRadius(this.focusId);
    this.controls.minDistance = Math.max(focusR * 1.15, 0.2);
    this.controls.update();
    // 動態近平面：過小的 near 會在部分 GPU 上造成整個物件被裁切
    const near = Math.max(0.02, this.camera.position.length() * 1e-4);
    if (Math.abs(near - this.camera.near) > this.camera.near * 0.05) {
      this.camera.near = near;
      this.camera.updateProjectionMatrix();
    }
    this.camera.updateMatrixWorld();

    const camPos = this.camera.position;
    const v = this.tmp.v;
    const minPx = this.options.minPx;

    // 太陽
    toScene(this.sun.group.position, this.pos.sun, origin);
    const dSun = this.sun.group.position.distanceTo(camPos);
    const wppSun = this.worldPerPx(dSun);
    const sunR = Math.max(BODIES.sun.radius, wppSun * (minPx + 3));
    this.sun.update(this.animTime, sunR, wppSun);
    this.displayRadius = { sun: sunR };

    // 行星與月球
    const earthEntry = this.bodies.get('earth');
    for (const [id, e] of this.bodies) {
      const b = BODIES[id];
      const g = e.obj.group;
      toScene(g.position, this.pos[id], origin);
      const d = g.position.distanceTo(camPos);
      const wpp = this.worldPerPx(d);
      const dispR = Math.max(b.eqRadius, wpp * minPx);
      const scale = dispR / b.eqRadius;
      g.scale.setScalar(scale);
      this.displayRadius[id] = dispR;
      eclipticMatrixToScene(bodyToEclipticMatrix(id, this.jd), e.obj.spin.matrix);
      e.obj.spin.matrixWorldNeedsUpdate = true;
      if (e.obj.clouds) e.obj.clouds.rotation.y = this.jd * 0.35;
      if (e.obj.atmosphere) {
        const sunDir = this.tmp.v2.copy(this.sun.group.position).sub(g.position).normalize();
        e.obj.atmosphere.material.uniforms.uSunDir.value.copy(sunDir);
        e.obj.atmosphere.visible = scale < 3;
      }
      // SOI 泡泡
      const soiR = sphereOfInfluence(id);
      e.soi.visible = this.options.soi;
      if (e.soi.visible) {
        e.soi.position.copy(g.position);
        e.soi.scale.setScalar(Math.max(soiR, dispR * 1.5));
      }
    }
    // 月球在畫面上與地球重疊時隱藏
    const moonE = this.bodies.get('moon');
    const moonHidden = Math.hypot(...this.moonGeo) < this.displayRadius.earth * 1.6;
    moonE.obj.group.visible = !moonHidden;

    // 軌道線
    this.updateOrbits(origin);

    // 速度向量
    for (const [id, e] of this.bodies) {
      e.arrow.visible = this.options.velocity && id !== 'moon';
      if (!e.arrow.visible) continue;
      const st = heliocentricState(id, this.jd);
      const speed = Math.hypot(...st.v);
      dirToScene(v, st.v).normalize();
      e.arrow.position.copy(e.obj.group.position);
      e.arrow.setDirection(v);
      const len = camDist * 0.12 * (speed / 30);
      e.arrow.setLength(len, len * 0.18, len * 0.08);
    }

    this.grid.visible = this.options.grid;
    toScene(this.grid.position, [0, 0, 0], origin);

    // 太空船與軌跡
    this.updateSpacecraft(origin, camPos, minPx);
    this.updatePaths(origin, camDist);
    this.updateMarkers(origin);

    this.stars.position.copy(camPos);

    this.renderer.render(this.scene, this.camera);
    this.labelRenderer.render(this.scene, this.camera);
    this.declutterLabels();
  }

  focusRadius(id) {
    if (id === 'spacecraft') return 0.02;
    if (id === 'sun') return BODIES.sun.radius;
    return BODIES[id]?.eqRadius ?? 1;
  }

  updateOrbits(origin) {
    const buf = this.buf;
    const N = 360;
    for (const [id, e] of this.bodies) {
      const line = e.orbit;
      line.object.visible = this.options.orbits && (id !== 'moon' || e.obj.group.visible);
      if (!line.object.visible) continue;
      toScene(line.object.position, this.pos[id], origin);
      if (id === 'moon') {
        const st = moonGeocentricState(this.jd);
        const el = stateToElements(st.r, st.v, GM_EARTH_MOON);
        const s0 = st.r;
        for (let k = 0; k <= N; k++) {
          const s = propagateKepler(st.r, st.v, (el.period * k) / N, GM_EARTH_MOON);
          const dx = s.r[0] - s0[0], dy = s.r[1] - s0[1], dz = s.r[2] - s0[2];
          buf[3 * k] = dx; buf[3 * k + 1] = dz; buf[3 * k + 2] = -dy;
        }
        line.write(buf, N + 1);
        continue;
      }
      const el = planetElements(id, this.jd);
      const E0 = solveKepler(el.M, el.e);
      const cw = Math.cos(el.argp), sw = Math.sin(el.argp);
      const cO = Math.cos(el.raan), sO = Math.sin(el.raan);
      const ci = Math.cos(el.i), si = Math.sin(el.i);
      const b = el.a * Math.sqrt(1 - el.e * el.e);
      const P = [(cw * cO - sw * sO * ci), (cw * sO + sw * cO * ci), sw * si];
      const Q = [(-sw * cO - cw * sO * ci), (-sw * sO + cw * cO * ci), cw * si];
      const xp0 = el.a * (Math.cos(E0) - el.e), yp0 = b * Math.sin(E0);
      for (let k = 0; k <= N; k++) {
        const E = E0 + (2 * Math.PI * k) / N;
        const xp = el.a * (Math.cos(E) - el.e) - xp0;
        const yp = b * Math.sin(E) - yp0;
        const x = P[0] * xp + Q[0] * yp, y = P[1] * xp + Q[1] * yp, z = P[2] * xp + Q[2] * yp;
        buf[3 * k] = x; buf[3 * k + 1] = z; buf[3 * k + 2] = -y;
      }
      line.write(buf, N + 1);
    }
  }

  updateSpacecraft(origin, camPos, minPx) {
    const s = this.shipState;
    const m = this.mission;
    this.ship.group.visible = !!s;
    if (!s) return;
    toScene(this.ship.group.position, s.r, origin);
    const d = this.ship.group.position.distanceTo(camPos);
    const wpp = this.worldPerPx(d);
    let vRel = s.v;
    if (s.central) {
      const cs = heliocentricState(s.central, this.jd);
      vRel = [s.v[0] - cs.v[0], s.v[1] - cs.v[1], s.v[2] - cs.v[2]];
    }
    const dir = dirToScene(this.tmp.v, s.dir ?? vRel).normalize();
    const tSec = (this.jd - J2000_JD) * DAY_S;
    let burn = 0;
    const burnWin = 6 * 60;
    if (Math.abs(tSec - m.tTMI) < burnWin) burn = 1 - Math.abs(tSec - m.tTMI) / burnWin;
    if (m.capture && Math.abs(tSec - m.capture.t) < burnWin * 1.5) burn = 1 - Math.abs(tSec - m.capture.t) / (burnWin * 1.5);
    if (s.phase === 'ascent') burn = 1;
    // 點火時太空船朝向：TMI 沿速度方向加速；捕獲時反向減速
    if (m.capture && Math.abs(tSec - m.capture.t) < burnWin * 1.5) dir.negate();
    this.ship.update(dir, wpp, Math.max(minPx * 2.2, 9), burn, this.animTime);
  }

  /** 將軌跡依目前時間拆成「已飛行」與「未飛行」兩段並寫入線條。 */
  writeSplit(path, flown, future, tNow, current, offset, visible) {
    flown.object.visible = visible;
    future.object.visible = visible;
    if (!visible || !path || path.n < 2) {
      flown.object.visible = false;
      future.object.visible = false;
      return;
    }
    const buf = this.buf;
    const { t, r, n } = path;
    let k = -1;
    let lo = 0, hi = n - 1;
    if (tNow >= t[0]) {
      if (tNow >= t[n - 1]) k = n - 1;
      else {
        while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (t[mid] <= tNow) lo = mid; else hi = mid; }
        k = lo;
      }
    }
    const put = (idx, x, y, z) => { buf[3 * idx] = x - offset[0]; buf[3 * idx + 1] = z - offset[2]; buf[3 * idx + 2] = -(y - offset[1]); };
    // 已飛行
    let c = 0;
    if (k >= 0) {
      const start = Math.max(0, k - 8000);
      for (let i = start; i <= k; i++) put(c++, r[3 * i], r[3 * i + 1], r[3 * i + 2]);
      if (current && k < n - 1) put(c++, current[0], current[1], current[2]);
    }
    flown.write(buf, c);
    flown.object.visible = c >= 2;
    // 未飛行
    c = 0;
    if (k < n - 1) {
      if (current && k >= 0) put(c++, current[0], current[1], current[2]);
      for (let i = k + 1; i < n && c < 8000; i++) put(c++, r[3 * i], r[3 * i + 1], r[3 * i + 2]);
    }
    future.write(buf, c);
    future.object.visible = c >= 2;
  }

  updatePaths(origin, camDist) {
    const P = this.paths;
    const tSec = (this.jd - J2000_JD) * DAY_S;
    // 規劃中的 Lambert 轉移（虛線）
    const showPlan = !!this.planned && !!this.plannedPts;
    P.planned.object.visible = showPlan;
    if (showPlan) {
      const pts = this.plannedPts;
      const n = pts.length / 3;
      const buf = this.buf;
      for (let k = 0; k < n; k++) {
        buf[3 * k] = pts[3 * k] - origin[0];
        buf[3 * k + 1] = pts[3 * k + 2] - origin[2];
        buf[3 * k + 2] = -(pts[3 * k + 1] - origin[1]);
      }
      P.planned.write(buf, n);
      P.planned.setDash(camDist * 0.012, camDist * 0.008);
    }
    const m = this.mission;
    if (!m) {
      for (const k of ['helioFlown', 'helioFuture', 'depFlown', 'depFuture', 'arrFlown', 'arrFuture']) P[k].object.visible = false;
      this.captureOrbit.object.visible = false;
      return;
    }
    // 參考系：聚焦行星且鏡頭在其影響球附近時，以該行星為中心繪製
    const s = this.shipState;
    let frame = 'helio';
    const near = (id) => camDist < 2.5 * sphereOfInfluence(id);
    const to = m.plan?.to;
    if (this.options.trailFrame !== 'helio') {
      if (this.focusId === 'earth' && near('earth')) frame = 'earth';
      else if (to && this.focusId === to && near(to)) frame = 'target';
      else if (this.focusId === 'spacecraft' && s?.central === 'earth' && near('earth')) frame = 'earth';
      else if (this.focusId === 'spacecraft' && to && s?.central === to && near(to)) frame = 'target';
      else if (this.focusId === 'spacecraft' && s && to) {
        const pr = this.pos[to];
        const pe = this.pos.earth;
        if (Math.hypot(s.r[0] - pe[0], s.r[1] - pe[1], s.r[2] - pe[2]) < sphereOfInfluence('earth') && near('earth')) frame = 'earth';
        else if (pr && Math.hypot(s.r[0] - pr[0], s.r[1] - pr[1], s.r[2] - pr[2]) < sphereOfInfluence(to) && near(to)) frame = 'target';
      }
    }
    this.trailFrame = frame;
    const cur = s ? s.r : null;
    this.writeSplit(this.helio, P.helioFlown, P.helioFuture, tSec, cur, origin, frame === 'helio');
    // 行星中心座標系：頂點為相對行星的位置，物件放在行星目前位置
    const relCur = (bodyId) => (s ? [s.r[0] - this.pos[bodyId][0], s.r[1] - this.pos[bodyId][1], s.r[2] - this.pos[bodyId][2]] : null);
    const zero = [0, 0, 0];
    toScene(P.depFlown.object.position, this.pos.earth, origin);
    P.depFuture.object.position.copy(P.depFlown.object.position);
    this.writeSplit(this.depRel, P.depFlown, P.depFuture, tSec, relCur('earth'), zero, frame === 'earth');
    if (to && this.arrRel) {
      toScene(P.arrFlown.object.position, this.pos[to], origin);
      P.arrFuture.object.position.copy(P.arrFlown.object.position);
      this.writeSplit(this.arrRel, P.arrFlown, P.arrFuture, tSec, relCur(to), zero, frame === 'target');
    } else {
      P.arrFlown.object.visible = false;
      P.arrFuture.object.visible = false;
    }
    // 捕獲後的環繞軌道
    const co = this.captureOrbit;
    co.object.visible = !!this.capturePts && frame === 'target';
    if (co.object.visible) {
      toScene(co.object.position, this.pos[to], origin);
      const pts = this.capturePts;
      const buf = this.buf;
      for (let k = 0; k <= 360; k++) {
        buf[3 * k] = pts[3 * k]; buf[3 * k + 1] = pts[3 * k + 2]; buf[3 * k + 2] = -pts[3 * k + 1];
      }
      co.write(buf, 361);
      co.material.opacity = tSec >= m.capture.t ? 0.8 : 0.3;
    }
  }

  updateMarkers(origin) {
    const plan = this.mission?.plan ?? this.planned;
    const show = !!plan && !!plan.to;
    const { depart, arrive } = this.markers;
    depart.visible = show;
    arrive.visible = show;
    if (!show) return;
    const r1 = plan.r1, r2 = plan.r2;
    toScene(depart.position, r1, origin);
    toScene(arrive.position, r2, origin);
    arrive.userData.text.textContent = `抵達時的${BODIES[plan.to].name}`;
    depart.userData.text.textContent = '出發時的地球';
    // 近距離時隱藏，避免與行星本體重疊
    const camDist = this.camera.position.length();
    depart.visible = camDist > 0.05 * AU_KM;
    arrive.visible = camDist > 0.05 * AU_KM;
  }

  /** 標籤避讓：依優先序放置，距離已放置標籤過近者隱藏。 */
  declutterLabels() {
    const show = this.options.labels;
    const placed = [];
    const items = [];
    const push = (id, obj, visible) => {
      if (!obj) return;
      obj.element.classList.toggle('is-hidden', !show || !visible);
      if (!show || !visible) return;
      items.push({ id, obj });
    };
    push('sun', this.sunLabel, true);
    for (const [id, e] of this.bodies) push(id, e.label, e.obj.group.visible);
    push('spacecraft', this.shipLabel, this.ship.group.visible);
    const v = this.tmp.v;
    items.sort((a, b) => {
      const pa = a.id === this.focusId ? -1 : LABEL_PRIORITY.indexOf(a.id);
      const pb = b.id === this.focusId ? -1 : LABEL_PRIORITY.indexOf(b.id);
      return pa - pb;
    });
    for (const it of items) {
      it.obj.getWorldPosition(v).project(this.camera);
      const x = (v.x * 0.5 + 0.5) * this.width;
      const y = (-v.y * 0.5 + 0.5) * this.height;
      const clash = placed.some((p) => Math.abs(p.x - x) < 46 && Math.abs(p.y - y) < 16);
      it.obj.element.classList.toggle('is-hidden', clash);
      it.obj.element.classList.toggle('is-focus', it.id === this.focusId);
      if (!clash) placed.push({ x, y });
    }
  }
}
