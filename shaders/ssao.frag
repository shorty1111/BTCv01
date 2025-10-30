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
const float radius      = 1.0;
const float bias        = 0.025;
const float powerAO     = 2.0;

/* ---------- helper ---------- */
float rand(vec2 co) {
    return fract(sin(dot(co.xy ,vec2(12.9898,78.233))) * 43758.5453);
}

/* ---------- main ---------- */
void main() {
    vec3 fragPos = texture(gPosition, vUV).rgb;
    if (length(fragPos) < 1e-5) discard;

    vec3 normal = normalize(texture(gNormal, vUV).rgb);

    // noise → random tangent
    vec3 randomVec = normalize(texture(tNoise, vUV * uNoiseScale).xyz * 2.0 - 1.0);

    // TBN (view-space)
    vec3 tangent   = normalize(randomVec - normal * dot(randomVec, normal));
    vec3 bitangent = cross(normal, tangent);
    mat3 TBN       = mat3(tangent, bitangent, normal);

    float occlusion = 0.0;

    // bent akumulacija u TANGENT-SPACE
    vec3  bentTS         = vec3(0.0);
    float visibleSamples = 0.0;

    float camDepth = -fragPos.z;
    float depthFactor = clamp(camDepth / 50.0, 0.0, 1.0);
    float radiusScaled = mix(0.5, 2.5, depthFactor);
    float weightLimit = mix(0.5, 2.0, depthFactor);
    float adapt    = mix(6.0, 8.0, clamp(camDepth / 100.0, 0.0, 1.0));

    // jitter po frame-u
    float frameJitter = fract(sin(dot(vUV + vec2(uFrame * 0.37, uFrame * 0.11),
                                      vec2(12.9898,78.233))) * 43758.5453);

for (int i = 0; i < KERNEL_SIZE; ++i) {
    int idx = int(mod(float(i) + frameJitter * float(KERNEL_SIZE), float(KERNEL_SIZE)));

        // VS vektor za offset/proveru dubine
        vec3 sampleVecVS = TBN * samples[idx];
        vec3 samplePos   = fragPos + sampleVecVS * radiusScaled;

        // u projection space
        vec4 offset = uProjection * vec4(samplePos, 1.0);
        offset.xyz /= max(offset.w, 1e-6);
        offset.xyz  = offset.xyz * 0.5 + 0.5;

        // granice
        if (offset.x < 0.0 || offset.x > 1.0 || offset.y < 0.0 || offset.y > 1.0)
            continue;

        vec3 samplePosTex = texture(gPosition, offset.xy).rgb;
        if (length(samplePosTex) < 1e-5)
            continue;

        float sampleDepth = samplePosTex.z;
        float dist        = abs(sampleDepth - fragPos.z);
        if (dist > adapt) continue;

        float rangeCheck = 1.0 - smoothstep(0.0, adapt, dist);

        // occlusion test (isti kao kod tebe)
        float occ = step(samplePos.z + bias, sampleDepth) * rangeCheck;
        occlusion += occ;

        // ako je vidljivo (nije okludirano), akumuliraj bent u TS
        if (occ < 0.5) {
            vec3  sampleVecTS = samples[idx];                   // TS vektor
            float weight      = max(dot(vec3(0,0,1), normalize(sampleVecTS)), 0.0);
            bentTS           += sampleVecTS * weight;           // TS akumulacija
            visibleSamples   += weight;
        }
    }
    // --- AO ---
    occlusion = 1.0 - (occlusion / float(KERNEL_SIZE));
    occlusion = clamp(occlusion, 0.0, 1.0);
    occlusion = pow(occlusion, powerAO);

    // --- Bent normal ---
    vec3 bentV;
    if (visibleSamples > 0.0) {
        bentTS = normalize(bentTS / visibleSamples);  // još uvek TS
        bentV  = normalize(TBN * bentTS);             // jednom u VIEW
        // prilepi uz površinsku normalu (stabilizacija)
        float a = max(dot(bentV, normal), 0.0);
        bentV   = normalize(mix(normal, bentV, smoothstep(0.4, 1.0, a)));
    } else {
        bentV = normal;
    }

    // blago smirenje (po želji)
    bentV = normalize(mix(normal, bentV, 0.5));

    // output: RGB = bent (view), A = AO
    fragColor = vec4(bentV * 0.5 + 0.5, occlusion);
}
