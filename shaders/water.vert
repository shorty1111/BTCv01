#version 300 es
precision highp float;

/* === uniforme === */
uniform mat4  uProjection, uView, uModel;
uniform float uTime;
uniform vec3  uBoatPos;
uniform vec3  uCameraPos;


/* talasi iz JS-a */
uniform int   uWaveCount;
uniform float uWaveA[32];
uniform float uWaveL[32];
uniform float uWaveQ[32];
uniform vec2  uWaveDir[32];
uniform float uWavePhase[32];
uniform float uWaveOmega[32];

/* === ulazi === */
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec2 aUV;
in float aWaveMask;
layout(location = 3) in vec4 aInstanceData; // (offsetX, offsetZ, scale, divFactor)
/* === izlazi === */
out vec3 vWorldPos;
out vec3 vNormal;
out float vWaveHeight;
out float vWaveMask;
out vec2 vUV;
out vec3 vTBN_T;
out vec3 vTBN_B;
out vec3 vTBN_N;
out float vViewZ;

#define PI 3.14159265

/* ------------------------------------------------------- */
float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453123);
}

float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f*f*(3.0-2.0*f);
    return mix(
        mix(hash(i+vec2(0.0,0.0)),hash(i+vec2(1.0,0.0)),u.x),
        mix(hash(i+vec2(0.0,1.0)),hash(i+vec2(1.0,1.0)),u.x),
        u.y);
}

float fbm(vec2 p){
    float total=0.0;
    float amp=0.5;
    for(int i=0;i<4;i++){
        total+=noise(p)*amp;
        p*=1.0;
        amp*=1.5;
    }
    return total;
}

struct WaveResult{vec3 disp;vec3 derivX;vec3 derivZ;};

WaveResult gerstnerWave(vec3 p,vec2 normXZ,float A,float L,float Q,
                        vec2 dir,float phase,float omega,float t,float phiNoise){
    float k=6.283185/L;
    float distortion=noise(normXZ*0.3+t*0.03)*2.0-1.0;
    float phi=k*dot(dir,p.xz)+omega*t+phase+distortion+phiNoise;
    float cP=cos(phi);
    float sP=sin(phi);

    vec3 disp=vec3(Q*A*dir.x*cP,
                   A*sP,
                   Q*A*dir.y*cP);

    float kA=Q*A*k;
    vec3 dX=vec3(-dir.x*dir.x*kA*sP,
                 A*k*dir.x*cP,
                 -dir.x*dir.y*kA*sP);
    vec3 dZ=vec3(-dir.x*dir.y*kA*sP,
                 A*k*dir.y*cP,
                 -dir.y*dir.y*kA*sP);

    return WaveResult(disp,dX,dZ);
}

/* ------------------------------------------------------- */
void main(){
    float mask=clamp(aWaveMask,0.0,1.0);

    vec3 localPos=(uModel*vec4(aPos,1.0)).xyz;
    vec2 gridOffset = aInstanceData.xy;
    vec3 basePos = localPos + vec3(gridOffset.x, 0.0, gridOffset.y);

    // udaljenost kamere od vertiksa (world-space)
    float distCam=distance(uCameraPos.xz,basePos.xz);

    // --- precizan fade displace-a ---
    float fadeStart=50.0;   // do 100m puni displace
    float fadeEnd  =200.0;   // od 100-300m opada do 0
    float t=clamp((distCam-fadeStart)/(fadeEnd-fadeStart),0.0,0.9);
    float distanceFade=1.0-t;

    vec2 normXZ=(basePos.xz-uBoatPos.xz)/50.0;
    float ampNoise=1.5+0.2*noise(normXZ*0.05+uTime*0.1);

    vec3 disp=vec3(0.0);
    vec3 dX=vec3(1.0,0.0,0.0);
    vec3 dZ=vec3(0.0,0.0,1.0);

    for(int i=0;i<uWaveCount;++i){
        float phaseNoise=1.1*fbm(normXZ*2.3+float(i)*3.3+uTime*0.10);
        WaveResult r=gerstnerWave(basePos,normXZ,
                                  uWaveA[i],uWaveL[i],uWaveQ[i],
                                  uWaveDir[i],uWavePhase[i],uWaveOmega[i],
                                  uTime,phaseNoise);

        disp+=r.disp*mask*ampNoise;
        dX+=r.derivX*mask*ampNoise;
        dZ+=r.derivZ*mask*ampNoise;
    }

    disp*=distanceFade;

    vec3 waveNormal=normalize(cross(dZ,dX));
    vec3 flatNormal=vec3(0.0,1.0,0.0);

    mat3 worldMat=mat3(uModel);
    dX=normalize(worldMat*dX*distanceFade);
    dZ=normalize(worldMat*dZ*distanceFade);
    waveNormal=normalize(worldMat*waveNormal);
    flatNormal=normalize(worldMat*flatNormal);

    vec3 worldPos=basePos+disp;
    vNormal=normalize(mix(flatNormal,waveNormal,mask*distanceFade));

    vTBN_N=normalize(vNormal);
    vTBN_T=normalize(dX);
    vTBN_B=normalize(cross(vTBN_N,vTBN_T));
    vTBN_T=normalize(cross(vTBN_B,vTBN_N));

    vWaveHeight=worldPos.y;
    vWaveMask=mask;
    vWorldPos=worldPos;
    vUV=aUV*4.0;

    vec4 viewPos=uView*vec4(worldPos,1.0);
    vViewZ=viewPos.z;
    gl_Position=uProjection*viewPos;
}
