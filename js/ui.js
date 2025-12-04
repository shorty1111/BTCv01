import { getThumbnailForVariant, PLACEHOLDER_THUMB } from "./thumbnails.js";

export function renderBoatInfo(infoObj) {
  const container = document.getElementById("boat-info");
  container.innerHTML = `
    <h3>Boat Info</h3>
    <table class="info-table">
      <tbody>
        ${Object.entries(infoObj)
          .map(([key, val]) => `<tr><td>${key}:</td><td>${val}</td></tr>`)
          .join("")}
      </tbody>
    </table>
  `;
}
export function showLoading() {
  const loadingScr = document.getElementById("loading-screen");
  if (!loadingScr) return;
  loadingScr.classList.remove("hidden");
  loadingScr.style.opacity = "1";
  updateLoadingProgress();
}
export function hideLoading() {
  const loadingScr = document.getElementById("loading-screen");
  if (!loadingScr) return;
  loadingScr.style.opacity = "0";
  loadingScr.style.pointerEvents = "none";
  const onEnd = () => {
    loadingScr.classList.add("hidden");
    loadingScr.removeEventListener("transitionend", onEnd);
  };
  loadingScr.addEventListener("transitionend", onEnd);
}

// Global cache boja/tekstura po varijantama (delimo sa main.js)
let savedColorsByPart = window.savedColorsByPart || {};
window.savedColorsByPart = savedColorsByPart;
// Dodatne (equipment-only) selekcije po delu – multi-select
let additionalSelections = window.additionalSelections || {};
window.additionalSelections = additionalSelections;

export function updateLoadingProgress(
  stage = "",
  pendingTextures = window.pendingTextures || 0,
  pendingMeshes = window.pendingMeshes ? 1 : 0
) {
  const loadingScr = document.getElementById("loading-screen");
  if (!loadingScr) return;
  const progressEl = loadingScr.querySelector(".progress");
  let labelEl = loadingScr.querySelector(".progress-label");
  if (!labelEl && progressEl) {
    // kreiraj labelu odmah posle progress bara da ne pišemo tekst u sam bar
    labelEl = document.createElement("div");
    labelEl.className = "progress-label";
    progressEl.insertAdjacentElement("afterend", labelEl);
  }
  if (progressEl) {
    const totalPending = pendingTextures + pendingMeshes;
    const pct =
      totalPending === 0
        ? 1
        : Math.max(0.05, Math.min(0.95, 1 - totalPending * 0.1));
    progressEl.style.setProperty("--progress-fill", `${Math.round(pct * 100)}%`);
    if (labelEl) {
      labelEl.textContent =
        stage ||
        `Loading${pendingMeshes ? " model" : ""}${
          pendingTextures ? ` + ${pendingTextures} textures` : ""
        }`;
    }
  }
}

export function showToast(message, type = "info", timeout = 4000) {
  let container = document.getElementById("toast-container");
  if (!container) {
    container = document.createElement("div");
    container.id = "toast-container";
    container.style.position = "fixed";
    container.style.top = "16px";
    container.style.right = "16px";
    container.style.zIndex = "9999";
    container.style.display = "flex";
    container.style.flexDirection = "column";
    container.style.gap = "8px";
    document.body.appendChild(container);
  }
  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.style.padding = "10px 14px";
  toast.style.borderRadius = "8px";
  toast.style.background =
    type === "error"
      ? "rgba(220, 60, 60, 0.9)"
      : type === "warn"
      ? "rgba(240, 170, 60, 0.9)"
      : "rgba(40, 40, 50, 0.9)";
  toast.style.color = "#fff";
  toast.style.boxShadow = "0 6px 20px rgba(0,0,0,0.25)";
  toast.style.backdropFilter = "blur(6px)";
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transition = "opacity 0.25s ease";
    toast.addEventListener("transitionend", () => {
      toast.remove();
      if (!container.children.length) container.remove();
    });
  }, timeout);
}
const hotspotButtons = new Map();
const partFirstItems = new Map();
const colorPanels = new Map();
const detailsPanels = new Map();
let hotspotLayer = null;
let hotspotLoopActive = false;
let showSelectedOnly = false;
let filterButtonSelected = null;
let filterButtonCollapseToggle = null;

function getPartConfig(partKey) {
  for (const parts of Object.values(VARIANT_GROUPS)) {
    if (parts[partKey]) return parts[partKey];
  }
  return null;
}

function findVariantByName(partKey, variantName) {
  const cfg = getPartConfig(partKey);
  if (!cfg?.models) return null;
  return cfg.models.find((m) => m.name === variantName) || null;
}

function isPartModified(partKey) {
  const cfg = getPartConfig(partKey);
  const def = cfg?.models?.[0];
  const current = currentParts[partKey];
  if (!def || !current) return false;
  return current.name !== def.name || !!current.selectedColor;
}

function applySelectedFilter() {
  const groups = document.querySelectorAll(".variant-group");
  groups.forEach((group) => {
    const header = group.querySelector("h3");
    const controls = group.querySelector(".variant-group-controls");
    const itemsDiv = group.querySelector(".variant-items");
    const parts = (group.dataset.parts || "").split(",").filter(Boolean);
    let groupHasVisible = false;
    parts.forEach((partKey) => {
      const cfg = getPartConfig(partKey);
      const modified = isPartModified(partKey);
      const items = Array.from(
        document.querySelectorAll(`.variant-item[data-part="${partKey}"]`)
      );
      items.forEach((item) => {
        if (showSelectedOnly) {
          const isSelectedItem = item.classList.contains("active");
          item.style.display = isSelectedItem ? "" : "none";
          if (isSelectedItem) groupHasVisible = true;
        } else {
          item.style.display = "";
          groupHasVisible = true;
        }
      });
      const resetBtn = group.querySelector(".reset-group-btn");
      if (resetBtn) {
        resetBtn.disabled = !modified;
        resetBtn.classList.toggle("disabled", !modified);
      }
    });
    if (showSelectedOnly) {
      group.classList.add("filter-only");
      group.classList.add("open");
      if (header) header.style.display = "none";
      if (controls) controls.style.display = "none";
      if (itemsDiv) {
        itemsDiv.style.maxHeight = "unset";
        itemsDiv.style.opacity = "1";
        itemsDiv.style.transform = "none";
        itemsDiv.style.padding = "12px";
      }
      group.style.display = groupHasVisible ? "" : "none";
    } else {
      group.classList.remove("filter-only");
      if (header) header.style.display = "";
      if (controls) controls.style.display = "";
      if (itemsDiv) {
        itemsDiv.style.maxHeight = "";
        itemsDiv.style.opacity = "";
        itemsDiv.style.transform = "";
        itemsDiv.style.padding = "";
      }
      group.style.display = groupHasVisible ? "" : "none";
    }
  });
}

function setFilterMode(mode) {
  if (mode === "toggle-selected") {
    showSelectedOnly = !showSelectedOnly;
  } else {
    showSelectedOnly = mode === "selected";
  }
  if (filterButtonSelected) {
    filterButtonSelected.classList.toggle("active", showSelectedOnly);
    filterButtonSelected.textContent = showSelectedOnly ? "Hide selected" : "Show selected";
  }
  if (filterButtonCollapseToggle) {
    filterButtonCollapseToggle.disabled = showSelectedOnly;
    filterButtonCollapseToggle.classList.toggle("disabled", showSelectedOnly);
  }
  if (!showSelectedOnly) {
    collapseAllGroups();
  }
  applySelectedFilter();
}

