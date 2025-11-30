import { createShaderProgram } from "./shader.js";
import { initWater, drawWater } from "./water.js";
import { resetBoundTextures } from "./water.js";
import { initCamera } from "./camera.js";
import { initSky, drawSky, bakeSkyToCubemap, bakeIrradianceFromSky, bakeStudioToCubemap, drawStudio, DEFAULT_STUDIO } from "./sky.js";
import { DEFAULT_SKY } from "./sky.js";
import {
  DEFAULT_MODEL,
  BASE_PRICE,
  VARIANT_GROUPS,
  BOAT_INFO,
  SIDEBAR_INFO,
  THUMBNAIL_CAM_PRESETS,
} from "./config.js";
import {mat4mul,persp,ortho,look,composeTRS,computeBounds,mulMat4Vec4, v3,} from "./math.js";
import { initUI, renderBoatInfo, showPartInfo, showLoading, hideLoading, showToast, updateLoadingProgress } from "./ui.js";
import { TEXTURE_SLOTS, bindTextureToSlot } from "./texture-slots.js";
import { createThumbnailGenerator, thumbnails } from "./thumbnails.js";

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
const currentViewMatrix = new Float32Array(16);
const currentProjMatrix = new Float32Array(16);
let currentViewProjMatrix = null;
window.currentViewMatrix = currentViewMatrix;
window.currentProjMatrix = currentProjMatrix;
window.currentViewProjMatrix = currentViewProjMatrix;
const textureCache = {}; // key = url, value = WebGLTexture
const textureCachePromises = new Map();
window.textureCache = textureCache;
const lastAppliedCameraPreset = {}; // per-part key to avoid re-applying same camera

let shadowFBO, shadowDepthTex;
const SHADOW_RES = 2048;
const UNIT_SCALE = window.UNIT_SCALE ?? 1;
const COMPONENT_BYTE_SIZE = {
  5120: 1, // BYTE
  5121: 1, // UNSIGNED_BYTE
  5122: 2, // SHORT
  5123: 2, // UNSIGNED_SHORT
  5125: 4, // UNSIGNED_INT
  5126: 4, // FLOAT
};

const TYPE_COMPONENT_COUNT = {
  SCALAR: 1,
  VEC2: 2,
  VEC3: 3,
  VEC4: 4,
  MAT4: 16,
};

function readAccessorAsFloat(gltf, bin, accessorIndex) {
  const accessor = gltf.accessors[accessorIndex];
  const view = gltf.bufferViews[accessor.bufferView];
  const compSize = COMPONENT_BYTE_SIZE[accessor.componentType];
  const numComp = TYPE_COMPONENT_COUNT[accessor.type] || 1;
  const stride = view.byteStride || numComp * compSize;
  const offsetBase = (view.byteOffset || 0) + (accessor.byteOffset || 0);
  const count = accessor.count;
  const dv = new DataView(bin, offsetBase, stride * count);
  const out = new Float32Array(count * numComp);
  const normalized = !!accessor.normalized;

  const readComp = (byteOffset) => {
    switch (accessor.componentType) {
      case 5126:
        return dv.getFloat32(byteOffset, true);
      case 5125:
        return dv.getUint32(byteOffset, true);
      case 5123:
        return dv.getUint16(byteOffset, true);
      case 5121:
        return dv.getUint8(byteOffset);
      case 5122:
        return dv.getInt16(byteOffset, true);
      case 5120:
        return dv.getInt8(byteOffset);
      default:
        return 0;
    }
  };

  const normFactorUnsigned = (max) => (max ? 1.0 / max : 1.0);
  const normFactorSigned = (max) => (max ? 1.0 / max : 1.0);

  let unsignedMax = 1;
  let signedMax = 1;
  if (accessor.componentType === 5125) unsignedMax = 4294967295;
  else if (accessor.componentType === 5123) unsignedMax = 65535;
  else if (accessor.componentType === 5121) unsignedMax = 255;
  else if (accessor.componentType === 5122) signedMax = 32767;
  else if (accessor.componentType === 5120) signedMax = 127;

  for (let i = 0; i < count; ++i) {
    const base = i * stride;
    for (let c = 0; c < numComp; ++c) {
      const byteOffset = base + c * compSize;
      let v = readComp(byteOffset);
      if (normalized) {
        if (
          accessor.componentType === 5125 ||
          accessor.componentType === 5123 ||
          accessor.componentType === 5121
        ) {
          v *= normFactorUnsigned(unsignedMax);
        } else if (
          accessor.componentType === 5122 ||
          accessor.componentType === 5120
        ) {
          v = Math.max(-1, Math.min(1, v * normFactorSigned(signedMax)));
        }
      }
      out[i * numComp + c] = v;
    }
  }
  return out;
}

function readIndices(gltf, bin, accessorIndex) {
  const accessor = gltf.accessors[accessorIndex];
  const view = gltf.bufferViews[accessor.bufferView];
  const offset = (view.byteOffset || 0) + (accessor.byteOffset || 0);
  let array;
  let glType;

  switch (accessor.componentType) {
    case 5121:
      array = new Uint8Array(bin, offset, accessor.count);
      glType = gl.UNSIGNED_BYTE;
      break;
    case 5123:
      array = new Uint16Array(bin, offset, accessor.count);
      glType = gl.UNSIGNED_SHORT;
      break;
    case 5125:
      array = new Uint32Array(bin, offset, accessor.count);
      glType = gl.UNSIGNED_INT;
      break;
    default:
      array = new Uint16Array(bin, offset, accessor.count);
      glType = gl.UNSIGNED_SHORT;
      break;
  }

  return { array, glType };
}

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
  updateLoadingProgress("Loading textures", window.pendingTextures, window.pendingMeshes ? 1 : 0);

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
      showToast(`Texture failed: ${src}`, "warn", 3500);
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
  const tColor = smoothstep(0.0, 1.0, alt);
  SUN.color = [
    sunsetColor[0] + (dayColor[0] - sunsetColor[0]) * tColor,
    sunsetColor[1] + (dayColor[1] - sunsetColor[1]) * tColor,
    sunsetColor[2] + (dayColor[2] - sunsetColor[2]) * tColor,
  ];

  const fade = Math.pow(Math.max(alt, 0.0), 0.4);
  SUN.intensity = 1.3 * fade; 

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
  if (envMode === ENV_MODE.STUDIO) {
    SUN.intensity = Math.max(SUN.intensity, 0.6);
  }

  rebuildEnvironmentTextures();
  sceneChanged = true;
  render();
}



function refreshLighting() {
  updateSun();
  if (envMode === ENV_MODE.STUDIO) {
    SUN.intensity = Math.max(SUN.intensity, 0.6);
  }
  shadowDirty = true;
  rebuildEnvironmentTextures();
}

function rebuildEnvironmentTextures() {
  const previousEnvTex = envTex;
  const previousEnvDiffuse = window.envDiffuse;

  if (envMode === ENV_MODE.STUDIO) {
    envTex = bakeStudioToCubemap(gl, envSize, studioEnvOpts);
  } else {
    envTex = bakeSkyToCubemap(gl, envSize, SUN.dir, {
      ...DEFAULT_SKY,
      sunColor: SUN.color,
      sunIntensity: SUN.intensity,
      useTonemap: false,
      hideSun: true,
    });
  }

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

function setEnvMode(mode) {
  const next = mode === ENV_MODE.STUDIO ? ENV_MODE.STUDIO : ENV_MODE.SKY;
  if (envMode === next) return;
  envMode = next;
  if (envMode === ENV_MODE.STUDIO) {
    SUN.intensity = Math.max(SUN.intensity, 0.6);
  } else {
    updateSun();
  }
  shadowDirty = true;
  rebuildEnvironmentTextures();
  sceneChanged = true;
  render();
}
window.setEnvMode = setEnvMode;

function smoothstep(edge0, edge1, x) {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

let fxaaProgram = null;
let toneMapTex = null;
let toneMapFBO = null;

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
  updateLoadingProgress("Loading textures", window.pendingTextures, window.pendingMeshes ? 1 : 0);
}
let savedColorsByPart = {};
let reflectionFBO = null;
let reflectionTex = null;
let reflectionColorProgram = null;
const REFLECTION_SCALE = 0.2;
let envSize = 512; // kontrola kvaliteta/performansi
let cubeMaxMip = Math.floor(Math.log2(envSize));
window.showWater = true;
window.showDimensions = false;
const ENV_MODE = { SKY: "sky", STUDIO: "studio" };
let envMode = ENV_MODE.SKY;
const studioEnvOpts = { ...DEFAULT_STUDIO };
let originalGlassByPart = {};
let transparentMeshes = [];
let envTex = null;
let brdfTex = null;
let realOriginalParts = {}; // permanentno čuvamo početni model (A)
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
let boatWidthLine = null;
let boatHeightLine = null;
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
let cachedCanvasRect = null;
let cachedCanvasRectFrame = -1;
let lastBoundsResult = null;
let lastBoundsFrame = -1;
let dimLabelsDirty = true;
window.markDimLabelsDirty = () => {
  dimLabelsDirty = true;
};
let rulerAnchorEl = null;
let boatTickLine = null;
const dimOverlayCtx = { canvas: null, labels: null, uColor: null };

const DIM_COLOR = [0.9, 0.02, 1.0];
const DIM_TICK_COLOR = [0.65, 0.9, 1.0];

const KERNEL_SIZE = 48;
const SSAO_NOISE_SIZE = 3;
window.__suppressThumbnailUI = window.__suppressThumbnailUI || false;
const cachedVariants = {}; // url -> ArrayBuffer
const preparedVariants = {}; // url -> [ { vao, count, type, baseColor, metallic, roughness, trisWorld }... ]
let firstFramePromise = null;
let resolveFirstFrame = null;
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
  window.reflectionSize = null;
}

