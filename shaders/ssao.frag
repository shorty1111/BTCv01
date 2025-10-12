#version 300 es
precision highp float;

in vec2 vUV;
out vec4 fragColor;

uniform sampler2D gPosition;
uniform sampler2D gNormal;
uniform sampler2D tNoise;
uniform mat4 uView; // dodaj u uniform sekciju
uniform vec3 samples[128];
uniform mat4 uProjection;

const int KERNEL_SIZE = 128;
const float radius = 3.6;
const float bias = 0.045;
const float power = 4.2;

void main() {
    vec3 fragPos = texture(gPosition, vUV).rgb;
    vec3 normal  = normalize(texture(gNormal, vUV).rgb);

vec2 noiseScale = vec2(textureSize(gPosition, 0)) / 4.0;  // 4.0 → 16.0
vec3 randomVec  = normalize(texture(tNoise, vUV * noiseScale + fract(uView[3].xy)).rgb);
    // --- TBN iz normal + random ---
    vec3 tangent   = normalize(randomVec - normal * dot(randomVec, normal));
    vec3 bitangent = cross(normal, tangent);
    mat3 TBN       = mat3(tangent, bitangent, normal);

    float occlusion = 0.0;
    vec3 bentNormal = vec3(0.0);
    float visibleSamples = 0.0;

    for(int i = 0; i < KERNEL_SIZE; ++i) {
        vec3 sampleVec = TBN * samples[i];
        vec3 samplePos = fragPos + sampleVec * radius;

        vec4 offset = uProjection * vec4(samplePos, 1.0);
        offset.xyz /= offset.w;
        offset.xyz = offset.xyz * 0.5 + 0.5;

        float sampleDepth = texture(gPosition, offset.xy).z;
        
       // adaptivni raspon na osnovu udaljenosti kamere
float depth = abs(fragPos.z);
float adapt = mix(6.0, 10.0, clamp(depth / 100.0, 0.0, 1.0));
float rangeCheck = smoothstep(0.0, adapt, radius / abs(fragPos.z - sampleDepth));


        // == ISPRAVLJENO: Saberi occ kao 1.0, NE 6.0!
        float occ = step(samplePos.z + bias, sampleDepth) * rangeCheck;
        occlusion += occ ;

        // == Bent normal: akumuliraj SAMO VIDLJIVE uzorke!
        if (occ < 0.5) {
            bentNormal += sampleVec;
            visibleSamples += 1.0;
        }
    }

    occlusion = 1.0 - (occlusion / float(KERNEL_SIZE));
    occlusion = clamp(occlusion, 0.0, 1.0);
    occlusion = pow(occlusion, power);  // pojačaj kontrast (menjaj power po potrebi)

    // == Normalize bent normal: ako nema vidljivih, vrati originalnu normalu
    if (visibleSamples > 0.0) {
        bentNormal = normalize(bentNormal / visibleSamples);
    } else {
        bentNormal = normal;
    }

    // == EKSPORT: RGB = bent normal ([0,1]), A = AO
    fragColor = vec4(bentNormal * 0.5 + 0.5, occlusion);
}
