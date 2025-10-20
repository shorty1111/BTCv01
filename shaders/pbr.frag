#version 300 es
precision highp float;
precision mediump float;
precision mediump sampler2D;
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
uniform sampler2D uSceneColor;

uniform mat4  uView, uLightVP, uProjection;
uniform vec3  uCameraPos;
uniform vec3  uSunDir,  uSunColor;
uniform float uSunIntensity;
uniform float uBiasBase, uBiasSlope;
uniform float uLightSize;
uniform float uCubeMaxMip;
uniform vec2  uShadowMapSize;

/* ---------- helpers ---------- */
float hash12(vec2 p){ return fract(sin(dot(p, vec2(27.167,91.453)))*43758.5453); }

vec3 fresnelSchlick(float c, vec3 F0){ return F0 + (1.0-F0)*exp2(-5.2 * c); }
vec3 fresnelSchlickRoughness(float c, vec3 F0, float r){
    return F0 + (max(vec3(1.0-r),F0)-F0)*exp2(-5.2 * c);
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

/* ---------- soft-shadow PCF ---------- */
float getShadowView(vec3 Pv, vec3 Nw){
    vec3 L = normalize(uSunDir);
    float cosT = max(dot(Nw,L),0.0);
    float bias = max(uBiasBase, uBiasSlope*(1.0-cosT));

    vec4 lp  = uLightVP * inverse(uView) * vec4(Pv,1.0);
    vec3 uvw = lp.xyz/lp.w*0.5+0.5;
    if (uvw.x<0.0||uvw.x>1.0||uvw.y<0.0||uvw.y>1.0||uvw.z>1.0) return 1.0;

    const vec2 disk[4]=vec2[](
        vec2(0.5,0.5), vec2(-0.5,0.5),
        vec2(0.5,-0.5), vec2(-0.5,-0.5));

    vec2 texel  = 1.0/uShadowMapSize;
    float sh=0.0;
    for(int i=0;i<4;i++){
        vec2 offs = disk[i]*texel;
        float d   = texture(uShadowMap, uvw.xy+offs).r;
        sh += step(uvw.z-bias, d);
    }
    return sh/4.0;
}

/* ========================================================= */
void main(){
    vec3 fragPosV = texture(gPosition, vUV).rgb;
    if(length(fragPosV)<1e-5) discard;

    vec3 normalV   = normalize(texture(gNormal,  vUV).rgb);
    vec3 baseColor = texture(gAlbedo, vUV).rgb;
    vec4 m         = texture(gMaterial, vUV);
    float rough = clamp(m.r,0.06,0.95);
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
    vec3  specBRDF = (D*G*F)/(4.0*NdotV*NdotL+0.001);

    vec3 kd   = (1.0-F)*(1.0-metal);
    vec3 diff = kd*baseColor/3.141592;
    vec3 radiance = uSunColor*uSunIntensity;
    vec3 direct = (diff+specBRDF)*radiance*NdotL*(shadow*1.5);

    /* --- IBL --- */
    vec3 envDiff = textureLod(uEnvMap, normalize(invV3*bentN), uCubeMaxMip*0.98).rgb;
    float mip    = clamp(rough*uCubeMaxMip,0.0,uCubeMaxMip);
    vec3 envSpec = textureLod(uEnvMap, normalize(Rw), mip).rgb;
    vec2 brdf    = texture(uBRDFLUT, vec2(NdotV,rough)).rg;

/* ---------- SSR: view-space linear march (improved) ---------- */
vec3 reflFinal = envSpec;
if (rough < 0.8) {
    vec3 R = normalize(reflect(-V, N));
    vec3 ray = fragPosV + R * 0.005;

    bool hit = false;
    vec2 hitUV = vUV;
    float bestDiff = 1e6;

    float viewAngle = max(dot(N, V), 0.05);
    float stepSize = mix(0.02, 0.06, rough) * mix(0.1, 0.6, viewAngle); // kraći pod kosim uglom
    int maxSteps = 128;

    // glavni ray march
    for (int i = 0; i < maxSteps; i++) {
        ray += R * stepSize;
        vec4 clip = uProjection * vec4(ray, 1.0);
        if (clip.w <= 0.0) break;
        vec3 ndc = clip.xyz / clip.w;
        if (abs(ndc.x) > 1.0 || abs(ndc.y) > 1.0) break;
        vec2 uv = ndc.xy * 0.5 + 0.5;

        vec3 scenePosV = texture(gPosition, uv).rgb;
        if (length(scenePosV) < 0.001) continue;

        float rayDepth = -ray.z;
        float sceneDepth = -scenePosV.z;
        float diffZ = sceneDepth - rayDepth;

        if (diffZ > 0.0 && diffZ < stepSize * 3.0) {
            hit = true;
            hitUV = uv;
            bestDiff = diffZ;
            break;
        }
    }

    // fine binary refine
    if (hit) {
        vec3 rayA = ray - R * stepSize;
        vec3 rayB = ray;
        for (int j = 0; j < 2; j++) {
            vec3 mid = (rayA + rayB) * 0.5;
            vec4 clip = uProjection * vec4(mid, 1.0);
            vec3 ndc = clip.xyz / clip.w;
            vec2 uv = ndc.xy * 0.5 + 0.5;
            vec3 sp = texture(gPosition, uv).rgb;
            float rd = -mid.z;
            float sd = -sp.z;
            float d = sd - rd;
            if (d > 0.0) rayB = mid; else rayA = mid;
        }
    }

    if (hit) {
        vec3 ssrColor = textureLod(uSceneColor, hitUV, rough * 2.0).rgb;

        // glatkiji fade i jači angular fade
        float edgeFade = smoothstep(0.0, 0.2, hitUV.x) *
                         smoothstep(0.0, 0.2, 1.0 - hitUV.x) *
                         smoothstep(0.0, 0.2, hitUV.y) *
                         smoothstep(0.0, 0.2, 1.0 - hitUV.y);

        float angleFade = pow(viewAngle, 3.0);
        float roughFade = 1.0 - smoothstep(0.0, 0.9, rough);
        float depthFade = 1.0 - smoothstep(0.0, 0.3, bestDiff);

        float blend = edgeFade * roughFade * depthFade;
        blend = clamp(blend, 0.0, 1.0);

        reflFinal = mix(envSpec, ssrColor, blend);
    }
       else {
       reflFinal = mix(envSpec, envSpec * baseColor, 0.2);
   }
}


/* --- IBL composition --- */
vec3 F_ibl   = fresnelSchlickRoughness(NdotV, F0, rough);
vec3 diffIBL = textureLod(uEnvMap, normalize(invV3 * bentN), uCubeMaxMip).rgb * baseColor * (1.0 - metal);

vec3 specIBL = reflFinal * (F_ibl * brdf.x + brdf.y);

vec3 color = direct + (diffIBL + specIBL) * ao;
fragColor = vec4(vec3(color), 1.0);
}
