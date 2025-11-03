#version 300 es
precision highp float;

in vec2 vUV;
out vec4 fragColor;

uniform sampler2D ssaoInput;   // RGB = bent normal, A = AO
uniform sampler2D gPosition;
uniform sampler2D gNormal;

const int   blurSize = 1;      // radijus kernela (2 = 5x5)
const float depthSigma  = 1.0; // veće = mekši pad po dubini
const float normalSigma = 32.0; // veće = tolerantnije na promenu normale

void main() {
    vec2 texelSize = 1.0 / vec2(textureSize(ssaoInput, 0));

    float centerDepth  = texture(gPosition, vUV).z;
    vec3  centerNormal = normalize(texture(gNormal, vUV).rgb);

    // originalni bent i AO
    vec4  centerSample = texture(ssaoInput, vUV);
    vec3  centerBent   = centerSample.rgb;
    float centerAO     = centerSample.a;

    float sumAO = 0.0;
    float weightSum = 0.0;

    // bilateral blur po dubini i normali
    for (int x = -blurSize; x <= blurSize; ++x) {
        for (int y = -blurSize; y <= blurSize; ++y) {
            vec2 offset = vec2(float(x), float(y)) * texelSize;
            vec2 uv = vUV + offset;

            vec4  sampleVal = texture(ssaoInput, uv);
            float sampleAO = sampleVal.a;
            float sampleDepth = texture(gPosition, uv).z;
            vec3  sampleNormal = normalize(texture(gNormal, uv).rgb);

            float depthDiff  = abs(centerDepth - sampleDepth);
            float normalDiff = max(0.0, 1.0 - dot(centerNormal, sampleNormal));

            float wDepth  = exp(-depthDiff * depthSigma);
            float wNormal = exp(-normalDiff * normalSigma);
            float wSpatial = exp(-0.25 * float(x*x + y*y));

            float weight = wDepth * wNormal * wSpatial;

            sumAO     += sampleAO * weight;
            weightSum += weight;
        }
    }

    float blurredAO = sumAO / max(weightSum, 1e-5);

    // --- opcionalno: blago ublaži i bent (samo ako hoćeš)
    float blurBentAmount = 0.0; // 0.0 = ne muti bent, 1.0 = muti kao AO
    vec3 avgBent = texture(ssaoInput, vUV).rgb; // fallback vrednost
    if (blurBentAmount > 0.0) {
        vec3 sumBent = vec3(0.0);
        float sumW = 0.0;
        for (int x = -blurSize; x <= blurSize; ++x) {
            for (int y = -blurSize; y <= blurSize; ++y) {
                vec2 offset = vec2(float(x), float(y)) * texelSize;
                vec2 uv = vUV + offset;
                vec3 b = texture(ssaoInput, uv).rgb;

                float wSpatial = exp(-0.25 * float(x*x + y*y));
                sumBent += b * wSpatial;
                sumW += wSpatial;
            }
        }
        avgBent = mix(centerBent, sumBent / sumW, blurBentAmount);
    } else {
        avgBent = centerBent;
    }

    fragColor = vec4(clamp(avgBent, 0.0, 1.0), clamp(blurredAO, 0.0, 1.0));
}
