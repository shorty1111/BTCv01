#version 300 es
precision highp float;

in vec2 vUV;
out vec4 fragColor;

uniform sampler2D gPosition;
uniform sampler2D gNormal;
uniform sampler2D tNoise;
uniform mat4 uView;
uniform vec3 samples[128];
uniform mat4 uProjection;

const int KERNEL_SIZE = 128;
const float radius = 3.6;
const float bias = 0.025;
const float power = 1.3;

void main() {
    vec3 fragPos = texture(gPosition, vUV).rgb;
    vec3 normal  = normalize(texture(gNormal, vUV).rgb);

    vec2 noiseScale = vec2(textureSize(gPosition, 0)) / 4.0;
    vec3 randomVec  = normalize(texture(tNoise, vUV * noiseScale + fract(uView[3].xy)).rgb);

    // --- TBN
    vec3 tangent   = normalize(randomVec - normal * dot(randomVec, normal));
    vec3 bitangent = cross(normal, tangent);
    mat3 TBN       = mat3(tangent, bitangent, normal);

    float occlusion = 0.0;
    vec3 bentNormal = vec3(0.0);
    float visibleSamples = 0.0;

    float camDepth = -fragPos.z;
    float adapt = mix(6.0, 10.0, clamp(camDepth / 100.0, 0.0, 1.0));

    for (int i = 0; i < KERNEL_SIZE; ++i) {
        vec3 sampleVec = TBN * samples[i];
        vec3 samplePos = fragPos + sampleVec * radius;

        vec4 offset = uProjection * vec4(samplePos, 1.0);
        offset.xyz /= offset.w;
        offset.xyz = offset.xyz * 0.5 + 0.5;

        // Skipuj ako je van ekrana
        if (offset.x < 0.0 || offset.x > 1.0 || offset.y < 0.0 || offset.y > 1.0)
            continue;

        float sampleDepth = texture(gPosition, offset.xy).z;

        // Skipuj ako je depth nevalidan (0.0)
        if (abs(sampleDepth) < 1e-4)
            continue;

        // Odbaci ako je predaleko u dubini
        if (abs(sampleDepth - fragPos.z) > adapt * 1.2)
            continue;

        float rangeCheck = smoothstep(0.0, adapt, radius / max(abs(fragPos.z - sampleDepth), 1e-4));
        float occ = step(samplePos.z + bias, sampleDepth) * rangeCheck;
        occlusion += occ;

        // Ako je occlusion mali → sample je vidljiv → akumuliraj bent normalu
        if (occ < 0.5) {
            bentNormal += sampleVec;
            visibleSamples += 1.0;
        }
    }

    occlusion = 1.0 - (occlusion / float(KERNEL_SIZE));
    occlusion = clamp(occlusion, 0.0, 1.0);
    occlusion = pow(occlusion, 6.5);
// === Bent normal samo za PBR, stabilna verzija ===
if (visibleSamples > 0.0) {
    // prosečna u tangent prostoru
    bentNormal = normalize(bentNormal / visibleSamples);

    // prebaci iz tangent u view-space (isti prostor kao gNormal)
    bentNormal = normalize(TBN * bentNormal);

    // izbegni ekstremne devijacije (flicker)
    float angle = max(dot(bentNormal, normal), 0.0);
    bentNormal = normalize(mix(normal, bentNormal, smoothstep(0.4, 1.0, angle)));
} else {
    bentNormal = normal;
}

    // EKSPORT: RGB = bent normal u [0,1], A = AO
    fragColor = vec4(bentNormal * 0.5 + 0.5, occlusion);
}
