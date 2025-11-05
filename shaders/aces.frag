#version 300 es
precision highp float;

in vec2 vUV;
uniform sampler2D uInput;
out vec4 fragColor;

// 🎬 Standardni ACES fit (Narkowicz 2015)
vec3 ACESFilm(vec3 x) {
    float a = 2.51;
    float b = 0.03;
    float c = 1.43;
    float d = 0.59;
    float e = 0.14;
    return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

void main() {
    vec3 col = texture(uInput, vUV).rgb;
    
    // ✅ ACES tonemap
    col = ACESFilm(col);
    
    // ✅ Gamma correction
    col = pow(col, vec3(1.0 / 2.2));
    
    fragColor = vec4(col, 1.0);
}