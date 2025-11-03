#version 300 es
precision highp float;

in vec2 vUV;
out vec4 fragColor;

uniform sampler2D tSSAO;
uniform vec2 uTexelSize;

void main() {
    float ao = 0.0;

    // centar
    ao += texture(tSSAO, vUV).a * 0.4;

    // 4 dijagonale
    ao += texture(tSSAO, vUV + uTexelSize * vec2(1.0, 1.0)).a * 0.15;
    ao += texture(tSSAO, vUV + uTexelSize * vec2(-1.0, 1.0)).a * 0.15;
    ao += texture(tSSAO, vUV + uTexelSize * vec2(1.0, -1.0)).a * 0.15;
    ao += texture(tSSAO, vUV + uTexelSize * vec2(-1.0, -1.0)).a * 0.15;

    fragColor = vec4(vec3(1.0), ao);
}
