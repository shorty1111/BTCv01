#version 300 es
precision highp float;

in vec2 vUV;
out vec4 fragColor;

// --- G-buffer i uniformi ---
uniform sampler2D gPosition,gNormal,gAlbedo,gMaterial;
uniform sampler2D tBentNormalAO;// BENT NORMAL + AO
uniform samplerCube uEnvMap;
uniform sampler2D uBRDFLUT;
uniform sampler2D uShadowMap;
uniform sampler2D uReflectionTex;
uniform mat4 uReflectionMatrix;
uniform mat4 uView,uLightVP,uProjection;
uniform vec3 uCameraPos;
uniform vec3 uSunDir,uSunColor;
uniform float uSunIntensity;

uniform float uBiasBase,uBiasSlope;
uniform float uLightSize;
uniform float uCubeMaxMip;
uniform vec2 uShadowMapSize;
// === Helper funkcije ===
float hash12(vec2 p){return fract(sin(dot(p,vec2(27.167,91.453)))*43758.5453);}
mat2 rotFromHash(float h){float a=h*6.283185;return mat2(cos(a),-sin(a),sin(a),cos(a));}

vec3 fresnelSchlick(float cosTheta,vec3 F0){
    return F0+(1.-F0)*pow(1.-cosTheta,5.);
}

vec3 fresnelSchlickRoughness(float cosTheta,vec3 F0,float roughness){
    return F0+(max(vec3(1.-roughness),F0)-F0)*pow(1.-cosTheta,5.);
}

float geometrySmith(float NdotV,float NdotL,float roughness){
    float r=roughness+1.;
    float k=(r*r)/8.;
    float GL=NdotL/(NdotL*(1.-k)+k);
    float GV=NdotV/(NdotV*(1.-k)+k);
    return GL*GV;
}

float distributionGGX(vec3 N,vec3 H,float roughness){
    float a=roughness*roughness;
    float a2=a*a;
    float NdotH=max(dot(N,H),0.);
    float NdotH2=NdotH*NdotH;
    float denom=(NdotH2*(a2-1.)+1.);
    return a2/(3.141592*denom*denom);
}
// === PCSS senke ===
float findBlocker(vec2 uv,float receiverDepth){
    float avg=0.,num=0.;
    vec2 texelSize=1.5/uShadowMapSize;
    for(int y=-1;y<=1;y++)
    for(int x=-1;x<=1;x++){
        vec2 offs=vec2(x,y)*texelSize;
        float d=texture(uShadowMap,uv+offs).r;
        if(d<receiverDepth-uBiasBase){avg+=d;num+=1.;}
    }
    return(num<1.)?receiverDepth:avg/num;
}

float getShadow(vec3 P,vec3 N){
    vec3 Pn=P+N*uBiasSlope;
    vec4 lp=uLightVP*vec4(Pn,1.);
    vec3 uvw=lp.xyz/lp.w*.5+.5;
    if(uvw.z>1.)return 1.;
    float recDepth=uvw.z;
    float blkDepth=findBlocker(uvw.xy,recDepth);
    float penRad=max(0.,recDepth-blkDepth)*uLightSize;
    float sh=0.;
    const int S=24;
    mat2 rot=rotFromHash(hash12(vUV*uShadowMapSize));
    for(int i=0;i<S;i++){
        float a=float(i)*2.3999632297;
        float r=sqrt(float(i)/float(S))*penRad;
        vec2 off=rot*vec2(cos(a),sin(a))*r;
        float d=texture(uShadowMap,uvw.xy+off).r;
        sh+=smoothstep(recDepth-uBiasBase-.002,recDepth-uBiasBase+.002,d);
    }
    return sh/float(S);
}

// === MAIN ===
void main(){
    vec3 fragPosV=texture(gPosition,vUV).rgb;
    if(length(fragPosV)<1e-5)discard;
    
    vec3 normalV=normalize(texture(gNormal,vUV).rgb);
    vec4 albedoTex=texture(gAlbedo,vUV);
    vec3 baseColor=albedoTex.rgb*1.52;
    float opacity=albedoTex.a;
    
    vec4 matTex=texture(gMaterial,vUV);
    float roughness=clamp(matTex.r,.04,1.);
    float metalness=clamp(matTex.g,0.,1.);
    
    // === BENT NORMAL + AO iz SSAO ===
    vec4 bentNormalAO=texture(tBentNormalAO,vUV);
    vec3 bentNormal=normalize(bentNormalAO.rgb*2.-1.);
    // PREBACI BENT NORMAL IZ VIEW U WORLD SPACE
    mat3 invViewMat=transpose(mat3(uView));
    vec3 bentNormalWorld=invViewMat*bentNormal;
    float ao=bentNormalAO.a;
    
    // === Kamera i orijentacija ===
    vec3 N=normalize(normalV);
    vec3 V=normalize(-fragPosV);
    vec3 Rv=reflect(V,N);
    vec3 Rw=transpose(mat3(uView))*Rv;
    
    Rw.y=-Rw.y;
    Rw.z=-Rw.z;
    
    // === World pozicija za senke ===
    mat4 invV=inverse(uView);
    vec3 P=(invV*vec4(fragPosV,1.)).xyz;
    vec3 L=normalize(mat3(uView)*uSunDir);
    vec3 H=normalize(V+L);
    
    // === Shadows ===
    float shadow=getShadow(P,N);
    float shadowFade=mix(.1,1.,shadow);// 0.3 = koliko refleksije ostane u senci
    float NdotL=max(dot(N,L),0.);
    float NdotV=max(dot(N,V),0.);
    
    // === F0 kao Blender principled ===
    vec3 dielectricF0=vec3(.04);
    vec3 F0=mix(dielectricF0,baseColor,metalness);
    
    // === PBR BRDF ===
    float D=distributionGGX(N,H,roughness);
    float G=geometrySmith(NdotV,NdotL,roughness);
    vec3 F=fresnelSchlickRoughness(max(dot(H,V),0.),F0,roughness);
    vec3 numerator=D*G*F;
    float denominator=4.*NdotV*NdotL+.001;
    vec3 specularBRDF=numerator/denominator;
    
    vec3 kd=(1.-F)*(1.-metalness);
    vec3 diffuse=kd*baseColor/3.141592;
    
    vec3 radiance=uSunColor*uSunIntensity;
    vec3 directLight=(diffuse+specularBRDF)*radiance*NdotL*shadow;
    
    // === IBL refleksije ===
    vec3 envDiffuse=textureLod(uEnvMap,bentNormalWorld,uCubeMaxMip*.98).rgb;
    
    float mip=clamp(roughness*uCubeMaxMip,0.,uCubeMaxMip);
    vec3 envSpecular=textureLod(uEnvMap,normalize(Rw),mip).rgb;
    vec2 brdf=texture(uBRDFLUT,vec2(NdotV,roughness)).rg;
    
    vec3 F_IBL=fresnelSchlickRoughness(NdotV,F0,roughness);
    vec3 diffuseIBL=envDiffuse*baseColor*(1.-metalness);
    vec3 specularIBL=envSpecular*(F_IBL*brdf.x+brdf.y);
    // === Specular occlusion (npr. GTAO-like) ===
    
    // boost specular "oiliness"
    float glossBoost=smoothstep(0.,.4,1.-roughness);
    specularIBL*=1.+glossBoost*1.8;
    specularIBL*=shadowFade;
    vec3 ambient=diffuseIBL*ao+specularIBL*ao;
    // === Finalna kompozicija ===
    
    vec3 color=directLight+ambient;
    
    fragColor=vec4(vec3(color),1.);
    
}
