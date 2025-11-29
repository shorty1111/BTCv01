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
  let panTarget = pan.slice();
  let rxTarget = rx, ryTarget = ry, distTarget = dist;
  let useOrtho = false;
  let camWorld = [0, 0, 0];
  let view = new Float32Array(16);
  const BASE_NEAR = 0.1;
  const MIN_FAR = 500.0;

  function computeFarPlane(currentDist) {
    const sceneRadius = window.sceneBoundingRadius || 50.0;
    const waterRadius = window.waterRadius || 0.0;
    const maxRadius = Math.max(sceneRadius, waterRadius, currentDist || 0);
    const margin = 200.0;
    return Math.max(MIN_FAR, maxRadius * 4.0 + margin);
  }
  let lastRx = rx, lastRy = ry, lastDist = dist;
  let lastPan = pan.slice();
  let moved = false;
  let viewUpdateQueued = false;
  // === ✅ POČETNI UGAO I VISINA — KAO U STAROM main.js ===
  rx = rxTarget = Math.PI / 10;   // ~18° nagib iznad horizonta
  ry = ryTarget = Math.PI / 20;   // blagi yaw
  dist = distTarget = 5;          // inicijalna udaljenost
  const initialState = {
    pan: pan.slice(),
    dist,
    rx,
    ry,
  };

  // === ANIMACIJA KAMERE ===
  function animateCamera() {
    const minRx = 0.025;
    const maxRx = Math.PI / 2 - 0.01;
    const clampedRx = Math.max(minRx, Math.min(maxRx, rxTarget));
    if (Math.abs(clampedRx - rxTarget) > 1e-4) {
      rxTarget = clampedRx + (rxTarget - clampedRx) * 0.2;
    }
    rx += (rxTarget - rx) * 0.16;
    ry += (ryTarget - ry) * 0.16;

    const fovY = Math.PI / 4;
    let minDistDynamic =
      ((window.currentBoundingRadius || window.sceneBoundingRadius || 1.5) /
        Math.tan(fovY / 2)) *
      0.3;
    let maxDistDynamic =
      (window.currentBoundingRadius || window.sceneBoundingRadius || 5) * 10.0;

    distTarget = Math.min(Math.max(distTarget, minDistDynamic), maxDistDynamic);

    dist += (distTarget - dist) * 0.14;

    const panLerp = 0.14;
    pan[0] += (panTarget[0] - pan[0]) * panLerp;
    pan[1] += (panTarget[1] - pan[1]) * panLerp;
    pan[2] += (panTarget[2] - pan[2]) * panLerp;
    // 🔹 detekcija pomeranja kamere
    if (
      Math.abs(rx - lastRx) > 1e-5 ||
      Math.abs(ry - lastRy) > 1e-5 ||
      Math.abs(dist - lastDist) > 1e-5 ||
      Math.abs(pan[0] - lastPan[0]) > 1e-5 ||
      Math.abs(pan[1] - lastPan[1]) > 1e-5 ||
      Math.abs(pan[2] - lastPan[2]) > 1e-5
    ) {
      moved = true;
      lastRx = rx;
      lastRy = ry;
      lastDist = dist;
      lastPan = pan.slice();
    } else {
      moved = false;
    }
  }

  // === VIEW MATRICA ===
  function updateView() {
    const aspect = canvas.width / canvas.height;
    const perspNear = BASE_NEAR;
    const perspFar = computeFarPlane(dist);
    let proj = persp(60, aspect, perspNear, perspFar);
    let near = perspNear;
    let far = perspFar;
    window.currentNear = near;
    window.currentFar = far;
    const target = pan;

    if (useOrtho) {
      const center = target || window.sceneBoundingCenter || [0, 0, 0];
      const d = window.sceneFitDistance || distTarget || dist || 10.0;
      let eye, up;

      switch (currentView) {
        case "front":
          eye = [center[0], center[1], center[2] + d];
          up = [0, 1, 0];
          break;
        case "back":
          eye = [center[0], center[1], center[2] - d];
          up = [0, 1, 0];
          break;
        case "left":
          eye = [center[0] - d, center[1], center[2]];
          up = [0, 1, 0];
          break;
        case "right":
          eye = [center[0] + d, center[1], center[2]];
          up = [0, 1, 0];
          break;
        case "top":
          eye = [center[0], center[1] + d, center[2]];
          up = [0, 0, -1];
          break;
        default:
          eye = [center[0] + d, center[1] + d, center[2] + d];
          up = [0, 1, 0];
          break;
      }

      const margin = 1.2; // 20% margine
      const minB = window.boatMin || window.sceneBoundingMin || [center[0] - 1, center[1] - 1, center[2] - 1];
      const maxB = window.boatMax || window.sceneBoundingMax || [center[0] + 1, center[1] + 1, center[2] + 1];
      const size = [
        maxB[0] - minB[0],
        maxB[1] - minB[1],
        maxB[2] - minB[2],
      ];

      let projWidth = size[0];
      let projHeight = size[1];
      switch (currentView) {
        case "front":
        case "back":
          projWidth = size[0]; // X span
          projHeight = size[1]; // Y span
          break;
        case "left":
        case "right":
          projWidth = size[2]; // Z span
          projHeight = size[1]; // Y span
          break;
        case "top":
          projWidth = size[0]; // X span
          projHeight = size[2]; // Z span
          break;
        default:
          projWidth = projHeight = Math.max(size[0], size[1], size[2]);
          break;
      }

      const needHalfHeight = (projHeight * 0.5) * margin;
      const needHalfHeightFromWidth = ((projWidth * 0.5) * margin) / Math.max(aspect, 0.001);
      const halfHeight = Math.max(needHalfHeight, needHalfHeightFromWidth, 0.5);
      const halfWidth = halfHeight * aspect;
      const depth = computeFarPlane(d);
      const nearOrtho = 0.1; // pozitivan near za pravilnu linearizaciju
      const farOrtho = depth * 2.0;
      proj = ortho(-halfWidth, halfWidth, -halfHeight, halfHeight, nearOrtho, farOrtho);
      near = nearOrtho;
      far = farOrtho;
      window.currentNear = near;
      window.currentFar = far;

      view.set(look(eye, center, up));
      camWorld = eye.slice();
    } else {
      const eye = [
        dist * Math.cos(rx) * Math.sin(ry) + pan[0],
        dist * Math.sin(rx) + pan[1],
        dist * Math.cos(rx) * Math.cos(ry) + pan[2],
      ];
      view.set(look(eye, target, [0, 1, 0]));
      camWorld = eye.slice();
    }

    return { proj, view, camWorld, near, far };
    
  
  }
  function scheduleViewUpdate() {
    if (viewUpdateQueued) return;
    viewUpdateQueued = true;
    requestAnimationFrame(() => {
      viewUpdateQueued = false;
      updateView();
    });
  }
    // === AUTO-FIT KAMERE NA SCENU ===
    function fitToBoundingBox(bmin, bmax) {
      // centar i veličina
      const center = [
        (bmin[0] + bmax[0]) * 0.5,
        (bmin[1] + bmax[1]) * 0.5,
        (bmin[2] + bmax[2]) * 0.5,
      ];
      const size = [
        bmax[0] - bmin[0],
        bmax[1] - bmin[1],
        bmax[2] - bmin[2],
      ];
      window.sceneBoundingCenter = center;
      window.sceneBoundingRadius = Math.max(size[0], size[1], size[2]) * 0.5;

      // projekcija koja garantuje isti “zoom” za sve veličine
      const fovY = Math.PI / 4;               // 45°
      const aspect = canvas.width / canvas.height;
      const fill = 1.1;                       // model zauzima 70% visine ekrana
      // udaljenost mora da pokrije najveću od: visina, širina/aspect
      const halfHeight = size[1] * 0.5 / fill;
      const halfWidth  = (size[0] * 0.5 / fill) / aspect;
      const halfDepth  = size[2] * 0.5 / fill;
      const halfMax = Math.max(halfHeight, halfWidth, halfDepth);
      const distFit = halfMax / Math.tan(fovY * 0.5);
      pan = center.slice();
      panTarget = center.slice();
      dist = distTarget = distFit;
      window.sceneFitDistance = distFit; // zapamti distancu
    }

  // === MOUSE & TOUCH ===
  canvas.addEventListener("mousemove", (e) => {
    if (e.buttons === 1) {
      ryTarget -= e.movementX * 0.0025; // brža rotacija yaw
      rxTarget += e.movementY * 0.006;  // i pitch malo brže
    } else if (e.buttons === 4) {
      // ubrzaj pan pomeranjem po ekranu (viša vrednost = brži pan)
      const panSpeed = (dist / Math.max(canvas.width, canvas.height)) * 2.0;
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
      panTarget = pan.slice();
      scheduleViewUpdate();
    }
  });

  canvas.addEventListener("wheel", (e) => {
    distTarget += e.deltaY * 0.01;
    distTarget = Math.max(0.2, distTarget);
    scheduleViewUpdate();
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
    if (e.cancelable) e.preventDefault();
  }, { passive: false });

