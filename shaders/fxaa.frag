#version 300 es
precision highp float;

in vec2 vUV;

out vec4 fragColor;

uniform sampler2D uInput;
uniform vec2 uTexelSize;

// Malo stroži pragovi – manje blur, bolja zadrška detalja
const float fxaaQualityEdgeThreshold    = 0.05;
const float fxaaQualityEdgeThresholdMin = 0.016;
const vec3  LUMA = vec3(0.299, 0.587, 0.114);

float luminance(vec3 c) {
    return dot(c, LUMA);
}

void main() {
    vec3 rgbM = texture(uInput, vUV).rgb;
    float lumaM = luminance(rgbM);

    // 4-neighborhood
    float lumaN = luminance(texture(uInput, vUV + vec2(0.0, -uTexelSize.y)).rgb);
    float lumaS = luminance(texture(uInput, vUV + vec2(0.0,  uTexelSize.y)).rgb);
    float lumaW = luminance(texture(uInput, vUV + vec2(-uTexelSize.x, 0.0)).rgb);
    float lumaE = luminance(texture(uInput, vUV + vec2( uTexelSize.x, 0.0)).rgb);

    float rangeMin = min(lumaM, min(min(lumaN, lumaS), min(lumaW, lumaE)));
    float rangeMax = max(lumaM, max(max(lumaN, lumaS), max(lumaW, lumaE)));
    float range = rangeMax - rangeMin;

    // Brzo odustajanje – nema oštrih ivica
    if (range < max(fxaaQualityEdgeThresholdMin, rangeMax * fxaaQualityEdgeThreshold)) {
        fragColor = vec4(rgbM, 1.0);
        return;
    }

    // Dijagonale
    float lumaNW = luminance(texture(uInput, vUV + vec2(-uTexelSize.x, -uTexelSize.y)).rgb);
    float lumaNE = luminance(texture(uInput, vUV + vec2( uTexelSize.x, -uTexelSize.y)).rgb);
    float lumaSW = luminance(texture(uInput, vUV + vec2(-uTexelSize.x,  uTexelSize.y)).rgb);
    float lumaSE = luminance(texture(uInput, vUV + vec2( uTexelSize.x,  uTexelSize.y)).rgb);

    // Izračun smjera ivice
    vec2 dir;
    dir.x = -((lumaNW + lumaNE) - (lumaSW + lumaSE));
    dir.y =  ((lumaNW + lumaSW) - (lumaNE + lumaSE));

    // Manje “jittera” na ravnim površinama
    float lumaSum = lumaNW + lumaNE + lumaSW + lumaSE;
    float dirReduce = max(lumaSum * (0.25 * 0.04), 1.0 / 16384.0);
    float rcpMin = 1.0 / (min(abs(dir.x), abs(dir.y)) + dirReduce);

    // Malo kraći maksimalni radijus → manje prevelikog blur-a
    dir = clamp(dir * rcpMin, -6.0, 6.0) * uTexelSize;

    // Primarni uzorci – lagano zamućenje duž ivice
    vec3 rgbA = 0.5 * (
        texture(uInput, vUV + dir * (1.0 / 3.0 - 0.5)).rgb +
        texture(uInput, vUV + dir * (2.0 / 3.0 - 0.5)).rgb
    );

    // Sekundarni, sa malo većim rasponom
    vec3 rgbB = rgbA * 0.5 + 0.25 * (
        texture(uInput, vUV + dir * -0.5).rgb +
        texture(uInput, vUV + dir *  0.5).rgb
    );

    float lumaB  = luminance(rgbB);
    float lumaMin = min(rangeMin, min(lumaNW, min(lumaNE, min(lumaSW, lumaSE))));
    float lumaMax = max(rangeMax, max(lumaNW, max(lumaNE, max(lumaSW, lumaSE))));

    // Manje ghostinga: fallback na rgbA kada rgbB previše odstupa
    vec3 result = (lumaB < lumaMin || lumaB > lumaMax) ? rgbA : rgbB;

    fragColor = vec4(result, 1.0);
}
