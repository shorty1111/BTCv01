#version 300 es
precision highp float;

in vec3 vWorldPos;
in vec3 vNormal;
out vec4 fragColor;

// UNIFORMI
uniform samplerCube uEnvTex;
uniform vec3  uCameraPos;
uniform vec3  uSunDir;
uniform vec3  uSunColor;
uniform float uSunIntensity;

uniform vec3  uBaseColor;    // koristi NIKAD (1,1,1) ni (0,0,0), neka bude 0.8-0.98
uniform float uRoughness;    // 0.01-0.15
uniform float uOpacity;      // 0.04-0.12 za staklo
uniform float uExposure;     // 0.7 - 1.0 za normalno osvetljenje

// === ACES tonemap ===
vec3 ACESFilm(vec3 x){
    const float a=2.51, b=0.03, c=2.43, d=0.59, e=0.14;
    return clamp((x*(a*x+b))/(x*(c*x+d)+e),0.0,1.0);
}
vec3 fresnelSchlick(float cosT, vec3 F0){
    return F0 + (1.0 - F0) * pow(1.0 - cosT, 5.0);
}

void main() {
    vec3 N = normalize(vNormal);
    vec3 V = normalize(uCameraPos - vWorldPos);
    vec3 L = normalize(-uSunDir);
    float NoV = max(dot(N, V), 0.0);

    // Refleksija iz okoline (HDR sky cubemap)
    vec3 R = reflect(-V, N);
    float lod = mix(0.0, 6.0, clamp(uRoughness, 0.0, 1.0));
    vec3 envCol = textureLod(uEnvTex, normalize(R), lod).rgb;

    // Fresnel
    vec3 F0 = vec3(0.04); // staklo
    float fres = pow(1.0 - NoV, 5.0);
    vec3 fresCol = mix(uBaseColor, envCol, fres);

    // Dodatni sun specular
    float sunDot = clamp(dot(R, L), 0.0, 1.0);
    fresCol += uSunColor * pow(sunDot, 256.0) * uSunIntensity * 0.17;

    // ACES tonemapping + gamma
    vec3 mapped = ACESFilm(fresCol * uExposure);
    mapped = pow(mapped, vec3(1.0/2.2));

    fragColor = vec4(mapped, uOpacity);
}
