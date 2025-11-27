import {
  DEFAULT_MODEL,
  BOAT_INFO,
  VARIANT_GROUPS,
  SIDEBAR_INFO,
  BASE_PRICE,
  CLIENTS,
} from "./config.js";

const CONFIG_SIGNATURE = JSON.stringify({
  boatInfo: BOAT_INFO,
  variantGroups: VARIANT_GROUPS,
});

const cloneData = value =>
  typeof structuredClone === "function"
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));

const sidebarInfo = cloneData(SIDEBAR_INFO);
const EMPTY_BOAT_INFO = Object.keys(BOAT_INFO).reduce((acc, key) => {
  acc[key] = "";
  return acc;
}, {});
const DEFAULT_MODEL_PATH = DEFAULT_MODEL || "assets/boat.glb";

function attachUpload(fileInput, targetInput) {
  if (!fileInput || !targetInput) return;
  fileInput.addEventListener("change", () => {
    const f = fileInput.files && fileInput.files[0];
    if (!f) return;
    targetInput.value = f.name;
    targetInput.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

const app = document.createElement("div");
app.id = "app";
const mainContent = document.getElementById("mainContent");
mainContent.innerHTML = "";
mainContent.appendChild(app);

const clientsSection = document.createElement("div");
clientsSection.className = "section";

const title = document.createElement("h2");
title.textContent = "Clients";

const clientsContainer = document.createElement("div");
clientsContainer.id = "clientsContainer";

clientsSection.appendChild(title);
clientsSection.appendChild(clientsContainer);
app.appendChild(clientsSection);

const tabsBar = document.createElement("div");
tabsBar.className = "clients-nav";
clientsSection.insertBefore(tabsBar, clientsContainer);

const addClientButton = document.getElementById("addClientBtn");
if (addClientButton) {
  addClientButton.onclick = () => addClientForm({}, { blank: true });
}

document.getElementById("saveBtn").onclick = handleSave;

function refreshTabs() {
  tabsBar.innerHTML = "";
  const cards = document.querySelectorAll(".client-card");
  cards.forEach((card, idx) => {
    const name = card.querySelector(".client-name").value || `Client ${idx + 1}`;
    const btn = document.createElement("button");
    btn.textContent = name;
    btn.onclick = () => {
      document.querySelectorAll(".client-body").forEach(body => (body.style.display = "none"));
      document.querySelectorAll(".client-card .toggleBtn").forEach(t => (t.textContent = "▼"));
      card.querySelector(".client-body").style.display = "block";
      card.querySelector(".toggleBtn").textContent = "▲";
      tabsBar.querySelectorAll("button").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
    };
    tabsBar.appendChild(btn);
  });
}

function renderSidebarClients() {
  const list = document.getElementById("clientsList");
  const count = document.querySelector(".client-count");
  if (!list || !count) return;

  const cards = document.querySelectorAll(".client-card");
  if (cards.length === 0) {
    list.innerHTML = `<div class="no-clients">No clients yet</div>`;
    count.textContent = "0 Clients";
    return;
  }

  count.textContent = `${cards.length} ${cards.length === 1 ? "Client" : "Clients"}`;
  list.innerHTML = "";

  cards.forEach((card, idx) => {
    const name = card.querySelector(".client-name")?.value || `Client ${idx + 1}`;
    const item = document.createElement("div");
    item.className = "client-item";
    item.innerHTML = `
      <div class="client-status active"></div>
      <div class="client-item-name">${name}</div>
    `;
    item.onclick = () => {
      document.querySelectorAll(".client-body").forEach(body => (body.style.display = "none"));
      document.querySelectorAll(".client-card .toggleBtn").forEach(t => (t.textContent = "▼"));
      const cardBody = card.querySelector(".client-body");
      cardBody.style.display = "block";
      card.querySelector(".toggleBtn").textContent = "▲";
    };
    list.appendChild(item);
  });
}

function addClientForm(data = {}, options = {}) {
  const isBlank = options.blank === true;
  const clientDiv = document.createElement("div");
  clientDiv.className = "client-card";

  const index = clientsContainer.children.length + 1;
  const clientName = data.name ?? (isBlank ? "" : `Client ${index}`);
  const boatInfo = isBlank ? cloneData(EMPTY_BOAT_INFO) : data.boatInfo ?? cloneData(BOAT_INFO);
  const defaultModel = data.defaultModel ?? DEFAULT_MODEL_PATH;
  const variantGroups = isBlank
    ? []
    : normalizeVariantGroups(data.variantGroups ?? VARIANT_GROUPS);
  const linkPreview = slugify(clientName) || `client-${index}`;

  clientDiv.innerHTML = `
    <div class="client-header">
      <div class="client-header-left">
        <label>Client name</label>
        <input type="text" placeholder="Client Name" value="${clientName}" class="client-name">
        <div class="client-link">Link preview <code>?client=${linkPreview}</code></div>
      </div>
      <div class="client-header-right">
        <button class="ghost-button subtle toggleBtn">Collapse</button>
        <button class="ghost-button danger removeBtn">Remove</button>
      </div>
    </div>
  `;

  const body = document.createElement("div");
  body.className = "client-body";

  const boatDiv = document.createElement("section");
  boatDiv.className = "panel-card boat-info";
  boatDiv.innerHTML = `
    <div class="panel-head">
      <div>
        <p class="eyebrow">Foundational data</p>
        <h3>Boat info</h3>
        <p class="panel-description">Reference specs that appear inside the configurator toggle panels.</p>
      </div>
    </div>
  `;

  const defaultModelField = document.createElement("div");
  defaultModelField.className = "form-grid one";
  defaultModelField.innerHTML = `
    <label>Default model (GLB path)</label>
    <div class="file-input-row">
      <input type="text" class="default-model-input" value="${defaultModel}" placeholder="assets/boat.glb" readonly>
      <label class="upload-label">Upload<input type="file" class="default-model-upload" accept=".glb"></label>
    </div>
  `;
  attachUpload(defaultModelField.querySelector(".default-model-upload"), defaultModelField.querySelector(".default-model-input"));

  const boatGrid = document.createElement("div");
  boatGrid.className = "form-grid two";
  Object.entries(boatInfo).forEach(([key, value]) => {
    const field = createFormField(key, value ?? "");
    const input = field.querySelector("input");
    input.dataset.section = "boat";
    input.dataset.key = key;
    boatGrid.appendChild(field);
  });
  boatDiv.appendChild(defaultModelField);
  boatDiv.appendChild(boatGrid);

  const variantsWrapper = document.createElement("section");
  variantsWrapper.className = "panel-card";
  variantsWrapper.innerHTML = `
    <div class="panel-head">
      <div>
        <p class="eyebrow">Configurator content</p>
        <h3>Variant groups</h3>
        <p class="panel-description">Break down every selectable item by group and mesh part. Use as many variant and additional groups as you need.</p>
      </div>
      <button type="button" class="ghost-button add-group">➕ Add group</button>
    </div>
  `;

  const groupsContainer = document.createElement("div");
  groupsContainer.className = "variant-groups";
  variantGroups.forEach(group => groupsContainer.appendChild(createVariantGroup(group)));
  variantsWrapper.appendChild(groupsContainer);

  variantsWrapper.querySelector(".add-group").onclick = () => {
    groupsContainer.appendChild(createVariantGroup());
  };

  const tabs = document.createElement("div");
  tabs.className = "client-tabs";
  tabs.innerHTML = `
    <button type="button" data-tab="overview" class="active">Boat info</button>
    <button type="button" data-tab="variants">Variant groups</button>
  `;

  const panels = document.createElement("div");
  panels.className = "client-tab-panels";
  const overviewPanel = document.createElement("div");
  overviewPanel.className = "client-tab-panel active";
  overviewPanel.dataset.tab = "overview";
  overviewPanel.appendChild(boatDiv);
  const variantsPanel = document.createElement("div");
  variantsPanel.className = "client-tab-panel";
  variantsPanel.dataset.tab = "variants";
  variantsPanel.appendChild(variantsWrapper);
  panels.appendChild(overviewPanel);
  panels.appendChild(variantsPanel);

  tabs.querySelectorAll("button").forEach(btn => {
    btn.addEventListener("click", () => {
      const tab = btn.dataset.tab;
      tabs.querySelectorAll("button").forEach(b => b.classList.toggle("active", b === btn));
      panels.querySelectorAll(".client-tab-panel").forEach(panel =>
        panel.classList.toggle("active", panel.dataset.tab === tab),
      );
    });
  });

  body.appendChild(tabs);
  body.appendChild(panels);
  clientDiv.appendChild(body);
  clientsContainer.appendChild(clientDiv);

  const toggleBtn = clientDiv.querySelector(".toggleBtn");
  const removeBtn = clientDiv.querySelector(".removeBtn");
  const nameInput = clientDiv.querySelector(".client-name");
  const linkBadge = clientDiv.querySelector(".client-link code");

  let isBodyVisible = true;
  const setBodyVisibility = visible => {
    isBodyVisible = visible;
    body.style.display = visible ? "block" : "none";
    toggleBtn.textContent = visible ? "Collapse" : "Expand";
  };

  toggleBtn.onclick = () => {
    setBodyVisibility(!isBodyVisible);
  };

  removeBtn.onclick = () => {
    clientDiv.remove();
    refreshTabs();
    renderSidebarClients();
  };

  nameInput.addEventListener("input", () => {
    const slug = slugify(nameInput.value) || "client";
    linkBadge.textContent = `?client=${slug}`;
    refreshTabs();
    renderSidebarClients();
  });

  setBodyVisibility(clientsContainer.children.length === 1);

  refreshTabs();
  renderSidebarClients();
}

function createFormField(labelText, value = "") {
  const wrapper = document.createElement("label");
  wrapper.className = "form-field";
  wrapper.innerHTML = `<span>${labelText}</span>`;
  const input = document.createElement("input");
  input.type = "text";
  input.value = value;
  wrapper.appendChild(input);
  return wrapper;
}

function createVariantGroup(groupData = {}) {
  const groupDiv = document.createElement("div");
  groupDiv.className = "variant-group variant-card collapsed";

  groupDiv.innerHTML = `
    <div class="variant-card-head">
      <div>
        <p class="eyebrow">Group</p>
        <input type="text" class="variant-group-name" value="${groupData.name ?? ""}" placeholder="Seats, Hull, Additional equipment">
      </div>
      <div class="variant-card-meta">
        <span class="pill parts-pill">0 Parts</span>
        <button type="button" class="ghost-button subtle collapse-group">Collapse</button>
        <button type="button" class="ghost-button danger remove-group">Remove</button>
      </div>
    </div>
  `;

  const body = document.createElement("div");
  body.className = "variant-card-body";

  const helperText = document.createElement("p");
  helperText.className = "card-hint";
  helperText.textContent = "Mesh parts define which 3D objects respond to the options below.";
  body.appendChild(helperText);

  const partsContainer = document.createElement("div");
  partsContainer.className = "variant-parts";
  const partList = groupData.parts && groupData.parts.length ? groupData.parts : [createEmptyPart()];
  partList.forEach(part => partsContainer.appendChild(createVariantPart(part)));
  body.appendChild(partsContainer);

  groupDiv.appendChild(body);

  groupDiv.querySelector(".remove-group").onclick = () => {
    groupDiv.remove();
  };

  const collapseBtn = groupDiv.querySelector(".collapse-group");
  const toggleGroup = collapsed => {
    groupDiv.classList.toggle("collapsed", collapsed);
    body.style.display = collapsed ? "none" : "block";
    collapseBtn.textContent = collapsed ? "Expand" : "Collapse";
  };
  collapseBtn.onclick = () => {
    toggleGroup(!groupDiv.classList.contains("collapsed"));
  };
  toggleGroup(true);

  updateGroupSummary(groupDiv);
  return groupDiv;
}

function createEmptyPart() {
  return { key: "", mainMat: "", models: [] };
}

function createVariantPart(partData = {}) {
  const partDiv = document.createElement("div");
  partDiv.className = "variant-part collapsed";

  partDiv.innerHTML = `
    <div class="variant-part-header">
      <div>
        <label>Mesh / Part key</label>
        <input type="text" class="variant-part-name" value="${partData.key ?? ""}" placeholder="BT_Base_03_A">
      </div>
      <div>
        <label>Main material</label>
        <input type="text" class="variant-part-material" value="${partData.mainMat ?? ""}" placeholder="Material ID">
      </div>
      <div class="variant-part-actions">
        <span class="pill items-pill">0 Items</span>
        <button type="button" class="ghost-button subtle collapse-part">Collapse</button>
        <button type="button" class="ghost-button danger remove-part">Remove part</button>
      </div>
    </div>
  `;

  const itemsContainer = document.createElement("div");
  itemsContainer.className = "variant-items";
  (partData.models ?? []).forEach(model => itemsContainer.appendChild(createVariantItem(model)));

  const addItemBtn = document.createElement("button");
  addItemBtn.type = "button";
  addItemBtn.className = "ghost-button add-variant-item";
  addItemBtn.textContent = "➕ Add variant item";
  addItemBtn.onclick = () => {
    itemsContainer.appendChild(createVariantItem());
    updatePartSummary(partDiv);
  };

  const partBody = document.createElement("div");
  partBody.className = "variant-part-body";
  partBody.appendChild(itemsContainer);
  partBody.appendChild(addItemBtn);

  partDiv.appendChild(partBody);

  partDiv.querySelector(".remove-part").onclick = () => {
    const parentGroup = partDiv.closest(".variant-group");
    partDiv.remove();
    if (parentGroup) updateGroupSummary(parentGroup);
  };
  const collapseBtn = partDiv.querySelector(".collapse-part");
  const togglePart = collapsed => {
    partDiv.classList.toggle("collapsed", collapsed);
    partBody.style.display = collapsed ? "none" : "flex";
    collapseBtn.textContent = collapsed ? "Expand" : "Collapse";
  };
  collapseBtn.onclick = () => togglePart(!partDiv.classList.contains("collapsed"));
  togglePart(true);

  if ((partData.models ?? []).length === 0) {
    itemsContainer.appendChild(createVariantItem());
  }

  updatePartSummary(partDiv);
  return partDiv;
}

function createVariantItem(itemData = {}) {
  const itemDiv = document.createElement("div");
  itemDiv.className = "variant-item collapsed";

  const summary = document.createElement("div");
  summary.className = "variant-item-summary";
  summary.innerHTML = `
    <div>
      <p class="variant-item-title">${itemData.name ?? "New item"}</p>
      <p class="variant-item-subtitle">${itemData.src ?? "No GLB source"}</p>
    </div>
    <div class="variant-item-summary-meta">
      <span class="pill price-pill">${formatPriceLabel(itemData.price)}</span>
      <button type="button" class="ghost-button subtle toggle-item">Expand</button>
      <button type="button" class="ghost-button danger remove-variant-item">Remove</button>
    </div>
  `;
  itemDiv.appendChild(summary);

  const details = document.createElement("div");
  details.className = "variant-item-details";
  details.innerHTML = `
    <div class="variant-item-head">
      <div class="field-grid">
        <label>Item name<input type="text" class="variant-item-name" value="${itemData.name ?? ""}" placeholder="Display name"></label>
        <label>GLB / model source
          <div class="file-input-row">
            <input type="text" class="variant-item-src" value="${itemData.src ?? ""}" placeholder="variants/your-file.glb" readonly>
            <label class="upload-label">Upload<input type="file" class="variant-item-upload" accept=".glb"></label>
          </div>
        </label>
        <label>Price (EUR)<input type="number" class="variant-item-price" value="${itemData.price ?? 0}" min="0"></label>
      </div>
    </div>
    <label>Description<textarea class="variant-item-description" rows="3" placeholder="Describe this option">${itemData.description ?? ""}</textarea></label>
    <div class="material-options">
      <div class="material-options-header">
        <div>
          <h4>Material / texture options</h4>
          <p class="card-hint">Add colors or upload texture maps for this item.</p>
        </div>
        <button type="button" class="ghost-button add-color">? Add option</button>
      </div>
      <div class="material-options-body"></div>
    </div>
  `;
  itemDiv.appendChild(details);

  const optionsBody = details.querySelector(".material-options-body");
  const hasSavedColors = Array.isArray(itemData.colors);
  (itemData.colors ?? []).forEach(color => optionsBody.appendChild(createColorRow(color)));

  details.querySelector(".add-color").onclick = () => {
    optionsBody.appendChild(createColorRow());
  };

  const removeBtn = summary.querySelector(".remove-variant-item");
  removeBtn.onclick = () => {
    const parentPart = itemDiv.closest(".variant-part");
    itemDiv.remove();
    if (parentPart) updatePartSummary(parentPart);
  };

  if (!hasSavedColors) {
    optionsBody.appendChild(createColorRow({ type: "color" }));
  }

  const toggleBtn = summary.querySelector(".toggle-item");
  const toggleItem = collapsed => {
    itemDiv.classList.toggle("collapsed", collapsed);
    details.style.display = collapsed ? "none" : "block";
    toggleBtn.textContent = collapsed ? "Expand" : "Collapse";
  };
  toggleBtn.onclick = () => toggleItem(!itemDiv.classList.contains("collapsed"));

  const nameInput = details.querySelector(".variant-item-name");
  const srcInput = details.querySelector(".variant-item-src");
  attachUpload(details.querySelector(".variant-item-upload"), srcInput);
  const priceInput = details.querySelector(".variant-item-price");
  const titleEl = summary.querySelector(".variant-item-title");
  const subtitleEl = summary.querySelector(".variant-item-subtitle");
  const pricePill = summary.querySelector(".price-pill");
  const updateSummary = () => {
    titleEl.textContent = nameInput.value || "New item";
    subtitleEl.textContent = srcInput.value || "No GLB source";
    pricePill.textContent = formatPriceLabel(priceInput.value);
  };
  [nameInput, srcInput, priceInput].forEach(input => input.addEventListener("input", updateSummary));
  updateSummary();
  toggleItem(true);

  return itemDiv;
}

function createColorRow(option = {}) {
  const row = document.createElement("div");
  row.className = "color-row";
  const type = option.type ?? "color";

  row.innerHTML = `
    <div class="color-row-main">
      <input type="text" class="color-option-name" value="${option.name ?? ""}" placeholder="Option name">
      <select class="color-option-type">
        <option value="color" ${type === "color" ? "selected" : ""}>Color</option>
        <option value="texture" ${type === "texture" ? "selected" : ""}>Texture</option>
      </select>
      <input type="color" class="color-option-hex" value="${rgbArrayToHex(option.color)}">
    </div>
    <div class="texture-inputs">
      <div class="file-input-row">
        <input type="text" class="texture-map" value="${option.texture ?? ""}" placeholder="Texture file">
        <label class="upload-label">Upload<input type="file" class="texture-map-upload" accept=".jpg,.jpeg,.png,.webp"></label>
      </div>
      <div class="file-input-row">
        <input type="text" class="texture-normal" value="${option.normal ?? ""}" placeholder="Normal map">
        <label class="upload-label">Upload<input type="file" class="texture-normal-upload" accept=".jpg,.jpeg,.png,.webp"></label>
      </div>
      <div class="file-input-row">
        <input type="text" class="texture-rough" value="${option.rough ?? ""}" placeholder="Roughness map">
        <label class="upload-label">Upload<input type="file" class="texture-rough-upload" accept=".jpg,.jpeg,.png,.webp"></label>
      </div>
    </div>
    <div class="color-row-actions">
      <button type="button" class="ghost-button danger remove-color">Remove</button>
    </div>
  `;

  const typeSelect = row.querySelector(".color-option-type");
  const colorInput = row.querySelector(".color-option-hex");
  const textureInputs = row.querySelector(".texture-inputs");
  ["texture-map", "texture-normal", "texture-rough"].forEach(cls => {
    const inp = row.querySelector(`.${cls}`);
    if (inp) inp.readOnly = true;
  });
  attachUpload(row.querySelector(".texture-map-upload"), row.querySelector(".texture-map"));
  attachUpload(row.querySelector(".texture-normal-upload"), row.querySelector(".texture-normal"));
  attachUpload(row.querySelector(".texture-rough-upload"), row.querySelector(".texture-rough"));

  function syncMaterialInputs() {
    const currentType = typeSelect.value;
    if (currentType === "color") {
      colorInput.style.display = "block";
      textureInputs.style.display = "none";
    } else {
      colorInput.style.display = "none";
      textureInputs.style.display = "grid";
    }
  }

  syncMaterialInputs();
  typeSelect.addEventListener("change", syncMaterialInputs);
  row.querySelector(".remove-color").onclick = () => row.remove();
  return row;
}

function updateGroupSummary(groupDiv) {
  const pill = groupDiv.querySelector(".parts-pill");
  if (pill) {
    const count = groupDiv.querySelectorAll(".variant-part").length;
    pill.textContent = `${count} ${count === 1 ? "Part" : "Parts"}`;
  }
}

function updatePartSummary(partDiv) {
  const pill = partDiv.querySelector(".items-pill");
  if (pill) {
    const count = partDiv.querySelectorAll(".variant-item").length;
    pill.textContent = `${count} ${count === 1 ? "Item" : "Items"}`;
  }
}

function normalizeVariantGroups(groups = {}) {
  return Object.entries(groups).map(([groupName, parts]) => ({
    name: groupName,
    parts: Object.entries(parts ?? {}).map(([key, part]) => ({
      key,
      mainMat: part?.mainMat ?? "",
      models: (part?.models ?? []).map(model => ({
        ...model,
        colors: model?.colors ?? [],
      })),
    })),
  }));
}

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

function rgbArrayToHex(color = []) {
  if (!Array.isArray(color) || color.length < 3) return "#ffffff";
  const toHex = value => {
    const normalized = Math.max(0, Math.min(255, Math.round((value ?? 0) * 255)));
    return normalized.toString(16).padStart(2, "0");
  };
  return `#${toHex(color[0])}${toHex(color[1])}${toHex(color[2])}`;
}

function hexToRgbArray(hex) {
  const clean = (hex || "#ffffff").replace("#", "");
  if (clean.length !== 6) return [1, 1, 1];
  const r = parseInt(clean.slice(0, 2), 16) / 255;
  const g = parseInt(clean.slice(2, 4), 16) / 255;
  const b = parseInt(clean.slice(4, 6), 16) / 255;
  return [Number(r.toFixed(3)), Number(g.toFixed(3)), Number(b.toFixed(3))];
}

function formatPriceLabel(value) {
  const num = Number(value) || 0;
  if (num === 0) return "Included";
  return `+€${num.toLocaleString("de-DE")}`;
}

function buildClientFromCard(card, index) {
  const name = card.querySelector(".client-name").value.trim() || `Client ${index + 1}`;
  const defaultModel = card.querySelector(".default-model-input")?.value.trim() || DEFAULT_MODEL_PATH;
  const boatInfo = {};
  card.querySelectorAll('.boat-info input[data-section="boat"]').forEach(input => {
    boatInfo[input.dataset.key] = input.value;
  });

  const variantGroups = {};
  card.querySelectorAll(".variant-group").forEach(groupEl => {
    const groupName = groupEl.querySelector(".variant-group-name").value.trim();
    if (!groupName) return;
    const parts = {};

    groupEl.querySelectorAll(".variant-part").forEach(partEl => {
      const partKey = partEl.querySelector(".variant-part-name").value.trim();
      if (!partKey) return;
      const partData = {
        mainMat: partEl.querySelector(".variant-part-material").value.trim() || null,
        models: [],
      };

      partEl.querySelectorAll(".variant-item").forEach(itemEl => {
        const model = {
          name: itemEl.querySelector(".variant-item-name").value.trim(),
          src: itemEl.querySelector(".variant-item-src").value.trim() || null,
          price: parseFloat(itemEl.querySelector(".variant-item-price").value) || 0,
          description: itemEl.querySelector(".variant-item-description").value.trim(),
          colors: [],
        };

        itemEl.querySelectorAll(".color-row").forEach(row => {
          const type = row.querySelector(".color-option-type").value;
          const colorData = {
            name: row.querySelector(".color-option-name").value.trim(),
            type,
          };
          if (type === "color") {
            colorData.color = hexToRgbArray(row.querySelector(".color-option-hex").value);
          } else {
            colorData.texture = row.querySelector(".texture-map").value.trim();
            colorData.normal = row.querySelector(".texture-normal").value.trim();
            colorData.rough = row.querySelector(".texture-rough").value.trim();
          }
          model.colors.push(colorData);
        });

        partData.models.push(model);
      });

      if (partData.models.length) {
        parts[partKey] = partData;
      }
    });

    if (Object.keys(parts).length) {
      variantGroups[groupName] = parts;
    }
  });

  return {
    name,
    slug: slugify(name) || `client-${index + 1}`,
    defaultModel,
    boatInfo,
    variantGroups,
    __signature: CONFIG_SIGNATURE,
  };
}

function collectClients() {
  const cards = Array.from(document.querySelectorAll(".client-card"));
  return cards.map((card, idx) => buildClientFromCard(card, idx)).filter(Boolean);
}

function handleSave() {
  const clients = collectClients();
  if (clients.length === 0) {
    alert("Add at least one client before saving.");
    return;
  }

  const firstClient = clients[0];
 const output = `export const DEFAULT_MODEL = ${JSON.stringify(firstClient.defaultModel || DEFAULT_MODEL_PATH)};
export const BASE_PRICE = ${BASE_PRICE};
export const BOAT_INFO = ${JSON.stringify(firstClient.boatInfo, null, 2)};
export const VARIANT_GROUPS = ${JSON.stringify(firstClient.variantGroups, null, 2)};
export const SIDEBAR_INFO = ${JSON.stringify(sidebarInfo, null, 2)};
export const CLIENTS = ${JSON.stringify(clients, null, 2)};`;

  const blob = new Blob([output], { type: "text/javascript" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "config.js";
  a.click();
  URL.revokeObjectURL(url);
  alert("New config.js exported!");
}

const initialClients = (() => {
  if (!Array.isArray(CLIENTS) || CLIENTS.length === 0) {
    return [
      {
        name: "Client 1",
        defaultModel: DEFAULT_MODEL_PATH,
        boatInfo: cloneData(BOAT_INFO),
        variantGroups: cloneData(VARIANT_GROUPS),
      },
    ];
  }
  return CLIENTS.map((client, idx) => {
    const needsResync = client?.__signature !== CONFIG_SIGNATURE;
    return {
      name: client?.name ?? `Client ${idx + 1}`,
      defaultModel: client?.defaultModel ?? DEFAULT_MODEL_PATH,
      boatInfo: needsResync ? cloneData(BOAT_INFO) : cloneData(client.boatInfo ?? BOAT_INFO),
      variantGroups: needsResync
        ? cloneData(VARIANT_GROUPS)
        : cloneData(client.variantGroups ?? VARIANT_GROUPS),
    };
  });
})();

initialClients.forEach(client =>
  addClientForm({
    name: client.name,
    boatInfo: client.boatInfo,
    variantGroups: client.variantGroups,
  }),
);

