#version 300 es
precision highp float;

in vec2 vUV;
in vec3 vNormal;
in vec3 vWorldPos;

uniform vec3 uBaseColor;
uniform sampler2D uBaseColorTex;
uniform bool uUseBaseColorTex;

uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform float uSunIntensity;

uniform samplerCube uEnvMap;
uniform float uRoughness;
uniform float uSpecularStrength;
uniform vec3 uCameraPos;
uniform float uGlobalExposure;

out vec4 fragColor;

vec3 fresnelSchlick(float cosTheta, vec3 F0){
    return F0 + (1.0 - F0) * pow(1.0 - cosTheta, 5.0);
}
float DistributionGGX(float NdotH, float a){
    float a2 = a*a;
    float ndh2 = NdotH*NdotH;
    float d = ndh2 * (a2 - 1.0) + 1.0;
    return a2 / (3.14159265 * d * d);
}
float GeometrySchlickGGX(float NdotV, float a){
    float k = (a*a) * 0.5;
    return NdotV / (NdotV * (1.0 - k) + k);
}
float GeometrySmith(float NdotV, float NdotL, float a){
    return GeometrySchlickGGX(NdotV,a) * GeometrySchlickGGX(NdotL,a);
}

void main() {
    // Albedo
    vec3 albedo = uUseBaseColorTex ? pow(texture(uBaseColorTex, vUV).rgb, vec3(2.2)) : uBaseColor;
    vec3 N = normalize(vNormal);
    vec3 V = normalize(uCameraPos - vWorldPos);
    vec3 L = normalize(uSunDir);
    vec3 H = normalize(V + L);
    vec3 R = reflect(-V, N);

    // PBR helpers
    float roughness = uRoughness;
    float metallic = 0.0;
    float nl = max(dot(N, L), 0.0);
    float nv = max(dot(N, V), 0.0);
    float nh = max(dot(N, H), 0.0);

    vec3 F0 = mix(vec3(0.04), albedo, metallic);
    vec3 F = fresnelSchlick(max(dot(H,V),0.0), F0);
    float G = GeometrySmith(nv, nl, roughness);
    float D = DistributionGGX(nh, roughness);
    vec3 specBRDF = (D * G * F) / max(4.0 * nv * nl, 0.001);
    vec3 kd = (1.0 - F) * (1.0 - metallic);

    // *** SUNCE - DESATURACIJA ***
    vec3 sunColor = mix(uSunColor, vec3(1.0), 0.25); // 25% manje saturacije

    // *** Smanji uticaj direktnog sunca (reflection pass) ***
    vec3 direct = (kd * albedo * nl + specBRDF * uSpecularStrength) * sunColor * uSunIntensity * uGlobalExposure;

    // Environment (refleksija i difuzno)
    float envMip = 7.0;
    vec3 envDiffuse = textureLod(uEnvMap, N, envMip).rgb;
    vec3 envSpecular = textureLod(uEnvMap, R, roughness * envMip).rgb;

    // Pojačaj ambient refleksiju
    vec3 color = direct + envDiffuse * kd * albedo + envSpecular * F * 1.05;

    fragColor = vec4(color, 1.0);
}
