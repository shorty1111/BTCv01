#version 300 es
precision highp float;

in vec3 vWorldPos;
in vec3 vNormal;
out vec4 fragColor;

uniform samplerCube uEnvMap;
uniform vec3  uCameraPos;
uniform vec3  uSunDir;
uniform vec3  uSunColor;
uniform float uSunIntensity;

uniform mat4  uView;
uniform vec3  uBaseColor;
uniform float uRoughness;
uniform float uOpacity;
uniform float uIOR;

vec3 fresnelSchlick(float cosTheta, vec3 F0) {
    return F0 + (1.0 - F0) * pow(1.0 - cosTheta, 5.0);
}

void main() {
    mat3 view3 = mat3(uView);
    mat3 invView3 = transpose(view3);

    vec3 Nw = normalize(vNormal);
    vec3 Vw = normalize(uCameraPos - vWorldPos);
    vec3 Nv = normalize(view3 * Nw);
    vec3 Vv = normalize(view3 * -Vw);
    vec3 Rv = reflect(Vv, Nv);
    vec3 Rw = normalize(invView3 * Rv);
    Rw.x = -Rw.x; // flip za left-handed env map

    float lod = mix(1.0, 6.0, clamp(uRoughness, 0.0, 1.0));
    vec3 reflected = textureLod(uEnvMap, Rw, lod).rgb;

    float NoV = clamp(dot(Nw, Vw), 0.0, 1.0);
    float f0 = pow((1.0 - uIOR) / (1.0 + uIOR), 2.0);
    vec3 F = fresnelSchlick(NoV, mix(vec3(f0),  vec3(0.2), 0.15));

    // 🔹 Blago propuštanje svetla (transmission ton)
    vec3 transmission = vec3(0.2) * (0.0 + 0.1 * (1.0 - uRoughness));

    // 🔹 Spoji sve sa kontrolisanim kontrastom
    vec3 color = mix(transmission, reflected, F * 0.6);

    // 🔹 Tamniji ivice i malo saturacije
    float edgeDarken = pow(1.0 - NoV, 2.0);
    color = mix(color, color * 0.5, edgeDarken);
    color = clamp(color, 0.0, 1.0);

    fragColor = vec4(color, uOpacity);
}
