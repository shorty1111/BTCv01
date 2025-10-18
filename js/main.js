import { createShaderProgram } from "./shader.js";
import { initWater, drawWater } from "./water.js";
import { initSky, drawSky, bakeSkyToCubemap } from "./sky.js";
import { DEFAULT_SKY } from "./sky.js";
import {
  MAX_FPS,
  DEFAULT_MODEL,
  BASE_PRICE,
  PART_PRICES,
  VARIANT_GROUPS,
  BOAT_INFO,
} from "./config.js";

import {
  mat4mul,
  persp,
  ortho,
  look,
  composeTRS,
  computeBounds,
  mulMat4Vec4,
  v3,
} from "./math.js";

let acesProgram = null;
let finalFBO = null;
let finalColorTex = null;

// CENTRALNO SUNCE
const SUN = {
  dir: v3.norm([-0.8,0.8, 0.9]), // položaj
  color: [1.0, 0.92, 0.76],
  intensity: 0.0, // jačina
};

updateSun();

function updateSun() {
  const alt = Math.max(-1.0, Math.min(1.0, SUN.dir[1]));

  // === 1️⃣  Boja (topliji ton pri zalasku) ===
  const dayColor = [1.0, 0.97, 0.94];
  const sunsetColor = [1.0, 0.35, 0.1];
  const tColor = smoothstep(0.0, 0.6, alt);
  SUN.color = [
    sunsetColor[0] + (dayColor[0] - sunsetColor[0]) * tColor,
    sunsetColor[1] + (dayColor[1] - sunsetColor[1]) * tColor,
    sunsetColor[2] + (dayColor[2] - sunsetColor[2]) * tColor,
  ];

  // === 2️⃣  Fade postojećeg intenziteta (bez maxIntensity) ===
  const fade = Math.pow(Math.max(alt, 0.0), 0.4);
  SUN.intensity = 1.0 * fade; // ili tvoj faktor

  // === 3️⃣  Afterglow — refleks ispod horizonta ===
  if (alt < 0.0) {
    const glow = smoothstep(-0.3, 0.0, alt);
    SUN.color = [
      SUN.color[0] * (0.4 + 0.6 * glow),
      SUN.color[1] * (0.4 + 0.6 * glow),
      SUN.color[2] * (0.6 + 0.4 * glow),
    ];
    SUN.intensity *= 0.3 * glow;
  }
}

function smoothstep(edge0, edge1, x) {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

let reflectionFBO = null;
let reflectionTex = null;
let reflectionColorProgram = null;
function createReflectionTarget(gl, width, height) {
  reflectionTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, reflectionTex);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA16F,
    canvas.width,
    canvas.height,
    0,
    gl.RGBA,
    gl.HALF_FLOAT,
    null
  );

  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

  // === DODAJ OVO ZA DEPTH ===
  window.reflectionDepthTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, window.reflectionDepthTex);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.DEPTH_COMPONENT24, // ili gl.DEPTH_COMPONENT16
    width,
    height,
    0,
    gl.DEPTH_COMPONENT,
    gl.UNSIGNED_INT,
    null
  );
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  reflectionFBO = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, reflectionFBO);
  
  gl.framebufferTexture2D(
    gl.FRAMEBUFFER,
    gl.COLOR_ATTACHMENT0,
    gl.TEXTURE_2D,
    reflectionTex,
    0
  );
  // === ZAKACI DEPTH TEKSTURU ===
  gl.framebufferTexture2D(
    gl.FRAMEBUFFER,
    gl.DEPTH_ATTACHMENT,
    gl.TEXTURE_2D,
    window.reflectionDepthTex,
    0
  );

  gl.bindTexture(gl.TEXTURE_2D, null);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}

// === BOAT MASK ===

let boatMaskFBO = null;
let boatMaskTex = null;
window.boatMaskTex = null;
window.boatMaskVP = null; // 👈 dodaćemo i VP matricu
const MASK_RES = 512;
function createBoatMaskTarget(gl, size = 512) {
  // Kreiraj 1-kanalnu (RED) teksturu koja sadrži masku trupa
  boatMaskTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, boatMaskTex);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.R8, // 1 kanal
    size,
    size,
    0,
    gl.RED,
    gl.UNSIGNED_BYTE,
    null
  );
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  boatMaskFBO = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, boatMaskFBO);
  gl.framebufferTexture2D(
    gl.FRAMEBUFFER,
    gl.COLOR_ATTACHMENT0,
    gl.TEXTURE_2D,
    boatMaskTex,
    0
  );
  gl.drawBuffers([gl.COLOR_ATTACHMENT0]);

  // Proveri da li je sve kompletno
  const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  if (status !== gl.FRAMEBUFFER_COMPLETE) {
    console.error("❌ Boat mask FBO nije kompletan!", status.toString(16));
  }

  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  window.boatMaskTex = boatMaskTex; // globalni pristup za water.js
}
function renderBoatMask() {
  if (!boatMaskFBO || !depthOnlyProgram) return;

  gl.bindFramebuffer(gl.FRAMEBUFFER, boatMaskFBO);
  gl.viewport(0, 0, MASK_RES, MASK_RES);
  gl.clearColor(0.0, 0.0, 0.0, 1.0);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.enable(gl.DEPTH_TEST);

  const min = boatMin;
  const max = boatMax;
  const center = [
    (min[0] + max[0]) * 0.5,
    (min[1] + max[1]) * 0.5,
    (min[2] + max[2]) * 0.5,
  ];

  // kamera iznad po Y, gleda ka -Y, "up" = +Z
  const eye = [center[0], max[1] + 20.0, center[2]];
  const target = [center[0], center[1], center[2]];
  const view = look(eye, target, [0, 1, 1]); // <-- +Z gore!

  const half = Math.max(max[0] - min[0], max[2] - min[2]) * 0.5 + 2.0;
  const proj = ortho(-half, half, half, -half, -200, 200);

  gl.useProgram(depthOnlyProgram);
  gl.uniform1f(gl.getUniformLocation(depthOnlyProgram, "uClipY"), 0.0);
  gl.uniformMatrix4fv(
    gl.getUniformLocation(depthOnlyProgram, "uProjection"),
    false,
    proj
  );
  gl.uniformMatrix4fv(
    gl.getUniformLocation(depthOnlyProgram, "uView"),
    false,
    view
  );

  for (let i = 0; i < modelVAOs.length; ++i) {
    if (!idxCounts[i]) continue;
    gl.uniformMatrix4fv(
      gl.getUniformLocation(depthOnlyProgram, "uModel"),
      false,
      modelMatrices[i]
    );
    gl.bindVertexArray(modelVAOs[i]);
    gl.drawElements(gl.TRIANGLES, idxCounts[i], idxTypes[i], 0);
  }

  gl.uniform1f(gl.getUniformLocation(depthOnlyProgram, "uClipY"), -999.0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, canvas.width, canvas.height);

  window.boatMaskVP = mat4mul(proj, view); // pazi redosled
}

let envSize = 512; // kontrola kvaliteta/performansi
let cubeMaxMip = Math.floor(Math.log2(envSize));
let showWater = true;
let depthOnlyProgram = null;
let originalGlassByPart = {};
let transparentMeshes = [];
let envTex = null;
let brdfTex = null;
let realOriginalParts = {}; // permanentno čuvamo početni model (A)
let useOrtho = false;
let boatMin = null;
let boatMax = null;
let showDimensions = false;
let gBuffer, gPosition, gNormal, gAlbedo, gMaterial;
let ssaoFBO, ssaoBlurFBO, ssaoColorBuffer, ssaoBlurBuffer;
let ssaoKernel = [];
let ssaoNoiseTexture;
let lineProgram; // globalna promenljiva
let currentView = "iso"; // "front", "left", "top", "iso"
let boatLengthLine = null;
let gBufferProgram, ssaoProgram, blurProgram; // Za nove šejder programe
let quadVAO = null; // Za iscrtavanje preko celog ekrana
let modelMatrices = [];
let camWorld = [0, 0, 0]; // globalno
const KERNEL_SIZE = 64;
const SSAO_NOISE_SIZE = 4;
let nodesMeta = []; // {id, name, renderIdx}
let renderToNodeId = {}; // renderIdx -> id
let selectedColors = {};
let lastFrame = performance.now();
let frames = 0;
let fps = 0;
let originalParts = {}; // renderIdx -> { vao, count, type, baseColor, metallic, roughness }
let currentParts = {}; // npr. { "BT_Base_03_A": "BT_Base_03_A", "BT_Base_Center_Console": "BT_Base_Center_Console_A" }
let modelBaseColors = [];
let modelBaseTextures = []; // niz u koji ćemo smestiti teksture iz modela
let modelMetallics = [];
let modelRoughnesses = [];
let lastFrameTime = 0;

const thumbnails = {};
const cachedVariants = {}; // url -> ArrayBuffer
const preparedVariants = {}; // url -> [ { vao, count, type, baseColor, metallic, roughness, trisWorld }... ]

const lineVertSrc = `#version 300 es
layout(location=0) in vec3 aPos;
uniform mat4 uProjection, uView, uModel;
void main() {
  gl_Position = uProjection * uView * uModel * vec4(aPos, 1.0);
}
`;

const lineFragSrc = `#version 300 es
precision highp float;
uniform vec3 uColor;
out vec4 fragColor;
void main() {
  fragColor = vec4(uColor, 1.0);
}
`;

const previewPrograms = new WeakMap();
function getPreviewProgram(gl) {
  let prog = previewPrograms.get(gl);
  if (!prog) {
    prog = createPreviewProgram(gl);
    previewPrograms.set(gl, prog);
  }
  return prog;
}
function getReflectedCamera(camPos, target, up) {
  // reflektuj oko y=0 (nivo vode)
  let reflPos = [camPos[0], -camPos[1] + 2 * 0.0, camPos[2]];
  let reflTarget = [target[0], -target[1] + 2 * 0.0, target[2]];
  let reflUp = [up[0], -up[1], up[2]];
  let reflView = look(reflPos, reflTarget, reflUp);
  return { pos: reflPos, target: reflTarget, up: reflUp, view: reflView };
}
function createFinalColorTarget(w, h) {
  // Obrisi stare
  if (finalFBO) gl.deleteFramebuffer(finalFBO);
  if (finalColorTex) gl.deleteTexture(finalColorTex);
  if (window.finalDepthTex) gl.deleteTexture(window.finalDepthTex);

  // Color
  finalColorTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, finalColorTex);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA16F,
    w,
    h,
    0,
    gl.RGBA,
    gl.HALF_FLOAT,
    null
  );
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);

  // Depth
  window.finalDepthTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, window.finalDepthTex);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.DEPTH_COMPONENT24,
    w,
    h,
    0,
    gl.DEPTH_COMPONENT,
    gl.UNSIGNED_INT,
    null
  );
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  // FBO
  finalFBO = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, finalFBO);
  gl.framebufferTexture2D(
    gl.FRAMEBUFFER,
    gl.COLOR_ATTACHMENT0,
    gl.TEXTURE_2D,
    finalColorTex,
    0
  );
  gl.framebufferTexture2D(
    gl.FRAMEBUFFER,
    gl.DEPTH_ATTACHMENT,
    gl.TEXTURE_2D,
    window.finalDepthTex,
    0
  );
  gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.bindTexture(gl.TEXTURE_2D, null);
}

function focusCameraOnNode(node) {
  if (!node) return;

  let min = [Infinity, Infinity, Infinity];
  let max = [-Infinity, -Infinity, -Infinity];

  for (const r of node.renderIdxs) {
    if (!r.matName || r.matName.toLowerCase().includes("dummy")) continue;

    const orig = originalParts[r.idx];
    if (!orig || !orig.pos) continue;

    const modelMat = modelMatrices[r.idx] || orig.modelMatrix;
    for (let i = 0; i < orig.pos.length; i += 3) {
      const p = [orig.pos[i], orig.pos[i + 1], orig.pos[i + 2], 1];
      const w = vec4.transformMat4([], p, modelMat);
      min[0] = Math.min(min[0], w[0]);
      min[1] = Math.min(min[1], w[1]);
      min[2] = Math.min(min[2], w[2]);
      max[0] = Math.max(max[0], w[0]);
      max[1] = Math.max(max[1], w[1]);
      max[2] = Math.max(max[2], w[2]);
    }
  }

  const center = [
    (min[0] + max[0]) / 2,
    (min[1] + max[1]) / 2,
    (min[2] + max[2]) / 2,
  ];
  const size = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]);

  const fovY = Math.PI / 4;
  const newDist = size / (2 * Math.tan(fovY / 2));

  window.currentBoundingRadius = size / 2;
  pan = center;
  distTarget = newDist * 0.7; // samo cilj, dist neka interpolira
  rxTarget = Math.PI / 6;
  ryTarget = 0;
  minDist = newDist * 0.2;
  maxDist = newDist * 3.0;
  distTarget = Math.min(Math.max(distTarget, minDist), maxDist);
}

function renderBoatInfo(infoObj) {
  const container = document.getElementById("boat-info");
  container.innerHTML = `
    <h3>Informacije o brodu</h3>
    <table class="info-table">
      <tbody>
        ${Object.entries(infoObj)
          .map(([key, val]) => `<tr><td>${key}:</td><td>${val}</td></tr>`)
          .join("")}
      </tbody>
    </table>
  `;
}

