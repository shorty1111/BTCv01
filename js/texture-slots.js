// texture-slots.js
export const TEXTURE_SLOTS = {
  // === PBR LIGHTING PASS (0-9) ===
  PBR_POSITION: 0,
  PBR_NORMAL: 1,
  PBR_ALBEDO: 2,
  PBR_MATERIAL: 3,
  PBR_SSAO: 4,
  PBR_ENV_MAP: 5,
  PBR_BRDF_LUT: 6,
  PBR_SHADOW_MAP: 7,
  PBR_BENT_NORMAL_AO: 8,
  PBR_SCENE_COLOR: 9,
  
  // === SSAO PASS (0-3) ===
  SSAO_POSITION: 0,
  SSAO_NORMAL: 1,
  SSAO_NOISE: 2,
  SSAO_ALBEDO: 3,
  
  // === SSR PASS (0-4) ===
  SSR_POSITION: 0,
  SSR_NORMAL: 1,
  SSR_SCENE_COLOR: 2,
  SSR_MATERIAL: 3,
  SSR_ENV_MAP: 4,
  
  // === G-BUFFER PASS (0-2) ===
  GBUFFER_BASE_COLOR: 0,
  GBUFFER_NORMAL: 1,
  GBUFFER_ROUGHNESS: 2,
  
  // === GLASS PASS (0) ===
  GLASS_ENV_MAP: 0,
  
  // === REFLECTION PASS (0-1) ===
  REFL_BASE_COLOR: 0,
  REFL_ENV_MAP: 1,
  
  // === WATER PASS (0-8) ===
  WATER_NORMAL: 0,
  WATER_ENV_MAP: 1,
  WATER_SCENE_DEPTH: 2,
  WATER_SCENE_COLOR: 3,
  WATER_REFLECTION: 4,
  WATER_SHADOW_MAP: 8,
  
  // === REFLECTION PROBE BAKING (koristi slot 15 - bezbedno daleko od ostalih) ===
  PROBE_TEMP: 15,  // Privremeni slot za probe cubemap tokom baking-a
};

// Helper funkcija za bind
export function bindTextureToSlot(gl, texture, slot, target = gl.TEXTURE_2D) {
  gl.activeTexture(gl.TEXTURE0 + slot);
  gl.bindTexture(target, texture);
}

// 🔒 Bezbedna cleanup funkcija za probe rendering
export function cleanupTextureState(gl, maxSlots = 16) {
  gl.useProgram(null);
  gl.bindVertexArray(null);
  
  for (let i = 0; i < maxSlots; i++) {
    gl.activeTexture(gl.TEXTURE0 + i);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.bindTexture(gl.TEXTURE_CUBE_MAP, null);
  }
  
  gl.activeTexture(gl.TEXTURE0);
}