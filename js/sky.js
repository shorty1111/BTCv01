// /src/sky.js
import { createShaderProgram } from "./shader.js";

// ===== State =====
let skyProg = null;
let skyVAO = null;
let skyIdxCount = 0;

// ===== Default sky params (bez SUN — njega prosleđuje main.js) =====
export const DEFAULT_SKY = {
  exposure: 1.0,

  // Nebo: čisto letnje nebo (Unreal Engine style)
  zenith: [0.12, 0.25, 0.6], // sky blue
  horizon: [0.8, 0.9, 1.0], // very pale blue
  ground: [0.012, 0.01, 0.01], // neutral gray-brown
  sunsetHorizon: [1.0, 0.35, 0.1], // jaka narandžasta
  sunsetZenith: [0.18, 0.23, 0.55], // dublje plavo, manje crvene (više “večernje plavo”)

  worldLocked: 1,
  model: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],

  turbidity: 0.9, // manji brojevi = čisto nebo, bez “mutnog” horizonta!
  sunSizeDeg: 0.9, // može i 0.53
  sunHaloScale: 0.25,
  horizonSoft: 0.18,
  horizonLift: 0.0,
  saturation: 1.5, // malo ispod 1.0
  horizonDesat: 0.05,
  horizonWarmth: 1.35,

  // Bandovi
  milkBandStrength: 0.0, // isključi!
  milkBandWidth: 0.12,
  warmBandStrength: 0.1, // isključi!
  warmBandWidth: 0.15,

  // Atmosfera
  rayleighStrength: 0.5,
  mieStrength: 0.8,
  zenithDesat: 0.12,
  groundScatter: 0.85,
};

// ===== Helpers =====
function createSphere(latBands = 8, longBands = 8, radius = 10.0) {
  const positions = [],
    indices = [];
  for (let lat = 0; lat <= latBands; lat++) {
    const theta = (lat * Math.PI) / latBands;
    const sinT = Math.sin(theta),
      cosT = Math.cos(theta);
    for (let lon = 0; lon <= longBands; lon++) {
      const phi = (lon * 2.0 * Math.PI) / longBands;
      const sinP = Math.sin(phi),
        cosP = Math.cos(phi);
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
  return {
    positions: new Float32Array(positions),
    indices: new Uint16Array(indices),
  };
}

function createCubemap(gl, size, useHDR = true) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_CUBE_MAP, tex);

  // 👉 half-float umesto 8-bit
  const internal = useHDR ? gl.RGBA16F : gl.RGBA8;
  const type = useHDR ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE;

  for (let i = 0; i < 6; i++)
    gl.texImage2D(
      gl.TEXTURE_CUBE_MAP_POSITIVE_X + i,
      0,
      internal,
      size,
      size,
      0,
      gl.RGBA,
      type,
      null
    );

  gl.texParameteri(
    gl.TEXTURE_CUBE_MAP,
    gl.TEXTURE_MIN_FILTER,
    gl.LINEAR_MIPMAP_LINEAR
  );
  gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
  gl.bindTexture(gl.TEXTURE_CUBE_MAP, null);
  return tex;
}

