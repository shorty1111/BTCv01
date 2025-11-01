#version 300 es
precision highp float;

in vec2 vUV;
out vec4 fragColor;

uniform sampler2D ssaoInput;
uniform sampler2D gPosition;
uniform sampler2D gNormal;

const int   blurSize = 2;
const float depthSigma  = 1.0;   // manja vrednost jer koristimo exp() težinu
const float normalSigma = 16.0;  // manja vrednost jer koristimo exp()

void main() {
    vec2 texelSize = 1.0 / vec2(textureSize(ssaoInput, 0));

    float centerDepth = texture(gPosition, vUV).z;
    vec3  centerNormal = normalize(texture(gNormal, vUV).rgb);
    vec4  centerAO = texture(ssaoInput, vUV);

    vec4  sum = vec4(0.0);
    float weightSum = 0.0;

    // gaussian falloff po udaljenosti
    for (int x = -blurSize; x <= blurSize; ++x) {
        for (int y = -blurSize; y <= blurSize; ++y) {
            vec2 offset = vec2(float(x), float(y)) * texelSize;
            vec2 uv = vUV + offset;

            vec4  sampleAO = texture(ssaoInput, uv);
            float sampleDepth = texture(gPosition, uv).z;
            vec3  sampleNormal = normalize(texture(gNormal, uv).rgb);

            // depth diff u view-space metara, ne world
            float depthDiff = abs(centerDepth - sampleDepth);
            float normalDiff = max(0.0, 1.0 - dot(centerNormal, sampleNormal));

            // smooth falloff (exp umesto reciprocal)
            float wDepth  = exp(-depthDiff * depthSigma * 60.0);
            float wNormal = exp(-normalDiff * normalSigma);

            // kombinuj sa prostornom distancom (klasični Gaussian kernel)
            float wSpatial = exp(-0.25 * float(x*x + y*y)); // veći radijus
            float weight = wDepth * wNormal * wSpatial;

            sum += sampleAO * weight;
            weightSum += weight;
        }
    }

    vec4 ao = sum / max(weightSum, 1e-5);
    fragColor = clamp(ao, 0.0, 1.0);
}
