#version 300 es
precision highp float;

/* === uniforme === */
uniform mat4  uProjection, uView, uModel;
uniform float uTime;
uniform vec3  uBoatPos;
uniform vec3  uCameraPos;

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

#define PI 3.14159265

/* ------------------------------------------------------- */
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

/* ------------------------------------------------------- */
void main() {
    float mask = clamp(aWaveMask, 0.0, 1.0);

    vec3 basePos = (uModel * vec4(aPos, 1.0)).xyz;
    vec2 normXZ  = (basePos.xz - uBoatPos.xz) / 50.0;

    // udaljenost od kamere (koristi se za fade)
    float distCam = distance(uCameraPos.xz, basePos.xz);

    // fade za udaljenost — smanjuje amplitude talasa i nagibe
    float baseFade = smoothstep(100.0, 800.0, distCam);
    float distanceFade = clamp(1.0 - pow(baseFade, 0.2), 0.1, 1.0);

    float ampNoise = 1.5 + 0.2 * noise(normXZ * 0.05 + uTime * 0.1);

    vec3 dispSum = vec3(0.0);
    vec3 dX = vec3(1.0, 0.0, 0.0);
    vec3 dZ = vec3(0.0, 0.0, 1.0);

    for (int i = 0; i < uWaveCount; ++i) {
        // dodato: blagi fazni pomak po lokaciji
        float localPhase = dot(normXZ, vec2(0.7, -0.4)) * 4.0 + uTime * 0.15;
        float phaseNoise = 1.1 * fbm(normXZ * 2.3 + float(i)*3.3 + uTime * 0.10 + localPhase);

        // dodato: globalni "vetar" koji lagano menja pravac
        vec2 windDir = normalize(vec2(sin(uTime * 0.05), cos(uTime * 0.05)));
        vec2 dirWarp = normalize(mix(uWaveDir[i], windDir, 0.1));

        WaveResult r = gerstnerWave(basePos, normXZ,
                                    uWaveA[i], uWaveL[i], uWaveQ[i],
                                    dirWarp, uWavePhase[i], uWaveOmega[i], uTime, phaseNoise);

        // interferencijski damping
        float inter = 0.8 + 0.2 * sin(dot(r.disp.xz, vec2(0.5)) + uTime);
        dispSum += r.disp * mask * ampNoise * inter;
        dX += r.derivX * mask * ampNoise;
        dZ += r.derivZ * mask * ampNoise;
    }

    // fade po udaljenosti
    vec3 disp = dispSum * distanceFade;

    // view-based amplitude damping (nagib pogleda)
    float NdotV = abs(dot(normalize(basePos - uCameraPos), vec3(0.0,1.0,0.0)));
    float viewFade = mix(0.7, 1.0, pow(NdotV, 0.3));
    disp *= viewFade;

    // --- Normale ---
    vec3 waveNormal = normalize(cross(dZ, dX));
    vec3 flatNormal = vec3(0.0, 1.0, 0.0);

    // --- Transformacija u world-space ---
    mat3 worldMat = mat3(uModel);
    dX = normalize(worldMat * dX * distanceFade);
    dZ = normalize(worldMat * dZ * distanceFade);
    waveNormal = normalize(worldMat * waveNormal);
    flatNormal = normalize(worldMat * flatNormal);

    // --- Kombinacija ---
    vec3 worldPos = basePos + disp;
    vNormal = normalize(mix(flatNormal, waveNormal, mask * distanceFade));

    // micro-chop za blagu hrapavost
    float chop = fbm(normXZ * 20.0 + uTime * 0.5) * 0.03;
    vNormal = normalize(mix(vNormal, vec3(0.0,1.0,0.0), chop));

    vTBN_N = normalize(vNormal);
    vTBN_T = normalize(dX);
    vTBN_B = normalize(cross(vTBN_N, vTBN_T));
    vTBN_T = normalize(cross(vTBN_B, vTBN_N));

    vWaveHeight = worldPos.y;
    vWaveMask   = mask;
    vWorldPos   = worldPos;
    vUV         = aUV * 4.0;

    vec4 viewPos = uView * vec4(worldPos, 1.0);
    vViewZ = viewPos.z;
    gl_Position = uProjection * viewPos;
}
