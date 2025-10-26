#version 300 es
precision highp float;

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
uniform sampler2D uShadowMap;

uniform mat4  uView, uLightVP;
uniform vec3  uSunDir, uSunColor;
uniform float uSunIntensity;
uniform float uBiasBase, uBiasSlope;
uniform vec2  uShadowMapSize;
uniform float uCubeMaxMip;

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

float getShadowView(vec3 Pv, vec3 Nw){
    vec3 L = normalize(uSunDir);
    float cosT = max(dot(Nw,L),0.0);
    float bias = max(uBiasBase, uBiasSlope*(1.0-cosT));

    vec4 lp  = uLightVP * inverse(uView) * vec4(Pv,1.0);
    vec3 uvw = lp.xyz/lp.w*0.5+0.5;
    if (uvw.x<0.0||uvw.x>1.0||uvw.y<0.0||uvw.y>1.0||uvw.z>1.0) return 1.0;

const vec2 disk[9]=vec2[](
    vec2( 0.0, 0.0),
    vec2( 1.0, 0.0), vec2(-1.0, 0.0),
    vec2( 0.0, 1.0), vec2( 0.0,-1.0),
    vec2( 1.0, 1.0), vec2(-1.0, 1.0),
    vec2( 1.0,-1.0), vec2(-1.0,-1.0));

    vec2 texel  = 1.0/uShadowMapSize;
    float sh=0.0;
for(int i=0;i<9;i++){
    vec2 offs = disk[i]*texel;
    float d   = texture(uShadowMap, uvw.xy+offs).r;
    sh += step(uvw.z-bias, d);
}
    return sh/9.0;
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

    vec4 bnAO      = texture(tBentNormalAO, vUV);
    vec3 bentN     = normalize(bnAO.rgb*2.0-1.0);
    float ao       = bnAO.a;

    mat3  V3 = mat3(uView);
    mat3  invV3 = transpose(V3);

    vec3 N  = normalize(normalV);
    vec3 Nw = normalize(invV3*N);
    vec3 V  = normalize(-fragPosV);
    vec3 Lv = normalize(V3*normalize(uSunDir));
    vec3 H  = normalize(V+Lv);
    vec3 Rv = reflect(-V,N);
    vec3 Rw = invV3*Rv;

    /* --- direct lighting --- */
    float shadow = getShadowView(fragPosV,Nw);
    float NdotL  = max(dot(N,Lv),0.0);
    float NdotV  = max(dot(N,V ),0.0);

    vec3  F0 = mix(vec3(0.04), baseColor, metal);
    float D  = distributionGGX(N,H,rough);
    float G  = geometrySmith(NdotV,NdotL,rough);
    vec3  F  = fresnelSchlickRoughness(max(dot(H,V),0.0),F0,rough);
    vec3  specBRDF = (D*G*F)/(4.0*max(NdotV*NdotL, 0.001));

    vec3 kd   = (1.0-F)*(1.0-metal);
    vec3 diff = kd*baseColor/3.141592;

// === diffuse IBL (koristi najmutniji mip nivo kao ambient) ===
float mipDiff = uCubeMaxMip; // najmutniji mip iz sky cubemape
vec3 envDiff = textureLod(uEnvMap, normalize(invV3 * bentN), mipDiff).rgb;

// blago pojačaj jer niži mipovi umeju da potamne nebo
envDiff *= 1.0;

// koristi kao fill light, pomnoži sa albedom i AO
diff += kd * envDiff *  0.6;
diff *= ao; 

    vec3 radiance = uSunColor*uSunIntensity;
    vec3 direct = (diff + specBRDF) * radiance * NdotL * shadow;

    /* --- IBL only --- */
   vec3 bentBoost = normalize(mix(N, bentN, sqrt(0.6)));
   
    float mip    = clamp(rough*uCubeMaxMip,0.0,uCubeMaxMip);
    vec3 envSpec = textureLod(uEnvMap, normalize(Rw), mip).rgb;
    vec2 brdf    = texture(uBRDFLUT, vec2(NdotV,rough)).rg;

    vec3 F_ibl   = fresnelSchlickRoughness(NdotV, F0, rough);
    vec3 diffIBL = envDiff * baseColor * (1.0 - metal);
    vec3 specIBL = envSpec * (F_ibl * brdf.x + brdf.y);
    float specOccl = clamp(pow(NdotV + ao, 2.0) - 1.0 + ao, 0.0, 1.0);
    specIBL *= specOccl;
    

    vec3 color = direct + diffIBL * ao  + specIBL;
    fragColor = vec4(vec3(color), 1.0);
}
