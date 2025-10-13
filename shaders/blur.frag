#version 300 es
precision highp float;
in vec2 vUV;
out vec4 fragColor;

uniform sampler2D ssaoInput;
const int blurSize = 2; // probaj sa 2

void main() {
    vec2 texelSize = 1.0 / vec2(textureSize(ssaoInput, 0));
    vec4 sum = vec4(0.0);
    int count = 0;
    for (int x = -blurSize/2; x <= blurSize/2; ++x) {
        for (int y = -blurSize/2; y <= blurSize/2; ++y) {
            vec2 offset = vec2(float(x), float(y)) * texelSize;
            sum += texture(ssaoInput, vUV + offset);
            count++;
        }
    }
    fragColor = sum / float(count);
}
