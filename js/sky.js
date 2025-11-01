// /src/sky.js
import { createShaderProgram } from "./shader.js";

// ===== State =====
let skyProg = null;
let skyVAO = null;
let skyIdxCount = 0;
let skyUniforms = {}; // ⚙️ NOVO

// ===== Default sky params (bez SUN — njega prosleđuje main.js) =====
export const DEFAULT_SKY = {
  exposure: 0.8,
  zenith: [0.12, 0.25, 0.6],
  horizon: [0.8, 0.9, 1.0],
  ground: [0.012, 0.01, 0.01],
  sunsetHorizon: [1.0, 0.35, 0.1],
  sunsetZenith: [0.18, 0.23, 0.55],
  worldLocked: 1,
  model: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
  turbidity: 0.9,
  sunSizeDeg: 1.53,
  sunHaloScale: 0.25,
  horizonSoft: 0.18,
  horizonLift: -0.02,
  saturation: 1.1,
  horizonDesat: 0.05,
  horizonWarmth: 1.35,
  milkBandStrength: 0.0,
  milkBandWidth: 0.12,
  warmBandStrength: 0.1,
  warmBandWidth: 0.15,
  rayleighStrength: 1.8,
  mieStrength: 0.8,
  zenithDesat: 0.12,
  groundScatter: 0.85,
};

// ===== Helpers =====
function createSphere(latBands = 4, longBands = 4, radius = 10.0) {
  const positions = [], indices = [];
  for (let lat = 0; lat <= latBands; lat++) {
    const theta = (lat * Math.PI) / latBands;
    const sinT = Math.sin(theta), cosT = Math.cos(theta);
    for (let lon = 0; lon <= longBands; lon++) {
      const phi = (lon * 2.0 * Math.PI) / longBands;
      const sinP = Math.sin(phi), cosP = Math.cos(phi);
      positions.push(radius * cosP * sinT, radius * cosT, radius * sinP * sinT);
    }
  }
  for (let lat = 0; lat < latBands; lat++) {
    for (let lon = 0; lon < longBands; lon++) {
      const first = lat * (longBands + 1) + lon;
      const second = first + longBands + 1;
      indices.push(first, second, first + 1, second, second + 1, first + 1);
    }
  }
  return { positions: new Float32Array(positions), indices: new Uint16Array(indices) };
}

function createCubemap(gl, size, useHDR = true) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_CUBE_MAP, tex);
  const internal = useHDR ? gl.RGBA16F : gl.RGBA8;
  const type = useHDR ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE;
  for (let i = 0; i < 6; i++)
    gl.texImage2D(gl.TEXTURE_CUBE_MAP_POSITIVE_X + i, 0, internal, size, size, 0, gl.RGBA, type, null);
  gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
  gl.bindTexture(gl.TEXTURE_CUBE_MAP, null);
  return tex;
}

