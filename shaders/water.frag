#version 300 es
precision highp float;
precision highp sampler2DShadow;

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
// uniform sampler2DShadow uShadowMap;
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
// uniform mat4     uLightVP;
uniform mat4        uReflectionMatrix;
uniform float       uWaterLevel;
uniform float       uBottomOffsetM;
uniform float       uGlobalExposure;


// === PARAMETRI ===
const float DEPTH_SCALE     = 6.4;
const float DEPTH_CURVE     = 0.1;
const float SSS_STRENGTH    = 60.0;
const float SSS_WRAP        = 1.8;
const vec3  SSS_FALLOFF     = vec3(0.0431, 0.0667, 0.0667);
const float CREST_INTENSITY = 0.01;
const float CREST_BLEND     = 0.01;
const float DEPTH_CONTRAST  = 2.0;


vec2 getPlanarReflectionUV(vec3 worldPos) {
    vec4 rc = uReflectionMatrix * vec4(worldPos, 1.0);
    rc.xyz /= max(rc.w, 1e-4);
    vec2 uv = rc.xy * 0.5 + 0.5;
    return clamp(uv, 0.001, 0.999);
}

// float getShadowValue(vec3 worldPos)
// {
//     // svetlosni prostor
//     vec4 lightPos = uLightVP * vec4(worldPos, 1.0);
//     lightPos.xyz /= lightPos.w;
//     vec3 shadowCoord = lightPos.xyz * 0.5 + 0.5;

//     // ako je van granica, nema senke
//     if (shadowCoord.x < 0.0 || shadowCoord.x > 1.0 ||
//         shadowCoord.y < 0.0 || shadowCoord.y > 1.0)
//         return 1.0;

//     // --- Blurred shadow sample ---
//     float radius = 0.07;
//     vec2 offsets[9] = vec2[](
//         vec2(-radius,  radius),
//         vec2(0.0,      radius),
//         vec2( radius,  radius),
//         vec2(-radius,  0.0),
//         vec2(0.0,      0.0),
//         vec2( radius,  0.0),
//         vec2(-radius, -radius),
//         vec2(0.0,     -radius),
//         vec2( radius, -radius)
//     );
//     vec2 waveDistort = (texture(waterNormalTex, vUV *5.5 + uTime * 0.02).rg - 0.5) * 0.08;
//     float s = 0.0;
//     for (int i = 0; i < 9; ++i) {
//         vec3 coord = shadowCoord;
//         coord.xy += offsets[i];
//         coord = clamp(coord, vec3(0.001), vec3(0.999));
//         coord.xy += waveDistort;
//         coord.z -= 0.001;
//         s += texture(uShadowMap, coord);
//     }
//     return s / 9.0;
// }

vec3 fresnelSchlick(float cosTheta, vec3 F0) {
    return F0 + (1.0 - F0) * pow(1.0 - cosTheta, 5.0);
}

