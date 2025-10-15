#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNormal;
layout(location=2) in vec2 aUV;

uniform mat4 uProjection;
uniform mat4 uView;
uniform mat4 uModel;

smooth out vec3 vNormalView;   // <-- OBAVEZNO "smooth"
smooth out vec3 vFragPosView;
out vec2 vUV_out;

void main() {
    mat4 modelView = uView * uModel;
    vFragPosView = vec3(modelView * vec4(aPos, 1.0));
    vNormalView = normalize(mat3(transpose(inverse(modelView))) * aNormal);
    vUV_out = aUV;
    gl_Position = uProjection * modelView * vec4(aPos, 1.0);
}