function lookAt(eye, center, up) {
  const [ex, ey, ez] = eye, [cx, cy, cz] = center;
  let [ux, uy, uz] = up;
  let zx = ex - cx, zy = ey - cy, zz = ez - cz;
  let rl = 1 / Math.hypot(zx, zy, zz);
  zx *= rl; zy *= rl; zz *= rl;
  let xx = uy * zz - uz * zy, xy = uz * zx - ux * zz, xz = ux * zy - uy * zx;
  rl = 1 / Math.hypot(xx, xy, xz);
  xx *= rl; xy *= rl; xz *= rl;
  let yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
  const o = new Float32Array(16);
  o[0] = xx; o[1] = yx; o[2] = zx; o[3] = 0;
  o[4] = xy; o[5] = yy; o[6] = zy; o[7] = 0;
  o[8] = xz; o[9] = yz; o[10] = zz; o[11] = 0;
  o[12] = -(xx * ex + xy * ey + xz * ez);
  o[13] = -(yx * ex + yy * ey + yz * ez);
  o[14] = -(zx * ex + zy * ey + zz * ez);
  o[15] = 1;
  return o;
}
// ===== Init =====
export function initSky(gl) {
  const sphere = createSphere(8, 8, 200.0);
  skyIdxCount = sphere.indices.length;

  skyVAO = gl.createVertexArray();
  gl.bindVertexArray(skyVAO);
  const posBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
  gl.bufferData(gl.ARRAY_BUFFER, sphere.positions, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
  const idxBuf = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idxBuf);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, sphere.indices, gl.STATIC_DRAW);
  gl.bindVertexArray(null);

  const vs = `#version 300 es
layout(location=0) in vec3 aPos;
uniform mat4 uView;
uniform mat4 uProj;
out vec3 vDir;
void main() {
  mat4 viewNoTrans = uView;
  viewNoTrans[3] = vec4(0.0, 0.0, 0.0, viewNoTrans[3].w);
  vec3 dir = (transpose(mat3(viewNoTrans)) * aPos);
  vDir = normalize(dir);
  vec4 pos = uProj * vec4(aPos, 1.0);
  pos.z = pos.w;
  gl_Position = pos;
}`;

  const fs = `#version 300 es
precision highp float;

in  vec3 vDir;
out vec4 fragColor;

// === Sunce & atmosfera ===
uniform float uTime;
uniform float uCameraHeight;
uniform int   uUseTonemap;

uniform vec3  uSunDir;
uniform vec3  uSunColor;
uniform float uSunIntensity;

uniform float uExposure;
uniform float uSunSizeDeg, uSunHaloScale;
uniform float uHorizonSoft, uHorizonLift;
uniform float uRayleighStrength, uMieStrength;
uniform float uGroundScatter, uTurbidity, uSaturation;
uniform float uHorizonWarmth, uZenithDesat, uHorizonDesat;

uniform float uCloudHeight, uCloudThickness, uCloudSpeed;
uniform float uMilkBandStrength, uMilkBandWidth, uWarmBandStrength, uWarmBandWidth;

// ---------- Helper noise funkcije ----------
float hash(vec3 p){
    return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453123);
}
float noise3d(vec3 p){
    vec3 i = floor(p);
    vec3 f = fract(p);
    f = f*f*(3.0-2.0*f);
    float n = mix(
        mix(mix(hash(i+vec3(0,0,0)), hash(i+vec3(1,0,0)), f.x),
            mix(hash(i+vec3(0,1,0)), hash(i+vec3(1,1,0)), f.x), f.y),
        mix(mix(hash(i+vec3(0,0,1)), hash(i+vec3(1,0,1)), f.x),
            mix(hash(i+vec3(0,1,1)), hash(i+vec3(1,1,1)), f.x), f.y), f.z);
    return n;
}

// ---------- Ton-mapping & saturacija ----------
vec3 ACESFilm(vec3 x){
    const float a=2.51, b=0.03, c=2.43, d=0.59, e=0.14;
    return clamp((x*(a*x+b))/(x*(c*x+d)+e),0.0,1.0);
}
vec3 applySaturation(vec3 c, float s){
    float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
    return mix(vec3(l), c, s);
}

// ========================= MAIN =========================
void main(){
    // wavelength-based Rayleigh tint
    vec3 waveLambda = vec3(680e-9, 550e-9, 440e-9); // R, G, B u metrima
    vec3 rayleighColor = pow(waveLambda, vec3(-4.0));
    rayleighColor /= max(max(rayleighColor.r, rayleighColor.g), rayleighColor.b);

    vec3  dir   = normalize(vDir);
    vec3  sunV  = normalize(uSunDir);
    float sunAlt = clamp(sunV.y, -1.0, 1.0);

    // === 1. Dynamic sky colors by sunAlt ===

    // DNEVNO NEBO (dan, zenit)
    vec3 dayZenith   = vec3(0.12, 0.25, 0.60);
    vec3 dayHorizon  = vec3(0.80, 0.90, 1.00);

    // SUNSET (toplo, sunset, ljubičasto)
    vec3 sunsetZenith   = vec3(0.18, 0.23, 0.55);   // plavo-ljubičasto
    vec3 sunsetHorizon  = vec3(1.00, 0.35, 0.10);   // narandžasto

    // NOĆ (deep blue)
    vec3 nightZenith   = vec3(0.01, 0.02, 0.10);
    vec3 nightHorizon  = vec3(0.05, 0.06, 0.13);

    // Koliko je sunset aktivan (0 dan, 1 sunset)
    float sunsetAmt = smoothstep(0.0, 0.15, clamp(0.2 - sunAlt, 0.0, 0.2));
    // Koliko je noć aktivna (0 dan, 1 noć)
    float nightAmt = clamp(-sunAlt * 10.0, 0.0, 1.0);

    // Gradijenti po visini
    float t   = clamp(dir.y*0.5 + 0.5 + uHorizonLift, 0.0, 1.0);
    float h   = 1.0 - t;
    float hS  = smoothstep(0.0, 1.0, pow(h, 1.0 + uHorizonSoft));

    // Pravi blend
    vec3 curZenith   = mix(dayZenith,   sunsetZenith,  sunsetAmt);
    vec3 curHorizon  = mix(dayHorizon,  sunsetHorizon, sunsetAmt);

    // Night blend
    curZenith  = mix(curZenith,  nightZenith,  nightAmt);
    curHorizon = mix(curHorizon, nightHorizon, nightAmt);

    vec3 base = mix(curZenith, curHorizon, hS);
    


    // === 2. Procedural clouds, halo, sunset boost ===
    // (ostaje kao ranije – možeš da ga pojačaš po želji)

    float tTop    = (uCloudHeight + uCloudThickness - uCameraHeight) / dir.y;
    float tBottom = (uCloudHeight - uCloudThickness - uCameraHeight) / dir.y;
    float tEnter  = max(min(tTop, tBottom), 0.0);
    float tExit   = max(max(tTop, tBottom), 0.0);
    float segLen  = max(tExit - tEnter, 0.0);
    float cloudAlpha = 0.0;
    
// === volumetric-like clouds with layered depth ===
if (segLen > 0.0) {
    float layers = 1.0;
    float totalDensity = 0.0;
    vec3 colorAcc = vec3(0.0);
    vec3 ray = dir * (segLen / layers);

    for (float i = 0.0; i < layers; i += 1.0) {
        vec3 samplePos = dir * (tEnter + segLen * (i / layers));
        samplePos.xz += uTime * vec2(uCloudSpeed, uCloudSpeed * 0.7);

        // parallax – gornji slojevi se pomeraju brže
        samplePos.xz += i * 10.0;

        float cl = 0.0, amp = 1.0;
        vec3 p = samplePos * 0.0015;
        for (int o = 0; o < 4; ++o) {
            cl += noise3d(p) * amp;
            p *= 2.2;
            amp *= 0.55;
        }
        cl /= 1.6;

        float density = smoothstep(0.4, 0.8, cl);
        float heightMix = i / layers;

// --- osnovna senka i belina ---
vec3 lightDir = normalize(uSunDir);
float shade = max(dot(lightDir, normalize(vec3(0.0,1.0,0.0))), 0.0);
vec3 cloudCol = mix(vec3(0.35,0.36,0.4), vec3(1.0), shade);

// --- tamniji centar oblaka, svetlije ivice ---
float core = smoothstep(0.45, 0.9, cl);        // 0 = ivice, 1 = centar
float edge = 1.0 - core;                       // svetle ivice
cloudCol = mix(cloudCol * 0.6, cloudCol, edge); // centar tamniji, ivice belje

// --- lagani highlight prema suncu ---
float sunFacing = pow(max(dot(lightDir, vec3(0.0,1.0,0.0)), 0.0), 8.0);
cloudCol += vec3(1.0, 0.95, 0.9) * sunFacing * 0.25;

// --- visinska nijansa ---
cloudCol = mix(cloudCol, vec3(0.9, 0.9, 0.95), 1.0 - heightMix);


        totalDensity += density * (1.0 - totalDensity);
        colorAcc += cloudCol * density * (1.0 - totalDensity);
    }

    float fadeHor = smoothstep(0.05, 0.8, dir.y * 15.5);
    float fadeZen = 1.0 - smoothstep(0.0, 0.9, dir.y);
    totalDensity *= fadeHor * fadeZen;

    base = mix(base, colorAcc, clamp(totalDensity * 0.3, 0.0, 1.0));
}


    // --- sunset horizon warmth (neka ostane)
    float warm = pow(clamp(1.0 - sunAlt, 0.0, 1.0), 2.0) * hS * uHorizonWarmth;
    vec3 sunsetWarm = vec3(1.0, 0.55, 0.25);
    base = mix(base, sunsetWarm, clamp(warm, 0.0, 0.65));

    // --- Ostali efekti ---
    float milkBand = exp(-pow(abs(dir.y - 1.0)/max(uMilkBandWidth,0.001), 2.0));
    base += uMilkBandStrength * milkBand * vec3(0.85, 0.92, 1.0);

    float warmBand = exp(-pow(abs(dir.y)/max(uWarmBandWidth,0.001), 2.0));
    base += uWarmBandStrength * warmBand * vec3(1.0, 0.58, 0.15);

    base  = applySaturation(base, uSaturation);
    base  = mix(base, applySaturation(base, 0.9), uZenithDesat);
    base *= mix(0.7, 1.0, uRayleighStrength);
    base = mix(base, vec3(0.035, 0.03, 0.03), clamp(uTurbidity*(1.0-hS), 0.0, 1.0));



    // === 3. Sun disk & Mie halo ===
    float cosToSun = dot(dir, sunV);
    float sunSize  = radians(uSunSizeDeg);
    float ang      = acos(cosToSun);
    float disk = exp(-pow(ang/(sunSize*0.9), 2.0));

  float limb = exp(-pow(ang/(sunSize*2.2), 2.0)); // uže, izraženije
  vec3  sunLight = uSunColor * (disk*uSunIntensity + limb*(uSunIntensity*0.18));


    float g = 0.8;
    float mie = (1.0 - g*g) / pow(1.0 + g*g - 2.0*g*cosToSun, 1.5);
    mie *= 0.015 * (1.0 + 2.0*(1.0 - sunAlt)) * uSunHaloScale * uMieStrength;
    float halo = exp(-pow(ang / (sunSize * 6.0), 1.3));
  sunLight += uSunColor * halo * uSunIntensity * 0.05;

    // === 4. Ground & bounce ===
    float skyMask    = smoothstep(-0.04, 0.02, dir.y);
    float groundMask = 1.0 - skyMask;

    vec3 groundBase   = vec3(0.014,0.02,0.035) * groundMask * uSunIntensity;
    float below       = smoothstep(0.0, 0.25, max(0.0, -dir.y));
  

    // === 5. Finalna kompozicija ===
    vec3 color = (base * skyMask * uSunIntensity) +
                 (sunLight * skyMask) +
                 groundBase;

    // Fade celo nebo kad je noć (noć je nightAmt)
    color = mix(color, nightZenith, nightAmt*0.95);

vec3 mapped = color * uExposure;

if (uUseTonemap == 1) {
    mapped = ACESFilm(mapped);
    mapped = pow(mapped, vec3(1.0/2.2));
} else {
    mapped = clamp(mapped, 0.0, 1.0);
}

fragColor = vec4(mapped, 1.0);

}

`;

  skyProg = createShaderProgram(gl, vs, fs);

  // ⚙️ NOVO: keš uniform lokacija
  const names = [
    "uView","uProj","uSunDir","uSunColor","uSunIntensity","uCameraHeight",
    "uCloudHeight","uCloudThickness","uCloudSpeed","uExposure","uSunSizeDeg",
    "uSunHaloScale","uHorizonSoft","uHorizonLift","uHorizonDesat","uTurbidity",
    "uSaturation","uMilkBandStrength","uMilkBandWidth","uWarmBandStrength",
    "uWarmBandWidth","uHorizonWarmth","uRayleighStrength","uMieStrength",
    "uZenithDesat","uGroundScatter","uWorldLocked","uModel","uUseTonemap","uTime"
  ];
  for (const n of names) skyUniforms[n] = gl.getUniformLocation(skyProg, n);


  
}


