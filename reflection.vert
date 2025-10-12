#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNor;
layout(location=2) in vec2 aUV;

uniform mat4 uProjection;
uniform mat4 uView;
uniform mat4 uModel;

out vec2 vUV;
out vec3 vNormal;
out vec3 vWorldPos;

void main() {
    vUV = aUV;
    vNormal = normalize(mat3(uModel) * aNor);
    vWorldPos = (uModel * vec4(aPos, 1.0)).xyz; // Ovo ti treba za PBR refleksiju

    gl_Position = uProjection * uView * uModel * vec4(aPos, 1.0);
}