function createReflectionTarget(gl, width, height) {
  disposeReflectionTarget();

  const reflW = Math.max(1, Math.floor(width * REFLECTION_SCALE));
  const reflH = Math.max(1, Math.floor(height * REFLECTION_SCALE));
  window.reflectionSize = [reflW, reflH];

  reflectionTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, reflectionTex);
  gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA16F,reflW,reflH,0,gl.RGBA, gl.HALF_FLOAT,null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

  window.reflectionDepthTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, window.reflectionDepthTex);
  gl.texImage2D(
  gl.TEXTURE_2D, 0,gl.DEPTH_COMPONENT24,  reflW,reflH,0, gl.DEPTH_COMPONENT,gl.UNSIGNED_INT,null);
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

function applyBoatNameFromConfig() {
  const nameEl = document.querySelector(".boat-name");
  if (!nameEl) return;
  const name = BOAT_INFO?.Model || "Boat";
  nameEl.textContent = name;
}

function focusCameraOnNode(node) {
  if (!node) return;
  camera.useOrtho = false; // prebaci nazad u perspektivu
  // osveži bbox pre fokusa da bude tačan posle zamene varijante
  delete node.cachedBounds;
  const bounds = ensureNodeBounds(node);
  if (!bounds || !bounds.center) return;

  camera.panTarget = bounds.center.slice();
  let targetDist = bounds.dist;
  if (!targetDist) {
    const size = bounds.size || (bounds.radius ? bounds.radius * 2 : 1);
    const fovY = Math.PI / 4;
    const newDist = size / (2 * Math.tan(fovY / 2));
    window.currentBoundingRadius = bounds.radius || size * 0.5;
    targetDist = newDist * 0.7;
    const minDist = newDist * 0.2;
    const maxDist = newDist * 3.0;
    targetDist = Math.min(Math.max(targetDist, minDist), maxDist);
    bounds.dist = targetDist;
  }
  camera.distTarget = targetDist;
  camera.rxTarget = Math.PI / 5;       // koristi target
  camera.ryTarget = 0;

  // računaj centriranje na ciljnom uglu, ali zadrži glatku rotaciju
  const prevRx = camera.rx;
  const prevRy = camera.ry;
  const prevDist = camera.dist;
  camera.rx = camera.rxTarget;
  camera.ry = camera.ryTarget;
  camera.dist = camera.distTarget;
  recenterCameraToBounds(bounds, { snap: false });
  camera.rx = prevRx;
  camera.ry = prevRy;
  camera.dist = prevDist;
  sceneChanged = true;
}

