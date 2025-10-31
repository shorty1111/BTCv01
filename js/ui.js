export function renderBoatInfo(infoObj) {
  const container = document.getElementById("boat-info");
  container.innerHTML = `
    <h3>Informacije o brodu</h3>
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
function buildVariantSidebar() {
  const sidebar = document.getElementById("variantSidebar");
  sidebar.innerHTML = "";

  const intro = document.createElement("div");
  intro.className = "variant-intro";
  intro.innerHTML = `
    <h2>Customize Your Boat</h2>
    <p>Select materials, colors, and parts to create a configuration that matches your vision.</p>
  `;
  sidebar.insertBefore(intro, sidebar.firstChild);

  for (const [groupName, parts] of Object.entries(VARIANT_GROUPS)) {
    const groupDiv = document.createElement("div");
    groupDiv.className = "variant-group";

    const header = document.createElement("h3");
    header.textContent = groupName;
    header.addEventListener("click", () => {
      document.querySelectorAll(".variant-group").forEach((g) => {
        if (g !== groupDiv) g.classList.remove("open");
      });
      groupDiv.classList.toggle("open");
    });

    groupDiv.appendChild(header);
    const itemsDiv = document.createElement("div");
    itemsDiv.className = "variant-items";

    for (const [partKey, data] of Object.entries(parts)) {
      const variants = data.models;

      variants.forEach((variant) => {
        const itemEl = document.createElement("div");
        itemEl.className = "variant-item";
        itemEl.dataset.part = partKey;
        itemEl.dataset.variant = variant.name;

        const thumbWrapper = document.createElement("div");
        thumbWrapper.className = "thumb-wrapper";

        const preview = document.createElement("img");
        preview.src =
          thumbnails?.[partKey]?.[variant.name] || "assets/part_placeholder.png";
        preview.className = "thumb";
        thumbWrapper.appendChild(preview);


        const label = document.createElement("div");
        label.className = "title";
        label.textContent = variant.name;
        thumbWrapper.appendChild(label);


        itemEl.appendChild(thumbWrapper);

        const body = document.createElement("div");
        body.className = "variant-body";

        if (variant.colors && variant.colors.length > 0) {
          const colorsDiv = document.createElement("div");
          colorsDiv.className = "colors";
          variant.colors.forEach((c) => {
            const colorEl = document.createElement("div");
            colorEl.className = "color-swatch";

            if (c.type === "texture" && c.texture) {
              colorEl.style.backgroundImage = `url(${c.texture})`;
              colorEl.style.backgroundSize = "cover";
            } else if (c.type === "color" && c.color) {
              colorEl.style.backgroundColor = `rgb(${c.color.map(v => v * 255).join(",")})`;
            }
            colorEl.title = c.name;
            colorEl.addEventListener("click", (e) => {
              e.stopPropagation();
              const card = colorEl.closest(".variant-item");
              const partKey = card.dataset.part;
              const node = nodesMeta.find((n) => n.name === partKey);
              if (!node) return;

              // ako kartica nije aktivna, prvo je aktiviraj
              if (!card.classList.contains("active")) {
                card.click();
                return;
              }

              // primeni boju
              const cfgGroup = Object.values(VARIANT_GROUPS).find((g) => partKey in g) || {};
              const mainMat = cfgGroup[partKey]?.mainMat || "";

              if (c.type === "texture" && c.texture) {
                const img = new Image();
                img.src = c.texture;
                img.onload = () => {
                  const tex = gl.createTexture();
                  gl.bindTexture(gl.TEXTURE_2D, tex);
                  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
                  gl.generateMipmap(gl.TEXTURE_2D);
                  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
                  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
                  for (const r of node.renderIdxs) {
                    if (!mainMat || r.matName === mainMat) modelBaseTextures[r.idx] = tex;
                  }
                  render();
                };
              } else if (c.type === "color" && c.color) {
                  for (const r of node.renderIdxs) {
                    if (mainMat && r.matName === mainMat) {
                      modelBaseColors[r.idx] = new Float32Array(c.color);
                      modelBaseTextures[r.idx] = null;
                    } else if (!mainMat && r === node.renderIdxs[0]) {
                      modelBaseColors[r.idx] = new Float32Array(c.color);
                      modelBaseTextures[r.idx] = null;
                    }
                  }
                }

              // zapamti varijantu i boju
              currentParts[partKey] = { ...variant, selectedColor: c.name };

              updatePartsTable(partKey, `${variant.name} (${c.name})`);

              // ažuriraj selekciju u UI
              colorsDiv.querySelectorAll(".color-swatch").forEach(el => el.classList.remove("selected"));
              colorEl.classList.add("selected");

              render();
              showPartInfo(`${variant.name} (${c.name})`);
            });

  colorsDiv.appendChild(colorEl);
});

        // 🔹 Nakon što su sve boje dodate, ponovo označi izabranu
        const saved = currentParts[partKey];
        if (saved && saved.selectedColor) {
          const sel = Array.from(colorsDiv.children).find(
            (el) => el.title === saved.selectedColor
          );
          if (sel) sel.classList.add("selected");
        }


          body.appendChild(colorsDiv);
        }

        itemEl.appendChild(body);

        const footer = document.createElement("div");
        footer.className = "variant-footer";
        const rawPrice = variant.price ?? 0;
        const priceText = rawPrice === 0
          ? "Included (incl. VAT)"
          : `+${rawPrice} € (incl. VAT)`;
        footer.innerHTML = `<span class="price">${priceText}</span>`;
        itemEl.appendChild(footer);
// ➕ Dodaj dugme i opis ako postoji opis u configu
if (variant.description) {
  const descBtn = document.createElement("button");
  descBtn.className = "desc-toggle";
  descBtn.textContent = "ℹ️";
  itemEl.appendChild(descBtn);

  const descEl = document.createElement("div");
  descEl.className = "variant-description";
  descEl.textContent = variant.description;
  itemEl.appendChild(descEl);
}

itemEl.addEventListener("click", (e) => {
  // ako klik potiče sa dugmeta za opis, ignoriši
  if (e.target.closest(".desc-toggle")) return;
  const isEquipmentOnly = !variant.src && !data.mainMat;
if (isEquipmentOnly) {
  // 🚫 Ako je "Included" u additional grupi → ignoriši klik
  if ((variant.price ?? 0) === 0) {
    return; // ne radi ništa
  }

  const key = variant.name;
  const alreadyActive = itemEl.classList.contains("active");

  if (alreadyActive) {
    itemEl.classList.remove("active");
    delete currentParts[key];
    const row = document.querySelector(`#partsTable tr[data-part="${key}"]`);
    if (row) row.remove();
  } else {
    itemEl.classList.add("active");
    currentParts[key] = variant;
    updatePartsTable(key, variant.name);
  }

  updateTotalPrice();
  return;
}
  const node = nodesMeta.find((n) => n.name === partKey);
  if (!node) return;

  highlightTreeSelection(node.id);
  // ⬇️ pre replaceSelectedWithURL
