#version 300 es
precision highp float;

smooth in vec3 vFragPosView;
smooth in vec3 vNormalView;
smooth in mat3 vTBN;
in vec2 vUV_out;

uniform vec3 uBaseColor;
uniform sampler2D uBaseColorTex;
uniform bool uUseBaseColorTex;

uniform sampler2D uNormalTex;
uniform bool uUseNormalTex;

uniform sampler2D uRoughnessTex;
uniform bool uUseRoughnessTex;

uniform float uRoughness;
uniform float uMetallic;

layout(location = 0) out vec4 outGPosition;
layout(location = 1) out vec4 outGNormal;
layout(location = 2) out vec4 outGAlbedo;
layout(location = 3) out vec4 outGMaterial;

void main() {
    // --- Pozicija u view-space ---
    outGPosition = vec4(vFragPosView, 1.0);

    // --- Normal mapa ---
    vec3 normalView = normalize(vNormalView);
    if (uUseNormalTex) {
        vec3 nTex = texture(uNormalTex, vUV_out, 0.5).rgb * 2.0 - 1.0;
        nTex.y = -nTex.y;
        normalView = normalize(vTBN * nTex);
    }
    outGNormal = vec4(normalView, 1.0);

    // --- Albedo ---
    vec3 albedo;
    if (uUseBaseColorTex) {
        vec4 tex = texture(uBaseColorTex, vUV_out);
        albedo = pow(tex.rgb, vec3(2.2)); // sRGB → linear
    } else {
        albedo = uBaseColor;
    }
    outGAlbedo = vec4(albedo, 1.0);

    // --- Roughness i Metallic ---
    // Prvo postavi fallback vrednosti iz uniforma
    float rough = clamp(uRoughness, 0.04, 1.0); // min 0.04 za fizički korektno PBR
    float metal = clamp(uMetallic, 0.0, 1.0);

    // Ako postoji glTF metallicRoughness tekstura, ZAMENI vrednosti
    if (uUseRoughnessTex) {
        vec3 mrSample = texture(uRoughnessTex, vUV_out).rgb;
        rough *= mrSample.g; // ✅ Zeleni kanal = roughness (ZAMENI, ne mnozi!)
        metal *= mrSample.b; // ✅ Plavi kanal = metallic (ako postoji u teksturi)
    }

    // Zapiši u G-buffer
    outGMaterial = vec4(rough, metal, 0.0, 1.0);
}