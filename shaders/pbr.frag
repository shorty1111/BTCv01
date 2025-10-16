#version 300 es
precision highp float;

in vec2 vUV;
out vec4 fragColor;

// --- G-buffer i uniformi ---
uniform sampler2D gPosition, gNormal, gAlbedo, gMaterial;
uniform sampler2D tBentNormalAO;        
uniform samplerCube uEnvMap;
uniform sampler2D uBRDFLUT;
uniform sampler2D uShadowMap;
uniform sampler2D uReflectionTex;
uniform mat4 uReflectionMatrix;
uniform mat4 uView, uLightVP, uProjection;
uniform vec3 uCameraPos;
uniform vec3 uSunDir, uSunColor;
uniform float uSunIntensity;

uniform float uBiasBase, uBiasSlope;
uniform float uLightSize;
uniform float uCubeMaxMip;
uniform vec2 uShadowMapSize;

// === Helper funkcije ===
float hash12(vec2 p){ return fract(sin(dot(p, vec2(27.167,91.453)))*43758.5453); }

vec3 fresnelSchlick(float cosTheta, vec3 F0){
    return F0 + (1.0 - F0) * pow(1.0 - cosTheta, 5.0);
}
vec3 fresnelSchlickRoughness(float cosTheta, vec3 F0, float roughness){
    return F0 + (max(vec3(1.0 - roughness), F0) - F0) * pow(1.0 - cosTheta, 5.0);
}
float geometrySmith(float NdotV, float NdotL, float roughness){
    float r = roughness + 1.0;
    float k = (r*r) / 8.0;
    float GL = NdotL / (NdotL * (1.0 - k) + k);
    float GV = NdotV / (NdotV * (1.0 - k) + k);
    return GL * GV;
}
float distributionGGX(vec3 N, vec3 H, float roughness){
    float a = roughness * roughness;
    float a2 = a * a;
    float NdotH = max(dot(N, H), 0.0);
    float NdotH2 = NdotH * NdotH;
    float denom = (NdotH2 * (a2 - 1.0) + 1.0);
    return a2 / (3.141592 * denom * denom);
}

// === Senke (world varijanta - ne koristi se ovde, ali ispravljena) ===
float getShadow(vec3 Pw, vec3 Nw) {
    vec3 L = normalize(uSunDir);
    float cosTheta = max(dot(Nw, L), 0.0);
    float bias = max(uBiasBase, uBiasSlope * (1.0 - cosTheta));

    vec4 lp = uLightVP * vec4(Pw, 1.0); // bez pomeranja pozicije
    vec3 uvw = lp.xyz / lp.w * 0.5 + 0.5;
    if (uvw.x < 0.0 || uvw.x > 1.0 || uvw.y < 0.0 || uvw.y > 1.0 || uvw.z > 1.0)
        return 1.0;

    float shadow = 0.0;
    vec2 texel = 1.0 / uShadowMapSize;
    for (int y = -1; y <= 1; y++)
    for (int x = -1; x <= 1; x++) {
        vec2 offs = vec2(x, y) * texel;
        float d = texture(uShadowMap, uvw.xy + offs).r;
        shadow += step(uvw.z - bias, d);
    }
    shadow /= 9.0;               // bez smoothstep-a
    return shadow;
}

// === Senke (view → light) ===
float getShadowView(vec3 Pv, vec3 Nw) {
    vec3 L = normalize(uSunDir);
    float cosTheta = max(dot(Nw, L), 0.0);
    float bias = max(uBiasBase, uBiasSlope * (1.0 - cosTheta)); // compare-bias

    // projekcija bez pomeranja pozicije
    vec4 lp = uLightVP * inverse(uView) * vec4(Pv, 1.0);
    vec3 uvw = lp.xyz / lp.w * 0.5 + 0.5;

    if (uvw.x < 0.0 || uvw.x > 1.0 || uvw.y < 0.0 || uvw.y > 1.0 || uvw.z > 1.0)
        return 1.0;

    const vec2 poissonDisk[16] = vec2[](
        vec2(-0.94201624, -0.39906216),
        vec2( 0.94558609, -0.76890725),
        vec2(-0.09418410, -0.92938870),
        vec2( 0.34495938,  0.29387760),
        vec2(-0.91588581,  0.45771432),
        vec2(-0.81544232, -0.87912464),
        vec2(-0.38277543,  0.27676845),
        vec2( 0.97484398,  0.75648379),
        vec2( 0.44323325, -0.97511554),
        vec2( 0.53742981, -0.47373420),
        vec2(-0.26496911, -0.41893023),
        vec2( 0.79197514,  0.19090188),
        vec2(-0.24188840,  0.99706507),
        vec2(-0.81409955,  0.91437590),
        vec2( 0.19984126,  0.78641367),
        vec2( 0.14383161, -0.14100790)
    );

    float a = hash12(vUV) * 6.283185;
    mat2 rot = mat2(cos(a), -sin(a), sin(a), cos(a));

    vec2 texel = 1.0 / uShadowMapSize;
    float radius = mix(2.5, 3.0, 1.0 - cosTheta); // ovde zamutis senku

    float shadow = 0.0;
    for (int i = 0; i < 16; i++) {
        vec2 offs = rot * poissonDisk[i] * radius * texel;
        float d = texture(uShadowMap, uvw.xy + offs).r;
        shadow += step(uvw.z - bias, d);
    }
    shadow /= 16.0;              // bez smoothstep-a
    return shadow;
}

