#version 300 es
precision highp float;

/* === uniforme === */
uniform mat4  uProjection, uView, uModel;
uniform float uTime;
uniform vec3  uBoatPos;
uniform vec3  uCameraPos;
uniform vec2  uViewportSize;

/* talasi iz JS-a */
uniform int   uWaveCount;
uniform float uWaveA[32];
uniform float uWaveL[32];
uniform float uWaveQ[32];
uniform vec2  uWaveDir[32];
uniform float uWavePhase[32];
uniform float uWaveOmega[32];

/* === ulazi === */
in vec3 aPos;
in vec2 aUV;
in float aWaveMask;

/* === izlazi === */
out vec3 vWorldPos;
out vec3 vNormal;
out float vWaveHeight;
out float vWaveMask;
out vec2 vUV;
out vec3 vTBN_T;
out vec3 vTBN_B;
out vec3 vTBN_N;
out float vViewZ;
out vec3 vTangent;
out vec3 vBitangent;

#define PI 3.14159265

/* ------------------------------------------------------- */
/* --- Procedural noise: hash, value noise, fbm ---------- */
float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);

    return mix(
        mix(hash(i + vec2(0.0, 0.0)), hash(i + vec2(1.0, 0.0)), u.x),
        mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
        u.y);
}

float fbm(vec2 p) {
    float total = 0.0;
    float amp = 0.5;
    for (int i = 0; i < 4; i++) {
        total += noise(p) * amp;
        p *= 2.0;
        amp *= 0.5;
    }
    return total;
}

/* ------------------------------------------------------- */
struct WaveResult { vec3 disp; vec3 derivX; vec3 derivZ; };

WaveResult gerstnerWave(vec3 p, vec2 normXZ, float A, float L, float Q,
                        vec2 dir, float phase, float omega, float t, float phiNoise) {
    float k = 6.283185 / L;
    float distortion = noise(normXZ * 0.3 + t * 0.03) * 2.0 - 1.0;
    float phi = k * dot(dir, p.xz) + omega * t + phase + distortion + phiNoise;
    float cP = cos(phi);
    float sP = sin(phi);

    vec3 disp = vec3(Q * A * dir.x * cP,
                     A * sP,
                     Q * A * dir.y * cP);

    float kA = Q * A * k;
    vec3 dX = vec3(-dir.x * dir.x * kA * sP,
                   A * k * dir.x * cP,
                   -dir.x * dir.y * kA * sP);
    vec3 dZ = vec3(-dir.x * dir.y * kA * sP,
                   A * k * dir.y * cP,
                   -dir.y * dir.y * kA * sP);

    return WaveResult(disp, dX, dZ);
}

void main() {
    // === HARD DISABLE WAVES ===
// if (true) {
//     vec3 basePos = (uModel * vec4(aPos, 1.0)).xyz;

//     vWorldPos   = basePos;
//     vWaveHeight = basePos.y;
//     vWaveMask   = 0.0;
//     vUV         = aUV * 4.0;

//     vNormal     = vec3(0.0, 1.0, 0.0);
//     vTBN_T      = vec3(1.0, 0.0, 0.0);
//     vTBN_B      = vec3(0.0, 0.0, 1.0);
//     vTBN_N      = vNormal;

//     vec4 viewPos = uView * vec4(basePos, 1.0);
//     vViewZ = viewPos.z;
//     gl_Position = uProjection * viewPos;
//     return;
// }
    float mask = clamp(aWaveMask, 0.0, 1.0);

    vec3 basePos = (uModel * vec4(aPos, 1.0)).xyz;
    vec2 normXZ = (basePos.xz - uBoatPos.xz) / 50.0;

    float size = 50.0;
    float prstena = 4.0;
    float meshRadius = (prstena * 2.0 * size) + size;
    float minFade = 2.25;
    float distCam = distance(uCameraPos.xz, basePos.xz);
    float fade = 1.0;
    float ampNoise = 1.5 + 0.2 * noise(normXZ * 0.05 + uTime * 0.1);

    vec3 dispLarge = vec3(0.0);
    vec3 dispMid   = vec3(0.0);
    vec3 dispSmall = vec3(0.0);
    vec3 dX = vec3(1.0, 0.0, 0.0);
    vec3 dZ = vec3(0.0, 0.0, 1.0);

    for (int i = 0; i < uWaveCount; ++i) {
        float phaseNoise = 1.1 * fbm(normXZ * 2.3 + float(i)*3.3 + uTime * 0.10);
        WaveResult r = gerstnerWave(basePos, normXZ,
                                    uWaveA[i], uWaveL[i], uWaveQ[i],
                                    uWaveDir[i], uWavePhase[i], uWaveOmega[i], uTime, phaseNoise);
        if ((i < 3) || (i >= 18 && i < 20)) {
            dispLarge += r.disp * mask * fade * ampNoise;
            dX   += r.derivX * mask * fade * ampNoise;
            dZ   += r.derivZ * mask * fade * ampNoise;
        } else if ((i >= 3 && i < 13) || (i >= 20 && i < 28)) {
            dispMid += r.disp * mask * fade * ampNoise;
            dX   += r.derivX * mask * fade * ampNoise;
            dZ   += r.derivZ * mask * fade * ampNoise;
        } else {
            dispSmall += r.disp * mask * fade * ampNoise;
            dX   += r.derivX * mask * fade * ampNoise;
            dZ   += r.derivZ * mask * fade * ampNoise;
        }
    }

    float crest = dispLarge.y + dispMid.y;
    float crestThreshold = 1.5;
    bool isCrest = crest > crestThreshold;

    vec3 disp = dispLarge + dispMid;
    if (!isCrest) {
        disp += dispSmall;
    }

    float detail = fbm(normXZ * 0.8 + uTime * 0.2);
    if (!isCrest) {
        disp.y += 0.03 * detail * mask * fade;
    }

    vec2 jitter = 1.83 * vec2(
        fbm(normXZ * 3.71 + uTime * 0.05),
        fbm(normXZ * 4.01 - uTime * 0.09 + 5.2)
    );

    // --- Boat mask: IZBACENO ---
    float hullMask = 0.0; // maska je uvek isključena

    float edge = 0.0;
    float hullInfluence = 1.0;
    disp *= 1.0; // maska ne utiče

    float rim = 0.0;
    disp.y += 0.0; // maska ne utiče

    // --- Finalizacija ---
    vec3 worldPos = basePos + disp;
    worldPos.xz += jitter * mask * fade;

    vWaveHeight = worldPos.y;
    vWaveMask   = mask;
    vWorldPos   = worldPos;
    vUV         = aUV * 4.0;

    vec3 waveNormal = normalize(cross(dZ, dX));
    vec3 flatNormal = vec3(0.0, 1.0, 0.0);
    vNormal = normalize(mix(flatNormal, waveNormal, mask));

vTBN_T = normalize(dX);
vTBN_B = normalize(dZ);
vTBN_N = vNormal;


    vec4 viewPos = uView * vec4(worldPos, 1.0);
    vViewZ = viewPos.z;
    gl_Position = uProjection * viewPos;
}