function collapseAllGroups() {
  document.querySelectorAll(".variant-group").forEach((group) => {
    group.classList.remove("open");
    const itemsDiv = group.querySelector(".variant-items");
    if (itemsDiv) {
      itemsDiv.style.maxHeight = "";
      itemsDiv.style.opacity = "";
      itemsDiv.style.transform = "";
      itemsDiv.style.padding = "";
    }
  });
}

function openAllGroups() {
  document.querySelectorAll(".variant-group").forEach((group) => {
    group.classList.add("open");
    const itemsDiv = group.querySelector(".variant-items");
    if (itemsDiv) {
      itemsDiv.style.maxHeight = "unset";
      itemsDiv.style.opacity = "1";
      itemsDiv.style.transform = "none";
      itemsDiv.style.padding = "12px";
    }
  });
}

function createDetailsPanel(partKey) {
  const panel = document.createElement("div");
  panel.className = "details-panel hidden";
  panel.dataset.part = partKey;

  const header = document.createElement("div");
  header.className = "details-header";
  header.innerHTML = `<span>Details</span><span class="chevron" aria-hidden="true"></span>`;
  const body = document.createElement("div");
  body.className = "details-body"; // prazno za sada

  header.addEventListener("click", () => {
    panel.classList.toggle("open");
  });

  panel.appendChild(header);
  panel.appendChild(body);
  return panel;
}

function toggleDetailsPanelVisibility(partKey, shouldShow) {
  const panel = detailsPanels.get(partKey);
  if (!panel) return;
  if (shouldShow) {
    panel.classList.remove("hidden");
    panel.classList.add("visible");
    panel.classList.add("open");
  } else {
    panel.classList.add("hidden");
    panel.classList.remove("visible");
    panel.classList.remove("open");
  }
}

function createColorPanel(partKey) {
  const panel = document.createElement("div");
  panel.className = "color-panel hidden";
  panel.dataset.part = partKey;
  const header = document.createElement("div");
  header.className = "color-panel-header";
  header.textContent = "Choose color";
  const grid = document.createElement("div");
  grid.className = "color-grid";
  panel.appendChild(header);
  panel.appendChild(grid);
  return panel;
}

function refreshColorSelectionUI(panel, selectedName) {
  if (!panel) return;
  panel.querySelectorAll(".color-swatch").forEach((el) => {
    el.classList.toggle("selected", el.dataset.colorName === selectedName);
  });
}

async function applyColorSelection(
  partKey,
  variant,
  color,
  panel,
  { force = false, fromUser = true } = {}
) {
  if (!variant || !color) return;
  const current = currentParts[partKey];
  if (!force && current?.name === variant.name && current?.selectedColor === color.name) {
    refreshColorSelectionUI(panel, color.name);
    toggleDetailsPanelVisibility(partKey, fromUser);
    return;
  }

  const node = nodesMeta.find((n) => n.name === partKey);
  if (!node) return;
  const cfgGroup = Object.values(VARIANT_GROUPS).find((g) => partKey in g) || {};
  const mainMat = cfgGroup[partKey]?.mainMat || "";
  const variantData = cfgGroup[partKey]?.models?.find((v) => v.name === variant.name) || variant;

  if (color.type === "texture" && color.texture) {
    const textureLoader = window.loadTextureWithCache;
    const loadMaybe = (src) =>
      !src
        ? Promise.resolve(null)
        : typeof textureLoader === "function"
        ? textureLoader(src)
        : new Promise((resolve) => {
            const img = new Image();
            img.src = src;
            img.onload = () => {
              const tex = gl.createTexture();
              gl.bindTexture(gl.TEXTURE_2D, tex);
              gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
              gl.generateMipmap(gl.TEXTURE_2D);
              gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
              gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
              gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
              gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
              resolve(tex);
            };
          });

    const [texBase, texNormal, texRough] = await Promise.all([
      loadMaybe(color.texture),
      loadMaybe(color.normal),
      loadMaybe(color.rough),
    ]);

    for (const r of node.renderIdxs) {
      const shouldApply = mainMat ? r.matName === mainMat : r === node.renderIdxs[0];
      if (!shouldApply) continue;
      modelBaseTextures[r.idx] = texBase;
      if (originalParts[r.idx]) {
        originalParts[r.idx].baseColorTex = texBase;
        if (texNormal) originalParts[r.idx].normalTex = texNormal;
        if (texRough) originalParts[r.idx].roughnessTex = texRough;
      }
    }
  } else if (color.type === "color" && color.color) {
    for (const r of node.renderIdxs) {
      const isTargetMat = mainMat ? r.matName === mainMat : r === node.renderIdxs[0];
      if (!isTargetMat) continue;
      modelBaseColors[r.idx] = new Float32Array(color.color);
      modelBaseTextures[r.idx] = null;
      if (originalParts[r.idx]) {
        originalParts[r.idx].normalTex = null;
        originalParts[r.idx].roughnessTex = null;
      }
    }
  }

  currentParts[partKey] = { ...variantData, selectedColor: color.name };
  if (!savedColorsByPart[partKey]) savedColorsByPart[partKey] = {};
  savedColorsByPart[partKey][variantData.name] = color.name;
  updatePartsTable(partKey, variantData.name);
  const row = document.querySelector(`#partsTable tr[data-part="${partKey}"] td:nth-child(2)`);
  if (row) row.textContent = `${variantData.name} (${color.name})`;
  if (typeof window.reapplyVariantCameraPreset === "function") {
    window.reapplyVariantCameraPreset(partKey, variantData.name);
  }
  refreshColorSelectionUI(panel, color.name);
  const thumbUrl = getThumbnailForVariant(partKey, variantData.name, color.name);
  const cardThumb = document.querySelector(
    `.variant-item[data-part="${partKey}"][data-variant="${variantData.name}"] img.thumb`
  );
  if (cardThumb) {
    cardThumb.src = thumbUrl || PLACEHOLDER_THUMB;
  }
  sceneChanged = true;
  render();
  showPartInfo(`${variantData.name} (${color.name})`);
  if (fromUser) {
    toggleDetailsPanelVisibility(partKey, true);
    const detailPanel = detailsPanels.get(partKey);
    if (detailPanel && typeof detailPanel.scrollIntoView === "function") {
      detailPanel.scrollIntoView({ behavior: "smooth", block: "start", inline: "nearest" });
    }
  } else {
    toggleDetailsPanelVisibility(partKey, false);
  }
  applySelectedFilter();
}

