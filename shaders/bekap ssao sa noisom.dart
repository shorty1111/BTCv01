#version 300 es
precision highp float;

in vec2 vUV;
out vec4 fragColor;

/* ---------- G-buffer & uniforms ---------- */
uniform sampler2D gPosition;
uniform sampler2D gNormal;
uniform sampler2D tNoise;
uniform mat4 uView;
uniform mat4 uProjection;
uniform vec3 samples[64];

uniform float uFrame;       // frame broj za jitter
uniform vec2  uNoiseScale;  // (canvas.width / noiseTexSize, canvas.height / noiseTexSize)

#define KERNEL_SIZE 64
const float bias     = 0.025;
const float powerAO  = 3.5;   // kontrast AO-a (veće = tamnije)

/* ---------- main ---------- */
void main() {
    vec3 fragPos = texture(gPosition, vUV).rgb;
    if (length(fragPos) < 1e-5) discard;

    vec3 normal = normalize(texture(gNormal, vUV).rgb);

    // --- Noise: random tangent rotacija po pixelu ---
    vec3 randomVec = normalize(texture(tNoise, vUV * uNoiseScale).xyz * 2.0 - 1.0);
    vec3 tangent   = normalize(randomVec - normal * dot(randomVec, normal));
    vec3 bitangent = cross(normal, tangent);
    mat3 TBN       = mat3(tangent, bitangent, normal);

    // --- Camera-depth adaptacija ---
    float camDepth = -fragPos.z;
    float depthFactor = clamp(camDepth / 1.0, 0.0, 1.0);
    float radius = mix(0.1, 4.0, depthFactor);      // manji u blizini, veći u daljini
    float adapt  = mix(1.0, 1.0, clamp(camDepth / 1.0, 0.0, 1.0));

    // --- Jitter faza po frame-u ---
    float framePhase = 0.0;

    float occlusion = 0.0;
    vec3  bentTS = vec3(0.0);
    float visibleSamples = 0.0;

    int sampleCount = int(mix(32.0, 64.0, depthFactor));

    for (int i = 0; i < sampleCount; ++i) {
        // hash jitter rotacija po pikselu
        float n = fract(sin(dot(vUV + float(i), vec2(12.9898,78.233))) * 43758.5453 + framePhase * 2.0);
        float angle = n * 6.2831853;
        mat2 rot = mat2(cos(angle), -sin(angle), sin(angle), cos(angle));

        // rotiraj XY deo sample vektora za prostorni noise
        vec3 sampleVecVS = TBN * vec3(rot * samples[i].xy, samples[i].z);
        vec3 samplePos = fragPos + sampleVecVS * radius;

        // u clip space
        vec4 offset = uProjection * vec4(samplePos, 1.0);
        offset.xyz /= max(offset.w, 1e-6);
        vec2 uv = offset.xy * 0.5 + 0.5;

        if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) continue;

        vec3 samplePosTex = texture(gPosition, uv).rgb;
        if (length(samplePosTex) < 1e-5) continue;

        float sampleDepth = samplePosTex.z;
        float dist = abs(sampleDepth - fragPos.z);
        if (dist > adapt) continue;

        float rangeCheck = 1.0 - smoothstep(0.0, adapt, dist);
        float occ = step(samplePos.z + bias, sampleDepth) * rangeCheck;
        occlusion += occ;

        // bent normal akumulacija
        if (occ < 0.5) {
            vec3 sampleVecTS = samples[i];
            float w = max(dot(vec3(0,0,1), normalize(sampleVecTS)), 0.0);
            bentTS += sampleVecTS * w;
            visibleSamples += w;
        }
    }

    // --- AO ---
    occlusion = 1.0 - (occlusion / float(sampleCount));
    occlusion = clamp(pow(occlusion, powerAO), 0.0, 1.0);

    // --- Bent normal ---
    vec3 bentV = normal;
    if (visibleSamples > 0.0) {
        bentTS /= visibleSamples;
        bentV = normalize(TBN * bentTS);
        float align = max(dot(bentV, normal), 0.0);
        bentV = normalize(mix(normal, bentV, align * 0.5));
    }

    // --- Dither noise da prikrije banding ---
    float finalNoise = fract(sin(dot(vUV * vec2(345.7, 765.3) + uFrame, vec2(12.9898,78.233))) * 43758.5453);
    occlusion = clamp(occlusion + (finalNoise - 0.5) * 0.02, 0.0, 1.0);

    // Output: RGB = bent normal (0–1), A = AO
    fragColor = vec4(bentV * 0.5 + 0.5, occlusion);
}