function createPreviewProgram(gl2) {
  const vsSource = `#version 300 es
  layout(location=0) in vec3 aPos;
  layout(location=1) in vec3 aNor;
  uniform mat4 uProjection;
  uniform mat4 uView;
  uniform mat4 uModel;
  out vec3 vNor;
  void main() {
    vNor = normalize(mat3(uModel) * aNor);
    gl_Position = uProjection * uView * uModel * vec4(aPos, 1.0);
  }`;

  const fsSource = `#version 300 es
  precision highp float;
  in vec3 vNor;
  uniform vec3 uBaseColor;
  uniform float uOpacity;   // 👈 NOVO
  out vec4 fragColor;
  void main() {
    float l = max(dot(normalize(vNor), normalize(vec3(0.3,0.8,0.6))), 0.0);
    vec3 lit = uBaseColor * l + uBaseColor * 0.2; 
    fragColor = vec4(lit, uOpacity);   // 👈 KORISTI OPACITY
  }`;

  function compile(src, type) {
    const sh = gl2.createShader(type);
    gl2.shaderSource(sh, src);
    gl2.compileShader(sh);
    if (!gl2.getShaderParameter(sh, gl2.COMPILE_STATUS))
      throw new Error(gl2.getShaderInfoLog(sh));
    return sh;
  }

  const vs = compile(vsSource, gl2.VERTEX_SHADER);
  const fs = compile(fsSource, gl2.FRAGMENT_SHADER);

  const prog = gl2.createProgram();
  gl2.attachShader(prog, vs);
  gl2.attachShader(prog, fs);
  gl2.linkProgram(prog);
  if (!gl2.getProgramParameter(prog, gl2.LINK_STATUS))
    throw new Error(gl2.getProgramInfoLog(prog));
  return prog;
}

document
  .querySelectorAll("#camera-controls button[data-view]")
  .forEach((btn) => {
    btn.addEventListener("click", () => {
      const viewName = btn.getAttribute("data-view");
      currentView = viewName;

      if (viewName === "iso") {
        useOrtho = false; // perspektiva
      } else {
        useOrtho = true; // ortho
      }

      pan = window.sceneBoundingCenter || [0, 0, 0];
      updateView();
      render();
    });
  });

async function loadDefaultModel(url) {
  showLoading();
  const res = await fetch(url);
  const buf = await res.arrayBuffer();
  loadGLB(buf); // koristi tvoju postojeću funkciju
  hideLoading();
}

function updateFPS() {
  const now = performance.now();
  frames++;
  if (now - lastFrame >= 1000) {
    fps = frames;
    frames = 0;
    lastFrame = now;
    // Prikazi FPS u divu
    const fpsSpan = document.getElementById("fps-value");
    if (fpsSpan) fpsSpan.textContent = fps;
  }
}

const input = document.getElementById("glbInput");
const loadingScr = document.getElementById("loading-screen");
document.getElementById("toggleDims").addEventListener("click", () => {
  showDimensions = !showDimensions;
  document.getElementById("toggleDims").innerText = showDimensions
    ? "Show Dims"
    : "Hide Dims";

  const lbl = document.getElementById("lengthLabel");
  if (lbl) lbl.style.display = showDimensions ? "block" : "none";
});
document.getElementById("toggleWater").addEventListener("click", () => {
  showWater = !showWater;
  document.getElementById("toggleWater").innerText = showWater
    ? "Hide Water"
    : "Show Water";
  render();
});

function showLoading() {
  loadingScr.classList.remove("hidden");
  loadingScr.style.opacity = "1";
}

function hideLoading() {
  loadingScr.style.opacity = "0";

  /* ➜  ODMAH ukini pointer-events da canvas dobije klik */
  loadingScr.style.pointerEvents = "none";

  /* Prebaci se na ‘transitionend’ – radi čak i posle tab-switcha */
  const onEnd = () => {
    loadingScr.classList.add("hidden");
    loadingScr.removeEventListener("transitionend", onEnd);
  };
  loadingScr.addEventListener("transitionend", onEnd);
}

input.addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  showLoading();

  const buf = await file.arrayBuffer();

  requestAnimationFrame(() => {
    loadGLB(buf); // Učitaj model
    hideLoading(); // Sakrij kad se završi
  });

  input.value = ""; // da bi mogao da uvezeš isti fajl opet
});

const canvas = document.getElementById("glCanvas");
const gl = canvas.getContext("webgl2", { alpha: true, antialias: true });

if (!gl) alert("WebGL2 nije podržan u ovom pregledaču.");

// OVAJ KOD DODAJ OVDE:
if (!gl.getExtension("EXT_color_buffer_float")) {
  alert(
    "Ovaj browser ne podržava EXT_color_buffer_float.\nGI efekti neće raditi."
  );
}
/* -------------------------------------------------
   DEPTH (scene) tekstura helpers
--------------------------------------------------*/
let sceneDepthTex = null; //  ←  NOVA globalna promenljiva

function createDepthTexture(w, h) {
  //  ←  NOVA funkcija
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.DEPTH_COMPONENT24, // 24-bit dubina
    w,
    h,
    0,
    gl.DEPTH_COMPONENT,
    gl.UNSIGNED_INT,
    null
  );
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return tex;
}
let ssaa = 1.0; // start (dinamički će se menjati)
let targetSSAA = 1.0;
let targetFPS = 20;
let ssaaMin = 1.0;
let ssaaMax = 1.6;
let adjustCooldown = 0;

function resizeCanvas() {
  const sidebarW = document.getElementById("sidebar").offsetWidth;
  const headerH = document.querySelector(".global-header").offsetHeight || 0;

  const cssW = window.innerWidth - sidebarW;
  const cssH = window.innerHeight - headerH; // ⬅️ oduzimamo header

  const aspect = cssW / cssH;

  // pametan limit za slabije uređaje
  let maxRenderW;
  if (/Mobi|Android|iPad|Tablet/i.test(navigator.userAgent)) {
    maxRenderW = 1000;
  } else {
    maxRenderW = cssW;
  }

  let targetW = Math.min(cssW, maxRenderW);
  let targetH = Math.round(targetW / aspect);

  const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
  const realW = Math.round(targetW * ssaa * dpr);
  const realH = Math.round(targetH * ssaa * dpr);

  canvas.width = realW;
  canvas.height = realH;

  // CSS dimenzije → canvas ispod headera
  canvas.style.width = cssW + "px";
  canvas.style.height = cssH + "px";
  canvas.style.left = sidebarW + "px";
  canvas.style.top = headerH + "px"; // ⬅️ gurni ispod headera

  gl.viewport(0, 0, realW, realH);

  if (sceneDepthTex) gl.deleteTexture(sceneDepthTex);
  sceneDepthTex = createDepthTexture(realW, realH);
  createGBuffer(realW, realH);
  createSSAOBuffers(Math.round(realW * 0.5), Math.round(realH * 0.5));
  createFinalColorTarget(canvas.width, canvas.height);
  if (reflectionFBO) {
    gl.deleteFramebuffer(reflectionFBO);
    gl.deleteTexture(reflectionTex);
  }

  createReflectionTarget(gl, realW, realH);
  createBoatMaskTarget(gl, MASK_RES);
  const resMeter = document.getElementById("res-meter");
  if (resMeter) {
    resMeter.textContent = `Render: ${targetW}x${targetH} → ${realW}x${realH} (SSAA ${ssaa.toFixed(
      2
    )}x)`;
  }
}

function autoAdjustSSAA() {
  if (adjustCooldown > 0) {
    adjustCooldown--;
    return;
  }

  // dead zone: ne reaguj ako je fps skoro oko targeta
  if (fps > targetFPS + 2 && targetSSAA < ssaaMax) {
    targetSSAA = Math.min(targetSSAA + 0.1, ssaaMax);
    adjustCooldown = 20; // ~0.75s
  } else if (fps < targetFPS - 2 && targetSSAA > ssaaMin) {
    targetSSAA = Math.max(targetSSAA - 0.1, ssaaMin);
    adjustCooldown = 20; // ~0.75s
  }
}
function createGBuffer() {
  gBuffer = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, gBuffer);

  // Tekstura za pozicije (u View-space, potrebna za SSAO)
  gPosition = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, gPosition);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA16F,
    canvas.width,
    canvas.height,
    0,
    gl.RGBA,
    gl.FLOAT,
    null
  );
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.framebufferTexture2D(
    gl.FRAMEBUFFER,
    gl.COLOR_ATTACHMENT0,
    gl.TEXTURE_2D,
    gPosition,
    0
  );

  // Tekstura za normale (u View-space)
  gNormal = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, gNormal);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA16F,
    canvas.width,
    canvas.height,
    0,
    gl.RGBA,
    gl.FLOAT,
    null
  );
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.framebufferTexture2D(
    gl.FRAMEBUFFER,
    gl.COLOR_ATTACHMENT1,
    gl.TEXTURE_2D,
    gNormal,
    0
  );

  // Tekstura za boju (Albedo)
  gAlbedo = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, gAlbedo);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA,
    canvas.width,
    canvas.height,
    0,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    null
  );
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.framebufferTexture2D(
    gl.FRAMEBUFFER,
    gl.COLOR_ATTACHMENT2,
    gl.TEXTURE_2D,
    gAlbedo,
    0
  );
  // NOVO: 4. Tekstura za materijal (Roughness, Metallic)
  gMaterial = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, gMaterial);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA16F,
    canvas.width,
    canvas.height,
    0,
    gl.RGBA,
    gl.FLOAT,
    null
  );
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.framebufferTexture2D(
    gl.FRAMEBUFFER,
    gl.COLOR_ATTACHMENT3,
    gl.TEXTURE_2D,
    gMaterial,
    0
  );

  // Kažemo WebGL-u da piše u SVA 4 attachment-a
  gl.drawBuffers([
    gl.COLOR_ATTACHMENT0,
    gl.COLOR_ATTACHMENT1,
    gl.COLOR_ATTACHMENT2,
    gl.COLOR_ATTACHMENT3,
  ]);

  // Poveži postojeći depth texture
  gl.framebufferTexture2D(
    gl.FRAMEBUFFER,
    gl.DEPTH_ATTACHMENT,
    gl.TEXTURE_2D,
    sceneDepthTex,
    0
  );

  if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
    console.error("G-Buffer frejmbafer nije kompletan!");
  }

  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}

function createSSAOBuffers() {
  // 📱 Ako je tablet/mobilni → pola rezolucije
  const w = canvas.width;
  const h = canvas.height;
  // === FBO za računanje SSAO ===
  ssaoFBO = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, ssaoFBO);

  ssaoColorBuffer = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, ssaoColorBuffer);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.FLOAT, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.framebufferTexture2D(
    gl.FRAMEBUFFER,
    gl.COLOR_ATTACHMENT0,
    gl.TEXTURE_2D,
    ssaoColorBuffer,
    0
  );

  if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE)
    console.error("SSAO frejmbafer nije kompletan!");

  // === FBO za SSAO Blur ===
  ssaoBlurFBO = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, ssaoBlurFBO);

  ssaoBlurBuffer = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, ssaoBlurBuffer);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA16F,
    w,
    h,
    0,
    gl.RGBA, // <-- OVO!
    gl.FLOAT, // <-- I OVO!
    null
  );
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.framebufferTexture2D(
    gl.FRAMEBUFFER,
    gl.COLOR_ATTACHMENT0,
    gl.TEXTURE_2D,
    ssaoBlurBuffer,
    0
  );

  if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE)
    console.error("SSAO Blur frejmbafer nije kompletan!");

  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}

function generateSSAOKernel() {
  const lerp = (a, b, f) => a + f * (b - a);
  let kernel = [];
  for (let i = 0; i < KERNEL_SIZE; ++i) {
    let sample = [
      Math.random() * 2.0 - 1.0,
      Math.random() * 2.0 - 1.0,
      Math.random(),
    ];
    // Normalizuj uzorak
    const len = Math.sqrt(
      sample[0] * sample[0] + sample[1] * sample[1] + sample[2] * sample[2]
    );
    sample[0] /= len;
    sample[1] /= len;
    sample[2] /= len;

    // Nasumično ga produži
    sample[0] *= Math.random();
    sample[1] *= Math.random();
    sample[2] *= Math.random();

    // Skaliraj uzorke tako da budu bliže centru
    // ISPRAVLJENA LINIJA:
    let scale = i / KERNEL_SIZE;
    scale = lerp(0.1, 1.0, scale * scale);
    sample[0] *= scale;
    sample[1] *= scale;
    sample[2] *= scale;
    kernel.push(...sample);
  }
  ssaoKernel = new Float32Array(kernel);
}

function generateNoiseTexture() {
  let noise = [];
  for (let i = 0; i < SSAO_NOISE_SIZE * SSAO_NOISE_SIZE; i++) {
    const angle = Math.random() * Math.PI * 2.0;
    noise.push(Math.cos(angle));
    noise.push(Math.sin(angle));
    noise.push(0.0);
  }

  ssaoNoiseTexture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, ssaoNoiseTexture);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGB16F,
    SSAO_NOISE_SIZE,
    SSAO_NOISE_SIZE,
    0,
    gl.RGB,
    gl.FLOAT,
    new Float32Array(noise)
  );
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
}

let resizeTimeout;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimeout);
  resizeTimeout = setTimeout(() => {
    resizeCanvas();
  }, 100); // 100ms debounce
});

resizeCanvas();

let shadowFBO, shadowDepthTex;
const SHADOW_RES = 2048;

