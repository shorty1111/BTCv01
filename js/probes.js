import { v3, lookAt } from "./math.js";
import { TEXTURE_SLOTS } from "./texture-slots.js";

// ========== GLOBALNE PROMENLJIVE ==========
let probeGrid = null;
let probeCubemaps = [];
let probeFBO = null;
let probeDepthRB = null;
const PROBE_RESOLUTION = 128;

export const MAX_SUPPORTED_PROBES = 5;

const DEFAULT_GENERATE_OPTIONS = {
  padding: {
    horizontal: 1.2,
    vertical: 0.8,
  },
  minSpacing: 1.25,
  maxSpacing: 5.5,
  maxPerAxis: 4,
  maxProbes: MAX_SUPPORTED_PROBES,
  radiusPadding: 0.75,
  minRadius: 1.0,
};

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

function resolvePadding(extents, optionsPadding = {}) {
  const pad = {
    horizontal:
      typeof optionsPadding.horizontal === "number"
        ? optionsPadding.horizontal
        : typeof optionsPadding === "number"
        ? optionsPadding
        : DEFAULT_GENERATE_OPTIONS.padding.horizontal,
    depth:
      typeof optionsPadding.depth === "number"
        ? optionsPadding.depth
        : typeof optionsPadding.horizontal === "number"
        ? optionsPadding.horizontal
        : typeof optionsPadding === "number"
        ? optionsPadding
        : DEFAULT_GENERATE_OPTIONS.padding.horizontal,
    vertical:
      typeof optionsPadding.vertical === "number"
        ? optionsPadding.vertical
        : typeof optionsPadding === "number"
        ? optionsPadding * 0.6
        : DEFAULT_GENERATE_OPTIONS.padding.vertical,
  };

  const longestHorizontal = Math.max(extents[0], extents[2]);
  const horizontalAuto = Math.max(longestHorizontal * 0.08, DEFAULT_GENERATE_OPTIONS.minSpacing * 0.5);
  const verticalAuto = Math.max(extents[1] * 0.15, DEFAULT_GENERATE_OPTIONS.minSpacing * 0.25);

  return {
    x: Math.max(pad.horizontal, horizontalAuto),
    y: Math.max(pad.vertical, verticalAuto),
    z: Math.max(pad.depth, horizontalAuto),
  };
}

function computeGridCounts(extents, opts) {
  const longestSpan = Math.max(extents[0], extents[1], extents[2], opts.minSpacing);
  const baseSpacing = clamp(longestSpan / Math.max(2, opts.maxProbes - 1), opts.minSpacing, opts.maxSpacing);

  const desired = extents.map((extent) => {
    if (extent <= opts.minSpacing * 0.5) return 1;
    return clamp(Math.round(extent / baseSpacing) + 1, 1, opts.maxPerAxis);
  });

  const counts = [1, 1, 1];
  const axisOrder = [0, 1, 2].sort((a, b) => extents[b] - extents[a]);
  const totalCount = (arr) => arr[0] * arr[1] * arr[2];

  let improved = true;
  while (improved) {
    improved = false;
    for (const axis of axisOrder) {
      if (counts[axis] >= desired[axis]) continue;
      const candidate = counts.slice();
      candidate[axis] += 1;
      if (totalCount(candidate) > opts.maxProbes) continue;
      counts[axis] = candidate[axis];
      improved = true;
    }
  }

  for (const axis of axisOrder) {
    if (extents[axis] > opts.minSpacing * 1.5 && counts[axis] === 1) {
      const candidate = counts.slice();
      candidate[axis] += 1;
      if (totalCount(candidate) <= opts.maxProbes) {
        counts[axis] = candidate[axis];
      }
    }
  }

  return counts;
}

function computeCellSize(extents, counts, opts) {
  return counts.map((count, axis) => {
    const extent = extents[axis];
    if (count <= 1) return Math.max(extent, opts.minSpacing);
    return extent / (count - 1);
  });
}

function computeBaseRadius(extents, cellSize, counts, opts) {
  const step = [0, 1, 2].map((axis) => (counts[axis] > 1 ? cellSize[axis] : extents[axis]));
  const diag = Math.hypot(step[0], step[1], step[2]);
  return Math.max(opts.minRadius, diag * 0.5 + opts.radiusPadding);
}

