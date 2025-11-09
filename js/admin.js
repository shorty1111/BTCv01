import { BOAT_INFO, VARIANT_GROUPS, SIDEBAR_INFO, BASE_PRICE } from "./config.js";

// === Glavni kontejner iz HTML-a ===
const app = document.createElement("div");
app.id = "app";
const mainContent = document.getElementById("mainContent");
mainContent.innerHTML = ""; // očisti prethodni sadržaj
mainContent.appendChild(app);

/* === Clients Section === */
const clientsSection = document.createElement("div");
clientsSection.className = "section";

const title = document.createElement("h2");
title.textContent = "Clients";

const clientsContainer = document.createElement("div");
clientsContainer.id = "clientsContainer";

clientsSection.appendChild(title);
clientsSection.appendChild(clientsContainer);
app.appendChild(clientsSection);

/* === Tabs Navigation === */
const tabsBar = document.createElement("div");
tabsBar.className = "clients-nav";
clientsSection.insertBefore(tabsBar, clientsContainer);

/* === Add Client Button === */
document.getElementById("addClientBtn").onclick = () => addClientForm();

/* === Refresh Tabs === */
function refreshTabs() {
  tabsBar.innerHTML = "";
  const cards = document.querySelectorAll(".client-card");

  cards.forEach((card, idx) => {
    const name = card.querySelector(".client-name").value || `Client ${idx + 1}`;
    const btn = document.createElement("button");
    btn.textContent = name;
    btn.onclick = () => {
      document.querySelectorAll(".client-body").forEach(b => (b.style.display = "none"));
      document.querySelectorAll(".client-card .toggleBtn").forEach(t => (t.textContent = "▼"));
      card.querySelector(".client-body").style.display = "block";
      card.querySelector(".toggleBtn").textContent = "▲";
      tabsBar.querySelectorAll("button").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
    };
    tabsBar.appendChild(btn);
  });
}

/* === Sidebar Clients === */
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
      document.querySelectorAll(".client-body").forEach(b => (b.style.display = "none"));
      document.querySelectorAll(".toggleBtn").forEach(t => (t.textContent = "▼"));
      const cardBody = card.querySelector(".client-body");
      cardBody.style.display = "block";
      card.querySelector(".toggleBtn").textContent = "▲";
    };
    list.appendChild(item);
  });
}

/* === Add Client Form === */
function addClientForm(data = {}) {
  const clientDiv = document.createElement("div");
  clientDiv.className = "client-card";

  // Header
  clientDiv.innerHTML = `
    <div class="client-header">
      <div class="client-header-left">
        <input type="text" placeholder="Client Name" value="${
          data.name ?? "Client " + (clientsContainer.children.length + 1)
        }" class="client-name">
      </div>
      <div class="client-header-right">
        <button class="toggleBtn">▼</button>
        <button class="removeBtn">✖</button>
      </div>
    </div>
  `;

  const body = document.createElement("div");
  body.className = "client-body";
  body.style.display = "none";

  // === Boat Info ===
  const boatDiv = document.createElement("div");
  boatDiv.className = "section inner";
  boatDiv.innerHTML = `<h3>Boat Info</h3>`;
  for (const [k, v] of Object.entries(BOAT_INFO)) {
    const val = data.name ? v : "";
    boatDiv.innerHTML += `
      <label>${k}</label>
      <input type="text" data-key="${k}" value="${val}">
    `;
  }

  // === Variant Groups ===
  const variantsDiv = document.createElement("div");
  variantsDiv.className = "section inner";
  variantsDiv.innerHTML = `<h3>Variant Groups</h3>`;

  for (const [groupName, group] of Object.entries(VARIANT_GROUPS)) {
    const g = document.createElement("div");
    g.className = "group";
    g.innerHTML = `<h3>${groupName}</h3>`;

    for (const [partName, part] of Object.entries(group)) {
      const p = document.createElement("div");
      p.className = "part";
      p.innerHTML = `<h4>${partName}</h4>`;

      part.models.forEach((m, i) => {
        const valName = data.name ? m.name : "";
        const valSrc = data.name ? m.src ?? "" : "";
        const valPrice = data.name ? m.price ?? "" : "";
        const valDesc = data.name ? m.description ?? "" : "";

        const box = document.createElement("div");
        box.className = "model";
        box.innerHTML = `
          <input type="text" data-group="${groupName}" data-part="${partName}" data-idx="${i}" data-field="name" value="${valName}" placeholder="Name">
          <input type="text" data-group="${groupName}" data-part="${partName}" data-idx="${i}" data-field="src" value="${valSrc}" placeholder="Model src">
          <input type="number" data-group="${groupName}" data-part="${partName}" data-idx="${i}" data-field="price" value="${valPrice}" placeholder="Price">
          <textarea data-group="${groupName}" data-part="${partName}" data-idx="${i}" data-field="description" placeholder="Description">${valDesc}</textarea>
        `;
        p.appendChild(box);
      });
      g.appendChild(p);
    }
    variantsDiv.appendChild(g);
  }

  body.appendChild(boatDiv);
  body.appendChild(variantsDiv);
  clientDiv.appendChild(body);
  clientsContainer.appendChild(clientDiv);

  const toggleBtn = clientDiv.querySelector(".toggleBtn");
  const removeBtn = clientDiv.querySelector(".removeBtn");
  const nameInput = clientDiv.querySelector(".client-name");

  // === Event handling ===
  toggleBtn.onclick = () => {
    const isOpen = body.style.display === "block";
    body.style.display = isOpen ? "none" : "block";
    toggleBtn.textContent = isOpen ? "▼" : "▲";
  };

  removeBtn.onclick = () => {
    clientDiv.remove();
    refreshTabs();
    renderSidebarClients();
  };

  // ⬇️ NEW — realtime ime update
  nameInput.addEventListener("input", () => {
    refreshTabs();
    renderSidebarClients();
  });

  // auto open first client
  if (clientsContainer.children.length === 1) {
    body.style.display = "block";
    toggleBtn.textContent = "▲";
  }

  refreshTabs();
  renderSidebarClients();
}

/* === Auto-create first client === */
addClientForm({ name: "Client 1" });

/* === Save Button === */
document.getElementById("saveBtn").onclick = () => {
  const newBoat = { ...BOAT_INFO };
  document.querySelectorAll('input[data-section="boat"]').forEach(i => {
    newBoat[i.dataset.key] = i.value;
  });

  const newVariants = structuredClone(VARIANT_GROUPS);
  document.querySelectorAll("[data-field]").forEach(el => {
    const { group, part, idx, field } = el.dataset;
    if (group && part && idx && field)
      newVariants[group][part].models[idx][field] = el.value;
  });

  const clients = [];
  document.querySelectorAll(".client-card").forEach(c => {
    clients.push({
      name: c.querySelector(".client-name").value,
      model: c.querySelectorAll("input")[1]?.value || "",
      texture: c.querySelectorAll("input")[2]?.value || "",
      variants: c.querySelector("textarea")?.value || "",
    });
  });

  const output = `export const BASE_PRICE = ${BASE_PRICE};
export const BOAT_INFO = ${JSON.stringify(newBoat, null, 2)};
export const VARIANT_GROUPS = ${JSON.stringify(newVariants, null, 2)};
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
};
