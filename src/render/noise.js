// 可重現（seeded）的 3D 值雜訊與分形布朗運動 (fBm)，用於程序化生成行星貼圖。
// 在球面上取樣三維雜訊，貼圖左右邊界與兩極都不會出現接縫。

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rand() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeNoise3(seed = 1) {
  const rand = mulberry32(seed);
  const perm = new Uint8Array(512);
  const vals = new Float32Array(256);
  const p = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [p[i], p[j]] = [p[j], p[i]];
  }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  for (let i = 0; i < 256; i++) vals[i] = rand() * 2 - 1;

  const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);

  /** 值雜訊，輸出約 [-1, 1]。 */
  function noise(x, y, z) {
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
    const xf = x - xi, yf = y - yi, zf = z - zi;
    const X = xi & 255, Y = yi & 255, Z = zi & 255;
    const u = fade(xf), v = fade(yf), w = fade(zf);
    const a = perm[X] + Y, b = perm[X + 1] + Y;
    const aa = perm[a] + Z, ab = perm[a + 1] + Z, ba = perm[b] + Z, bb = perm[b + 1] + Z;
    const x1 = vals[perm[aa]] + u * (vals[perm[ba]] - vals[perm[aa]]);
    const x2 = vals[perm[ab]] + u * (vals[perm[bb]] - vals[perm[ab]]);
    const x3 = vals[perm[aa + 1]] + u * (vals[perm[ba + 1]] - vals[perm[aa + 1]]);
    const x4 = vals[perm[ab + 1]] + u * (vals[perm[bb + 1]] - vals[perm[ab + 1]]);
    const y1 = x1 + v * (x2 - x1);
    const y2 = x3 + v * (x4 - x3);
    return y1 + w * (y2 - y1);
  }

  /** 分形布朗運動。 */
  function fbm(x, y, z, octaves = 5, lacunarity = 2.03, gain = 0.5) {
    let amp = 0.5, freq = 1, sum = 0, norm = 0;
    for (let o = 0; o < octaves; o++) {
      sum += amp * noise(x * freq, y * freq, z * freq);
      norm += amp;
      amp *= gain;
      freq *= lacunarity;
    }
    return sum / norm;
  }

  return { noise, fbm };
}
