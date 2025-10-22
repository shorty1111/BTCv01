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

uniform float uFrame;       // za frame jitter
uniform vec2  uNoiseScale;  // postavlja se iz JS: (canvas.width / SSAO_NOISE_SIZE, canvas.height / SSAO_NOISE_SIZE)

const int   KERNEL_SIZE = 64;
const float radius      = 2.5;
const float bias        = 0.025;
const float powerAO     = 2.5;

/* ---------- helper ---------- */
float rand(vec2 co) {
    return fract(sin(dot(co.xy ,vec2(12.9898,78.233))) * 43758.5453);
}

/* ---------- main ---------- */
void main() {
    vec3 fragPos = texture(gPosition, vUV).rgb;
    if (length(fragPos) < 1e-5) discard;

    vec3 normal = normalize(texture(gNormal, vUV).rgb);

    // uzmi nasumičan 2D vektor iz noise teksture
    vec3 randomVec = normalize(texture(tNoise, vUV * uNoiseScale).xyz * 2.0 - 1.0);

    // --- TBN ---
    vec3 tangent   = normalize(randomVec - normal * dot(randomVec, normal));
    vec3 bitangent = cross(normal, tangent);
    mat3 TBN       = mat3(tangent, bitangent, normal);

    float occlusion = 0.0;
    vec3 bentNormal = vec3(0.0);
    float visibleSamples = 0.0;

    float camDepth = -fragPos.z;
    float adapt = mix(3.0, 8.0, clamp(camDepth / 200.0, 0.0, 1.0));

    // jitter po frame-u
    float frameJitter = rand(vUV + vec2(uFrame * 0.37, uFrame * 0.11));

    for (int i = 0; i < KERNEL_SIZE; ++i) {
        int idx = int(mod(float(i) + frameJitter * float(KERNEL_SIZE), float(KERNEL_SIZE)));
        vec3 sampleVec = TBN * samples[idx];
        vec3 samplePos = fragPos + sampleVec * radius;

        // u projection space
        vec4 offset = uProjection * vec4(samplePos, 1.0);
        offset.xyz /= offset.w;
        offset.xyz = offset.xyz * 0.5 + 0.5;

        // proveri granice
        if (offset.x < 0.0 || offset.x > 1.0 || offset.y < 0.0 || offset.y > 1.0)
            continue;

        vec3 samplePosTex = texture(gPosition, offset.xy).rgb;
        if (length(samplePosTex) < 1e-5)
            continue;

        float sampleDepth = samplePosTex.z;
        float dist = abs(sampleDepth - fragPos.z);
        if (dist > adapt)
            continue;

        float rangeCheck = 1.0 - smoothstep(0.0, adapt, dist);
        float occ = step(samplePos.z + bias, sampleDepth) * rangeCheck;
        occlusion += occ;

        if (occ < 0.5) {
            float weight = max(dot(normal, normalize(sampleVec)), 0.0);
            bentNormal += sampleVec * weight;
            visibleSamples += weight;
        }
    }

    // --- AO ---
    occlusion = 1.0 - (occlusion / float(KERNEL_SIZE));
    occlusion = clamp(occlusion, 0.0, 1.0);
    occlusion = pow(occlusion, powerAO);

    // --- Bent normal ---
    if (visibleSamples > 0.0) {
        bentNormal = normalize(bentNormal / visibleSamples);
        bentNormal = normalize(TBN * bentNormal);
        float a = max(dot(bentNormal, normal), 0.0);
        bentNormal = normalize(mix(normal, bentNormal, smoothstep(0.4, 1.0, a)));
    } else {
        bentNormal = normal;
    }

    // blago smirenje
    bentNormal = normalize(mix(normal, bentNormal, 0.5));

    fragColor = vec4(bentNormal * 0.5 + 0.5, occlusion);
}
