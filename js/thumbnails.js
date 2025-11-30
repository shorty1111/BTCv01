import { THUMBNAIL_CAM_PRESETS } from "./config.js";

export const PLACEHOLDER_THUMB = "assets/part_placeholder.png";
export const thumbnails = {};
const THUMB_DEFAULT_COLOR_KEY = "__default__";

const THUMB_CAM_PARAM = new URLSearchParams(window.location.search).get("cam_pos");
const THUMBNAIL_CAM_INDEX_PARAM =
  Number.isFinite(parseInt(THUMB_CAM_PARAM, 10)) && parseInt(THUMB_CAM_PARAM, 10) > 0
    ? parseInt(THUMB_CAM_PARAM, 10) - 1
    : null;

function getThumbnailCamPresetIndex(variant) {
  const v = variant?.thumbCam;
  const idxFromVariant =
    Number.isFinite(parseInt(v, 10)) && parseInt(v, 10) > 0 ? parseInt(v, 10) - 1 : null;
  if (idxFromVariant !== null) return idxFromVariant;
  return THUMBNAIL_CAM_INDEX_PARAM;
}

export function createThumbnailGenerator({
  canvas,
  gl,
  camera,
  nodesMeta,
  getNodesMeta,
  variantGroups,
  currentParts,
  savedColorsByPart,
  cachedVariants,
  preparedVariants,
  parseGLBToPrepared,
  ensureNodeBounds,
  focusCameraOnNode,
  replaceSelectedWithURL,
  waitForPendingTextures,
  recenterCameraToBounds,
  render,
  updateLoadingProgress,
  setSceneChanged,
}) {
  let __canvasHiddenForThumbs = false;
  let thumbnailCaptureCanvas = null;

  const colorsForVariant = (variant) => {
    if (Array.isArray(variant?.colors) && variant.colors.length) {
      return variant.colors.map((c) => c?.name).filter(Boolean);
    }
    return [null];
  };

  const findVariantData = (partName, variantName) => {
    for (const parts of Object.values(variantGroups || {})) {
      const partData = parts?.[partName];
      if (partData?.models) {
        const variant = partData.models.find((m) => m?.name === variantName);
        if (variant) return { variant, partData };
      }
    }
    return { variant: null, partData: null };
  };

  const storeThumbnail = (partName, variantName, colorName, thumb) => {
    const key = colorName || THUMB_DEFAULT_COLOR_KEY;
    thumbnails[partName] = thumbnails[partName] || {};
    const bucket =
      typeof thumbnails[partName][variantName] === "object"
        ? thumbnails[partName][variantName]
        : {};
    bucket[key] = thumb;
    thumbnails[partName][variantName] = bucket;
  };

  const recenterCameraForThumbnail = recenterCameraToBounds;
  const markSceneChanged = () => {
    if (typeof setSceneChanged === "function") {
      setSceneChanged();
    }
  };

  function hideCanvasForThumbnails() {
    const canvasEl = canvas || document.getElementById("glCanvas");
    return canvasEl || null;
  }

  function restoreCanvasAfterThumbnails() {
    __canvasHiddenForThumbs = false;
  }

  function cloneState(value) {
    if (value == null) return value;
    try {
      return JSON.parse(JSON.stringify(value));
    } catch {
      return value;
    }
  }

  function restoreObject(target, snapshot) {
    if (!target) return;
    const keys = Object.keys(target);
    for (const key of keys) {
      delete target[key];
    }
    if (!snapshot) return;
    for (const [key, val] of Object.entries(snapshot)) {
      target[key] = cloneState(val);
    }
  }

  function captureCameraState() {
    return {
      pan: camera.pan ? camera.pan.slice() : [0, 0, 0],
      panTarget: camera.panTarget ? camera.panTarget.slice() : [0, 0, 0],
      rx: camera.rx,
      ry: camera.ry,
      rxTarget: camera.rxTarget,
      ryTarget: camera.ryTarget,
      dist: camera.dist,
      distTarget: camera.distTarget,
      useOrtho: camera.useOrtho,
      currentView: camera.currentView,
      fovOverride: camera.fovOverride,
    };
  }

  function restoreCameraState(state) {
    if (!state) return;
    camera.useOrtho = state.useOrtho;
    camera.currentView = state.currentView;
    camera.pan = state.pan.slice();
    camera.panTarget = state.panTarget.slice();
    camera.rx = state.rx;
    camera.rxTarget = state.rxTarget;
    camera.ry = state.ry;
    camera.ryTarget = state.ryTarget;
    camera.dist = state.dist;
    camera.distTarget = state.distTarget;
    camera.moved = true;
    camera.fovOverride = state.fovOverride ?? null;
  }

  async function captureCanvasThumbnail(maxWidth = 384) {
    if (!canvas) return PLACEHOLDER_THUMB;
    if (!thumbnailCaptureCanvas) {
      thumbnailCaptureCanvas = document.createElement("canvas");
    }
    const aspect = canvas.width / Math.max(1, canvas.height);
    const targetW = maxWidth;
    const targetH = Math.round(targetW / aspect);
    thumbnailCaptureCanvas.width = targetW;
    thumbnailCaptureCanvas.height = targetH;
    const ctx = thumbnailCaptureCanvas.getContext("2d");
    if (!ctx) return PLACEHOLDER_THUMB;
    ctx.clearRect(0, 0, targetW, targetH);
    ctx.drawImage(canvas, 0, 0, targetW, targetH);

    if (typeof thumbnailCaptureCanvas.toBlob === "function") {
      return new Promise((resolve) => {
        thumbnailCaptureCanvas.toBlob(
          (blob) => {
            if (!blob) return resolve(PLACEHOLDER_THUMB);
            const reader = new FileReader();
            reader.onloadend = () => {
              resolve(reader.result || PLACEHOLDER_THUMB);
            };
            reader.onerror = () => resolve(PLACEHOLDER_THUMB);
            reader.readAsDataURL(blob);
          },
          "image/png",
          0.92
        );
      });
    }

    try {
      const data = thumbnailCaptureCanvas.toDataURL("image/png");
      return data || PLACEHOLDER_THUMB;
    } catch {
      return PLACEHOLDER_THUMB;
    }
  }

  async function preloadAllVariants() {
    const jobs = [];
    for (const parts of Object.values(variantGroups)) {
      for (const data of Object.values(parts)) {
        for (const variant of data.models || []) {
          if (!variant?.src) continue;
          if (cachedVariants[variant.src]) continue;

          jobs.push(async () => {
            try {
              const buf = await fetch(variant.src).then((r) => r.arrayBuffer());
              cachedVariants[variant.src] = buf;
              preparedVariants[variant.src] = await parseGLBToPrepared(buf, variant.src);
            } catch (err) {
              console.warn("[variants] Failed to preload variant:", variant.src, err);
            }
          });
        }
      }
    }

    if (!jobs.length) return;
    const CONCURRENCY = 3;
    let jobIndex = 0;
    const workers = Array.from({ length: Math.min(CONCURRENCY, jobs.length) }, async () => {
      while (jobIndex < jobs.length) {
        const current = jobIndex++;
        await jobs[current]();
      }
    });
    await Promise.all(workers);
  }

  async function generateThumbnailForVariant(
    partName,
    variant,
    baselineVariant,
    fallbackVariantName = "",
    colorName = null
  ) {
    const targetNodes = typeof getNodesMeta === "function" ? getNodesMeta() : nodesMeta;
    const node = targetNodes?.find((n) => n.name === partName);
    if (!node) return null;

    const previousFocusState = window.__suppressFocusCamera;
    window.__suppressFocusCamera = true;
    const cameraState = captureCameraState();
    const prevColorSelection = savedColorsByPart?.[partName]?.[variant.name];
    if (colorName) {
      savedColorsByPart[partName] = savedColorsByPart[partName] || {};
      savedColorsByPart[partName][variant.name] = colorName;
    }

    const applyVariant = async (targetVariant, label) => {
      await replaceSelectedWithURL(
        targetVariant?.src || null,
        label || targetVariant?.name || "Default",
        partName,
        { suppressLoading: true }
      );
      await waitForPendingTextures(6000);
    };

    const revertVariant = async () => {
      if (prevColorSelection !== undefined) {
        savedColorsByPart[partName] = savedColorsByPart[partName] || {};
        savedColorsByPart[partName][variant.name] = prevColorSelection;
      } else if (savedColorsByPart[partName]) {
        delete savedColorsByPart[partName][variant.name];
      }
      const target = baselineVariant || null;
      const label = target?.name || fallbackVariantName || variant?.name || partName;
      await applyVariant(target, label);
    };

    await applyVariant(variant, variant?.name || fallbackVariantName);

    const bounds = ensureNodeBounds(node);
    if (!bounds) {
      await revertVariant();
      restoreCameraState(cameraState);
      window.__suppressFocusCamera = previousFocusState;
      return null;
    }

    focusCameraOnNode(node);
    camera.pan = camera.panTarget.slice();
    camera.rx = camera.rxTarget;
    camera.ry = camera.ryTarget;
    camera.dist = camera.distTarget;
    camera.moved = true;
    recenterCameraForThumbnail(bounds);

    const camPresetIndex = getThumbnailCamPresetIndex(variant);
    if (Array.isArray(THUMBNAIL_CAM_PRESETS) && camPresetIndex !== null && THUMBNAIL_CAM_PRESETS[camPresetIndex]) {
      const preset = THUMBNAIL_CAM_PRESETS[camPresetIndex];
      const basePan = camera.panTarget.slice();
      const baseRx = camera.rxTarget;
      const baseRy = camera.ryTarget;
      const baseDist = camera.distTarget;

      if (preset.panOffset) {
        camera.pan = [
          basePan[0] + (preset.panOffset[0] || 0),
          basePan[1] + (preset.panOffset[1] || 0),
          basePan[2] + (preset.panOffset[2] || 0),
        ];
        camera.panTarget = camera.pan.slice();
      }
      if (typeof preset.rxOffset === "number") {
        camera.rx = baseRx + preset.rxOffset;
        camera.rxTarget = camera.rx;
      }
      if (typeof preset.ryOffset === "number") {
        camera.ry = baseRy + preset.ryOffset;
        camera.ryTarget = camera.ry;
      }
      if (typeof preset.distScale === "number") {
        camera.dist = baseDist * preset.distScale;
        camera.distTarget = camera.dist;
      }
      camera.moved = true;
    }

    markSceneChanged();
    render();
    await new Promise((resolve) => requestAnimationFrame(resolve));
    await new Promise((resolve) => requestAnimationFrame(resolve));
    if (gl && typeof gl.finish === "function") {
      gl.finish();
    }
    const dataUrl = await captureCanvasThumbnail();

    await revertVariant();

    restoreCameraState(cameraState);
    camera.moved = true;
    markSceneChanged();
    render();
    window.__suppressFocusCamera = previousFocusState;
    return dataUrl;
  }

  async function generateAllThumbnails() {
    const partsSnapshot = cloneState(currentParts || {});
    const colorsSnapshot = cloneState(savedColorsByPart || {});
    const cameraSnapshot = captureCameraState();

    const previousThumbnailFlag = window.__suppressThumbnailUI;
    const previousFocusState = window.__suppressFocusCamera;
    window.__suppressThumbnailUI = true;
    window.__suppressFocusCamera = true;
    hideCanvasForThumbnails();

    try {
      const missingNodeEntries = [];
      const placeholderEntries = [];
      const collectRenderableVariants = () => {
        const entries = [];
        const targetNodes = typeof getNodesMeta === "function" ? getNodesMeta() : nodesMeta;
        for (const parts of Object.values(variantGroups)) {
          for (const [partName, data] of Object.entries(parts)) {
            const shouldGenerateThumbs = data?.generateThumbs !== false;
            if (!shouldGenerateThumbs) {
              placeholderEntries.push({
                partName,
                variants: data.models || [],
              });
              continue;
            }
            const node = targetNodes?.find((n) => n.name === partName);
            if (!node) {
              if (data.models?.length) {
                missingNodeEntries.push({ partName, variants: data.models });
              }
              continue;
            }
            const models = data.models || [];
            if (!models.length) continue;
            const variants = [];
            models.forEach((variant, idx) => {
              if (!variant) return;
              if (idx === 0) {
                variants.push(variant);
              } else if (variant.src) {
                variants.push(variant);
              }
            });
            if (!variants.length) continue;
            const baseline = partsSnapshot?.[partName] || (variants.length ? variants[0] : null);
            const fallbackName = baseline?.name || models[0]?.name || partName;
            entries.push({ partName, node, variants, baseline, fallbackName });
          }
        }
        return entries;
      };

      const renderEntries = collectRenderableVariants();
      const totalCount = renderEntries.reduce(
        (sum, entry) =>
          sum +
          entry.variants.reduce((acc, v) => acc + colorsForVariant(v).length, 0),
        0
      );
      let doneCount = 0;

      for (const entry of renderEntries) {
        const { partName, variants, baseline, fallbackName } = entry;
        thumbnails[partName] = {};
        for (const variant of variants) {
          const colorNames = colorsForVariant(variant);
          for (const colorName of colorNames) {
            let thumb = await generateThumbnailForVariant(
              partName,
              variant,
              baseline,
              fallbackName,
              colorName
            );
            if (!thumb) {
              thumb = PLACEHOLDER_THUMB;
            }
            storeThumbnail(partName, variant.name, colorName, thumb);
            doneCount += 1;
            updateLoadingProgress(
              `Generating thumbnails (${doneCount}/${totalCount})`,
              window.pendingTextures || 0,
              window.pendingMeshes ? 1 : 0
            );
          }
        }
      }

      if (missingNodeEntries.length) {
        for (const entry of missingNodeEntries) {
          const { partName, variants } = entry;
          if (!variants?.length) continue;
          thumbnails[partName] = thumbnails[partName] || {};
          for (const variant of variants) {
            for (const colorName of colorsForVariant(variant)) {
              storeThumbnail(partName, variant.name, colorName, PLACEHOLDER_THUMB);
            }
          }
        }
      }

      if (placeholderEntries.length) {
        for (const entry of placeholderEntries) {
          const { partName, variants } = entry;
          if (!variants?.length) continue;
          thumbnails[partName] = thumbnails[partName] || {};
          for (const variant of variants) {
            for (const colorName of colorsForVariant(variant)) {
              storeThumbnail(partName, variant.name, colorName, PLACEHOLDER_THUMB);
            }
          }
        }
      }
    } finally {
      restoreObject(currentParts, partsSnapshot);
      restoreObject(savedColorsByPart, colorsSnapshot);
      window.savedColorsByPart = savedColorsByPart;
      restoreCameraState(cameraSnapshot);
      window.__suppressThumbnailUI = previousThumbnailFlag;
      window.__suppressFocusCamera = previousFocusState;
      markSceneChanged();
      render();
    }
  }

  function refreshThumbnailsInUI() {
    if (window.__suppressThumbnailUI) return;
    document.querySelectorAll(".variant-item").forEach((itemEl) => {
      const part = itemEl.dataset.part;
      const variant = itemEl.dataset.variant;
      const img = itemEl.querySelector("img.thumb");
      const savedColorName = savedColorsByPart?.[part]?.[variant] || null;
      const { variant: variantData } = findVariantData(part, variant);
      const defaultColor = variantData?.colors?.[0]?.name || null;
      const thumbUrl = getThumbnailForVariant(part, variant, savedColorName || defaultColor);
      img.src = thumbUrl || PLACEHOLDER_THUMB;
    });
  }

  async function waitForThumbnailsToSettle() {
    const imgs = Array.from(document.querySelectorAll(".variant-item img.thumb"));
    if (!imgs.length) return;

    const jobs = imgs.map(
      (img) =>
        new Promise((resolve) => {
          if (img.complete && img.naturalWidth) return resolve();
          const done = () => resolve();
          img.addEventListener("load", done, { once: true });
          img.addEventListener("error", done, { once: true });
        })
    );
    await Promise.all(jobs);
  }

  return {
    preloadAllVariants,
    generateAllThumbnails,
    refreshThumbnailsInUI,
    waitForThumbnailsToSettle,
    hideCanvasForThumbnails,
    restoreCanvasAfterThumbnails,
    captureCanvasThumbnail,
  };
}

export function getThumbnailForVariant(partName, variantName, colorName = null) {
  const entry = thumbnails?.[partName]?.[variantName];
  if (!entry) return null;
  if (typeof entry === "string") return entry;
  if (colorName && entry[colorName]) return entry[colorName];
  if (entry[THUMB_DEFAULT_COLOR_KEY]) return entry[THUMB_DEFAULT_COLOR_KEY];
  const first = Object.values(entry).find(Boolean);
  return first || null;
}
