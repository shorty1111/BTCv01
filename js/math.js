export function mat4mul(a, b) {
  const out = new Float32Array(16);
  for (let i = 0; i < 4; ++i) {
    const ai0 = a[i],
      ai1 = a[i + 4],
      ai2 = a[i + 8],
      ai3 = a[i + 12];
    for (let j = 0, bj = 0; j < 4; ++j, bj += 4) {
      out[i + j * 4] =
        ai0 * b[bj] + ai1 * b[bj + 1] + ai2 * b[bj + 2] + ai3 * b[bj + 3];
    }
  }
  return out;
}

export function toRad(deg) {
  return (deg * Math.PI) / 180;
}
export function persp(fov, asp, n, f) {
  const t = Math.tan(toRad(fov) / 2);
  const nf = 1 / (n - f);
  return new Float32Array([
    1 / (asp * t),
    0,
    0,
    0,
    0,
    1 / t,
    0,
    0,
    0,
    0,
    (f + n) * nf,
    -1,
    0,
    0,
    2 * f * n * nf,
    0,
  ]);
}
export function mat4Translate(x, y, z) {
  return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1]);
}
export function look(eye, tgt, up) {
  // forward iz kamere ka meti
  const z = v3.norm(v3.sub(eye, tgt)); // gledanje nadole po osi
  const x = v3.norm(v3.cross(up, z)); // desno
  const y = v3.cross(z, x); // gore

  return new Float32Array([
    x[0],
    y[0],
    z[0],
    0,
    x[1],
    y[1],
    z[1],
    0,
    x[2],
    y[2],
    z[2],
    0,
    -v3.dot(x, eye),
    -v3.dot(y, eye),
    -v3.dot(z, eye),
    1,
  ]);
}

export function mat4Identity() {
  return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
}

// math.js  (ista pozicija)                  // DODAJ ↓↓↓
export function ortho(left, right, bottom, top, near, far) {
  return new Float32Array([
    2 / (right - left),
    0,
    0,
    0,
    0,
    2 / (top - bottom),
    0,
    0,
    0,
    0,
    -2 / (far - near),
    0,
    -(right + left) / (right - left),
    -(top + bottom) / (top - bottom),
    -(far + near) / (far - near),
    1,
  ]);
} // DODAJ ↑↑↑

export function quatToMat3(q) {
  const [x, y, z, w] = q;
  const xx = x * x,
    yy = y * y,
    zz = z * z;
  const xy = x * y,
    xz = x * z,
    yz = y * z;
  const wx = w * x,
    wy = w * y,
    wz = w * z;

  return [
    1 - 2 * (yy + zz),
    2 * (xy + wz),
    2 * (xz - wy),
    2 * (xy - wz),
    1 - 2 * (xx + zz),
    2 * (yz + wx),
    2 * (xz + wy),
    2 * (yz - wx),
    1 - 2 * (xx + yy),
  ];
}
export function composeTRS(t = [0, 0, 0], r = [0, 0, 0, 1], s = [1, 1, 1]) {
  const m3 = quatToMat3(r);
  return new Float32Array([
    m3[0] * s[0],
    m3[1] * s[0],
    m3[2] * s[0],
    0,
    m3[3] * s[1],
    m3[4] * s[1],
    m3[5] * s[1],
    0,
    m3[6] * s[2],
    m3[7] * s[2],
    m3[8] * s[2],
    0,
    t[0],
    t[1],
    t[2],
    1,
  ]);
}
export function computeBounds(pos) {
  let min = [Infinity, Infinity, Infinity];
  let max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pos.length; i += 3) {
    min[0] = Math.min(min[0], pos[i]);
    min[1] = Math.min(min[1], pos[i + 1]);
    min[2] = Math.min(min[2], pos[i + 2]);
    max[0] = Math.max(max[0], pos[i]);
    max[1] = Math.max(max[1], pos[i + 1]);
    max[2] = Math.max(max[2], pos[i + 2]);
  }
  return { min, max };
}
export function mulMat4Vec4(out, M, v) {
  // out vec4
  const x = v[0],
    y = v[1],
    z = v[2],
    w = v[3];
  out[0] = M[0] * x + M[4] * y + M[8] * z + M[12] * w;
  out[1] = M[1] * x + M[5] * y + M[9] * z + M[13] * w;
  out[2] = M[2] * x + M[6] * y + M[10] * z + M[14] * w;
  out[3] = M[3] * x + M[7] * y + M[11] * z + M[15] * w;
  return out;
}
export const v3 = {
  sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  cross: (a, b) => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ],
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  norm: (v) => {
    const l = Math.hypot(...v);
    return [v[0] / l, v[1] / l, v[2] / l];
  },
  scale: (v, s) => [v[0] * s, v[1] * s, v[2] * s], // ✅ dodaj ovu
};

export const mat4 = {
  invert: (out, a) => {
    const a00 = a[0],
      a01 = a[1],
      a02 = a[2],
      a03 = a[3],
      a10 = a[4],
      a11 = a[5],
      a12 = a[6],
      a13 = a[7],
      a20 = a[8],
      a21 = a[9],
      a22 = a[10],
      a23 = a[11],
      a30 = a[12],
      a31 = a[13],
      a32 = a[14],
      a33 = a[15];

    const b00 = a00 * a11 - a01 * a10;
    const b01 = a00 * a12 - a02 * a10;
    const b02 = a00 * a13 - a03 * a10;
    const b03 = a01 * a12 - a02 * a11;
    const b04 = a01 * a13 - a03 * a11;
    const b05 = a02 * a13 - a03 * a12;
    const b06 = a20 * a31 - a21 * a30;
    const b07 = a20 * a32 - a22 * a30;
    const b08 = a20 * a33 - a23 * a30;
    const b09 = a21 * a32 - a22 * a31;
    const b10 = a21 * a33 - a23 * a31;
    const b11 = a22 * a33 - a23 * a32;

    // Det = Σ of products
    let det =
      b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
    if (!det) return null;
    det = 1.0 / det;

    out[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det;
    out[1] = (-a01 * b11 + a02 * b10 - a03 * b09) * det;
    out[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det;
    out[3] = (-a21 * b05 + a22 * b04 - a23 * b03) * det;
    out[4] = (-a10 * b11 + a12 * b08 - a13 * b07) * det;
    out[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
    out[6] = (-a30 * b05 + a32 * b02 - a33 * b01) * det;
    out[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det;
    out[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det;
    out[9] = (-a00 * b10 + a01 * b08 - a03 * b06) * det;
    out[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det;
    out[11] = (-a20 * b04 + a21 * b02 - a23 * b00) * det;
    out[12] = (-a10 * b09 + a11 * b07 - a12 * b06) * det;
    out[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det;
    out[14] = (-a30 * b03 + a31 * b01 - a32 * b00) * det;
    out[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;

    return out;
  },
};