function ensureNodeBounds(node) {
  if (!node) return null;
  if (
    node.cachedBounds &&
    node.cachedBounds.center &&
    node.cachedBounds.min &&
    node.cachedBounds.max
  ) {
    return node.cachedBounds;
  }

  let min = [Infinity, Infinity, Infinity];
  let max = [-Infinity, -Infinity, -Infinity];
  let hasGeometry = false;

  for (const r of node.renderIdxs || []) {
    if (!r.matName || r.matName.toLowerCase().includes("dummy")) continue;

    const orig = originalParts[r.idx];
    if (!orig) continue;

    const modelMat = modelMatrices[r.idx] || orig.modelMatrix;
    if (!modelMat) continue;

    const local = orig.localAABB;
    if (local && local.min && local.max) {
      hasGeometry = true;
      const lx = local.min[0], ly = local.min[1], lz = local.min[2];
      const hx = local.max[0], hy = local.max[1], hz = local.max[2];
      const corners = [
        [lx, ly, lz, 1],
        [lx, ly, hz, 1],
        [lx, hy, lz, 1],
        [lx, hy, hz, 1],
        [hx, ly, lz, 1],
        [hx, ly, hz, 1],
        [hx, hy, lz, 1],
        [hx, hy, hz, 1],
      ];
      for (const c of corners) {
        const w = vec4.transformMat4([], c, modelMat);
        min[0] = Math.min(min[0], w[0]);
        min[1] = Math.min(min[1], w[1]);
        min[2] = Math.min(min[2], w[2]);
        max[0] = Math.max(max[0], w[0]);
        max[1] = Math.max(max[1], w[1]);
        max[2] = Math.max(max[2], w[2]);
      }
    } else if (orig.pos) {
      for (let i = 0; i < orig.pos.length; i += 3) {
        hasGeometry = true;
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
  }

  if (!hasGeometry) return node.cachedBounds || null;

  const center = [
    (min[0] + max[0]) / 2,
    (min[1] + max[1]) / 2,
    (min[2] + max[2]) / 2,
  ];
  const size = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
  const radius = Math.max(size * 0.5, 0.1);

  node.cachedBounds = {
    ...(node.cachedBounds || {}),
    center,
    size,
    radius,
    min: min.slice(),
    max: max.slice(),
  };
  return node.cachedBounds;
}

function getPartWorldInfo(partNameOrNode) {
  const node =
    typeof partNameOrNode === "string"
      ? nodesMeta.find((n) => n.name === partNameOrNode)
      : partNameOrNode;
  if (!node) return null;
  const bounds = ensureNodeBounds(node);
  if (!bounds) return null;
  return {
    center: bounds.center.slice(),
    radius: bounds.radius,
  };
}

function getPartScreenPosition(partKey) {
  if (!window.currentViewProjMatrix) return null;
  const info = getPartWorldInfo(partKey);
  if (!info) return null;
  const canvasEl = document.getElementById("glCanvas");
  if (!canvasEl) return null;
  const projected = projectToScreen(info.center, window.currentViewProjMatrix, canvasEl);
  if (!projected.visible) return null;
  if (cachedCanvasRectFrame !== drawStats.frame) {
    cachedCanvasRect = canvasEl.getBoundingClientRect();
    cachedCanvasRectFrame = drawStats.frame;
  }
  const rect = cachedCanvasRect || canvasEl.getBoundingClientRect();
  const scaleX = rect.width / canvasEl.width;
  const scaleY = rect.height / canvasEl.height;
  return {
    x: rect.left + projected.x * scaleX,
    y: rect.top + projected.y * scaleY,
  };
}

async function loadDefaultModel(url, { showSpinner = true } = {}) {
  if (showSpinner) showLoading();
  window.pendingMeshes = true;
  updateLoadingProgress("Loading model", window.pendingTextures || 0, 1);
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = await res.arrayBuffer();
    await loadGLB(buf);  
  } catch (err) {
    console.error("Failed to load model", err);
    showToast("Failed to load model file.", "error");
  } finally {
    window.pendingMeshes = false;
    updateLoadingProgress("Loading textures", window.pendingTextures || 0, 0);
    if (showSpinner) hideLoading();     
    render();       
  }
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
// preserveDrawingBuffer pomaže da canvas bude čitljiv za thumbnail capture na mobilnim browserima
const gl = canvas.getContext("webgl2", { alpha: true, antialias: false, preserveDrawingBuffer: true });
const drawStats = {
  frame: 0,
  drawCalls: 0,
  perPass: {},
  currentPass: "frame",
};

window.drawStats = drawStats;
const thumbnailGenerator = createThumbnailGenerator({
  canvas,
  gl,
  camera,
  nodesMeta,
  getNodesMeta: () => nodesMeta,
  variantGroups: VARIANT_GROUPS,
  currentParts,
  savedColorsByPart,
  cachedVariants,
  preparedVariants,
  parseGLBToPrepared,
  ensureNodeBounds,
  focusCameraOnNode,
  replaceSelectedWithURL,
  waitForPendingTextures,
  recenterCameraToBounds,
  render,
  updateLoadingProgress,
  setSceneChanged: () => {
    sceneChanged = true;
  },
});
const {
  preloadAllVariants,
  generateAllThumbnails,
  refreshThumbnailsInUI,
  waitForThumbnailsToSettle,
  hideCanvasForThumbnails,
  restoreCanvasAfterThumbnails,
} = thumbnailGenerator;
window.thumbnails = thumbnails;

function beginFrameDrawStats() {
  drawStats.frame += 1;
  drawStats.drawCalls = 0;
  drawStats.perPass = {};
  drawStats.currentPass = "frame";
}

function beginDrawPass(name) {
  drawStats.currentPass = name;
  if (!(name in drawStats.perPass)) {
    drawStats.perPass[name] = 0;
  }
}

function registerDrawCall() {
  drawStats.drawCalls += 1;
  const pass = drawStats.currentPass;
  if (pass) {
    drawStats.perPass[pass] = (drawStats.perPass[pass] || 0) + 1;
  }
}

const originalDrawElements = gl.drawElements.bind(gl);
gl.drawElements = function patchedDrawElements(...args) {
  registerDrawCall();
  return originalDrawElements(...args);
};

const originalDrawArrays = gl.drawArrays.bind(gl);
gl.drawArrays = function patchedDrawArrays(...args) {
  registerDrawCall();
  return originalDrawArrays(...args);
};

canvas.__glContext = gl;
if (!gl) alert("WebGL2 is not supported in this browser.");
if (!gl.getExtension("EXT_color_buffer_float")) {
  alert(
    "This browser does not support EXT_color_buffer_float.\nGI effects will be disabled."
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
  let ssaa = 1.2;

function resizeCanvas() {
  const sidebarEl = document.getElementById("sidebar");
  const isTabletPortrait = window.matchMedia("(min-width: 769px) and (max-width: 1200px) and (orientation: portrait)").matches;
  let sidebarW = sidebarEl ? sidebarEl.offsetWidth : 0;
  const headerEl = document.querySelector(".global-header");
  const headerH = headerEl ? headerEl.offsetHeight : 0;
  const actionBarH = (() => {
    const root = getComputedStyle(document.documentElement);
    const val = parseFloat(root.getPropertyValue("--action-bar-h")) || 0;
    return val;
  })();

  const footerH = isTabletPortrait ? (sidebarEl ? sidebarEl.offsetHeight : 0) : actionBarH;
  if (isTabletPortrait) sidebarW = 0;

  const cssW = Math.max(1, window.innerWidth - sidebarW);
  const cssH = Math.max(1, window.innerHeight - headerH - footerH);
  const aspect = cssW / cssH;
  let maxRenderW;
  const isMobile = /Mobi|Android|iPhone|iPad|Tablet/i.test(navigator.userAgent);
  if (isMobile) {
    maxRenderW = Math.min(cssW * 1.0, 2048);
  } else {
    maxRenderW = cssW;
  }

  let targetW = Math.min(cssW, maxRenderW);
  let targetH = Math.round(targetW / aspect);
  const dpr = Math.min(window.devicePixelRatio || 1, 1.0);
  const realW = Math.round(targetW * ssaa * dpr);
  const realH = Math.round(targetH * ssaa * dpr);

  canvas.width = realW;
  canvas.height = realH;
  canvas.style.width = cssW + "px";
  canvas.style.height = cssH + "px";
  canvas.style.left = (isTabletPortrait ? 0 : sidebarW) + "px";
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

  const resMeter = document.getElementById("res-meter");
  if (resMeter) {
    resMeter.textContent = `Render: ${targetW}x${targetH} → ${realW}x${realH} (SSAA ${ssaa.toFixed(2)}x)`;
    resMeter.classList.remove("hidden");
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
}


export async function exportPDF() {
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF("p", "mm", "a4");
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const margin = 14;
  let y = margin;

  const boatName = BOAT_INFO.Model || "Less Boat";
  const dateStr = new Date().toLocaleDateString("en-GB");
  const accent = [58, 164, 255];
  const muted = [80, 94, 110];
  const baseText = [20, 20, 20];
  const contactEmail = "contact@lessengine.com";
  const contactPhone = "+381 11 555 123";

  // Helpers
  const ensureSpace = (need = 15) => {
    if (y + need > pageH - margin) {
      pdf.addPage();
      y = margin;
    }
  };
  const sectionTitle = (title) => {
    ensureSpace(14);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(13);
    pdf.setTextColor(20);
    pdf.text(title.toUpperCase(), margin, y);
    pdf.setDrawColor(...accent);
    pdf.setLineWidth(0.6);
    pdf.line(margin, y + 2, margin + 30, y + 2);
    y += 10;
  };

  // Logo
  const logoImg = new Image();
  logoImg.src = "assets/Less_logo.png";
  await new Promise((res) => (logoImg.onload = res));
  const logoAspect = logoImg.width / logoImg.height;
  const logoH = 14;
  const logoW = logoH * logoAspect;

  // HEADER STRIP
  pdf.setFillColor(8, 14, 22);
  pdf.rect(0, 0, pageW, 24, "F");
  pdf.addImage(logoImg, "PNG", margin, 6, logoW, logoH);
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(11);
  pdf.setTextColor(230);
  pdf.text(dateStr, pageW - margin, 16, { align: "right" });
  y = 24;

  // SCREENSHOT
  const oldView = camera.currentView;
  const oldUseOrtho = camera.useOrtho;
  ({ proj, view, camWorld } = camera.updateView());
  render();
  const canvas = document.querySelector("#glCanvas");
  render();
  gl.finish();
  const imageData = canvas.toDataURL("image/png");
  const imgAspect = canvas.width / canvas.height;
  const shotW = pageW;
  const shotH = shotW / imgAspect;
  // full-bleed hero
  pdf.addImage(imageData, "PNG", 0, y, shotW, shotH);
  y += shotH + 12;
  camera.currentView = oldView;
  camera.useOrtho = oldUseOrtho;
  ({ proj, view, camWorld } = camera.updateView());
  render();

  // Title block under image
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(22);
  pdf.setTextColor(20);
  pdf.text(boatName, margin, y);
  pdf.setFontSize(11);
  pdf.setFont("helvetica", "normal");
  pdf.setTextColor(...muted);
  y += 7;
  pdf.text("Configuration breakdown", margin, y);
  y += 10;

  // BOAT INFO table
  sectionTitle("Boat info");
  const specs = Object.entries(BOAT_INFO || {});
  const infoRowH = 8;
  const infoW = pageW - margin * 2;
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(10.5);
  pdf.setFillColor(...accent);
  pdf.setTextColor(255);
  pdf.rect(margin, y - 5, infoW, 9, "F");
  pdf.text("Label", margin + 3, y);
  pdf.text("Value", margin + infoW - 6, y, { align: "right" });
  y += 8;
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(10);
  specs.forEach((entry, i) => {
    ensureSpace(infoRowH + 4);
    const [key, val] = entry;
    if (i % 2 === 0) {
      pdf.setFillColor(247, 249, 252);
      pdf.rect(margin, y - infoRowH + 1, infoW, infoRowH + 1, "F");
    }
    pdf.setTextColor(90);
    pdf.text(key, margin + 3, y);
    pdf.setTextColor(20);
    pdf.text(String(val), margin + infoW - 6, y, { align: "right" });
    y += infoRowH;
  });
  y += 10;

  // PARTS TABLE (full width)
  sectionTitle("Parts list");
  const rows = [...document.querySelectorAll("#partsTable tbody tr")];
  const headerH = 9;
  const rowH = 7;
  const tableW = pageW - margin * 2;
  const colPart = 40;
  const colDesc = 120;
  pdf.setFillColor(...accent);
  pdf.setTextColor(255);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(10.5);
  pdf.rect(margin, y - 5, tableW, headerH, "F");
  pdf.text("Part", margin + 3, y);
  pdf.text("Description", margin + colPart + 3, y);
  pdf.text("Price", margin + tableW - 6, y, { align: "right" });
  y += headerH - 1;
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(10);
  pdf.setTextColor(30);

  rows.forEach((tr, i) => {
    const cells = tr.querySelectorAll("td");
    if (cells.length < 3) return;
    const part = cells[0].textContent.trim();
    const desc = cells[1].textContent.trim();
    const price = cells[2].textContent.trim();
    ensureSpace(rowH + 4);
    if (i % 2 === 0) {
      pdf.setFillColor(247, 249, 252);
      pdf.rect(margin, y - rowH + 1, tableW, rowH + 1, "F");
    }
    pdf.text(part, margin + 3, y);
    pdf.text(desc, margin + colDesc + 3, y);
    pdf.text(price, margin + tableW - 6, y, { align: "right" });
    y += rowH;
  });
  y += 10;

  // CONTACT / CTA block (no QR)
  ensureSpace(32 + 20);
  const ctaH = 32;
  pdf.setDrawColor(...accent);
  pdf.setLineWidth(0.4);
  pdf.setFillColor(245, 248, 255);
  pdf.roundedRect(margin, y - 5, tableW, ctaH, 3, 3, "FD");
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(11);
  pdf.setTextColor(20);
  pdf.text("Get in touch", margin + 6, y + 2);
  pdf.setFont("helvetica", "normal");
  pdf.setTextColor(...muted);
  pdf.setFontSize(10);
  pdf.text(contactEmail, margin + 6, y + 10);
  pdf.text(contactPhone, margin + 6, y + 18);
  pdf.text("Less Engine", margin + tableW - 6, y + 18, { align: "right" });
  y += ctaH;
  y += 8;

  // TOTAL TAG
  const total = document.querySelector(".sidebar-total .price")?.textContent || "";
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(12);
  pdf.setTextColor(...accent);
  pdf.text(`TOTAL: ${total}`, margin, y);

  // FOOTER
  pdf.setFillColor(8, 14, 22);
  pdf.rect(0, pageH - 12, pageW, 12, "F");
  pdf.setTextColor(230);
  pdf.setFontSize(9);
  // page numbers + project
  const pageCount = pdf.internal.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    pdf.setPage(i);
    pdf.setFillColor(8, 14, 22);
    pdf.rect(0, pageH - 12, pageW, 12, "F");
    pdf.setTextColor(230);
    pdf.setFontSize(9);
    pdf.text(`Less Engine · Page ${i} of ${pageCount}`, pageW / 2, pageH - 4, { align: "center" });
  }

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
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
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

function ensureRulerAnchor(labelsDiv = document.getElementById("labels")) {
  if (!rulerAnchorEl) {
    if (!labelsDiv) return null;
    rulerAnchorEl = document.createElement("div");
    rulerAnchorEl.className = "ruler-anchor";
    labelsDiv.appendChild(rulerAnchorEl);
  }
  return rulerAnchorEl;
}

function makeLine(p1, p2) {
  const v = [...p1, ...p2];
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

function makeLengthLine(min, max) {
  const y = min[1];
  const z = max[2];
  return makeLine([min[0], y, z], [max[0], y, z]);
}

function makeWidthLine(min, max) {
  const y = min[1];
  return makeLine([min[0], y, max[2]], [min[0], y, min[2]]);
}

function makeHeightLine(min, max) {
  return makeLine([min[0], min[1], max[2]], [min[0], max[1], max[2]]);
}

function getDimOverlayContext() {
  if (!dimOverlayCtx.canvas) dimOverlayCtx.canvas = document.getElementById("glCanvas");
  if (!dimOverlayCtx.labels) {
    const labelsDiv = document.getElementById("labels");
    if (labelsDiv) {
      if (!labelsDiv.style.position) labelsDiv.style.position = "absolute";
      labelsDiv.style.pointerEvents = "none";
      dimOverlayCtx.labels = labelsDiv;
    }
  }
  if (!dimOverlayCtx.uColor && lineProgram) {
    dimOverlayCtx.uColor =
      (window.lineUniforms && window.lineUniforms.uColor) ||
      gl.getUniformLocation(lineProgram, "uColor");
  }
  if (!dimOverlayCtx.canvas || !dimOverlayCtx.labels || !dimOverlayCtx.uColor) return null;
  return dimOverlayCtx;
}

function formatDimensionLabel(label, meters) {
  const feet = meters * 3.28084;
  return `${label}: ${meters.toFixed(2)} m / ${feet.toFixed(2)} ft`;
}

function placeDimLabel(ctx, viewProj, { id, start, end, meters, offsetY = 0, label }) {
  const { canvas, labels } = ctx;
  const midWorld = [
    (start[0] + end[0]) * 0.5,
    (start[1] + end[1]) * 0.5,
    (start[2] + end[2]) * 0.5,
  ];
  const sMid = projectToScreen(midWorld, viewProj, canvas);
  let lbl = document.getElementById(id);
  if (!lbl) {
    lbl = document.createElement("div");
    lbl.id = id;
    lbl.className = "label";
    labels.appendChild(lbl);
  }
  lbl.style.position = "absolute";

  if (!sMid.visible || !Number.isFinite(sMid.x) || !Number.isFinite(sMid.y)) {
    lbl.classList.remove("visible");
    return;
  }

  const midX = sMid.x;
  const midY = sMid.y + offsetY;
  lbl.innerText = formatDimensionLabel(label || id, meters);
  const rect = canvas.getBoundingClientRect();
  const scaleX = rect.width / canvas.width;
  const scaleY = rect.height / canvas.height;
  lbl.style.left = `${rect.left + midX * scaleX}px`;
  lbl.style.top = `${rect.top + midY * scaleY}px`;
  lbl.classList.add("visible");
}

function updateRulerAnchorPosition(ctx, viewProj, dimOrigin) {
  const { canvas, labels } = ctx;
  const anchor = ensureRulerAnchor(labels);
  if (!anchor) return;
  const s = projectToScreen(dimOrigin, viewProj, canvas);
  if (s.visible && Number.isFinite(s.x) && Number.isFinite(s.y)) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = rect.width / canvas.width;
    const scaleY = rect.height / canvas.height;
    anchor.style.left = `${rect.left + s.x * scaleX}px`;
    anchor.style.top = `${rect.top + s.y * scaleY}px`;
    anchor.classList.add("visible");
  } else {
    anchor.classList.remove("visible");
  }
}

function drawRulerLines(uColorLoc) {
  const drawDimLine = (line) => {
    if (!line) return;
    gl.uniform3fv(uColorLoc, DIM_COLOR);
    gl.bindVertexArray(line.vao);
    gl.drawArrays(gl.LINES, 0, line.count);
    gl.bindVertexArray(null);
  };

  drawDimLine(boatLengthLine);
  drawDimLine(boatWidthLine);
  drawDimLine(boatHeightLine);
  if (boatTickLine) {
    gl.uniform3fv(uColorLoc, DIM_TICK_COLOR);
    gl.bindVertexArray(boatTickLine.vao);
    gl.drawArrays(gl.LINES, 0, boatTickLine.count);
    gl.bindVertexArray(null);
  }
}

function renderDimensionOverlay(proj, view) {
  if (!showDimensions || !boatMin || !boatMax) return;
  const ctx = getDimOverlayContext();
  if (!ctx) return;

  beginDrawPass("dimensions");
  gl.useProgram(lineProgram);
  setMatrices(lineProgram);
  const prevDepthTest = gl.isEnabled(gl.DEPTH_TEST);
  const prevDepthMask = gl.getParameter(gl.DEPTH_WRITEMASK);
  gl.disable(gl.DEPTH_TEST);
  gl.depthMask(false);

  drawRulerLines(ctx.uColor);

  const viewProj = mat4mul(proj, view);
  const xLength = boatMax[0] - boatMin[0];
  const zWidth = boatMax[2] - boatMin[2];
  const yHeight = boatMax[1] - boatMin[1];
  const dimOrigin = [boatMin[0], boatMin[1], boatMax[2]];

  const shouldUpdateLabels = camera.moved || dimLabelsDirty;
  if (shouldUpdateLabels) {
    updateRulerAnchorPosition(ctx, viewProj, dimOrigin);

    placeDimLabel(ctx, viewProj, {
      id: "lengthLabel",
      start: dimOrigin,
      end: [boatMax[0], boatMin[1], boatMax[2]],
      meters: xLength,
      offsetY: 40,
      label: "Length",
    });

    placeDimLabel(ctx, viewProj, {
      id: "widthLabel",
      start: dimOrigin,
      end: [boatMin[0], boatMin[1], boatMin[2]],
      meters: zWidth,
      offsetY: 20,
      label: "Width",
    });

    placeDimLabel(ctx, viewProj, {
      id: "heightLabel",
      start: dimOrigin,
      end: [boatMin[0], boatMax[1], boatMax[2]],
      meters: yHeight,
      offsetY: -10,
      label: "Height",
    });

    dimLabelsDirty = false;
  }

  if (prevDepthTest) gl.enable(gl.DEPTH_TEST);
  else gl.disable(gl.DEPTH_TEST);
  gl.depthMask(prevDepthMask);
}
function buildDimensionTicks(min, max, radius) {
  const verts = [];
  const size = Math.max(radius * 0.015, 0.05);
  const addTicks = (start, end, up) => {
    const dir = [
      end[0] - start[0],
      end[1] - start[1],
      end[2] - start[2],
    ];
    const len = Math.hypot(dir[0], dir[1], dir[2]);
    if (len < size * 1.5) return;
    const step = Math.max(0.5, len / 12);
    const invLen = 1 / len;
    dir[0] *= invLen;
    dir[1] *= invLen;
    dir[2] *= invLen;

    for (let d = step; d < len; d += step) {
      const px = start[0] + dir[0] * d;
      const py = start[1] + dir[1] * d;
      const pz = start[2] + dir[2] * d;
      verts.push(
        px - up[0] * size * 0.5,
        py - up[1] * size * 0.5,
        pz - up[2] * size * 0.5,
        px + up[0] * size * 0.5,
        py + up[1] * size * 0.5,
        pz + up[2] * size * 0.5
      );
    }
  };

  const origin = [min[0], min[1], max[2]];
  addTicks(origin, [max[0], min[1], max[2]], [0, 1, 0]); // length ticks up/down
  addTicks(origin, [min[0], min[1], min[2]], [0, 1, 0]); // width ticks up/down
  addTicks(origin, [min[0], max[1], max[2]], [1, 0, 0]); // height ticks sideways

  if (!verts.length) return null;
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const vb = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vb);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(verts), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);
  return { vao, vbo: vb, count: verts.length / 3 };
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
    window.globalExposure = 1.0; // globalni exposure za sve svetlo
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
    rebuildEnvironmentTextures();
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
    float k = (a*a)/2.0; // IBL version, not direct light
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
  document.body.classList.add("app-loading");
  showLoading();
  window.__firstFrameDone = false;
  firstFramePromise = Promise.resolve();
  const glOk = await initGL();
  if (!glOk) return;

  const shadersOk = await initShaders();
  if (!shadersOk) return;

  const sceneOk = await initScene(); // ⏳ čeka sky + water
  if (!sceneOk) return;
  await preloadAllConfigTextures();

  try {
    // Sacekaj i model
    await loadDefaultModel(DEFAULT_MODEL, { showSpinner: false });


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
    applyBoatNameFromConfig();

    // Pokreni UI tek sada
    initUI({ render, BOAT_INFO, VARIANT_GROUPS, BASE_PRICE, SIDEBAR_INFO });
    Object.assign(window, {
      gl, camera, nodesMeta, modelBaseColors, modelBaseTextures,
      savedColorsByPart, showDimensions, showWater, SIDEBAR_INFO,
      VARIANT_GROUPS, BASE_PRICE, BOAT_INFO, thumbnails, currentParts,
      render, replaceSelectedWithURL, focusCameraOnNode, setWeather,
      proj, view, camWorld, exportPDF, sceneChanged,
      originalParts,   // 👈 dodaj ovu liniju
      getPartWorldInfo,
      getPartScreenPosition
    });

    showLoading();
    await preloadAllVariants();
    await waitForPendingTextures(12000);
    await generateAllThumbnails();
    refreshThumbnailsInUI();
    await waitForThumbnailsToSettle();

    // pripremi finalni frame
    render();
    window.__firstFrameDone = true;
  } catch (err) {
    console.error("[initializeApp] Failed:", err);
    alert("App initialization failed — check console.");
  } finally {
    await new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve))
    );
    restoreCanvasAfterThumbnails();
    document.body.classList.remove("app-loading");
    await new Promise((resolve) => requestAnimationFrame(resolve));
    hideLoading();
    renderLoop(); // startuj loop tek kada se loading skine
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
  beginFrameDrawStats();
  const timeNow = performance.now() * 0.001; // koristi u SSAO i vodi
  let reflView = null;
  let reflProj = proj;
  let cameraNear = 0.1;
  let cameraFar = 100000.0;
  let near, far;
  // === 1. Animacija kamere i matrica pogleda ===
    showWater = window.showWater;
  showDimensions = window.showDimensions;
  camera.animateCamera();
  ({ proj, view, camWorld, near, far } = camera.updateView());
  cameraNear = near ?? cameraNear;
  cameraFar = far ?? cameraFar;
  currentViewMatrix.set(view);
  currentProjMatrix.set(proj);
  currentViewProjMatrix = mat4mul(currentProjMatrix, currentViewMatrix);
  window.currentViewProjMatrix = currentViewProjMatrix;
  if (typeof window.updateHotspotPositions === "function") {
    window.updateHotspotPositions();
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
  beginDrawPass("shadow-map");
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
    const ds = !!originalParts[i]?.doubleSided;
    if (ds) gl.disable(gl.CULL_FACE);
    else gl.enable(gl.CULL_FACE);
    gl.uniformMatrix4fv(shadowUniforms.uModel, false, modelMatrices[i]);
    gl.bindVertexArray(modelVAOs[i]);
    gl.drawElements(gl.TRIANGLES, idxCounts[i], idxTypes[i], 0);
    if (ds) gl.enable(gl.CULL_FACE);
  }

  gl.disable(gl.POLYGON_OFFSET_FILL);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);

  shadowDirty = false; // ✅ Gotovo — koristi isti depth dok se ne promeni
}