function initShadowMap() {
  shadowFBO = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, shadowFBO);

  shadowDepthTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, shadowDepthTex);

  // alociramo depth teksturu
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.DEPTH_COMPONENT24, // internal format
    SHADOW_RES,
    SHADOW_RES,
    0,
    gl.DEPTH_COMPONENT, // format
    gl.UNSIGNED_INT, // type
    null
  );

  // NEAREST je sigurniji za depth mapu
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  // zakači depth teksturu na FBO
  gl.framebufferTexture2D(
    gl.FRAMEBUFFER,
    gl.DEPTH_ATTACHMENT,
    gl.TEXTURE_2D,
    shadowDepthTex,
    0
  );

  // pošto nemamo color attachment → mora ovako
  gl.drawBuffers([gl.NONE]);
  gl.readBuffer(gl.NONE);

  // proveri da li je FBO ispravan
  const fbStatus = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  if (fbStatus !== gl.FRAMEBUFFER_COMPLETE) {
    console.error("Shadow FBO not complete:", fbStatus.toString(16));
  }

  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}

gl.enable(gl.DEPTH_TEST);

const vec4 = {
  fromValues: (x, y, z, w) => new Float32Array([x, y, z, w]),
  transformMat4: (out, a, m) => {
    const x = a[0],
      y = a[1],
      z = a[2],
      w = a[3];
    out[0] = m[0] * x + m[4] * y + m[8] * z + m[12] * w;
    out[1] = m[1] * x + m[5] * y + m[9] * z + m[13] * w;
    out[2] = m[2] * x + m[6] * y + m[10] * z + m[14] * w;
    out[3] = m[3] * x + m[7] * y + m[11] * z + m[15] * w;
    return out;
  },
};

let proj = persp(60, canvas.width / canvas.height, 0.1, 10000);
let view = new Float32Array(16);
const model = new Float32Array([
  1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1,
]);

function setMatrices(p) {
  gl.uniformMatrix4fv(gl.getUniformLocation(p, "uProjection"), false, proj);
  gl.uniformMatrix4fv(gl.getUniformLocation(p, "uView"), false, view);
  gl.uniformMatrix4fv(gl.getUniformLocation(p, "uModel"), false, model);
}

/* -------------------------------------------------
   SIMPLE ORBIT + PAN + ZOOM CAMERA
--------------------------------------------------*/
let rx = 0,
  ry = 0,
  dist = 5;
let minDist = 0.1;
let maxDist = 100.0;
let pan = [0, 0, 0]; // target point
let rxTarget = rx,
  ryTarget = ry,
  distTarget = dist;

function animateCamera() {
  const minRx = 0.025; // ~6 stepeni iznad horizonta
  const maxRx = Math.PI / 2 - 0.01;
  rxTarget = Math.max(minRx, Math.min(maxRx, rxTarget));
  if (rxTarget > maxRx) rxTarget += (maxRx - rxTarget) * 0.25;
  rx += (rxTarget - rx) * 0.16;
  ry += (ryTarget - ry) * 0.16;

  // Clamp zoom
  const fovY = Math.PI / 4;
  let minDistDynamic =
    ((window.currentBoundingRadius || window.sceneBoundingRadius || 1.5) /
      Math.tan(fovY / 2)) *
    0.3;
  let maxDistDynamic =
    (window.currentBoundingRadius || window.sceneBoundingRadius || 5) * 10.0;

  if (distTarget < minDistDynamic)
    distTarget += (minDistDynamic - distTarget) * 0.2;
  if (distTarget > maxDistDynamic)
    distTarget += (maxDistDynamic - distTarget) * 0.2;

  dist += (distTarget - dist) * 0.14;
}

function updateView() {
  const aspect = canvas.width / canvas.height;

  if (useOrtho) {
    // 👇 ortho projekcija
    let size = (window.sceneBoundingRadius || 5) * 0.8;
    proj = ortho(-size * aspect, size * aspect, -size, size, -1000, 1000);

    // 👇 fiksni pogledi
    const d = (window.sceneBoundingRadius || 5) * 60.0;
    let eye, up;
    switch (currentView) {
      case "front":
        eye = [0, 0, d];
        up = [0, 1, 0];
        break;
      case "left":
        eye = [-d, 0, 0];
        up = [0, 1, 0];
        break;
      case "top":
        eye = [0, d, 0];
        up = [0, 0, -1];
        break;
      default:
        eye = [d, d, d];
        up = [0, 1, 0];
        break; // fallback
    }
    view.set(look(eye, pan, up));
    camWorld = eye.slice();
  } else {
    // 👇 perspektiva (orbit)
    proj = persp(70, aspect, 0.1, 10000);

    const eye = [
      dist * Math.cos(rx) * Math.sin(ry) + pan[0],
      dist * Math.sin(rx) + pan[1],
      dist * Math.cos(rx) * Math.cos(ry) + pan[2],
    ];
    view.set(look(eye, pan, [0, 1, 0]));
    camWorld = eye.slice();
  }
}
// === TOUCH KONTROLE ===
let touchDragging = false;
let touchLastX = 0,
  touchLastY = 0;
let pinchLastDist = null;
let touchPanLastMid = null; // nova promenljiva za 2-prsta pan

canvas.addEventListener("mousemove", (e) => {
  if (e.buttons === 1) {
    ryTarget += e.movementX * 0.001;
    rxTarget += e.movementY * 0.005;
  } else if (e.buttons === 4) {
    const panSpeed = 0.001 * dist; // brže kad je kamera dalje
    const eye = [
      dist * Math.cos(rx) * Math.sin(ry) + pan[0],
      dist * Math.sin(rx) + pan[1],
      dist * Math.cos(rx) * Math.cos(ry) + pan[2],
    ];
    const target = pan;
    const viewDir = v3.norm(v3.sub(target, eye)); // pogled
    const right = v3.norm(v3.cross([0, 1, 0], viewDir)); // čisto desno
    const up = v3.cross(viewDir, right); // čisto gore
    pan[0] += (e.movementX * right[0] + e.movementY * up[0]) * panSpeed;
    pan[1] += (e.movementX * right[1] + e.movementY * up[1]) * panSpeed;
    pan[2] += (e.movementX * right[2] + e.movementY * up[2]) * panSpeed;

    updateView();
  }
});
// Rotacija jednim prstom + pinch zoom + pan sa dva prsta
canvas.addEventListener(
  "touchstart",
  (e) => {
    if (e.touches.length === 1) {
      touchDragging = true;
      touchLastX = e.touches[0].clientX;
      touchLastY = e.touches[0].clientY;
    }
    if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      pinchLastDist = Math.sqrt(dx * dx + dy * dy);

      // setuj početnu srednju tačku za pan
      touchPanLastMid = {
        x: (e.touches[0].clientX + e.touches[1].clientX) * 0.5,
        y: (e.touches[0].clientY + e.touches[1].clientY) * 0.5,
      };
    }
    e.preventDefault();
  },
  { passive: false }
);
canvas.addEventListener(
  "touchmove",
  (e) => {
    if (e.touches.length === 1 && touchDragging) {
      const dx = e.touches[0].clientX - touchLastX;
      const dy = e.touches[0].clientY - touchLastY;

      ryTarget += dx * 0.003; // horizontalna rotacija
      rxTarget += dy * 0.005; // vertikalna rotacija

      touchLastX = e.touches[0].clientX;
      touchLastY = e.touches[0].clientY;
    }

    if (e.touches.length === 2) {
      // === pinch zoom ===
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const distNow = Math.sqrt(dx * dx + dy * dy);

      if (pinchLastDist !== null) {
        const delta = pinchLastDist - distNow;
        distTarget += delta * 0.01; // isto što i wheel zoom
      }
      pinchLastDist = distNow;

      // === pan sa dva prsta ===
      const midNow = {
        x: (e.touches[0].clientX + e.touches[1].clientX) * 0.5,
        y: (e.touches[0].clientY + e.touches[1].clientY) * 0.5,
      };

      if (touchPanLastMid) {
        const dxMid = midNow.x - touchPanLastMid.x;
        const dyMid = midNow.y - touchPanLastMid.y;

        const panSpeed = 0.001 * dist; // isto kao kod miša

        // preračunaj kamerine vektore
        const eye = [
          dist * Math.cos(rx) * Math.sin(ry) + pan[0],
          dist * Math.sin(rx) + pan[1],
          dist * Math.cos(rx) * Math.cos(ry) + pan[2],
        ];
        const target = pan;
        const viewDir = v3.norm(v3.sub(target, eye));
        const right = v3.norm(v3.cross([0, 1, 0], viewDir));
        const up = v3.cross(viewDir, right);

        pan[0] += (dxMid * right[0] + dyMid * up[0]) * panSpeed;
        pan[1] += (dxMid * right[1] + dyMid * up[1]) * panSpeed;
        pan[2] += (dxMid * right[2] + dyMid * up[2]) * panSpeed;

        updateView();
      }
      touchPanLastMid = midNow;
    }

    e.preventDefault();
  },
  { passive: false }
);
canvas.addEventListener(
  "touchend",
  (e) => {
    if (e.touches.length === 0) {
      touchDragging = false;
      pinchLastDist = null;
      touchPanLastMid = null;
    }
    e.preventDefault();
  },
  { passive: false }
);
canvas.addEventListener(
  "wheel",
  (e) => {
    const fovY = Math.PI / 4; // 45°
    const minDist =
      ((window.currentBoundingRadius || window.sceneBoundingRadius || 1) /
        Math.tan(fovY / 2)) *
      0.3;
    const maxDist = (window.currentBoundingRadius || 5) * 10.0;
    distTarget += e.deltaY * 0.01;
    // OGRANIČI ZOOM NA 70% boundinga
    if (distTarget < minDist) distTarget += (minDist - distTarget) * 0.3;
    if (distTarget > maxDist) distTarget += (maxDist - distTarget) * 0.3;

    updateView();
  },
  { passive: true }
);
function makeLengthLine(min, max) {
  const y = min[1];
  const z = max[2];

  const v = [min[0], y, z, max[0], y, z];

  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);

  const vb = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vb);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(v), gl.STATIC_DRAW);

  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);

  gl.bindVertexArray(null);
  return { vao, count: 2 };
}

/* ------------------------------------------------------------------
   GLOBALS
------------------------------------------------------------------ */
let program, grid;
let shadowProgram;
let programGlass;
let modelVAOs = [];
let idxCounts = [];
let idxTypes = [];

/* ------------------------------------------------------------------
   SHADER INIT
------------------------------------------------------------------ */

async function init() {
  // 1. Priprema Framebuffer-a i podataka za efekte
  initShadowMap();
  createGBuffer();
  createSSAOBuffers();
  generateSSAOKernel();
  generateNoiseTexture();

  // 2. Učitavanje i kompajliranje svih potrebnih šejder programa
  const shadowVertSrc = await fetch("../shaders/shadow.vert").then((r) =>
    r.text()
  );
  const shadowFragSrc = await fetch("../shaders/shadow.frag").then((r) =>
    r.text()
  );
  shadowProgram = createShaderProgram(gl, shadowVertSrc, shadowFragSrc);

  const gBufferVertSrc = await fetch("../shaders/g_buffer.vert").then((r) =>
    r.text()
  );
  const gBufferFragSrc = await fetch("../shaders/g_buffer.frag").then((r) =>
    r.text()
  );
  gBufferProgram = createShaderProgram(gl, gBufferVertSrc, gBufferFragSrc);
  const depthOnlyVert = `#version 300 es
layout(location=0) in vec3 aPos;
uniform mat4 uProjection;
uniform mat4 uView;
uniform mat4 uModel;

out vec3 vWorldPos;

void main() {
  vec4 world = uModel * vec4(aPos, 1.0);
  vWorldPos = world.xyz;
  gl_Position = uProjection * uView * world;
}
`;

  const depthOnlyFrag = `#version 300 es
precision highp float;
in vec3 vWorldPos;
uniform float uClipY;   // nivo vode
out vec4 fragColor;

void main() {
    // ako je clip aktivan (tj. > -999) seci sve iznad vode
    if (uClipY > -999.0 && vWorldPos.y > uClipY)
        discard;

    // crveno = trup ispod vode
    fragColor = vec4(0.0, 0.0, 0.0, 1.0);
}
`;

  // kreiraj program
  depthOnlyProgram = createShaderProgram(gl, depthOnlyVert, depthOnlyFrag);
  const quadVertSrc = await fetch("../shaders/quad.vert").then((r) => r.text());

  const ssaoFragSrc = await fetch("../shaders/ssao.frag").then((r) => r.text());
  ssaoProgram = createShaderProgram(gl, quadVertSrc, ssaoFragSrc);

  const blurFragSrc = await fetch("../shaders/blur.frag").then((r) => r.text());
  blurProgram = createShaderProgram(gl, quadVertSrc, blurFragSrc);
  lineProgram = createShaderProgram(gl, lineVertSrc, lineFragSrc);
  const glassVS = await fetch("shaders/glass.vert").then((r) => r.text());
  const glassFS = await fetch("shaders/glass.frag").then((r) => r.text());
  programGlass = createShaderProgram(gl, glassVS, glassFS);
  const reflectionVertSrc = await fetch("shaders/reflection.vert").then((r) =>
    r.text()
  );
  const reflectionFragSrc = await fetch("shaders/reflection.frag").then((r) =>
    r.text()
  );
  const acesFragSrc = await fetch("shaders/aces.frag").then((r) => r.text());
  acesProgram = createShaderProgram(gl, quadVertSrc, acesFragSrc);
  reflectionColorProgram = createShaderProgram(
    gl,
    reflectionVertSrc,
    reflectionFragSrc
  );

  const pbrFragSrc = await fetch("../shaders/pbr.frag").then((r) => r.text());
  program = createShaderProgram(gl, quadVertSrc, pbrFragSrc);

  // 3. Učitavanje potrebnih tekstura
  const brdfImg = await new Promise((res) => {
    const img = new Image();
    img.src = "assets/BRDF_LUT.png";
    img.onload = () => res(img);
  });

  brdfTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, brdfTex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, brdfImg);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  await initWater(gl);
  await initSky(gl);

  // ✅ Proceduralni env iz neba

  envTex = bakeSkyToCubemap(gl, envSize, SUN.dir, {
    ...DEFAULT_SKY,
    sunColor: SUN.color,
    sunIntensity: SUN.intensity,
    useTonemap: false,
    hideSun: true, // 👈 NOVO
  });

  cubeMaxMip = Math.floor(Math.log2(envSize));

  updateView();
}

