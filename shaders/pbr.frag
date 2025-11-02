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

    float radius = mix(1.0, 1.0, pow(1.0 - cosT, 2.0));

    float shadow = 0.0;
    for (int i = 0; i < 16; i++) {
        vec2 offs = rot * poissonDisk[i] * texel * radius;
        shadow += texture(uShadowMap, vec3(uvw.xy + offs, uvw.z - bias));
    }

    return shadow / 16.0;
}



/* ========================================================= */
void main(){
    vec3 fragPosV = texture(gPosition, vUV).rgb;
    if(length(fragPosV)<1e-5) discard;

    vec3 normalV   = normalize(texture(gNormal,  vUV).rgb);
    vec3 baseColor = texture(gAlbedo, vUV).rgb;
    vec4 m         = texture(gMaterial, vUV);
    float rough    = clamp(m.r,0.04,1.0);
    float metal    = clamp(m.g,0.0,1.0);

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
    vec3 bentW  = normalize(invV3 * bentV);    // bent u world


    /* --- Direct lighting --- */
    float shadow = getShadowView(fragPosV, N);
    float NdotL  = max(dot(N, Lv), 0.0);
    float NdotV  = max(dot(N, V ), 0.0);


    vec3  F0 = mix(vec3(0.04), baseColor, metal);
    float D  = distributionGGX(N, H, rough);
    float G  = geometrySmith(NdotV, NdotL, rough);
    vec3  F  = fresnelSchlickRoughness(max(dot(H, V), 0.0), F0, rough);
    vec3  specBRDF = (D * G * F) / (4.0 * max(NdotV * NdotL, 0.001));

    vec3 kd   = (1.0 - F) * (1.0 - metal);
    vec3 diff = kd * baseColor / 3.141592;

    /* === Diffuse IBL — slabiji uticaj bent/AO (da senka ne bude crna rupa) === */
    const float AO_STRENGTH = 0.5;   // 0 = ignoriši AO u ambientu, 1 = pun AO. (bilo implicitno 1.0)
    const float AO_FLOOR    = 0.05;  // minimalna ambijenta u senci (podiže dno)
    const float BENT_MIX    = 0.5;  // koliko bent skreće normalu za diffuse IBL

    float mipDiff = clamp(uCubeMaxMip * 0.9, 0.0, uCubeMaxMip); // svetlije probe
    vec3  NdiffW  = normalize(mix(Nw, bentW, BENT_MIX));
    vec3 envBent = textureLod(uEnvMap, NdiffW, mipDiff).rgb;


    // “Otvoreniji” AO + oslabljena težina + pod
    float aoLinRaw = clamp(ao, 0.0, 1.0);
    float aoLin    = 1.0 - pow(1.2 - aoLinRaw, 0.35); // gamma < 1 → svetlije
    float aoUsed   = mix(0.3, aoLin, AO_STRENGTH);   // slabiji uticaj AO
    aoUsed         = max(aoUsed, AO_FLOOR);          // pod

        // procena koliko je sunce nisko
    float skyBoost = smoothstep(0.0, 0.2, clamp(normalize(uSunDir).y, 0.0, 1.0));
    // kada je sunce nisko (zalazak/noć) — pojačaj nebo
    float envIntensity = mix(0.5, 2.0, skyBoost);
    vec3 ambient = envBent * aoUsed * envIntensity;
    vec3 radiance = uSunColor * uSunIntensity * uGlobalExposure;

    /* --- Specular IBL — spec occlusion nikad ne spusti ispod MIN --- */
    float mip    = clamp(rough * uCubeMaxMip, 0.0, uCubeMaxMip);
    vec3 envSpec = textureLod(uEnvMap, normalize(Rw), mip).rgb;
    vec2  brdf    = texture(uBRDFLUT, vec2(NdotV, rough)).rg;
    vec3  F_ibl   = fresnelSchlickRoughness(NdotV, F0, rough);
    vec3  diffIBL = ambient * baseColor * (1.0 - metal);

    // Mekši SO + minimalna granica (da ne uguši previše)
    const float SO_MIN = 0.1;                       // donja granica
    float soExp    = mix(1.3, 2.2, clamp(rough, 0.0, 1.0));
    float soDot    = max(dot(N, bentV), 0.5);
    float specOccl = max(pow(soDot, soExp) * (0.9 + 0.4 * aoLin), SO_MIN);

    vec3  specIBL    = envSpec * (F_ibl * brdf.x + brdf.y);
    float energyComp = 0.5 - 0.5 * rough;
    specIBL *= energyComp * specOccl * shadow;

    // --- blok refleksije ako površina ne vidi sunce ---
    float sunVis = clamp(dot(Nw, normalize(uSunDir)), 0.0, 1.0);
    float bentVis = clamp(dot(bentW, normalize(uSunDir)), 0.0, 1.0);
    float skyVis = mix(sunVis, bentVis, 0.5);  // koristi i bent normalu za realnije zatvaranje

    // ovo ubija refleksiju na zidovima unutar zatvorenog prostora
    // float block = pow(0.5 - skyVis, 4.0); 
    // specIBL *= 1.0 - block;

    /* --- Direct lighting mix --- */
    vec3 direct = (diff + specBRDF) *  NdotL * shadow * radiance; // radiance je bio nekad

    /* --- Fake GI — dodatni lift baš u senci --- */
    vec3  hemi        = normalize(vec3(0.0, 1.0, 0.0));
    float bounceFactor= max(dot(N, hemi), 0.0);
    vec3  hemiWorld   = invV3 * hemi;
    vec3  envBounce   = textureLod(uEnvMap, hemiWorld, uCubeMaxMip * 0.8).rgb;
    float shadowLift  = 0.25 * (1.0 - NdotL); // jači lift u senci
    vec3  fakeGI      = envBounce * baseColor * (bounceFactor * 0.8 + shadowLift)
                        * (1.0 - metal) * aoUsed;

    /* --- Final --- */
    
    vec3 color = direct + diffIBL + specIBL + fakeGI;
    fragColor = vec4(vec3(color), 1.0);
}