function renderColorPanel(partKey, variant, { autoScroll = false } = {}) {
  const panel = colorPanels.get(partKey);
  if (!panel) return;
  const grid = panel.querySelector(".color-grid");
  grid.innerHTML = "";

  const colors = variant?.colors || [];
  if (!colors.length) {
    panel.classList.add("hidden");
    toggleDetailsPanelVisibility(partKey, false);
    return;
  }

  panel.classList.remove("hidden");
  panel.classList.add("visible");
  const savedColorName =
    currentParts[partKey]?.selectedColor ||
    savedColorsByPart[partKey]?.[variant.name] ||
    null;
  const initialColorName = savedColorName || colors[0]?.name || null;

  colors.forEach((c) => {
    const swatch = document.createElement("button");
    swatch.type = "button";
    swatch.className = "color-swatch";
    swatch.dataset.colorName = c.name;
    if (c.type === "texture" && c.texture) {
      swatch.classList.add("texture");
      swatch.style.backgroundImage = `url(${c.texture})`;
      swatch.style.backgroundSize = "1000% 1000%";
      swatch.style.backgroundPosition = "center";
    } else if (c.type === "color" && c.color) {
      swatch.style.backgroundColor = `rgb(${c.color.map((v) => v * 255).join(",")})`;
    }
    swatch.title = c.name;
    const label = document.createElement("span");
    label.className = "swatch-label";
    label.textContent = c.name || "";
    swatch.appendChild(label);
    swatch.addEventListener("click", (e) => {
      e.stopPropagation();
      void applyColorSelection(partKey, variant, c, panel, { force: false, fromUser: true });
    });
    grid.appendChild(swatch);
  });

  refreshColorSelectionUI(panel, initialColorName);
  if (autoScroll) {
    panel.scrollIntoView({ behavior: "smooth", block: "start", inline: "nearest" });
  }
  if (initialColorName) {
    const initialColor =
      colors.find((c) => c.name === initialColorName) || colors[0];
    if (initialColor) {
      void applyColorSelection(partKey, variant, initialColor, panel, {
        force: false,
        fromUser: false,
      });
    }
  } else {
    toggleDetailsPanelVisibility(partKey, false);
  }
}

function resetGroupToDefaults(parts) {
  if (!parts) return;
  for (const [partKey, data] of Object.entries(parts)) {
    const def = data?.models?.[0];
    if (!def) continue;
    const card = document.querySelector(
      `.variant-item[data-part="${partKey}"][data-variant="${def.name}"]`
    );
    if (card) {
      card.click();
    }
  }
  applySelectedFilter();
}

function ensureHotspotLayer() {
  if (!hotspotLayer) {
    hotspotLayer = document.getElementById("variantHotspotLayer");
  }
  return hotspotLayer;
}

function registerPartHotspot(partKey, data, groupName, groupDiv) {
  const layer = ensureHotspotLayer();
  if (!layer || hotspotButtons.has(partKey)) return;
  const btn = document.createElement("button");
  btn.className = "variant-hotspot";
  btn.dataset.part = partKey;
  btn.textContent = data.hotspotLabel || data.label || groupName || partKey;
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    focusHotspotPart(partKey, groupDiv);
  });
  layer.appendChild(btn);
  hotspotButtons.set(partKey, { button: btn, group: groupDiv, groupName });
}

function focusHotspotPart(partKey, groupDiv) {
  const entry = hotspotButtons.get(partKey);
  if (!entry) return;
  if (entry.groupName) {
    const tabBtn = document.querySelector(`.variant-tab[data-group="${entry.groupName}"]`);
    tabBtn?.click();
  }
  document.querySelectorAll(".variant-group").forEach((g) => {
    if (g !== groupDiv) {
      if (g.classList.contains("open")) revealGroupHotspots(g);
      g.classList.remove("open");
    }
  });
  groupDiv.classList.add("open");
  const firstItem = partFirstItems.get(partKey);
  if (firstItem) {
    firstItem.scrollIntoView({ behavior: "smooth", block: "center" });
    firstItem.classList.add("active");
    firstItem.style.borderColor = "var(--primary)";
    firstItem.style.boxShadow = "0 0 0 2px rgba(56, 189, 248, 0.7)";
  }
  const node = nodesMeta.find((n) => n.name === partKey);
  if (node) {
    focusCameraOnNode(node);
    render();
  }
  entry.button.classList.add("hidden");
}

function hideHotspot(partKey) {
  const entry = hotspotButtons.get(partKey);
  if (entry) entry.button.classList.add("hidden");
}

function showHotspot(partKey) {
  const entry = hotspotButtons.get(partKey);
  if (entry) {
    entry.button.classList.remove("hidden");
    positionHotspot(partKey);
  }
}

function revealGroupHotspots(groupEl) {
  if (!groupEl?.dataset?.parts) return;
  groupEl.dataset.parts
    .split(",")
    .filter(Boolean)
    .forEach((part) => showHotspot(part));
}