// lookAt helper — vraćen da ne puca bakeSkyToCubemap
function lookAt(eye, center, up) {
  const [ex, ey, ez] = eye,
    [cx, cy, cz] = center;
  let [ux, uy, uz] = up;
  let zx = ex - cx,
    zy = ey - cy,
    zz = ez - cz;
  let rl = 1 / Math.hypot(zx, zy, zz);
  zx *= rl;
  zy *= rl;
  zz *= rl;
  let xx = uy * zz - uz * zy,
    xy = uz * zx - ux * zz,
    xz = ux * zy - uy * zx;
  rl = 1 / Math.hypot(xx, xy, xz);
  xx *= rl;
  xy *= rl;
  xz *= rl;
  let yx = zy * xz - zz * xy,
    yy = zz * xx - zx * xz,
    yz = zx * xy - zy * xx;
  const o = new Float32Array(16);
  o[0] = xx;
  o[1] = yx;
  o[2] = zx;
  o[3] = 0;
  o[4] = xy;
  o[5] = yy;
  o[6] = zy;
  o[7] = 0;
  o[8] = xz;
  o[9] = yz;
  o[10] = zz;
  o[11] = 0;
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
    // izdvoji rotaciju kamere bez translacije
    mat4 viewNoTrans = uView;
    viewNoTrans[3] = vec4(0.0, 0.0, 0.0, viewNoTrans[3].w);

    // izračunaj world-space direction
    vec3 dir = (transpose(mat3(viewNoTrans)) * aPos);
    vDir = normalize(dir);

    // nacrtaj sferu fiksnu oko kamere
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
uniform vec3 uGround;
uniform vec3  uSunColor;
uniform float uSunIntensity;
uniform int uHideSun;
uniform float uExposure;
uniform float uSunSizeDeg, uSunHaloScale;
uniform float uHorizonSoft, uHorizonLift;
uniform float uRayleighStrength, uMieStrength;
uniform float uGroundScatter, uTurbidity, uSaturation;
uniform float uHorizonWarmth, uZenithDesat, uHorizonDesat;

uniform float uMilkBandStrength, uMilkBandWidth, uWarmBandStrength, uWarmBandWidth;

// === Cloud layers ===
uniform float uCloud1Height, uCloud1Thickness, uCloud1Speed, uCloud1Density, uCloud1Scale;
uniform float uCloud2Height, uCloud2Thickness, uCloud2Speed, uCloud2Density, uCloud2Scale;

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
float fbm(vec3 p) {
    float sum = 0.0, amp = 1.0, freq = 1.0;
    for(int i=0; i<5; ++i) {
        sum += noise3d(p * freq) * amp;
        freq *= 2.0;
        amp *= 0.5;
    }
    return sum / 1.95;
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
    vec3  dir   = normalize(vDir);
    vec3  sunV  = normalize(uSunDir);
    float sunAlt = clamp(sunV.y, -1.0, 1.0);

    // === 1. Dynamic sky colors by sunAlt ===
    vec3 dayZenith   = vec3(0.12, 0.25, 0.60);
    vec3 dayHorizon  = vec3(0.80, 0.90, 1.00);
    vec3 sunsetZenith   = vec3(0.18, 0.23, 0.55);
    vec3 sunsetHorizon  = vec3(1.00, 0.35, 0.10);
    vec3 nightZenith   = vec3(0.01, 0.02, 0.10);
    vec3 nightHorizon  = vec3(0.05, 0.06, 0.13);

    float sunsetAmt = smoothstep(0.0, 0.15, clamp(0.2 - sunAlt, 0.0, 0.2));
    float nightAmt = clamp(-sunAlt * 10.0, 0.0, 1.0);
    float t   = clamp(dir.y*0.5 + 0.5 + uHorizonLift, 0.0, 1.0);
    float h   = 1.0 - t;
    float hS  = smoothstep(0.0, 1.0, pow(h, 1.0 + uHorizonSoft));

    vec3 curZenith   = mix(dayZenith,   sunsetZenith,  sunsetAmt);
    vec3 curHorizon  = mix(dayHorizon,  sunsetHorizon, sunsetAmt);

    curZenith  = mix(curZenith,  nightZenith,  nightAmt);
    curHorizon = mix(curHorizon, nightHorizon, nightAmt);

    vec3 base = mix(curZenith, curHorizon, hS);
    float gMix = smoothstep(-0.25, 0.05, dir.y);
    vec3 groundColor = uGround;
    base = mix(groundColor, base, gMix);

    // === 2. Procedural MULTI-LAYER clouds ===
    float cloudSum = 0.0;
    float totalAlpha = 0.0;

    // --- Layer 1: "cumulus" nisko, gusti ---
    {
        float tTop    = (uCloud1Height + uCloud1Thickness - uCameraHeight) / dir.y;
        float tBottom = (uCloud1Height - uCloud1Thickness - uCameraHeight) / dir.y;
        float tEnter  = max(min(tTop, tBottom), 0.0);
        float tExit   = max(max(tTop, tBottom), 0.0);
        float segLen  = max(tExit - tEnter, 0.0);
        if (segLen > 0.0){
            vec3 samplePos = dir * (tEnter + segLen * 0.5);
            samplePos.xz += uTime * vec2(uCloud1Speed, uCloud1Speed*0.8);
            float cl = fbm(samplePos * uCloud1Scale);
            float band = smoothstep(0.45, 0.67, cl);
            float opticalDepth = segLen / (uCloud1Thickness*2.0);
            float alpha = 1.0 - exp(-band * opticalDepth * uCloud1Density);
            // Fake soft shadow from higher layer:
            alpha *= 1.0 - 0.3 * totalAlpha;
            // Dodaj debeljinu: tamniji centar, svetlije ivice
float shape = smoothstep(0.4, 0.85, cl); // cl je fbm vrednost
vec3 volCloudColor = mix(vec3(0.7, 0.75, 0.85), vec3(1.0), shape);

// Boostuj masu prema horizonu
float horizonBoost = pow(1.0 - clamp(dir.y, 0.0, 1.0), 1.5);
volCloudColor *= 1.0 + 1.4 * horizonBoost; // više difuzne svetlosti

cloudSum += alpha * volCloudColor.r;
// Fake amb. occlusion na nebo ispod oblaka
float under = smoothstep(0.0, 0.25, dir.y); // gledamo skoro horizontalno
vec3 occlusionTint = vec3(0.8, 0.85, 0.9); // desaturisano plavičasto
base = mix(base, occlusionTint, alpha * under * 0.35);
            totalAlpha += alpha;
        }
    }

    // --- Layer 2: "cirrus" visoko, tanje ---
    {
        float tTop    = (uCloud2Height + uCloud2Thickness - uCameraHeight) / dir.y;
        float tBottom = (uCloud2Height - uCloud2Thickness - uCameraHeight) / dir.y;
        float tEnter  = max(min(tTop, tBottom), 0.0);
        float tExit   = max(max(tTop, tBottom), 0.0);
        float segLen  = max(tExit - tEnter, 0.0);
        if (segLen > 0.0){
            vec3 samplePos = dir * (tEnter + segLen * 0.5);
            samplePos.xz += uTime * vec2(uCloud2Speed, uCloud2Speed*0.6);
            float cl = fbm(samplePos * uCloud2Scale + 100.0); // shift for independence
            float band = smoothstep(0.54, 0.72, cl);
            float opticalDepth = segLen / (uCloud2Thickness*2.0);
            float alpha = 1.0 - exp(-band * opticalDepth * uCloud2Density);
            // Fake shadow from underlying layer:
            alpha *= 1.0 - 0.15 * totalAlpha;
            // Colorize high clouds to be bluish at zenith, pink at sunset:
            float sunset = pow(smoothstep(0.05, -0.4, sunAlt), 2.2);
            vec3 cirrusColor = mix(vec3(0.8,0.85,1.0), vec3(1.0,0.5,0.6), sunset);
            cloudSum += alpha * cirrusColor.r;
            totalAlpha += alpha;
        }
    }

    // --- Cloud color/alpha composition ---
cloudSum = clamp(cloudSum, 0.0, 1.0);

// Pametnija boja oblaka — svetli visoko, prljavi pri horizontu
vec3 cloudColor = mix(vec3(0.9, 0.9, 0.95), vec3(0.75, 0.78, 0.85), hS);
base = mix(base, cloudColor, 0.45 * cloudSum);
// Dodatni volumetrijski raspršeni sloj
float volFade = pow(1.0 - clamp(dir.y, 0.0, 1.0), 2.2);
vec3 scatterColor = vec3(0.55, 0.65, 0.85); // dusty blue
base = mix(base, scatterColor, volFade * 0.3);

// === Horizon fade/haze ===
float fogAmount = pow(1.0 - clamp(dir.y, 0.0, 1.0), 2.5);
vec3 fogColor = mix(curHorizon, vec3(0.6, 0.7, 0.8), sunsetAmt);
base = mix(base, fogColor, fogAmount * 0.2); // jačina haze-a

// === Horizon blur dodatak ===
float horizBlur = pow(1.0 - abs(dir.y), 3.0);
base = mix(base, vec3(0.6, 0.65, 0.75), horizBlur * 0.05);

// === Vertikalna saturacija — manje pri horizontu ===
float satFalloff = mix(0.7, 1.0, pow(clamp(dir.y, 0.0, 1.0), 1.5));
base = applySaturation(base, uSaturation * satFalloff);


    // --- sunset horizon warmth ---
    float warm = pow(clamp(1.0 - sunAlt, 0.0, 1.0), 2.0) * hS * uHorizonWarmth;
    vec3 sunsetWarm = vec3(1.0, 0.55, 0.25);
    base = mix(base, sunsetWarm, clamp(warm * 1.8, 0.0, 0.8)); // 0.65 → 0.75


    // --- Ostali efekti ---
    float milkBand = exp(-pow(abs(dir.y - 1.0)/max(uMilkBandWidth,0.001), 2.0));
    base += uMilkBandStrength * milkBand * vec3(0.85, 0.92, 1.0);

    float warmBand = exp(-pow(abs(dir.y)/max(uWarmBandWidth,0.001), 2.0));
    base += uWarmBandStrength * warmBand * vec3(1.0, 0.58, 0.15);

    base  = mix(base, applySaturation(base, 0.9), uZenithDesat);
    base *= mix(0.7, 1.0, uRayleighStrength);
    base = mix(base, vec3(0.035, 0.03, 0.03), clamp(uTurbidity*(1.0-hS), 0.0, 1.0));

    // Vertikalni "color curve": hladniji zenit, topliji horizont
    float skyFade = smoothstep(0.0, 0.55, dir.y);
    vec3 coldZenith  = vec3(0.80, 0.90, 1.05);
    vec3 warmHorizon = vec3(1.02, 0.94, 0.88);
    base *= mix(warmHorizon, coldZenith, skyFade);

    float ozone = smoothstep(0.35, 0.95, dir.y);
    base = mix(base, base * vec3(0.92, 0.96, 1.06), 0.25 * ozone);

// === 3. Sun disk & Mie halo ===
vec3 sunLight = vec3(0.0);

if (uHideSun == 0) {
    float cosToSun = dot(dir, sunV);
    float sunSize  = radians(uSunSizeDeg);
    float ang      = acos(cosToSun);

    float disk = exp(-pow(ang/(sunSize*0.9), 2.0));
    float limb = exp(-pow(ang/(sunSize*2.2), 2.0));
    sunLight = uSunColor * (disk*uSunIntensity + limb*(uSunIntensity*0.18));

    float g = 0.8;
    float mie = (1.0 - g*g) / pow(1.0 + g*g - 2.0*g*cosToSun, 1.5);
    mie *= 0.015 * (1.0 + 2.0*(1.0 - sunAlt)) * uSunHaloScale * uMieStrength;
    sunLight += uSunColor * mie * uSunIntensity;
}
    // === 4. Ground & bounce ===
    float skyMask    = smoothstep(-0.04, 0.02, dir.y);
    float groundMask = 1.0 - skyMask;

vec3 groundBase   = uGround * groundMask * uSunIntensity;
float below       = smoothstep(0.0, 0.25, max(0.0, -dir.y));
vec3 groundBounce = uGround * (0.3 + 0.7*(1.0 - sunAlt)) *
                    below * (uGroundScatter*1.5) * uSunIntensity;

// opciono: topliji odsjaj pri zalasku
groundBounce *= mix(vec3(1.0), vec3(1.3, 0.8, 0.6), smoothstep(0.1, -0.3, sunAlt));


    // === 5. Finalna kompozicija ===
    vec3 color = (base * skyMask * uSunIntensity) +
                 (sunLight * skyMask) +
                 groundBase +
                 groundBounce;

    // Fade celo nebo kad je noć
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
}

// ===== Uniforms =====
function applySkyUniforms(gl, view, proj, sunDir, opts) {
  const o = { ...DEFAULT_SKY, ...(opts || {}) };
  gl.useProgram(skyProg);

  gl.uniformMatrix4fv(gl.getUniformLocation(skyProg, "uView"), false, view);
  gl.uniformMatrix4fv(gl.getUniformLocation(skyProg, "uProj"), false, proj);
  gl.uniform3fv(gl.getUniformLocation(skyProg, "uSunDir"), sunDir || [0, 1, 0]);
  gl.uniform3fv(gl.getUniformLocation(skyProg, "uSunColor"), opts.sunColor);
  gl.uniform1f(
    gl.getUniformLocation(skyProg, "uSunIntensity"),
    opts.sunIntensity
  );
  gl.uniform1f(gl.getUniformLocation(skyProg, "uCameraHeight"), 1.0); // tvoja visina u svetu
  gl.uniform1f(gl.getUniformLocation(skyProg, "uCloud1Height"), 50.0);
  gl.uniform1f(gl.getUniformLocation(skyProg, "uCloud1Thickness"), 35.0);
  gl.uniform1f(gl.getUniformLocation(skyProg, "uCloud1Speed"), 0.0);
  gl.uniform1f(gl.getUniformLocation(skyProg, "uCloud1Density"), 0.15);
  gl.uniform1f(gl.getUniformLocation(skyProg, "uCloud1Scale"), 0.005);

  gl.uniform1f(gl.getUniformLocation(skyProg, "uCloud2Height"), 200.0);
  gl.uniform1f(gl.getUniformLocation(skyProg, "uCloud2Thickness"), 20.0);
  gl.uniform1f(gl.getUniformLocation(skyProg, "uCloud2Speed"), 0.0);
  gl.uniform1f(gl.getUniformLocation(skyProg, "uCloud2Density"), 0.15);
  gl.uniform1f(gl.getUniformLocation(skyProg, "uCloud2Scale"), 0.001);
  gl.uniform3fv(gl.getUniformLocation(skyProg, "uZenith"), o.zenith);
  gl.uniform3fv(gl.getUniformLocation(skyProg, "uHorizon"), o.horizon);
  gl.uniform3fv(gl.getUniformLocation(skyProg, "uGround"), o.ground);
  gl.uniform1f(gl.getUniformLocation(skyProg, "uExposure"), o.exposure);
  gl.uniform3fv(
    gl.getUniformLocation(skyProg, "uSunsetHorizon"),
    o.sunsetHorizon
  );
  gl.uniform3fv(
    gl.getUniformLocation(skyProg, "uSunsetZenith"),
    o.sunsetZenith
  );
  gl.uniform1f(gl.getUniformLocation(skyProg, "uSunSizeDeg"), o.sunSizeDeg);
  gl.uniform1f(gl.getUniformLocation(skyProg, "uSunHaloScale"), o.sunHaloScale);
  gl.uniform1f(gl.getUniformLocation(skyProg, "uHorizonSoft"), o.horizonSoft);
  gl.uniform1f(gl.getUniformLocation(skyProg, "uHorizonLift"), o.horizonLift);
  gl.uniform1f(gl.getUniformLocation(skyProg, "uHorizonDesat"), o.horizonDesat);
  gl.uniform1f(gl.getUniformLocation(skyProg, "uTurbidity"), o.turbidity);
  gl.uniform1f(gl.getUniformLocation(skyProg, "uSaturation"), o.saturation);
  gl.uniform1f(
    gl.getUniformLocation(skyProg, "uMilkBandStrength"),
    o.milkBandStrength
  );
  gl.uniform1f(
    gl.getUniformLocation(skyProg, "uMilkBandWidth"),
    o.milkBandWidth
  );
  gl.uniform1f(
    gl.getUniformLocation(skyProg, "uWarmBandStrength"),
    o.warmBandStrength
  );
  gl.uniform1f(
    gl.getUniformLocation(skyProg, "uWarmBandWidth"),
    o.warmBandWidth
  );

  gl.uniform1f(
    gl.getUniformLocation(skyProg, "uHorizonWarmth"),
    o.horizonWarmth
  );
  gl.uniform1f(
    gl.getUniformLocation(skyProg, "uRayleighStrength"),
    o.rayleighStrength
  );
  gl.uniform1f(gl.getUniformLocation(skyProg, "uTime"), 0);
  gl.uniform1f(gl.getUniformLocation(skyProg, "uMieStrength"), o.mieStrength);
  gl.uniform1f(gl.getUniformLocation(skyProg, "uZenithDesat"), o.zenithDesat);
  gl.uniform1f(
    gl.getUniformLocation(skyProg, "uGroundScatter"),
    o.groundScatter
  );

  gl.uniform1i(
    gl.getUniformLocation(skyProg, "uWorldLocked"),
    o.worldLocked ? 1 : 0
  );
  gl.uniformMatrix4fv(gl.getUniformLocation(skyProg, "uModel"), false, o.model);
  gl.uniform1i(
    gl.getUniformLocation(skyProg, "uUseTonemap"),
    o.useTonemap ? 1 : 0
  );
  gl.uniform1i(gl.getUniformLocation(skyProg, "uHideSun"), o.hideSun ? 1 : 0);
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
    lookAt([0, 0, 0], [1, 0, 0], [0, -1, 0]), // +X
    lookAt([0, 0, 0], [-1, 0, 0], [0, -1, 0]), // -X
    lookAt([0, 0, 0], [0, 1, 0], [0, 0, 1]), // +Y
    lookAt([0, 0, 0], [0, -1, 0], [0, 0, -1]), // -Y
    lookAt([0, 0, 0], [0, 0, 1], [0, -1, 0]), // +Z
    lookAt([0, 0, 0], [0, 0, -1], [0, -1, 0]), // -Z
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

    // ✅ ubaci sanity check
    const fbStatus = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    drawSkyGeneric(gl, views[face], proj, sunDir, {
      ...opts,
      worldLocked: 1,
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
