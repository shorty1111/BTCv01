import { v3, look, persp, ortho } from "./math.js";

export function initCamera(canvas) {
  // === TOUCH KONTROLE ===
  let touchDragging = false;
  let touchLastX = 0, touchLastY = 0;
  let pinchLastDist = null;
  let touchPanLastMid = null;

  let currentView = "iso";
  let rx = 0, ry = 0, dist = 5;

  let pan = [0, 0, 0];
  let rxTarget = rx, ryTarget = ry, distTarget = dist;
  let useOrtho = false;
  let camWorld = [0, 0, 0];
  let view = new Float32Array(16);

  // === ✅ POČETNI UGAO I VISINA — KAO U STAROM main.js ===
  rx = rxTarget = Math.PI / 10;   // ~18° nagib iznad horizonta
  ry = ryTarget = Math.PI / 20;   // blagi yaw
  dist = distTarget = 5;          // inicijalna udaljenost

  // === ANIMACIJA KAMERE ===
  function animateCamera() {
    const minRx = 0.025;
    const maxRx = Math.PI / 2 - 0.01;
    rxTarget = Math.max(minRx, Math.min(maxRx, rxTarget));
    if (rxTarget > maxRx) rxTarget += (maxRx - rxTarget) * 0.25;
    rx += (rxTarget - rx) * 0.16;
    ry += (ryTarget - ry) * 0.16;

    const fovY = Math.PI / 4;
    let minDistDynamic =
      ((window.currentBoundingRadius || window.sceneBoundingRadius || 1.5) /
        Math.tan(fovY / 2)) *
      0.3;
    let maxDistDynamic =
      (window.currentBoundingRadius || window.sceneBoundingRadius || 5) * 10.0;

    if (distTarget < minDistDynamic)
      distTarget += (minDistDynamic - distTarget) * 0.2;
    if (distTarget > maxDistDynamic)
      distTarget += (maxDistDynamic - distTarget) * 0.2;

    dist += (distTarget - dist) * 0.14;
  }

  // === VIEW MATRICA ===
  function updateView() {
    const aspect = canvas.width / canvas.height;
    const proj = persp(60, aspect, 0.1, 100000);

    if (useOrtho) {
      rx = 0;
      ry = 0;
      dist = 1;

      const radius = window.sceneBoundingRadius || 5;
      const size = radius * 0.8;
      const d = radius * 1.5;

      let eye, up;
      switch (currentView) {
        case "front": eye = [0, size * 0.3, d]; up = [0, 1, 0]; break;
        case "back":  eye = [0, size * 0.3, -d]; up = [0, 1, 0]; break;
        case "left":  eye = [-d, size * 0.3, 0]; up = [0, 1, 0]; break;
        case "right": eye = [d, size * 0.3, 0]; up = [0, 1, 0]; break;
        case "top":   eye = [0, d, 0]; up = [0, 0, -1]; break;
        default:      eye = [d, d, d]; up = [0, 1, 0]; break;
      }

      view.set(look(eye, pan, up));
      camWorld = eye.slice();
    } else {
      const eye = [
        dist * Math.cos(rx) * Math.sin(ry) + pan[0],
        dist * Math.sin(rx) + pan[1],
        dist * Math.cos(rx) * Math.cos(ry) + pan[2],
      ];
      view.set(look(eye, pan, [0, 1, 0]));
      camWorld = eye.slice();
    }

    return { proj, view, camWorld };
  }

  // === MOUSE & TOUCH ===
  canvas.addEventListener("mousemove", (e) => {
    if (e.buttons === 1) {
      ryTarget += e.movementX * 0.001;
      rxTarget += e.movementY * 0.005;
    } else if (e.buttons === 4) {
      const panSpeed = 0.001 * dist;
      const eye = [
        dist * Math.cos(rx) * Math.sin(ry) + pan[0],
        dist * Math.sin(rx) + pan[1],
        dist * Math.cos(rx) * Math.cos(ry) + pan[2],
      ];
      const target = pan;
      const viewDir = v3.norm(v3.sub(target, eye));
      const right = v3.norm(v3.cross([0, 1, 0], viewDir));
      const up = v3.cross(viewDir, right);
      pan[0] += (e.movementX * right[0] + e.movementY * up[0]) * panSpeed;
      pan[1] += (e.movementX * right[1] + e.movementY * up[1]) * panSpeed;
      pan[2] += (e.movementX * right[2] + e.movementY * up[2]) * panSpeed;
      updateView();
    }
  });

  canvas.addEventListener("wheel", (e) => {
    distTarget += e.deltaY * 0.01;
    distTarget = Math.max(0.2, distTarget);
    updateView();
  }, { passive: true });

  // === TOUCH ===
  canvas.addEventListener("touchstart", (e) => {
    if (e.touches.length === 1) {
      touchDragging = true;
      touchLastX = e.touches[0].clientX;
      touchLastY = e.touches[0].clientY;
    }
    if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      pinchLastDist = Math.sqrt(dx * dx + dy * dy);
      touchPanLastMid = {
        x: (e.touches[0].clientX + e.touches[1].clientX) * 0.5,
        y: (e.touches[0].clientY + e.touches[1].clientY) * 0.5,
      };
    }
    e.preventDefault();
  }, { passive: false });

