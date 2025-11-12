// /src/sky.js
import { createShaderProgram } from "./shader.js";

// ===== State =====
let skyProg = null;
let skyVAO = null;
let skyIdxCount = 0;
let skyUniforms = {}; // ⚙️ NOVO

// ===== Default sky params (bez SUN — njega prosleđuje main.js) =====
export const DEFAULT_SKY = {
  zenith: [0.08, 0.16, 0.35],
  horizon: [0.65, 0.75, 0.85],
  ground: [0.012, 0.01, 0.01],
  sunsetHorizon: [1.05, 0.42, 0.16],
  sunsetZenith: [0.2, 0.26, 0.6],
  worldLocked: 1,
  model: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
  sunColor: [1.0, 0.97, 0.94],
  sunIntensity: 1.0,
  turbidity: 2.2,
  sunSizeDeg: 0.53,
  sunHaloScale: 0.35,
  horizonSoft: 0.45,
  horizonLift: -0.03,
  saturation: 1.05,
  horizonDesat: 0.08,
  horizonWarmth: 1.1,
  milkBandStrength: 0.02,
  milkBandWidth: 0.12,
  warmBandStrength: 0.08,
  warmBandWidth: 0.2,
  rayleighStrength: 1.0,
  mieStrength: 1.0,
  zenithDesat: 0.05,
  groundScatter: 0.6,
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
uniform int uHideSun;
uniform float uGlobalExposure;
uniform float uSunSizeDeg, uSunHaloScale;
uniform float uHorizonSoft, uHorizonLift;
uniform float uRayleighStrength, uMieStrength;
uniform float uGroundScatter, uTurbidity, uSaturation;
uniform float uHorizonWarmth, uZenithDesat, uHorizonDesat;

uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uGround;
uniform vec3 uSunsetZenith;
uniform vec3 uSunsetHorizon;

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

const float PI = 3.14159265359;
const mat3 XYZ_TO_RGB = mat3(
    3.2406, -1.5372, -0.4986,
   -0.9689,  1.8758,  0.0415,
    0.0557, -0.2040,  1.0570
);

float saturate(float x){
    return clamp(x, 0.0, 1.0);
}

float perezDistribution(float A, float B, float C, float D, float E, float theta, float gamma){
    float cosTheta = cos(theta);
    float numerator = 1.0 + A * exp(B / max(cosTheta, 0.01));
    float component = 1.0 + C * exp(D * gamma) + E * cos(gamma) * cos(gamma);
    return numerator * component;
}

vec3 xyYToRGB(float x, float y, float Y){
    float denom = max(y, 1e-4);
    float X = (Y / denom) * x;
    float Z = (Y / denom) * (1.0 - x - y);
    vec3 XYZ = vec3(X, Y, Z);
    return XYZ_TO_RGB * XYZ;
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
    vec3 dir = normalize(vDir);
    vec3 sunV = normalize(uSunDir);
    float sunAlt = clamp(sunV.y, -1.0, 1.0);

    float tCoord = clamp(dir.y * 0.5 + 0.5 + uHorizonLift, 0.0, 1.0);
    float h = 1.0 - tCoord;
    float hS = smoothstep(0.0, 1.0, pow(h, 1.0 + uHorizonSoft));

    float theta = acos(clamp(dir.y, -1.0, 1.0));
    float thetaS = acos(clamp(sunV.y, -1.0, 1.0));
    float gamma = acos(clamp(dot(dir, sunV), -1.0, 1.0));
    float T = max(uTurbidity, 1.0);

    float chi = (4.0 / 9.0 - T / 120.0) * (PI - 2.0 * thetaS);
    float tanChi = tan(chi);
    tanChi = clamp(tanChi, -1024.0, 1024.0);
    float Yz = (4.0453 * T - 4.9710) * tanChi - 0.2155 * T + 2.4192;
    Yz = max(Yz, 0.0);

    float theta2 = thetaS * thetaS;
    float theta3 = theta2 * thetaS;
    float T2 = T * T;

    float xz = T2 * (0.00165 * theta3 - 0.00374 * theta2 + 0.00208 * thetaS)
             + T  * (-0.02902 * theta3 + 0.06377 * theta2 - 0.03202 * thetaS + 0.00394)
             + (0.11693 * theta3 - 0.21196 * theta2 + 0.06052 * thetaS + 0.25885);
    float yz = T2 * (0.00275 * theta3 - 0.00610 * theta2 + 0.00316 * thetaS)
             + T  * (-0.04214 * theta3 + 0.08970 * theta2 - 0.04153 * thetaS + 0.00515)
             + (0.15346 * theta3 - 0.26756 * theta2 + 0.06670 * thetaS + 0.26688);

    float A_Y = 0.1787 * T - 1.4630;
    float B_Y = -0.3554 * T + 0.4275;
    float C_Y = -0.0227 * T + 5.3251;
    float D_Y = 0.1206 * T - 2.5771;
    float E_Y = -0.0669 * T + 0.3703;

    float A_x = -0.0193 * T - 0.2592;
    float B_x = -0.0665 * T + 0.0008;
    float C_x = -0.0004 * T + 0.2125;
    float D_x = -0.0641 * T - 0.8989;
    float E_x = -0.0033 * T + 0.0452;

    float A_yc = -0.0167 * T - 0.2608;
    float B_yc = -0.0950 * T + 0.0092;
    float C_yc = -0.0079 * T + 0.2102;
    float D_yc = -0.0441 * T - 1.6537;
    float E_yc = -0.0109 * T + 0.0529;

    float perezY = perezDistribution(A_Y, B_Y, C_Y, D_Y, E_Y, theta, gamma);
    float perezYSun = perezDistribution(A_Y, B_Y, C_Y, D_Y, E_Y, 0.0, thetaS);
    float Y = Yz * perezY / max(perezYSun, 1e-3);

    float perezX = perezDistribution(A_x, B_x, C_x, D_x, E_x, theta, gamma);
    float perezXSun = perezDistribution(A_x, B_x, C_x, D_x, E_x, 0.0, thetaS);
    float x = xz * perezX / max(perezXSun, 1e-3);

    float perezYc = perezDistribution(A_yc, B_yc, C_yc, D_yc, E_yc, theta, gamma);
    float perezYcSun = perezDistribution(A_yc, B_yc, C_yc, D_yc, E_yc, 0.0, thetaS);
    float y = yz * perezYc / max(perezYcSun, 1e-3);

    vec3 base = max(xyYToRGB(x, y, max(Y, 0.0)), vec3(0.0));
    base *= uRayleighStrength;

    float sunsetAmt = smoothstep(0.0, 0.15, clamp(0.2 - sunAlt, 0.0, 0.2));
    vec3 sunsetTint = mix(vec3(1.0), vec3(1.0, 0.6, 0.25), sunsetAmt);
    base *= mix(vec3(1.0), sunsetTint, 0.35);

    vec3 nightZenith   = mix(uGround, uZenith, 0.2);
    vec3 nightHorizon  = mix(uGround, uHorizon, 0.3);
    vec3 artisticBlend = mix(uZenith, uHorizon, hS);
    vec3 manualSunset  = mix(uSunsetZenith, uSunsetHorizon, hS);
    float dayFactor = saturate(sunAlt * 0.6 + 0.5);
    base = mix(base, artisticBlend, 0.08 * dayFactor);
    base = mix(base, manualSunset, sunsetAmt * 0.12);

    float horizonScatter = pow(clamp(1.0 - dir.y, 0.0, 1.0), 1.5);
    base = mix(base, base + uGround * 0.3, horizonScatter * uGroundScatter);
    base = applySaturation(base, uSaturation);
    vec3 horizonDesat = mix(base, applySaturation(base, 0.5), uHorizonDesat);
    base = mix(base, horizonDesat, pow(1.0 - tCoord, 1.4));
    base = mix(base, applySaturation(base, 0.9), uZenithDesat);
    base = mix(base, vec3(0.035, 0.03, 0.03), clamp(uTurbidity * (1.0 - tCoord), 0.0, 1.0));

    float nightAmt = clamp(-sunAlt * 10.0, 0.0, 1.0);

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
      vec3 cloudCol = mix(vec3(0.5, 0.52, 0.55), vec3(0.95), shade * 0.8);

      // --- tamniji centar oblaka, svetlije ivice ---
      float core = smoothstep(0.45, 0.9, cl);        // 0 = ivice, 1 = centar
      float edge = 1.0 - core;                       // svetle ivice
      cloudCol = mix(cloudCol * 0.6, cloudCol, edge); // centar tamniji, ivice belje

      // --- lagani highlight prema suncu ---
      float sunFacing = pow(max(dot(lightDir, vec3(0.0,1.0,0.0)), 0.0), 8.0);
      cloudCol += vec3(1.0, 0.95, 0.9) * sunFacing * 0.25;

      // --- visinska nijansa ---
      cloudCol = mix(cloudCol, vec3(0.9, 0.9, 0.95), 1.0 - heightMix);
      cloudCol *= mix(vec3(0.8), uSunColor * 0.95, pow(max(sunAlt, 0.0), 0.5));

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

    // === 3. Sun disk & Mie halo ===
    float cosToSun = dot(dir, sunV);
    float sunSize  = radians(uSunSizeDeg);
    float ang      = acos(cosToSun);
    float disk = exp(-pow(ang/(sunSize*0.9), 2.0));
    float limb = exp(-pow(ang/(sunSize*2.2), 2.0)); // uže, izraženije
    vec3  sunLight = uSunColor * (disk*uSunIntensity + limb*(uSunIntensity*0.18));

    // ako je uHideSun == 1, izbaci disk i halo
    if (bool(uHideSun)) {
        sunLight = vec3(0.0);
    }

    float g = 0.8;
    float mie = (1.0 - g*g) / pow(1.0 + g*g - 2.0*g*cosToSun, 1.5);
    mie *= 0.025 * (1.0 + 3.0*(1.0 - sunAlt)) * uSunHaloScale * uMieStrength;
    float halo = exp(-pow(ang / (sunSize * 6.0), 1.3));
    sunLight += uSunColor * mie * uSunIntensity * 0.02;
    sunLight += uSunColor * halo * uSunIntensity * 0.05;

    // === 4. Ground & bounce ===
    float skyMask    = smoothstep(-0.04, 0.02, dir.y);
    float groundMask = 1.0 - skyMask;

    vec3 groundBase   = vec3(0.01,0.01,0.01) * groundMask * uSunIntensity;
    float below       = smoothstep(0.0, 0.25, max(0.0, -dir.y));

    // === 5. Finalna kompozicija ===
    // više HDR energije za sun disk i scatter
    vec3 color = (base * skyMask * uSunIntensity) +
                (sunLight * skyMask * 1.0) +   // 15x jače sunce
                groundBase;

    // Fade celo nebo kad je noć (noć je nightAmt)
    vec3 nightColor = mix(nightZenith, nightHorizon, hS) * 0.5;
    color = mix(color, nightColor, nightAmt*0.85);

    // linear HDR output (ACES tonemap ide kasnije u glavnom passu)
    vec3 hdrColor = color * uGlobalExposure;
    fragColor = vec4(hdrColor, 1.0);
}

`;

  skyProg = createShaderProgram(gl, vs, fs);

  // ⚙️ NOVO: keš uniform lokacija
  const names = [
    "uView","uProj","uSunDir","uSunColor","uSunIntensity","uHideSun","uCameraHeight",
    "uCloudHeight","uCloudThickness","uCloudSpeed","uGlobalExposure","uSunSizeDeg",
    "uSunHaloScale","uHorizonSoft","uHorizonLift","uHorizonDesat","uTurbidity",
    "uSaturation","uMilkBandStrength","uMilkBandWidth","uWarmBandStrength",
    "uWarmBandWidth","uHorizonWarmth","uRayleighStrength","uMieStrength",
    "uZenithDesat","uGroundScatter","uWorldLocked","uModel","uUseTonemap","uTime","uZenith","uHorizon","uGround","uSunsetZenith","uSunsetHorizon",
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
  gl.uniform1i(skyUniforms.uHideSun, o.hideSun ? 1 : 0);
  // konstante koje se obično ne menjaju, ali ostaju tu da engine ne pukne
  gl.uniform1f(skyUniforms.uCameraHeight, 20.0);
  gl.uniform1f(skyUniforms.uCloudHeight, 180.0);
  gl.uniform1f(skyUniforms.uCloudThickness, 3.0);
  gl.uniform1f(skyUniforms.uCloudSpeed, 0.0);

  // parametri neba
gl.uniform1f(skyUniforms.uGlobalExposure, 
  (o.globalExposure ?? window.globalExposure ?? 1.0)
);
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
  gl.uniform3fv(skyUniforms.uZenith, o.zenith);
gl.uniform3fv(skyUniforms.uHorizon, o.horizon);
gl.uniform3fv(skyUniforms.uGround, o.ground);
gl.uniform3fv(skyUniforms.uSunsetZenith, o.sunsetZenith);
gl.uniform3fv(skyUniforms.uSunsetHorizon, o.sunsetHorizon);

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
// === PREINTEGRISANI IRRADIANCE MAP ===
export function bakeIrradianceFromSky(gl, envCube, size = 32) {
  const vs = `#version 300 es
  layout(location=0) in vec2 aPos;
  out vec3 vDir;
  uniform mat4 uView;
  uniform mat4 uProj;
  void main(){
      vDir = (mat3(uView) * normalize(vec3(aPos, 1.0)));
      gl_Position = vec4(aPos, 0.0, 1.0);
  }`;

  const fs = `#version 300 es
precision highp float;
in vec3 vDir;
out vec4 fragColor;
uniform samplerCube uEnvMap;
const float PI = 3.14159265359;

void main() {
    vec3 N = normalize(vDir);
    vec3 up = vec3(0.0, 1.0, 0.0);
    vec3 right = normalize(cross(up, N));
    up = cross(N, right);

    vec3 irradiance = vec3(0.0);
    const float sampleDelta = 0.1;     // manja vrednost = glađa, tačnija
    float nrSamples = 0.0;

    for (float phi = 0.0; phi < 2.0 * PI; phi += sampleDelta) {
        for (float theta = 0.0; theta < 0.5 * PI; theta += sampleDelta) {
            vec3 tangentSample = vec3(
                sin(theta) * cos(phi),
                cos(theta),
                sin(theta) * sin(phi)
            );
            vec3 sampleVec =
                tangentSample.x * right +
                tangentSample.y * N +
                tangentSample.z * up;

            irradiance += texture(uEnvMap, sampleVec).rgb *
                          cos(theta) * sin(theta);
            nrSamples++;
        }
    }

    // normalize the accumulated energy (Lambert integral)
    irradiance = PI * irradiance * (1.0 / nrSamples);
    fragColor = vec4(irradiance, 1.0);
}`;

  const prog = createShaderProgram(gl, vs, fs);
  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);

  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);

  const cube = createCubemap(gl, size, true);
  const fbo = gl.createFramebuffer();
  const rbo = gl.createRenderbuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.bindRenderbuffer(gl.RENDERBUFFER, rbo);
  gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, size, size);
  gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, rbo);

  const proj = (function(fovyDeg, aspect, near, far){
    const f = 1.0 / Math.tan((fovyDeg * Math.PI) / 360.0);
    const nf = 1.0 / (near - far);
    const m = new Float32Array(16);
    m[0]=f/aspect; m[5]=f; m[10]=(far+near)*nf; m[11]=-1; m[14]=2*far*near*nf; m[15]=1;
    return m;
  })(90,1,0.1,2000);

  const views = [
    lookAt([0,0,0],[1,0,0],[0,-1,0]),
    lookAt([0,0,0],[-1,0,0],[0,-1,0]),
    lookAt([0,0,0],[0,1,0],[0,0,1]),
    lookAt([0,0,0],[0,-1,0],[0,0,-1]),
    lookAt([0,0,0],[0,0,1],[0,-1,0]),
    lookAt([0,0,0],[0,0,-1],[0,-1,0]),
  ];

  gl.useProgram(prog);
  const uView = gl.getUniformLocation(prog, "uView");
  const uProj = gl.getUniformLocation(prog, "uProj");
  const uEnvMap = gl.getUniformLocation(prog, "uEnvMap");
  gl.uniform1i(uEnvMap, 0);

  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_CUBE_MAP, envCube);

  gl.viewport(0, 0, size, size);
  gl.bindVertexArray(vao);

  for (let face = 0; face < 6; face++) {
    gl.uniformMatrix4fv(uView, false, views[face]);
    gl.uniformMatrix4fv(uProj, false, proj);

    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_CUBE_MAP_POSITIVE_X + face,
      cube,
      0
    );

    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  gl.bindTexture(gl.TEXTURE_CUBE_MAP, cube);
  gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.bindTexture(gl.TEXTURE_CUBE_MAP, null);

  gl.bindVertexArray(null);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.deleteFramebuffer(fbo);
  gl.deleteRenderbuffer(rbo);

  return cube;
}
