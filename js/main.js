import { createShaderProgram } from "./shader.js";
import { initWater, drawWater } from "./water.js";
import { resetBoundTextures } from "./water.js";
import { initCamera } from "./camera.js";
import { initSky, drawSky, bakeSkyToCubemap, bakeIrradianceFromSky } from "./sky.js";
import { DEFAULT_SKY } from "./sky.js";
import {DEFAULT_MODEL,BASE_PRICE,VARIANT_GROUPS,BOAT_INFO,SIDEBAR_INFO } from "./config.js";
import {
  mat4mul,
  persp,
  ortho,
  look,
  composeTRS,
  computeBounds,
  mulMat4Vec4,
  mat4Invert,
  v3,
} from "./math.js";
import { initUI, renderBoatInfo, showPartInfo, showLoading, hideLoading } from "./ui.js";
import { TEXTURE_SLOTS, bindTextureToSlot } from "./texture-slots.js";

let sceneChanged = true;
let pbrUniforms = {};
let reflectionUniforms = {};
let acesProgram = null;
let finalFBO = null;
let finalColorTex = null;
let ssaoUniforms = {};
let lastView = new Float32Array(16);
let lastProj = new Float32Array(16);
let shadowDirty = true;
let ssaoDirty = true;
let lastViewMatrix = new Float32Array(16);
let lastSunDir = [0, 0, 0];
const textureCache = {}; // key = url, value = WebGLTexture
const textureCachePromises = new Map();
window.textureCache = textureCache;

let shadowFBO, shadowDepthTex;
const SHADOW_RES = 2048;

async function preloadAllConfigTextures() {
  const allPaths = [];
  for (const group of Object.values(VARIANT_GROUPS)) {
    for (const part of Object.values(group)) {
      for (const model of part.models) {
        if (model.colors) {
          for (const c of model.colors) {
            if (c.type === "texture") {
              allPaths.push(c.texture, c.normal, c.rough);
            }
          }
        }
      }
    }
  }

  const uniquePaths = [...new Set(allPaths.filter(Boolean))];
  await Promise.all(uniquePaths.map((src) => loadTextureWithCache(src)));
}

async function loadTextureWithCache(
  src,
  {
    placeholderColor = [180, 180, 180, 255],
    wrapMode = "repeat",
  } = {}
) {
  if (!src) return null;
  if (textureCache[src]) return textureCache[src];
  if (textureCachePromises.has(src)) {
    return textureCachePromises.get(src);
  }
  if (!gl) return null;

  window.pendingTextures = (window.pendingTextures || 0) + 1;

  const loadPromise = (async () => {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    const placeholder = new Uint8Array(placeholderColor);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      1,
      1,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      placeholder
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    textureCache[src] = tex;

    try {
      const res = await fetch(src);
      const blob = await res.blob();
      const bmp = await createImageBitmap(blob);

      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bmp);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      const wrap = wrapMode === "clamp" ? gl.CLAMP_TO_EDGE : gl.REPEAT;
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
    } catch (err) {
      console.warn("[textures] Failed to load:", src, err);
    } finally {
      decrementPendingTextures();
      textureCachePromises.delete(src);
    }

    return tex;
  })();

  textureCachePromises.set(src, loadPromise);
  return loadPromise;
}
window.loadTextureWithCache = loadTextureWithCache;




// CENTRALNO SUNCE
const SUN = {dir: v3.norm([-0.9,1.0, 0.3]), color: [1.0, 0.92, 0.76], intensity: 0.0, 
};
window.SUN = SUN;
updateSun();
function updateSun() {
  const alt = Math.max(-1.0, Math.min(1.0, SUN.dir[1]));
  const dayColor = [1.0, 0.97, 0.94];
  const sunsetColor = [1.0, 0.35, 0.1];
  const tColor = smoothstep(0.0, 0.6, alt);
  SUN.color = [
    sunsetColor[0] + (dayColor[0] - sunsetColor[0]) * tColor,
    sunsetColor[1] + (dayColor[1] - sunsetColor[1]) * tColor,
    sunsetColor[2] + (dayColor[2] - sunsetColor[2]) * tColor,
  ];

  const fade = Math.pow(Math.max(alt, 0.0), 0.4);
  SUN.intensity = 1.0 * fade; 

  if (alt < 0.0) {
    const glow = smoothstep(-0.3, 0.0, alt);
    SUN.color = [ SUN.color[0] * (0.4 + 0.6 * glow), SUN.color[1] * (0.4 + 0.6 * glow), SUN.color[2] * (0.6 + 0.4 * glow),];
    SUN.intensity *= 0.3 * glow;
  }
  
}

function setWeather(presetName) {
  const presets = { day:{y:1.0}, sunset:{y:0.12} };
  const preset = presets[presetName];
  if (!preset) return;

  SUN.dir = v3.norm([-0.90, preset.y, 0.3]);
  shadowDirty = true;
  updateSun();

  rebuildEnvironmentTextures();
  sceneChanged = true;
  render();
}



function refreshLighting() {
  updateSun();
  shadowDirty = true;
  rebuildEnvironmentTextures();
}

function rebuildEnvironmentTextures() {
  const previousEnvTex = envTex;
  const previousEnvDiffuse = window.envDiffuse;

  envTex = bakeSkyToCubemap(gl, envSize, SUN.dir, {
    ...DEFAULT_SKY,
    sunColor: SUN.color,
    sunIntensity: SUN.intensity,
    useTonemap: false,
    hideSun: true,
  });

  gl.bindTexture(gl.TEXTURE_CUBE_MAP, envTex);
  gl.generateMipmap(gl.TEXTURE_CUBE_MAP);
  gl.bindTexture(gl.TEXTURE_CUBE_MAP, null);

  window.envDiffuse = bakeIrradianceFromSky(gl, envTex, 32);
  cubeMaxMip = Math.floor(Math.log2(envSize));

  if (previousEnvTex && previousEnvTex !== envTex) {
    gl.deleteTexture(previousEnvTex);
  }
  if (previousEnvDiffuse && previousEnvDiffuse !== window.envDiffuse) {
    gl.deleteTexture(previousEnvDiffuse);
  }
}

function smoothstep(edge0, edge1, x) {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

let fxaaProgram = null;
let toneMapTex = null;
let toneMapFBO = null;

let taaProgram = null;
let taaUniforms = {};
let taaHistoryTextures = [];
let taaHistoryFBOs = [];
let taaHistoryIndex = 0;
let prevViewProj = new Float32Array(16);
let prevViewProjValid = false;
let invCurrViewProj = new Float32Array(16);
let currViewProjMatrix = new Float32Array(16);
let stableViewProjMatrix = new Float32Array(16);
let taaHaltonIndex = 0;
const TAA_SEQUENCE_LENGTH = 8;
const taaJitter = [0, 0];

function halton(index, base) {
  let f = 1;
  let result = 0;
  let i = index;
  while (i > 0) {
    f /= base;
    result += f * (i % base);
    i = Math.floor(i / base);
  }
  return result;
}

function nextTAAJitter(width, height) {
  const sequenceIndex = (taaHaltonIndex % TAA_SEQUENCE_LENGTH) + 1;
  const jitterX = halton(sequenceIndex, 2) - 0.5;
  const jitterY = halton(sequenceIndex, 3) - 0.5;
  taaJitter[0] = (jitterX * 2) / width;
  taaJitter[1] = (jitterY * 2) / height;
  taaHaltonIndex = (taaHaltonIndex + 1) % TAA_SEQUENCE_LENGTH;
  return taaJitter;
}

function applyJitterToProjection(projection, width, height) {
  const jitter = nextTAAJitter(width, height);
  projection[8] += jitter[0];
  projection[9] += jitter[1];
}

function disposeTAABuffers() {
  for (const tex of taaHistoryTextures) {
    if (tex) gl.deleteTexture(tex);
  }
  for (const fbo of taaHistoryFBOs) {
    if (fbo) gl.deleteFramebuffer(fbo);
  }
  taaHistoryTextures = [];
  taaHistoryFBOs = [];
  taaHistoryIndex = 0;
}

function createTAABuffers(w, h) {
  disposeTAABuffers();
  for (let i = 0; i < 2; ++i) {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);

    taaHistoryTextures.push(tex);
    taaHistoryFBOs.push(fbo);
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.bindTexture(gl.TEXTURE_2D, null);
  prevViewProjValid = false;
  taaHaltonIndex = 0;
  taaHistoryIndex = 0;
}

function invalidateTAAHistory() {
  prevViewProjValid = false;
  taaHaltonIndex = 0;
}

function createToneMapTarget(w, h) {
  if (toneMapTex) gl.deleteTexture(toneMapTex);
  if (toneMapFBO) gl.deleteFramebuffer(toneMapFBO);
  toneMapTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, toneMapTex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  toneMapFBO = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, toneMapFBO);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, toneMapTex, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}
let ssrOutputFBO = null;
let ssrOutputTex = null;

function disposeSSROutputTarget() {
  if (ssrOutputTex) {
    gl.deleteTexture(ssrOutputTex);
    ssrOutputTex = null;
  }
  if (ssrOutputFBO) {
    gl.deleteFramebuffer(ssrOutputFBO);
    ssrOutputFBO = null;
  }
}

function createSSROutputTarget(w, h) {
  disposeSSROutputTarget();

  ssrOutputTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, ssrOutputTex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

  ssrOutputFBO = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, ssrOutputFBO);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, ssrOutputTex, 0);

  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}
window.pendingTextures = 0;
function decrementPendingTextures() {
  window.pendingTextures = Math.max(0, window.pendingTextures - 1);
}
let savedColorsByPart = {};
let reflectionFBO = null;
let reflectionTex = null;
let reflectionColorProgram = null;
let envSize = 512; // kontrola kvaliteta/performansi
let cubeMaxMip = Math.floor(Math.log2(envSize));
window.showWater = true;
window.showDimensions = false;
let originalGlassByPart = {};
let transparentMeshes = [];
let envTex = null;
let brdfTex = null;
let realOriginalParts = {}; // permanentno čuvamo početni model (A)
let previewGL = null;
let boatMin = null;
let boatMax = null;
let program;
let shadowProgram;
let programGlass;
let modelVAOs = [];
let idxCounts = [];
let idxTypes = [];
let gBuffer, gPosition, gNormal, gAlbedo, gMaterial;
let ssaoFBO, ssaoColorBuffer;
let ssaoKernel = [];
let ssaoNoiseTexture;
let lineProgram; // globalna promenljiva
let boatLengthLine = null;
let gBufferProgram, ssaoProgram; // Za nove šejder programe
let quadVAO = null; // Za iscrtavanje preko celog ekrana
let modelMatrices = [];
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

const KERNEL_SIZE = 64;
const SSAO_NOISE_SIZE = 3;
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

function disposeReflectionTarget() {
  if (reflectionTex) {
    gl.deleteTexture(reflectionTex);
    reflectionTex = null;
  }
  if (window.reflectionDepthTex) {
    gl.deleteTexture(window.reflectionDepthTex);
    window.reflectionDepthTex = null;
  }
  if (reflectionFBO) {
    gl.deleteFramebuffer(reflectionFBO);
    reflectionFBO = null;
  }
}