function startHotspotLoop() {
  if (hotspotLoopActive) return;
  hotspotLoopActive = true;
  const step = () => {
    updateHotspotPositions();
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function positionHotspot(partKey) {
  const projector = window.getPartScreenPosition;
  if (typeof projector !== "function") return;
  const entry = hotspotButtons.get(partKey);
  if (!entry) return;
  const { button } = entry;
  const pos = projector(partKey);
  if (!pos) {
    button.classList.add("offscreen");
    return;
  }
  button.classList.remove("offscreen");
  button.style.left = `${pos.x}px`;
  button.style.top = `${pos.y}px`;
}

function updateHotspotPositions() {
  hotspotButtons.forEach((_value, partKey) => positionHotspot(partKey));
}
window.updateHotspotPositions = updateHotspotPositions;

function buildVariantSidebar() {
  const sidebar = document.getElementById("variantSidebar");
  sidebar.innerHTML = "";
  partFirstItems.clear();
  hotspotButtons.clear();
  colorPanels.clear();
  detailsPanels.clear();
  const layer = ensureHotspotLayer();
  if (layer) layer.innerHTML = "";

  const intro = document.createElement("div");
  intro.className = "variant-intro";
  intro.innerHTML = `
    <h2>Customize Your Boat</h2>
    <p>Select materials, colors, and parts to create a configuration that matches your vision.</p>
  `;

  const tabsBar = document.createElement("div");
  tabsBar.className = "variant-tabs";

  const tabsButtons = document.createElement("div");
  tabsButtons.className = "variant-tabs-buttons";
  tabsBar.appendChild(tabsButtons);

  const tabsContent = document.createElement("div");
  tabsContent.className = "variant-tabs-content";

  const groupNodes = new Map();
  let activeGroup = null;

  const placeholderMsg = document.createElement("div");
  placeholderMsg.className = "variant-placeholder";
  placeholderMsg.textContent =
    "Tap a category to pick an option and start configuring your boat.";
  const activeTitle = document.createElement("h3");
  activeTitle.className = "variant-active-title hidden";

  const setActiveGroup = (name) => {
    activeGroup = name;
    tabsButtons.querySelectorAll(".variant-tab").forEach((btn) => {
      const isActive = btn.dataset.group === name;
      btn.classList.toggle("active", isActive);
    });
    tabsContent.querySelectorAll(".variant-group").forEach((grp) => {
      const isActive = grp.dataset.group === name;
      grp.classList.toggle("active", isActive);
      grp.classList.toggle("open", isActive);
      grp.style.display = isActive ? "block" : "none";
      if (isActive) {
        const cards = grp.querySelectorAll(".variant-item");
        cards.forEach((card, idx) => {
          card.style.animation = "none";
          // force reflow to restart animation
          // eslint-disable-next-line no-unused-expressions
          card.offsetHeight;
          card.style.animation = `cardIn 0.65s cubic-bezier(0.25, 0.8, 0.25, 1) ${idx * 80}ms forwards`;
        });
      } else {
        grp.querySelectorAll(".variant-item").forEach((card) => {
          card.style.animation = "";
        });
      }
    });
    const activeGroupEl = tabsContent.querySelector(`.variant-group[data-group="${name}"]`);
    if (activeGroupEl) {
      const firstCard = activeGroupEl.querySelector(".variant-item");
      const targetCard = firstCard;

      if (targetCard) {
        setTimeout(() => {
          targetCard.click();
        }, 0);
      }
    }
    // vrati hotspot/label za sve grupe koje nisu aktivne
    document.querySelectorAll(".variant-group").forEach((g) => {
      if (g.dataset.group !== name) revealGroupHotspots(g);
    });
    if (name) {
      activeTitle.textContent = name;
      activeTitle.classList.remove("hidden");
      placeholderMsg.classList.add("hidden");
    }
    applySelectedFilter();
  };

  sidebar.appendChild(intro);
  const tabsWrapper = document.createElement("div");
  tabsWrapper.className = "variant-tabs-wrapper";
  tabsWrapper.appendChild(tabsBar);
  sidebar.appendChild(tabsWrapper);
  const scrollArea = document.createElement("div");
  scrollArea.className = "variant-scroll-area";
  scrollArea.appendChild(placeholderMsg);
  scrollArea.appendChild(activeTitle);
  scrollArea.appendChild(tabsContent);
  sidebar.appendChild(scrollArea);

  for (const [groupName, parts] of Object.entries(VARIANT_GROUPS)) {
    const tabBtn = document.createElement("button");
    tabBtn.type = "button";
    tabBtn.className = "variant-tab";
    tabBtn.textContent = groupName;
    tabBtn.dataset.group = groupName;
    tabBtn.addEventListener("click", () => setActiveGroup(groupName));
    tabsButtons.appendChild(tabBtn);

    const groupDiv = document.createElement("div");
    groupDiv.className = "variant-group";
    groupDiv.dataset.group = groupName;
    const itemsDiv = document.createElement("div");
    itemsDiv.className = "variant-items";
    const groupPartKeys = [];

    for (const [partKey, data] of Object.entries(parts)) {
      groupPartKeys.push(partKey);
      registerPartHotspot(partKey, data, groupName, groupDiv);
      const variants = data.models;
      const isCompactCard = data.generateThumbs === false;

      const partSection = document.createElement("div");
      partSection.className = "variant-part";
      partSection.dataset.part = partKey;

      const cardsContainer = document.createElement("div");
      cardsContainer.className = "variant-card-list";
      partSection.appendChild(cardsContainer);

      variants.forEach((variant) => {
        const itemEl = document.createElement("div");
        itemEl.className = "variant-item";
        if (isCompactCard) itemEl.classList.add("compact");
        itemEl.dataset.part = partKey;
        itemEl.dataset.variant = variant.name;

        let thumbWrapper = null;
        if (!isCompactCard) {
          thumbWrapper = document.createElement("div");
          thumbWrapper.className = "thumb-wrapper";

          const preview = document.createElement("img");
          const previewInfo = getVariantPreviewSrc(partKey, variant);
          preview.src = previewInfo.src;
          if (previewInfo.isPlaceholder) {
            preview.dataset.thumbKind = "placeholder";
          } else {
            delete preview.dataset.thumbKind;
          }
          preview.className = "thumb";
          thumbWrapper.appendChild(preview);
        }

        const body = document.createElement("div");
        body.className = "variant-body";
        const label = document.createElement("div");
        label.className = "title";
        label.textContent = variant.name;
        body.appendChild(label);

        if (variant.description) {
          const desc = document.createElement("div");
          desc.className = "variant-description inline";
          desc.textContent = variant.description;
          body.appendChild(desc);
        }

        const footer = document.createElement("div");
        footer.className = "variant-footer";
        const rawPrice = variant.price ?? 0;
        const priceText =
          rawPrice === 0 ? "Included (incl. VAT)" : `+${rawPrice} € (incl. VAT)`;
        footer.innerHTML = `<span class="price">${priceText}</span>`;
        body.appendChild(footer);

        if (thumbWrapper) itemEl.appendChild(thumbWrapper);
        itemEl.appendChild(body);
        if (!partFirstItems.has(partKey)) {
          partFirstItems.set(partKey, itemEl);
        }

        const handleItemClick = () => {
          hideHotspot(partKey);
          const isEquipmentOnly = !variant.src && !data.mainMat;
          if (isEquipmentOnly) {
            const rawPrice = variant.price ?? 0;
            // "Included" paket je već pokriven u glavnoj tabeli – ne dupliraj ga kao additional
            if (rawPrice === 0) {
              return;
            }
            // Multi-select dodatne stavke: toggluj varijantu u listi za ovaj deo
            const list = additionalSelections[partKey] || [];
            const idx = list.indexOf(variant.name);
            const isActive = idx !== -1;
            if (isActive) {
              list.splice(idx, 1);
              itemEl.classList.remove("active");
              itemEl.style.borderColor = "";
              itemEl.style.boxShadow = "";
            } else {
              list.push(variant.name);
              itemEl.classList.add("active");
              itemEl.style.borderColor = "var(--primary)";
              itemEl.style.boxShadow = "0 0 0 2px rgba(56, 189, 248, 0.7)";
            }
            additionalSelections[partKey] = list;
            buildPartsTable();
            updateTotalPrice();
            applySelectedFilter();
            return;
          }

          const node = nodesMeta.find((n) => n.name === partKey);
          if (!node) return;

          highlightTreeSelection(node.id);
          const prev = currentParts[partKey];
          if (prev && prev.selectedColor) {
            if (!savedColorsByPart[partKey]) savedColorsByPart[partKey] = {};
            savedColorsByPart[partKey][prev.name] = prev.selectedColor;
          }
          replaceSelectedWithURL(variant.src, variant.name, partKey);

          updatePartsTable(partKey, variant.name);
          currentParts[partKey] = variant;
          itemsDiv.querySelectorAll(`.variant-item[data-part="${partKey}"]`).forEach((el) => {
            el.classList.remove("active");
            el.style.borderColor = "";
            el.style.boxShadow = "";
          });
          itemEl.classList.add("active");
          itemEl.style.borderColor = "var(--primary)";
          itemEl.style.boxShadow = "0 0 0 2px rgba(56, 189, 248, 0.7)";
          showPartInfo(variant.name);
          renderColorPanel(partKey, variant, { autoScroll: true });
          applySelectedFilter();
        };

        itemEl.addEventListener("click", handleItemClick);

        cardsContainer.appendChild(itemEl);

        const selectedName = currentParts[partKey]?.name || variants[0]?.name;
        const selectedExtras = additionalSelections[partKey] || [];
        if (variant.name === selectedName || selectedExtras.includes(variant.name)) {
          itemEl.classList.add("active");
          itemEl.style.borderColor = "var(--primary)";
          itemEl.style.boxShadow = "0 0 0 2px rgba(56, 189, 248, 0.7)";
        }
      });

      const colorPanel = createColorPanel(partKey);
      colorPanels.set(partKey, colorPanel);
      partSection.appendChild(colorPanel);

      const detailPanel = createDetailsPanel(partKey);
      detailsPanels.set(partKey, detailPanel);
      partSection.appendChild(detailPanel);

      itemsDiv.appendChild(partSection);

      const currentVariant = currentParts[partKey] || variants[0];
      if (currentVariant) {
        renderColorPanel(partKey, currentVariant);
        if (currentVariant.selectedColor) {
          toggleDetailsPanelVisibility(partKey, true);
        }
      }
    }

    groupDiv.appendChild(itemsDiv);
    groupDiv.dataset.parts = groupPartKeys.join(",");
    tabsContent.appendChild(groupDiv);
    groupNodes.set(groupName, groupDiv);
  }

  const first = Object.keys(VARIANT_GROUPS)[0];
  // ne selektuj automatski nijednu grupu; cekaj klik
  startHotspotLoop();
  applySelectedFilter();
}
function buildPartsTable() {
  const tbody = document.querySelector("#partsTable tbody");
  tbody.innerHTML = "";

  // standardni delovi iz VARIANT_GROUPS
  for (const [groupName, parts] of Object.entries(VARIANT_GROUPS)) {
    for (const [partKey, data] of Object.entries(parts)) {
      const defaultVariant = data.models?.[0];
      if (!defaultVariant) continue;

      const chosen = currentParts[partKey] ?? defaultVariant;
      const chosenName =
        chosen.selectedColor ? `${chosen.name} (${chosen.selectedColor})` : chosen.name;
      const price = chosen.price ?? 0;

      const tr = document.createElement("tr");
      tr.dataset.part = partKey;
      tr.innerHTML = `
        <td>${groupName}</td>
        <td>${chosenName}</td>
        <td>${price === 0 ? "Included" : `+${price} €`}</td>
      `;
      tbody.appendChild(tr);
    }
  }
    // dodatne multi-select stavke
  for (const [partKey, selectedNames] of Object.entries(additionalSelections)) {
    if (!Array.isArray(selectedNames)) continue;
    selectedNames.forEach((name) => {
      const variant = findVariantByName(partKey, name);
      if (!variant) return;
      const tr = document.createElement("tr");
      tr.dataset.part = `${partKey}:${name}`;
      const price = variant.price ?? 0;
      tr.innerHTML = `
        <td>Additional</td>
        <td>${variant.name}</td>
        <td>${price === 0 ? "Included" : `+${price} €`}</td>
      `;
      tbody.appendChild(tr);
    });
  }

}
function updatePartsTable(partKey, newVariantName) {
  let variant = null;
  let groupName = null;

  // pronađi varijantu i grupu
  for (const [gName, parts] of Object.entries(VARIANT_GROUPS)) {
    for (const [key, data] of Object.entries(parts)) {
      const found = data.models.find((m) => m.name === newVariantName);
      if (found) {
        variant = found;
        groupName = gName;
        break;
      }
    }
    if (variant) break;
  }

  if (!variant) return;

  const price = variant.price ?? 0;
  const tbody = document.querySelector("#partsTable tbody");
  const rowKey = partKey;

  // proveri da li već postoji red za taj deo
  let row = document.querySelector(`#partsTable tr[data-part="${rowKey}"]`);

  // ako ne postoji — napravi novi
  if (!row) {
    row = document.createElement("tr");
    row.dataset.part = partKey;
    tbody.appendChild(row);
  }

  // ako je included i već postoji — samo ažuriraj, ne dodaj novi
  if (price === 0 && row) {
    row.innerHTML = `
      <td>${groupName}</td>
      <td>${variant.name}</td>
      <td>Included</td>
    `;
  } else {
    // u svim ostalim slučajevima (plaćene varijante) — zameni sadržaj
    row.innerHTML = `
      <td>${groupName}</td>
      <td>${variant.name}</td>
      <td>+${price} €</td>
    `;
  }

  currentParts[rowKey] = variant;
  updateTotalPrice();
}
function updateTotalPrice() {
  let total = BASE_PRICE;

  for (const variant of Object.values(currentParts)) {
    if (variant && variant.price) total += variant.price;
  }
  // dodatne multi-select stavke
  for (const [partKey, selectedNames] of Object.entries(additionalSelections)) {
    if (!Array.isArray(selectedNames)) continue;
    selectedNames.forEach((name) => {
      const variant = findVariantByName(partKey, name);
      if (variant && variant.price) total += variant.price;
    });
  }

  // ažuriraj total u tabeli i sidebaru
  let totalRow = document.querySelector("#partsTable tfoot tr");
  if (!totalRow) {
    const tfoot = document.createElement("tfoot");
    totalRow = document.createElement("tr");
    document.querySelector("#partsTable").appendChild(tfoot);
    tfoot.appendChild(totalRow);
  }

  totalRow.innerHTML = `
<td colspan="2" style="text-align:right; font-weight:700;">Total:</td>
<td style="font-size:16px; font-weight:700; color:#3aa4ff;">
  ${total.toLocaleString("de-DE")} € (incl. VAT)
</td>
  `;

  const sidebarPrice = document.querySelector(".sidebar-total .price");
  if (sidebarPrice)
    sidebarPrice.textContent = `${total.toLocaleString("de-DE")} € (incl. VAT)`;

}
function highlightTreeSelection(id) {
  document
    .querySelectorAll("#nodeTree li")
    .forEach((li) => li.classList.toggle("selected", +li.dataset.id === id));
}
function showPartInfo(name) {
  const partInfo = document.getElementById("part-info");
  if (partInfo) {
    partInfo.textContent = `Izabran deo: ${name}`;
  }
}
function initDropdown() {
  const exportPDF = window.exportPDF;
  const toggleBtn = document.querySelector(".dropdown-toggle");
  const dropdown = document.querySelector(".dropdown-menu");
  const closeDropdown = () => dropdown?.classList.add("hidden");

  if (toggleBtn && dropdown) {
    // Otvaranje / zatvaranje
    toggleBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      dropdown.classList.toggle("hidden");
    });

    // Klik van menija → zatvori
    document.addEventListener("click", (e) => {
      if (!dropdown.contains(e.target) && !toggleBtn.contains(e.target)) {
        dropdown.classList.add("hidden");
      }
    });
  }

  // Klik na "Pročitaj opis" otvara/zatvara karticu
  document.addEventListener("click", (e) => {
    const btn = e.target.closest(".desc-toggle");
    if (!btn) return;
    const card = btn.closest(".variant-item");
    if (card) card.classList.toggle("open");
  });

  // Export PDF
  const exportBtn = document.getElementById("exportPDF");
  if (exportBtn && typeof exportPDF === "function") {
    exportBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      closeDropdown();
      exportPDF();
    });
  }

  const copyBtn = document.getElementById("copyConfig");
  const copyLink = async (btnRef) => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      if (btnRef) {
        const original = btnRef.textContent;
        btnRef.textContent = "Copied!";
        setTimeout(() => (btnRef.textContent = original), 1200);
      }
    } catch (err) {
      console.warn("Copy to clipboard failed:", err);
    }
  };

  if (copyBtn) {
    copyBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      closeDropdown();
      copyLink(copyBtn);
    });
  }

  // Share konfiguracija
  const shareBtn = document.getElementById("shareConfig");
  if (shareBtn) {
    shareBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      closeDropdown();
      const shareData = { title: document.title, url: window.location.href };
      if (navigator.share) {
        try {
          await navigator.share(shareData);
          return;
        } catch (err) {
          if (err?.name === "AbortError") return;
          console.warn("Native share failed, falling back to copy.", err);
        }
      }
      await copyLink(copyBtn || shareBtn);
    });
  }
}
let saveButtonInitialized = false;

