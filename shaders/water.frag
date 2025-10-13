#version 300 es
precision highp float;

// === INPUTI IZ VERTEXA ===
in vec3 vWorldPos;
in vec3 vNormal;
in float vWaveHeight;
in float vWaveMask;
in vec2 vUV;
in vec3 vTBN_T;
in vec3 vTBN_B;
in vec3 vTBN_N;

out vec4 fragColor;
uniform bool uIsReflectionPass;
// === UNIFORMI ===
uniform samplerCube uEnvTex;
uniform sampler2D   uReflectionTex;
uniform sampler2D   uShadowMap;
uniform sampler2D   uBRDFLUT;
uniform sampler2D   waterNormalTex;
uniform float       uTime;
uniform vec3        uCameraPos;
uniform vec3        uSunDir;
uniform vec3        uSunColor;
uniform float       uSunIntensity;
uniform float       uRoughness;
uniform float       uSpecularStrength;
uniform vec3        uDeepColor;
uniform vec3        uShallowColor;
uniform mat4        uLightVP;
uniform mat4        uReflectionMatrix;
uniform float       uWaterLevel;
uniform float       uBottomOffsetM;
uniform vec2        uReflectionTexSize;

// === PARAMETRI ===
const float DEPTH_SCALE     = 2.25;
const float DEPTH_CURVE     = 0.015;
const float SSS_STRENGTH    = 100.0;
const float SSS_WRAP        = 0.6;
const vec3  SSS_FALLOFF     = vec3(0.0431, 0.0667, 0.0667);
const float CREST_INTENSITY = 0.01;
const float CREST_BLEND     = 0.05;
const float FRESNEL_POWER   = 0.3;
const float DEPTH_CONTRAST  = 1.1;
const float HORIZON_REFL_STRENGTH = 0.4; // 0.0 = ništa, 1.0 = puna refleksija

// === FUNKCIJE ===
float sampleShadow(sampler2D sm, mat4 vp, vec3 wp) {
    vec4 lp = vp * vec4(wp, 1.0);
    vec3 pc = lp.xyz / max(lp.w, 1e-4) * 0.5 + 0.5;

    if (pc.x < 0.0 || pc.x > 1.0 || pc.y < 0.0 || pc.y > 1.0 || pc.z < 0.0 || pc.z > 1.0)
        return 1.0;

    float sh = 0.0;
    float texel = 1.0 / 64.0;
    int k = 2, c = 0;
    float bias = 0.002;
    float cd = pc.z - bias;

    for (int y = -k; y <= k; ++y)
    for (int x = -k; x <= k; ++x) {
        float sd = texture(sm, pc.xy + vec2(x, y) * texel).r;
        sh += step(cd, sd);
        c++;
    }
    return sh / float(c);
}

vec2 getPlanarReflectionUV(vec3 worldPos) {
    vec4 rc = uReflectionMatrix * vec4(worldPos, 1.0);
    rc.xyz /= max(rc.w, 1e-4);
    vec2 uv = rc.xy * 0.5 + 0.5;
    return clamp(uv, 0.001, 0.999);
}

vec3 fresnelSchlick(float cosTheta, vec3 F0) {
    return F0 + (1.0 - F0) * pow(1.0 - cosTheta, 5.0);
}

