#version 300 es
precision highp float;


smooth in vec3 vNormalView;    // <-- isto "smooth"
smooth in vec3 vFragPosView;
in vec2 vUV_out;

uniform vec3 uBaseColor;
uniform sampler2D uBaseColorTex;
uniform bool uUseBaseColorTex;
uniform float uRoughness;
uniform float uMetallic;

layout(location = 0) out vec4 outGPosition;
layout(location = 1) out vec4 outGNormal;
layout(location = 2) out vec4 outGAlbedo;
layout(location = 3) out vec4 outGMaterial;

void main() {
    // pozicija i normala u view-space
    outGPosition = vec4(vFragPosView, 1.0);
   outGNormal = vec4(normalize(vNormalView), 1.0);

    // albedo (GLTF teksture su sRGB → linearizuj)
    vec3 albedo;
    if (uUseBaseColorTex) {
        vec4 tex = texture(uBaseColorTex, vUV_out);
        albedo = pow(tex.rgb, vec3(2.2));  // sRGB → linear
        outGAlbedo = vec4(albedo, tex.a);  // zadrži alpha iz teksture
    } else {
        albedo = uBaseColor;
        outGAlbedo = vec4(albedo, 1.0);
    }

    // materijal: roughness + metallic
    outGMaterial = vec4(uRoughness, uMetallic, 0.0, 1.0);
}
