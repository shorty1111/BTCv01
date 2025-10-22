#version 300 es
precision highp float;

in vec2 vUV;
out vec4 fragColor;

uniform sampler2D ssaoInput;
uniform sampler2D gPosition;
uniform sampler2D gNormal;

const int   blurSize = 1;
const float depthSigma  = 6.0;
const float normalSigma = 32.0;

void main() {
    vec2 texelSize = 1.0 / vec2(textureSize(ssaoInput, 0));

    float centerDepth = texture(gPosition, vUV).z;
    vec3  centerNormal = normalize(texture(gNormal, vUV).rgb);
    vec4  centerAO = texture(ssaoInput, vUV);

    vec4  sum = vec4(0.0);
    float weightSum = 0.0;

    for (int x = -blurSize; x <= blurSize; ++x) {
        for (int y = -blurSize; y <= blurSize; ++y) {
            vec2 offset = vec2(float(x), float(y)) * texelSize;
            vec2 uv = vUV + offset;

            float sampleDepth = texture(gPosition, uv).z;
            vec3  sampleNormal = normalize(texture(gNormal, uv).rgb);
            vec4  sampleAO = texture(ssaoInput, uv);

            float depthDiff  = abs(centerDepth - sampleDepth);
            float normalDiff = 1.0 - dot(centerNormal, sampleNormal);

            float wDepth  = exp(-pow(depthDiff * depthSigma, 2.0));
            float wNormal = exp(-pow(normalDiff * normalSigma, 2.0));
            float weight = wDepth * wNormal;

            sum += sampleAO * weight;
            weightSum += weight;
        }
    }

    fragColor = (weightSum > 0.0) ? (sum / weightSum) : centerAO;
}