function buildVariantSidebar() {
  const sidebar = document.getElementById("variantSidebar");
  sidebar.innerHTML = "";

  for (const [groupName, parts] of Object.entries(VARIANT_GROUPS)) {
    const groupDiv = document.createElement("div");
    groupDiv.className = "variant-group";

    // Header grupe (collapse)
    const header = document.createElement("h3");
    header.textContent = groupName;
    header.addEventListener("click", () => {
      document.querySelectorAll(".variant-group").forEach((g) => {
        if (g !== groupDiv) g.classList.remove("open");
      });
      groupDiv.classList.toggle("open");
    });

    groupDiv.appendChild(header);

    const itemsDiv = document.createElement("div");
    itemsDiv.className = "variant-items";

    for (const [partKey, data] of Object.entries(parts)) {
      const variants = data.models;

      variants.forEach((variant) => {
        // === KARTICA ===
        const itemEl = document.createElement("div");
        itemEl.className = "variant-item";
        itemEl.dataset.part = partKey;
        itemEl.dataset.variant = variant.name;

        // === THUMB WRAPPER ===
        const thumbWrapper = document.createElement("div");
        thumbWrapper.className = "thumb-wrapper";

        const preview = document.createElement("img");
        preview.src = thumbnails?.[partKey]?.[variant.name] || "";
        preview.className = "thumb";
        thumbWrapper.appendChild(preview);

        // Naslov
        const label = document.createElement("div");
        label.className = "title";
        label.textContent = variant.name;
        thumbWrapper.appendChild(label);

        // Badge (npr. A, B, C…)
        const badge = document.createElement("div");
        badge.className = "variant-badge";
        badge.textContent = variant.name.slice(-1);
        thumbWrapper.appendChild(badge);

        itemEl.appendChild(thumbWrapper);

        // === BODY ===
        const body = document.createElement("div");
        body.className = "variant-body";

        // Colors/Textures (ako postoje)
        if (variant.colors && variant.colors.length > 0) {
          const colorsDiv = document.createElement("div");
          colorsDiv.className = "colors";

          variant.colors.forEach((c) => {
            const colorEl = document.createElement("div");
            colorEl.className = "color-swatch";

            if (c.type === "texture" && c.texture) {
              colorEl.style.backgroundImage = `url(${c.texture})`;
              colorEl.style.backgroundSize = "cover";
            } else if (c.type === "color" && c.color) {
              colorEl.style.backgroundColor = `rgb(${c.color
                .map((v) => v * 255)
                .join(",")})`;
            }

            colorEl.title = c.name;

            colorEl.addEventListener("click", (e) => {
              e.stopPropagation();
              const node = nodesMeta.find((n) => n.name === partKey);
              if (!node) return;

              const activeVariant = currentParts[partKey];
              if (activeVariant !== variant.name) {
                console.warn(
                  `Boja/tekstura ignorisana: aktivna je ${activeVariant}, kliknuta ${variant.name}`
                );
                return;
              }

              // Uzmi mainMat iz config.js
              const cfgGroup =
                Object.values(VARIANT_GROUPS).find((g) => partKey in g) || {};
              const mainMat = cfgGroup[partKey]?.mainMat || "";

              // ako je tekstura
              if (c.type === "texture" && c.texture) {
                const img = new Image();
                img.src = c.texture;
                img.onload = () => {
                  const tex = gl.createTexture();
                  gl.bindTexture(gl.TEXTURE_2D, tex);
                  gl.texImage2D(
                    gl.TEXTURE_2D,
                    0,
                    gl.RGBA,
                    gl.RGBA,
                    gl.UNSIGNED_BYTE,
                    img
                  );
                  gl.generateMipmap(gl.TEXTURE_2D);
                  gl.texParameteri(
                    gl.TEXTURE_2D,
                    gl.TEXTURE_MIN_FILTER,
                    gl.LINEAR_MIPMAP_LINEAR
                  );
                  gl.texParameteri(
                    gl.TEXTURE_2D,
                    gl.TEXTURE_MAG_FILTER,
                    gl.LINEAR
                  );

                  for (const r of node.renderIdxs) {
                    if (!mainMat || r.matName === mainMat) {
                      modelBaseTextures[r.idx] = tex;
                    }
                  }
                  render();
                };
              }
              // ako je boja
              else if (c.type === "color" && c.color) {
                for (const r of node.renderIdxs) {
                  if (!mainMat || r.matName === mainMat) {
                    modelBaseColors[r.idx] = new Float32Array(c.color);
                    modelBaseTextures[r.idx] = null; // isključi teksturu
                  }
                }
              }

              updatePartsTable(partKey, `${variant.name} (${c.name})`);
              currentParts[partKey] = variant.name;

              colorsDiv
                .querySelectorAll(".color-swatch")
                .forEach((el) => el.classList.remove("selected"));
              colorEl.classList.add("selected");

              render();
              showPartInfo(`${variant.name} (${c.name})`);
            });

            colorsDiv.appendChild(colorEl);
          });

          body.appendChild(colorsDiv);
        }

        itemEl.appendChild(body);

        // === FOOTER ===
        const footer = document.createElement("div");
        footer.className = "variant-footer";

        const rawPrice = PART_PRICES?.[variant.name] || 0;
        let priceText = "";
        if (rawPrice === 0) {
          priceText = "Uključeno";
        } else if (typeof rawPrice === "number") {
          priceText = `+${rawPrice} €`;
        } else {
          priceText = rawPrice;
        }

        footer.innerHTML = `<span class="price">${priceText}</span>`;
        itemEl.appendChild(footer);

        // === CLICK HANDLER NA KARTICU ===
        itemEl.addEventListener("click", () => {
          const node = nodesMeta.find((n) => n.name === partKey);
          if (!node) return;

          highlightTreeSelection(node.id);

          replaceSelectedWithURL(variant.src, variant.name, partKey);
          updatePartsTable(partKey, variant.name);
          currentParts[partKey] = variant.name;

          itemsDiv
            .querySelectorAll(".variant-item")
            .forEach((el) => el.classList.remove("active"));
          itemEl.classList.add("active");

          itemsDiv
            .querySelectorAll(".color-swatch")
            .forEach((el) => el.classList.remove("selected"));

          focusCameraOnNode(node);
          render();
          showPartInfo(variant.name);
        });

        itemsDiv.appendChild(itemEl);
      });
    }

    groupDiv.appendChild(itemsDiv);
    sidebar.appendChild(groupDiv);
  }
}

function buildPartsTable() {
  const tbody = document.querySelector("#partsTable tbody");
  tbody.innerHTML = "";

  for (const groupName in VARIANT_GROUPS) {
    const group = VARIANT_GROUPS[groupName];
    for (const partName in group) {
      const defaultVariant = partName; // A varijanta je base
      currentParts[partName] = defaultVariant;

      const price = PART_PRICES[defaultVariant] || 0;

      const tr = document.createElement("tr");
      tr.dataset.part = partName;
      tr.innerHTML = `
        <td>${groupName}</td>
        <td>${defaultVariant}</td>
        <td>${price} €</td>
      `;
      tbody.appendChild(tr);
    }
  }
}

function updatePartsTable(partName, newVariant) {
  currentParts[partName] = newVariant;

  const baseVariant = newVariant.split(" (")[0];
  const price = PART_PRICES[baseVariant] || 0;

  const row = document.querySelector(`#partsTable tr[data-part="${partName}"]`);
  if (row) {
    row.innerHTML = `
      <td>${partName}</td>
      <td>${newVariant}</td>
      <td>${price === 0 ? "Uključeno" : `+${price} €`}</td>
    `;
  }

  // 👇 DODAJ OVO
  updateTotalPrice();
}
function updateTotalPrice() {
  let total = BASE_PRICE;

  for (const partKey in currentParts) {
    const baseVariant = currentParts[partKey].split(" (")[0];
    total += PART_PRICES[baseVariant] || 0;
  }

  // Update tfoot u info panelu
  let totalRow = document.querySelector("#partsTable tfoot tr");
  if (!totalRow) {
    const tfoot = document.createElement("tfoot");
    totalRow = document.createElement("tr");
    document.querySelector("#partsTable").appendChild(tfoot);
    tfoot.appendChild(totalRow);
  }
  totalRow.innerHTML = `
    <td colspan="2" style="text-align:right; font-weight:700;">Ukupno:</td>
    <td style="font-size:16px; font-weight:700; color:#3aa4ff;">
      ${total.toLocaleString("de-DE")} €
    </td>
  `;

  // 👇 NOVO — update sidebar total
  const sidebarPrice = document.querySelector(".sidebar-total .price");
  if (sidebarPrice) {
    sidebarPrice.textContent = `${total.toLocaleString("de-DE")} €`;
  }
}

function highlightTreeSelection(id) {
  document
    .querySelectorAll("#nodeTree li")
    .forEach((li) => li.classList.toggle("selected", +li.dataset.id === id));
}

// 1. Preračunaj bounding box u svetlosnom prostoru
function computeLightBounds(min, max, lightView) {
  const corners = [
    [min[0], min[1], min[2], 1],
    [max[0], min[1], min[2], 1],
    [min[0], max[1], min[2], 1],
    [max[0], max[1], min[2], 1],
    [min[0], min[1], max[2], 1],
    [max[0], min[1], max[2], 1],
    [min[0], max[1], max[2], 1],
    [max[0], max[1], max[2], 1],
  ];

  let lmin = [Infinity, Infinity, Infinity];
  let lmax = [-Infinity, -Infinity, -Infinity];

  for (const c of corners) {
    const v = vec4.transformMat4([], c, lightView);
    lmin[0] = Math.min(lmin[0], v[0]);
    lmin[1] = Math.min(lmin[1], v[1]);
    lmin[2] = Math.min(lmin[2], v[2]);
    lmax[0] = Math.max(lmax[0], v[0]);
    lmax[1] = Math.max(lmax[1], v[1]);
    lmax[2] = Math.max(lmax[2], v[2]);
  }

  return { lmin, lmax };
}

function render() {
  let reflView = null;

  // === 1. Animacija kamere i matrica pogleda ===
  animateCamera();
  updateView();
  renderBoatMask();

  // === 1A. CLEAR FINALNI FBO NA POČETKU (OBAVEZNO!) ===
  gl.bindFramebuffer(gl.FRAMEBUFFER, finalFBO);
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.clearColor(0, 0, 0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

  // === 2. Quad VAO za fullscreen post-process (radi se jednom) ===
  if (!quadVAO) {
    const quadVertices = new Float32Array([
      // pos        // uv
      -1, 1, 0, 0, 1, -1, -1, 0, 0, 0, 1, 1, 0, 1, 1, 1, -1, 0, 1, 0,
    ]);

    quadVAO = gl.createVertexArray();
    const quadVBO = gl.createBuffer();

    gl.bindVertexArray(quadVAO);
    gl.bindBuffer(gl.ARRAY_BUFFER, quadVBO);
    gl.bufferData(gl.ARRAY_BUFFER, quadVertices, gl.STATIC_DRAW);

    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 20, 0);

    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 20, 12);

    gl.bindVertexArray(null);
  }

// === 3. Shadow map pass ===
gl.bindFramebuffer(gl.FRAMEBUFFER, shadowFBO);
gl.viewport(0, 0, SHADOW_RES, SHADOW_RES);
gl.clear(gl.DEPTH_BUFFER_BIT);

