// 線條工具：軌道線（1px）與可逐格更新的粗線（Line2，用於太空船軌跡）。

import * as THREE from 'three';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';

/** 軌道線：頂點相對於物件位置，於每格重新寫入。 */
export class OrbitLine {
  constructor(color, maxPoints = 721, opacity = 0.55) {
    this.maxPoints = maxPoints;
    this.positions = new Float32Array(maxPoints * 3);
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    geom.setDrawRange(0, 0);
    this.material = new THREE.LineBasicMaterial({ color: new THREE.Color(color), transparent: true, opacity, depthWrite: false });
    this.object = new THREE.Line(geom, this.material);
    this.object.frustumCulled = false;
  }

  /** points：Float64Array/陣列（場景座標，已相對物件位置），n 個點。 */
  write(points, n) {
    const m = Math.min(n, this.maxPoints);
    for (let i = 0; i < 3 * m; i++) this.positions[i] = points[i];
    const g = this.object.geometry;
    g.attributes.position.needsUpdate = true;
    g.setDrawRange(0, m);
  }
}

/**
 * 粗線路徑（螢幕像素寬度）。直接改寫 Line2 內部的 instance 緩衝區以避免每格配置記憶體。
 */
export class PathLine {
  constructor({ color, width = 2, opacity = 1, dashed = false, maxPoints = 8192 } = {}) {
    this.maxPoints = maxPoints;
    const geom = new LineGeometry();
    geom.setPositions(new Float32Array(maxPoints * 3));
    this.material = new LineMaterial({
      color: new THREE.Color(color).getHex(),
      linewidth: width,
      transparent: opacity < 1,
      opacity,
      dashed,
      dashSize: 1,
      gapSize: 1,
      depthWrite: false,
    });
    this.object = new Line2(geom, this.material);
    this.object.frustumCulled = false;
    this.object.renderOrder = 2;
    this.segments = geom.attributes.instanceStart.data.array;
    geom.instanceCount = 0;
    if (dashed) {
      this.distBuf = new THREE.InstancedInterleavedBuffer(new Float32Array(maxPoints * 2), 2, 1);
      geom.setAttribute('instanceDistanceStart', new THREE.InterleavedBufferAttribute(this.distBuf, 1, 0));
      geom.setAttribute('instanceDistanceEnd', new THREE.InterleavedBufferAttribute(this.distBuf, 1, 1));
    }
  }

  setResolution(w, h) {
    this.material.resolution.set(w, h);
  }

  /** 寫入 n 個點（場景座標，Float64 以減法後再轉 Float32）。 */
  write(points, n) {
    const m = Math.min(n, this.maxPoints);
    const s = this.segments;
    let k = 0;
    for (let i = 0; i < m - 1; i++) {
      s[k] = points[3 * i]; s[k + 1] = points[3 * i + 1]; s[k + 2] = points[3 * i + 2];
      s[k + 3] = points[3 * i + 3]; s[k + 4] = points[3 * i + 4]; s[k + 5] = points[3 * i + 5];
      k += 6;
    }
    const g = this.object.geometry;
    g.attributes.instanceStart.data.needsUpdate = true;
    g.instanceCount = Math.max(0, m - 1);
    if (this.distBuf) {
      const d = this.distBuf.array;
      let acc = 0;
      for (let i = 0; i < m - 1; i++) {
        const dx = points[3 * i + 3] - points[3 * i], dy = points[3 * i + 4] - points[3 * i + 1], dz = points[3 * i + 5] - points[3 * i + 2];
        d[2 * i] = acc;
        acc += Math.hypot(dx, dy, dz);
        d[2 * i + 1] = acc;
      }
      this.distBuf.needsUpdate = true;
    }
  }

  setDash(size, gap) {
    this.material.dashSize = size;
    this.material.gapSize = gap;
  }
}
