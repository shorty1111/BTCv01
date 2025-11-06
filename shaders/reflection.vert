#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNor;
layout(location=2) in vec2 aUV;

uniform mat4 uProjection;
uniform mat4 uView;
uniform mat4 uModel;
uniform vec4 uClipPlane;     // 👈 dodaj ovo

out vec2 vUV;
out vec3 vNormal;
out vec3 vWorldPos;
out float vClipDist;         // 👈 izlaz za clip dist

void main() {
    vec4 worldPos = uModel * vec4(aPos, 1.0);
    vUV = aUV;
    vNormal = normalize(mat3(uModel) * aNor);
    vWorldPos = worldPos.xyz;
    vClipDist = dot(worldPos, uClipPlane);     // 👈 udaljenost od ravni
    gl_Position = uProjection * uView * worldPos;
}