vec3 ACESFilm(vec3 x) {
    const float a = 2.51;
    const float b = 0.03;
    const float c = 2.43;
    const float d = 0.59;
    const float e = 0.14;
    return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

// === MAIN ===
void main() {
    
    // --- Dubina ---
    float depthM      = abs((vWorldPos.y - uWaterLevel) - uBottomOffsetM);
    float depthFactor = clamp(depthM / DEPTH_SCALE, 0.0, 1.0);

    // --- Normal mapa ---
    float normalStrength = 0.6;
    vec2 animUV1 = vUV * 3.0 + vec2(uTime * 0.04, uTime * 0.03);
    vec2 animUV2 = vUV * 2.2 - vec2(uTime * 0.03, uTime * 0.05);

    vec3 n1 = texture(waterNormalTex, animUV1).xyz * 2.0 - 1.0;
    vec3 n2 = texture(waterNormalTex, animUV2).xyz * 2.0 - 1.0;
    vec3 tangentNormal = normalize(mix(n1, n2, 0.5));
    tangentNormal.xy *= 2.0 * normalStrength * (1.0 - pow(depthFactor, 0.8));
    tangentNormal = normalize(tangentNormal);

    vec3 N = normalize(
        tangentNormal.x * vTBN_T +
        tangentNormal.y * vTBN_B +
        tangentNormal.z * vTBN_N
    );

    // --- Kamera, refleksija, svetlo ---
    vec3 V = normalize(uCameraPos - vWorldPos);
    vec3 R = normalize(reflect(-V, N) + N * 0.1);
    vec3 L = normalize(uSunDir);

    // --- Horizon fade ---
    float dist = length(uCameraPos - vWorldPos);

    
    float horizonFade = clamp(1.0 - abs(dot(N, V)), 0.0, 1.0);
    float distFade = clamp(1.0 - smoothstep(500.0, 5000.0, dist), 0.0, 1.0);
    float reflectionFadeRaw = horizonFade * distFade;

    // Fade samo blizu horizonta, ne blizu kamere
    float horizonSoftFade = mix(HORIZON_REFL_STRENGTH, 1.0, clamp(dot(N, V), 0.0, 1.0));
    float reflectionFade = reflectionFadeRaw * horizonSoftFade;
    reflectionFade = max(reflectionFade, 0.6); // nikad 0


    float fadeAA   = clamp(1.0 - smoothstep(0.0, 1000.0, dist), 0.0, 1.0);
    float roughFade   = mix(uRoughness, uRoughness * 0.0, 1.0 - fadeAA);
    float fresnelFade = mix(0.0, 0.5, fadeAA);

    // --- Bazna boja ---
    vec3 baseColor = mix(uShallowColor, uDeepColor, pow(depthFactor, DEPTH_CURVE));

    // --- Fresnel ---
    vec3 F0 = vec3(0.02);
    float NdotV = clamp(dot(N, V), 0.0, 1.0);
    float fresnel = F0.r + (1.0 - F0.r) * pow(1.0 - NdotV, 18.0);
    fresnel = clamp(fresnel, 0.0, 0.8);

    // --- Planarna refleksija ---
    vec2 reflUV = getPlanarReflectionUV(vWorldPos);
    float uvPerturb = mix(0.1, 0.01, 1.0 - reflectionFade);
    reflUV += normalize(N).xz * uvPerturb;
    vec3 planarReflection = texture(uReflectionTex, reflUV).rgb;

    // --- Environment refleksija ---
    const float MAX_MIP_ENV = 1.0;
    float lodEnv = clamp(uRoughness, 0.0, 1.0) * MAX_MIP_ENV;
    vec3 envRefl = textureLod(uEnvTex, normalize(R), lodEnv).rgb;

    // --- Kombinuj planar + env ---
    envRefl = mix(envRefl, planarReflection, fresnelFade * reflectionFade) * 0.8; // ovde prigusi refelskiju kao u wows

    // --- IBL BRDF integracija ---
    vec2 brdf = texture(uBRDFLUT, vec2(NdotV, uRoughness)).rg;
    vec3 F = fresnelSchlick(NdotV, F0);
    vec3 specIBL = envRefl * (F * brdf.r + brdf.g);

    // --- Fake SSS ---
    float backLit   = clamp((dot(-L, N) + SSS_WRAP) / (1.0 + SSS_WRAP), 0.0, 1.0);
    backLit         = smoothstep(0.0, 1.0, backLit);
    float sunFacing = pow(clamp(dot(V, -L), 0.0, 1.0), 15.0);

    vec3 warmTint  = vec3(1.0, 0.65, 0.3);
    vec3 sssColor  = mix(uShallowColor, warmTint, sunFacing * 0.8);
    vec3 falloff   = exp(-SSS_FALLOFF * depthM);
    vec3 sssLight  = uSunColor * sssColor * backLit * (1.0 - falloff) * sunFacing * 0.05;
    sssLight      *= SSS_STRENGTH;

    // --- Senke ---
    float shadow          = sampleShadow(uShadowMap, uLightVP, vWorldPos);
    float shadowStrength  = mix(0.35, 1.0, shadow);
    vec3  shadowTint      = mix(vec3(0.05, 0.1, 0.15), vec3(1.0), shadowStrength);

    // --- Specular highlight od sunca ---
    vec3  H          = normalize(V + L);
    float NdotH      = max(dot(N, H), 0.0);
    float highlight  = pow(NdotH, 1200.0) * mix(0.9, 1.0, fresnel);
    vec3  sunHighlight = uSunColor * highlight;

    // --- Crest ---
    float crest       = smoothstep(0.15, 0.9, vWaveHeight) * vWaveMask;
    vec3  crestTint   = mix(vec3(1.0), uShallowColor * 1.2, 0.5);
    vec3  crestColor  = baseColor + crestTint * crest * CREST_INTENSITY;
    baseColor         = mix(baseColor, crestColor, CREST_BLEND);

    // --- Dubinski gradient ---
    baseColor = mix(baseColor, baseColor * vec3(0.25, 0.3, 0.35), depthFactor) * uSunIntensity;

    // --- Final miks ---
    vec3 color = baseColor;
    color += sssLight;

    // Planar + env IBL + BRDF, uz Fresnel Power zadržan
    color += specIBL * uSpecularStrength * pow(fresnel, FRESNEL_POWER) * reflectionFade;

    // Sun highlight
    color += sunHighlight * fadeAA * reflectionFade;

    fragColor = vec4(color, 1.0);
}