void main(){
    vec3 fragPosV = texture(gPosition, vUV).rgb;
    if(length(fragPosV) < 1e-5) discard;

    // --- G-buffer ---
    vec3 normalV = normalize(texture(gNormal, vUV).rgb);
    vec4 albedoTex = texture(gAlbedo, vUV);
    vec3 baseColor = albedoTex.rgb;
    vec4 matTex = texture(gMaterial, vUV);
    float roughness = clamp(matTex.r, 0.04, 1.0);
    float metalness = clamp(matTex.g, 0.0, 1.0);

    vec4 bentNormalAO = texture(tBentNormalAO, vUV);
    vec3 bentNormal = normalize(bentNormalAO.rgb * 2.0 - 1.0);
    float ao = bentNormalAO.a;

    // --- prostori ---
    vec3 N = normalize(normalV);                 // view-space normal
    mat3 view3    = mat3(uView);
    mat3 invView3 = transpose(view3);            // pretpostavka: ortonormalan view

    vec3 Nw = normalize(invView3 * N);
    vec3 bentNormalWorld = normalize(invView3 * bentNormal);

    vec3 V = normalize(-fragPosV);               // view-space
    // KLJUČNO: Sunce u view-space
    vec3 Lv = normalize(view3 * normalize(uSunDir));
    vec3 H  = normalize(V + Lv);

    // refleksija (ispravka: incident je -V)
    vec3 Rv = reflect(-V, N);
    vec3 Rw = invView3 * Rv;


    float shadow = getShadowView(fragPosV, Nw);
    float NdotL = max(dot(N, Lv), 0.0);
    float NdotV = max(dot(N, V ), 0.0);

    // --- PBR ---
    vec3 dielectricF0 = vec3(0.04);
    vec3 F0 = mix(dielectricF0, baseColor, metalness);

    float D = distributionGGX(N, H, roughness);
    float G = geometrySmith(NdotV, NdotL, roughness);
    vec3  F = fresnelSchlickRoughness(max(dot(H, V), 0.0), F0, roughness);
    vec3  numerator = D * G * F;
    float denominator = 4.0 * NdotV * NdotL + 0.001;
    vec3  specularBRDF = numerator / denominator;

    vec3 kd = (1.0 - F) * (1.0 - metalness);
    vec3 diffuse = kd * baseColor / 3.141592;
    vec3 radiance = uSunColor * uSunIntensity;

    vec3 directLight = (diffuse + specularBRDF) * radiance * NdotL * (shadow * 1.50);

    // --- IBL ---
    vec3 envDiffuse = textureLod(uEnvMap, normalize(bentNormalWorld), uCubeMaxMip * 0.98).rgb;
    float mip = clamp(roughness * uCubeMaxMip, 0.0, uCubeMaxMip);
    vec3 envSpecular = textureLod(uEnvMap, normalize(Rw), mip).rgb;
    vec2 brdf = texture(uBRDFLUT, vec2(NdotV, roughness)).rg;

    vec3 F_IBL = fresnelSchlickRoughness(NdotV, F0, roughness);
    vec3 diffuseIBL  = envDiffuse * baseColor * (1.0 - metalness);
    vec3 specularIBL = envSpecular * (F_IBL * brdf.x + brdf.y);

    float glossBoost = smoothstep(0.0, 0.4, 1.0 - roughness);
    specularIBL *= 1.0 + glossBoost * 1.8;
    specularIBL *=shadow;
    vec3 ambient = (diffuseIBL + specularIBL) * ao;
    vec3 color = directLight + ambient;

    fragColor = vec4(vec3(color), 1.0);
}