const prev = currentParts[partKey];
if (prev && prev.selectedColor) {
  // zapamti boju za varijantu koju napuštamo
  if (!savedColorsByPart[partKey]) savedColorsByPart[partKey] = {};
  savedColorsByPart[partKey][prev.name] = prev.selectedColor;
}
  replaceSelectedWithURL(variant.src, variant.name, partKey);
  updatePartsTable(partKey, variant.name);
  currentParts[partKey] = variant;
  itemsDiv.querySelectorAll(".variant-item").forEach((el) => el.classList.remove("active"));
  itemEl.classList.add("active");
  focusCameraOnNode(node);
  render();
  showPartInfo(variant.name);
});


   itemsDiv.appendChild(itemEl);
      });
    }

    groupDiv.appendChild(itemsDiv);
    sidebar.appendChild(groupDiv);
  }
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
  for (const [key, variant] of Object.entries(currentParts)) {
    const isAdditional = !Object.values(VARIANT_GROUPS)
      .some(g => Object.keys(g).includes(key));
    if (isAdditional) {
      const tr = document.createElement("tr");
      tr.dataset.part = variant.name;
      tr.innerHTML = `
        <td>Additional</td>
        <td>${variant.name}</td>
        <td>${variant.price === 0 ? "Included" : `+${variant.price} €`}</td>
      `;
      tbody.appendChild(tr);
    }
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

  if (!toggleBtn || !dropdown) return;

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
    // Klik na "Pročitaj opis" otvara/zatvara karticu
    document.addEventListener("click", (e) => {
    const btn = e.target.closest(".desc-toggle");
    if (!btn) return;
    const card = btn.closest(".variant-item");
    card.classList.toggle("open");
    });
  // Export PDF
  const exportBtn = document.getElementById("exportPDF");
  if (exportBtn) {
    exportBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      dropdown.classList.add("hidden");
      exportPDF();
    });
  }

  // Share konfiguracija
  const shareBtn = document.getElementById("shareConfig");
  if (shareBtn) {
    shareBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      dropdown.classList.add("hidden");
        // TODO: ovde ubaciš svoj share handler
    });
  }
    // Save konfiguracija
    const saveBtn = document.getElementById("saveConfigBtn");
    if (saveBtn) {
    saveBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        dropdown.classList.add("hidden");

        // umesto saveConfiguration() pozovi modal direktno
        const modal = document.getElementById("saveConfigModal");
        const nameInput = document.getElementById("configNameInput");
        modal.classList.remove("hidden");
        nameInput.focus();
    });
    }

}
function initSavedConfigs() {
  const container = document.getElementById("savedConfigsContainer");
  const saveBtn = document.getElementById("saveConfigBtn");

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
      <button class="saved-item" data-i="${i}">
        ${cfg.name}
        <span class="del-btn" data-i="${i}">✕</span>
      </button>
    `;
    container.appendChild(row);
  });

// klik na stavku -> load
container.querySelectorAll(".saved-item").forEach(btn => {
  btn.addEventListener("click", async (e) => {
    if (e.target.classList.contains("del-btn")) return;
    const i = parseInt(e.currentTarget.dataset.i);
    if (isNaN(i)) return;
    await loadSavedConfig(i);
  });
});

// klik na X -> delete
container.querySelectorAll(".del-btn").forEach(btn => {
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    const i = parseInt(e.currentTarget.dataset.i);
    if (isNaN(i)) return;
    const all = loadAll();
    all.splice(i, 1);
    localStorage.setItem("boatConfigs", JSON.stringify(all));
    renderSavedConfigs();
  });
});

}



// sada bez prompt-a — koristi modal iz HTML-a
function saveToLocal(name) {
  const all = loadAll();
  const data = {
    name,
    timestamp: Date.now(),
    currentParts,
    savedColorsByPart,
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

// klik na "Save Configuration" otvara modal
saveBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  nameInput.value = "";
  modal.classList.remove("hidden");
  nameInput.focus();
});

// potvrdi snimanje
confirmBtn.addEventListener("click", () => {
  const name = nameInput.value.trim() || `Config ${new Date().toLocaleString()}`;
  saveToLocal(name);
  modal.classList.add("hidden");
});

// otkaži
cancelBtn.addEventListener("click", () => {
  modal.classList.add("hidden");
});


async function loadSavedConfig(index) {
  const all = JSON.parse(localStorage.getItem("boatConfigs") || "[]");
  const cfg = all[index];
  if (!cfg) return alert("Config not found.");
  window.__suppressFocusCamera = true;
  currentParts = cfg.currentParts || {};
  savedColorsByPart = cfg.savedColorsByPart || {};
  setWeather(cfg.weather || "day");
  // reset UI selekcija
  document.querySelectorAll(".variant-item").forEach(el => el.classList.remove("active"));
  document.querySelectorAll(".color-swatch").forEach(el => el.classList.remove("selected"));
  // 1️⃣ Učitaj standardne delove
  for (const [part, variant] of Object.entries(currentParts)) {
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
      const img = new Image();
      await new Promise(res => {
        img.onload = res;
        img.src = colorData.texture;
      });
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      const node = nodesMeta.find(n => n.name === part);
      if (node) {
        for (const r of node.renderIdxs) {
          if (mainMat && r.matName === mainMat) modelBaseTextures[r.idx] = tex;
          else if (!mainMat && r === node.renderIdxs[0]) modelBaseTextures[r.idx] = tex;
        }
      }
    }
  }
}


    // selektuj u UI
    const item = document.querySelector(`.variant-item[data-part="${part}"][data-variant="${variant.name}"]`);
    if (item) {
      item.classList.add("active");
      const colors = item.querySelectorAll(".color-swatch");
      colors.forEach(sw => {
        if (sw.title === variant.selectedColor) sw.classList.add("selected");
      });
    }

    // info panel update
    showPartInfo(`${variant.name}${variant.selectedColor ? ` (${variant.selectedColor})` : ""}`);
  }

// 2️⃣ Aktiviraj ADDITIONAL (nema src, samo cena)
for (const [part, variant] of Object.entries(currentParts)) {
  if (!variant.src) {
    // označi u UI
    const addItem = document.querySelector(`.variant-item[data-variant="${variant.name}"]`);
    if (addItem) {
      addItem.classList.add("active");
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
  const buttons = document.querySelectorAll("#camera-controls button[data-weather]");
  buttons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const weather = btn.dataset.weather;
      setWeather(weather);
    });
  });
}

  document
    .querySelectorAll("#camera-controls button[data-view]")
    .forEach((btn) => {
  btn.addEventListener("click", () => {
  const viewName = btn.getAttribute("data-view");
  camera.currentView = viewName;

  if (viewName === "iso") {
    camera.useOrtho = false;
    const targetRx = Math.PI / 10;
    const targetRy = Math.PI / 20;
    camera.rx = camera.rxTarget = targetRx;
    camera.ry = camera.ryTarget = targetRy;
    camera.pan = window.sceneBoundingCenter.slice();
    camera.dist = camera.distTarget = (window.sceneBoundingRadius || 1) * 1.5;
  } else {
    camera.useOrtho = true;
    camera.rx = 0;
    camera.ry = 0;
    camera.dist = 1;
  }
  ({ proj, view, camWorld } = camera.updateView());
  render();
});

  });

  const input = document.getElementById("glbInput");
  const loadingScr = document.getElementById("loading-screen");
  const toggleDimsBtn = document.getElementById("toggleDims");
  toggleDimsBtn.innerText = "Show Ruler"; // početni tekst
  
  toggleDimsBtn.addEventListener("click", () => {
    showDimensions = !showDimensions;
    toggleDimsBtn.innerText = showDimensions ? "Hide Ruler" : "Show Ruler";
  
    const lbl = document.getElementById("lengthLabel");
    if (lbl) lbl.style.display = showDimensions ? "block" : "none";
  });
  const toggleWaterBtn = document.getElementById("toggleWater");
  toggleWaterBtn.innerText = "Studio"; // odmah prikaži tekst jer je voda aktivna
  
  toggleWaterBtn.addEventListener("click", () => {
    showWater = !showWater;
    toggleWaterBtn.innerText = showWater ? "Studio" : "Env";
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
window.addEventListener("DOMContentLoaded", () => {
  const header = document.querySelector(".header-left");
  const toggle = document.getElementById("menuToggle");

  if (!header || !toggle) return; // ako se ne nađu, ne radi ništa

 header.classList.add("show-tooltip");
  toggle.addEventListener("click", () => {
    header.classList.remove("show-tooltip");
    localStorage.setItem("boatTooltipSeen", "1");
  });
});

input.addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  showLoading();

  const buf = await file.arrayBuffer();

 await loadGLB(buf);  // čeka i model i teksture
hideLoading();        // sad sigurno sve gotovo
render();             // sad tek nacrtaj prvi frame

  input.value = ""; 
});

export function initUI(ctx) {
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
  const currentParts = window.currentParts;

  initDropdown();
  initSavedConfigs();
  initWeatherButtons();
  buildVariantSidebar();
  buildPartsTable();
  updateTotalPrice();
  renderBoatInfo(BOAT_INFO);
}

export { updateTotalPrice, showPartInfo };