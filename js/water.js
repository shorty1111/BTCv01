// water.js

import { createShaderProgram } from "./shader.js";
import { mat4Identity } from "./math.js";
import { TEXTURE_SLOTS, bindTextureToSlot } from "./texture-slots.js"; 

// === Seedovani RNG (da talasi uvek budu isti) ===
function makeRNG(seed = 1234) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

const WATER_CONFIG = {
  centerSize: 100.0,  // fizička veličina centralnog patcha
  centerDiv: 120,     // gustina centralnog patcha (vertexi po ivici)
  ringCount: 12,       // koliko "prstenova" mreže oko centralnog
  ringDivFalloff: 0.5 // koliko % opada gustina (0.5 = 50%)
};

let waterProgram = null;
let vao = null;
let waterNormalTex = null;

// --- OPTIMIZOVANO BINDOVANJE TEKSTURA ---
// pamti zadnju teksturu po slotu, da se ne radi gl.bindTexture bez potrebe
const boundTex = Array(16).fill(null);

function safeBindTex(gl, unit, target, tex) {
  if (!gl || !tex) return; // zaštita ako se pozove prerano
  if (boundTex[unit] !== tex) {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(target, tex);
    boundTex[unit] = tex;
  }
}

// resetuje cache kada se menjaju FBO-ovi ili rezolucija
export function resetBoundTextures() {
  boundTex.fill(null);
}
let waterUniforms = {};

function createWaterGrid(tileSize = 100.0, div = 200) {
  const verts = [];
  const inds = [];
  const uvScale = 1.0 / tileSize;

  const step = tileSize / div;
  const half = tileSize * 0.5;
  const row = div + 1;

  // === VERTEXI ===
  for (let iz = 0; iz <= div; iz++) {
    const z = -half + iz * step;
    const zv = z * uvScale;
    for (let ix = 0; ix <= div; ix++) {
      const x = -half + ix * step;
      const xv = x * uvScale;

      // waveMask = 1.0 za sve (po želji možeš kasnije ubaciti fade ka ivicama)
      verts.push(x, 0, z, xv, zv, 1.0);
    }
  }

  // === INDEKSI ===
  for (let iz = 0; iz < div; iz++) {
    const base = iz * row;
    for (let ix = 0; ix < div; ix++) {
      const i0 = base + ix;
      const i1 = i0 + 1;
      const i2 = i0 + row;
      inds.push(i0, i1, i2, i1, i2 + 1, i2);
    }
  }

 return {
    vertices: new Float32Array(verts),
    indices:
      verts.length / 3 > 65535 ? new Uint32Array(inds) : new Uint16Array(inds),
  };
}

function createWaterRings(cfg = WATER_CONFIG) {
  const { centerSize, centerDiv, ringCount, ringDivFalloff } = cfg;
  const rings = [];
  const step = centerSize; // svi gridovi su iste fizičke veličine

  // prolazimo kroz kvadratnu mrežu (2*ringCount + 1) × (2*ringCount + 1)
  for (let z = -ringCount; z <= ringCount; z++) {
    for (let x = -ringCount; x <= ringCount; x++) {
      const dist = Math.max(Math.abs(x), Math.abs(z)); // udaljenost od centra
      const div = Math.max(4, Math.floor(centerDiv * Math.pow(ringDivFalloff, dist)));

      rings.push({
        grid: createWaterGrid(centerSize, div),
        offset: [x * step, z * step], // pozicioniraj mreže oko centra
      });
    }
  }
  return rings;
}

function generateWaveSet(
  {
    largeAmp = 0.03,
    largeCount = 3,
    midAmp = 0.015,
    midCount = 10,
    smallAmp = 0.005,
    smallCount = 8,
  } = {},
  seed = 1234,
  windAngle = Math.PI * 0.25
) {
  const waves = [];
  const rnd = makeRNG(seed);

  function randomDir() {
    const a = windAngle + (rnd() - 0.5) * Math.PI * 1.1; // ograniči oko glavnog pravca
    return [Math.cos(a), Math.sin(a)];
  }

  function addWave(A, Lbase, Qbase) {
    const Avar = A * (2.5 + rnd() * 0.6); // veća raznolikost
    const L = Lbase * (2.5 + rnd() * 1.2); // realni rasponi dužina
    const Q = Qbase * (2.6 + rnd() * 0.8); // choppiness varijacija
    const dir = randomDir();
    const phase = rnd() * Math.PI * 2;
    const speedJitter = 0.5 + rnd() * 2.0;

    waves.push({ A: Avar, L, Q, dir, phase, speedJitter });
  }

  // Spori, dugi swells
  for (let i = 0; i < largeCount; i++) {
    addWave(largeAmp, 0.5 + rnd() * 1.0, 0.2 + rnd() * 0.10);
  }

  // Glavni chop
  for (let i = 0; i < midCount; i++) {
    addWave(midAmp, 0.5 + rnd() * 10.0, 0.2 + rnd() * 0.1);
  }

  // Mikro ripples
  for (let i = 0; i < smallCount; i++) {
    addWave(smallAmp, 1.1 + rnd() * 2.5, 0.5 + rnd() * 0.5);
  }

  return waves;
}