// === 3B. Reflection pass ===
let reflCam = null;

// ✅ UVEK izračunaj reflView
if (showWater) {
  beginDrawPass("reflection");
  reflCam = getReflectedCamera(camWorld, camera.pan, [0, 1, 0]);
  reflView = reflCam.view;
  reflProj = proj;
  const reflViewport = window.reflectionSize || [canvas.width, canvas.height];
  const reflW = reflViewport[0];
  const reflH = reflViewport[1];

  // ✅ I nacrtaj reflection pass UVEK (čak i u top view-u)
  gl.bindFramebuffer(gl.FRAMEBUFFER, reflectionFBO);
  gl.viewport(0, 0, reflW, reflH);
  gl.clearColor(0, 0, 0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.enable(gl.DEPTH_TEST);

  // Nacrtaj nebo
  if (envMode === ENV_MODE.STUDIO) {
    drawStudio(gl, reflectionFBO, reflView, reflProj, {
      ...studioEnvOpts,
      viewportSize: reflViewport,
    });
  } else {
    drawSky(gl, reflectionFBO, reflView, reflProj, SUN.dir, {
      ...DEFAULT_SKY,
      viewportSize: reflViewport,
      worldLocked: 1,
      sunColor: SUN.color,
      sunIntensity: SUN.intensity,
      hideSun: true,
      useTonemap: false,
    });
  }

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

    const ds = !!originalParts[i]?.doubleSided;
    if (ds) gl.disable(gl.CULL_FACE);
    else gl.enable(gl.CULL_FACE);
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
    if (ds) gl.enable(gl.CULL_FACE);
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
  beginDrawPass("g-buffer");
  gl.useProgram(gBufferProgram);

  gl.uniformMatrix4fv(gBufferUniforms.uProjection, false, proj);
  gl.uniformMatrix4fv(gBufferUniforms.uView, false, view);
  for (let i = 0; i < modelVAOs.length; ++i) {
    if (!idxCounts[i]) continue;
    const ds = !!originalParts[i]?.doubleSided;
    if (ds) gl.disable(gl.CULL_FACE);
    else gl.enable(gl.CULL_FACE);
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
    if (ds) gl.enable(gl.CULL_FACE);
  }
  
if (ssaoDirty) {
  beginDrawPass("ssao");
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
  beginDrawPass("ssao-blur");
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
    beginDrawPass("sky");
    if (envMode === ENV_MODE.STUDIO) {
      drawStudio(gl, finalFBO, view, proj, studioEnvOpts);
    } else {
      drawSky(gl, finalFBO, view, proj, SUN.dir, {
        ...DEFAULT_SKY,
        sunColor: SUN.color,
        sunIntensity: SUN.intensity,
        useTonemap: false,
      });
    }

      // --- Lighting pass (PBR shading) ---
    beginDrawPass("lighting");
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
if (showWater && !camera.useOrtho) {
  beginDrawPass("water");
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
    cameraNear,
    cameraFar,
    [canvas.width, canvas.height],
    shadowDepthTex,
    lightVP,
    reflectionTex,
    reflMatrix,
    window.globalExposure
  );
} else if (showWater && camera.useOrtho) {
  // u ortho modu preskačemo crtanje vode, ali zadržavamo depth iz gBuffer-a
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, gBuffer);
  gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, finalFBO);
  gl.blitFramebuffer(0,0,canvas.width,canvas.height,0,0,canvas.width,canvas.height,gl.DEPTH_BUFFER_BIT,gl.NEAREST);
}

  renderDimensionOverlay(proj, view);

    // === 10. Transparent/Overlay/Dimenzije ===
    if (!showWater) {
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, gBuffer);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, finalFBO);
      gl.blitFramebuffer(
        0, 0, canvas.width, canvas.height,
        0, 0, canvas.width, canvas.height,
        gl.DEPTH_BUFFER_BIT,
        gl.NEAREST
      );
    }
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
  lastViewMatrix.set(view);
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
beginDrawPass("transparent-backfaces");
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
beginDrawPass("transparent-frontfaces");
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
beginDrawPass("tonemap");
gl.bindFramebuffer(gl.FRAMEBUFFER, toneMapFBO);
gl.viewport(0, 0, canvas.width, canvas.height);
gl.useProgram(acesProgram);
gl.activeTexture(gl.TEXTURE0);
gl.bindTexture(gl.TEXTURE_2D, finalColorTex);
gl.uniform1i(gl.getUniformLocation(acesProgram, "uInput"), 0);

