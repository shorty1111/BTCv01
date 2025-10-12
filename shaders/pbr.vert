#version 300 es
layout (location = 0) in vec3 aPos;
layout (location = 1) in vec3 aNormal;
layout (location = 2) in vec2 aUV;

uniform mat4 uProjection;
uniform mat4 uView;
uniform mat4 uModel;

out vec3 vWorldPos;
out vec3 vNormal;
out vec2 vUV;
out vec4 vFragPosClip; // <<<< PROVERI DA LI OVA LINIJA POSTOJI

void main() {
    vWorldPos = (uModel * vec4(aPos, 1.0)).xyz;
    vNormal = mat3(transpose(inverse(uModel))) * aNormal;
    vUV = aUV;
    
    gl_Position = uProjection * uView * uModel * vec4(aPos, 1.0);
    vFragPosClip = gl_Position; // <<<< I DA LI OVA LINIJA POSTOJI
}