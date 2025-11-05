#version 300 es
precision highp float;

in vec2 vUV;
out vec4 fragColor;

uniform sampler2D gPosition;
uniform sampler2D gNormal;
uniform sampler2D gMaterial;   // roughness = .r , metal = .g
uniform sampler2D uSceneColor;
uniform mat4  uProjection;
uniform mat4 uView;              // 👈 DODAJ (za world space)
uniform samplerCube uEnvMap;     // 👈 DODAJ
uniform float uCubeMaxMip;       // 👈 DODAJ (za roughness LOD)

const int   MAX_STEPS  = 30;
const float STEP_SIZE  = 0.05;
const float MAX_DIST   = 30.0;
const float THICKNESS  = 0.2;

vec3 getPos(vec2 uv){ return texture(gPosition, uv).rgb; }
vec3 getNormal(vec2 uv){ return normalize(texture(gNormal, uv).rgb); }

vec2 projectToUV(vec3 pV){
    vec4 clip = uProjection * vec4(pV, 1.0);
    vec2 ndc = clip.xy / clip.w;
    return ndc * 0.5 + 0.5;
}

void main() {
    vec3 posV = getPos(vUV);
    if (posV.z > -0.1) {
        fragColor = texture(uSceneColor, vUV);
        return;
    }

    vec3 N = getNormal(vUV);
    vec3 V = normalize(-posV);
    float Nv = max(dot(N, V), 0.0);
    vec3 R = reflect(-V, N);

    vec2 mat = texture(gMaterial, vUV).rg;
    float rough = mat.r;
    float metal = mat.g;

    // front-facing cutoff
    if (Nv < 0.1 || rough > 0.98) {
        fragColor = texture(uSceneColor, vUV);
        return;
    }

    // Roughness-based reflection spread
    float spread = rough * rough * 0.8;

    // stabilni hash (niža frekvencija)
    vec2 cell = floor(vUV * vec2(4000.0));
    float h1 = fract(sin(dot(cell, vec2(12.9898,78.233))) * 43758.5453);
    float h2 = fract(sin(dot(cell + 13.37, vec2(41.23,95.78))) * 24634.6345);
    float angle = h1 * 6.2831853;
    float amp   = (h2 - 0.5) * 2.0 * spread * 0.5;

    vec3 up = abs(R.z) < 0.999 ? vec3(0.0,0.0,1.0) : vec3(1.0,0.0,0.0);
    vec3 T = normalize(cross(up, R));
    vec3 B = cross(R, T);
    R = normalize(R + amp * (T * cos(angle) + B * sin(angle)));

    vec3 ray = posV + N * 0.02;
    vec3 stepV = R * STEP_SIZE;

    vec3 hitColor = vec3(0.0);
    vec2 hitUV = vec2(0.0);
    float hit = 0.0;

    // === Raymarch bez blura ===
    for (int i = 0; i < MAX_STEPS; i++) {
        ray += stepV;
        if (ray.z < -MAX_DIST || ray.z > -0.1) break;

        vec2 uv = projectToUV(ray);
        if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) break;

        vec3 sceneP = texture(gPosition, uv).rgb;
        float dz = ray.z - sceneP.z;
        if (abs(dz) > THICKNESS) continue;

        if (dz < 0.0 && dz > -THICKNESS) {
            if (sceneP.z == 0.0) break;
            float lod = rough * 5.0;
            hitColor = textureLod(uSceneColor, uv, lod).rgb;
            hitUV = uv;
            hit = 1.0;
            break;
        }
    }

    // === Roughness blur (samo jednom) ===
    if (hit > 0.5 && rough > 0.05) {
        vec2 texel = 1.0 / vec2(textureSize(uSceneColor, 0));
        float radius = mix(0.0, 4.0, rough);
        vec3 sum = vec3(0.0);
        float wsum = 0.0;

        for (int x = -1; x <= 1; x++) {
            for (int y = -1; y <= 1; y++) {
                vec2 offs = vec2(x, y) * texel * radius;
                float w = 1.0 / (1.0 + dot(offs, offs) * 100.0);
                sum += textureLod(uSceneColor, hitUV + offs, rough * 5.0).rgb * w;
                wsum += w;
            }
        }
        vec3 blurred = sum / max(wsum, 1e-4);
        hitColor = mix(hitColor, blurred, rough * 1.2);
    }

    vec3 base = texture(uSceneColor, vUV).rgb;
    float gloss = 1.0 - rough;
    float fres  = pow(1.0 - Nv, 8.0);  // jaicna fresnela jaican refleksije takodje!
    float reflectivity = mix(0.04, 1.0, metal);
    float blend = hit * gloss * reflectivity * (1.3 + 0.5 * fres);

    fragColor = vec4(mix(base, hitColor, blend), 1.0);
}