// ===== Uniforms =====
function applySkyUniforms(gl, view, proj, sunDir, opts) {
  // koristi referencu umesto novog objekta svaku frame-u
  const o = opts || DEFAULT_SKY;

  gl.useProgram(skyProg);

  // matrice
  gl.uniformMatrix4fv(skyUniforms.uView, false, view);
  gl.uniformMatrix4fv(skyUniforms.uProj, false, proj);

  // sunce
  gl.uniform3fv(skyUniforms.uSunDir, sunDir || [0, 1, 0]);
  gl.uniform3fv(skyUniforms.uSunColor, o.sunColor || [1, 1, 1]);
  gl.uniform1f(skyUniforms.uSunIntensity, o.sunIntensity ?? 1.0);

  // konstante koje se obično ne menjaju, ali ostaju tu da engine ne pukne
  gl.uniform1f(skyUniforms.uCameraHeight, 20.0);
  gl.uniform1f(skyUniforms.uCloudHeight, 180.0);
  gl.uniform1f(skyUniforms.uCloudThickness, 3.0);
  gl.uniform1f(skyUniforms.uCloudSpeed, 0.0);

  // parametri neba
  gl.uniform1f(skyUniforms.uExposure, o.exposure);
  gl.uniform1f(skyUniforms.uSunSizeDeg, o.sunSizeDeg);
  gl.uniform1f(skyUniforms.uSunHaloScale, o.sunHaloScale);
  gl.uniform1f(skyUniforms.uHorizonSoft, o.horizonSoft);
  gl.uniform1f(skyUniforms.uHorizonLift, o.horizonLift);
  gl.uniform1f(skyUniforms.uHorizonDesat, o.horizonDesat);
  gl.uniform1f(skyUniforms.uTurbidity, o.turbidity);
  gl.uniform1f(skyUniforms.uSaturation, o.saturation);
  gl.uniform1f(skyUniforms.uMilkBandStrength, o.milkBandStrength);
  gl.uniform1f(skyUniforms.uMilkBandWidth, o.milkBandWidth);
  gl.uniform1f(skyUniforms.uWarmBandStrength, o.warmBandStrength);
  gl.uniform1f(skyUniforms.uWarmBandWidth, o.warmBandWidth);
  gl.uniform1f(skyUniforms.uHorizonWarmth, o.horizonWarmth);
  gl.uniform1f(skyUniforms.uRayleighStrength, o.rayleighStrength);
  gl.uniform1f(skyUniforms.uMieStrength, o.mieStrength);
  gl.uniform1f(skyUniforms.uZenithDesat, o.zenithDesat);
  gl.uniform1f(skyUniforms.uGroundScatter, o.groundScatter);

  // world i model matrica
  gl.uniform1i(skyUniforms.uWorldLocked, o.worldLocked ? 1 : 0);
  gl.uniformMatrix4fv(skyUniforms.uModel, false, o.model);

  // tonemap i vreme
  gl.uniform1i(skyUniforms.uUseTonemap, o.useTonemap ? 1 : 0);
  gl.uniform1f(skyUniforms.uTime, o.uTime ?? 0.0);
}