function initSavedConfigs() {
  const container = document.getElementById("savedConfigsContainer");
  const saveBtn = document.getElementById("saveConfigBtn");
  const dropdown = document.querySelector(".dropdown-menu");

  // --- helper za čitanje/validaciju localStorage ---
  function loadAll() {
    try {
      const data = JSON.parse(localStorage.getItem("boatConfigs") || "[]");
      return Array.isArray(data) ? data : [];
    } catch {
      return [];
    }
  }

function renderSavedConfigs() {
  const all = loadAll();
  container.innerHTML = "";

  if (all.length === 0) {
    container.innerHTML = `<div class="empty">No saved configs.</div>`;
    return;
  }

  all.forEach((cfg, i) => {
    const row = document.createElement("div");
    row.className = "saved-item";
    row.innerHTML = `
      <button class="saved-item-btn" data-index="${i}">
        ${cfg.name}
        <span class="del-btn" data-index="${i}" aria-label="Delete">&times;</span>
      </button>
    `;
    container.appendChild(row);
  });

// klik na stavku -> load
container.querySelectorAll(".saved-item-btn").forEach(btn => {
  btn.addEventListener("click", async (e) => {
    if (e.target.classList.contains("del-btn")) return;
    const i = parseInt(e.currentTarget.dataset.index);
    if (isNaN(i)) return;
    await loadSavedConfig(i);
  });
});

// klik na X -> delete
container.querySelectorAll(".del-btn").forEach(btn => {
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    const i = parseInt(e.currentTarget.dataset.index);
    if (isNaN(i)) return;
    const all = loadAll();
    all.splice(i, 1);
    localStorage.setItem("boatConfigs", JSON.stringify(all));
    renderSavedConfigs();
  });
});

}