// --- shadow render state ---
gl.enable(gl.CULL_FACE);
gl.cullFace(gl.BACK);             // 👈 backface culling zamenjen front-face
gl.enable(gl.POLYGON_OFFSET_FILL);
gl.polygonOffset(6.0, 8.0);        // 👈 blaži offset, dovoljno za acne

  const lightPos = [SUN.dir[0] * 20, SUN.dir[1] * 20, SUN.dir[2] * 20];
  const lightView = look(lightPos, [0, 0, 0], [0, 1, 0]);
  const SHADOW_EXPAND = 0.0;
  const minBB = [
    boatMin[0] - SHADOW_EXPAND,
    boatMin[1] - SHADOW_EXPAND,
    boatMin[2] - SHADOW_EXPAND,
  ];
  const maxBB = [
    boatMax[0] + SHADOW_EXPAND,
    boatMax[1] + SHADOW_EXPAND,
    boatMax[2] + SHADOW_EXPAND,
  ];
  const { lmin, lmax } = computeLightBounds(minBB, maxBB, lightView);
  const lightProj = ortho(
    lmin[0],
    lmax[0],
    lmin[1],
    lmax[1],
    -lmax[2],
    -lmin[2]
  );
  const lightVP = mat4mul(lightProj, lightView);

  gl.useProgram(shadowProgram);
  gl.uniformMatrix4fv(
    gl.getUniformLocation(shadowProgram, "uLightVP"),
    false,
    lightVP
  );
  for (let i = 0; i < modelVAOs.length; ++i) {
    if (!idxCounts[i]) continue;
    gl.uniformMatrix4fv(
      gl.getUniformLocation(shadowProgram, "uModel"),
      false,
      modelMatrices[i]
    );
    gl.bindVertexArray(modelVAOs[i]);
    gl.drawElements(gl.TRIANGLES, idxCounts[i], idxTypes[i], 0);
  }

// posle shadow passa
gl.disable(gl.POLYGON_OFFSET_FILL);

  // === 3B. Reflection pass ===
  if (showWater) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, reflectionFBO);
    
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);

    let reflCam = getReflectedCamera(camWorld, pan, [0, 1, 0]);
    let reflProj = proj;

    reflView = reflCam.view;

    // ✅ DODAJ OVO — prvo nacrtaj nebo u reflection FBO
    drawSky(gl, reflectionFBO, reflView, reflProj, SUN.dir, {
      ...DEFAULT_SKY,
      worldLocked: 1,
      sunColor: SUN.color,
      sunIntensity: SUN.intensity,
      useTonemap: false,
    });

    gl.useProgram(reflectionColorProgram);
    gl.uniform3fv(
      gl.getUniformLocation(reflectionColorProgram, "uSunDir"),
      SUN.dir
    );
    gl.uniform3fv(
      gl.getUniformLocation(reflectionColorProgram, "uSunColor"),
      SUN.color
    );
    gl.uniform1f(
      gl.getUniformLocation(reflectionColorProgram, "uSunIntensity"),
      SUN.intensity
    );
    gl.uniform3fv(
      gl.getUniformLocation(reflectionColorProgram, "uCameraPos"),
      camWorld
    );
    gl.uniform1f(
      gl.getUniformLocation(reflectionColorProgram, "uRoughness"),
      0.08
    );
    gl.uniform1f(
      gl.getUniformLocation(reflectionColorProgram, "uSpecularStrength"),
      1.0
    );
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_CUBE_MAP, envTex);
    gl.uniform1i(gl.getUniformLocation(reflectionColorProgram, "uEnvMap"), 1);
    gl.uniformMatrix4fv(
      gl.getUniformLocation(reflectionColorProgram, "uProjection"),
      false,
      reflProj
    );
    gl.uniformMatrix4fv(
      gl.getUniformLocation(reflectionColorProgram, "uView"),
      false,
      reflView
    );
    for (let i = 0; i < modelVAOs.length; ++i) {
      const meshName = nodesMeta[renderToNodeId[i]]?.name?.toLowerCase() || "";
      if (meshName.includes("water")) continue;
      if (
        originalParts[i]?.alphaMode === "BLEND" ||
        originalParts[i]?.opacity < 0.999
      )
        continue;
      if (!idxCounts[i]) continue;
      gl.uniformMatrix4fv(
        gl.getUniformLocation(reflectionColorProgram, "uModel"),
        false,
        modelMatrices[i]
      );
      gl.uniform3fv(
        gl.getUniformLocation(reflectionColorProgram, "uBaseColor"),
        modelBaseColors[i] || [1, 1, 1]
      );
      if (modelBaseTextures[i]) {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, modelBaseTextures[i]);
        gl.uniform1i(
          gl.getUniformLocation(reflectionColorProgram, "uBaseColorTex"),
          0
        );
        gl.uniform1i(
          gl.getUniformLocation(reflectionColorProgram, "uUseBaseColorTex"),
          1
        );
      } else {
        gl.uniform1i(
          gl.getUniformLocation(reflectionColorProgram, "uUseBaseColorTex"),
          0
        );
      }
      gl.bindVertexArray(modelVAOs[i]);
      gl.drawElements(gl.TRIANGLES, idxCounts[i], idxTypes[i], 0);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, null);
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, null);
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, null);
  gl.activeTexture(gl.TEXTURE2);
  gl.bindTexture(gl.TEXTURE_2D, null);

  // === 4. Geometry pass (g-buffer) za opaque objekte ===
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.bindFramebuffer(gl.FRAMEBUFFER, gBuffer);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
gl.enable(gl.DEPTH_TEST);
gl.depthMask(true);
  gl.useProgram(gBufferProgram);
  gl.uniformMatrix4fv(
    gl.getUniformLocation(gBufferProgram, "uProjection"),
    false,
    proj
  );
  gl.uniformMatrix4fv(
    gl.getUniformLocation(gBufferProgram, "uView"),
    false,
    view
  );
  for (let i = 0; i < modelVAOs.length; ++i) {
    if (!idxCounts[i]) continue;
    gl.uniformMatrix4fv(
      gl.getUniformLocation(gBufferProgram, "uModel"),
      false,
      modelMatrices[i]
    );
    gl.uniform3fv(
      gl.getUniformLocation(gBufferProgram, "uBaseColor"),
      modelBaseColors[i] || [1, 1, 1]
    );
    gl.uniform1f(
      gl.getUniformLocation(gBufferProgram, "uMetallic"),
      modelMetallics[i] ?? 1.0
    );
    gl.uniform1f(
      gl.getUniformLocation(gBufferProgram, "uRoughness"),
      modelRoughnesses[i] ?? 1.0
    );
    if (modelBaseTextures[i]) {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, modelBaseTextures[i]);
      gl.uniform1i(gl.getUniformLocation(gBufferProgram, "uBaseColorTex"), 0);
      gl.uniform1i(
        gl.getUniformLocation(gBufferProgram, "uUseBaseColorTex"),
        1
      );
    } else {
      gl.uniform1i(
        gl.getUniformLocation(gBufferProgram, "uUseBaseColorTex"),
        0
      );
    }
    gl.bindVertexArray(modelVAOs[i]);
    gl.drawElements(gl.TRIANGLES, idxCounts[i], idxTypes[i], 0);
  }

  // === 5. SSAO pass ===
  gl.bindFramebuffer(gl.FRAMEBUFFER, ssaoFBO);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.useProgram(ssaoProgram);

  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, gPosition);
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, gNormal);
  gl.activeTexture(gl.TEXTURE2);
  gl.bindTexture(gl.TEXTURE_2D, ssaoNoiseTexture);
  gl.uniform1i(gl.getUniformLocation(ssaoProgram, "gPosition"), 0);
  gl.uniform1i(gl.getUniformLocation(ssaoProgram, "gNormal"), 1);
  gl.uniform1i(gl.getUniformLocation(ssaoProgram, "tNoise"), 2);
  gl.activeTexture(gl.TEXTURE3);
  gl.bindTexture(gl.TEXTURE_2D, gAlbedo);
  gl.uniform1i(gl.getUniformLocation(ssaoProgram, "gAlbedo"), 3);
  gl.uniform3fv(gl.getUniformLocation(ssaoProgram, "samples"), ssaoKernel);
  gl.uniformMatrix4fv(
    gl.getUniformLocation(ssaoProgram, "uProjection"),
    false,
    proj
  );
  gl.bindVertexArray(quadVAO);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

  // === 6. SSAO blur ===
  gl.bindFramebuffer(gl.FRAMEBUFFER, ssaoBlurFBO);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.useProgram(blurProgram);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, ssaoColorBuffer);
  gl.uniform1i(gl.getUniformLocation(blurProgram, "ssaoInput"), 0);
  gl.bindVertexArray(quadVAO);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

  // === 7. SVE ŠTO SLEDI CRTAS U finalFBO (NIŠTA VIŠE NE BINDUJ) ===

  // --- Proceduralno nebo ---
  gl.bindFramebuffer(gl.FRAMEBUFFER, finalFBO);
  gl.viewport(0, 0, canvas.width, canvas.height);
  drawSky(gl, finalFBO, view, proj, SUN.dir, {
    ...DEFAULT_SKY,
    sunColor: SUN.color,
    sunIntensity: SUN.intensity,
    useTonemap: false,
  });

  // --- Lighting pass (PBR shading) ---
  gl.useProgram(program);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, gPosition);
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, gNormal);
  gl.activeTexture(gl.TEXTURE2);
  gl.bindTexture(gl.TEXTURE_2D, gAlbedo);
  gl.activeTexture(gl.TEXTURE3);
  gl.bindTexture(gl.TEXTURE_2D, gMaterial);
  gl.activeTexture(gl.TEXTURE4);
  gl.bindTexture(gl.TEXTURE_2D, ssaoBlurBuffer);
  gl.activeTexture(gl.TEXTURE8);
  gl.bindTexture(gl.TEXTURE_2D, ssaoBlurBuffer);
  gl.uniform1i(gl.getUniformLocation(program, "tBentNormalAO"), 8);
  gl.activeTexture(gl.TEXTURE5);
  gl.bindTexture(gl.TEXTURE_CUBE_MAP, envTex);
  gl.activeTexture(gl.TEXTURE6);
  gl.bindTexture(gl.TEXTURE_2D, brdfTex);
  gl.activeTexture(gl.TEXTURE7);
  gl.bindTexture(gl.TEXTURE_2D, shadowDepthTex);
// === SSR depth ===

gl.uniform2f(gl.getUniformLocation(program, "uResolution"), canvas.width, canvas.height);

  gl.uniform1i(gl.getUniformLocation(program, "gPosition"), 0);
  gl.uniform1i(gl.getUniformLocation(program, "gNormal"), 1);
  gl.uniform1i(gl.getUniformLocation(program, "gAlbedo"), 2);
  gl.uniform1i(gl.getUniformLocation(program, "gMaterial"), 3);
  gl.uniform1i(gl.getUniformLocation(program, "ssao"), 4);
  gl.uniform1i(gl.getUniformLocation(program, "uEnvMap"), 5);
  gl.uniform1f(gl.getUniformLocation(program, "uCubeMaxMip"), cubeMaxMip);
  gl.uniform1i(gl.getUniformLocation(program, "uBRDFLUT"), 6);
  gl.uniform1i(gl.getUniformLocation(program, "uShadowMap"), 7);
  gl.uniformMatrix4fv(gl.getUniformLocation(program, "uView"), false, view);
  gl.uniformMatrix4fv(gl.getUniformLocation(program, "uLightVP"), false, lightVP);
  gl.uniform3fv(gl.getUniformLocation(program, "uCameraPos"), camWorld);
  gl.uniform3fv(gl.getUniformLocation(program, "uSunDir"), SUN.dir);
  gl.uniform3fv(gl.getUniformLocation(program, "uSunColor"), SUN.color);
  gl.uniform1f(gl.getUniformLocation(program, "uSunIntensity"), SUN.intensity);
  gl.uniform1f(gl.getUniformLocation(program, "uLightSize"), 0.025);
  gl.uniform2f(gl.getUniformLocation(program, "uShadowMapSize"),SHADOW_RES,SHADOW_RES);
  gl.uniform1f(gl.getUniformLocation(program, "uBiasBase"), 0.00005);
  gl.uniform1f(gl.getUniformLocation(program, "uBiasSlope"), 0.002);

  

  gl.bindVertexArray(quadVAO);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  if (showWater) {
    // NEMOJ PONOVO bindFramebuffer(finalFBO)! (VEĆ SI U njemu)
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(true);
    gl.disable(gl.CULL_FACE);
    // ⬇️ Kopiraj depth iz gBuffer u finalFBO pre crtanja vode
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, gBuffer);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, finalFBO);
    gl.blitFramebuffer(
      0,
      0,
      canvas.width,
      canvas.height,
      0,
      0,
      canvas.width,
      canvas.height,
      gl.DEPTH_BUFFER_BIT,
      gl.NEAREST
    );
    drawWater(
      gl,
      proj,
      view,
      camWorld,
      [0, 0, 0],
      envTex,
      SUN.dir,
      SUN.color,
      SUN.intensity,
      performance.now() * 0.001,
      sceneDepthTex,
      gAlbedo,
      0.1,
      100000.0,
      [canvas.width, canvas.height],
      shadowDepthTex,
      lightVP,
      reflectionTex,
      mat4mul(proj, reflView)
    );
  }
  // === 11. Overlay / dimenzije (ako su uključene) ===
  if (showDimensions && boatLengthLine && boatMin && boatMax) {
    gl.useProgram(lineProgram);
    setMatrices(lineProgram);
    gl.uniform3fv(gl.getUniformLocation(lineProgram, "uColor"), [1, 1, 1]);
    gl.bindVertexArray(boatLengthLine.vao);
    gl.drawArrays(gl.LINES, 0, boatLengthLine.count);
    gl.bindVertexArray(null);

    // render label na 2D overlay (dužina u metrima)
    const leftPt = [boatMin[0], boatMin[1], boatMax[2]];
    const rightPt = [boatMax[0], boatMin[1], boatMax[2]];
    const viewProj = mat4mul(proj, view);
    const canvasEl = document.getElementById("glCanvas");
    const p1 = projectToScreen(leftPt, viewProj, canvasEl);
    const p2 = projectToScreen(rightPt, viewProj, canvasEl);
    if (p1.visible && p2.visible) {
      const midX = (p1.x + p2.x) / 2;
      const midY = (p1.y + p2.y) / 2;
      const length = (boatMax[0] - boatMin[0]).toFixed(2);
      let labelsDiv = document.getElementById("labels");
      let lbl = document.getElementById("lengthLabel");
      if (!lbl) {
        lbl = document.createElement("div");
        lbl.id = "lengthLabel";
        lbl.className = "label";
        labelsDiv.appendChild(lbl);
      }
      lbl.innerText = length + " m";
      const rect = canvasEl.getBoundingClientRect();
      const scaleX = rect.width / canvasEl.width;
      const scaleY = rect.height / canvasEl.height;
      lbl.style.left = `${rect.left + midX * scaleX}px`;
      lbl.style.top = `${rect.top + (midY + 40) * scaleY}px`;
    }
  }

    // === 10. Transparent/Overlay/Dimenzije ===
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, gBuffer);
  gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, finalFBO);
  gl.blitFramebuffer(
    0, 0, canvas.width, canvas.height,
    0, 0, canvas.width, canvas.height,
    gl.DEPTH_BUFFER_BIT,
    gl.NEAREST
  );
