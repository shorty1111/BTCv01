#version 300 es
precision highp float;

in vec2 vUV;
out vec4 fragColor;

uniform sampler2D gPosition;
uniform sampler2D gNormal;
uniform sampler2D gMaterial;   // roughness = .r , metal = .g
uniform sampler2D uSceneColor;
uniform mat4  uProjection;

const int   MAX_STEPS  = 40;
const float STEP_SIZE  = 0.02;
const float MAX_DIST   = 50.0;
const float THICKNESS  = 0.12;

vec3 getPos(vec2 uv){ return texture(gPosition, uv).rgb; }
vec3 getNormal(vec2 uv){ return normalize(texture(gNormal, uv).rgb); }

vec2 projectToUV(vec3 pV){
    vec4 clip = uProjection * vec4(pV, 1.0);
    vec2 ndc = clip.xy / clip.w;
    return ndc * 0.5 + 0.5;
}

void main(){
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

    // front facing cutoff
    if (Nv < 0.1 || rough > 0.98) {
        fragColor = texture(uSceneColor, vUV);
        return;
    }

    vec3 ray = posV + N * 0.03;
    vec3 stepV = R * STEP_SIZE;

    vec3 hitColor = vec3(0.0);
    float hit = 0.0;

    for (int i = 0; i < MAX_STEPS; i++) {
        ray += stepV;
        if (ray.z < -MAX_DIST || ray.z > -0.1) break;

        vec2 uv = projectToUV(ray);
        if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) break;

        vec3 sceneP = texture(gPosition, uv).rgb;
        float dz = ray.z - sceneP.z;

        // early reject
        if (abs(dz) > THICKNESS) continue;

        if (dz < 0.0 && dz > -THICKNESS) {
            // mip LOD sampling — koristi roughness kao blur faktor
            float lod = rough * 4.0;
            hitColor = textureLod(uSceneColor, uv, lod).rgb;

            // lagani "blur" blend u zavisnosti od roughness
            // (ovo sprečava flicker kod tankih ivica)
            vec3 around =
                0.25 * textureLod(uSceneColor, uv + vec2( 1.0, 0.0) / vec2(textureSize(uSceneColor, 0)), lod).rgb +
                0.25 * textureLod(uSceneColor, uv + vec2(-1.0, 0.0) / vec2(textureSize(uSceneColor, 0)), lod).rgb +
                0.25 * textureLod(uSceneColor, uv + vec2( 0.0, 1.0) / vec2(textureSize(uSceneColor, 0)), lod).rgb +
                0.25 * textureLod(uSceneColor, uv + vec2( 0.0,-1.0) / vec2(textureSize(uSceneColor, 0)), lod).rgb;
            hitColor = mix(hitColor, around, clamp(rough * 1.3, 0.0, 0.8));

            hit = 1.0;
            break;
        }
    }

    vec3 base = texture(uSceneColor, vUV).rgb;

    float gloss = 1.0 - rough;
    float fres  = pow(1.0 - Nv, 5.0);
    float reflectivity = mix(0.04, 1.0, metal);
    float blend = hit * gloss * reflectivity * (0.9 + 0.5 * fres);

    fragColor = vec4(mix(base, hitColor, blend), 1.0);
}