// pomoćna funkcija za duboko kloniranje objekata koje čuvamo u localStorage-u
function deepClone(value) {
  if (value == null || typeof value !== "object") return value;
  if (typeof structuredClone === "function") {
    try {
      return structuredClone(value);
    } catch (err) {
      // fallback ispod
    }
  }
  return JSON.parse(JSON.stringify(value));
}

// sada bez prompt-a — koristi modal iz HTML-a
function saveToLocal(name) {
  const all = loadAll();
  const data = {
    name,
    timestamp: Date.now(),
    currentParts: deepClone(currentParts),
    savedColorsByPart: deepClone(savedColorsByPart),
    weather: SUN.dir[1] > 0.5 ? "day" : "sunset",
    camera: {
      pan: camera.pan,
      dist: camera.distTarget,
      rx: camera.rxTarget,
      ry: camera.ryTarget,
    },
  };
  all.push(data);
  localStorage.setItem("boatConfigs", JSON.stringify(all));
  renderSavedConfigs();
}

// --- otvaranje i upravljanje modalom ---
const modal = document.getElementById("saveConfigModal");
const nameInput = document.getElementById("configNameInput");
const confirmBtn = document.getElementById("confirmSave");
const cancelBtn = document.getElementById("cancelSave");

if (saveBtn && !saveButtonInitialized) {
  saveButtonInitialized = true;
  saveBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (dropdown) dropdown.classList.add("hidden");
    if (nameInput) {
      nameInput.value = "";
      nameInput.focus();
    }
    if (modal) modal.classList.remove("hidden");
  });
}

// potvrdi snimanje
confirmBtn.addEventListener("click", () => {
  const name = nameInput.value.trim() || `Config ${new Date().toLocaleString()}`;
  saveToLocal(name);
  modal.classList.add("hidden");
  if (typeof window.setMobileTab === "function") window.setMobileTab("info");
});

// otkaži
cancelBtn.addEventListener("click", () => {
  modal.classList.add("hidden");
  if (typeof window.setMobileTab === "function") window.setMobileTab("info");
});


