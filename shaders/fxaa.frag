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

const float fxaaQualityEdgeThreshold    = 0.125;
const float fxaaQualityEdgeThresholdMin = 0.0625;
const vec3  LUMA = vec3(0.299, 0.587, 0.114);

float luminance(vec3 c) { return dot(c, LUMA); }

void main() {
    vec3 rgbM = texture(uInput, vUV).rgb;
    float lumaM = luminance(rgbM);

    float lumaS = luminance(texture(uInput, sampleCoordS).rgb);
    float lumaE = luminance(texture(uInput, sampleCoordE).rgb);
    float lumaN = luminance(texture(uInput, sampleCoordN).rgb);
    float lumaW = luminance(texture(uInput, sampleCoordW).rgb);

    float rangeMin = min(lumaM, min(min(lumaN, lumaS), min(lumaW, lumaE)));
    float rangeMax = max(lumaM, max(max(lumaN, lumaS), max(lumaW, lumaE)));
    float range = rangeMax - rangeMin;

    if (range < max(fxaaQualityEdgeThresholdMin, rangeMax * fxaaQualityEdgeThreshold)) {
        fragColor = vec4(rgbM, 1.0);
        return;
    }

    float lumaNW = luminance(texture(uInput, sampleCoordNW).rgb);
    float lumaNE = luminance(texture(uInput, sampleCoordNE).rgb);
    float lumaSW = luminance(texture(uInput, sampleCoordSW).rgb);
    float lumaSE = luminance(texture(uInput, sampleCoordSE).rgb);

    vec2 dir;
    dir.x = -((lumaNW + lumaNE) - (lumaSW + lumaSE));
    dir.y =  ((lumaNW + lumaSW) - (lumaNE + lumaSE));

    float dirReduce = max((lumaNW + lumaNE + lumaSW + lumaSE) * 0.25 * 0.03, 1.0 / 2048.0);
    float rcpMin = 1.0 / (min(abs(dir.x), abs(dir.y)) + dirReduce);
    dir = clamp(dir * rcpMin, -8.0, 8.0) * uTexelSize;

    vec3 rgbA = 0.5 * (
        texture(uInput, vUV + dir * (1.0 / 3.0 - 0.5)).rgb +
        texture(uInput, vUV + dir * (2.0 / 3.0 - 0.5)).rgb
    );

    vec3 rgbB = rgbA * 0.5 + 0.25 * (
        texture(uInput, vUV + dir * -0.5).rgb +
        texture(uInput, vUV + dir *  0.5).rgb
    );

    float lumaB = luminance(rgbB);
    float lumaMin = min(lumaM, min(min(lumaNW, lumaNE), min(lumaSW, lumaSE)));
    float lumaMax = max(lumaM, max(max(lumaNW, lumaNE), max(lumaSW, lumaSE)));

    vec3 result = (lumaB < lumaMin || lumaB > lumaMax) ? rgbA : rgbB;
    fragColor = vec4(result, 1.0);
}
