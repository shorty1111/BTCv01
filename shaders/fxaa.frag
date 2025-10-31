#version 300 es
precision highp float;

in vec2 vUV;
in vec2 sampleCoordS;
in vec2 sampleCoordE;
in vec2 sampleCoordN;
in vec2 sampleCoordW;
in vec2 sampleCoordNW;
in vec2 sampleCoordSE;
in vec2 sampleCoordNE;
in vec2 sampleCoordSW;

out vec4 fragColor;

uniform sampler2D uInput;
uniform vec2 uTexelSize;

const float fxaaQualitySubpix = 1.0;
const float fxaaQualityEdgeThreshold = 0.166;
const float fxaaQualityEdgeThresholdMin = 0.0833;
const vec3 kLumaCoefficients = vec3(0.2126, 0.7152, 0.0722);
#define FxaaLuma(rgba) dot(rgba.rgb, kLumaCoefficients)

void main() {
    vec4 rgbyM = texture(uInput, vUV);
    float lumaM = FxaaLuma(rgbyM);
    float lumaS = FxaaLuma(texture(uInput, sampleCoordS));
    float lumaE = FxaaLuma(texture(uInput, sampleCoordE));
    float lumaN = FxaaLuma(texture(uInput, sampleCoordN));
    float lumaW = FxaaLuma(texture(uInput, sampleCoordW));

    float maxSM = max(lumaS, lumaM);
    float minSM = min(lumaS, lumaM);
    float maxESM = max(lumaE, maxSM);
    float minESM = min(lumaE, minSM);
    float maxWN = max(lumaN, lumaW);
    float minWN = min(lumaN, lumaW);
    float rangeMax = max(maxWN, maxESM);
    float rangeMin = min(minWN, minESM);
    float rangeMaxScaled = rangeMax * fxaaQualityEdgeThreshold;
    float range = rangeMax - rangeMin;
    float rangeMaxClamped = max(fxaaQualityEdgeThresholdMin, rangeMaxScaled);

    if (range < rangeMaxClamped) {
        fragColor = rgbyM;
        return;
    }

    float lumaNW = FxaaLuma(texture(uInput, sampleCoordNW));
    float lumaSE = FxaaLuma(texture(uInput, sampleCoordSE));
    float lumaNE = FxaaLuma(texture(uInput, sampleCoordNE));
    float lumaSW = FxaaLuma(texture(uInput, sampleCoordSW));

    vec2 dir;
    dir.x = -((lumaNW + lumaNE) - (lumaSW + lumaSE));
    dir.y =  ((lumaNW + lumaSW) - (lumaNE + lumaSE));

    float dirReduce = max((lumaNW + lumaNE + lumaSW + lumaSE) * 0.25 * 0.05, 1.0/2048.0);
    float rcpDirMin = 1.0 / (min(abs(dir.x), abs(dir.y)) + dirReduce);
    dir = clamp(dir * rcpDirMin, -8.0, 8.0) * uTexelSize;

    vec3 rgbA = 0.5 * (
        texture(uInput, vUV + dir * (1.0 / 3.0 - 0.5)).rgb +
        texture(uInput, vUV + dir * (2.0 / 3.0 - 0.5)).rgb
    );

    vec3 rgbB = rgbA * 0.5 + 0.25 * (
        texture(uInput, vUV + dir * -0.5).rgb +
        texture(uInput, vUV + dir * 0.5).rgb
    );

    float lumaB = FxaaLuma(vec4(rgbB,1.0));
    float lumaMin = min(lumaM, min(min(lumaNW, lumaNE), min(lumaSW, lumaSE)));
    float lumaMax = max(lumaM, max(max(lumaNW, lumaNE), max(lumaSW, lumaSE)));

    fragColor = vec4((lumaB < lumaMin || lumaB > lumaMax) ? rgbA : rgbB, 1.0);
}