function createReflectionTarget(gl, width, height) {
  disposeReflectionTarget();

  reflectionTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, reflectionTex);
  gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA16F,width,height,0,gl.RGBA, gl.HALF_FLOAT,null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

  window.reflectionDepthTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, window.reflectionDepthTex);
  gl.texImage2D(
  gl.TEXTURE_2D, 0,gl.DEPTH_COMPONENT24,  width,height,0, gl.DEPTH_COMPONENT,gl.UNSIGNED_INT,null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  reflectionFBO = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, reflectionFBO);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,reflectionTex,0);
  gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.DEPTH_ATTACHMENT,gl.TEXTURE_2D,window.reflectionDepthTex,0 );
  gl.bindTexture(gl.TEXTURE_2D, null);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
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
  gl.texImage2D(gl.TEXTURE_2D,0, gl.RGBA16F, w,h,0,gl.RGBA, gl.HALF_FLOAT,null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

  // Depth
  window.finalDepthTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, window.finalDepthTex);
  gl.texImage2D(gl.TEXTURE_2D,0,gl.DEPTH_COMPONENT24,w,h,0,gl.DEPTH_COMPONENT,gl.UNSIGNED_INT,null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  // FBO
  finalFBO = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, finalFBO);
  gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,finalColorTex,0);
  gl.framebufferTexture2D( gl.FRAMEBUFFER,gl.DEPTH_ATTACHMENT,gl.TEXTURE_2D,window.finalDepthTex,0);
  gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.bindTexture(gl.TEXTURE_2D, null);
}

function focusCameraOnNode(node) {
  if (!node) return;
  camera.useOrtho = false; // 🔥 prebaci nazad u perspektivu
  
  if (node.cachedBounds) {
    camera.pan = node.cachedBounds.center;
    camera.distTarget = node.cachedBounds.dist;  
    return;
  }

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
  camera.pan = center;
  camera.distTarget = newDist * 0.7;   // 🔹 koristi target, ne direktno
  camera.rxTarget = Math.PI / 6;       // 🔹 koristi target
  camera.ryTarget = 0;
  const minDist = newDist * 0.2;
  const maxDist = newDist * 3.0;
  camera.distTarget = Math.min(Math.max(camera.distTarget, minDist), maxDist);
  node.cachedBounds = { center, dist: camera.distTarget };
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

async function loadDefaultModel(url) {
  showLoading();
  const res = await fetch(url);
  const buf = await res.arrayBuffer();
  await loadGLB(buf);  
  hideLoading();     
  render();       
}
function arraysEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (Math.abs(a[i] - b[i]) > 1e-5) return false;
  }
  return true;
}


const canvas = document.getElementById("glCanvas");
const camera = initCamera(canvas);
if (canvas.__glContext) {
  const loseExt = canvas.__glContext.getExtension("WEBGL_lose_context");
  if (loseExt) loseExt.loseContext();
}
const gl = canvas.getContext("webgl2", { alpha: true, antialias: true });

canvas.__glContext = gl;
if (!gl) alert("WebGL2 nije podržan u ovom pregledaču.");
if (!gl.getExtension("EXT_color_buffer_float")) {
  alert(
    "Ovaj browser ne podržava EXT_color_buffer_float.\nGI efekti neće raditi."
  );
}
gl.getExtension("OES_texture_float_linear");

let sceneDepthTex = null; //  ←  NOVA globalna promenljiva

function createDepthTexture(w, h) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D,0,gl.DEPTH_COMPONENT24,  w,h,0,gl.DEPTH_COMPONENT,gl.UNSIGNED_INT,null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return tex;
}
  let ssaa = 1.3;

function resizeCanvas() {

  const sidebarEl = document.getElementById("sidebar");
  const sidebarW = sidebarEl ? sidebarEl.offsetWidth : 0;
  const headerEl = document.querySelector(".global-header");
  const headerH = headerEl ? headerEl.offsetHeight : 0;

  const cssW = window.innerWidth - sidebarW;
  const footerH = 77;
  const cssH = window.innerHeight - headerH - footerH;
  const aspect = cssW / cssH;
  let maxRenderW;
  const isMobile = /Mobi|Android|iPhone|iPad|Tablet/i.test(navigator.userAgent);
  if (isMobile) {
    maxRenderW = Math.min(cssW * 1.0, 1080);
  } else {
    maxRenderW = cssW;
  }

  let targetW = Math.min(cssW, maxRenderW);
  let targetH = Math.round(targetW / aspect);
  const dpr = 1.0;
  const realW = Math.round(targetW * ssaa * dpr);
  const realH = Math.round(targetH * ssaa * dpr);

  canvas.width = realW;
  canvas.height = realH;
  canvas.style.width = cssW + "px";
  canvas.style.height = cssH + "px";
  canvas.style.left = sidebarW + "px";
  canvas.style.top = headerH + "px"; 

  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.bindTexture(gl.TEXTURE_2D, null);
  gl.bindTexture(gl.TEXTURE_CUBE_MAP, null);
  gl.viewport(0, 0, realW, realH);

  if (sceneDepthTex) gl.deleteTexture(sceneDepthTex);
  sceneDepthTex = createDepthTexture(realW, realH);

  gl.bindFramebuffer(gl.FRAMEBUFFER, null);

  createGBuffer(realW, realH);
  createSSAOBuffers(Math.round(realW * 1.0), Math.round(realH * 1.0));
  createFinalColorTarget(canvas.width, canvas.height);
  createToneMapTarget(canvas.width, canvas.height);
  createReflectionTarget(gl, realW, realH);
  resetBoundTextures();
  createSSRBuffer(canvas.width, canvas.height);
  createSSROutputTarget(canvas.width, canvas.height);
  createTAABuffers(canvas.width, canvas.height);

  const resMeter = document.getElementById("res-meter");
  if (resMeter) {
    resMeter.textContent = `Render: ${targetW}x${targetH} → ${realW}x${realH} (SSAA ${ssaa.toFixed(2)}x)`;
  }

  if (window.sceneColorTex) {
    gl.deleteTexture(window.sceneColorTex);
    window.sceneColorTex = null;
  }
    ssaoDirty = true;
  sceneChanged = true;
   camera.moved = true; 
  cleanupGLGarbage();
  gl.useProgram(program);
gl.uniform1i(pbrUniforms.uShadowMap, 7); // 🔁 rebinding novog shadowDepthTex
  invalidateTAAHistory();
}


export async function exportPDF() {
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF("p", "mm", "a4");
  const margin = 15;
  let y = margin;

  const boatName = BOAT_INFO.Model || "Less Boat";
  const dateStr = new Date().toLocaleDateString("en-GB");

  // === LOGO HEADER ===
  const logoImg = new Image();
  logoImg.src = "assets/Less_logo.png";
  await new Promise((res) => (logoImg.onload = res));

  const logoAspect = logoImg.width / logoImg.height;
  const logoHeight = 10;
  const logoWidth = logoHeight * logoAspect;

  // === HEADER ===
  pdf.setFillColor(10, 20, 30);
  pdf.rect(0, 0, 210, 25, "F");

  // logo levo
  pdf.addImage(logoImg, "PNG", 10, 7, logoWidth, logoHeight);

  // datum desno
  pdf.setTextColor(255);
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(11);
  pdf.text(dateStr, 200, 17, { align: "right" });
  y = 35;
  // === NASLOV ===
  pdf.setTextColor(0);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(22);
  pdf.text(boatName, margin, y);
  y += 10;

  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(12);
  pdf.text("Model specifications and configuration overview", margin, y);
  y += 8;

  pdf.setDrawColor(58, 164, 255);
  pdf.setLineWidth(0.8);
  pdf.line(margin, y, 210 - margin, y);
  y += 10;

  // === PRIVREMENO PREBACI NA FRONT POGLED ZA PDF ===
  const oldView = camera.currentView;
  const oldUseOrtho = camera.useOrtho;


  ({ proj, view, camWorld } = camera.updateView());
  render();

  // === RENDER SCENA (screenshot canvasa) ===
  const canvas = document.querySelector("#glCanvas");
  const gl = canvas.getContext("webgl2", { preserveDrawingBuffer: true });
  render(); // osveži kadar
  const imageData = canvas.toDataURL("image/png");

  const imgAspect = canvas.width / canvas.height;
  const renderWidth = 180;
  const renderHeight = renderWidth / imgAspect;
  pdf.addImage(imageData, "PNG", margin, y, renderWidth, renderHeight);

  y += renderHeight + 10;
  canvas.getContext("webgl2", { preserveDrawingBuffer: false });

  // === VRATI STARU POZICIJU KAMERE POSLE PDF RENDERA ===
  camera.currentView = oldView;
  camera.useOrtho = oldUseOrtho;
  ({ proj, view, camWorld } = camera.updateView());
  render();

  // === SPECIFIKACIJE ===
  pdf.setFontSize(14);
  pdf.setFont("helvetica", "bold");
  pdf.text("TECHNICAL SPECIFICATIONS", margin, y);
  y += 8;

  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(11);
  for (const [key, val] of Object.entries(BOAT_INFO)) {
    pdf.text(`${key}:`, margin, y);
    pdf.text(String(val), margin + 50, y);
    y += 6;
    if (y > 260) {
      pdf.addPage();
      y = margin;
    }
  }

  y += 8;

  // === TABELA DELA ===
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(14);
  pdf.text("PARTS LIST", margin, y);
  y += 7;

  const rows = document.querySelectorAll("#partsTable tbody tr");
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(10);

  rows.forEach((tr, i) => {
    const cells = tr.querySelectorAll("td");
    if (cells.length < 3) return;

    const part = cells[0].textContent.trim();
    const desc = cells[1].textContent.trim();
    const price = cells[2].textContent.trim();

    // sivi red naizmenično
    if (i % 2 === 0) {
      pdf.setFillColor(245, 248, 255);
      pdf.rect(margin, y - 4.5, 180, 6.5, "F");
    }

    pdf.text(part, margin + 2, y);
    pdf.text(desc, margin + 70, y);
    pdf.text(price, margin + 150, y);
    y += 6;

    if (y > 260) {
      pdf.addPage();
      y = margin;
    }
  });

  y += 10;

  // === TOTAL ===
  const total = document.querySelector(".sidebar-total .price")?.textContent || "";
  pdf.setFont("helvetica", "bold");
  pdf.setTextColor(30, 144, 255);
  pdf.setFontSize(13);
  pdf.text(`TOTAL PRICE: ${total}`, margin, y);

  // === FOOTER ===
  pdf.setFillColor(10, 20, 30);
  pdf.rect(0, 285, 210, 12, "F");
  pdf.setTextColor(255);
  pdf.setFontSize(9);
  pdf.text("Generated by Less Engine © 2025", 105, 292, { align: "center" });

  pdf.save(`${boatName.replace(/\s+/g, "_")}_Report.pdf`);
}
window.exportPDF = exportPDF;

function disposeGBuffer() {
  if (gPosition) {
    gl.deleteTexture(gPosition);
    gPosition = null;
  }
  if (gNormal) {
    gl.deleteTexture(gNormal);
    gNormal = null;
  }
  if (gAlbedo) {
    gl.deleteTexture(gAlbedo);
    gAlbedo = null;
  }
  if (gMaterial) {
    gl.deleteTexture(gMaterial);
    gMaterial = null;
  }
  if (gBuffer) {
    gl.deleteFramebuffer(gBuffer);
    gBuffer = null;
  }
}

