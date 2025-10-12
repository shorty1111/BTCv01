// water.js

import { createShaderProgram } from "./shader.js";
import { mat4Identity } from "./math.js";

// === Seedovani RNG (da talasi uvek budu isti) ===
function makeRNG(seed = 1234) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

let waterProgram = null;
let vao = null;
let waterNormalTex = null;
let indexCount = 0;

function createSmartAdaptiveGrid(
  tileSize = 100.0, // fizička veličina svakog patcha
  baseDiv = 120, // broj deljenja centralnog patcha
  ringCount = 4, // koliko “krugova” oko centra
  lodFalloff = 0.7 // 30% manje poligona po ringu
) {
  const verts = [];
  const inds = [];
  const uvScale = 1.0 / tileSize; // world-based UV

  // pomočna funkcija za dodavanje jednog patcha
  function addPatch(x0, z0, div) {
    const startIndex = verts.length / 6;
    const step = tileSize / div;

    for (let iz = 0; iz <= div; iz++) {
      const z = z0 + iz * step;
      for (let ix = 0; ix <= div; ix++) {
        const x = x0 + ix * step;
        const u = x * uvScale;
        const v = z * uvScale;
        verts.push(x, 0, z, u, v, 1.0);
      }
    }

    const row = div + 1;
    for (let iz = 0; iz < div; iz++) {
      const a = startIndex + iz * row;
      for (let ix = 0; ix < div; ix++) {
        const i0 = a + ix;
        const i1 = i0 + 1;
        const i2 = i0 + row;
        const i3 = i2 + 1;
        inds.push(i0, i1, i2);
        inds.push(i1, i3, i2);
      }
    }
  }

  // === CENTRALNI PATCH (C) ===
  addPatch(-tileSize * 0.5, -tileSize * 0.5, baseDiv);

  // === RINGOVI OKO CENTRA ===
  for (let ring = 1; ring <= ringCount; ring++) {
    const div = Math.max(2, Math.floor(baseDiv * Math.pow(lodFalloff, ring)));
    const offset = tileSize * ring;

    for (let iz = -ring; iz <= ring; iz++) {
      for (let ix = -ring; ix <= ring; ix++) {
        const maxR = Math.max(Math.abs(ix), Math.abs(iz));
        if (maxR !== ring) continue; // samo spoljašnji okvir ringu

        const x0 = ix * tileSize - tileSize * 0.5;
        const z0 = iz * tileSize - tileSize * 0.5;
        addPatch(x0, z0, div);
      }
    }
  }

  return {
    vertices: new Float32Array(verts),
    indices:
      verts.length / 3 > 65535 ? new Uint32Array(inds) : new Uint16Array(inds),
  };
}

function generateWaveSet(
  {
    largeAmp = 0.02,
    largeCount = 2,
    midAmp = 0.08,
    midCount = 10,
    smallAmp = 0.015,
    smallCount = 6,
  } = {},
  seed = 1234
) {
  const waves = [];
  const rnd = makeRNG(seed);

  function randomDir() {
    const a = rnd() * Math.PI * 2;
    return [Math.cos(a), Math.sin(a)];
  }

  function addWave(A, Lbase, Qbase) {
    const Avar = A * (0.4 + rnd() * 1.5); // amplitude raznolikost
    const L = Lbase * (0.5 + rnd() * 1.8); // dužina talasa
    const Q = Qbase * (0.5 + rnd() * 2.0); // choppiness
    const dir = randomDir();
    const phase = rnd() * Math.PI * 2;
    const speedJitter = 0.5 + rnd() * 1.5;

    waves.push({ A: Avar, L, Q, dir, phase, speedJitter });
  }

  // Veći swell talasi — masivni ali spori
  for (let i = 0; i < largeCount; i++) {
    addWave(largeAmp, 50 + rnd() * 50, 0.4 + rnd() * 0.4);
  }

  // Srednji chop talasi
  for (let i = 0; i < midCount; i++) {
    addWave(midAmp, 8 + rnd() * 25, 0.5 + rnd() * 0.6);
  }

  // Sitni ripples
  for (let i = 0; i < smallCount; i++) {
    addWave(smallAmp, 0.5 + rnd() * 2.5, 0.3 + rnd() * 2.0);
  }

  return waves;
}

const waveSetA = generateWaveSet(
  {
    largeAmp: 0.025,
    largeCount: 3,
    midAmp: 0.04,
    midCount: 10,
    smallAmp: 0.02, // <-- OVO JE KLJUČNO!
    smallCount: 6, // <-- OVO JE KLJUČNO!
  },
  12345
);

