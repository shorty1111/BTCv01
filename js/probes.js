import { persp, look, mat4mul, v3, lookAt } from "./math.js";
import { TEXTURE_SLOTS, cleanupTextureState } from "./texture-slots.js";

// ========== GLOBALNE PROMENLJIVE ==========
let probeGrid = null;
let probeCubemaps = [];
let probeFBO = null;
let probeDepthRB = null;
const PROBE_RESOLUTION = 128;

// ========================================
//  1. GENERISANJE PROBE GRID-A
// ========================================

export function generateProbeGrid(gl, min, max, density = 0.25) {
  console.log("🔵 Generišem probe grid...");
  
  const size = [
    max[0] - min[0],
    max[1] - min[1],
    max[2] - min[2]
  ];
  
  const gridSize = [
    Math.max(2, Math.ceil(size[0] * density)),
    Math.max(2, Math.ceil(size[1] * density)),
    Math.max(2, Math.ceil(size[2] * density))
  ];
  
  const cellSize = [
    size[0] / (gridSize[0] - 1),
    size[1] / (gridSize[1] - 1),
    size[2] / (gridSize[2] - 1)
  ];
  
  const probes = [];
  for (let z = 0; z < gridSize[2]; z++) {
    for (let y = 0; y < gridSize[1]; y++) {
      for (let x = 0; x < gridSize[0]; x++) {
        probes.push({
          position: [
            min[0] + x * cellSize[0],
            min[1] + y * cellSize[1],
            min[2] + z * cellSize[2]
          ],
          gridIndex: [x, y, z],
          cubemap: null
        });
      }
    }
  }
  
  probeGrid = { probes, gridSize, cellSize, bounds: { min, max } };
  
  console.log(`✅ Grid kreiran: ${gridSize[0]}×${gridSize[1]}×${gridSize[2]} = ${probes.length} probe-ova`);
  console.log(`📏 Razmak: ${cellSize[0].toFixed(2)}m × ${cellSize[1].toFixed(2)}m × ${cellSize[2].toFixed(2)}m`);
  
  return probeGrid;
}

// ========================================
//  2. KREIRANJE PROBE FRAMEBUFFER-A
// ========================================

function createProbeFBO(gl) {
  if (probeFBO) {
    gl.deleteFramebuffer(probeFBO);
    gl.deleteRenderbuffer(probeDepthRB);
  }
  
  probeFBO = gl.createFramebuffer();
  probeDepthRB = gl.createRenderbuffer();
  
  gl.bindRenderbuffer(gl.RENDERBUFFER, probeDepthRB);
  gl.renderbufferStorage(
    gl.RENDERBUFFER,
    gl.DEPTH_COMPONENT24,
    PROBE_RESOLUTION,
    PROBE_RESOLUTION
  );
  
  gl.bindFramebuffer(gl.FRAMEBUFFER, probeFBO);
  gl.framebufferRenderbuffer(
    gl.FRAMEBUFFER,
    gl.DEPTH_ATTACHMENT,
    gl.RENDERBUFFER,
    probeDepthRB
  );
  
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}

// ========================================
//  3. BAKING PROBE CUBEMAP-A
// ========================================

