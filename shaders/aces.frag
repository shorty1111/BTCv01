#version 300 es
precision highp float;

in vec2 vUV;
uniform sampler2D uInput;
uniform sampler2D uBloom;
out vec4 fragColor;

vec3 ACESFilm(vec3 x) {
float a = 1.8;
float b = 0.04;
float c = 1.8;
float d = 0.25;
float e = 0.1;
    return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

void main() {
    vec3 col = texture(uInput, vUV).rgb;
    vec3 bloom = texture(uBloom, vUV).rgb;

    // HDR blend pre tonemap
    col += bloom * 0.8;

    // ACES tonemap
col = ACESFilm(col);
col = pow(col, vec3(1.0));
col *= vec3(1.15, 1.1, 1.1);
float lift = 0.08;
col = mix(vec3(lift), col, 0.88);
col = mix(col, ACESFilm(col * 1.1), 0.5);
float luma = dot(col, vec3(0.299,0.587,0.114));
col = mix(vec3(luma), col, 0.9);
col = pow(col, vec3(1.0 / 2.2));
    fragColor = vec4(col, 1.0);
}