gl.bindFramebuffer(gl.FRAMEBUFFER, finalFBO);
gl.viewport(0, 0, canvas.width, canvas.height);
gl.enable(gl.BLEND);
gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
gl.enable(gl.DEPTH_TEST);
gl.depthFunc(gl.LEQUAL);
gl.depthMask(false);

gl.enable(gl.CULL_FACE);
gl.frontFace(gl.CCW);  

// (bolje sortiranje: po „najdaljem z“ duž pravca pogleda)
const V = v3.norm(v3.sub(pan, camWorld)); // view dir: target - eye
transparentMeshes.forEach(m => {
  if (!m._bbComputed) {
    const b = computeBounds(m.pos);
    m._centerLocal = [
      (b.min[0]+b.max[0]) * 0.5,
      (b.min[1]+b.max[1]) * 0.5,
      (b.min[2]+b.max[2]) * 0.5
    ];
    // gruba sfera: poluprečnik kao max odstupanje od centra
    m._radiusLocal = Math.hypot(
      b.max[0]-m._centerLocal[0],
      b.max[1]-m._centerLocal[1],
      b.max[2]-m._centerLocal[2]
    );
    m._bbComputed = true;
  }
  const cw = mulMat4Vec4([], m.modelMat, [m._centerLocal[0], m._centerLocal[1], m._centerLocal[2], 1]);
  // projekcija na pravac pogleda + radius → „najdalja tačka“
  m._farDepth = (cw[0]-camWorld[0])*V[0] + (cw[1]-camWorld[1])*V[1] + (cw[2]-camWorld[2])*V[2] + m._radiusLocal;
});
// sort: od najdaljeg ka najbližem (Painter)
transparentMeshes.sort((a,b) => b._farDepth - a._farDepth);

// bind program + zajednički uniformi
gl.useProgram(programGlass);
gl.uniformMatrix4fv(gl.getUniformLocation(programGlass, "uView"), false, view);
gl.uniformMatrix4fv(gl.getUniformLocation(programGlass, "uProjection"), false, proj);
gl.activeTexture(gl.TEXTURE0);
gl.bindTexture(gl.TEXTURE_CUBE_MAP, envTex);
gl.uniform1i(gl.getUniformLocation(programGlass, "uEnvMap"), 0);
gl.uniform3fv(gl.getUniformLocation(programGlass, "uCameraPos"), camWorld);

// PASS 1: BACK-FACES PRVI
gl.cullFace(gl.FRONT);
for (const m of transparentMeshes) {
  if (!m.count) continue;
  gl.uniformMatrix4fv(gl.getUniformLocation(programGlass, "uModel"), false, m.modelMat);
  gl.uniform3fv(gl.getUniformLocation(programGlass, "uBaseColor"), m.baseColor || [1,1,1]);
  gl.uniform1f(gl.getUniformLocation(programGlass, "uRoughness"), m.roughness ?? 1.0);
  gl.uniform1f(gl.getUniformLocation(programGlass, "uMetallic"),  m.metallic  ?? 0.0);
  gl.uniform1f(gl.getUniformLocation(programGlass, "uOpacity"),   m.opacity   ?? 1.0);
  gl.bindVertexArray(m.vao);
  gl.drawElements(gl.TRIANGLES, m.count, m.type, 0);
}

// PASS 2: FRONT-FACES POSLE
gl.cullFace(gl.BACK);
for (const m of transparentMeshes) {
  if (!m.count) continue;
  gl.uniformMatrix4fv(gl.getUniformLocation(programGlass, "uModel"), false, m.modelMat);
  gl.uniform3fv(gl.getUniformLocation(programGlass, "uBaseColor"), m.baseColor || [1,1,1]);
  gl.uniform1f(gl.getUniformLocation(programGlass, "uRoughness"), m.roughness ?? 1.0);
  gl.uniform1f(gl.getUniformLocation(programGlass, "uMetallic"),  m.metallic  ?? 0.0);
  gl.uniform1f(gl.getUniformLocation(programGlass, "uOpacity"),   m.opacity   ?? 1.0);
  gl.bindVertexArray(m.vao);
  gl.drawElements(gl.TRIANGLES, m.count, m.type, 0);
}

// cleanup
gl.disable(gl.BLEND);
gl.depthMask(true);
gl.depthFunc(gl.LESS);
gl.cullFace(gl.BACK);

  
// --- tonemap ---
gl.bindFramebuffer(gl.FRAMEBUFFER, null);
gl.viewport(0, 0, canvas.width, canvas.height);
gl.useProgram(acesProgram);
gl.activeTexture(gl.TEXTURE0);
gl.bindTexture(gl.TEXTURE_2D, finalColorTex);
gl.uniform1i(gl.getUniformLocation(acesProgram, "uInput"), 0);
gl.bindVertexArray(quadVAO);
gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

// ✅ tek sada resetuj GL stanje
gl.disable(gl.BLEND);
gl.depthMask(true);
gl.depthFunc(gl.LESS);
gl.enable(gl.CULL_FACE);

}


function renderLoop() {
  const FRAME_INTERVAL = 1000 / MAX_FPS; // uvek koristi trenutni MAX_FPS
  const now = performance.now();
  const delta = now - lastFrameTime;

  if (delta >= FRAME_INTERVAL) {
    lastFrameTime = now - (delta % FRAME_INTERVAL);
    // 🔽 ovde interpolacija
    ssaa += (targetSSAA - ssaa) * 0.6;

    // ako se dovoljno promenilo, tek tad resize
    if (Math.abs(targetSSAA - ssaa) > 0.01) {
      resizeCanvas();
    }

    render();
    updateFPS();
    autoAdjustSSAA();
  }

  requestAnimationFrame(renderLoop);
}

const infoPanel = document.getElementById("info-panel");
const toggleBtn = document.getElementById("toggle-info");

toggleBtn.addEventListener("click", () => {
  infoPanel.classList.toggle("open");
});

function showPartInfo(name) {
  const partInfo = document.getElementById("part-info");
  if (partInfo) {
    partInfo.textContent = `Izabran deo: ${name}`;
  }
}

/* ------------------------------------------------------------------
   GLB LOADER + TREE-VIEW META
------------------------------------------------------------------ */
function loadGLB(buf) {
  modelVAOs = [];
  idxCounts = [];
  idxTypes = [];
  modelMatrices = [];
  nodesMeta = [];
  renderToNodeId = {};
  modelBaseColors = [];
  modelMetallics = [];
  modelRoughnesses = [];
  modelBaseTextures = [];
  originalParts = {};
  transparentMeshes = [];

  /* ---------- PARSIRAJ GLB ---------- */
  const dv = new DataView(buf);
  let o = 0;
  if (dv.getUint32(o, true) !== 0x46546c67) return; // "glTF"
  o += 12;
  const jlen = dv.getUint32(o, true);
  o += 4;
  const jtype = dv.getUint32(o, true);
  o += 4;
  const jtxt = new TextDecoder().decode(new Uint8Array(buf, o, jlen));
  o += jlen;
  if (jtype !== 0x4e4f534a) return; // "JSON"
  const gltf = JSON.parse(jtxt);
  const blen = dv.getUint32(o, true);
  o += 8;
  const bin = buf.slice(o, o + blen);
  const bv = gltf.bufferViews;
  const ac = gltf.accessors;

  /* ---------- OBRADI SVE MESH / PRIMITIVE ---------- */
  for (let meshIdx = 0; meshIdx < gltf.meshes.length; ++meshIdx) {
    const mesh = gltf.meshes[meshIdx];
    for (const pr of mesh.primitives) {
      /* ----- Materijal ----- */
      const matIndex = pr.material || 0;
      const mat = (gltf.materials && gltf.materials[matIndex]) || {};
      const pbr = mat.pbrMetallicRoughness || {};

      const baseColorFactor = pbr.baseColorFactor || [1, 1, 1, 1];
      const baseColor = new Float32Array(baseColorFactor.slice(0, 3));
      let baseColorTex = null;

      const metallic =
        typeof pbr.metallicFactor === "number" ? pbr.metallicFactor : 1.0;
      const roughness =
        typeof pbr.roughnessFactor === "number" ? pbr.roughnessFactor : 1.0;

      const opacity = baseColorFactor[3];
      const alphaMode = mat.alphaMode || "OPAQUE";
      const isBlend = alphaMode === "BLEND" || opacity < 0.99999;

      const baseColorTexIndex = pbr.baseColorTexture?.index;
      if (typeof baseColorTexIndex === "number") {
        baseColorTex = loadTextureFromImage(gltf, bin, baseColorTexIndex);
      }

      /* ----- Geometrija ----- */
      const pa = ac[pr.attributes.POSITION];
      const pv = bv[pa.bufferView];
      const pos = new Float32Array(bin, pv.byteOffset, pa.count * 3);

      const na = ac[pr.attributes.NORMAL];
      const nv = bv[na.bufferView];
      const nor = new Float32Array(bin, nv.byteOffset, na.count * 3);

      const ia = ac[pr.indices];
      const iv = bv[ia.bufferView];
      const ind =
        ia.componentType === 5125
          ? new Uint32Array(bin, iv.byteOffset, ia.count)
          : new Uint16Array(bin, iv.byteOffset, ia.count);
      const type =
        ia.componentType === 5125 ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT;

      let uvArray = null;
      const uvAttr = pr.attributes.TEXCOORD_0;
      if (uvAttr !== undefined) {
        const uvAccessor = gltf.accessors[uvAttr];
        const uvView = gltf.bufferViews[uvAccessor.bufferView];
        const uvOffset =
          (uvView.byteOffset || 0) + (uvAccessor.byteOffset || 0);
        uvArray = new Float32Array(bin, uvOffset, uvAccessor.count * 2);
      }

      /* ----- Kreiranje VAO / VBO ----- */
      const vao = gl.createVertexArray();
      gl.bindVertexArray(vao);

      const stride = (uvArray ? 8 : 6) * 4;
      const interleaved = new Float32Array(
        pos.length + nor.length + (uvArray ? uvArray.length : 0)
      );
      for (let i = 0, j = 0; i < pos.length / 3; ++i) {
        interleaved[j++] = pos[i * 3];
        interleaved[j++] = pos[i * 3 + 1];
        interleaved[j++] = pos[i * 3 + 2];
        interleaved[j++] = nor[i * 3];
        interleaved[j++] = nor[i * 3 + 1];
        interleaved[j++] = nor[i * 3 + 2];
        if (uvArray) {
          interleaved[j++] = uvArray[i * 2];
          interleaved[j++] = uvArray[i * 2 + 1];
        }
      }

      const vb = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, vb);
      gl.bufferData(gl.ARRAY_BUFFER, interleaved, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 3, gl.FLOAT, false, stride, 0);
      gl.enableVertexAttribArray(1);
      gl.vertexAttribPointer(1, 3, gl.FLOAT, false, stride, 12);
      if (uvArray) {
        gl.enableVertexAttribArray(2);
        gl.vertexAttribPointer(2, 2, gl.FLOAT, false, stride, 24);
      }

      const eb = gl.createBuffer();
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, eb);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, ind, gl.STATIC_DRAW);
      gl.bindVertexArray(null);

      /* ----- Matrica noda ----- */
      const myNode = (gltf.nodes || []).find((n) => n.mesh === meshIdx) || {};
      const t = myNode.translation || [0, 0, 0];
      const r = myNode.rotation || [0, 0, 0, 1];
      const s = myNode.scale || [1, 1, 1];
      const modelMat = composeTRS(t, r, s);

      if (isBlend) {
        /* ————————— PROVIDNI PRIMITIV ————————— */
        const meshObj = {
          vao,
          count: ind.length,
          type,
          modelMat,
          baseColor,
          roughness,
          metallic,
          opacity,
          baseColorTex,
          partName: myNode.name || `mesh_${meshIdx}`,

          //  🔑   DODATO  —  potrebno za thumbnail:
          pos: pos.slice(),
          nor: nor.slice(),
          ind: ind.slice(),
        };

        transparentMeshes.push(meshObj);

        /*  Zapamti fabričko (A) staklo za kasnije vraćanje  */
        const tag = meshObj.partName;
        if (!originalGlassByPart[tag]) originalGlassByPart[tag] = [];
        originalGlassByPart[tag].push({ ...meshObj });
      } else {
        /* OPAQUE → standardni nizovi */
        modelVAOs.push(vao);
        idxCounts.push(ind.length);
        idxTypes.push(type);

        modelBaseColors.push(baseColor);
        modelMetallics.push(metallic);
        modelRoughnesses.push(roughness);
        modelBaseTextures.push(baseColorTex || null);

        modelMatrices.push(modelMat);
        const renderIdx = modelMatrices.length - 1;

        originalParts[renderIdx] = {
          vao,
          count: ind.length,
          type,
          baseColor,
          metallic,
          roughness,
          baseColorTex,
          pos: pos.slice(),
          nor: nor.slice(),
          ind: ind.slice(),
          opacity, // 👈 dodato
          alphaMode: alphaMode, // 👈 dodato
        };
        if (!realOriginalParts[renderIdx]) {
          realOriginalParts[renderIdx] = {
            ...originalParts[renderIdx],
            modelMatrix: modelMat.slice(),
          };
        }

        let nodeId = nodesMeta.findIndex(
          (n) => n.name === (myNode.name || `mesh_${meshIdx}`)
        );
        if (nodeId === -1) {
          nodeId = nodesMeta.length;
          nodesMeta.push({
            id: nodeId,
            name: myNode.name || `mesh_${meshIdx}`,
            renderIdxs: [],
          });
        }
        nodesMeta[nodeId].renderIdxs.push({
          idx: renderIdx,
          matName: mat.name || `material_${renderIdx}`,
        });
        renderToNodeId[renderIdx] = nodeId;
      }
    }
  }

  /* ---------- Boundinzi i kamera ---------- */
  let min = [Infinity, Infinity, Infinity];
  let max = [-Infinity, -Infinity, -Infinity];
  boatMin = min;
  boatMax = max;

  for (const renderIdx in originalParts) {
    const part = originalParts[renderIdx];
    if (!part || !part.pos) continue;
    const mat = modelMatrices[renderIdx];
    for (let i = 0; i < part.pos.length; i += 3) {
      const p = [part.pos[i], part.pos[i + 1], part.pos[i + 2], 1];
      const w = vec4.transformMat4([], p, mat);
      min[0] = Math.min(min[0], w[0]);
      min[1] = Math.min(min[1], w[1]);
      min[2] = Math.min(min[2], w[2]);
      max[0] = Math.max(max[0], w[0]);
      max[1] = Math.max(max[1], w[1]);
      max[2] = Math.max(max[2], w[2]);
    }
  }

  window.sceneBoundingCenter = [
    (min[0] + max[0]) * 0.5,
    (min[1] + max[1]) * 0.5,
    (min[2] + max[2]) * 0.5,
  ];
  window.sceneBoundingRadius =
    Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]) * 0.5;
  boatLengthLine = makeLengthLine(min, max);
  window.envBox = {
  min: [
    sceneBoundingCenter[0] - sceneBoundingRadius * 2.0,
    sceneBoundingCenter[1] - sceneBoundingRadius * 1.0,
    sceneBoundingCenter[2] - sceneBoundingRadius * 2.0,
  ],
  max: [
    sceneBoundingCenter[0] + sceneBoundingRadius * 2.0,
    sceneBoundingCenter[1] + sceneBoundingRadius * 2.0,
    sceneBoundingCenter[2] + sceneBoundingRadius * 2.0,
  ],
};

  buildVariantSidebar();
  buildPartsTable();
  updateTotalPrice();

  const fovY = Math.PI / 4;
  const radius = window.sceneBoundingRadius || 1;

  // koliko treba da stane ceo model u širinu ekrana
  const neededDist = radius / Math.sin(fovY / 2);

  // malo pomeri nazad da ima prostora (faktor 1.1 – 1.2)
  distTarget = neededDist * 0.6;
  dist = distTarget;

  // centriraj kameru
  pan = window.sceneBoundingCenter.slice();

  // default orijentacija
  rx = rxTarget = Math.PI / 10;
  ry = ryTarget = Math.PI / 20;

  updateView();
}

