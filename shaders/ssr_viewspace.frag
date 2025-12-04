#version 300 es
precision highp float;

in vec2 vUV;
out vec4 fragColor;

uniform sampler2D gPosition;
uniform sampler2D gNormal;
uniform sampler2D gMaterial;
uniform sampler2D uSceneColor;
uniform mat4 uProjection;
uniform vec2 uResolution;

const float BASE_STEP = 0.08;
const float THICKNESS = 1.6;
// Smanjeno radi performansi – možeš dalje da šteluješ ovde
const int MAX_STEPS = 28;
const float MAX_DIST = 30.0;

vec3 getPos(vec2 uv) { return texture(gPosition, uv).rgb; }
vec3 getNormal(vec2 uv) { return normalize(texture(gNormal, uv).rgb); }

vec2 projectToUV(vec3 pV) {
    vec4 clip = uProjection * vec4(pV, 1.0);
    vec2 ndc = clip.xy / clip.w;
    vec2 uv = ndc * 0.5 + 0.5;
    return clamp(uv, 0.002, 0.998);
}

vec2 getStableHash(vec2 uv) {
    vec2 cell = floor(uv * vec2(4000.0));
    float h1 = fract(sin(dot(cell, vec2(12.9898,78.233))) * 43758.5453);
    float h2 = fract(sin(dot(cell + 13.37, vec2(41.23,95.78))) * 24634.6345);
    return vec2(h1, h2);
}

float saturate(float v) { return clamp(v, 0.0, 1.0); }

void main() {
    vec3 posV = getPos(vUV);
    if (posV.z > -0.1) {
        fragColor = texture(uSceneColor, vUV);
        return;
    }

    vec3 N = getNormal(vUV);
    vec3 V = normalize(-posV);
    float NdotV = max(dot(N, V), 0.0);
    vec3 R = reflect(-V, N);

    vec2 material = texture(gMaterial, vUV).rg;
    float roughness = material.r;
    float metallic = material.g;

    if (NdotV < 0.1 || roughness > 0.98) {
        fragColor = texture(uSceneColor, vUV);
        return;
    }

    // Jitter konus za roughness – mekše refleksije za grube materijale
    float spread = roughness * roughness * 1.2;
    vec2 hash = getStableHash(vUV);
    float angle = hash.x * 6.2831853;
    float amp = (hash.y - 0.5) * 2.0 * spread;

    vec3 up = abs(R.z) < 0.999 ? vec3(0.0,0.0,1.0) : vec3(1.0,0.0,0.0);
    vec3 T = normalize(cross(up, R));
    vec3 B = cross(R, T);
    R = normalize(R + amp * (T * cos(angle) + B * sin(angle)));

    // Deblji ray hit za dalja / grublja područja -> više SSR hitova
    float distFactor = saturate(length(posV) / MAX_DIST);
    float roughFactor = smoothstep(0.2, 1.0, roughness);
    float thickness = THICKNESS * mix(0.6, 1.4, max(distFactor, roughFactor));
    float jitter = (hash.x - 0.5) * BASE_STEP;
    float adaptStep = mix(0.05, BASE_STEP, saturate(abs(R.z)));
    vec3 ray = posV + N * mix(0.02, 0.1, 1.0 - NdotV) + R * jitter;
    vec3 stepV = R * adaptStep;

    // Broj koraka sada direktno zavisi od distance (min 6, max MAX_STEPS)
    float zoomFactor = clamp(abs(posV.z) / 30.0, 0.3, 1.0);
    int steps = int(mix(6.0, float(MAX_STEPS), zoomFactor));

    vec3 hitColor = vec3(0.0);
    vec2 hitUV = vec2(0.0);
    float hit = 0.0;
    vec3 lastRayPos = ray;
    int i;

    for (i = 0; i < steps; i++) {
        lastRayPos = ray;
        ray += stepV;
        
        if (ray.z < -MAX_DIST || ray.z > -0.1) break;

        vec2 uv = projectToUV(ray);
        if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) break;

        float mip = float(i) / float(MAX_STEPS) * 5.0;
        vec3 sceneP = textureLod(gPosition, uv, mip).rgb;
        float dz = ray.z - sceneP.z;
        if (abs(dz) > thickness) continue;

        if (dz < 0.0 && dz > -thickness) {
            if (sceneP.z == 0.0) break;
            
            for (int j = 0; j < 2; j++) {
                vec3 midRay = (lastRayPos + ray) * 0.5;
                vec2 midUV = projectToUV(midRay);
                if (midUV.x < 0.0 || midUV.x > 1.0 || midUV.y < 0.0 || midUV.y > 1.0) break;
                
                vec3 midScene = getPos(midUV);
                if (midRay.z > midScene.z) {
                    lastRayPos = midRay;
                } else {
                    ray = midRay;
                    uv = midUV;
                }
            }
            
            float lod = roughness * 5.0;
            hitColor = textureLod(uSceneColor, uv, lod).rgb;
            hitUV = uv;
            hit = 1.0;
            break;
        }
    }

    // View-space distance za jeftin fade SSR doprinosa
    float viewDist = length(posV);

    // Blur blok – vraćen na “originalniji” stil (linearni radius, jači falloff)
    if (hit > 0.5 && roughness > 0.05) {
        vec2 texel = 1.0 / uResolution;
        float radius = mix(0.0, 4.0, roughness);
        vec3 sum = vec3(0.0);
        float wsum = 0.0;

        for (int x = -1; x <= 1; x++) {
            for (int y = -1; y <= 1; y++) {
                vec2 offs = vec2(x, y) * texel * radius;
                float w = 1.0 / (1.0 + dot(offs, offs) * 100.0);
                sum += textureLod(uSceneColor, hitUV + offs, roughness * 5.0).rgb * w;
                wsum += w;
            }
        }
        vec3 blurred = sum / max(wsum, 1e-4);
        hitColor = mix(hitColor, blurred, roughness * 1.2);
    }

    vec3 base = texture(uSceneColor, vUV).rgb;

    float gloss = 1.0 - roughness;
    float fresnel = pow(1.0 - NdotV, 5.0);
    float F0 = mix(0.04, 1.0, metallic);
    float F = F0 + (1.0 - F0) * fresnel;

    // Fade prema centru ekrana
    vec2 screenCenter = hitUV * 2.0 - 1.0;
    float screenFade = 1.0 - pow(max(abs(screenCenter.x), abs(screenCenter.y)), 1.0);

    float conf = 1.0 - float(i) / float(max(steps, 1));

    // Priguši SSR na veoma grubim i dalekim površinama – osloni se više na env mapu/PBR
    float roughSSR = 1.0 - smoothstep(0.5, 0.9, roughness);
    float distSSR = 1.0 - smoothstep(25.0, 60.0, viewDist);

    float blend = hit * F * gloss * screenFade * conf * roughSSR * distSSR;
    float edgeFade = smoothstep(0.0, 0.1, min(min(vUV.x, vUV.y), min(1.0 - vUV.x, 1.0 - vUV.y)));
    blend *= edgeFade;
    vec3 reflected = mix(base, hitColor, blend);
    fragColor = vec4(reflected, 1.0);
}