gl.bindVertexArray(quadVAO);
gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

gl.bindFramebuffer(gl.FRAMEBUFFER, null);

// === SSR OVERLAY ===
beginDrawPass("ssr");
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
bindTextureToSlot(gl, toneMapTex, TEXTURE_SLOTS.SSR_SCENE_COLOR);
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
beginDrawPass("fxaa");
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
const drawCallsValue = document.getElementById("drawcalls-value");
if (drawCallsValue) {
  drawCallsValue.textContent = String(drawStats.drawCalls);
}
const drawMeter = document.getElementById("drawcall-meter");
if (drawMeter) {
  const breakdown = Object.entries(drawStats.perPass)
    .map(([name, value]) => `${name}: ${value}`)
    .join("\n");
  drawMeter.title = breakdown;
  drawMeter.classList.remove("hidden");
}
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
     if (perfDiv) {
      perfDiv.textContent = fps;
      const fpsMeter = document.getElementById("fps-meter");
      if (fpsMeter) fpsMeter.classList.remove("hidden");
    }
  }

  requestAnimationFrame(renderLoop);
}

const infoPanel = document.getElementById("info-panel");
const toggleBtn = document.getElementById("toggle-info");
const loadToggleBtn = document.getElementById("loadConfigToggle");
const toggleLabel = toggleBtn ? toggleBtn.querySelector(".label") : null;
const loadLabel = loadToggleBtn ? loadToggleBtn.querySelector(".label") : null;
const mobileTabs = document.getElementById("mobileTabs");
const tabButtons = mobileTabs ? mobileTabs.querySelectorAll("button") : [];

function setMobileTab(mode) {
  if (!mobileTabs) return;
  if (mobileTabs.classList.contains("hidden")) {
    document.body.classList.remove("mobile-tab-info", "mobile-tab-variants");
    return;
  }
  tabButtons.forEach((btn) => btn.classList.toggle("active", btn.dataset.tab === mode));
  document.body.classList.toggle("mobile-tab-info", mode === "info");
  document.body.classList.toggle("mobile-tab-variants", mode === "variants");
  if (mode === "info") {
    infoPanel.classList.add("info-open");
    infoPanel.classList.remove("load-open");
    toggleBtn?.classList.add("active");
    loadToggleBtn?.classList.remove("active");
  } else {
    infoPanel.classList.remove("info-open");
    infoPanel.classList.remove("load-open");
    toggleBtn?.classList.remove("active");
    loadToggleBtn?.classList.remove("active");
  }
}
window.setMobileTab = setMobileTab;

function updateToggleLabelForDevice() {
  const isPhone = window.matchMedia("(max-width: 768px)").matches;
  const isTabletPortrait = window.matchMedia("(min-width: 769px) and (max-width: 1200px) and (orientation: portrait)").matches;
  const useTextLabel = isPhone || isTabletPortrait;
  const labelText = useTextLabel ? "Configuration Info" : "Config Info";
  if (toggleLabel) toggleLabel.textContent = labelText;
  if (loadLabel) loadLabel.textContent = "Load Configuration";
  if (useTextLabel) {
    toggleBtn.classList.add("text-label");
    mobileTabs?.classList.remove("hidden");
    setMobileTab("info");
    toggleBtn?.classList.add("active");
  } else {
    toggleBtn.classList.remove("text-label");
    mobileTabs?.classList.add("hidden");
    document.body.classList.remove("mobile-tab-info", "mobile-tab-variants");
    infoPanel.classList.remove("info-open", "load-open");
    toggleBtn?.classList.remove("active");
    loadToggleBtn?.classList.remove("active");
  }
}

function openInfo() {
  infoPanel.classList.add("info-open");
  infoPanel.classList.remove("load-open");
  toggleBtn?.classList.add("active");
  loadToggleBtn?.classList.remove("active");
}

function toggleInfoPanel() {
  const shouldOpen = !infoPanel.classList.contains("info-open");
  if (shouldOpen) openInfo();
  else {
    infoPanel.classList.remove("info-open");
    toggleBtn?.classList.remove("active");
  }
}

function toggleLoadPanel() {
  const shouldOpen = !infoPanel.classList.contains("load-open");
  if (shouldOpen) {
    infoPanel.classList.add("load-open");
    infoPanel.classList.remove("info-open");
    loadToggleBtn?.classList.add("active");
    toggleBtn?.classList.remove("active");
  } else {
    infoPanel.classList.remove("load-open");
    loadToggleBtn?.classList.remove("active");
  }
}