function createGBuffer() {
  disposeGBuffer();

  gBuffer = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, gBuffer);

  // Tekstura za pozicije (u View-space, potrebna za SSAO)
  gPosition = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, gPosition);
  gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA16F,canvas.width,canvas.height,0,gl.RGBA, gl.FLOAT,null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,gPosition,0 );

  // Tekstura za normale (u View-space)
  gNormal = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, gNormal);
  gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA16F,canvas.width,canvas.height,0,gl.RGBA,gl.FLOAT,null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.framebufferTexture2D( gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D,gNormal, 0);

  // Tekstura za boju (Albedo)
  gAlbedo = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, gAlbedo);
  gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,canvas.width,canvas.height,0,gl.RGBA, gl.UNSIGNED_BYTE,null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.framebufferTexture2D( gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT2,gl.TEXTURE_2D,gAlbedo,0);
  // NOVO: 4. Tekstura za materijal (Roughness, Metallic)
  gMaterial = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, gMaterial);
  gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA8,canvas.width,canvas.height,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT3,gl.TEXTURE_2D, gMaterial,0);

  // Kažemo WebGL-u da piše u SVA 4 attachment-a
  gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1,gl.COLOR_ATTACHMENT2,gl.COLOR_ATTACHMENT3,]);

  // Poveži postojeći depth texture
  gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.DEPTH_ATTACHMENT,gl.TEXTURE_2D,sceneDepthTex,0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}

function disposeSSAOBuffers() {
  if (ssaoFBO) {
    gl.deleteFramebuffer(ssaoFBO);
    ssaoFBO = null;
  }
  if (ssaoColorBuffer) {
    gl.deleteTexture(ssaoColorBuffer);
    ssaoColorBuffer = null;
  }
  if (window.ssaoBlurFBO) {
    gl.deleteFramebuffer(window.ssaoBlurFBO);
    window.ssaoBlurFBO = null;
  }
  if (window.ssaoBlurColor) {
    gl.deleteTexture(window.ssaoBlurColor);
    window.ssaoBlurColor = null;
  }
}

function createSSAOBuffers(w, h) {
  disposeSSAOBuffers();

  const width = w || canvas.width;
  const height = h || canvas.height;

  // === FBO za SSAO ===
  ssaoFBO = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, ssaoFBO);

  ssaoColorBuffer = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, ssaoColorBuffer);
 gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
 gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, ssaoColorBuffer, 0);

window.ssaoBlurFBO = gl.createFramebuffer();
gl.bindFramebuffer(gl.FRAMEBUFFER, window.ssaoBlurFBO);

window.ssaoBlurColor = gl.createTexture();
gl.bindTexture(gl.TEXTURE_2D, window.ssaoBlurColor);
gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, window.ssaoBlurColor, 0);
gl.bindFramebuffer(gl.FRAMEBUFFER, null);

}

let ssrFBO = null;
let ssrTex = null;

function disposeSSRBuffer() {
  if (ssrFBO) {
    gl.deleteFramebuffer(ssrFBO);
    ssrFBO = null;
  }
  if (ssrTex) {
    gl.deleteTexture(ssrTex);
    ssrTex = null;
  }
}

function createSSRBuffer(w, h) {
  disposeSSRBuffer();

  ssrFBO = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, ssrFBO);

  ssrTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, ssrTex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, ssrTex, 0);

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
  gl.texImage2D(gl.TEXTURE_2D,0,gl.RGB16F,SSAO_NOISE_SIZE,SSAO_NOISE_SIZE,0,gl.RGB,gl.FLOAT,new Float32Array(noise));
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
  }, 400);
});

resizeCanvas();

function initShadowMap() {
  shadowFBO = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, shadowFBO);

  shadowDepthTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, shadowDepthTex);

  // alociramo depth teksturu
  gl.texImage2D(gl.TEXTURE_2D,0,gl.DEPTH_COMPONENT24, SHADOW_RES,SHADOW_RES,0,gl.DEPTH_COMPONENT, gl.UNSIGNED_INT,null);
  // NEAREST je sigurniji za depth mapu
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  // zakači depth teksturu na FBO
  gl.framebufferTexture2D( gl.FRAMEBUFFER,gl.DEPTH_ATTACHMENT,gl.TEXTURE_2D,shadowDepthTex,0);

  // pošto nemamo color attachment → mora ovako
  gl.drawBuffers([gl.NONE]);
  gl.readBuffer(gl.NONE);
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
let lightVP = new Float32Array(16);
let camWorld = [0, 0, 0];
const model = new Float32Array([
  1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1,
]);

function setMatrices(p) {
  gl.uniformMatrix4fv(gl.getUniformLocation(p, "uProjection"), false, proj);
  gl.uniformMatrix4fv(gl.getUniformLocation(p, "uView"), false, view);
  gl.uniformMatrix4fv(gl.getUniformLocation(p, "uModel"), false, model);
}

function makeLengthLine(min, max) {
  const y = 0.5; // umesto min[1]
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


// ✅ Faza 1 — osnovni GL setup
async function initGL() {
  try {
    initShadowMap();
    createGBuffer();
    createSSAOBuffers();
    return true;
  } catch (err) {
    console.error("[initGL] Failed:", err);
    alert("GL initialization failed — see console for details.");
    return false;
  }
}

// ✅ Faza 2 — učitavanje i kompajliranje šejdera
async function initShaders() {
  try {
    const loadShader = async (path) => (await fetch(path)).text();
    const quadVertSrc = await loadShader("../shaders/quad.vert");

    // === 1. Klasični programi ===
    const shadowVertSrc = await loadShader("../shaders/shadow.vert");
    const shadowFragSrc = await loadShader("../shaders/shadow.frag");
    shadowProgram = createShaderProgram(gl, shadowVertSrc, shadowFragSrc);

    const gBufferVertSrc = await loadShader("../shaders/g_buffer.vert");
    const gBufferFragSrc = await loadShader("../shaders/g_buffer.frag");
    gBufferProgram = createShaderProgram(gl, gBufferVertSrc, gBufferFragSrc);

    const ssaoFragSrc = await loadShader("../shaders/ssao.frag");
    ssaoProgram = createShaderProgram(gl, quadVertSrc, ssaoFragSrc);

    const ssaoBlurFragSrc = await loadShader("../shaders/ssao_blur.frag");
    const ssaoBlurProgram = createShaderProgram(gl, quadVertSrc, ssaoBlurFragSrc);
    window.ssaoBlurProgram = ssaoBlurProgram;
    window.ssaoBlurUniforms = {
      tSSAO: gl.getUniformLocation(ssaoBlurProgram, "tSSAO"),
      uTexelSize: gl.getUniformLocation(ssaoBlurProgram, "uTexelSize"),
    };

    const ssrFragSrc = await loadShader("../shaders/ssr_viewspace.frag");
    const ssrProgram = createShaderProgram(gl, quadVertSrc, ssrFragSrc);

      window.ssrProgram = ssrProgram;
      window.ssrUniforms = {
      gPosition: gl.getUniformLocation(ssrProgram, "gPosition"),
      gNormal: gl.getUniformLocation(ssrProgram, "gNormal"),
      gMaterial: gl.getUniformLocation(ssrProgram, "gMaterial"),
      uSceneColor: gl.getUniformLocation(ssrProgram, "uSceneColor"),
      uView: gl.getUniformLocation(ssrProgram, "uView"),
      uProjection: gl.getUniformLocation(ssrProgram, "uProjection"),
      uResolution: gl.getUniformLocation(ssrProgram, "uResolution"),
      uEnvMap: gl.getUniformLocation(ssrProgram, "uEnvMap"),           // 👈 DODAJ
      uCubeMaxMip: gl.getUniformLocation(ssrProgram, "uCubeMaxMip"),   // 👈 DODAJ
      uGlobalExposure: gl.getUniformLocation(ssrProgram, "uGlobalExposure"), 
    };
        
        // ✅ DODAJ OVO (setup texture slotova za SSR):
    gl.useProgram(ssrProgram);
    gl.uniform1i(window.ssrUniforms.gPosition, TEXTURE_SLOTS.SSR_POSITION);
    gl.uniform1i(window.ssrUniforms.gNormal, TEXTURE_SLOTS.SSR_NORMAL);
    gl.uniform1i(window.ssrUniforms.uSceneColor, TEXTURE_SLOTS.SSR_SCENE_COLOR);
    gl.uniform1i(window.ssrUniforms.gMaterial, TEXTURE_SLOTS.SSR_MATERIAL);
    gl.uniform1i(window.ssrUniforms.uEnvMap, TEXTURE_SLOTS.SSR_ENV_MAP);

    const glassVS = await loadShader("shaders/glass.vert");
    const glassFS = await loadShader("shaders/glass.frag");
    programGlass = createShaderProgram(gl, glassVS, glassFS);

    const reflectionVS = await loadShader("shaders/reflection.vert");
    const reflectionFS = await loadShader("shaders/reflection.frag");
    reflectionColorProgram = createShaderProgram(gl, reflectionVS, reflectionFS);

    const acesFragSrc = await loadShader("shaders/aces.frag");
    acesProgram = createShaderProgram(gl, quadVertSrc, acesFragSrc);

    const fxaaVS = await loadShader("shaders/fxaa.vert");
    const fxaaFS = await loadShader("shaders/fxaa.frag");
    fxaaProgram = createShaderProgram(gl, fxaaVS, fxaaFS);

    const taaFS = await loadShader("shaders/taa.frag");
    taaProgram = createShaderProgram(gl, quadVertSrc, taaFS);
    if (taaProgram) {
      taaUniforms = {
        uCurrent: gl.getUniformLocation(taaProgram, "uCurrent"),
        uHistory: gl.getUniformLocation(taaProgram, "uHistory"),
        uDepth: gl.getUniformLocation(taaProgram, "uDepth"),
        uCurrViewProj: gl.getUniformLocation(taaProgram, "uCurrViewProj"),
        uPrevViewProj: gl.getUniformLocation(taaProgram, "uPrevViewProj"),
        uInvCurrViewProj: gl.getUniformLocation(taaProgram, "uInvCurrViewProj"),
        uBlendFactor: gl.getUniformLocation(taaProgram, "uBlendFactor"),
      };
      gl.useProgram(taaProgram);
      gl.uniform1i(taaUniforms.uCurrent, 0);
      gl.uniform1i(taaUniforms.uHistory, 1);
      gl.uniform1i(taaUniforms.uDepth, 2);
    }

    const pbrFragSrc = await loadShader("../shaders/pbr.frag");
    program = createShaderProgram(gl, quadVertSrc, pbrFragSrc);

    // === 2. Keš uniform lokacija ===
  const uniformNamesPBR = [
    "uView","uProjection","uLightVP","uCameraPos",
    "uSunDir","uSunColor","uSunIntensity",
    "uCubeMaxMip","uEnvMap","uEnvDiffuse","uBRDFLUT","uShadowMap",
    "uResolution","gPosition","gNormal","gAlbedo",
    "gMaterial","ssao","tBentNormalAO","uSceneColor",
    "uLightSize","uShadowMapSize","uNormalBias",
    "uBiasBase","uBiasSlope",
    "uGlobalExposure", "uTexelSize" // 👈 dodaj ovo
  ];
    const getLocs = (prog, names) => {
      const out = {};
      for (const n of names) out[n] = gl.getUniformLocation(prog, n);
      return out;
    };
    pbrUniforms = getLocs(program, uniformNamesPBR);

    const ssaoNames = ["gPosition","gNormal","tNoise","gAlbedo","samples","uProjection","uNoiseScale","uFrame"];
    for (const n of ssaoNames)
      ssaoUniforms[n] = gl.getUniformLocation(ssaoProgram, n);


    const reflectionNames = [
      "uProjection", "uView", "uModel", "uSunDir", "uSunColor",
      "uSunIntensity", "uCameraPos", "uRoughness", "uSpecularStrength",
      "uEnvMap", "uBaseColor", "uBaseColorTex", "uUseBaseColorTex"
    ];
    for (const n of reflectionNames)
      reflectionUniforms[n] = gl.getUniformLocation(reflectionColorProgram, n);

    lineProgram = createShaderProgram(gl, lineVertSrc, lineFragSrc);
    // === 4. Keš uniform lokacija za ostale programe ===
    window.gBufferUniforms = {
      uProjection: gl.getUniformLocation(gBufferProgram, "uProjection"),
      uView: gl.getUniformLocation(gBufferProgram, "uView"),
      uModel: gl.getUniformLocation(gBufferProgram, "uModel"),
      uBaseColor: gl.getUniformLocation(gBufferProgram, "uBaseColor"),
      uMetallic: gl.getUniformLocation(gBufferProgram, "uMetallic"),
      uRoughness: gl.getUniformLocation(gBufferProgram, "uRoughness"),
      uBaseColorTex: gl.getUniformLocation(gBufferProgram, "uBaseColorTex"),
      uUseBaseColorTex: gl.getUniformLocation(gBufferProgram, "uUseBaseColorTex"),
    };

      window.gBufferUniforms.uNormalTex = gl.getUniformLocation(gBufferProgram, "uNormalTex");
      window.gBufferUniforms.uUseNormalTex = gl.getUniformLocation(gBufferProgram, "uUseNormalTex");
      window.gBufferUniforms.uRoughnessTex = gl.getUniformLocation(gBufferProgram, "uRoughnessTex");
      window.gBufferUniforms.uUseRoughnessTex = gl.getUniformLocation(gBufferProgram, "uUseRoughnessTex");


    window.glassUniforms = {
      uView: gl.getUniformLocation(programGlass, "uView"),
      uProjection: gl.getUniformLocation(programGlass, "uProjection"),
      uModel: gl.getUniformLocation(programGlass, "uModel"),
      uBaseColor: gl.getUniformLocation(programGlass, "uBaseColor"),
      uRoughness: gl.getUniformLocation(programGlass, "uRoughness"),
      uMetallic: gl.getUniformLocation(programGlass, "uMetallic"),
      uOpacity: gl.getUniformLocation(programGlass, "uOpacity"),
      uCameraPos: gl.getUniformLocation(programGlass, "uCameraPos"),
      uEnvMap: gl.getUniformLocation(programGlass, "uEnvMap"),
    };

    window.shadowUniforms = {
      uLightVP: gl.getUniformLocation(shadowProgram, "uLightVP"),
      uModel: gl.getUniformLocation(shadowProgram, "uModel"),
    };

    window.lineUniforms = {
      uProjection: gl.getUniformLocation(lineProgram, "uProjection"),
      uView: gl.getUniformLocation(lineProgram, "uView"),
      uModel: gl.getUniformLocation(lineProgram, "uModel"),
      uColor: gl.getUniformLocation(lineProgram, "uColor"),
    };

    // === 3. Init PBR konstantnih uniforma ===
    gl.useProgram(program);
    gl.uniform1f(pbrUniforms.uLightSize, 0.00025);
    window.globalExposure = 1.6; // globalni exposure za sve svetlo
    gl.uniform1f(pbrUniforms.uGlobalExposure, window.globalExposure);
    gl.uniform2f(pbrUniforms.uShadowMapSize, SHADOW_RES, SHADOW_RES);
    gl.uniform1f(pbrUniforms.uNormalBias, 0.005);
    gl.uniform1f(pbrUniforms.uBiasBase, 0.0005);
    gl.uniform1f(pbrUniforms.uBiasSlope, 0.0015);
    gl.uniform2f(pbrUniforms.uTexelSize, 1.0 / canvas.width, 1.0 / canvas.height);
    gl.uniform1i(pbrUniforms.gPosition, TEXTURE_SLOTS.PBR_POSITION);
    gl.uniform1i(pbrUniforms.gNormal, TEXTURE_SLOTS.PBR_NORMAL);
    gl.uniform1i(pbrUniforms.gAlbedo, TEXTURE_SLOTS.PBR_ALBEDO);
    gl.uniform1i(pbrUniforms.gMaterial, TEXTURE_SLOTS.PBR_MATERIAL);
    gl.uniform1i(pbrUniforms.ssao, TEXTURE_SLOTS.PBR_SSAO);
    gl.uniform1i(pbrUniforms.uEnvMap, TEXTURE_SLOTS.PBR_ENV_MAP);
    gl.uniform1i(pbrUniforms.uBRDFLUT, TEXTURE_SLOTS.PBR_BRDF_LUT);
    gl.uniform1i(pbrUniforms.uShadowMap, TEXTURE_SLOTS.PBR_SHADOW_MAP);
    gl.uniform1i(pbrUniforms.tBentNormalAO, TEXTURE_SLOTS.PBR_BENT_NORMAL_AO);
    gl.uniform1i(pbrUniforms.uSceneColor, TEXTURE_SLOTS.PBR_SCENE_COLOR);
    gl.uniform1i(pbrUniforms.uEnvDiffuse, TEXTURE_SLOTS.PBR_ENV_DIFFUSE);

    return true;
  } catch (err) {
    console.error("[initShaders] Failed:", err);
    alert("Shader initialization failed — check console logs.");
    return false;
  }
}

// ✅ Faza 3 — resursi i scena (voda, nebo, BRDF LUT, env map)
async function initScene() {
  const whitePixel = new Uint8Array([255, 255, 255, 255]);
  window.whiteTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, window.whiteTex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, whitePixel);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);

