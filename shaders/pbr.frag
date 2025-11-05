#version 300 es
precision highp float;
precision highp sampler2DShadow;

in vec2 vUV;
out vec4 fragColor;

/* ---------- G-buffer & uniforms ---------- */
uniform sampler2D gPosition;
uniform sampler2D gNormal;
uniform sampler2D gAlbedo;
uniform sampler2D gMaterial;
uniform vec2 uTexelSize;
uniform sampler2D tBentNormalAO;
uniform samplerCube uEnvMap;
uniform sampler2D uBRDFLUT;
uniform sampler2DShadow uShadowMap;
uniform float uNormalBias; 
uniform mat4  uView, uLightVP;
uniform vec3  uSunDir, uSunColor;
uniform float uSunIntensity;
uniform float uBiasBase, uBiasSlope;
uniform vec2  uShadowMapSize;
uniform float uCubeMaxMip;
uniform float uGlobalExposure;

/* ---------- helpers ---------- */
vec3 fresnelSchlick(float c, vec3 F0){ return F0 + (1.0-F0)*pow(1.0-c,5.0); }
vec3 fresnelSchlickRoughness(float c, vec3 F0, float r){
    return F0 + (max(vec3(1.0-r),F0)-F0)*pow(1.0-c,5.0);
}
float geometrySmith(float Nv,float Nl,float r){
    float k = pow(r+1.0,2.0)/8.0;
    float Gl = Nl/(Nl*(1.0-k)+k);
    float Gv = Nv/(Nv*(1.0-k)+k);
    return Gl*Gv;
}
float distributionGGX(vec3 N,vec3 H,float r){
    float a2 = pow(r*r,2.0);
    float NdotH = max(dot(N,H),0.0);
    float d = (NdotH*NdotH)*(a2-1.0)+1.0;
    return a2/(3.141592*d*d);
}

float getShadowView(vec3 Pv, vec3 Nview)
{
    // pretvori view-space poziciju i normalu u world-space
    mat3 invV3 = transpose(mat3(uView));
    vec3 Pw = (inverse(uView) * vec4(Pv, 1.0)).xyz;
    vec3 Nw = normalize(invV3 * Nview);

    vec3 L = normalize(uSunDir);
    vec3 offsetPosW = Pw + Nw * uNormalBias;

    // transform u light-space
    vec4 lp = uLightVP * vec4(offsetPosW, 1.0);
    vec3 uvw = lp.xyz / lp.w * 0.5 + 0.5;

    // van shadow-mape → bez senke
    if (uvw.x < 0.0 || uvw.x > 1.0 || uvw.y < 0.0 || uvw.y > 1.0 || uvw.z > 1.0)
        return 1.0;

    float cosT = max(dot(Nw, L), 0.0);
    float bias = uBiasBase + uBiasSlope * (1.0 - cosT);

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

    vec2 texel = 1.0 / uShadowMapSize;

    float angle = fract(sin(dot(uvw.xy, vec2(12.9898, 78.233))) * 43758.5453) * 6.28318;
    mat2 rot = mat2(cos(angle), -sin(angle), sin(angle), cos(angle));

   float radius = mix(1.0, 1.5, pow(1.0 - cosT, 2.0));

    float shadow = 0.0;
    for (int i = 0; i < 8; i++) {
        vec2 offs = rot * poissonDisk[i] * texel * radius;
        shadow += texture(uShadowMap, vec3(uvw.xy + offs, uvw.z - bias));
    }

    return shadow / 8.0;
}