const waveSetA = generateWaveSet(
  {
    largeAmp: 0.005, // duži, jedva vidljivi valovi (spori swells)
    largeCount: 3,

    midAmp: 0.01, // glavni “chop”, realni pokret vode
    midCount: 6,

    smallAmp: 0.015, // fini mikrovalovi što daju svetlucanje
    smallCount: 6,
  },
  31211122222,
 Math.PI * 0.75);


// SPOJI
const waveSet = [...waveSetA.slice(0, 8)];
// 3. Helper za upload
function uploadWaveSet(gl, program, waveSet) {
  const count = waveSet.length;
  gl.uniform1i(waterUniforms.uWaveCount, count);

  const omega = waveSet.map(w => omegaFromL(w.L));
  const A = waveSet.map(w => w.A);
  const L = waveSet.map(w => w.L);
  const Q = waveSet.map(w => w.Q);
  const dir = waveSet.flatMap(w => w.dir);
  const phase = waveSet.map(w => w.phase);
  const speed = waveSet.map(w => w.speedJitter || 1.0);

  gl.uniform1fv(waterUniforms.uWaveOmega, omega);
  gl.uniform1fv(waterUniforms.uWaveA, A);
  gl.uniform1fv(waterUniforms.uWaveL, L);
  gl.uniform1fv(waterUniforms.uWaveQ, Q);
  gl.uniform2fv(waterUniforms.uWaveDir, dir);
  gl.uniform1fv(waterUniforms.uWavePhase, phase);
  gl.uniform1fv(waterUniforms.uWaveSpeedJitter, speed);
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
  // --- CACHE SVIH UNIFORM LOKACIJA ---
  const uniformNames = [
    "uProjection", "uView", "uModel", "uTime", "uBoatPos",
    "uGlobalSpeed", "uCameraPos", "uSunDir", "uSunColor",
    "uSunIntensity", "uOpacity", "uRoughness", "uSpecularStrength",
    "uWaterLevel", "uBottomOffsetM", "uCubeMaxMip", "uWaterNormal",
    "uEnvTex", "uSceneDepth", "uSceneColor", "uReflectionTex",
    "uReflectionMatrix", "uWaterHeight", "uNear", "uFar", "uViewportSize",
    "uShallowColor", "uDeepColor", "uShadowMap", "uLightVP",
    "uGridOffset", 
    "uGlobalExposure" // 👈 DODAJ OVDE
  ];

  for (const name of uniformNames) {
    waterUniforms[name] = gl.getUniformLocation(waterProgram, name);
  }

  // --- DODAJ I UNIFORME ZA TALASE (WAVES) ---
const waveUniforms = [
  "uWaveCount",
  "uWaveOmega",
  "uWaveA",
  "uWaveL",
  "uWaveQ",
  "uWaveDir",
  "uWavePhase",
  "uWaveSpeedJitter"
];

for (const name of waveUniforms) {
  waterUniforms[name] = gl.getUniformLocation(waterProgram, name);
}
const ringData = createWaterRings(WATER_CONFIG);
// izračunaj ukupan broj verteksa
let totalVerts = 0;
for (const { grid } of ringData) {
  totalVerts += grid.vertices.length / 6; // svaki vertex ima 6 float-ova
}
console.log(`[WATER] Ukupno verteksa: ${totalVerts.toLocaleString()}`);
vao = []; // niz svih ploča

for (const { grid, offset } of ringData) {
  const vaoObj = gl.createVertexArray();
  gl.bindVertexArray(vaoObj);

  const vbo = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, grid.vertices, gl.STATIC_DRAW);

  const ebo = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ebo);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, grid.indices, gl.STATIC_DRAW);

  const stride = 6 * 4;
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, stride, 0);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 2, gl.FLOAT, false, stride, 3 * 4);
  gl.enableVertexAttribArray(2);
  gl.vertexAttribPointer(2, 1, gl.FLOAT, false, stride, 5 * 4);

vao.push({
  vao: vaoObj,
  count: grid.indices.length,
  offset: offset,
  indexType: (grid.indices instanceof Uint32Array) ? 32 : 16,
});
}