// ===== Render =====
export function drawSkyGeneric(gl, view, proj, sunDir, opts) {
  gl.disable(gl.CULL_FACE);
  gl.disable(gl.DEPTH_TEST);
  gl.depthMask(false);

  // ✅ dodaj:
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

  applySkyUniforms(gl, view, proj, sunDir, opts);
  gl.frontFace(gl.CCW);
  gl.bindVertexArray(skyVAO);
  gl.drawElements(gl.TRIANGLES, skyIdxCount, gl.UNSIGNED_SHORT, 0);
  gl.bindVertexArray(null);

  // ✅ posle crtanja, vrati normalno stanje
  gl.disable(gl.BLEND);
  gl.depthMask(true);
  gl.enable(gl.DEPTH_TEST);
  gl.enable(gl.CULL_FACE);
}

export function drawSky(gl, framebuffer, view, proj, sunDir, opts) {
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
  drawSkyGeneric(gl, view, proj, sunDir, { ...opts });
}

export function bakeSkyToCubemap(
  gl,
  size = 512,
  sunDir = [0, 1, 0],
  opts = {}
) {
    // Resetuj stare teksture iz prethodnog cube rendera
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.bindTexture(gl.TEXTURE_2D, null);
  gl.bindTexture(gl.TEXTURE_CUBE_MAP, null);
  // ✅ mora pre svega
  gl.getExtension("EXT_color_buffer_float");
  gl.getExtension("OES_texture_float_linear");

  const cubeTex = createCubemap(gl, size, true);
  const fbo = gl.createFramebuffer();
  const rbo = gl.createRenderbuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.bindRenderbuffer(gl.RENDERBUFFER, rbo);
  gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, size, size);
  gl.framebufferRenderbuffer(
    gl.FRAMEBUFFER,
    gl.DEPTH_ATTACHMENT,
    gl.RENDERBUFFER,
    rbo
  );

  const proj = (function (fovyDeg, aspect, near, far) {
    const f = 1.0 / Math.tan((fovyDeg * Math.PI) / 360.0);
    const nf = 1.0 / (near - far);
    const out = new Float32Array(16);
    out[0] = f / aspect;
    out[5] = f;
    out[10] = (far + near) * nf;
    out[11] = -1;
    out[14] = 2 * far * near * nf;
    out[15] = 1;
    return out;
  })(90, 1, 0.1, 2000);

  const views = [
    lookAt([0, 0, 0], [1, 0, 0], [0, -1, 0]),
    lookAt([0, 0, 0], [-1, 0, 0], [0, -1, 0]),
    lookAt([0, 0, 0], [0, 1, 0], [0, 0, 1]),
    lookAt([0, 0, 0], [0, -1, 0], [0, 0, -1]),
    lookAt([0, 0, 0], [0, 0, 1], [0, -1, 0]),
    lookAt([0, 0, 0], [0, 0, -1], [0, -1, 0]),
  ];

  gl.viewport(0, 0, size, size);
  gl.bindTexture(gl.TEXTURE_CUBE_MAP, cubeTex);

  for (let face = 0; face < 6; face++) {
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_CUBE_MAP_POSITIVE_X + face,
      cubeTex,
      0
    );


    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    drawSkyGeneric(gl, views[face], proj, sunDir, {
      ...opts,
      worldLocked: 0,
      useTonemap: false,
    });
  }

  gl.generateMipmap(gl.TEXTURE_CUBE_MAP);
  gl.texParameteri(
    gl.TEXTURE_CUBE_MAP,
    gl.TEXTURE_MIN_FILTER,
    gl.LINEAR_MIPMAP_LINEAR
  );
  gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

  gl.bindTexture(gl.TEXTURE_CUBE_MAP, null);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.bindRenderbuffer(gl.RENDERBUFFER, null);
  gl.deleteRenderbuffer(rbo);
  gl.deleteFramebuffer(fbo);

  return cubeTex;
}