async function loadSavedConfig(index) {
  const all = JSON.parse(localStorage.getItem("boatConfigs") || "[]");
  const cfg = all[index];
  if (!cfg) return alert("Config not found.");
  window.__suppressFocusCamera = true;
  const loadedParts = deepClone(cfg.currentParts || {});
  const loadedColors = deepClone(cfg.savedColorsByPart || {});

  if (!window.currentParts) window.currentParts = {};
  if (!window.savedColorsByPart) window.savedColorsByPart = {};

  const partsTarget = window.currentParts;
  const colorsTarget = window.savedColorsByPart;
  const currentPartsRef = partsTarget;

  for (const key of Object.keys(partsTarget)) delete partsTarget[key];
  for (const key of Object.keys(colorsTarget)) delete colorsTarget[key];

  Object.assign(partsTarget, loadedParts);
  Object.assign(colorsTarget, loadedColors);

  currentParts = partsTarget;
  savedColorsByPart = colorsTarget;
  setWeather(cfg.weather || "day");
  // reset UI selekcija
  document.querySelectorAll(".variant-item").forEach(el => {
    el.classList.remove("active");
    el.style.borderColor = "";
    el.style.boxShadow = "";
  });
  document.querySelectorAll(".color-swatch").forEach(el => el.classList.remove("selected"));
  // 1️⃣ Učitaj standardne delove
  for (const [part, variant] of Object.entries(currentPartsRef)) {
    const node = nodesMeta.find(n => n.name === part);
if (variant.src) {
  await replaceSelectedWithURL(variant.src, variant.name, part);
}

// sada sigurni da je model već zamenjen → tek sad primeni boju
if (variant.selectedColor) {
  const group = Object.values(VARIANT_GROUPS).find(g => part in g);
  const mainMat = group?.[part]?.mainMat || "";
  const colorData = group?.[part]?.models
    ?.find(m => m.name === variant.name)
    ?.colors?.find(c => c.name === variant.selectedColor);

  if (colorData) {
    if (colorData.type === "color") {
      const node = nodesMeta.find(n => n.name === part);
      if (node) {
        for (const r of node.renderIdxs) {
          if (mainMat && r.matName === mainMat) {
            modelBaseColors[r.idx] = new Float32Array(colorData.color);
            modelBaseTextures[r.idx] = null;
          } else if (!mainMat && r === node.renderIdxs[0]) {
            modelBaseColors[r.idx] = new Float32Array(colorData.color);
            modelBaseTextures[r.idx] = null;
          }
        }
      }
    } else if (colorData.type === "texture" && colorData.texture) {
      const textureLoader = window.loadTextureWithCache;
      const node = nodesMeta.find(n => n.name === part);
      if (!node) continue;

      if (typeof textureLoader === "function") {
        const loadMaybe = (src) => (src ? textureLoader(src) : Promise.resolve(null));
        const [texBase, texNormal, texRough] = await Promise.all([
          loadMaybe(colorData.texture),
          loadMaybe(colorData.normal),
          loadMaybe(colorData.rough),
        ]);

        for (const r of node.renderIdxs) {
          const shouldApply = mainMat ? r.matName === mainMat : r === node.renderIdxs[0];
          if (!shouldApply) continue;
          modelBaseTextures[r.idx] = texBase;
          if (originalParts?.[r.idx]) {
            originalParts[r.idx].baseColorTex = texBase;
            if (texNormal) originalParts[r.idx].normalTex = texNormal;
            if (texRough) originalParts[r.idx].roughnessTex = texRough;
          }
        }
      } else {
        const loadImageTexture = (src) =>
          !src
            ? Promise.resolve(null)
            : new Promise((res) => {
                const img = new Image();
                img.onload = () => res(img);
                img.src = src;
              });

        const [imgBase, imgNormal, imgRough] = await Promise.all([
          loadImageTexture(colorData.texture),
          loadImageTexture(colorData.normal),
          loadImageTexture(colorData.rough),
        ]);

        const uploadImageTexture = (img) => {
          if (!img) return null;
          const tex = gl.createTexture();
          gl.bindTexture(gl.TEXTURE_2D, tex);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
          gl.generateMipmap(gl.TEXTURE_2D);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
          return tex;
        };

        const texBase = uploadImageTexture(imgBase);
        const texNormal = uploadImageTexture(imgNormal);
        const texRough = uploadImageTexture(imgRough);

        for (const r of node.renderIdxs) {
          const shouldApply = mainMat ? r.matName === mainMat : r === node.renderIdxs[0];
          if (!shouldApply) continue;
          modelBaseTextures[r.idx] = texBase;
          if (originalParts?.[r.idx]) {
            originalParts[r.idx].baseColorTex = texBase;
            if (texNormal) originalParts[r.idx].normalTex = texNormal;
            if (texRough) originalParts[r.idx].roughnessTex = texRough;
          }
        }
      }
    }

  }
}


    // selektuj u UI
    const item = document.querySelector(`.variant-item[data-part="${part}"][data-variant="${variant.name}"]`);
      if (item) {
        item.classList.add("active");
        item.style.borderColor = "var(--primary)";
        item.style.boxShadow = "0 0 0 2px rgba(56, 189, 248, 0.7)";
      const colors = item.querySelectorAll(".color-swatch");
      colors.forEach(sw => {
        if (sw.title === variant.selectedColor) sw.classList.add("selected");
      });
    }

    // info panel update
    showPartInfo(`${variant.name}${variant.selectedColor ? ` (${variant.selectedColor})` : ""}`);
  }

  // 2️⃣ Aktiviraj ADDITIONAL (nema src, samo cena)
  for (const [part, variant] of Object.entries(currentPartsRef)) {
    if (!variant.src) {
      // označi u UI
      const addItem = document.querySelector(`.variant-item[data-variant="${variant.name}"]`);
      if (addItem) {
        addItem.classList.add("active");
        addItem.style.borderColor = "var(--primary)";
        addItem.style.boxShadow = "0 0 0 2px rgba(56, 189, 248, 0.7)";
        // osveži cenu odmah ispod kartice (ako postoji)
        const footer = addItem.querySelector(".price");
        if (footer) footer.textContent = variant.price === 0 ? "Included" : `+${variant.price} €`;
      }

      // ako je taj deo dodatne opreme u nekoj grupi, otvori tu grupu
      const parentGroup = addItem?.closest(".variant-group");
      if (parentGroup && !parentGroup.classList.contains("open")) {
        parentGroup.classList.add("open");
      }
    }
  }
  buildPartsTable();
  updateTotalPrice();
  window.__suppressFocusCamera = false;
  render();
}
  renderSavedConfigs();
}
function initWeatherButtons() {
  const switchEl = document.getElementById("weatherSwitch");
  const track = switchEl?.querySelector(".switch-track");
  if (!switchEl || !track) return;

  const applyWeather = (weather) => {
    switchEl.dataset.weather = weather;
    setWeather(weather);
  };

  const handleClick = (evt) => {
    const rect = track.getBoundingClientRect();
    const x = evt.clientX - rect.left;
    const weather = x > rect.width * 0.5 ? "sunset" : "day";
    applyWeather(weather);
  };

  switchEl.addEventListener("click", handleClick);
}

const cameraControls = document.getElementById("camera-controls");
const toggleOptions = document.getElementById("toggleOptions");
const closeOptions = document.getElementById("closeOptions");

toggleOptions.addEventListener("click", () => {
  cameraControls.classList.remove("collapsed");
  cameraControls.classList.add("expanded");
});

closeOptions.addEventListener("click", () => {
  cameraControls.classList.remove("expanded");
  cameraControls.classList.add("collapsed");
});


document
  .querySelectorAll("#camera-controls button[data-view]")
  .forEach((btn) => {
    btn.addEventListener("click", () => {
      const viewName = btn.getAttribute("data-view");

      // 👇 DODAJ - HOME button specijalan slučaj
      if (viewName === "iso" && window.initialCameraState) {
        console.log("🏠 HOME clicked - restoring initial state");
        camera.useOrtho = false;
        camera.pan = window.initialCameraState.pan.slice();
        camera.distTarget = window.initialCameraState.dist;

        camera.rxTarget = window.initialCameraState.rx;

        camera.ryTarget = window.initialCameraState.ry;
        camera.ry = window.initialCameraState.ry;

        ({ proj, view, camWorld } = camera.updateView());
        sceneChanged = true;
        render();
        return; // 👈 ВАЖНО - izađi iz funkcije
      }


      camera.currentView = viewName;
      const orthoViews = new Set(["front", "left", "back", "right", "top", "side"]);
      camera.useOrtho = orthoViews.has(viewName);

      // ✅ Postavi uglove za svaki view
      const center = window.sceneBoundingCenter || [0, 0, 0];
      camera.panTarget = center.slice();

      switch (viewName) {
        case "iso":
          camera.rxTarget = Math.PI / 10;
          camera.ryTarget = Math.PI / 20;
          break;

        case "front":
          camera.rxTarget = Math.PI / 25;
          camera.ryTarget = 0; // gleda pravo napred
          break;

        case "back":
          camera.rxTarget = Math.PI / 10;
          camera.ryTarget = Math.PI; // gleda pozadi
          break;

        case "left":
          camera.rxTarget = Math.PI / 50;
          camera.ryTarget = -Math.PI / 2; // gleda levo
          break;

        case "right":
          camera.rxTarget = Math.PI / 10;
          camera.ryTarget = Math.PI / 2; // gleda desno
          break;

        case "top":
          camera.rxTarget = Math.PI / 2 - 0.05; // skoro 90°
          camera.ryTarget = 0;
          break;
      }

      if (window.boatMin && window.boatMax) {
        camera.fitToBoundingBox(window.boatMin, window.boatMax);
      }

      ({ proj, view, camWorld } = camera.updateView());
      sceneChanged = true;
      render();
    });
  });