const waveSetB = generateWaveSet(
  {
    largeAmp: 0.017,
    largeCount: 2,
    midAmp: 0.04,
    midCount: 8,
    smallAmp: 0.01,
    smallCount: 6,
  },
  6789
);
// SPOJI
const waveSet = [...waveSetA.slice(0, 16), ...waveSetB.slice(0, 16)];
// 3. Helper za upload
function uploadWaveSet(gl, program, waveSet) {
  const count = waveSet.length;
  gl.uniform1i(gl.getUniformLocation(program, "uWaveCount"), count);

  const omega = waveSet.map((w) => omegaFromL(w.L));
  const A = waveSet.map((w) => w.A);
  const L = waveSet.map((w) => w.L);
  const Q = waveSet.map((w) => w.Q);
  const dir = waveSet.flatMap((w) => w.dir);
  const phase = waveSet.map((w) => w.phase);
  const speed = waveSet.map((w) => w.speedJitter || 1.0);

  gl.uniform1fv(gl.getUniformLocation(program, "uWaveOmega"), omega);
  gl.uniform1fv(gl.getUniformLocation(program, "uWaveA"), A);
  gl.uniform1fv(gl.getUniformLocation(program, "uWaveL"), L);
  gl.uniform1fv(gl.getUniformLocation(program, "uWaveQ"), Q);
  gl.uniform2fv(gl.getUniformLocation(program, "uWaveDir"), dir);
  gl.uniform1fv(gl.getUniformLocation(program, "uWavePhase"), phase);
  gl.uniform1fv(gl.getUniformLocation(program, "uWaveSpeedJitter"), speed);
}

const G = 9.81;
function omegaFromL(L) {
  const k = (2.0 * Math.PI) / L;
  let omega = Math.sqrt(G * k);

  // Ako su talasi baš mali, smanji brzinu
  if (L < 5.0) {
    omega *= 0.25; // uspori 4x
  }

  return omega;
}

// === inicijalizacija vode ===
export async function initWater(gl) {
  gl.getExtension("OES_element_index_uint");

  const vsSource = await fetch("shaders/water.vert").then((r) => r.text());
  const fsSource = await fetch("shaders/water.frag").then((r) => r.text());

  waterProgram = createShaderProgram(gl, vsSource, fsSource);

  // generiši adaptivni grid
  const grid = createSmartAdaptiveGrid(50.0, 500, 1, 0.5);
  console.log(
    "Vertex count:",
    grid.vertices.length / 6, // 6 float-ova po verteksu
    "Triangle count:",
    grid.indices.length / 3
  );
  const vertices = grid.vertices;
  const indices = grid.indices;
  indexCount = indices.length;

  vao = gl.createVertexArray();
  gl.bindVertexArray(vao);

  const vbo = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);

  const ebo = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ebo);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);

  // sada svaki vertex = (x, y, z, u, v, waveMask) = 6 float-ova
  const stride = 6 * 4; // 6 float-a * 4 bajta = 24 bajta

  // aPos → lokacija 0
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, stride, 0);

  // aUV → lokacija 1
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 2, gl.FLOAT, false, stride, 3 * 4);

  // aWaveMask → lokacija 2 (novi atribut)
  gl.enableVertexAttribArray(2);
  gl.vertexAttribPointer(2, 1, gl.FLOAT, false, stride, 5 * 4);

  gl.bindVertexArray(null);
  gl.useProgram(waterProgram);
  uploadWaveSet(gl, waterProgram, waveSet);
  waterNormalTex = loadTexture2D(gl, "assets/water_normal.jpg");
}

// === helper za učitavanje 2D teksture ===
function loadTexture2D(gl, url) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
  gl.texParameteri(
    gl.TEXTURE_2D,
    gl.TEXTURE_MIN_FILTER,
    gl.LINEAR_MIPMAP_LINEAR
  );
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA,
    1,
    1,
    0,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    new Uint8Array([0, 0, 255, 255])
  );

  const img = new Image();
  img.onload = () => {
    gl.bindTexture(gl.TEXTURE_2D, tex);
    // učitaj teksturu kao linearnu, bez sRGB dekodiranja
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGB8, // linearni 8-bitni format
      gl.RGB,
      gl.UNSIGNED_BYTE,
      img
    );
    gl.generateMipmap(gl.TEXTURE_2D);
  };
  img.src = url;

  return tex;
}

// === crtanje vode ===

