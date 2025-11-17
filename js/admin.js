import { BOAT_INFO, VARIANT_GROUPS, SIDEBAR_INFO, BASE_PRICE } from "./config.js";

const generalSettingsState = {
  defaultModelInput: null,
  basePriceInput: null,
  sidebarInputs: new Map(),
};

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

const generalSection = createGeneralSettingsSection();
app.appendChild(generalSection);
app.appendChild(clientsSection);

const tabsBar = document.createElement("div");
tabsBar.className = "clients-nav";
clientsSection.insertBefore(tabsBar, clientsContainer);

const addClientButton = document.getElementById("addClientBtn");
if (addClientButton) {
  addClientButton.onclick = () => addClientForm();
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

function addClientForm(data = {}) {
  const clientDiv = document.createElement("div");
  clientDiv.className = "client-card";

  const index = clientsContainer.children.length + 1;
  const clientName = data.name ?? `Client ${index}`;
  const boatInfo = data.boatInfo ?? structuredClone(BOAT_INFO);
  const variantGroups = normalizeVariantGroups(data.variantGroups ?? VARIANT_GROUPS);
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

  const boatGrid = document.createElement("div");
  boatGrid.className = "form-grid two";
  Object.entries(boatInfo).forEach(([key, value]) => {
    const field = createFormField(key, value ?? "");
    const input = field.querySelector("input");
    input.dataset.section = "boat";
    input.dataset.key = key;
    boatGrid.appendChild(field);
  });
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

  body.appendChild(boatDiv);
  body.appendChild(variantsWrapper);
  clientDiv.appendChild(body);
  clientsContainer.appendChild(clientDiv);

  const toggleBtn = clientDiv.querySelector(".toggleBtn");
  const removeBtn = clientDiv.querySelector(".removeBtn");
  const nameInput = clientDiv.querySelector(".client-name");
  const linkBadge = clientDiv.querySelector(".client-link code");

  const setBodyVisibility = visible => {
    body.style.display = visible ? "flex" : "none";
    toggleBtn.textContent = visible ? "Collapse" : "Expand";
  };

  toggleBtn.onclick = () => {
    const isVisible = body.style.display === "flex";
    setBodyVisibility(!isVisible);
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
  groupDiv.className = "variant-group variant-card";

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
  (groupData.parts ?? []).forEach(part => partsContainer.appendChild(createVariantPart(part)));
  body.appendChild(partsContainer);

  const addPartBtn = document.createElement("button");
  addPartBtn.type = "button";
  addPartBtn.className = "ghost-button add-part wide";
  addPartBtn.textContent = "➕ Add mesh / part";
  addPartBtn.onclick = () => {
    partsContainer.appendChild(createVariantPart());
    updateGroupSummary(groupDiv);
  };
  body.appendChild(addPartBtn);

  groupDiv.appendChild(body);

  groupDiv.querySelector(".remove-group").onclick = () => {
    groupDiv.remove();
  };

  const collapseBtn = groupDiv.querySelector(".collapse-group");
  collapseBtn.onclick = () => {
    const isHidden = body.style.display === "none";
    body.style.display = isHidden ? "block" : "none";
    collapseBtn.textContent = isHidden ? "Collapse" : "Expand";
  };

  if ((groupData.parts ?? []).length === 0) {
    partsContainer.appendChild(createVariantPart());
  }

  updateGroupSummary(groupDiv);
  return groupDiv;
}

function createVariantPart(partData = {}) {
  const partDiv = document.createElement("div");
  partDiv.className = "variant-part";

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

  partDiv.appendChild(itemsContainer);
  partDiv.appendChild(addItemBtn);

  partDiv.querySelector(".remove-part").onclick = () => {
    const parentGroup = partDiv.closest(".variant-group");
    partDiv.remove();
    if (parentGroup) updateGroupSummary(parentGroup);
  };

  if ((partData.models ?? []).length === 0) {
    itemsContainer.appendChild(createVariantItem());
  }

  updatePartSummary(partDiv);
  return partDiv;
}

function createVariantItem(itemData = {}) {
  const itemDiv = document.createElement("div");
  itemDiv.className = "variant-item";

  itemDiv.innerHTML = `
    <div class="variant-item-head">
      <div class="field-grid">
        <label>Item name<input type="text" class="variant-item-name" value="${itemData.name ?? ""}" placeholder="Display name"></label>
        <label>GLB / model source<input type="text" class="variant-item-src" value="${itemData.src ?? ""}" placeholder="variants/your-file.glb"></label>
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
        <button type="button" class="ghost-button add-color">➕ Add option</button>
      </div>
      <div class="material-options-body"></div>
    </div>
    <div class="variant-item-footer">
      <button type="button" class="ghost-button danger remove-variant-item">Remove item</button>
    </div>
  `;

  const optionsBody = itemDiv.querySelector(".material-options-body");
  (itemData.colors ?? []).forEach(color => optionsBody.appendChild(createColorRow(color)));

  itemDiv.querySelector(".add-color").onclick = () => {
    optionsBody.appendChild(createColorRow());
  };

  itemDiv.querySelector(".remove-variant-item").onclick = () => {
    const parentPart = itemDiv.closest(".variant-part");
    itemDiv.remove();
    if (parentPart) updatePartSummary(parentPart);
  };

  if ((itemData.colors ?? []).length === 0) {
    optionsBody.appendChild(createColorRow({ type: "color" }));
  }

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
      <input type="text" class="texture-map" value="${option.texture ?? ""}" placeholder="Texture file">
      <input type="text" class="texture-normal" value="${option.normal ?? ""}" placeholder="Normal map">
      <input type="text" class="texture-rough" value="${option.rough ?? ""}" placeholder="Roughness map">
      <label class="upload-label">Upload<input type="file" class="texture-upload" accept=".jpg,.jpeg,.png,.webp"></label>
    </div>
    <div class="color-row-actions">
      <button type="button" class="ghost-button danger remove-color">Remove</button>
    </div>
  `;

  const typeSelect = row.querySelector(".color-option-type");
  const colorInput = row.querySelector(".color-option-hex");
  const textureInputs = row.querySelector(".texture-inputs");

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

function buildClientFromCard(card, index) {
  const name = card.querySelector(".client-name").value.trim() || `Client ${index + 1}`;
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
    boatInfo,
    variantGroups,
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

  const { defaultModel, basePrice, sidebarInfo } = collectGeneralSettings();
  const firstClient = clients[0];
<<<<<<< HEAD
  const output = `export const DEFAULT_MODEL = ${JSON.stringify(defaultModel)};
export const BASE_PRICE = ${basePrice};
=======
  const output = `export const BASE_PRICE = ${BASE_PRICE};
>>>>>>> parent of b0360b2 (admin)
export const BOAT_INFO = ${JSON.stringify(firstClient.boatInfo, null, 2)};
export const VARIANT_GROUPS = ${JSON.stringify(firstClient.variantGroups, null, 2)};
export const SIDEBAR_INFO = ${JSON.stringify(SIDEBAR_INFO, null, 2)};
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

<<<<<<< HEAD
const initialClients =
  Array.isArray(CLIENTS) && CLIENTS.length
    ? CLIENTS
    : [
        {
          name: "Client 1",
          boatInfo: structuredClone(BOAT_INFO),
          variantGroups: structuredClone(VARIANT_GROUPS),
        },
      ];

initialClients.forEach(client =>
  addClientForm({
    name: client.name,
    boatInfo: structuredClone(client.boatInfo ?? BOAT_INFO),
    variantGroups: structuredClone(client.variantGroups ?? VARIANT_GROUPS),
  }),
);

function createGeneralSettingsSection() {
  generalSettingsState.sidebarInputs.clear();
  const section = document.createElement("div");
  section.className = "section general-settings";

  const globalCard = document.createElement("section");
  globalCard.className = "panel-card";
  globalCard.innerHTML = `
    <div class="panel-head">
      <div>
        <p class="eyebrow">Global config</p>
        <h3>Engine defaults</h3>
        <p class="panel-description">These values are shared across every client inside the WebGL configurator.</p>
      </div>
    </div>
  `;

  const settingsGrid = document.createElement("div");
  settingsGrid.className = "form-grid two";

  const defaultModelField = document.createElement("label");
  defaultModelField.className = "form-field";
  defaultModelField.innerHTML = `<span>Default GLB model</span>`;
  const defaultModelInput = document.createElement("input");
  defaultModelInput.type = "text";
  defaultModelInput.placeholder = "assets/boat.glb";
  defaultModelInput.value = DEFAULT_MODEL ?? "";
  defaultModelField.appendChild(defaultModelInput);

  const basePriceField = document.createElement("label");
  basePriceField.className = "form-field";
  basePriceField.innerHTML = `<span>Base price (EUR)</span>`;
  const basePriceInput = document.createElement("input");
  basePriceInput.type = "number";
  basePriceInput.min = "0";
  basePriceInput.step = "100";
  basePriceInput.value = Number(BASE_PRICE ?? 0);
  basePriceField.appendChild(basePriceInput);

  settingsGrid.appendChild(defaultModelField);
  settingsGrid.appendChild(basePriceField);
  globalCard.appendChild(settingsGrid);

  section.appendChild(globalCard);

  const sidebarCard = document.createElement("section");
  sidebarCard.className = "panel-card";
  sidebarCard.innerHTML = `
    <div class="panel-head">
      <div>
        <p class="eyebrow">Configurator sidebar</p>
        <h3>Information panels</h3>
        <p class="panel-description">Update the copy that appears inside the Help, About, Settings, and Contact tabs.</p>
      </div>
    </div>
  `;

  const sidebarContainer = document.createElement("div");
  sidebarContainer.className = "sidebar-editors";
  const sidebarEntries =
    SIDEBAR_INFO && typeof SIDEBAR_INFO === "object" && !Array.isArray(SIDEBAR_INFO)
      ? Object.entries(SIDEBAR_INFO)
      : [["about", ""]];

  sidebarEntries.forEach(([key, value]) => {
    const label = document.createElement("label");
    label.className = "form-field";
    label.innerHTML = `<span>${formatSidebarLabel(key)}</span>`;
    const textarea = document.createElement("textarea");
    textarea.rows = 6;
    textarea.value = value ?? "";
    textarea.dataset.sidebarKey = key;
    label.appendChild(textarea);
    sidebarContainer.appendChild(label);
    generalSettingsState.sidebarInputs.set(key, textarea);
  });

  sidebarCard.appendChild(sidebarContainer);
  section.appendChild(sidebarCard);

  generalSettingsState.defaultModelInput = defaultModelInput;
  generalSettingsState.basePriceInput = basePriceInput;

  return section;
}

function collectGeneralSettings() {
  const defaultModel = generalSettingsState.defaultModelInput?.value.trim() || DEFAULT_MODEL || "";
  const parsedBase = parseFloat(generalSettingsState.basePriceInput?.value ?? "");
  const basePrice = Number.isFinite(parsedBase) && parsedBase >= 0 ? parsedBase : Number(BASE_PRICE) || 0;
  const sidebarInfo = {};

  if (generalSettingsState.sidebarInputs.size) {
    generalSettingsState.sidebarInputs.forEach((textarea, key) => {
      sidebarInfo[key] = textarea.value;
    });
  } else if (SIDEBAR_INFO && typeof SIDEBAR_INFO === "object") {
    Object.assign(sidebarInfo, SIDEBAR_INFO);
  }

  return { defaultModel, basePrice, sidebarInfo };
}

function formatSidebarLabel(key = "") {
  return key
    .toString()
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, char => char.toUpperCase());
}
=======
addClientForm({
  name: "Client 1",
  boatInfo: structuredClone(BOAT_INFO),
  variantGroups: structuredClone(VARIANT_GROUPS),
});
>>>>>>> parent of b0360b2 (admin)