function bakeProbe(gl, probePos, sceneData, skyParams, drawSceneCallback) {
  const cubemap = gl.createTexture();
  
  gl.activeTexture(gl.TEXTURE0 + TEXTURE_SLOTS.PROBE_TEMP);
  gl.bindTexture(gl.TEXTURE_CUBE_MAP, cubemap);
  
  for (let i = 0; i < 6; i++) {
    gl.texImage2D(
      gl.TEXTURE_CUBE_MAP_POSITIVE_X + i,
      0,
      gl.RGBA16F,
      PROBE_RESOLUTION,
      PROBE_RESOLUTION,
      0,
      gl.RGBA,
      gl.HALF_FLOAT,
      null
    );
  }
  
  gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
  
  gl.bindTexture(gl.TEXTURE_CUBE_MAP, null);
  gl.activeTexture(gl.TEXTURE0);
  
  const proj = persp(90, 1.0, 0.1, 100);
  
  // ✅ Y osa SWAPPED:
const views = [
  lookAt(probePos, [probePos[0] + 1, probePos[1], probePos[2]], [0, -1, 0]),  // +X 👈 VRATI -1
  lookAt(probePos, [probePos[0] - 1, probePos[1], probePos[2]], [0, -1, 0]),  // -X 👈 VRATI -1
  lookAt(probePos, [probePos[0], probePos[1] - 1, probePos[2]], [0, 0, -1]),  // +Y gore 👈 SWAP target
  lookAt(probePos, [probePos[0], probePos[1] + 1, probePos[2]], [0, 0, 1]),   // -Y dole 👈 SWAP target
  lookAt(probePos, [probePos[0], probePos[1], probePos[2] + 1], [0, -1, 0]),  // +Z 👈 VRATI -1
  lookAt(probePos, [probePos[0], probePos[1], probePos[2] - 1], [0, -1, 0])   // -Z 👈 VRATI -1
];
  for (let face = 0; face < 6; face++) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, probeFBO);
    gl.viewport(0, 0, PROBE_RESOLUTION, PROBE_RESOLUTION);
    
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_CUBE_MAP_POSITIVE_X + face,
      cubemap,
      0
    );
    
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    
    const view = views[face];
    
    const { sunDir, sunColor, sunIntensity } = skyParams;
    
    if (window.drawSky) {
      window.drawSky(gl, probeFBO, view, proj, sunDir, {
        ...window.DEFAULT_SKY,
        sunColor,
        sunIntensity,
        useTonemap: false,
        hideSun: false,
        worldLocked: 0,
      });
    }
    
    if (drawSceneCallback) {
      drawSceneCallback(gl, proj, view, probePos, sceneData, skyParams);
    }
  }
  
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  
  gl.activeTexture(gl.TEXTURE0 + TEXTURE_SLOTS.PROBE_TEMP);
  gl.bindTexture(gl.TEXTURE_CUBE_MAP, cubemap);
  gl.generateMipmap(gl.TEXTURE_CUBE_MAP);
  gl.bindTexture(gl.TEXTURE_CUBE_MAP, null);
  gl.activeTexture(gl.TEXTURE0);
  
  return cubemap;
}
export async function bakeAllProbes(gl, sceneData, skyParams, drawSceneCallback, progressCallback) {
  if (!probeGrid) {
    console.error("❌ Probe grid nije generisan! Pozovi generateProbeGrid() prvo.");
    return;
  }
  
  console.log("🔥 Pokrećem baking svih probe-ova...");
  createProbeFBO(gl);
  
  probeCubemaps = [];
  const total = probeGrid.probes.length;
  
  for (let i = 0; i < total; i++) {
    const probe = probeGrid.probes[i];
    
    const cubemap = bakeProbe(gl, probe.position, sceneData, skyParams, drawSceneCallback);
    probe.cubemap = cubemap;
    probeCubemaps.push(cubemap);
    
    if (progressCallback) {
      progressCallback(i + 1, total);
    }
    
    if (i % 5 === 0) {
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  }
  
  console.log(`✅ Završeno! Bake-ovano ${probeCubemaps.length} probe-ova.`);
}

// ========================================
//  5. INTERPOLACIJA PROBE-OVA
// ========================================

export function getProbesForPosition(worldPos) {
  if (!probeGrid) return null;
  
  const { min, max } = probeGrid.bounds;
  const { gridSize, cellSize, probes } = probeGrid;
  
  const localPos = [
    Math.max(0, Math.min(gridSize[0] - 1.001, (worldPos[0] - min[0]) / cellSize[0])),
    Math.max(0, Math.min(gridSize[1] - 1.001, (worldPos[1] - min[1]) / cellSize[1])),
    Math.max(0, Math.min(gridSize[2] - 1.001, (worldPos[2] - min[2]) / cellSize[2]))
  ];
  
  const ix = Math.floor(localPos[0]);
  const iy = Math.floor(localPos[1]);
  const iz = Math.floor(localPos[2]);
  
  const fx = localPos[0] - ix;
  const fy = localPos[1] - iy;
  const fz = localPos[2] - iz;
  
  const nearbyProbes = [];
  const weights = [];
  
  for (let dz = 0; dz <= 1; dz++) {
    for (let dy = 0; dy <= 1; dy++) {
      for (let dx = 0; dx <= 1; dx++) {
        const gx = Math.min(ix + dx, gridSize[0] - 1);
        const gy = Math.min(iy + dy, gridSize[1] - 1);
        const gz = Math.min(iz + dz, gridSize[2] - 1);
        
        const index = gz * (gridSize[0] * gridSize[1]) + gy * gridSize[0] + gx;
        const probe = probes[index];
        
        if (probe && probe.cubemap) {
          const wx = dx === 0 ? (1 - fx) : fx;
          const wy = dy === 0 ? (1 - fy) : fy;
          const wz = dz === 0 ? (1 - fz) : fz;
          const weight = wx * wy * wz;
          
          nearbyProbes.push(probe);
          weights.push(weight);
        }
      }
    }
  }
  
  return { probes: nearbyProbes, weights };
}

// ========================================
//  6. UPDATE SISTEMA
// ========================================

export function updateProbes(gl, changedPositions, sceneData, skyParams, drawSceneCallback) {
  if (!probeGrid) return;
  
  const INFLUENCE_RADIUS = Math.max(...probeGrid.cellSize) * 1.5;
  const toUpdate = new Set();
  
  for (const pos of changedPositions) {
    for (let i = 0; i < probeGrid.probes.length; i++) {
      const probe = probeGrid.probes[i];
      const dist = v3.dist(pos, probe.position);
      
      if (dist < INFLUENCE_RADIUS) {
        toUpdate.add(i);
      }
    }
  }
  
  console.log(`🔄 Re-baking ${toUpdate.size} probe-ova...`);
  
  for (const index of toUpdate) {
    const probe = probeGrid.probes[index];
    if (probe.cubemap) {
      gl.deleteTexture(probe.cubemap);
    }
    probe.cubemap = bakeProbe(gl, probe.position, sceneData, skyParams, drawSceneCallback);
    probeCubemaps[index] = probe.cubemap;
  }
}

// ========================================
//  7. CLEANUP
// ========================================

export function cleanupProbes(gl) {
  probeCubemaps.forEach(tex => gl.deleteTexture(tex));
  if (probeFBO) gl.deleteFramebuffer(probeFBO);
  if (probeDepthRB) gl.deleteRenderbuffer(probeDepthRB);
  
  probeCubemaps = [];
  probeGrid = null;
  probeFBO = null;
  probeDepthRB = null;
  
  console.log("🧹 Probe sistem očišćen");
}

// ========================================
//  8. EXPORT PROBE DATA
// ========================================

export function getProbeGrid() {
  return probeGrid;
}

export function getProbeCubemaps() {
  return probeCubemaps;
}