export function drawWater(
  gl,
  proj,
  view,
  camWorld,
  boatWorldPos,
  envTex,
  sunDir,
  sunColor,
  sunIntensity,
  timeSec,
  sceneDepthTex,
  finalSceneTex,
  nearPlane,
  farPlane,
  viewportSize,
  shadowDepthTex,
  lightVP,
  reflectionTex, // <--- DODAJ OVO!
  reflProjView // <--- DODAJ OVO!
) {
  if (!waterProgram) return;

  gl.useProgram(waterProgram);

  gl.bindVertexArray(vao);

  gl.uniformMatrix4fv(
    gl.getUniformLocation(waterProgram, "uProjection"),
    false,
    proj
  );
  gl.uniformMatrix4fv(
    gl.getUniformLocation(waterProgram, "uView"),
    false,
    view
  );
  gl.uniformMatrix4fv(
    gl.getUniformLocation(waterProgram, "uModel"),
    false,
    mat4Identity()
  );

  gl.uniform1f(gl.getUniformLocation(waterProgram, "uTime"), timeSec);
  gl.uniform3fv(gl.getUniformLocation(waterProgram, "uBoatPos"), boatWorldPos);
  gl.uniform1f(gl.getUniformLocation(waterProgram, "uGlobalSpeed"), 1.0); // probaj 0.5–1.0
  gl.uniform3fv(gl.getUniformLocation(waterProgram, "uCameraPos"), camWorld);
  gl.uniform3fv(gl.getUniformLocation(waterProgram, "uSunDir"), sunDir);
  gl.uniform3fv(gl.getUniformLocation(waterProgram, "uSunColor"), sunColor);
  gl.uniform1f(
    gl.getUniformLocation(waterProgram, "uSunIntensity"),
    sunIntensity
  );

  gl.uniform1f(gl.getUniformLocation(waterProgram, "uOpacity"), 1.0);
  gl.uniform1f(gl.getUniformLocation(waterProgram, "uRoughness"), 0.03);
  gl.uniform1f(gl.getUniformLocation(waterProgram, "uSpecularStrength"), 1.0);
  gl.uniform1f(gl.getUniformLocation(waterProgram, "uWaterLevel"), 0.0);
  gl.uniform1f(gl.getUniformLocation(waterProgram, "uBottomOffsetM"), 1.0);

  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, waterNormalTex);
  gl.uniform1i(gl.getUniformLocation(waterProgram, "uWaterNormal"), 0);

  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_CUBE_MAP, envTex);
  gl.uniform1i(gl.getUniformLocation(waterProgram, "uEnvTex"), 1);
  gl.activeTexture(gl.TEXTURE2);
  gl.bindTexture(gl.TEXTURE_2D, sceneDepthTex);
  gl.uniform1i(gl.getUniformLocation(waterProgram, "uSceneDepth"), 2);
  gl.activeTexture(gl.TEXTURE3);
  gl.bindTexture(gl.TEXTURE_2D, finalSceneTex);
  gl.uniform1i(gl.getUniformLocation(waterProgram, "uSceneColor"), 3);

  gl.activeTexture(gl.TEXTURE4);
  gl.bindTexture(gl.TEXTURE_2D, reflectionTex);
  gl.uniform1i(gl.getUniformLocation(waterProgram, "uReflectionTex"), 4);
  gl.uniformMatrix4fv(
    gl.getUniformLocation(waterProgram, "uReflectionMatrix"),
    false,
    reflProjView
  );

  gl.uniform1f(gl.getUniformLocation(waterProgram, "uWaterHeight"), 0.0);
  gl.uniform1f(gl.getUniformLocation(waterProgram, "uNear"), nearPlane);
  gl.uniform1f(gl.getUniformLocation(waterProgram, "uFar"), farPlane);
  gl.uniform2fv(
    gl.getUniformLocation(waterProgram, "uViewportSize"),
    viewportSize
  );
  // Shallow
  gl.uniform3fv(
    gl.getUniformLocation(waterProgram, "uShallowColor"),
    [0.2, 0.85, 0.7]
  ); // #2FC8A1

  // Deep
  gl.uniform3fv(
    gl.getUniformLocation(waterProgram, "uDeepColor"),
    [0.0, 0.0, 0.0]
  ); // #09182cff
  // --- SHADOW MAP UNIFORME ---  // PRE drawElements!!!
  gl.activeTexture(gl.TEXTURE8);
  gl.bindTexture(gl.TEXTURE_2D, shadowDepthTex);
  gl.uniform1i(gl.getUniformLocation(waterProgram, "uShadowMap"), 8);
  gl.uniformMatrix4fv(
    gl.getUniformLocation(waterProgram, "uLightVP"),
    false,
    lightVP
  );

  // === CRTANJE VODE ===
  gl.enable(gl.CULL_FACE);
  gl.cullFace(gl.FRONT); // ili gl.FRONT, probaj po potrebi

  gl.drawElements(gl.TRIANGLES, indexCount, gl.UNSIGNED_INT, 0);
  gl.disable(gl.CULL_FACE);
  // ✅ VRATI STANJE
  gl.disable(gl.BLEND);
  gl.depthMask(true);
  gl.depthFunc(gl.LESS);

  gl.bindVertexArray(null);
}
