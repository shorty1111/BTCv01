#version 300 es
precision highp float;

in vec2 vUV;
uniform sampler2D uInput;
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

    // --- ACES tonemap ---
    col = ACESFilm(col);

    // --- EVE-like filmic tweaks ---
    col = pow(col, vec3(1.0));                 // zgnječi midtone, oštriji kontrast
    col *= vec3(1.25, 1.2, 1.15);               // lagano topli bias (kao EVE)
    float lift = 0.04;                          // minimalni “fog” u crnim
    col = mix(vec3(lift), col, 0.780);            
    col = mix(col, ACESFilm(col * 1.2), 0.85);  // punch saturacija + rolloff
    col = pow(col, vec3(1.0 / 2.2));            // gamma

    fragColor = vec4(col, 1.0);
}