function closePanelsIfClickOutside(e) {
  const isInfoOpen = infoPanel.classList.contains("info-open");
  const isLoadOpen = infoPanel.classList.contains("load-open");
  if (!isInfoOpen && !isLoadOpen) return;

  // U portrait/touch režimu uvek ostavi info panel otvoren
  const isTouchMode =
    toggleBtn?.classList.contains("text-label") ||
    document.body.classList.contains("mobile-tab-info") ||
    document.body.classList.contains("mobile-tab-variants");
  const isPortrait = window.matchMedia("(orientation: portrait)").matches;
  if (isTouchMode && isPortrait) return;

  const target = e.target;
  const clickedInsidePanel = infoPanel.contains(target);
  const clickedToggle =
    (toggleBtn && toggleBtn.contains(target)) ||
    (loadToggleBtn && loadToggleBtn.contains(target));

  if (!clickedInsidePanel && !clickedToggle) {
    infoPanel.classList.remove("info-open", "load-open");
    toggleBtn?.classList.remove("active");
    loadToggleBtn?.classList.remove("active");
  }
}

if (toggleBtn) {
  toggleBtn.addEventListener("click", () => {
    const isTouchMode =
      toggleBtn.classList.contains("text-label") ||
      document.body.classList.contains("mobile-tab-info") ||
      document.body.classList.contains("mobile-tab-variants");
    if (isTouchMode) {
      setMobileTab("info");
      return;
    }
    toggleInfoPanel();
  });
}

if (loadToggleBtn) {
  loadToggleBtn.addEventListener("click", () => {
    const isTouchMode =
      toggleBtn.classList.contains("text-label") ||
      document.body.classList.contains("mobile-tab-info") ||
      document.body.classList.contains("mobile-tab-variants");
    if (isTouchMode) {
      toggleLoadPanel();
      return;
    }
    toggleLoadPanel();
  });
}

document.addEventListener("mousedown", closePanelsIfClickOutside);
document.addEventListener("touchstart", closePanelsIfClickOutside, {
  passive: true,
});

tabButtons.forEach((btn) => {
  btn.addEventListener("click", () => setMobileTab(btn.dataset.tab));
});

updateToggleLabelForDevice();
window.addEventListener("resize", updateToggleLabelForDevice);

function disposeCurrentMeshes() {
  const texSet = new Set();
  const collectTex = (tex) => {
    if (!tex) return;
    if (tex === window.whiteTex || tex === window.defaultNormalTex) return;
    texSet.add(tex);
  };

  if (boatTickLine) {
    if (boatTickLine.vao) gl.deleteVertexArray(boatTickLine.vao);
    if (boatTickLine.vbo) gl.deleteBuffer(boatTickLine.vbo);
    boatTickLine = null;
  }
  if (rulerAnchorEl) {
    rulerAnchorEl.remove();
    rulerAnchorEl = null;
  }
  dimOverlayCtx.canvas = null;
  dimOverlayCtx.labels = null;
  dimOverlayCtx.uColor = null;

  modelVAOs.forEach((vao) => vao && gl.deleteVertexArray(vao));
  transparentMeshes.forEach((m) => {
    if (m.vao) gl.deleteVertexArray(m.vao);
    if (m.vbo) gl.deleteBuffer(m.vbo);
    if (m.ebo) gl.deleteBuffer(m.ebo);
    collectTex(m.baseColorTex);
    collectTex(m.normalTex);
    collectTex(m.roughnessTex);
  });
  Object.values(originalGlassByPart).forEach((list) => {
    list.forEach((g) => {
      if (g.vao) gl.deleteVertexArray(g.vao);
      if (g.vbo) gl.deleteBuffer(g.vbo);
      if (g.ebo) gl.deleteBuffer(g.ebo);
      collectTex(g.baseColorTex);
      collectTex(g.normalTex);
      collectTex(g.roughnessTex);
    });
  });
  Object.values(originalParts).forEach((p) => {
    if (p.vbo) gl.deleteBuffer(p.vbo);
    if (p.ebo) gl.deleteBuffer(p.ebo);
    collectTex(p.baseColorTex);
    collectTex(p.normalTex);
    collectTex(p.roughnessTex);
  });
  modelBaseTextures.forEach(collectTex);
  texSet.forEach((tex) => gl.deleteTexture(tex));
}

function updateBoundsFromCurrentParts({ fitCamera = false } = {}) {
  if (!fitCamera && lastBoundsResult && lastBoundsFrame === drawStats.frame) {
    return lastBoundsResult;
  }
  let min = [Infinity, Infinity, Infinity];
  let max = [-Infinity, -Infinity, -Infinity];

  for (const renderIdx in originalParts) {
    const part = originalParts[renderIdx];
    if (!part) continue;
    const mat = modelMatrices[renderIdx];
    if (!mat) continue;

    const local = part.localAABB;
    if (local && local.min && local.max) {
      const lx = local.min[0], ly = local.min[1], lz = local.min[2];
      const hx = local.max[0], hy = local.max[1], hz = local.max[2];
      const corners = [
        [lx, ly, lz, 1],
        [lx, ly, hz, 1],
        [lx, hy, lz, 1],
        [lx, hy, hz, 1],
        [hx, ly, lz, 1],
        [hx, ly, hz, 1],
        [hx, hy, lz, 1],
        [hx, hy, hz, 1],
      ];
      for (const c of corners) {
        const w = vec4.transformMat4([], c, mat);
        min[0] = Math.min(min[0], w[0]);
        min[1] = Math.min(min[1], w[1]);
        min[2] = Math.min(min[2], w[2]);
        max[0] = Math.max(max[0], w[0]);
        max[1] = Math.max(max[1], w[1]);
        max[2] = Math.max(max[2], w[2]);
      }
    } else if (part.pos) {
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
  }

  boatMin = min;
  boatMax = max;
  const center = [
    (min[0] + max[0]) * 0.5,
    (min[1] + max[1]) * 0.5,
    (min[2] + max[2]) * 0.5,
  ];
  const radius = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]) * 0.5;
  window.sceneBoundingCenter = center;
  window.sceneBoundingRadius = radius;
  window.boatMin = boatMin;
  window.boatMax = boatMax;
  if (boatTickLine) {
    if (boatTickLine.vao) gl.deleteVertexArray(boatTickLine.vao);
    if (boatTickLine.vbo) gl.deleteBuffer(boatTickLine.vbo);
  }
  boatLengthLine = makeLengthLine(min, max);
  boatWidthLine = makeWidthLine(min, max);
  boatHeightLine = makeHeightLine(min, max);
  boatTickLine = buildDimensionTicks(min, max, radius);
  dimLabelsDirty = true;
  window.envBox = {
    min: [
      center[0] - radius * 2.0,
      center[1] - radius * 1.0,
      center[2] - radius * 2.0,
    ],
    max: [
      center[0] + radius * 2.0,
      center[1] + radius * 2.0,
      center[2] + radius * 2.0,
    ],
  };

  if (fitCamera) {
    camera.fitToBoundingBox(min, max);
    camera.rx = camera.rxTarget = Math.PI / 10;
    camera.ry = camera.ryTarget = Math.PI / 20;
    camera.updateView();
    window.initialCameraState = {
      pan: camera.pan.slice(),
      dist: camera.distTarget,
      rx: camera.rxTarget,
      ry: camera.ryTarget,
    };
  }

  lastBoundsResult = { min, max, center, radius };
  lastBoundsFrame = drawStats.frame;
  return lastBoundsResult;
}