// ✅ default normal mapa (neutralna)
const defaultNormalPixel = new Uint8Array([128, 128, 255, 255]);
window.defaultNormalTex = gl.createTexture();
gl.bindTexture(gl.TEXTURE_2D, window.defaultNormalTex);
gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, defaultNormalPixel);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);

  try {
    await initWater(gl);
    await initSky(gl);

    envTex = bakeSkyToCubemap(gl, envSize, SUN.dir, {
      ...DEFAULT_SKY,
      sunColor: SUN.color,
      sunIntensity: SUN.intensity,
      useTonemap: false,
      hideSun: true,
    });
    // 🟢 OBAVEZNO dodaj:
    gl.bindTexture(gl.TEXTURE_CUBE_MAP, envTex);
    gl.generateMipmap(gl.TEXTURE_CUBE_MAP);
    gl.bindTexture(gl.TEXTURE_CUBE_MAP, null);
    cubeMaxMip = Math.floor(Math.log2(envSize));
    
    window.envDiffuse = bakeIrradianceFromSky(gl, envTex, 32);

    generateSSAOKernel();
    generateNoiseTexture();
    createSSAOBuffers(canvas.width, canvas.height);

    // === BRDF LUT precompute ===
// === BRDF LUT precompute ===
const LUT_SIZE = 256;
const brdfFBO = gl.createFramebuffer();
gl.bindFramebuffer(gl.FRAMEBUFFER, brdfFBO);
brdfTex = gl.createTexture();
gl.bindTexture(gl.TEXTURE_2D, brdfTex);
gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG16F, LUT_SIZE, LUT_SIZE, 0, gl.RG, gl.HALF_FLOAT, null);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); // 👈 PROMENI U LINEAR
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR); // 👈 PROMENI U LINEAR
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); // 👈 DODAJ
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE); // 👈 DODAJ
gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, brdfTex, 0);

const vsSrc = `#version 300 es
layout(location=0) in vec2 aPos;
out vec2 vUV;
void main(){
  vUV = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const fsSrc = `#version 300 es
precision highp float;
in vec2 vUV;
out vec2 fragColor;

float RadicalInverse_VdC(uint bits) {
  bits = (bits << 16u) | (bits >> 16u);
  bits = ((bits & 0x55555555u) << 1u) | ((bits & 0xAAAAAAAAu) >> 1u);
  bits = ((bits & 0x33333333u) << 2u) | ((bits & 0xCCCCCCCCu) >> 2u);
  bits = ((bits & 0x0F0F0F0Fu) << 4u) | ((bits & 0xF0F0F0F0u) >> 4u);
  bits = ((bits & 0x00FF00FFu) << 8u) | ((bits & 0xFF00FF00u) >> 8u);
  return float(bits) * 2.3283064365386963e-10;
}

vec2 Hammersley(uint i, uint N) {
  return vec2(float(i)/float(N), RadicalInverse_VdC(i));
}

vec3 ImportanceSampleGGX(vec2 Xi, vec3 N, float roughness) {
  float a = roughness*roughness;
  float phi = 6.2831853 * Xi.x;
  float cosTheta = sqrt((1.0 - Xi.y)/(1.0 + (a*a - 1.0)*Xi.y));
  float sinTheta = sqrt(1.0 - cosTheta*cosTheta);
  vec3 H = vec3(cos(phi)*sinTheta, sin(phi)*sinTheta, cosTheta);
  vec3 up = abs(N.z) < 0.999 ? vec3(0.0,0.0,1.0) : vec3(1.0,0.0,0.0);
  vec3 tangentX = normalize(cross(up, N));
  vec3 tangentY = cross(N, tangentX);
  return normalize(tangentX*H.x + tangentY*H.y + N*H.z);
}

float GeometrySchlickGGX(float NdotV, float roughness) {
  float a = roughness;
  float k = (a*a)/2.0; // 👈 IBL verzija, ne direktno svetlo
  return NdotV / (NdotV*(1.0 - k) + k);
}

float GeometrySmith(float NdotV, float NdotL, float roughness) {
  return GeometrySchlickGGX(NdotV, roughness) * GeometrySchlickGGX(NdotL, roughness);
}

vec2 IntegrateBRDF(float NdotV, float roughness) {
  // 👇 ZAŠTITA OD GRANIČNIH SLUČAJEVA
  NdotV = max(NdotV, 0.001);
  roughness = clamp(roughness, 0.04, 1.0);
  
  vec3 V;
  V.x = sqrt(1.0 - NdotV*NdotV);
  V.y = 0.0;
  V.z = NdotV;

  float A = 0.0;
  float B = 0.0;
  vec3 N = vec3(0.0,0.0,1.0);

  const uint SAMPLE_COUNT = 512u; // 👈 povećaj na 512 za bolji kvalitet
  
  for(uint i = 0u; i < SAMPLE_COUNT; ++i) {
    vec2 Xi = Hammersley(i, SAMPLE_COUNT);
    vec3 H = ImportanceSampleGGX(Xi, N, roughness);
    vec3 L = normalize(2.0 * dot(V,H) * H - V);
    
    float NdotL = max(L.z, 0.0);
    float NdotH = max(H.z, 0.0);
    float VdotH = max(dot(V,H), 0.0);
    
    if(NdotL > 0.0) {
      float G = GeometrySmith(NdotV, NdotL, roughness);
      float G_Vis = (G * VdotH) / max(NdotH * NdotV, 0.001); // 👈 zaštita od deljenja sa 0
      float Fc = pow(1.0 - VdotH, 5.0);
      
      A += (1.0 - Fc) * G_Vis;
      B += Fc * G_Vis;
    }
  }
  
  A /= float(SAMPLE_COUNT);
  B /= float(SAMPLE_COUNT);
  
  // 👇 FINALNA ZAŠTITA - clamp u razumne granice
  return clamp(vec2(A, B), 0.0, 1.0);
}

