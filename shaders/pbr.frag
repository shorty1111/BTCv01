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

uniform samplerCube uEnvDiffuse;

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
float smithG1(float Ndot, float alpha)
{
    float Nd = max(Ndot, 0.0);
    float a2 = alpha * alpha;
    float denom = Nd + sqrt(a2 + (1.0 - a2) * Nd * Nd);
    return (2.0 * Nd) / max(denom, 1e-4);
}

float geometrySmith(float Nv, float Nl, float alpha){
    return smithG1(Nv, alpha) * smithG1(Nl, alpha);
}
float distributionGGX(vec3 N,vec3 H,float alpha){
    float a2 = alpha * alpha;
    float NdotH = max(dot(N,H),0.0);
    float d = (NdotH*NdotH)*(a2-1.0)+1.0;
    return a2/(3.141592*d*d);
}

float getShadowView(vec3 Pw, vec3 Nw)
{
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
    mat4 invView = inverse(uView);
    vec3 N      = normalize(normalV);          // view-space normala
    vec3 Nw     = normalize(invV3 * N);        // world-space normala
    vec3 fragPosW = (invView * vec4(fragPosV, 1.0)).xyz;
    vec3 V      = normalize(-fragPosV);
    vec3 Lv     = normalize(V3 * normalize(uSunDir));
    vec3 H      = normalize(V + Lv);
    
    vec3 upN = normalize(invV3 * N);
    upN = mix(upN, vec3(upN.x, abs(upN.y), upN.z), 0.5); // smanji uticaj grounda

    vec3 Rv     = reflect(-V, N);
    vec3 Rw     = invV3 * Rv;

    /* --- Direct lighting (koristi pravu normalu) --- */
    float shadow = getShadowView(fragPosW, Nw);
    float NdotL  = max(dot(N, Lv), 0.0);
    float NdotV  = max(dot(N, V ), 0.0);

    vec3 F0 = mix(vec3(0.04), baseColor, metal);
    float D  = distributionGGX(N, H, rough);
    float G  = geometrySmith(NdotV, NdotL, rough);
    vec3  F  = fresnelSchlickRoughness(max(dot(H, V), 0.0), F0, roughPerceptual);
    vec3  specBRDF = (D * G * F) / (4.0 * max(NdotV * NdotL, 0.001));

    vec3 kd   = (1.0 - F) * (1.0 - metal);
    vec3 diff = kd * (baseColor / 3.141592) * ao;


    float mipDiff =  uCubeMaxMip;          // 8 → meko, difuzno
    vec3 envDiff = texture(uEnvDiffuse, upN).rgb;

    float mipSpec = roughPerceptual  * uCubeMaxMip;
    vec3 envSpec = textureLod(uEnvMap, Rw, mipSpec).rgb ;
        
    
    vec3 sunRadiance = uSunColor * uSunIntensity;
    vec3 direct = (diff + specBRDF) * NdotL * sunRadiance * shadow;
    vec3 ambient = envDiff *  ao;

    vec2 brdf = texture(uBRDFLUT, vec2(NdotV, roughPerceptual)).rg; 
    vec3 F_ibl = fresnelSchlickRoughness(NdotV, F0, roughPerceptual);

    vec3 kd_ibl = (1.0 - F_ibl) * (1.0 - metal);
    vec3 diffIBL = ambient * baseColor * kd_ibl;
    float specOcclusion = clamp(ao + (1.0 - ao) * pow(NdotV, 4.0), 0.0, 1.0);
    vec3 specIBL = envSpec * (F_ibl * brdf.x + brdf.y) * specOcclusion;


    vec3 color = direct + diffIBL + specIBL;
    color *= uGlobalExposure;
    fragColor = vec4(vec3(color), 1.0);
}