async function loadGLB(buf) {
  window.pendingMeshes = true;
  updateLoadingProgress("Loading model", window.pendingTextures || 0, 1);
  disposeCurrentMeshes();
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
  originalGlassByPart = {};
  realOriginalParts = {};
  boatLengthLine = null;
  boatWidthLine = null;
  boatHeightLine = null;
  if (boatTickLine) {
    if (boatTickLine.vao) gl.deleteVertexArray(boatTickLine.vao);
    if (boatTickLine.vbo) gl.deleteBuffer(boatTickLine.vbo);
  }
  boatTickLine = null;
  boatMin = null;
  boatMax = null;
  dimLabelsDirty = true;

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
      const alphaMode = (mat.alphaMode || "OPAQUE").toUpperCase();
      const alphaCutoff = mat.alphaCutoff ?? 0.5;
      const isBlend = alphaMode === "BLEND" || (alphaMode === "OPAQUE" && opacity < 0.99999);

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
      const pos = readAccessorAsFloat(gltf, bin, pr.attributes.POSITION);
      const nor = readAccessorAsFloat(gltf, bin, pr.attributes.NORMAL);
      let tangents = null;
      if (pr.attributes.TANGENT !== undefined) {
        tangents = readAccessorAsFloat(gltf, bin, pr.attributes.TANGENT);
      }
      const { array: ind, glType: type } = readIndices(gltf, bin, pr.indices);

      let uvArray = null;
      const uvAttr = pr.attributes.TEXCOORD_0;
      if (uvAttr !== undefined) {
        uvArray = readAccessorAsFloat(gltf, bin, uvAttr);
      }

      /* ----- Kreiranje VAO / VBO ----- */
      const vao = gl.createVertexArray();
      gl.bindVertexArray(vao);

      const hasTangent = !!tangents;
      const stride = (hasTangent ? 12 : (uvArray ? 8 : 6)) * 4;
      const localMin = [Infinity, Infinity, Infinity];
      const localMax = [-Infinity, -Infinity, -Infinity];
      const interleaved = new Float32Array(
        pos.length + nor.length +
        (uvArray ? uvArray.length : 0) +
        (hasTangent ? tangents.length : 0)
      );

      for (let i = 0, j = 0; i < pos.length / 3; ++i) {
        const px = pos[i * 3];
        const py = pos[i * 3 + 1];
        const pz = pos[i * 3 + 2];
        localMin[0] = Math.min(localMin[0], px);
        localMin[1] = Math.min(localMin[1], py);
        localMin[2] = Math.min(localMin[2], pz);
        localMax[0] = Math.max(localMax[0], px);
        localMax[1] = Math.max(localMax[1], py);
        localMax[2] = Math.max(localMax[2], pz);

        interleaved[j++] = px;
        interleaved[j++] = py;
        interleaved[j++] = pz;
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

      const meshNodes = (gltf.nodes || [])
        .map((n, idx) => (n.mesh === meshIdx ? { node: n, idx } : null))
        .filter(Boolean);
      const instances = meshNodes.length
        ? meshNodes
        : [{ node: {}, idx: -1 }];

      for (const inst of instances) {
        const myNode = inst.node || {};
        const t = myNode.translation || [0, 0, 0];
        const r = myNode.rotation || [0, 0, 0, 1];
        const s = myNode.scale || [1, 1, 1];
        const tScaled = [t[0] * UNIT_SCALE, t[1] * UNIT_SCALE, t[2] * UNIT_SCALE];
        const sScaled = [s[0] * UNIT_SCALE, s[1] * UNIT_SCALE, s[2] * UNIT_SCALE];
        const modelMat = composeTRS(tScaled, r, sScaled);

        if (isBlend) {
          /* ————————— PROVIDNI PRIMITIV ————————— */
          const meshObj = {
            vao,
            count: ind.length,
            type,
            modelMat,
            vbo: vb,
            ebo: eb,
            baseColor,
            roughness,
            metallic,
            opacity,
            baseColorTex,
            partName: myNode.name || `mesh_${meshIdx}`,
            alphaMode,
            alphaCutoff,
            doubleSided,

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
            vbo: vb,
            ebo: eb,
            opacity,
            alphaMode,
            alphaCutoff,
            doubleSided,
            normalTex: normalTex || window.defaultNormalTex,
            roughnessTex: roughnessTex || window.whiteTex,
            localAABB: { min: localMin, max: localMax },
            modelMatrix: modelMat.slice(),
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
  }

  updateBoundsFromCurrentParts({ fitCamera: true });
  ({ proj, view, camWorld } = camera.updateView());
  // Sačekaj da se sve teksture spuste u GPU
  await waitForPendingTextures(8000);
  await new Promise(requestAnimationFrame);
  
  window.pendingMeshes = false;
  updateLoadingProgress("Loading textures", window.pendingTextures || 0, 0);
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
      const pos = readAccessorAsFloat(gltf, bin, prim.attributes.POSITION);
      const nor = readAccessorAsFloat(gltf, bin, prim.attributes.NORMAL);
      const uvArray =
        prim.attributes.TEXCOORD_0 !== undefined
          ? readAccessorAsFloat(gltf, bin, prim.attributes.TEXCOORD_0)
          : null;
      const tangents =
        prim.attributes.TANGENT !== undefined
          ? readAccessorAsFloat(gltf, bin, prim.attributes.TANGENT)
          : null;

      const { array: ind, glType: glIdxType } = readIndices(
        gltf,
        bin,
        prim.indices
      );

      /* interleaved POS+NOR(+UV+TANGENT)  ->  VBO / VAO */
      const vao = gl.createVertexArray();
      gl.bindVertexArray(vao);

      const vbo = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, vbo);

      const hasTangent = !!tangents;
      const stride = (3 + 3 + (uvArray ? 2 : 0) + (hasTangent ? 4 : 0)) * 4;
      const inter = new Float32Array(
        pos.length +
          nor.length +
          (uvArray ? uvArray.length : 0) +
          (hasTangent ? tangents.length : 0)
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
      gl.vertexAttribPointer(0, 3, gl.FLOAT, false, stride, offset);
      offset += 12;

      gl.enableVertexAttribArray(1);
      gl.vertexAttribPointer(1, 3, gl.FLOAT, false, stride, offset);
      offset += 12;

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
let alphaMode = "OPAQUE";
let alphaCutoff = 0.5;
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

  alphaMode = (mat.alphaMode || "OPAQUE").toUpperCase();
  alphaCutoff = mat.alphaCutoff ?? 0.5;
  isBlend = alphaMode === "BLEND" || (alphaMode === "OPAQUE" && opacity < 0.99999);
}

      const meshNodes = (gltf.nodes || [])
        .map((n, idx) => (n.mesh === m ? { node: n, idx } : null))
        .filter(Boolean);
      const instances = meshNodes.length
        ? meshNodes
        : [{ node: {}, idx: -1 }];

      /* ---------- push rezultat ---------- */
      for (const inst of instances) {
        const myNode = inst.node || {};
        const t = myNode.translation || [0, 0, 0];
        const r = myNode.rotation || [0, 0, 0, 1];
        const s = myNode.scale || [1, 1, 1];
        const tScaled = [t[0] * UNIT_SCALE, t[1] * UNIT_SCALE, t[2] * UNIT_SCALE];
        const sScaled = [s[0] * UNIT_SCALE, s[1] * UNIT_SCALE, s[2] * UNIT_SCALE];
        const modelMat = composeTRS(tScaled, r, sScaled);

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
          alphaMode,
          alphaCutoff,
          doubleSided: !!(gltf.materials?.[prim.material]?.doubleSided),
          matName: gltf.materials[prim.material]?.name || `Mat_${p}`,
          modelMat,
          trisWorld: [],
        });
      }
    }
  }

  return out;
}

function applyViewCameraPreset(cameraInstance, variant) {
  if (!cameraInstance) return false;

  const isFiniteNumber = (v) => typeof v === "number" && Number.isFinite(v);
  const directView = variant?.viewCamera || variant?.view || variant?.cameraView;
  let applied = false;

  if (directView && typeof directView === "object") {
    if (
      Array.isArray(directView.pan) &&
      directView.pan.length === 3 &&
      directView.pan.every(isFiniteNumber)
    ) {
      cameraInstance.pan = directView.pan.slice();
      cameraInstance.panTarget = directView.pan.slice();
      applied = true;
    }
    if (isFiniteNumber(directView.rx)) {
      cameraInstance.rx = directView.rx;
      cameraInstance.rxTarget = directView.rx;
      applied = true;
    }
    if (isFiniteNumber(directView.ry)) {
      cameraInstance.ry = directView.ry;
      cameraInstance.ryTarget = directView.ry;
      applied = true;
    }
    if (isFiniteNumber(directView.dist)) {
      cameraInstance.dist = directView.dist;
      cameraInstance.distTarget = directView.dist;
      applied = true;
    }
    if (isFiniteNumber(directView.fov)) {
      cameraInstance.fovOverride = directView.fov;
      applied = true;
    }
    if (applied) {
      cameraInstance.moved = true;
      return true;
    }
  }

  const parsePresetIndex = (value) => {
    const n = parseInt(value, 10);
    return Number.isFinite(n) && n > 0 ? n - 1 : null;
  };

  const variantPresetIdx = parsePresetIndex(
    variant?.viewCam ?? variant?.camPreset ?? variant?.thumbCam
  );
  const urlPresetIdx = parsePresetIndex(new URLSearchParams(window.location.search).get("cam_pos"));
  const presetIdx = variantPresetIdx !== null ? variantPresetIdx : urlPresetIdx;

  if (presetIdx === null) return false;
  if (!Array.isArray(THUMBNAIL_CAM_PRESETS)) return false;
  const preset = THUMBNAIL_CAM_PRESETS[presetIdx];
  if (!preset) return false;

  const basePan = cameraInstance.panTarget
    ? cameraInstance.panTarget.slice()
    : cameraInstance.pan
    ? cameraInstance.pan.slice()
    : [0, 0, 0];
  const baseRx = isFiniteNumber(cameraInstance.rxTarget)
    ? cameraInstance.rxTarget
    : cameraInstance.rx || 0;
  const baseRy = isFiniteNumber(cameraInstance.ryTarget)
    ? cameraInstance.ryTarget
    : cameraInstance.ry || 0;
  const baseDist = isFiniteNumber(cameraInstance.distTarget)
    ? cameraInstance.distTarget
    : cameraInstance.dist || 1;

  if (preset.panOffset) {
    cameraInstance.pan = [
      basePan[0] + (preset.panOffset[0] || 0),
      basePan[1] + (preset.panOffset[1] || 0),
      basePan[2] + (preset.panOffset[2] || 0),
    ];
    cameraInstance.panTarget = cameraInstance.pan.slice();
    applied = true;
  }
  if (isFiniteNumber(preset.rxOffset)) {
    cameraInstance.rx = baseRx + preset.rxOffset;
    cameraInstance.rxTarget = cameraInstance.rx;
    applied = true;
  }
  if (isFiniteNumber(preset.ryOffset)) {
    cameraInstance.ry = baseRy + preset.ryOffset;
    cameraInstance.ryTarget = cameraInstance.ry;
    applied = true;
  }
  if (isFiniteNumber(preset.distScale)) {
    cameraInstance.dist = baseDist * preset.distScale;
    cameraInstance.distTarget = cameraInstance.dist;
    applied = true;
  }

  if (applied) {
    cameraInstance.moved = true;
    return true;
  }

  return false;
}