canvas.addEventListener("touchmove", (e) => {
    // ❗ FIX: Ako si pincha'o i ostao 1 prst, NIKAKO nemoj da rotiraš
  if (e.touches.length === 1 && pinchLastDist !== null) {
    touchDragging = false;
    pinchLastDist = null;
    return;
  }
  if (e.touches.length === 1 && touchDragging) {
    const dx = e.touches[0].clientX - touchLastX;
    const dy = e.touches[0].clientY - touchLastY;
    ryTarget -= dx * 0.005; // brža yaw za touch
    rxTarget += dy * 0.007; // brža pitch za touch
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
      const panSpeed = (dist / Math.max(canvas.width, canvas.height)) * 3.0;
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
        panTarget = pan.slice();

    }
    touchPanLastMid = { x: midX, y: midY };
  }

  if (e.cancelable) e.preventDefault();
}, { passive: false });

canvas.addEventListener("touchend", (e) => {
    if (e.touches.length === 0) {
      touchDragging = false;
      pinchLastDist = null;
      touchPanLastMid = null;
    }
    if (e.touches.length === 1) {
      // ❗ Ako si iz pinch zoom-a izašao u jedan prst → blokiraj rotate
      touchDragging = false;
      pinchLastDist = null;
    }
    if (e.cancelable) e.preventDefault();
}, { passive: false });


  function resetCamera({ useSceneBounds = true } = {}) {
    const target =
      (useSceneBounds && window.sceneBoundingCenter && window.sceneBoundingCenter.slice()) ||
      initialState.pan.slice();
    const newDist =
      (useSceneBounds && window.sceneFitDistance) || initialState.dist;

    pan = target.slice();
    panTarget = target.slice();
    dist = distTarget = newDist;
    rx = rxTarget = initialState.rx;
    ry = ryTarget = initialState.ry;
  }

  // === RETURN API ===
  return {
    animateCamera,
    updateView,
    fitToBoundingBox,
    get camWorld() { return camWorld; },
    get pan() { return pan; },
    set pan(v) {
      pan = v ? v.slice() : [0, 0, 0];
      panTarget = pan.slice();
    },
    get panTarget() { return panTarget; },
    set panTarget(v) { panTarget = v ? v.slice() : panTarget; },
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
    get moved() { return moved; },
    set moved(v) { moved = v; },
    reset: resetCamera,
  };
}
