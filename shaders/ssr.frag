#version 300 es
precision highp float;
in vec2 vUV;
out vec4 fragColor;

uniform sampler2D sceneColor;     // tvoja finalna slika
uniform sampler2D gNormal;        // view-space normale
uniform sampler2D gPosition;      // view-space pozicije
uniform sampler2D sceneDepthTex;  // linear depth u view-space
uniform mat4 uProjection;         // ista koja je korišćena u renderu
uniform vec2 uResolution;

float projToViewZ(float depth, mat4 proj) {
    float z = depth * 2.0 - 1.0;
    return -proj[3][2] / (z + proj[2][2]);
}

void main() {
    vec2 uv = vUV;
    vec3 P = texture(gPosition, uv).xyz;
    vec3 N = normalize(texture(gNormal, uv).xyz);
    vec3 V = normalize(-P);
    vec3 R = normalize(reflect(V, N)); // view-space refleksija

    vec3 hitColor = vec3(0.0);
    bool hit = false;

    // ray marching u view-spaceu
    const int MAX_STEPS = 64;
    const float STEP_SIZE = 0.3;
    const float MAX_DIST = 80.0;

    vec3 rayPos = P;
    for (int i = 0; i < MAX_STEPS; ++i) {
        rayPos += R * STEP_SIZE;

        // projektuj u ekran
        vec4 clip = uProjection * vec4(rayPos, 1.0);
        vec3 ndc = clip.xyz / clip.w;
        vec2 uvRay = ndc.xy * 0.5 + 0.5;

        if (uvRay.x < 0.0 || uvRay.x > 1.0 || uvRay.y < 0.0 || uvRay.y > 1.0)
            break;

        float depthScene = texture(sceneDepthTex, uvRay).r;
        float zScene = projToViewZ(depthScene, uProjection);

        // uporedi view-space Z
        if (rayPos.z > zScene - 0.1) {
            hit = true;
            hitColor = texture(sceneColor, uvRay).rgb;
            break;
        }
        if (abs(rayPos.z) > MAX_DIST) break;
    }

    vec3 base = texture(sceneColor, uv).rgb;
    vec3 refl = hit ? hitColor : base;
    float fresnel = pow(1.0 - max(dot(N, V), 0.0), 5.0);

    fragColor = vec4(mix(base, refl, fresnel), 1.0);
}