function getVariantViewKey(variant) {
  if (!variant) return null;
  const directView = variant.viewCamera || variant.view || variant.cameraView;
  if (directView && typeof directView === "object") {
    const pan = Array.isArray(directView.pan) ? directView.pan.join(",") : "nopan";
    const rx = Number.isFinite(directView.rx) ? directView.rx : "norx";
    const ry = Number.isFinite(directView.ry) ? directView.ry : "nory";
    const dist = Number.isFinite(directView.dist) ? directView.dist : "nodist";
    const fov = Number.isFinite(directView.fov) ? directView.fov : "nofov";
    return `direct:${pan}:${rx}:${ry}:${dist}:${fov}`;
  }
  const parsePresetIndex = (value) => {
    const n = parseInt(value, 10);
    return Number.isFinite(n) && n > 0 ? n - 1 : null;
  };
  const variantPresetIdx = parsePresetIndex(
    variant?.viewCam ?? variant?.camPreset ?? variant?.thumbCam
  );
  if (variantPresetIdx !== null) return `preset:${variantPresetIdx}`;
  const urlPresetIdx = parsePresetIndex(new URLSearchParams(window.location.search).get("cam_pos"));
  if (urlPresetIdx !== null) return `preset:${urlPresetIdx}`;
  return null;
}

async function replaceSelectedWithURL(url, variantName, partName, { suppressLoading = false } = {}) {

    const alreadyCached = !url || preparedVariants[url];
    const shouldShowLoading = !suppressLoading && !alreadyCached;
  if (shouldShowLoading) {
    showLoading(); // 👈 prikaži SAMO ako treba da fetchuje
  }
  
  const node = nodesMeta.find((n) => n.name === partName);
  
if (node) {
  delete node.cachedBounds; // 👈 UVEK obriši, čak i ako je isti variant
}
  if (!node) {
    if (shouldShowLoading) hideLoading(); // 👈 sakrij SAMO ako si pokazao
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
        modelMat: vm.modelMat ? vm.modelMat.slice() : modelMatrices[renderIdx],
      });
      idxCounts[renderIdx] = 0;
      continue;
    }

    modelMatrices[renderIdx] = vm.modelMat
      ? vm.modelMat.slice()
      : modelMatrices[renderIdx];
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
      normalTex: vm.normalTex || window.defaultNormalTex,
      roughnessTex: vm.roughnessTex || window.whiteTex,
      alphaMode: vm.alphaMode || "OPAQUE",
      alphaCutoff: vm.alphaCutoff ?? 0.5,
      doubleSided: !!vm.doubleSided,
      modelMatrix: vm.modelMat ? vm.modelMat.slice() : modelMatrices[renderIdx],
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


  const wasSameVariant = currentParts[partName]?.name === variantName;
  currentParts[partName] = { ...currentParts[partName], name: variantName };

  if (!window.__suppressFocusCamera) {
    const cfgVariant =
      variantData ||
      (cfgGroup[partName]?.models || []).find((v) => v.name === variantName);
    const viewKey = getVariantViewKey(cfgVariant);
    const prevKey = lastAppliedCameraPreset[partName];
    const shouldApplyCamera = viewKey !== null && viewKey !== prevKey;

    if (!wasSameVariant && shouldApplyCamera) {
      focusCameraOnNode(node);
      const viewApplied = applyViewCameraPreset(camera, cfgVariant);
      if (viewApplied) {
        camera.updateView();
        sceneChanged = true;
        lastAppliedCameraPreset[partName] = viewKey;
      }
    } else if (!wasSameVariant && !shouldApplyCamera) {
      // ako je ista kamera, barem centriraj novi bounding box bez pomeranja kamere
      delete node.cachedBounds;
      ensureNodeBounds(node);
    } else if (wasSameVariant && shouldApplyCamera) {
      // ista varijanta ali drugačiji preset iz URL-a
      const viewApplied = applyViewCameraPreset(camera, cfgVariant);
      if (viewApplied) {
        camera.updateView();
        sceneChanged = true;
        lastAppliedCameraPreset[partName] = viewKey;
      }
    }
  }
  if (shouldShowLoading) {
    hideLoading(); // 👈 zameni безусловни hideLoading() sa uslovnim
  }

updateBoundsFromCurrentParts();
refreshLighting();


shadowDirty = true;
ssaoDirty = true;
sceneChanged = true;

render();
if (!window.__suppressThumbnailUI) {
  showPartInfo(variantName);
}
}

function getBoundsCorners(bounds) {
  if (!bounds?.min || !bounds?.max) return [];
  const mn = bounds.min;
  const mx = bounds.max;
  return [
    [mn[0], mn[1], mn[2]],
    [mn[0], mn[1], mx[2]],
    [mn[0], mx[1], mn[2]],
    [mn[0], mx[1], mx[2]],
    [mx[0], mn[1], mn[2]],
    [mx[0], mn[1], mx[2]],
    [mx[0], mx[1], mn[2]],
    [mx[0], mx[1], mx[2]],
  ];
}

function getCameraUpVector() {
  const target = camera.pan || [0, 0, 0];
  const dist = camera.dist || 1;
  const rx = camera.rx || 0;
  const ry = camera.ry || 0;
  const eye = [
    target[0] + dist * Math.cos(rx) * Math.sin(ry),
    target[1] + dist * Math.sin(rx),
    target[2] + dist * Math.cos(rx) * Math.cos(ry),
  ];
  const forward = v3.norm(v3.sub(target, eye));
  let right = v3.cross(forward, [0, 1, 0]);
  const len = Math.hypot(...right);
  if (len < 1e-5) right = [1, 0, 0];
  else right = v3.scale(right, 1 / len);
  const up = v3.norm(v3.cross(right, forward));
  return up;
}

function shiftCameraAlong(dir, amount) {
  if (!dir || !Number.isFinite(amount)) return;
  camera.pan[0] += dir[0] * amount;
  camera.pan[1] += dir[1] * amount;
  camera.pan[2] += dir[2] * amount;
  camera.panTarget[0] += dir[0] * amount;
  camera.panTarget[1] += dir[1] * amount;
  camera.panTarget[2] += dir[2] * amount;
}

function recenterCameraToBounds(bounds, { snap = true } = {}) {
  if (!bounds?.min || !bounds?.max) return;
  const corners = getBoundsCorners(bounds);
  if (!corners.length) return;

  const computeOffset = (panOverride = null) => {
    let restorePan = null;
    if (panOverride) {
      restorePan = camera.pan;
      camera.pan = panOverride;
    }
    const { view, proj } = camera.updateView();
    if (restorePan) {
      camera.pan = restorePan;
    }
    const viewProj = mat4mul(proj, view);
    let minY = Infinity;
    let maxY = -Infinity;

    for (const c of corners) {
      const clip = mulMat4Vec4([], viewProj, [c[0], c[1], c[2], 1]);
      if (Math.abs(clip[3]) < 1e-5) continue;
      const ndcY = clip[1] / clip[3];
      minY = Math.min(minY, ndcY);
      maxY = Math.max(maxY, ndcY);
    }

    if (!isFinite(minY) || !isFinite(maxY)) return 0;
    return (minY + maxY) * 0.5;
  };

  if (snap) {
    const baseOffset = computeOffset();
    if (!isFinite(baseOffset) || Math.abs(baseOffset) < 0.005) return;

    const upDir = getCameraUpVector();
    if (!upDir) return;

    const span = Math.max(
      bounds.max[1] - bounds.min[1],
      bounds.max[0] - bounds.min[0],
      bounds.max[2] - bounds.min[2],
      1
    );
    const sampleShift = span * 0.02;

    shiftCameraAlong(upDir, sampleShift);
    const sampleOffset = computeOffset();
    shiftCameraAlong(upDir, -sampleShift);

    const derivative = (sampleOffset - baseOffset) / sampleShift;
    if (!isFinite(derivative) || Math.abs(derivative) < 1e-4) return;

    let delta = -baseOffset / derivative;
    const maxShift = span * 0.5;
    delta = Math.max(Math.min(delta, maxShift), -maxShift);

    shiftCameraAlong(upDir, delta);
    camera.updateView();
    camera.moved = true;
    return;
  }

  const savedTarget = camera.panTarget ? camera.panTarget.slice() : [0, 0, 0];
  let workingPan = savedTarget.slice();

  const baseOffset = computeOffset(workingPan);
  if (!isFinite(baseOffset) || Math.abs(baseOffset) < 0.005) {
    camera.panTarget = workingPan.slice();
    return;
  }

  const savedPanForUp = camera.pan.slice();
  camera.pan = workingPan.slice();
  const upDir = getCameraUpVector();
  camera.pan = savedPanForUp;
  if (!upDir) return;

  const span = Math.max(
    bounds.max[1] - bounds.min[1],
    bounds.max[0] - bounds.min[0],
    bounds.max[2] - bounds.min[2],
    1
  );
  const sampleShift = span * 0.02;

  const applyShift = (amount) => {
    workingPan[0] += upDir[0] * amount;
    workingPan[1] += upDir[1] * amount;
    workingPan[2] += upDir[2] * amount;
  };

  applyShift(sampleShift);
  const sampleOffset = computeOffset(workingPan);
  applyShift(-sampleShift);

  const derivative = (sampleOffset - baseOffset) / sampleShift;
  if (!isFinite(derivative) || Math.abs(derivative) < 1e-4) {
    camera.panTarget = workingPan.slice();
    return;
  }

  let delta = -baseOffset / derivative;
  const maxShift = span * 0.5;
  delta = Math.max(Math.min(delta, maxShift), -maxShift);

  applyShift(delta);
  camera.panTarget = workingPan.slice();
  camera.moved = true;
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    const lose = canvas.__glContext?.getExtension("WEBGL_lose_context");
    lose?.loseContext();
  });
}




