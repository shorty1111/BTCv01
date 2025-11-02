#version 300 es
precision highp float;

in vec2 vUV;
out vec4 fragColor;

uniform sampler2D uCurrent;
uniform sampler2D uHistory;
uniform sampler2D uDepth;

uniform mat4 uCurrViewProj;
uniform mat4 uPrevViewProj;
uniform mat4 uInvCurrViewProj;
uniform float uBlendFactor;

void main() {
    float depth01 = texture(uDepth, vUV).r;
    if (depth01 <= 0.0 || depth01 >= 1.0) {
        fragColor = texture(uCurrent, vUV);
        return;
    }

    vec4 currClip = vec4(vUV * 2.0 - 1.0, depth01 * 2.0 - 1.0, 1.0);
    vec4 currPos  = uInvCurrViewProj * currClip;
    currPos /= currPos.w;

    vec4 prevClip = uPrevViewProj * currPos;
    float w = prevClip.w;
    if (abs(w) < 1e-6) {
        fragColor = texture(uCurrent, vUV);
        return;
    }
    vec2 prevUV = prevClip.xy / w * 0.5 + 0.5;

    if (any(lessThan(prevUV, vec2(0.0))) || any(greaterThan(prevUV, vec2(1.0)))) {
        fragColor = texture(uCurrent, vUV);
        return;
    }

    vec3 curr = texture(uCurrent, vUV).rgb;
    vec3 hist = texture(uHistory, prevUV).rgb;

    vec3 result = mix(curr, hist, uBlendFactor);
    fragColor = vec4(result, 1.0);
}
