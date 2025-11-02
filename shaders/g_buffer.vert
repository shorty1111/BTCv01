#version 300 es
precision highp float;

layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNormal;
layout(location=2) in vec2 aUV;
layout(location=3) in vec4 aTangent; // ako model ima tangente (GLTF obično ima)

uniform mat4 uProjection;
uniform mat4 uView;
uniform mat4 uModel;

smooth out vec3 vFragPosView;
smooth out vec3 vNormalView;
smooth out mat3 vTBN;
out vec2 vUV_out;

void main() {
    mat4 modelView = uView * uModel;
    vFragPosView = vec3(modelView * vec4(aPos, 1.0));

    // view-space normal
    mat3 normalMatrix = mat3(modelView);
    vec3 N = normalize(normalMatrix * aNormal);

    // tangent-space matrica ako ima tangente
    vec3 T = normalize(normalMatrix * aTangent.xyz);
    vec3 B = normalize(cross(T, N)) * aTangent.w;
    vTBN = mat3(T, B, N);

    vNormalView = N;
    vUV_out = aUV;
    gl_Position = uProjection * modelView * vec4(aPos, 1.0);
}