function loadTextureFromImage(gltf, bin, texIndex) {
  const textureDef = gltf.textures[texIndex];
  const imageDef = gltf.images[textureDef.source];
  const samplerDef = gltf.samplers
    ? gltf.samplers[textureDef.sampler || 0]
    : {};

  const bufferView = gltf.bufferViews[imageDef.bufferView];
  const byteOffset = bufferView.byteOffset || 0;
  const byteLength = bufferView.byteLength;
  const mimeType = imageDef.mimeType;

  const blob = new Blob([bin.slice(byteOffset, byteOffset + byteLength)], {
    type: mimeType,
  });

  const url = URL.createObjectURL(blob);
  const image = new Image();

  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);

  // Temporary 1x1 pixel while image loads
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA,
    1,
    1,
    0,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    new Uint8Array([255, 0, 255, 255])
  );

  image.onload = () => {
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);

    const wrapS = samplerDef.wrapS || gl.REPEAT;
    const wrapT = samplerDef.wrapT || gl.REPEAT;
    const minFilter = samplerDef.minFilter || gl.LINEAR_MIPMAP_LINEAR;
    const magFilter = samplerDef.magFilter || gl.LINEAR;

    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrapS);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrapT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, minFilter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, magFilter);

    if (isPowerOf2(image.width) && isPowerOf2(image.height)) {
      gl.generateMipmap(gl.TEXTURE_2D);
    } else {
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    }

    URL.revokeObjectURL(url);
  };

  image.src = url;
  return tex;
}

function isPowerOf2(value) {
  return (value & (value - 1)) === 0;
}
function projectToScreen(worldPos3, viewProj, canvas) {
  const v = new Float32Array([worldPos3[0], worldPos3[1], worldPos3[2], 1]);
  const clip = new Float32Array(4);
  mulMat4Vec4(clip, viewProj, v);
  if (clip[3] <= 0.00001) return { visible: false, x: 0, y: 0 };
  const ndcX = clip[0] / clip[3],
    ndcY = clip[1] / clip[3];
  // važno: koristimo canvas.width/height (framebuffer dimenzije!)
  const x = (ndcX * 0.5 + 0.5) * canvas.width;
  const y = (1.0 - (ndcY * 0.5 + 0.5)) * canvas.height;
  return { visible: true, x, y };
}
/* -------------------------------------------------------------
   PARSE GLB  →  pripremi VAO + materijale za varijante (B, C…)
------------------------------------------------------------- */
async function parseGLBToPrepared(buf, url) {
  /* ---------- osnovno raspakivanje GLB ---------- */
  const dv = new DataView(buf);
  let off = 0;

  if (dv.getUint32(off, true) !== 0x46546c67) throw new Error("Not a GLB");
  off += 12; /* magic + ver + length */

  const jsonLen = dv.getUint32(off, true);
  off += 4;
  off += 4; /* JSON chunk type  */
  const jsonTxt = new TextDecoder().decode(new Uint8Array(buf, off, jsonLen));
  off += jsonLen;

  const gltf = JSON.parse(jsonTxt);
  const bin = buf.slice(off + 8); /* drugog hedera nam ne treba      */
  const views = gltf.bufferViews;
  const acc = gltf.accessors;

  const out = [];

  /* ---------- kroz SVE mesheve / primitive ---------- */
  for (let m = 0; m < gltf.meshes.length; ++m) {
    const mesh = gltf.meshes[m];

    for (let p = 0; p < mesh.primitives.length; ++p) {
      const prim = mesh.primitives[p];

      /* ========== GEOMETRIJA ========== */
      const aPos = acc[prim.attributes.POSITION];
      const vPos = views[aPos.bufferView];
      const pos = new Float32Array(bin, vPos.byteOffset, aPos.count * 3);

      const aNor = acc[prim.attributes.NORMAL];
      const vNor = views[aNor.bufferView];
      const nor = new Float32Array(bin, vNor.byteOffset, aNor.count * 3);

      const aIdx = acc[prim.indices];
      const vIdx = views[aIdx.bufferView];
      const ind =
        aIdx.componentType === 5125 /* UNSIGNED_INT ? */
          ? new Uint32Array(bin, vIdx.byteOffset, aIdx.count)
          : new Uint16Array(bin, vIdx.byteOffset, aIdx.count);
      const glIdxType =
        aIdx.componentType === 5125 ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT;

      /* interleaved POS+NOR  ->  VBO / VAO */
      const vao = gl.createVertexArray();
      gl.bindVertexArray(vao);

      const vbo = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, vbo);

      // --- UV atribut ---
      const uvAttr = prim.attributes.TEXCOORD_0;
      let uvArray = null;
      if (uvAttr !== undefined) {
        const uvAccessor = gltf.accessors[uvAttr];
        const uvView = gltf.bufferViews[uvAccessor.bufferView];
        const uvOffset =
          (uvView.byteOffset || 0) + (uvAccessor.byteOffset || 0);
        uvArray = new Float32Array(bin, uvOffset, uvAccessor.count * 2);
      }

      // --- interleaved: pos + nor + uv ---
      const stride = (uvArray ? 8 : 6) * 4;
      const inter = new Float32Array(
        pos.length + nor.length + (uvArray ? uvArray.length : 0)
      );
      for (let i = 0, j = 0; i < pos.length / 3; ++i) {
        inter[j++] = pos[i * 3];
        inter[j++] = pos[i * 3 + 1];
        inter[j++] = pos[i * 3 + 2];
        inter[j++] = nor[i * 3];
        inter[j++] = nor[i * 3 + 1];
        inter[j++] = nor[i * 3 + 2];
        if (uvArray) {
          inter[j++] = uvArray[i * 2];
          inter[j++] = uvArray[i * 2 + 1];
        }
      }
      gl.bufferData(gl.ARRAY_BUFFER, inter, gl.STATIC_DRAW);

      // --- attributes ---
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 3, gl.FLOAT, false, stride, 0);
      gl.enableVertexAttribArray(1);
      gl.vertexAttribPointer(1, 3, gl.FLOAT, false, stride, 12);
      if (uvArray) {
        gl.enableVertexAttribArray(2);
        gl.vertexAttribPointer(2, 2, gl.FLOAT, false, stride, 24);
      }

      const ebo = gl.createBuffer();
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ebo);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, ind, gl.STATIC_DRAW);

      gl.bindVertexArray(null);

      /* ========== MATERIJAL ========== */
      let baseColor = [1, 1, 1];
      let metallic = 1.0;
      let roughness = 1.0;
      let opacity = 1.0;
      let isBlend = false;
      let baseColorTex = null;

      if (prim.material !== undefined) {
        const mat = gltf.materials[prim.material] || {};
        const pbr = mat.pbrMetallicRoughness || {};

        if (pbr.baseColorFactor) {
          baseColor = pbr.baseColorFactor.slice(0, 3);
          opacity = pbr.baseColorFactor[3] ?? 1.0;
        }
        if (typeof pbr.metallicFactor === "number")
          metallic = pbr.metallicFactor;
        if (typeof pbr.roughnessFactor === "number")
          roughness = pbr.roughnessFactor;

        if (pbr.baseColorTexture) {
          const texIdx = pbr.baseColorTexture.index;
          baseColorTex = loadTextureFromImage(
            gltf,
            bin,
            texIdx
          ); /* ✨ isto kao u loadGLB */
        }

        const alphaMode = mat.alphaMode || "OPAQUE";
        isBlend = alphaMode === "BLEND" || opacity < 0.99999;
      }

      /* ---------- push rezultat ---------- */
      out.push({
        vao,
        count: ind.length,
        type: glIdxType,
        pos: pos.slice() /* potrebni su ti kasnije za thumbnaile */,
        nor: nor.slice(),
        ind: ind.slice(),

        baseColor: new Float32Array(baseColor),
        metallic,
        roughness,
        opacity,
        isBlend,
        baseColorTex,
        matName: gltf.materials[prim.material]?.name || `Mat_${p}`,
        trisWorld: [],
      });
    }
  }

  return out;
}