function setupExclusiveButtons(selector) {
  const buttons = document.querySelectorAll(selector);
  buttons.forEach((btn) => {
    btn.addEventListener("click", () => {
      if (btn.classList.contains("active")) {
        btn.classList.remove("active");
        return;
      }
      buttons.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
    });
  });
}

setupExclusiveButtons("#camera-controls button[data-view]");

function getVariantPreviewSrc(partKey, variant) {
  const savedColorName = savedColorsByPart?.[partKey]?.[variant.name];
  const fallbackColorName = variant.colors?.[0]?.name || null;
  const generatedThumb = getThumbnailForVariant(partKey, variant.name, savedColorName || fallbackColorName);
  if (generatedThumb) {
    const isPlaceholder = generatedThumb.includes("part_placeholder");
    return { src: generatedThumb, isPlaceholder };
  }

  const colorData =
    variant.colors?.find((c) => c.name === savedColorName) ||
    variant.colors?.[0];

  if (colorData?.type === "texture" && colorData.texture) {
    return { src: colorData.texture, isPlaceholder: false };
  }

  return { src: PLACEHOLDER_THUMB, isPlaceholder: true };
}
  
  const input = document.getElementById("glbInput");
  const loadingScr = document.getElementById("loading-screen");
  const toggleDimsBtn = document.getElementById("toggleDims");
  toggleDimsBtn.innerText = "Show Ruler"; // početni tekst
  
  toggleDimsBtn.addEventListener("click", () => {
    showDimensions = !showDimensions;
    toggleDimsBtn.innerText = showDimensions ? "Hide Ruler" : "Show Ruler";

    ["lengthLabel", "widthLabel", "heightLabel"].forEach((id) => {
      const lbl = document.getElementById(id);
      if (lbl) {
        lbl.style.display = showDimensions ? "block" : "none";
        if (!showDimensions) lbl.classList.remove("visible");
      }
    });
    const anchor = document.querySelector(".ruler-anchor");
    if (anchor) anchor.style.display = showDimensions ? "block" : "none";
    if (window.markDimLabelsDirty) window.markDimLabelsDirty();
  });
  const toggleWaterBtn = document.getElementById("toggleWater");
  toggleWaterBtn.innerText = "Studio"; // odmah prikaži tekst jer je voda aktivna
  
  toggleWaterBtn.addEventListener("click", () => {
    showWater = !showWater;
    toggleWaterBtn.innerText = showWater ? "Studio" : "Env";
    if (typeof window.setEnvMode === "function") {
      window.setEnvMode(showWater ? "sky" : "studio");
    }
    sceneChanged = true;
    render();
  });
  

  
const hamburger = document.getElementById("hamburger");
const sidebarMenu = document.getElementById("sidebarMenu");
const closeSidebar = document.getElementById("closeSidebar");

// prvo ovo
document.querySelectorAll("#sidebarList li").forEach(li => {
  li.addEventListener("click", e => {
    // ako klik dolazi iz forme (input, textarea, button), ignorisi
    if (e.target.closest("form")) return;

    e.preventDefault();
    e.stopPropagation();

    const existing = li.querySelector(".item-desc");
    if (existing) {
      existing.remove();
      return;
    }

    document.querySelectorAll("#sidebarList .item-desc").forEach(el => el.remove());

    const key = li.dataset.key;
    const text = SIDEBAR_INFO[key] || "No description available.";

    const desc = document.createElement("div");
    desc.className = "item-desc";
    desc.innerHTML = text;
    li.appendChild(desc);
  });
});

// tek POSLE toga dodaj ovo
if (hamburger && sidebarMenu && closeSidebar) {
  hamburger.addEventListener("click", e => {
    e.stopPropagation();
    sidebarMenu.classList.add("open");
  });

  closeSidebar.addEventListener("click", e => {
    e.stopPropagation();
    sidebarMenu.classList.remove("open");
  });
  document.addEventListener("click", e => {
    const clickedInsideSidebar = sidebarMenu.contains(e.target);
    const clickedHamburger = e.target === hamburger;
    const clickedContactForm = e.target.closest("#contactForm");

    if (
      sidebarMenu.classList.contains("open") &&
      !clickedInsideSidebar &&
      !clickedHamburger &&
      !clickedContactForm
    ) {
      sidebarMenu.classList.remove("open");
    }
  });
}


// === Tooltip hint za boat name ===
function setupBoatTooltip() {
  const header = document.querySelector(".header-left");
  const toggle = document.getElementById("menuToggle");
  if (!header || !toggle) return;

  header.classList.add("show-tooltip");
  toggle.addEventListener(
    "click",
    () => {
      header.classList.remove("show-tooltip");
      localStorage.setItem("boatTooltipSeen", "1");
    },
    { once: true }
  );
}

if (document.readyState === "loading") {
  window.addEventListener("DOMContentLoaded", setupBoatTooltip, { once: true });
} else {
  setupBoatTooltip();
}

input.addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  showLoading();

  const buf = await file.arrayBuffer();

 await loadGLB(buf);  // čeka i model i teksture
hideLoading();        // sad sigurno sve gotovo
sceneChanged = true;
render();             // sad tek nacrtaj prvi frame

  input.value = ""; 
});

export function initUI(ctx) {
  // Uskladi lokalni i globalni cache boja/tekstrura
  savedColorsByPart = window.savedColorsByPart || savedColorsByPart || {};
  window.savedColorsByPart = savedColorsByPart;

  window.render = ctx.render;
  window.BOAT_INFO = ctx.BOAT_INFO;
  window.VARIANT_GROUPS = ctx.VARIANT_GROUPS;
  window.BASE_PRICE = ctx.BASE_PRICE;
  window.SIDEBAR_INFO = ctx.SIDEBAR_INFO;

  const { render, BOAT_INFO, VARIANT_GROUPS, BASE_PRICE, SIDEBAR_INFO } = ctx;

  if (!VARIANT_GROUPS || typeof VARIANT_GROUPS !== "object") {
    console.error("❌ VARIANT_GROUPS nije prosleđen u initUI()");
    return;
  }

  // 🔹 sigurnosne provere i inicijalizacija
  if (!window.thumbnails) window.thumbnails = {};
  const thumbnails = window.thumbnails;

  if (!window.currentParts) window.currentParts = {};

  initDropdown();
  initSavedConfigs();
  initWeatherButtons();
  buildVariantSidebar();
  buildPartsTable();
  updateTotalPrice();
  renderBoatInfo(BOAT_INFO);
document.querySelectorAll("#camera-controls button").forEach((btn) => {
  // simuliraj kratki pritisak na touch
  btn.addEventListener("touchstart", () => {
    btn.classList.add("pressed");
  }, { passive: true });

  btn.addEventListener("touchend", () => {
    btn.classList.remove("pressed");
    btn.blur(); // ukloni fokus odmah
  }, { passive: true });

  btn.addEventListener("touchcancel", () => {
    btn.classList.remove("pressed");
    btn.blur();
  }, { passive: true });
});
}

export { updateTotalPrice, showPartInfo };



