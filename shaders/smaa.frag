#version 300 es
precision highp float;

in vec2 vUV;
out vec4 fragColor;

uniform sampler2D uInput;
uniform vec2 uInvResolution;

// simple SMAA-like edge blend (1-pass)
float luminance(vec3 c){ return dot(c, vec3(0.299, 0.587, 0.114)); }

void main() {
    vec2 texel = uInvResolution;
    vec3 cM = texture(uInput, vUV).rgb;
    float lM = luminance(cM);
    float lN = luminance(texture(uInput, vUV + vec2(0.0, -texel.y)).rgb);
    float lS = luminance(texture(uInput, vUV + vec2(0.0,  texel.y)).rgb);
    float lE = luminance(texture(uInput, vUV + vec2( texel.x, 0.0)).rgb);
    float lW = luminance(texture(uInput, vUV + vec2(-texel.x, 0.0)).rgb);

    // edge detection
    float edgeH = abs(lE - lW);
    float edgeV = abs(lN - lS);
    float edge = max(edgeH, edgeV);

    // adaptive blending weight
    float weight = smoothstep(0.05, 0.2, edge);

    // sample along gradient direction
    vec2 dir = normalize(vec2(edgeH, edgeV) + 1e-6);
    vec3 cA = texture(uInput, vUV + dir * texel * 0.5).rgb;
    vec3 cB = texture(uInput, vUV - dir * texel * 0.5).rgb;

    vec3 blended = mix(cM, (cA + cB) * 0.5, weight);
    fragColor = vec4(blended, 1.0);
}