/* ========================================================= */
void main(){
    vec3 fragPosV = texture(gPosition, vUV).rgb;
    if(length(fragPosV)<1e-5) discard;

    vec3 normalV   = normalize(texture(gNormal,  vUV).rgb);
    vec3 baseColor = texture(gAlbedo, vUV).rgb;
    
    vec4 m         = texture(gMaterial, vUV);
    // ✅ DODAJ OVO:
    float roughPerceptual = clamp(m.r, 0.04, 1.0);  // perceptual roughness iz teksture
    float rough = roughPerceptual * roughPerceptual; // alpha roughness za GGX
    float metal = clamp(m.g, 0.0, 1.0);

    // Bent + AO (u VIEW space)
    vec4 bnAO  = texture(tBentNormalAO, vUV);
    vec3 bentV = normalize(bnAO.rgb * 2.0 - 1.0);
    float ao   = bnAO.a;
    

    // Matrice / prostori
    mat3 V3     = mat3(uView);
    mat3 invV3  = transpose(V3);
    vec3 N      = normalize(normalV);          // view
    vec3 Nw     = normalize(invV3 * N);        // world
    vec3 V      = normalize(-fragPosV);        // view
    vec3 Lv     = normalize(V3 * normalize(uSunDir));
    vec3 H      = normalize(V + Lv);
    vec3 Rv     = reflect(-V, N);
    vec3 Rw     = invV3 * Rv;

    /* --- Direct lighting --- */
    float shadow = getShadowView(fragPosV, N);
    float NdotL  = max(dot(N, Lv), 0.0);
    float NdotV  = max(dot(N, V ), 0.0);

    vec3 F0 = mix(vec3(0.04), baseColor, metal);
    float D  = distributionGGX(N, H, rough);
    float G  = geometrySmith(NdotV, NdotL, rough);
    vec3  F  = fresnelSchlickRoughness(max(dot(H, V), 0.0), F0, roughPerceptual);
    vec3  specBRDF = (D * G * F) / (4.0 * max(NdotV * NdotL, 0.001));

    vec3 kd   = (1.0 - F) * (1.0 - metal);
    vec3 diff = kd * ( baseColor / 3.141592 );

    float mipDiff = uCubeMaxMip;          // 8 → meko, difuzno
    float mipSpec = roughPerceptual * uCubeMaxMip;

    vec3 envDiff = textureLod(uEnvMap, Rw, mipDiff).rgb;

    vec3 sunRadiance = uSunColor * uSunIntensity;

    // --- prošireni AO uzorak za fake GI ---
    float aoWide = texture(tBentNormalAO, vUV).a;
    const float giRadius = 0.30; // povećaj na 60-100 ako hoćeš još šire
    aoWide += texture(tBentNormalAO, vUV + uTexelSize * vec2( giRadius,  0.0)).a;
    aoWide += texture(tBentNormalAO, vUV + uTexelSize * vec2(-giRadius,  0.0)).a;
    aoWide += texture(tBentNormalAO, vUV + uTexelSize * vec2( 0.0,  giRadius)).a;
    aoWide += texture(tBentNormalAO, vUV + uTexelSize * vec2( 0.0, -giRadius)).a;
    aoWide += texture(tBentNormalAO, vUV + uTexelSize * vec2( giRadius,  giRadius)).a;
    aoWide += texture(tBentNormalAO, vUV + uTexelSize * vec2(-giRadius,  giRadius)).a;
    aoWide += texture(tBentNormalAO, vUV + uTexelSize * vec2( giRadius, -giRadius)).a;
    aoWide += texture(tBentNormalAO, vUV + uTexelSize * vec2(-giRadius, -giRadius)).a;
    aoWide /= 3.65;

    float giBoost = mix(0.1, 0.3, pow(1.0 - aoWide,2.0));   
   
  
    vec3 envSpec = textureLod(uEnvMap, Rw, mipSpec).rgb;

    // ☀️ Utišavanje efekta po jačini sunca (radiance)
    float sunStrength = clamp(length(sunRadiance), 0.0, 2.0); // kad je sunset → manja vrednost

    // 🌊 Fake ground tint samo za dole gledajuće refleksije
    float groundMask = smoothstep(-0.25, 0.8, Rw.y);
    float tintAmt = smoothstep(0.8, -0.2, Rw.y) * 0.25;
    vec3 tintColor = baseColor * 0.4 ;
vec3 groundTint = vec3(0.12, 0.10, 0.08);

envSpec = mix(envSpec, groundTint, tintAmt);
    envDiff = mix(envDiff, mix(envDiff, tintColor, tintAmt), tintAmt) ;
    
    vec3 ambient = envDiff * giBoost;


    vec2 brdf = texture(uBRDFLUT, vec2(NdotV, rough)).rg;
    vec3 F_ibl = fresnelSchlickRoughness(NdotV, F0, rough);

    vec3 kd_ibl = (1.0 - F_ibl) * (1.0 - metal);
vec3 diffIBL = ambient * baseColor * kd_ibl;
    vec3 specIBL = envSpec * (F_ibl * (brdf.x + brdf.y)) ;

    /* --- Direct lighting mix --- */
    vec3 direct = (diff + specBRDF) * NdotL * sunRadiance * shadow;
    /* --- Final --- */


    vec3 color = direct + diffIBL + specIBL ;
    color *= uGlobalExposure;
    fragColor = vec4(vec3(color), 1.0);
}