canvas.addEventListener("touchmove", (e) => {
  if (e.touches.length === 1 && touchDragging) {
    const dx = e.touches[0].clientX - touchLastX;
    const dy = e.touches[0].clientY - touchLastY;
    ryTarget += dx * 0.003;
    rxTarget += dy * 0.005;
    touchLastX = e.touches[0].clientX;
    touchLastY = e.touches[0].clientY;
  }

  if (e.touches.length === 2) {
    // --- ZOOM ---
    const dx = e.touches[0].clientX - e.touches[1].clientX;
    const dy = e.touches[0].clientY - e.touches[1].clientY;
    const distNow = Math.sqrt(dx * dx + dy * dy);
    if (pinchLastDist !== null) {
      const delta = pinchLastDist - distNow;
      distTarget += delta * 0.01;
    }
    pinchLastDist = distNow;

    // --- PAN (dodaj ovo) ---
    const midX = (e.touches[0].clientX + e.touches[1].clientX) * 0.5;
    const midY = (e.touches[0].clientY + e.touches[1].clientY) * 0.5;
    if (touchPanLastMid) {
      const dmx = midX - touchPanLastMid.x;
      const dmy = midY - touchPanLastMid.y;
      const panSpeed = 0.002 * dist;
      const eye = [
        dist * Math.cos(rx) * Math.sin(ry) + pan[0],
        dist * Math.sin(rx) + pan[1],
        dist * Math.cos(rx) * Math.cos(ry) + pan[2],
      ];
      const viewDir = v3.norm(v3.sub(pan, eye));
      const right = v3.norm(v3.cross([0, 1, 0], viewDir));
      const up = v3.cross(viewDir, right);
        pan[0] += (dmx * right[0] + dmy * up[0]) * panSpeed;
        pan[1] += (dmx * right[1] + dmy * up[1]) * panSpeed;
        pan[2] += (dmx * right[2] + dmy * up[2]) * panSpeed;

    }
    touchPanLastMid = { x: midX, y: midY };
  }

  e.preventDefault();
}, { passive: false });

  canvas.addEventListener("touchend", (e) => {
    if (e.touches.length === 0) {
      touchDragging = false;
      pinchLastDist = null;
      touchPanLastMid = null;
    }
    e.preventDefault();
  }, { passive: false });

  // === RETURN API ===
  return {
    animateCamera,
    updateView,
    get camWorld() { return camWorld; },
    get pan() { return pan; },
    set pan(v) { pan = v; },
    get useOrtho() { return useOrtho; },
    set useOrtho(v) { useOrtho = v; },
    get currentView() { return currentView; },
    set currentView(v) { currentView = v; },
    get rx() { return rx; },
    set rx(v) { rx = v; },
    get ry() { return ry; },
    set ry(v) { ry = v; },
    get rxTarget() { return rxTarget; },
    set rxTarget(v) { rxTarget = v; },
    get ryTarget() { return ryTarget; },
    set ryTarget(v) { ryTarget = v; },
    get dist() { return dist; },
    set dist(v) { dist = v; },
    get distTarget() { return distTarget; },
    set distTarget(v) { distTarget = v; },
  };
}
