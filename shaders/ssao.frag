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
uniform vec4 uViewportRect; // x = umin.x, y = umin.y, z = width, w = height
uniform float uFrame;
uniform vec2  uNoiseScale;

#define KERNEL_SIZE 64
const float bias     = 0.025;
const float powerAO  = 1.5;

/* ---------- main ---------- */
void main() {
    vec2 uv = vUV;
    // prilagodi UV regionu koji se renderuje
    uv = uViewportRect.xy + uv * uViewportRect.zw;

    vec3 fragPos = texture(gPosition, vUV).rgb;
    if (length(fragPos) < 1e-5) discard;

    vec3 normal = normalize(texture(gNormal, vUV).rgb);

    // --- Noise: rotacija uzoraka po pixelu ---
    vec3 randomVec = normalize(texture(tNoise, vUV * uNoiseScale).xyz * 2.0 - 1.0);
    vec3 tangent   = normalize(randomVec - normal * dot(randomVec, normal));
    vec3 bitangent = cross(normal, tangent);
    mat3 TBN       = mat3(tangent, bitangent, normal);

    // --- Camera-depth adaptacija ---
    float camDepth = -fragPos.z;
    float depthFactor = clamp(camDepth / 1.0, 0.0, 1.0);
    float radius = mix(0.1, 1.0, depthFactor);
    float adapt  = mix(1.0, 1.0, clamp(camDepth / 1.0, 0.0, 1.0));
    int sampleCount = int(mix(48.0, 64.0, depthFactor));

    float occlusion = 0.0;

    // --- SSAO loop ---
    for (int i = 0; i < sampleCount; ++i) {
        vec3 sampleVecVS = TBN * samples[i];
        vec3 samplePos = fragPos + sampleVecVS * radius;

        // projekcija u clip-space
        vec4 offset = uProjection * vec4(samplePos, 1.0);
        offset.xyz /= max(offset.w, 1e-6);
        vec2 suv = offset.xy * 0.5 + 0.5;

        // čitanje sample depth
        vec3 samplePosTex = texture(gPosition, suv).rgb;
        float sampleDepth = samplePosTex.z;

        // matematičke maske
        float inBounds = step(0.0, suv.x) * step(suv.x, 1.0) * step(0.0, suv.y) * step(suv.y, 1.0);
        float valid = float(length(samplePosTex) > 1e-5);
        float dist = abs(sampleDepth - fragPos.z);
        float pass = step(dist, adapt);

        float rangeCheck = 1.0 - smoothstep(0.0, adapt, dist);
        float occ = step(samplePos.z + bias, sampleDepth) * rangeCheck;
        float weight = inBounds * valid * pass;
        occlusion += occ * weight;
    }

    // --- AO rezultat ---
    occlusion = 1.0 - (occlusion / float(sampleCount));
    occlusion = clamp(pow(occlusion, powerAO), 0.0, 1.0);

    // --- Dither noise ---
    float finalNoise = fract(sin(dot(vUV * vec2(91.7, 37.3) + uFrame, vec2(12.9898,78.233))) * 43758.5453);
    occlusion = clamp(occlusion + (finalNoise - 0.5) * 0.015, 0.0, 1.0);

    // izlaz samo AO u crno-beloj formi
    fragColor = vec4(vec3(1.0), occlusion);
}