export function generateAdaptiveProbeGrid(gl, bounds, options = {}) {
  if (!bounds || !bounds.min || !bounds.max) {
    throw new Error("generateAdaptiveProbeGrid expects bounds { min, max }");
  }

  const opts = {
    ...DEFAULT_GENERATE_OPTIONS,
    ...options,
    padding: options.padding ?? DEFAULT_GENERATE_OPTIONS.padding,
  };
  opts.maxProbes = clamp(options.maxProbes ?? opts.maxProbes ?? MAX_SUPPORTED_PROBES, 1, MAX_SUPPORTED_PROBES);

  const min = bounds.min.slice();
  const max = bounds.max.slice();
  const extents = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];

  const padding = resolvePadding(extents, opts.padding);
  const paddedMin = [min[0] - padding.x, min[1] - padding.y, min[2] - padding.z];
  const paddedMax = [max[0] + padding.x, max[1] + padding.y, max[2] + padding.z];
  const paddedExtents = [
    paddedMax[0] - paddedMin[0],
    paddedMax[1] - paddedMin[1],
    paddedMax[2] - paddedMin[2],
  ];

  const counts = computeGridCounts(paddedExtents, opts);
  const cellSize = computeCellSize(paddedExtents, counts, opts);
  const baseRadius = computeBaseRadius(paddedExtents, cellSize, counts, opts);

  const probes = [];
  for (let z = 0; z < counts[2]; z++) {
    for (let y = 0; y < counts[1]; y++) {
      for (let x = 0; x < counts[0]; x++) {
        const position = [
          counts[0] === 1 ? (paddedMin[0] + paddedMax[0]) * 0.5 : paddedMin[0] + cellSize[0] * x,
          counts[1] === 1 ? (paddedMin[1] + paddedMax[1]) * 0.5 : paddedMin[1] + cellSize[1] * y,
          counts[2] === 1 ? (paddedMin[2] + paddedMax[2]) * 0.5 : paddedMin[2] + cellSize[2] * z,
        ];

        probes.push({
          position,
          gridIndex: [x, y, z],
          cubemap: null,
          radius: baseRadius,
        });
      }
    }
  }

  probeGrid = {
    probes,
    gridSize: counts,
    cellSize,
    bounds: { min: paddedMin, max: paddedMax },
    options: opts,
    baseRadius,
    extents: paddedExtents,
  };

  console.log(
    `🔵 Generišem adaptivnu probe mrežu ${counts[0]}x${counts[1]}x${counts[2]} (ukupno ${probes.length})`
  );
  console.log(
    `📏 Razmaci: ${cellSize.map((v) => v.toFixed(2)).join("m / ")}m · Radijus pokrivanja ≈ ${baseRadius.toFixed(2)}m`
  );

  return probeGrid;
}

export function generateProbeGrid(gl, minOrBounds, maybeMax, maybeOptions) {
  if (Array.isArray(minOrBounds) && Array.isArray(maybeMax)) {
    const bounds = { min: minOrBounds, max: maybeMax };
    const opts = typeof maybeOptions === "object" ? maybeOptions : {};
    if (typeof maybeOptions === "number") opts.maxProbes = maybeOptions;
    if (typeof opts.count === "number") opts.maxProbes = opts.count;
    return generateAdaptiveProbeGrid(gl, bounds, opts);
  }

  return generateAdaptiveProbeGrid(gl, minOrBounds, maybeMax);
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
  
  const proj = (function (fovyDeg, aspect, near, far) {
    const f = 1.0 / Math.tan((fovyDeg * Math.PI) / 360.0);
    const nf = 1.0 / (near - far);
    const out = new Float32Array(16);
    out[0] = f / aspect;
    out[5] = f;
    out[10] = (far + near) * nf;
    out[11] = -1;
    out[14] = 2 * far * near * nf;
    out[15] = 0; 
    return out;
  })(90, 1, 0.1, 2000);

  // ✅ JEDNOSTAVNIJE: Koristi lookAt na prirodan način
  const views = [
    lookAt(probePos, [probePos[0] + 1, probePos[1], probePos[2]], [0, 1, 0]),  // +X right
    lookAt(probePos, [probePos[0] - 1, probePos[1], probePos[2]], [0, 1, 0]),  // -X left  
    lookAt(probePos, [probePos[0], probePos[1] + 1, probePos[2]], [0, 0, -1]), // +Y top
    lookAt(probePos, [probePos[0], probePos[1] - 1, probePos[2]], [0, 0, 1]),  // -Y bottom
    lookAt(probePos, [probePos[0], probePos[1], probePos[2] + 1], [0, 1, 0]),  // +Z front
    lookAt(probePos, [probePos[0], probePos[1], probePos[2] - 1], [0, 1, 0])   // -Z back
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
    
    // ✅ Provjeri FBO status
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (status !== gl.FRAMEBUFFER_COMPLETE) {
      console.error("❌ FBO nije kompletan:", status);
      continue;
    }
    
    gl.clearColor(0.1, 0.1, 0.3, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    
    const view = views[face];
    
    // ✅ NORMALAN CULLING (probaj oba načina)
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);  // Prvo probaj BACK
    gl.frontFace(gl.CCW);
    
    const { sunDir, sunColor, sunIntensity } = skyParams;
    
    // Render skybox (bez culling-a)
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);

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

    // Render scene
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);  // Standardni culling
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(true);
    
    if (drawSceneCallback) {
      drawSceneCallback(gl, proj, view, probePos, sceneData, skyParams, probeFBO);
    }
    
    console.log(`✅ Rendered cubemap face ${face}`);
  }
  
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  
  // Generiši mipmap-e
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