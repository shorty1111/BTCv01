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
// uniform samplerCube uEnvTex;
uniform sampler2D   uReflectionTex;
uniform sampler2D   uWaterNormal;
uniform float       uTime;
uniform vec3        uCameraPos;
uniform vec3        uSunDir;
uniform vec3        uSunColor;
uniform float       uSunIntensity;
uniform float       uRoughness;
uniform float       uSpecularStrength;
uniform vec3        uDeepColor;
uniform vec3        uShallowColor;
uniform mat4        uReflectionMatrix;
uniform float       uWaterLevel;
uniform float       uBottomOffsetM;
uniform float       uGlobalExposure;

// === PARAMETRI ===
const float DEPTH_SCALE     = 4.20;
const float DEPTH_CURVE     = 0.1;
const float SSS_STRENGTH    = 100.0;
const float SSS_WRAP        = 1.2;
const vec3  SSS_FALLOFF     = vec3(0.0431, 0.0667, 0.0667);
const float CREST_INTENSITY = 0.03;
const float CREST_BLEND     = 0.03;


vec2 getPlanarReflectionUV(vec3 worldPos) {
    vec4 rc = uReflectionMatrix * vec4(worldPos, 1.0);
    rc.xyz /= max(rc.w, 1e-4);
    return rc.xy * 0.5 + 0.5;
}

vec3 fresnelSchlick(float cosTheta, vec3 F0) {
    return F0 + (1.0 - F0) * pow(1.0 - cosTheta, 5.0);
}

vec3 fresnelSchlickRoughness(float cosTheta, vec3 F0, float roughness) {
    return F0 + (max(vec3(1.0 - roughness), F0) - F0) * pow(1.0 - cosTheta, 5.0);
}

void main() {
    float depthM      = abs((vWorldPos.y - uWaterLevel) - uBottomOffsetM);
    float depthFactor = clamp(depthM / DEPTH_SCALE, 0.0, 1.0);
    // sitan dither u UV prostoru (fiksan, bez animacije) da ublaži banding između shallow/deep boje
    float dither = fract(sin(dot(vUV * 256.0 , vec2(12.9898,78.233))) * 43758.5453);
    float depthMix = clamp(pow(depthFactor, DEPTH_CURVE) + (dither - 0.5) * 0.0025, 0.0, 1.0);

  // === NORMALS (čistije, stabilnije) ===
    vec2 scroll1 = vec2(0.02,  0.05) * uTime;
    vec2 scroll2 = vec2(-0.015, 0.01) * uTime * 0.8;

    vec3 n1 = texture(uWaterNormal, vUV * 1.6 + scroll1).xyz * 2.0 - 1.0;
    vec3 n2 = texture(uWaterNormal, vUV * 0.7 + scroll2).xyz * 2.0 - 1.0;

    // simple + stable
    vec3 tangentNormal = normalize(n1 + 0.5 * n2);

    // flatten with depth
    float depthEffect = depthFactor;
    tangentNormal.xy *= mix(1.0, 0.75, depthEffect);

    // TBN
    mat3 TBN = mat3(normalize(vTBN_T), normalize(vTBN_B), normalize(vTBN_N));
    vec3 N = normalize(TBN * tangentNormal);
    vec3 V = normalize(uCameraPos - vWorldPos);
    vec3 L = normalize(uSunDir);
    float NdotV = clamp(dot(N, V), 0.0, 1.0);
    float NdotL = clamp(dot(N, L), 0.0, 1.0);

    vec3 R_env = normalize(reflect(-V, N));
    float envSeesSun = clamp(dot(R_env, L), 0.0, 1.0);
    float highlightExp = mix(200.0, 800.0, clamp(1.0 - uRoughness, 0.0, 1.0));
    float sunHighlight = pow(envSeesSun, highlightExp) * vWaveMask;
    vec3 sunSpecular = sunHighlight * uSunColor * uSunIntensity * NdotL;

    float glintExp = mix(400.0, 1200.0, clamp(1.0 - uRoughness, 0.0, 1.0));
    float glint = pow(envSeesSun, glintExp) * vWaveMask;
    vec3 glintColor = glint * uSunColor * uSunIntensity;

    vec3 R = normalize(reflect(-V, N));

    vec3 baseColor = mix(uShallowColor, uDeepColor, depthMix) * uSunColor;

    vec3 F0 = vec3(0.02, 0.023, 0.028);
    vec3 fresnel = fresnelSchlickRoughness(NdotV, F0, uRoughness);

    vec2 reflUV = getPlanarReflectionUV(vWorldPos);
    vec2 center = reflUV - 0.5;
    float edgeFade = smoothstep(1.0, 0.6, length(center));
    vec2 distortion = N.xz * 0.08 * edgeFade;
    reflUV = clamp(reflUV + distortion, 0.001, 0.999);

    vec3 planarReflection = texture(uReflectionTex, reflUV).rgb;


    float backLit   = clamp((dot(-L, N) + SSS_WRAP) / (1.0 + SSS_WRAP), 0.0, 1.0);
    backLit         = smoothstep(0.4, 0.98, backLit);
    float sunFacing = pow(clamp(dot(V, -L), 0.0, 1.0), 5.0);
    vec3 warmTint   = vec3(1.0, 0.65, 0.3);
    vec3 sssColor   = mix(uShallowColor, warmTint, sunFacing * 0.8);
    vec3 falloff    = exp(-SSS_FALLOFF * depthM);
    vec3 sssLight   = uSunColor * sssColor * backLit * (1.0 - falloff) * sunFacing * 0.05;
    sssLight       *= SSS_STRENGTH * uSunIntensity;

    float h = clamp(vWaveHeight * 0.5 + 0.5, 0.0, 1.0);
    float crest = smoothstep(0.0, 0.9, h) * vWaveMask;
    vec3 crestTint = mix(uShallowColor, vec3(1.0), 0.7);
    vec3 crestColor = mix(baseColor, crestTint, crest * CREST_INTENSITY);
    float sunHeight = clamp(dot(uSunDir, vec3(0.0, 1.0, 0.0)), 0.0, 1.0);
    baseColor = mix(baseColor, crestColor, CREST_BLEND);
    baseColor *= mix(0.8, 1.0, sunHeight);

    vec3 refracted = mix(baseColor, baseColor + sssLight, 0.8);

    float lowAngleMix = pow(1.0 - NdotV, 2.0);
    vec3 color = mix(refracted, planarReflection, fresnel * mix(1.0, 0.5, lowAngleMix));

    color += sunSpecular+glintColor; //+glintColor
    color *= uGlobalExposure;
    fragColor = vec4(vec3(color), 1.0);
}
