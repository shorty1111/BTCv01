#version 300 es
precision highp float;

in vec2 vUV;
uniform sampler2D uInput;
uniform sampler2D uBloom;
out vec4 fragColor;

vec3 ACESFilm(vec3 x) {
    float a = 2.51;
    float b = 0.03;
    float c = 2.43;
    float d = 0.59;
    float e = 0.14;
    return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

void main() {
    vec3 col = texture(uInput, vUV).rgb;
    vec3 bloom = texture(uBloom, vUV).rgb;

    // HDR blend pre tonemap
    col += bloom * 0.4;

    // ACES tonemap
    col = ACESFilm(col);

    // EVE-like filmic tweaks
    col = pow(col, vec3(1.0));
    col *= vec3(1.25, 1.2, 1.15);
    float lift = 0.05;
    col = mix(vec3(lift), col, 0.880);
    col = mix(col, ACESFilm(col * 1.2), 0.65);
    col = pow(col, vec3(1.0 / 2.2));

    fragColor = vec4(col, 1.0);
}
