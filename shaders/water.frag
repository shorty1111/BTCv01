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
const float DEPTH_SCALE     = 6.4;
const float DEPTH_CURVE     = 0.03;
const float SSS_STRENGTH    = 60.0;
const float SSS_WRAP        = 1.9;
const vec3  SSS_FALLOFF     = vec3(0.0431, 0.0667, 0.0667);
const float CREST_INTENSITY = 0.21;
const float CREST_BLEND     = 0.05;

const float DEPTH_CONTRAST  = 1.9;
const float HORIZON_REFL_STRENGTH = 1.0;


vec2 getPlanarReflectionUV(vec3 worldPos) {
    vec4 rc = uReflectionMatrix * vec4(worldPos, 1.0);
    rc.xyz /= max(rc.w, 1e-4);
    vec2 uv = rc.xy * 0.5 + 0.5;
    return clamp(uv, 0.001, 0.999);
}

vec3 fresnelSchlick(float cosTheta, vec3 F0) {
    return F0 + (1.0 - F0) * pow(1.0 - cosTheta, 5.0);
}

// === MAIN ===
void main() {

    // --- Dubina ---
    float depthM      = abs((vWorldPos.y - uWaterLevel) - uBottomOffsetM);
    float depthFactor = clamp(depthM / DEPTH_SCALE, 0.0, 1.0);

    // --- Normal mapa (2 animirane) ---
    vec2 animUV1 = vUV * 1.0 + vec2(uTime * 0.02,  uTime * 0.05);
    vec2 animUV2 = vUV * 0.6 - vec2(uTime * 0.01, -uTime * 0.005);
    vec3 n1 = texture(waterNormalTex, animUV1).xyz * 2.0 - 1.0;
    vec3 n2 = texture(waterNormalTex, animUV2).xyz * 2.0 - 1.0;
    vec3 tangentNormal = normalize(mix(n1, n2, 0.5));

    float df = clamp(depthM / (DEPTH_SCALE * 1.5), 0.0, 1.0);
    float fade = mix(1.0, 0.4, pow(df, 0.5));
    tangentNormal.xy *= 0.75 * fade;

    vec3 N = normalize(
        tangentNormal.x * vTBN_T +
        tangentNormal.y * vTBN_B +
        tangentNormal.z * vTBN_N
    );

    // --- Kamera, svetlo, refleksija ---
    vec3 V = normalize(uCameraPos - vWorldPos);
    vec3 L = normalize(uSunDir);
    vec3 R = normalize(reflect(-V, N) + N * 0.1);

    // --- Horizon fade ---
    float dist = length(uCameraPos - vWorldPos);
    float horizonFade = clamp(1.0 - abs(dot(N, V)), 0.0, 1.0);
    float distFade = clamp(1.0 - smoothstep(100.0, 2000.0, dist), 0.0, 1.0);
    float reflectionFade = horizonFade * distFade;
    reflectionFade = mix(HORIZON_REFL_STRENGTH, 1.0, pow(reflectionFade, 0.7));

    // --- Bazna boja ---
    vec3 baseColor = mix(uShallowColor, uDeepColor, pow(depthFactor, DEPTH_CURVE));

    // --- Fresnel ---
    vec3 F0 = vec3(0.02);
    float NdotV = clamp(dot(N, V), 0.0, 1.0);
    float fresnel = F0.r + (1.0 - F0.r) * pow(1.0 - NdotV, 5.0);

    // --- Planarna refleksija ---
    vec2 reflUV = getPlanarReflectionUV(vWorldPos);

    // dodaj realnu distorziju refleksije na osnovu normal map-e
    vec2 distortion = N.xz * 0.08;   // 0.05–0.12 zavisno od talasa
    reflUV += distortion;

    // clamp da ne izbiješ iz FBO-a
    reflUV = clamp(reflUV, 0.001, 0.999);

vec3 planarReflection = texture(uReflectionTex, reflUV).rgb;

// ton-map da ne pregori svetlo, ali zadrži tamno
planarReflection = pow(planarReflection, vec3(0.8));  // kompresuj energiju
planarReflection *= 0.6;                              // globalni damping



    // --- Environment refleksija ---
    vec3 envRefl = textureLod(uEnvTex, normalize(R), uRoughness).rgb;

    // --- Kombinuj planar + env ---
    envRefl = mix(envRefl, planarReflection, reflectionFade);

    // --- IBL BRDF ---
    vec2 brdf = texture(uBRDFLUT, vec2(NdotV, uRoughness)).rg;
    vec3 F = fresnelSchlick(NdotV, F0);
    vec3 specIBL = envRefl * (F * brdf.r + brdf.g);

    // --- Fake SSS ---
    float backLit   = clamp((dot(-L, N) + SSS_WRAP) / (1.0 + SSS_WRAP), 0.0, 1.0);
    backLit         = smoothstep(0.15, 0.98, backLit);
    float sunFacing = pow(clamp(dot(V, -L), 0.0, 1.0), 4.0);
    vec3 warmTint   = vec3(1.0, 0.65, 0.3);
    vec3 sssColor   = mix(uShallowColor, warmTint, sunFacing * 0.8);
    vec3 falloff    = exp(-SSS_FALLOFF * depthM);
    vec3 sssLight   = uSunColor * sssColor * backLit * (1.0 - falloff) * sunFacing * 0.05;
    sssLight       *= SSS_STRENGTH * uSunIntensity;

    // --- Sun highlight ---
    vec3  H          = normalize(V + L);
    float NdotH      = max(dot(N, H), 0.0);
    float highlight  = pow(NdotH, 1500.0) * mix(0.6, 1.0, fresnel);
    vec3  sunHighlight = uSunColor * highlight;
    
    // --- Crest ---
    float h = clamp(vWaveHeight * 0.5 + 0.5, 0.0, 1.0);
    float crest = smoothstep(0.0, 0.9, h) * vWaveMask;
    vec3 crestTint = mix(uShallowColor, vec3(1.0), 0.7);
    vec3 crestColor = mix(baseColor, crestTint, crest * CREST_INTENSITY);
    baseColor = mix(baseColor, crestColor, CREST_BLEND);

    // --- Dubinski ton ---
    baseColor = mix(baseColor, baseColor * vec3(0.25, 0.3, 0.35), depthFactor * DEPTH_CONTRAST);

    // === FINAL MIX ===
    vec3 refracted = mix(baseColor, baseColor + sssLight, 0.4);
    vec3 reflected = envRefl * uSpecularStrength * reflectionFade;
    vec3 color = mix(refracted , reflected, fresnel);

    color += sunHighlight * reflectionFade;
    fragColor = vec4(vec3(color), 1.0);
}