void main(){
  fragColor = IntegrateBRDF(vUV.x, vUV.y);
}`;

const vs = gl.createShader(gl.VERTEX_SHADER);
gl.shaderSource(vs, vsSrc);
gl.compileShader(vs);
const fs = gl.createShader(gl.FRAGMENT_SHADER);
gl.shaderSource(fs, fsSrc);
gl.compileShader(fs);
const prog = gl.createProgram();
gl.attachShader(prog, vs);
gl.attachShader(prog, fs);
gl.linkProgram(prog);
gl.useProgram(prog);

const quad = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, quad);
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,3,-1,-1,3]), gl.STATIC_DRAW);
gl.enableVertexAttribArray(0);
gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
gl.viewport(0,0,LUT_SIZE,LUT_SIZE);
gl.bindFramebuffer(gl.FRAMEBUFFER, brdfFBO);
gl.drawArrays(gl.TRIANGLES, 0, 3);
gl.bindFramebuffer(gl.FRAMEBUFFER,null);
gl.deleteFramebuffer(brdfFBO);
gl.deleteBuffer(quad);
gl.deleteProgram(prog);


    return true;
  } catch (err) {
    console.error("[initScene] Failed:", err);
    alert("Scene initialization failed — check console.");
    return false;
  }
}

// 🔹 Povremeno očisti GL resurse koji više nisu u upotrebi
function cleanupGLGarbage() {
  // Očisti nepotrebne teksture (sceneColorTex, reflectionDepthTex itd. ako nisu vezane)
  if (window.sceneColorTex && !sceneChanged) {
    gl.deleteTexture(window.sceneColorTex);
    window.sceneColorTex = null;
  }

  // Ako su FBO-ovi resetovani ili izgubljeni
  if (reflectionFBO && !gl.isFramebuffer(reflectionFBO)) {
    gl.deleteFramebuffer(reflectionFBO);
    reflectionFBO = null;
  }
  if (finalFBO && !gl.isFramebuffer(finalFBO)) {
    gl.deleteFramebuffer(finalFBO);
    finalFBO = null;
  }

  // Ako su teksture “zaboravljene” posle reinit-a
  const texList = [
    reflectionTex,
    window.reflectionDepthTex,
    finalColorTex,
    window.finalDepthTex,
    toneMapTex,
    gPosition,
    gNormal,
    gAlbedo,
    gMaterial,
    ssaoColorBuffer,
    ...taaHistoryTextures,
  ];
  for (const tex of texList) {
    if (tex && !gl.isTexture(tex)) {
      gl.deleteTexture(tex);
    }
  }
}
async function waitForPendingTextures(timeoutMs = 8000) {
  const start = performance.now();

  while (window.pendingTextures > 0) {
    await new Promise(r => setTimeout(r, 100));

    // ⏱️ prekid posle timeouta
    if (performance.now() - start > timeoutMs) {
      console.warn("[textures] Texture loading timeout - continuing without pending uploads.");
      window.pendingTextures = 0; // fallback, reset counter
      break;
    }
  }
}
// ✅ Glavna sekvenca
async function initializeApp() {
  showLoading();
  const glOk = await initGL();
  if (!glOk) return;

  const shadersOk = await initShaders();
  if (!shadersOk) return;

  const sceneOk = await initScene(); // ⏳ čeka sky + water
  if (!sceneOk) return;
  await preloadAllConfigTextures();

  try {
    // Sačekaj i model
    await loadDefaultModel(DEFAULT_MODEL);

    // ⚠️ Validacija programa
    if (!program || !(program instanceof WebGLProgram)) {
      console.error("❌ Main PBR program nije ispravno učitan.");
      alert("Shader link error — proveri log u konzoli (verovatno pbr.frag).");
      return;
    }

    // ✅ Tek sada — svi shaderi, voda i nebo spremni
    sceneChanged = true;
    await waitForPendingTextures(8000);

    // Pokreni prvi render
    render();
    renderBoatInfo(BOAT_INFO);

    // Pokreni UI i loop tek sada
    initUI({ render, BOAT_INFO, VARIANT_GROUPS, BASE_PRICE, SIDEBAR_INFO });
    Object.assign(window, {
      gl, camera, nodesMeta, modelBaseColors, modelBaseTextures,
      savedColorsByPart, showDimensions, showWater, SIDEBAR_INFO,
      VARIANT_GROUPS, BASE_PRICE, BOAT_INFO, thumbnails, currentParts,
      render, replaceSelectedWithURL, focusCameraOnNode, setWeather,
      proj, view, camWorld, exportPDF, sceneChanged,
      originalParts   // 👈 dodaj ovu liniju
    });

    // 🔹 start loop tek kad je sve učitano
  renderLoop();

    generateAllThumbnails().then(refreshThumbnailsInUI).catch(console.warn);
    setTimeout(() => preloadAllVariants().catch(console.warn), 2000);
  } catch (err) {
    console.error("[initializeApp] Failed:", err);
    alert("App initialization failed — check console.");
  } finally {
    hideLoading();
  }
}

// 🚀 Pokretanje
initializeApp();

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
  const timeNow = performance.now() * 0.001; // koristi u SSAO i vodi
  let reflView = null;
  let reflProj = proj;
  const sceneChangedThisFrame = sceneChanged;
  const taaActive = !!(taaProgram && taaHistoryTextures.length === 2);

  // === 1. Animacija kamere i matrica pogleda ===
    showWater = window.showWater;
  showDimensions = window.showDimensions;
  camera.animateCamera();
  const camState = camera.updateView();
  proj = camState.proj;
  view = camState.view;
  camWorld = camState.camWorld;

  let projNoJitter = proj;
  const allowJitter = taaActive && prevViewProjValid && !sceneChangedThisFrame;
  if (allowJitter) {
    projNoJitter = new Float32Array(proj);
    applyJitterToProjection(proj, canvas.width, canvas.height);
  } else if (taaActive) {
    taaHaltonIndex = 0;
  }

  currViewProjMatrix = mat4mul(proj, view);
  stableViewProjMatrix = taaActive ? mat4mul(projNoJitter, view) : currViewProjMatrix;
  if (!mat4Invert(invCurrViewProj, currViewProjMatrix)) {
    prevViewProjValid = false;
  }

  if (camera.moved) ssaoDirty = true;

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
// === 3. Shadow map pass (sa cachingom) ===

// 1️⃣ Proveri da li se promenio SUN.dir
if (Math.abs(SUN.dir[0] - lastSunDir[0]) > 0.0001 ||
    Math.abs(SUN.dir[1] - lastSunDir[1]) > 0.0001 ||
    Math.abs(SUN.dir[2] - lastSunDir[2]) > 0.0001) {
  shadowDirty = true;
  lastSunDir = [...SUN.dir];
}

// 2️⃣ Ako treba — izračunaj shadow mapu, inače preskoči
if (shadowDirty) {
  gl.bindFramebuffer(gl.FRAMEBUFFER, shadowFBO);
  gl.viewport(0, 0, SHADOW_RES, SHADOW_RES);
  gl.clear(gl.DEPTH_BUFFER_BIT);

  gl.enable(gl.CULL_FACE);
  gl.cullFace(gl.BACK);
  gl.enable(gl.POLYGON_OFFSET_FILL);
  gl.polygonOffset(6.0, 8.0);

  // Sun light setup
  const lightPos = [
    SUN.dir[0] * 20,
    SUN.dir[1] * 20,
    SUN.dir[2] * 20,
  ];
  const lightView = look(lightPos, [0, 0, 0], [0, 1, 0]);

  const BASE_EXPAND = 0.0;
  const minBB = [
    boatMin[0] - BASE_EXPAND,
    boatMin[1] - BASE_EXPAND,
    boatMin[2] - BASE_EXPAND,
  ];
  const maxBB = [
    boatMax[0] + BASE_EXPAND,
    boatMax[1] + BASE_EXPAND,
    boatMax[2] + BASE_EXPAND,
  ];

  let { lmin, lmax } = computeLightBounds(minBB, maxBB, lightView);
  
  const FRUSTUM_SCALE = 1.0;
  const cx = (lmin[0] + lmax[0]) * 0.5;
  const cy = (lmin[1] + lmax[1]) * 0.5;
  const cz = (lmin[2] + lmax[2]) * 0.5;
  const hx = (lmax[0] - lmin[0]) * 0.5 * FRUSTUM_SCALE;
  const hy = (lmax[1] - lmin[1]) * 0.5 * FRUSTUM_SCALE;
  const hz = (lmax[2] - lmin[2]) * 0.5 * FRUSTUM_SCALE;

  lmin = [cx - hx, cy - hy, cz - hz];
  lmax = [cx + hx, cy + hy, cz + hz];
  const lightProj = ortho(lmin[0], lmax[0], lmin[1], lmax[1], -lmax[2], -lmin[2]);
  lightVP = mat4mul(lightProj, lightView);

  gl.useProgram(shadowProgram);
  gl.uniformMatrix4fv(shadowUniforms.uLightVP, false, lightVP);

  for (let i = 0; i < modelVAOs.length; ++i) {
    if (!idxCounts[i]) continue;
    gl.uniformMatrix4fv(shadowUniforms.uModel, false, modelMatrices[i]);
    gl.bindVertexArray(modelVAOs[i]);
    gl.drawElements(gl.TRIANGLES, idxCounts[i], idxTypes[i], 0);
  }

  gl.disable(gl.POLYGON_OFFSET_FILL);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);

  shadowDirty = false; // ✅ Gotovo — koristi isti depth dok se ne promeni
}

// === 3B. Reflection pass ===
let reflCam = null;

// ✅ UVEK izračunaj reflView
if (showWater) {
  reflCam = getReflectedCamera(camWorld, camera.pan, [0, 1, 0]);
  reflView = reflCam.view;
  reflProj = proj;

  // ✅ I nacrtaj reflection pass UVEK (čak i u top view-u)
  gl.bindFramebuffer(gl.FRAMEBUFFER, reflectionFBO);
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.clearColor(0, 0, 0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.enable(gl.DEPTH_TEST);

  // Nacrtaj nebo
  drawSky(gl, reflectionFBO, reflView, reflProj, SUN.dir, {
    ...DEFAULT_SKY,
    worldLocked: 1,
    sunColor: SUN.color,
    sunIntensity: SUN.intensity,
    hideSun: true,
    useTonemap: false,
  });

  gl.useProgram(reflectionColorProgram);
  gl.uniform4f(
  gl.getUniformLocation(reflectionColorProgram, "uClipPlane"),
  0.0, 1.0, 0.0, 0.0    // ravan y=0
);
  gl.uniform3fv(reflectionUniforms.uSunDir, SUN.dir);
  gl.uniform3fv(reflectionUniforms.uSunColor, SUN.color);
  gl.uniform1f(reflectionUniforms.uSunIntensity, SUN.intensity);
  gl.uniform3fv(reflectionUniforms.uCameraPos, camWorld);
  gl.uniform1f(reflectionUniforms.uRoughness, 0.08);
  gl.uniform1f(reflectionUniforms.uSpecularStrength, 1.0);

  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_CUBE_MAP, envTex);
  gl.uniform1i(reflectionUniforms.uEnvMap, 1);

  gl.uniformMatrix4fv(reflectionUniforms.uProjection, false, reflProj);
  gl.uniformMatrix4fv(reflectionUniforms.uView, false, reflView);

  for (let i = 0; i < modelVAOs.length; ++i) {
    const meshName = nodesMeta[renderToNodeId[i]]?.name?.toLowerCase() || "";
    if (meshName.includes("water")) continue;
    if (originalParts[i]?.alphaMode === "BLEND" || originalParts[i]?.opacity < 0.999)
      continue;
    if (!idxCounts[i]) continue;

    gl.uniformMatrix4fv(reflectionUniforms.uModel, false, modelMatrices[i]);
    gl.uniform3fv(reflectionUniforms.uBaseColor, modelBaseColors[i] || [1, 1, 1]);

    if (modelBaseTextures[i]) {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, modelBaseTextures[i]);
      gl.uniform1i(reflectionUniforms.uBaseColorTex, 0);
      gl.uniform1i(reflectionUniforms.uUseBaseColorTex, 1);
    } else {
      gl.uniform1i(reflectionUniforms.uUseBaseColorTex, 0);
    }

    gl.bindVertexArray(modelVAOs[i]);
    gl.drawElements(gl.TRIANGLES, idxCounts[i], idxTypes[i], 0);
  }

  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.bindTexture(gl.TEXTURE_2D, null);
}

gl.bindFramebuffer(gl.FRAMEBUFFER, null);

  // === 4. Geometry pass (g-buffer) za opaque objekte ===
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.bindFramebuffer(gl.FRAMEBUFFER, gBuffer);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  
  gl.enable(gl.DEPTH_TEST);
  gl.depthMask(true);
  
  gl.useProgram(gBufferProgram);

  gl.uniformMatrix4fv(gBufferUniforms.uProjection, false, proj);
  gl.uniformMatrix4fv(gBufferUniforms.uView, false, view);
  for (let i = 0; i < modelVAOs.length; ++i) {
    if (!idxCounts[i]) continue;
        gl.uniformMatrix4fv(gBufferUniforms.uModel, false, modelMatrices[i]);
        gl.uniform3fv(gBufferUniforms.uBaseColor, modelBaseColors[i] || [1,1,1]);
        gl.uniform1f(gBufferUniforms.uMetallic, modelMetallics[i] ?? 1.0);
        gl.uniform1f(gBufferUniforms.uRoughness, modelRoughnesses[i] ?? 1.0);
    if (modelBaseTextures[i]) {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, modelBaseTextures[i]);
      gl.uniform1i(gBufferUniforms.uBaseColorTex, 0);
      gl.uniform1i(gBufferUniforms.uUseBaseColorTex, 1);
    } else {
      gl.uniform1i(gBufferUniforms.uUseBaseColorTex, 0);
    }

      // 🔹 Normal mapa
    if (originalParts[i]?.normalTex) {
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, originalParts[i].normalTex);
      gl.uniform1i(gBufferUniforms.uNormalTex, 1);
      gl.uniform1i(gBufferUniforms.uUseNormalTex, 1);
    } else {
      gl.uniform1i(gBufferUniforms.uUseNormalTex, 0);
    }

      // 🔹 Roughness mapa
  if (originalParts[i]?.roughnessTex) {
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, originalParts[i].roughnessTex);
    gl.uniform1i(gBufferUniforms.uRoughnessTex, 2);
    gl.uniform1i(gBufferUniforms.uUseRoughnessTex, 1);
  } else {
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, window.whiteTex); // ✅ fallback
    gl.uniform1i(gBufferUniforms.uRoughnessTex, 2);
    gl.uniform1i(gBufferUniforms.uUseRoughnessTex, 0);
  }

    gl.bindVertexArray(modelVAOs[i]);
    gl.drawElements(gl.TRIANGLES, idxCounts[i], idxTypes[i], 0);
  }
  
if (ssaoDirty) {
  gl.bindFramebuffer(gl.FRAMEBUFFER, ssaoFBO);
  gl.useProgram(ssaoProgram);

  // --- Textures ---
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, gPosition);
  gl.uniform1i(ssaoUniforms.gPosition, 0);

  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, gNormal);
  gl.uniform1i(ssaoUniforms.gNormal, 1);

  gl.activeTexture(gl.TEXTURE2);
  gl.bindTexture(gl.TEXTURE_2D, ssaoNoiseTexture);
  gl.uniform1i(ssaoUniforms.tNoise, 2);

  gl.activeTexture(gl.TEXTURE3);
  gl.bindTexture(gl.TEXTURE_2D, gAlbedo);
  gl.uniform1i(ssaoUniforms.gAlbedo, 3);

  // --- Uniforms ---
  gl.uniform2f(ssaoUniforms.uNoiseScale, canvas.width / SSAO_NOISE_SIZE, canvas.height / SSAO_NOISE_SIZE);
  gl.uniform3fv(ssaoUniforms.samples, ssaoKernel);
  gl.uniformMatrix4fv(ssaoUniforms.uProjection, false, proj);
  gl.uniform1f(ssaoUniforms.uFrame, timeNow * 50.0);

  // --- Draw ---
  gl.bindVertexArray(quadVAO);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

  // ✅ resetuj stanje posle SSAO pasa
  gl.disable(gl.SCISSOR_TEST);
  gl.viewport(0, 0, canvas.width, canvas.height);

// === BLUR SSAO ===
gl.bindFramebuffer(gl.FRAMEBUFFER, window.ssaoBlurFBO);
gl.useProgram(window.ssaoBlurProgram);
gl.activeTexture(gl.TEXTURE0);
gl.bindTexture(gl.TEXTURE_2D, ssaoColorBuffer);
gl.uniform1i(window.ssaoBlurUniforms.tSSAO, 0);
gl.uniform2f(window.ssaoBlurUniforms.uTexelSize, 1.0 / canvas.width, 1.0 / canvas.height);
gl.bindVertexArray(quadVAO);
gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
gl.bindFramebuffer(gl.FRAMEBUFFER, null);


  ssaoDirty = false;
}


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

    // --- Teksture ---
    bindTextureToSlot(gl, gPosition, TEXTURE_SLOTS.PBR_POSITION);
    bindTextureToSlot(gl, gNormal, TEXTURE_SLOTS.PBR_NORMAL);
    bindTextureToSlot(gl, gAlbedo, TEXTURE_SLOTS.PBR_ALBEDO);
    bindTextureToSlot(gl, gMaterial, TEXTURE_SLOTS.PBR_MATERIAL);
    bindTextureToSlot(gl, window.ssaoBlurColor, TEXTURE_SLOTS.PBR_SSAO);
    bindTextureToSlot(gl, envTex, TEXTURE_SLOTS.PBR_ENV_MAP, gl.TEXTURE_CUBE_MAP);
    bindTextureToSlot(gl, window.envDiffuse, TEXTURE_SLOTS.PBR_ENV_DIFFUSE, gl.TEXTURE_CUBE_MAP);
    bindTextureToSlot(gl, brdfTex, TEXTURE_SLOTS.PBR_BRDF_LUT);
    bindTextureToSlot(gl, shadowDepthTex, TEXTURE_SLOTS.PBR_SHADOW_MAP);
    bindTextureToSlot(gl, window.ssaoBlurColor, TEXTURE_SLOTS.PBR_BENT_NORMAL_AO);
    bindTextureToSlot(gl, window.sceneColorTex, TEXTURE_SLOTS.PBR_SCENE_COLOR);

    // --- Uniforme ---
    gl.uniform2f(pbrUniforms.uResolution, canvas.width, canvas.height);
    if (!arraysEqual(lastView, view)) {
      gl.uniformMatrix4fv(pbrUniforms.uView, false, view);
      lastView.set(view);
    }
    if (!arraysEqual(lastProj, proj)) {
      gl.uniformMatrix4fv(pbrUniforms.uProjection, false, proj);
      lastProj.set(proj);
    }
    gl.uniformMatrix4fv(pbrUniforms.uLightVP, false, lightVP);
    gl.uniform3fv(pbrUniforms.uCameraPos, camWorld);
    gl.uniform3fv(pbrUniforms.uSunDir, SUN.dir);
    gl.uniform3fv(pbrUniforms.uSunColor, SUN.color);
    gl.uniform1f(pbrUniforms.uSunIntensity, SUN.intensity);
    gl.uniform1f(pbrUniforms.uGlobalExposure, window.globalExposure);
    gl.uniform1f(pbrUniforms.uCubeMaxMip, cubeMaxMip);
    gl.bindVertexArray(quadVAO);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);


  if (!window.sceneColorTex) {
    window.sceneColorTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, window.sceneColorTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  if (sceneChanged) {
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, finalFBO);
    gl.bindTexture(gl.TEXTURE_2D, window.sceneColorTex);
    gl.copyTexImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, 0, 0, canvas.width, canvas.height, 0);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    sceneChanged = false; // ✅ reset
  }
if (showWater) {
  // NEMOJ PONOVO bindFramebuffer(finalFBO)! (VEĆ SI U njemu)
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.enable(gl.DEPTH_TEST);
  gl.depthMask(true);
  gl.disable(gl.CULL_FACE);
  
  // Kopiraj depth iz gBuffer u finalFBO pre crtanja vode
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, gBuffer);
  gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, finalFBO);
  gl.blitFramebuffer(0,0,canvas.width,canvas.height,0,0,canvas.width,canvas.height,gl.DEPTH_BUFFER_BIT,gl.NEAREST);
  
  const reflMatrix = reflView ? mat4mul(proj, reflView) : mat4mul(proj, view);

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
    reflMatrix,
    window.globalExposure
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
    const viewProj = stableViewProjMatrix;
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
const V = v3.norm(v3.sub(camera.pan, camWorld)); // view dir: target - eye
let cameraMoved = !arraysEqual(lastViewMatrix, view);
if (cameraMoved) {
  transparentMeshes.forEach(m => {
    if (!m._bbComputed) {
      const b = computeBounds(m.pos);
      m._centerLocal = [
        (b.min[0]+b.max[0]) * 0.5,
        (b.min[1]+b.max[1]) * 0.5,
        (b.min[2]+b.max[2]) * 0.5
      ];
      m._radiusLocal = Math.hypot(
        b.max[0]-m._centerLocal[0],
        b.max[1]-m._centerLocal[1],
        b.max[2]-m._centerLocal[2]
      );
      m._bbComputed = true;
    }
    const cw = mulMat4Vec4([], m.modelMat, [m._centerLocal[0], m._centerLocal[1], m._centerLocal[2], 1]);
    m._farDepth = (cw[0]-camWorld[0])*V[0] + (cw[1]-camWorld[1])*V[1] + (cw[2]-camWorld[2])*V[2] + m._radiusLocal;
  });
  transparentMeshes.sort((a,b) => b._farDepth - a._farDepth);
}


// bind program + zajednički uniformi
gl.useProgram(programGlass);
gl.uniformMatrix4fv(glassUniforms.uView, false, view);
gl.uniformMatrix4fv(glassUniforms.uProjection, false, proj);
gl.activeTexture(gl.TEXTURE0);
gl.bindTexture(gl.TEXTURE_CUBE_MAP, envTex);
gl.uniform1i(glassUniforms.uEnvMap, 0);
gl.uniform3fv(glassUniforms.uCameraPos, camWorld);

// PASS 1: BACK-FACES PRVI
gl.cullFace(gl.FRONT);

for (const m of transparentMeshes) {
  if (m.opacity > 0.95) continue;
  if (!m.count) continue;
  gl.uniformMatrix4fv(glassUniforms.uModel, false, m.modelMat);
  gl.uniform3fv(glassUniforms.uBaseColor, m.baseColor || [1,1,1]);
  gl.uniform1f(glassUniforms.uRoughness, m.roughness ?? 1.0);
  gl.uniform1f(glassUniforms.uMetallic, m.metallic ?? 0.0);
  gl.uniform1f(glassUniforms.uOpacity, m.opacity ?? 1.0);
  gl.bindVertexArray(m.vao);
  gl.drawElements(gl.TRIANGLES, m.count, m.type, 0);
}

// PASS 2: FRONT-FACES POSLE
gl.cullFace(gl.BACK);
for (const m of transparentMeshes) {
  if (m.opacity > 0.95) continue;
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
gl.bindFramebuffer(gl.FRAMEBUFFER, toneMapFBO);
gl.viewport(0, 0, canvas.width, canvas.height);
gl.useProgram(acesProgram);
gl.activeTexture(gl.TEXTURE0);
gl.bindTexture(gl.TEXTURE_2D, finalColorTex);
gl.uniform1i(gl.getUniformLocation(acesProgram, "uInput"), 0);

gl.bindVertexArray(quadVAO);
gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

gl.bindFramebuffer(gl.FRAMEBUFFER, null);

let postColorTex = toneMapTex;
if (taaActive && taaProgram && taaHistoryTextures.length === 2) {
  const readIndex = taaHistoryIndex;
  const writeIndex = 1 - taaHistoryIndex;
  const useHistory = prevViewProjValid && !sceneChangedThisFrame;
  const blendFactor = useHistory ? (camera.moved ? 0.05 : 0.12) : 0.0;

  gl.bindFramebuffer(gl.FRAMEBUFFER, taaHistoryFBOs[writeIndex]);
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.disable(gl.DEPTH_TEST);
  gl.useProgram(taaProgram);

  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, toneMapTex);
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(
    gl.TEXTURE_2D,
    useHistory ? taaHistoryTextures[readIndex] : toneMapTex
  );
  gl.activeTexture(gl.TEXTURE2);
  gl.bindTexture(gl.TEXTURE_2D, window.finalDepthTex);

  gl.uniformMatrix4fv(taaUniforms.uCurrViewProj, false, currViewProjMatrix);
  gl.uniformMatrix4fv(
    taaUniforms.uPrevViewProj,
    false,
    useHistory ? prevViewProj : currViewProjMatrix
  );
  gl.uniformMatrix4fv(taaUniforms.uInvCurrViewProj, false, invCurrViewProj);
  gl.uniform1f(taaUniforms.uBlendFactor, blendFactor);

  gl.bindVertexArray(quadVAO);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);

  taaHistoryIndex = writeIndex;
  prevViewProj.set(currViewProjMatrix);
  prevViewProjValid = true;
  postColorTex = taaHistoryTextures[taaHistoryIndex];
  gl.activeTexture(gl.TEXTURE0);
} else {
  prevViewProj.set(currViewProjMatrix);
  prevViewProjValid = false;
  taaHaltonIndex = 0;
  gl.activeTexture(gl.TEXTURE0);
}

// === SSR OVERLAY ===
gl.bindFramebuffer(gl.FRAMEBUFFER, ssrOutputFBO);
gl.viewport(0, 0, canvas.width, canvas.height);
gl.clearColor(0, 0, 0, 1);
gl.clear(gl.COLOR_BUFFER_BIT);
gl.disable(gl.DEPTH_TEST);
gl.enable(gl.BLEND);
gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

gl.useProgram(window.ssrProgram);

// ✅ NOVE LINIJE (samo binding - uniformi su već postavljeni):
bindTextureToSlot(gl, gPosition, TEXTURE_SLOTS.SSR_POSITION);
bindTextureToSlot(gl, gNormal, TEXTURE_SLOTS.SSR_NORMAL);
bindTextureToSlot(gl, postColorTex, TEXTURE_SLOTS.SSR_SCENE_COLOR);
bindTextureToSlot(gl, gMaterial, TEXTURE_SLOTS.SSR_MATERIAL);
bindTextureToSlot(gl, envTex, TEXTURE_SLOTS.SSR_ENV_MAP, gl.TEXTURE_CUBE_MAP);

gl.uniformMatrix4fv(window.ssrUniforms.uView, false, view);
gl.uniformMatrix4fv(window.ssrUniforms.uProjection, false, proj);
gl.uniform2f(window.ssrUniforms.uResolution, canvas.width, canvas.height);
gl.uniform1f(window.ssrUniforms.uCubeMaxMip, cubeMaxMip); // 👈 DODAJ
gl.uniform1f(window.ssrUniforms.uGlobalExposure, window.globalExposure);

gl.bindVertexArray(quadVAO);
gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

gl.disable(gl.BLEND);
gl.bindFramebuffer(gl.FRAMEBUFFER, null);
// --- FXAA ---

gl.bindFramebuffer(gl.FRAMEBUFFER, null);
gl.viewport(0, 0, canvas.width, canvas.height);
gl.useProgram(fxaaProgram);

gl.activeTexture(gl.TEXTURE0);
gl.bindTexture(gl.TEXTURE_2D, ssrOutputTex); // ✅ sad FXAA vidi SSR rezultat ssrOutputTex
gl.uniform1i(gl.getUniformLocation(fxaaProgram, "uInput"), 0);
gl.uniform2f(gl.getUniformLocation(fxaaProgram, "uResolution"), canvas.width, canvas.height);

gl.bindVertexArray(quadVAO);
const texelSize = [1.0 / canvas.width, 1.0 / canvas.height];
gl.uniform2f(gl.getUniformLocation(fxaaProgram, "uTexelSize"), texelSize[0], texelSize[1]);
gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

// ✅ tek sada resetuj GL stanje
gl.disable(gl.BLEND);
gl.depthMask(true);
gl.depthFunc(gl.LESS);
gl.enable(gl.CULL_FACE);
camera.moved = false;
}

let lastTime = performance.now();
let frameCount = 0;

function renderLoop(now) {
  render();

  frameCount++;
  const delta = now - lastTime;
  if (delta >= 1000) {
    fps = frameCount;
    frameCount = 0;
    lastTime = now;

    const perfDiv = document.getElementById("fps-value");
    if (perfDiv) perfDiv.textContent = fps;
  }

  requestAnimationFrame(renderLoop);
}

const infoPanel = document.getElementById("info-panel");
const toggleBtn = document.getElementById("toggle-info");
toggleBtn.addEventListener("click", () => {
  infoPanel.classList.toggle("open");
});

async function loadGLB(buf) {
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
      const doubleSided = mat.doubleSided || false;

      const baseColorFactor = pbr.baseColorFactor || [1, 1, 1, 1];
      const baseColor = new Float32Array(baseColorFactor.slice(0, 3));
      let baseColorTex = null;
      let normalTex = null;
      let roughnessTex = null;

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
      // 🔹 Ako postoji normal mapa — učitaj je
      if (mat.normalTexture && typeof mat.normalTexture.index === "number") {
        normalTex = loadTextureFromImage(gltf, bin, mat.normalTexture.index);
      }

      // 🔹 Ako postoji metallic+roughness mapa — učitaj je
      if (pbr.metallicRoughnessTexture && typeof pbr.metallicRoughnessTexture.index === "number") {
        roughnessTex = loadTextureFromImage(gltf, bin, pbr.metallicRoughnessTexture.index);
      }
      /* ----- Geometrija ----- */
      const pa = ac[pr.attributes.POSITION];
      const pv = bv[pa.bufferView];
      const pos = new Float32Array(bin, pv.byteOffset, pa.count * 3);

      const na = ac[pr.attributes.NORMAL];
      const nv = bv[na.bufferView];
      const nor = new Float32Array(bin, nv.byteOffset, na.count * 3);
      // ✅ NOVO: Tangenti (ako ih ima u glb fajlu)
      let tangents = null;
      if (pr.attributes.TANGENT !== undefined) {
        const ta = ac[pr.attributes.TANGENT];
        const tv = bv[ta.bufferView];
        tangents = new Float32Array(bin, tv.byteOffset, ta.count * 4); // x,y,z,w
      }
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

      const hasTangent = !!tangents;
      const stride = (hasTangent ? 12 : (uvArray ? 8 : 6)) * 4;
      const interleaved = new Float32Array(
        pos.length + nor.length +
        (uvArray ? uvArray.length : 0) +
        (hasTangent ? tangents.length : 0)
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
        if (hasTangent) {
          interleaved[j++] = tangents[i * 4];
          interleaved[j++] = tangents[i * 4 + 1];
          interleaved[j++] = tangents[i * 4 + 2];
          interleaved[j++] = tangents[i * 4 + 3]; // handedness (sign)
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
      if (hasTangent) {
        const offset = uvArray ? 32 : 24;
        gl.enableVertexAttribArray(3);
        gl.vertexAttribPointer(3, 4, gl.FLOAT, false, stride, offset);
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
    opacity,
    alphaMode,
    normalTex: normalTex || window.defaultNormalTex,
    roughnessTex: roughnessTex || window.whiteTex,
  };
      if (!realOriginalParts[renderIdx]) {
        realOriginalParts[renderIdx] = {
          ...originalParts[renderIdx],
          normalTex: normalTex || window.defaultNormalTex,
          roughnessTex: roughnessTex || window.whiteTex,
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
    window.boatMin = boatMin;
    window.boatMax = boatMax;
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


  camera.fitToBoundingBox(min, max);
  camera.rx = camera.rxTarget = Math.PI / 10;
  camera.ry = camera.ryTarget = Math.PI / 20;
  camera.updateView();

  // 👇 DODAJ OVO - sačuvaj početno stanje kamere
  window.initialCameraState = {
    pan: camera.pan.slice(),
    dist: camera.distTarget,
    rx: camera.rxTarget,
    ry: camera.ryTarget
  };

  ({ proj, view, camWorld } = camera.updateView());
  // Sačekaj da se sve teksture spuste u GPU
  await waitForPendingTextures(8000);
  await new Promise(requestAnimationFrame);
  
  }

function loadTextureFromImage(gltf, bin, texIndex) {
  window.pendingTextures++;
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
  
  // ✅ DODAJ OVO - sačuvaj staro stanje
  const oldBinding = gl.getParameter(gl.TEXTURE_BINDING_2D);
  
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, 
    new Uint8Array([255, 0, 255, 255]));
  
  // ✅ VRATI STARO STANJE ODMAH
  gl.bindTexture(gl.TEXTURE_2D, oldBinding);
  
  image.onload = () => {
    // ✅ SAČUVAJ OPET
    const oldBinding2 = gl.getParameter(gl.TEXTURE_BINDING_2D);
    
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
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    }
    
    // ✅ VRATI STARO STANJE
    gl.bindTexture(gl.TEXTURE_2D, oldBinding2);
    
    URL.revokeObjectURL(url);
    decrementPendingTextures();
  };
  image.onerror = (err) => {
    console.warn("[gltf] Failed to load embedded texture:", imageDef.uri || texIndex, err);
    URL.revokeObjectURL(url);
    decrementPendingTextures();
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

async function parseGLBToPrepared(buf, url) {
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

      /* interleaved POS+NOR(+UV+TANGENT)  ->  VBO / VAO */
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
  const uvOffset = (uvView.byteOffset || 0) + (uvAccessor.byteOffset || 0);
  uvArray = new Float32Array(bin, uvOffset, uvAccessor.count * 2);
}

// --- Tangenti ---
let tangents = null;
if (prim.attributes.TANGENT !== undefined) {
  const ta = acc[prim.attributes.TANGENT];
  const tv = views[ta.bufferView];
  tangents = new Float32Array(bin, tv.byteOffset, ta.count * 4);
}

// --- interleaved: pos + nor + uv + tangent ---
const hasTangent = !!tangents;
const stride = (3 + 3 + (uvArray ? 2 : 0) + (hasTangent ? 4 : 0)) * 4;
const inter = new Float32Array(
  pos.length + nor.length + (uvArray ? uvArray.length : 0) + (hasTangent ? tangents.length : 0)
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
  if (hasTangent) {
    inter[j++] = tangents[i * 4];
    inter[j++] = tangents[i * 4 + 1];
    inter[j++] = tangents[i * 4 + 2];
    inter[j++] = tangents[i * 4 + 3];
  }
}

gl.bufferData(gl.ARRAY_BUFFER, inter, gl.STATIC_DRAW);

// --- attributes ---
let offset = 0;
gl.enableVertexAttribArray(0);
gl.vertexAttribPointer(0, 3, gl.FLOAT, false, stride, offset); offset += 12;

gl.enableVertexAttribArray(1);
gl.vertexAttribPointer(1, 3, gl.FLOAT, false, stride, offset); offset += 12;

if (uvArray) {
  gl.enableVertexAttribArray(2);
  gl.vertexAttribPointer(2, 2, gl.FLOAT, false, stride, offset);
  offset += 8;
}

if (hasTangent) {
  gl.enableVertexAttribArray(3);
  gl.vertexAttribPointer(3, 4, gl.FLOAT, false, stride, offset);
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
let normalTex = null;
let roughnessTex = null;

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

  // Base color
  if (pbr.baseColorTexture) {
    const texIdx = pbr.baseColorTexture.index;
    baseColorTex = loadTextureFromImage(gltf, bin, texIdx);
  }

  // ✅ Normal mapa
  if (mat.normalTexture && typeof mat.normalTexture.index === "number") {
    normalTex = loadTextureFromImage(gltf, bin, mat.normalTexture.index);
  }

  // ✅ Metallic-Roughness mapa
  if (pbr.metallicRoughnessTexture && typeof pbr.metallicRoughnessTexture.index === "number") {
    roughnessTex = loadTextureFromImage(gltf, bin, pbr.metallicRoughnessTexture.index);
  }

  const alphaMode = mat.alphaMode || "OPAQUE";
  isBlend = alphaMode === "BLEND" || opacity < 0.99999;
}

/* ---------- push rezultat ---------- */
      out.push({
        vao,
        count: ind.length,
        type: glIdxType,
        pos: pos.slice(),
        nor: nor.slice(),
        ind: ind.slice(),
        baseColor: new Float32Array(baseColor),
        metallic,
        roughness,
        opacity,
        isBlend,
        baseColorTex,
        normalTex,
        roughnessTex,
        matName: gltf.materials[prim.material]?.name || `Mat_${p}`,
        trisWorld: [],
      });
    }
  }

  return out;
}

async function replaceSelectedWithURL(url, variantName, partName) {

    const alreadyCached = !url || preparedVariants[url];
  
  if (!alreadyCached) {
    showLoading(); // 👈 prikaži SAMO ako treba da fetchuje
  }
  
  const node = nodesMeta.find((n) => n.name === partName);
  
if (node) {
  delete node.cachedBounds; // 👈 UVEK obriši, čak i ako je isti variant
}
  if (!node) {
    if (!alreadyCached) hideLoading(); // 👈 sakrij SAMO ako si pokazao
    return;
  }
  const cfgGroup = Object.values(VARIANT_GROUPS).find((g) => partName in g) || {};
  const mainMat = cfgGroup[partName]?.mainMat || "";

  transparentMeshes = transparentMeshes.filter((m) => m.partName !== partName);

  let variantMeshes;
  if (!url) {
    variantMeshes = node.renderIdxs.map((r) => realOriginalParts[r.idx]).filter(Boolean);
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
      const buf = cachedVariants[url] || (await fetch(url).then((r) => r.arrayBuffer()));
      cachedVariants[url] = buf;
      preparedVariants[url] = await parseGLBToPrepared(buf, url);
    }
    variantMeshes = preparedVariants[url].filter(Boolean);
  }

 const oldSlots = node.renderIdxs.map((r) => r.idx);

  for (let i = 0; i < variantMeshes.length; ++i) {
    const vm = variantMeshes[i];
    if (!vm) continue;

    let renderIdx;
    if (i < oldSlots.length) {
      renderIdx = oldSlots[i];
    } else {
      renderIdx = modelVAOs.length;
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

    if (vm.isBlend) {
      transparentMeshes.push({
        ...vm,
        renderIdx,
        partName,
        modelMat: modelMatrices[renderIdx],
      });
      idxCounts[renderIdx] = 0;
      continue;
    }

    modelVAOs[renderIdx] = vm.vao;
    idxCounts[renderIdx] = vm.count;
    idxTypes[renderIdx] = vm.type;
    modelBaseColors[renderIdx] = vm.baseColor;
    modelMetallics[renderIdx] = vm.metallic;
    modelRoughnesses[renderIdx] = vm.roughness;
    modelBaseTextures[renderIdx] = vm.baseColorTex || null;
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
      normalTex: vm.normalTex || window.defaultNormalTex,     // 👈 dodaj ovo
      roughnessTex: vm.roughnessTex || window.whiteTex,       // 👈 i ovo
    };
  }

  for (let j = variantMeshes.length; j < oldSlots.length; ++j) {
    idxCounts[oldSlots[j]] = 0;
  }
// ✅ UVEK učitaj kompletnu boju (color ili texture) iz configa
const variantData = (cfgGroup[partName]?.models || []).find(v => v.name === variantName);
const savedColorName = savedColorsByPart[partName]?.[variantName];
const activeColor = savedColorName
  ? variantData?.colors?.find(c => c.name === savedColorName)
  : variantData?.colors?.[0];

if (activeColor) {
  if (activeColor.type === "color" && activeColor.color) {
    for (const r of node.renderIdxs) {
      if (mainMat && r.matName === mainMat) {
        modelBaseColors[r.idx] = new Float32Array(activeColor.color);
        modelBaseTextures[r.idx] = null;
      } else if (!mainMat && r === node.renderIdxs[0]) {
        modelBaseColors[r.idx] = new Float32Array(activeColor.color);
        modelBaseTextures[r.idx] = null;
      }
    }
  } else if (activeColor.type === "texture" && activeColor.texture) {
      const texLoader = loadTextureWithCache;

      if (texLoader) {
        const [texBase, texNormal, texRough] = await Promise.all([
          texLoader(activeColor.texture),
          texLoader(activeColor.normal),
          texLoader(activeColor.rough),
        ]);

        for (const r of node.renderIdxs) {
          const shouldApply = mainMat ? r.matName === mainMat : r === node.renderIdxs[0];
          if (!shouldApply) continue;
          modelBaseTextures[r.idx] = texBase;
          if (originalParts[r.idx]) {
            originalParts[r.idx].baseColorTex = texBase;
            if (texNormal) originalParts[r.idx].normalTex = texNormal;
            if (texRough) originalParts[r.idx].roughnessTex = texRough;
          }
        }
      } else {
        const img = new Image();
        await new Promise(res => {
          img.onload = res;
          img.src = activeColor.texture;
        });
        const tex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
        gl.generateMipmap(gl.TEXTURE_2D);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        for (const r of node.renderIdxs) {
          const shouldApply = mainMat ? r.matName === mainMat : r === node.renderIdxs[0];
          if (!shouldApply) continue;
          modelBaseTextures[r.idx] = tex;
        }
      }
    }

}


  currentParts[partName] = { ...currentParts[partName], name: variantName };

  if (!window.__suppressFocusCamera) {
      focusCameraOnNode(node);
    }
  if (!alreadyCached) {
    hideLoading(); // 👈 zameni безусловни hideLoading() sa uslovnim
  }


refreshLighting();


shadowDirty = true;
ssaoDirty = true;
sceneChanged = true;

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
  const jobs = [];
  for (const parts of Object.values(VARIANT_GROUPS)) {
    for (const data of Object.values(parts)) {
      for (const variant of data.models) {
        if (!variant.src) continue;
        if (cachedVariants[variant.src]) continue;

        jobs.push(async () => {
          try {
            const buf = await fetch(variant.src).then((r) => r.arrayBuffer());
            cachedVariants[variant.src] = buf;
            preparedVariants[variant.src] = await parseGLBToPrepared(buf, variant.src);
          } catch (err) {
            console.warn("[variants] Failed to preload variant:", variant.src, err);
          }
        });
      }
    }
  }

  if (!jobs.length) return;
  const CONCURRENCY = 3;
  let jobIndex = 0;
  const workers = Array.from({ length: Math.min(CONCURRENCY, jobs.length) }, async () => {
    while (jobIndex < jobs.length) {
      const current = jobIndex++;
      await jobs[current]();
    }
  });
  await Promise.all(workers);
}

async function generateThumbnailForVariant(partName, variant) {
  if (!window.previewGL) {
    const previewCanvas = document.createElement("canvas");
    previewCanvas.width = 256;
    previewCanvas.height = 256;
    window.previewGL = previewCanvas.getContext("webgl2");
  }
  const gl2 = window.previewGL;
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

  gl2.uniformMatrix4fv( gl2.getUniformLocation(prog, "uProjection"), false,proj);
  gl2.uniformMatrix4fv(gl2.getUniformLocation(prog, "uView"), false, view);
  gl2.uniformMatrix4fv(gl2.getUniformLocation(prog, "uModel"), false, model);

  gl2.viewport(0, 0, 256, 256);
  gl2.clearColor(0.15, 0.15, 0.18, 1);
  gl2.clear(gl2.COLOR_BUFFER_BIT | gl2.DEPTH_BUFFER_BIT);
  gl2.enable(gl2.DEPTH_TEST);

  const uColorLoc = gl2.getUniformLocation(prog, "uBaseColor");
  const uOpacityLoc = gl2.getUniformLocation(prog, "uOpacity"); 

  // 🔑 nacrtaj SVE materijale/primitive
  for (const d of preview.draws) {
    if (d.isBlend) {
      gl2.enable(gl2.BLEND);
      gl2.blendFunc(gl2.SRC_ALPHA, gl2.ONE_MINUS_SRC_ALPHA);
    }

    gl2.uniform3fv(uColorLoc, d.baseColor || new Float32Array([0.7, 0.7, 0.7]));
    gl2.uniform1f(uOpacityLoc, d.opacity !== undefined ? d.opacity : 1.0);
    gl2.bindVertexArray(d.vao);
    gl2.drawElements(gl2.TRIANGLES, d.count, d.type, 0);

    if (d.isBlend) {gl2.disable(gl2.BLEND);}
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
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    const lose = canvas.__glContext?.getExtension("WEBGL_lose_context");
    lose?.loseContext();
  });
}