async function replaceSelectedWithURL(url, variantName, partName) {
  showLoading();

  /* 1) meta - подаци о делу који мењамо */
  const node = nodesMeta.find((n) => n.name === partName);
  if (!node) {
    console.warn("Node not found:", partName);
    hideLoading();
    return;
  }

  /* главни материјал (дефинисан у VARIANT_GROUPS) */
  const cfgGroup =
    Object.values(VARIANT_GROUPS).find((g) => partName in g) || {};
  const mainMat = cfgGroup[partName]?.mainMat || ""; // нпр. "Hull_Main"

  /* изабрана боја (ако постоји) */
  const customCol = selectedColors[`${partName}:${variantName}`] || null;

  /* 2) припреми примитиве варијанте коју желимо */
  let variantMeshes;
  /* 3) prvo ukloni sve blend primitive tog dela */
  transparentMeshes = transparentMeshes.filter((m) => m.partName !== partName);

  if (!url) {
    // fabrička “A”
    variantMeshes = node.renderIdxs
      .map((r) => realOriginalParts[r.idx])
      .filter(Boolean);

    // sada tek vrati fabričko staklo
    if (originalGlassByPart[partName]) {
      for (const g of originalGlassByPart[partName]) {
        transparentMeshes.push({
          ...g,
          renderIdx: -1,
          partName,
          modelMat:
            g.modelMat ||
            new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]),
        });
      }
    }
  } else {
    if (!preparedVariants[url]) {
      const buf =
        cachedVariants[url] || (await fetch(url).then((r) => r.arrayBuffer()));
      cachedVariants[url] = buf;
      preparedVariants[url] = await parseGLBToPrepared(buf, url);
    }
    variantMeshes = preparedVariants[url].filter(Boolean);
  }

  /* 4) слотови које је тај део раније користио */
  const oldSlots = node.renderIdxs.map((r) => r.idx);

  /* 5) обради СВЕ примитиве нове варијанте */
  for (let i = 0; i < variantMeshes.length; ++i) {
    const vm = variantMeshes[i];
    if (!vm) continue; /* прескочи “рупе” */

    /* ---- нађи или направи renderIdx слот ---- */
    let renderIdx;
    if (i < oldSlots.length) {
      renderIdx = oldSlots[i]; /* постојећи */
    } else {
      renderIdx = modelVAOs.length; /* нови */
      modelVAOs.push(null);
      idxCounts.push(0);
      idxTypes.push(null);
      modelMatrices.push(
        new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])
      );
      modelBaseColors.push(new Float32Array([1, 1, 1]));
      modelMetallics.push(1);
      modelRoughnesses.push(1);
      modelBaseTextures.push(null);

      node.renderIdxs.push({ idx: renderIdx, matName: vm.matName || "" });
      renderToNodeId[renderIdx] = node.id;
    }

    /* ---- провидни (blend) иде у transparentMeshes ---- */
    if (vm.isBlend) {
      transparentMeshes.push({
        ...vm,
        renderIdx,
        partName,
        modelMat: modelMatrices[renderIdx],
      });
      idxCounts[renderIdx] = 0; /* да га opaque pass прескочи */
      continue;
    }

    /* ---- opaque: попуни слот ---- */
    const useCustom = customCol && (!mainMat || vm.matName === mainMat);

    modelVAOs[renderIdx] = vm.vao;
    idxCounts[renderIdx] = vm.count;
    idxTypes[renderIdx] = vm.type;
    modelBaseColors[renderIdx] = useCustom ? customCol : vm.baseColor;
    modelMetallics[renderIdx] = vm.metallic;
    modelRoughnesses[renderIdx] = vm.roughness;
    modelBaseTextures[renderIdx] = vm.baseColorTex || null;

    /* снимимо копију за евентуални повратак */
    originalParts[renderIdx] = {
      vao: vm.vao,
      count: vm.count,
      type: vm.type,
      baseColor: modelBaseColors[renderIdx],
      metallic: vm.metallic,
      roughness: vm.roughness,
      baseColorTex: vm.baseColorTex || null,
      pos: vm.pos,
      nor: vm.nor,
      ind: vm.ind,
    };
  }

  /* 6) ако је нова варијанта краћа, угаси вишак старих слотова */
  for (let j = variantMeshes.length; j < oldSlots.length; ++j) {
    idxCounts[oldSlots[j]] = 0;
  }

  currentParts[partName] = variantName;
  focusCameraOnNode(node);
  hideLoading();
  render();
  showPartInfo(variantName);
}

function refreshThumbnailsInUI() {
  document.querySelectorAll(".variant-item").forEach((itemEl) => {
    const part = itemEl.dataset.part;
    const variant = itemEl.dataset.variant;
    const img = itemEl.querySelector("img.thumb");

    if (thumbnails?.[part]?.[variant]) {
      img.src = thumbnails[part][variant]; // 👈 zameni placeholder sa pravom slikom
    }
  });
}
async function preloadAllVariants() {
  const tasks = [];

  for (const [groupName, parts] of Object.entries(VARIANT_GROUPS)) {
    for (const [partName, data] of Object.entries(parts)) {
      for (const variant of data.models) {
        if (!variant.src) continue;
        if (cachedVariants[variant.src]) continue;

        const task = (async () => {
          try {
            const buf = await fetch(variant.src).then((r) => r.arrayBuffer());
            cachedVariants[variant.src] = buf;
            preparedVariants[variant.src] = await parseGLBToPrepared(
              buf,
              variant.src
            );
          } catch (e) {
            // preload preskočen zbog greške — ignoriši
          }
        })();

        tasks.push(task);
      }
    }
  }

  // Pokreni sve istovremeno
  await Promise.all(tasks);
}

async function generateThumbnailForVariant(partName, variant) {
  const gl2 = document.createElement("canvas").getContext("webgl2");
  gl2.canvas.width = 256;
  gl2.canvas.height = 256;

  const preview = await prepareVariantPreview(variant, partName, gl2);
  if (!preview || !preview.draws || !preview.draws.length) return null;

  const prog = getPreviewProgram(gl2);
  gl2.useProgram(prog);

  // Kamera iz ukupnog boundinga (preko svih materijala)
  const bounds = preview.bounds;
  const size = Math.max(
    bounds.max[0] - bounds.min[0],
    bounds.max[1] - bounds.min[1],
    bounds.max[2] - bounds.min[2]
  );
  const center = [
    (bounds.min[0] + bounds.max[0]) / 2,
    (bounds.min[1] + bounds.max[1]) / 2,
    (bounds.min[2] + bounds.max[2]) / 2,
  ];
  const dist = size * 1.8;

  const proj = persp(45, 1, 0.1, dist * 4);
  const eye = [
    center[0] + dist * Math.sin(Math.PI / 4),
    center[1] + size * 0.5,
    center[2] + dist * Math.cos(Math.PI / 4),
  ];
  const view = look(eye, center, [0, 1, 0]);
  const model = new Float32Array([
    1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1,
  ]);

  gl2.uniformMatrix4fv(
    gl2.getUniformLocation(prog, "uProjection"),
    false,
    proj
  );
  gl2.uniformMatrix4fv(gl2.getUniformLocation(prog, "uView"), false, view);
  gl2.uniformMatrix4fv(gl2.getUniformLocation(prog, "uModel"), false, model);

  gl2.viewport(0, 0, 256, 256);
  gl2.clearColor(0.15, 0.15, 0.18, 1);
  gl2.clear(gl2.COLOR_BUFFER_BIT | gl2.DEPTH_BUFFER_BIT);
  gl2.enable(gl2.DEPTH_TEST);

  const uColorLoc = gl2.getUniformLocation(prog, "uBaseColor");
  const uOpacityLoc = gl2.getUniformLocation(prog, "uOpacity"); // 👈 NOVO

  // 🔑 nacrtaj SVE materijale/primitive
  for (const d of preview.draws) {
    if (d.isBlend) {
      gl2.enable(gl2.BLEND);
      gl2.blendFunc(gl2.SRC_ALPHA, gl2.ONE_MINUS_SRC_ALPHA);
    }

    gl2.uniform3fv(uColorLoc, d.baseColor || new Float32Array([0.7, 0.7, 0.7]));
    gl2.uniform1f(uOpacityLoc, d.opacity !== undefined ? d.opacity : 1.0); // 👈 NOVO
    gl2.bindVertexArray(d.vao);
    gl2.drawElements(gl2.TRIANGLES, d.count, d.type, 0);

    if (d.isBlend) {
      gl2.disable(gl2.BLEND);
    }
  }

  gl2.bindVertexArray(null);

  return gl2.canvas.toDataURL("image/png");
}

async function generateAllThumbnails() {
  for (const [groupName, parts] of Object.entries(VARIANT_GROUPS)) {
    for (const [partName, data] of Object.entries(parts)) {
      thumbnails[partName] = {};

      for (const variant of data.models) {
        thumbnails[partName][variant.name] = await generateThumbnailForVariant(
          partName,
          variant
        );
      }
    }
  }
}

async function prepareVariantPreview(variant, partName, gl2) {
  /* helper – pravi VAO u gl2 kontekstu */
  function makeVAO(gl2, pos, nor, ind) {
    const vao = gl2.createVertexArray();
    gl2.bindVertexArray(vao);

    const vb = gl2.createBuffer();
    gl2.bindBuffer(gl2.ARRAY_BUFFER, vb);

    /* interleaved POS+NOR */
    const inter = new Float32Array(pos.length + nor.length);
    for (let i = 0, j = 0; i < pos.length / 3; i++) {
      inter[j++] = pos[i * 3];
      inter[j++] = pos[i * 3 + 1];
      inter[j++] = pos[i * 3 + 2];
      inter[j++] = nor[i * 3];
      inter[j++] = nor[i * 3 + 1];
      inter[j++] = nor[i * 3 + 2];
    }
    gl2.bufferData(gl2.ARRAY_BUFFER, inter, gl2.STATIC_DRAW);

    gl2.enableVertexAttribArray(0);
    gl2.vertexAttribPointer(0, 3, gl2.FLOAT, false, 24, 0);
    gl2.enableVertexAttribArray(1);
    gl2.vertexAttribPointer(1, 3, gl2.FLOAT, false, 24, 12);

    const eb = gl2.createBuffer();
    gl2.bindBuffer(gl2.ELEMENT_ARRAY_BUFFER, eb);
    gl2.bufferData(gl2.ELEMENT_ARRAY_BUFFER, ind, gl2.STATIC_DRAW);

    /* ⬇️  OVO JE BILO POGREŠNO – mora bindVertexArray */
    gl2.bindVertexArray(null);
    return vao;
  }

  /* -------------------------------------------------
     VARIJANTA A  (nema .src)
  --------------------------------------------------*/
  if (!variant || !variant.src) {
    const node = nodesMeta.find((n) => n.name === partName);
    if (!node) return null;

    const draws = [];
    let bbMin = [Infinity, Infinity, Infinity];
    let bbMax = [-Infinity, -Infinity, -Infinity];

    /* opaque */
    for (const r of node.renderIdxs) {
      const op = originalParts[r.idx];
      if (!op || !op.pos) continue;

      const vao = makeVAO(gl2, op.pos, op.nor, op.ind);
      draws.push({
        vao,
        count: op.ind.length,
        type:
          op.type === gl.UNSIGNED_INT ? gl2.UNSIGNED_INT : gl2.UNSIGNED_SHORT,
        baseColor: op.baseColor,
        opacity: 1.0,
        isBlend: false,
      });

      const b = computeBounds(op.pos);
      bbMin = [
        Math.min(bbMin[0], b.min[0]),
        Math.min(bbMin[1], b.min[1]),
        Math.min(bbMin[2], b.min[2]),
      ];
      bbMax = [
        Math.max(bbMax[0], b.max[0]),
        Math.max(bbMax[1], b.max[1]),
        Math.max(bbMax[2], b.max[2]),
      ];
    }

    /* fabričko staklo */
    (originalGlassByPart[partName] || []).forEach((g) => {
      const vao = makeVAO(gl2, g.pos, g.nor, g.ind);
      draws.push({
        vao,
        count: g.ind.length,
        type:
          g.type === gl.UNSIGNED_INT ? gl2.UNSIGNED_INT : gl2.UNSIGNED_SHORT,
        baseColor: g.baseColor,
        opacity: g.opacity,
        isBlend: true,
      });

      const b = computeBounds(g.pos);
      bbMin = [
        Math.min(bbMin[0], b.min[0]),
        Math.min(bbMin[1], b.min[1]),
        Math.min(bbMin[2], b.min[2]),
      ];
      bbMax = [
        Math.max(bbMax[0], b.max[0]),
        Math.max(bbMax[1], b.max[1]),
        Math.max(bbMax[2], b.max[2]),
      ];
    });

    if (!draws.length) return null;
    return { draws, bounds: { min: bbMin, max: bbMax } };
  }

  /* -------------------------------------------------
     VARIJANTA B / C  (ima .src)
  --------------------------------------------------*/
  if (variant.src) {
    if (!preparedVariants[variant.src]) {
      let buf = cachedVariants[variant.src];
      if (!buf) buf = await fetch(variant.src).then((r) => r.arrayBuffer());
      preparedVariants[variant.src] = await parseGLBToPrepared(
        buf,
        variant.src
      );
    }

    const meshes = preparedVariants[variant.src];
    if (!meshes || !meshes.length) return null;

    const draws = [];
    let bbMin = [Infinity, Infinity, Infinity];
    let bbMax = [-Infinity, -Infinity, -Infinity];

    meshes.forEach((vm) => {
      const vao = makeVAO(gl2, vm.pos, vm.nor, vm.ind);
      draws.push({
        vao,
        count: vm.count,
        type:
          vm.type === gl.UNSIGNED_INT ? gl2.UNSIGNED_INT : gl2.UNSIGNED_SHORT,
        baseColor: vm.baseColor,
        opacity: vm.opacity,
        isBlend: vm.isBlend,
      });

      const b = computeBounds(vm.pos);
      bbMin = [
        Math.min(bbMin[0], b.min[0]),
        Math.min(bbMin[1], b.min[1]),
        Math.min(bbMin[2], b.min[2]),
      ];
      bbMax = [
        Math.max(bbMax[0], b.max[0]),
        Math.max(bbMax[1], b.max[1]),
        Math.max(bbMax[2], b.max[2]),
      ];
    });

    return { draws, bounds: { min: bbMin, max: bbMax } };
  }

  return null; /* fallback */
}

init().then(async () => {
  await loadDefaultModel(DEFAULT_MODEL);
  renderLoop();
  renderBoatInfo(BOAT_INFO);
  generateAllThumbnails()
    .then(() => {
      refreshThumbnailsInUI();
      hideLoading();
    })
    .catch(() => {
      hideLoading();
    });
  setTimeout(() => {
    preloadAllVariants().then(() => {});
  }, 2000);
});