gl.bindVertexArray(null);



  gl.useProgram(waterProgram);
  gl.uniformMatrix4fv(waterUniforms.uModel, false, mat4Identity());
  uploadWaveSet(gl, waterProgram, waveSet);
  waterNormalTex = loadTexture2D(gl, "assets/water_normal.png");
    // === STATIČNI UNIFORMI (mogu preći u initWater ako želiš još više performansi) ===
  gl.uniform1i(waterUniforms.uWaterNormal, TEXTURE_SLOTS.WATER_NORMAL);
  gl.uniform1i(waterUniforms.uEnvTex, TEXTURE_SLOTS.WATER_ENV_MAP);
  gl.uniform1i(waterUniforms.uSceneDepth, TEXTURE_SLOTS.WATER_SCENE_DEPTH);
  gl.uniform1i(waterUniforms.uSceneColor, TEXTURE_SLOTS.WATER_SCENE_COLOR);
  gl.uniform1i(waterUniforms.uReflectionTex, TEXTURE_SLOTS.WATER_REFLECTION);
  gl.uniform1i(waterUniforms.uShadowMap, TEXTURE_SLOTS.WATER_SHADOW_MAP);

  gl.uniform1f(waterUniforms.uOpacity, 1.0);
  gl.uniform1f(waterUniforms.uRoughness, 0.02);
  gl.uniform1f(waterUniforms.uSpecularStrength, 1.0);
  gl.uniform1f(waterUniforms.uWaterLevel, 0.0);
  gl.uniform1f(waterUniforms.uBottomOffsetM, 4.0);
  gl.uniform1f(waterUniforms.uCubeMaxMip, 8.0);
  gl.uniform3fv(waterUniforms.uShallowColor, [0.2, 0.85, 0.7]);
  gl.uniform3fv(waterUniforms.uDeepColor, [0.02, 0.035, 0.05]);
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
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    gl.bindTexture(gl.TEXTURE_2D, tex);
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
  reflectionTex,
  reflProjView
) {
  
  if (!waterProgram) return;

  gl.useProgram(waterProgram);


  // === MATRICE ===
  gl.uniformMatrix4fv(waterUniforms.uProjection, false, proj);
  gl.uniformMatrix4fv(waterUniforms.uView, false, view);

  // === DINAMIČNI UNIFORMI ===
  gl.uniform1f(waterUniforms.uTime, timeSec);
  gl.uniform3fv(waterUniforms.uBoatPos, boatWorldPos);
  gl.uniform1f(waterUniforms.uGlobalSpeed, 1.0);
  gl.uniform3fv(waterUniforms.uCameraPos, camWorld);
  gl.uniform3fv(waterUniforms.uSunDir, sunDir);
  gl.uniform3fv(waterUniforms.uSunColor, sunColor);
  gl.uniform1f(waterUniforms.uSunIntensity, sunIntensity);
  gl.uniform1f(waterUniforms.uGlobalExposure, window.globalExposure);


  // === TEKSTURE (optimizovano) ===
  boundTex.fill(null); // resetuj cache da ne preskoči novi reflectionTex
  bindTextureToSlot(gl, waterNormalTex, TEXTURE_SLOTS.WATER_NORMAL);
  safeBindTex(gl, TEXTURE_SLOTS.WATER_ENV_MAP, gl.TEXTURE_CUBE_MAP, envTex);
  const depthTexture = sceneDepthTex || window.finalDepthTex;
  safeBindTex(gl, TEXTURE_SLOTS.WATER_SCENE_DEPTH, gl.TEXTURE_2D, depthTexture);
  safeBindTex(gl, TEXTURE_SLOTS.WATER_SCENE_COLOR, gl.TEXTURE_2D, finalSceneTex);
  safeBindTex(gl, TEXTURE_SLOTS.WATER_REFLECTION, gl.TEXTURE_2D, reflectionTex);
  gl.uniformMatrix4fv(waterUniforms.uReflectionMatrix, false, reflProjView);

// 👇 dodaj ovo:
if (window.reflectionSize) {
  const sx = window.reflectionSize[0] / gl.canvas.width;
  const sy = window.reflectionSize[1] / gl.canvas.height;
  const loc = gl.getUniformLocation(waterProgram, "uReflectionScale");
  if (loc) gl.uniform2f(loc, sx, sy);
}
  // === OSTALO ===
  gl.uniform1f(waterUniforms.uWaterHeight, 0.0);
  gl.uniform1f(waterUniforms.uNear, nearPlane);
  gl.uniform1f(waterUniforms.uFar, farPlane);
  gl.uniform2fv(waterUniforms.uViewportSize, viewportSize);

  // === SENKA (optimizovano) ===
  safeBindTex(gl, 8, gl.TEXTURE_2D, shadowDepthTex);
  gl.uniform1i(waterUniforms.uShadowMap, 8);
  gl.uniformMatrix4fv(waterUniforms.uLightVP, false, lightVP);


  // === CRTANJE VODE ===
  gl.enable(gl.CULL_FACE);
  gl.cullFace(gl.FRONT); // možeš menjati na BACK po potrebi
for (const ring of vao) {
  gl.uniform2fv(waterUniforms.uGridOffset, ring.offset);
  gl.bindVertexArray(ring.vao);

  const indexType = (ring.indexType === 32) ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT;
  gl.drawElements(gl.TRIANGLES, ring.count, indexType, 0);
}
  // === VRATI STANJE ===
  gl.disable(gl.CULL_FACE);
  gl.disable(gl.BLEND);
  gl.depthMask(true);
  gl.depthFunc(gl.LESS);
  gl.bindVertexArray(null);
}
