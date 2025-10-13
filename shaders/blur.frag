#version 300 es
precision highp float;

in vec2 vUV;
out vec4 fragColor;

uniform sampler2D ssaoInput;
uniform sampler2D gPosition;
uniform sampler2D gNormal;

const int blurSize = 2; // 2 = 5x5 blur
const float depthThreshold = 0.2;
const float normalThreshold = 0.5;

void main() {
    vec2 texelSize = 1.0 / vec2(textureSize(ssaoInput, 0));

    float centerDepth = texture(gPosition, vUV).z;
    vec3 centerNormal = normalize(texture(gNormal, vUV).rgb);
    vec4 centerColor = texture(ssaoInput, vUV);

    vec4 sum = vec4(0.0);
    float weightSum = 0.0;

    for (int x = -blurSize; x <= blurSize; ++x) {
        for (int y = -blurSize; y <= blurSize; ++y) {
            vec2 offset = vec2(float(x), float(y)) * texelSize;
            vec2 sampleUV = vUV + offset;

            float sampleDepth = texture(gPosition, sampleUV).z;
            vec3 sampleNormal = normalize(texture(gNormal, sampleUV).rgb);
            vec4 sampleAO = texture(ssaoInput, sampleUV);

            float depthDiff = abs(centerDepth - sampleDepth);
            float normalDiff = 1.0 - dot(centerNormal, sampleNormal);

            // Uslov da ne blendujemo preko ivice
            if (depthDiff < depthThreshold && normalDiff < normalThreshold) {
                float weight = 1.0 - depthDiff; // možeš i exp(-depthDiff * scale)
                sum += sampleAO * weight;
                weightSum += weight;
            }
        }
    }

    // Ako nema sličnih suseda, fallback na original
    if (weightSum > 0.0) {
        fragColor = sum / weightSum;
    } else {
        fragColor = centerColor;
    }
}