// === MAIN ===
void main() {
    // --- Dubina ---
    float depthM      = abs((vWorldPos.y - uWaterLevel) - uBottomOffsetM);
    float depthFactor = clamp(depthM / DEPTH_SCALE, 0.0, 1.0);

    // --- Normal mapa ---
vec2 scroll1 = vec2(0.02, 0.05) * uTime;
vec2 scroll2 = vec2(-0.015, 0.01) * uTime;
vec2 scroll3 = vec2(0.07, -0.03) * uTime * 0.5;

vec3 n1 = texture(waterNormalTex, vUV * 2.0 + scroll1).xyz * 2.0 - 1.0;
vec3 n2 = texture(waterNormalTex, vUV * 0.8 + scroll2).xyz * 2.0 - 1.0;
vec3 n3 = texture(waterNormalTex, vUV * 6.5 + scroll3).xyz * 2.0 - 1.0;

    vec3 tangentNormal = normalize((n1 * 0.5 + n2 * 0.6 + n3 * 0.3) / 1.4);

    // BOLJE: Samo blagi efekat dubine na normalama
    float depthEffect = clamp(depthM / (DEPTH_SCALE * 3.0), 0.0, 1.0);
    tangentNormal.xy *= mix(1.0, 0.7, depthEffect); // Manje uticaja

    vec3 N = normalize(
        tangentNormal.x * vTBN_T +
        tangentNormal.y * vTBN_B +
        tangentNormal.z * vTBN_N
    );

    // --- Kamera, svetlo, refleksija ---
    vec3 V = normalize(uCameraPos - vWorldPos);
    vec3 L = normalize(uSunDir);
    
    // --- OVO PRVO: deklariši potrebne varijable ---
    float NdotV = clamp(dot(N, V), 0.0, 1.0);
    
    // --- Senka ---
    //float shadowBelow = getShadowValue(vWorldPos - N *0.83);
    //float shadow = shadowBelow;

    // --- Mekša senka na vodi ---
    //float softShadow = smoothstep(0.1, 1.0, shadow);
    //float shadowStrength = mix(0.1, 0.2, depthFactor);
    //float angleFade = clamp(dot(N, L) * 0.9 + 0.9, 0.0, 1.0);
    //float blendedShadow = mix(1.0, softShadow, shadowStrength * angleFade);

    // --- SUNCEV HAJLAJT KOJI PRATI ENVIRONMENT REFLEKSIJE ---
    float NdotL = clamp(dot(N, L), 0.0, 1.0);

    // KORISTI ISTU REFLEKSIJU KAO ENVIRONMENT!
    vec3 R_env = normalize(reflect(-V, N) + N * 0.1);

    // Gde environment refleksija "vidi" sunce?
    float envSeesSun = clamp(dot(R_env, L), 0.0, 1.0);

    // Ovo će biti PERFEKTNO SINHRONIZOVANO sa environment refleksijama!
    float sunHighlight = pow(envSeesSun, 800.0);

    // Dodaj wave mask
    sunHighlight *= vWaveMask;

    // EKSTREMNO JAK HAJLAJT
    vec3 sunSpecular = sunHighlight * uSunColor * uSunIntensity * NdotL;
    // Glint za dodatni sjaj
    float glint = pow(envSeesSun, 1200.0);
    glint *= vWaveMask * 1.0;
    vec3 glintColor = glint * uSunColor * uSunIntensity;

    // --- Ostali delovi koda ---
    vec3 R = normalize(reflect(-V, N) + N * 0.1);

    // --- Horizon fade ---
    float dist = length(uCameraPos - vWorldPos);
    float horizonFade = pow(clamp(1.0 - abs(dot(N, V)), 0.0, 1.0), 0.6);
    float reflectionFade = mix(0.2, 1.0, horizonFade);

    // --- Bazna boja ---
    vec3 baseColor = mix(uShallowColor, uDeepColor, pow(depthFactor, DEPTH_CURVE))
               * uSunColor * uSunIntensity * uGlobalExposure;

    // --- Fresnel ---
    vec3 F0 = vec3(0.02, 0.025, 0.03);  // ovde boostuje refleksiju na vodi kao staklo.ogledalo ..malo boje za varijaciju!
    float fresnel = F0.r + (1.0 - F0.r) * pow(1.0 - NdotV, 5.0);

    // --- Planarna refleksija ---
    vec2 reflUV = getPlanarReflectionUV(vWorldPos);
    vec2 distortion = N.xz * 0.08;
    reflUV += distortion;
    reflUV = clamp(reflUV, 0.001, 0.999);

    vec3 planarReflection = texture(uReflectionTex, reflUV).rgb;
    planarReflection = pow(planarReflection, vec3(0.7));
    planarReflection *= 0.7;

    // --- Environment refleksija ---
    vec3 envRefl = textureLod(uEnvTex, normalize(R), uRoughness).rgb;

    // --- Kombinuj planar + env ---
    envRefl = mix(envRefl, planarReflection, reflectionFade);

    // --- Fake SSS ---
    float backLit   = clamp((dot(-L, N) + SSS_WRAP) / (1.0 + SSS_WRAP), 0.0, 1.0);
    backLit         = smoothstep(0.4, 0.98, backLit);
    float sunFacing = pow(clamp(dot(V, -L), 0.0, 1.0), 4.0);
    vec3 warmTint   = vec3(1.0, 0.65, 0.3);
    vec3 sssColor   = mix(uShallowColor, warmTint, sunFacing * 0.8);
    vec3 falloff    = exp(-SSS_FALLOFF * depthM);
    vec3 sssLight   = uSunColor * sssColor * backLit * (1.0 - falloff) * sunFacing * 0.05;
    sssLight *= SSS_STRENGTH * uSunIntensity * uGlobalExposure;

    // --- Crest ---
    float h = clamp(vWaveHeight * 0.5 + 0.5, 0.0, 1.0);
    float crest = smoothstep(0.0, 0.9, h) * vWaveMask;
    vec3 crestTint = mix(uShallowColor, vec3(1.0), 0.7);
    vec3 crestColor = mix(baseColor, crestTint, crest * CREST_INTENSITY);
    float sunHeight = clamp(dot(uSunDir, vec3(0.0, 1.0, 0.0)), 0.0, 1.0);
    baseColor = mix(baseColor, crestColor, CREST_BLEND);
    baseColor *= mix(0.3, 1.0, sunHeight);

    // --- Dubinski ton ---
    baseColor = mix(baseColor, baseColor * vec3(0.25, 0.3, 0.35), depthFactor * DEPTH_CONTRAST);

    // === FINAL MIX - POPRAVLJENO ===
    vec3 refracted = mix(baseColor, baseColor + sssLight, 0.6); // Više refrakcije
    vec3 reflected = envRefl * uSpecularStrength * reflectionFade;

    // Kada si nisko, daj prednost refrakciji
    float lowAngleMix = pow(1.0 - NdotV, 2.0);
    vec3 color = mix(refracted, reflected, fresnel * mix(1.0, 0.5, lowAngleMix));

    // UVEK dodaj sun specular bez obzira na ugao
    color += sunSpecular + glintColor;

    fragColor = vec4(vec3(color), 1.0);
}