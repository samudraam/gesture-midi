// =====================================
// DRUM ENGINE (persistent; gated by mute flags)
// =====================================
const kick = new Tone.MembraneSynth().toDestination();
const closedHihat = new Tone.NoiseSynth({
  noise: { type: "white" },
  envelope: { attack: 0.001, decay: 0.05, sustain: 0.001, release: 0.01 },
}).toDestination();
const openHihat = new Tone.NoiseSynth({
  noise: { type: "white" },
  envelope: { attack: 0.0001, decay: 0.2, sustain: 0.1, release: 0.3 },
}).toDestination();

let kickSteps = new Array(16).fill(0);
let closedHihatSteps = new Array(16).fill(0);
let openHihatSteps = new Array(16).fill(0);
let snareSteps = new Array(16).fill(0);

let currentStep = 0;
let currentBPM = 120;
let selectedInstrument = "kick";
let lastBeatTime = [];
let falling = [];

// mute flags / transport model
let drumsMuted = true;
let stringsMuted = true;
let isPlayAllActive = false; // UI state (both unmuted)
let transportPrimed = false; // once primed, we keep transport running

// =====================================
// STRINGS ENGINE (single notes, chromatic row)
// =====================================
const CHROMATIC = [
  "C",
  "C#",
  "D",
  "D#",
  "E",
  "F",
  "F#",
  "G",
  "G#",
  "A",
  "A#",
  "B",
];
const NOTE_PITCHES = CHROMATIC.map((n) => `${n}4`);
const RAINBOW = [
  "#ff0000",
  "#ff7a00",
  "#ffbf00",
  "#e5ff00",
  "#73ff00",
  "#00ffa8",
  "#00e1ff",
  "#008dff",
  "#5600ff",
  "#a300ff",
  "#ff00c8",
  "#ff0080",
];

let currentMode = "drums"; // "drums" | "strings"
let stringTimeline = new Array(8).fill(null); // default 8 slots
const MAX_SLOTS = 24;
const SLOTS_PER_ROW = 12;

// Strings pulse animation (A: subtle +25%)
const STRING_PULSE_MS = 200; // pulse lifetime
const STRING_PULSE_SCALE = 1.25; // max scale during pulse
let stringPulseAt = new Array(stringTimeline.length).fill(0); // timestamp per slot

const stringPoly = new Tone.PolySynth(Tone.AMSynth, {
  envelope: { attack: 0.02, decay: 0.25, sustain: 0.75, release: 0.45 },
  harmonicity: 1.5,
  modulationIndex: 2,
}).toDestination();

// Audition + drop feedback
const auditionSynth = new Tone.Synth({
  oscillator: { type: "sine" },
  envelope: { attack: 0.005, decay: 0.12, sustain: 0, release: 0.05 },
}).toDestination();
auditionSynth.volume.value = -10;

const tok = new Tone.MembraneSynth({
  pitchDecay: 0.002,
  octaves: 6,
  envelope: { attack: 0.001, decay: 0.06, sustain: 0, release: 0.01 },
}).toDestination();
tok.volume.value = -8;

// =====================================
// UI helpers & transport bar references
// =====================================
function updatePlayStatusText() {
  const el = document.getElementById("playStatus");
  if (!el) return;
  const anyPlaying = !drumsMuted || !stringsMuted;
  el.textContent = anyPlaying ? "Playing" : "Paused";
}

function ensureTransportRunning() {
  if (!transportPrimed) return;
  if (Tone.Transport.state !== "started" && (!drumsMuted || !stringsMuted)) {
    try {
      Tone.Transport.start();
    } catch {}
  }
}

function primeTransportOnce() {
  if (transportPrimed) return;
  transportPrimed = true;
  try {
    Tone.Transport.start();
  } catch {}
}

// Transport bar buttons (created once)
let btnTDrums = null;
let btnTStrings = null;
let btnTAll = null;

function createTransportButtonsIfNeeded() {
  const holder = document.getElementById("transportBar");
  if (!holder) return;

  if (!btnTDrums) {
    btnTDrums = document.createElement("button");
    btnTDrums.className = "transport-button";
    btnTDrums.id = "transportPlayDrums";
    holder.appendChild(btnTDrums);
    btnTDrums.addEventListener("click", () => {
      const drumsOnlyActive = !drumsMuted && stringsMuted && !isPlayAllActive;
      if (drumsOnlyActive) {
        drumsMuted = true;
        stringsMuted = true;
        isPlayAllActive = false;
      } else {
        isPlayAllActive = false;
        drumsMuted = false;
        stringsMuted = true;
        primeTransportOnce();
        ensureTransportRunning();
      }
      updateTransportVisuals();
      updatePlayStatusText();
    });
  }

  if (!btnTStrings) {
    btnTStrings = document.createElement("button");
    btnTStrings.className = "transport-button";
    btnTStrings.id = "transportPlayStrings";
    holder.appendChild(btnTStrings);
    btnTStrings.addEventListener("click", () => {
      const stringsOnlyActive = !stringsMuted && drumsMuted && !isPlayAllActive;
      if (stringsOnlyActive) {
        drumsMuted = true;
        stringsMuted = true;
        isPlayAllActive = false;
      } else {
        isPlayAllActive = false;
        stringsMuted = false;
        drumsMuted = true;
        primeTransportOnce();
        ensureTransportRunning();
      }
      updateTransportVisuals();
      updatePlayStatusText();
    });
  }

  if (!btnTAll) {
    btnTAll = document.createElement("button");
    btnTAll.className = "transport-button";
    btnTAll.id = "transportPlayAll";
    holder.appendChild(btnTAll);
    btnTAll.addEventListener("click", () => {
      const allActive = isPlayAllActive && !drumsMuted && !stringsMuted;
      if (allActive) {
        isPlayAllActive = false;
        drumsMuted = true;
        stringsMuted = true;
      } else {
        isPlayAllActive = true;
        drumsMuted = false;
        stringsMuted = false;
        primeTransportOnce();
        ensureTransportRunning();
      }
      updateTransportVisuals();
      updatePlayStatusText();
    });
  }

  updateTransportVisibilityByMode();
  updateTransportVisuals();
}

function setTransportBtn(btn, isActive, baseLabel) {
  if (!btn) return;
  btn.classList.toggle("active", isActive);
  const prefix = isActive ? "⏸" : "▶";
  if (baseLabel.toLowerCase() === "all") btn.textContent = `${prefix} all`;
  else btn.textContent = `${prefix} ${baseLabel}`;
}

function updateTransportVisibilityByMode() {
  if (!btnTDrums || !btnTStrings || !btnTAll) return;
  if (currentMode === "drums") {
    btnTDrums.style.display = "";
    btnTAll.style.display = "";
    btnTStrings.style.display = "none";
  } else {
    // strings
    btnTStrings.style.display = "";
    btnTAll.style.display = "";
    btnTDrums.style.display = "none";
  }
}

function updateTransportVisuals() {
  const drumsOnlyActive = !drumsMuted && stringsMuted && !isPlayAllActive;
  const stringsOnlyActive = !stringsMuted && drumsMuted && !isPlayAllActive;
  const allActive = isPlayAllActive && !drumsMuted && !stringsMuted;
  if (btnTDrums) setTransportBtn(btnTDrums, drumsOnlyActive, "Drums");
  if (btnTStrings) setTransportBtn(btnTStrings, stringsOnlyActive, "Strings");
  if (btnTAll) setTransportBtn(btnTAll, allActive, "all");

  // Also update left panel buttons
  const leftPanelStringsBtn = document.getElementById("transportPlayStrings");
  const leftPanelAllBtn = document.getElementById("transportPlayAll");
  if (leftPanelStringsBtn) {
    leftPanelStringsBtn.classList.toggle("active", stringsOnlyActive);
    leftPanelStringsBtn.textContent = stringsOnlyActive
      ? "⏸ Strings"
      : "► Strings";
  }
  if (leftPanelAllBtn) {
    leftPanelAllBtn.classList.toggle("active", allActive);
    leftPanelAllBtn.textContent = allActive ? "⏸ all" : "► all";
  }
}

// =====================================
// DRUMS SEQUENCE (persistent; mute controls sound)
// =====================================
const seq = new Tone.Sequence(
  (time, stepIndex) => {
    currentStep = stepIndex;

    if (!drumsMuted) {
      const on =
        kickSteps[stepIndex] ||
        closedHihatSteps[stepIndex] ||
        openHihatSteps[stepIndex] ||
        snareSteps[stepIndex];
      if (on) {
        lastBeatTime[stepIndex] = Date.now();
        spawnParticleForStep(stepIndex);
      }
      const t = Math.max(0, time);
      try {
        if (kickSteps[stepIndex]) kick.triggerAttackRelease("C1", "8n", t);
        if (closedHihatSteps[stepIndex])
          closedHihat.triggerAttackRelease("8n", t);
        if (openHihatSteps[stepIndex]) openHihat.triggerAttackRelease("8n", t);
        if (snareSteps[stepIndex]) kick.triggerAttackRelease("C2", "8n", t);
      } catch {}
    }
  },
  [...Array(16).keys()],
  "16n"
);
seq.loop = true;
seq.start(0);
Tone.Transport.bpm.value = 120;

// =====================================
// STRINGS SEQUENCE (persistent; mute controls sound)
// =====================================
let stringsSeq = null;

function buildOrUpdateStringsSequence() {
  if (stringsSeq) {
    stringsSeq.dispose();
    stringsSeq = null;
  }
  // resize pulse array if timeline changed
  if (stringPulseAt.length !== stringTimeline.length) {
    const old = stringPulseAt.slice();
    stringPulseAt = new Array(stringTimeline.length).fill(0);
    for (let i = 0; i < Math.min(old.length, stringPulseAt.length); i++) {
      stringPulseAt[i] = old[i];
    }
  }

  const len = stringTimeline.length;
  stringsSeq = new Tone.Sequence(
    (time, i) => {
      if (!stringsMuted) {
        const idx = stringTimeline[i];
        if (idx !== null && idx >= 0) {
          try {
            stringPoly.triggerAttackRelease(NOTE_PITCHES[idx], "8n", time);
          } catch {}
          // mark pulse timestamp for animation
          stringPulseAt[i] = performance.now();
        }
      }
    },
    [...Array(len).keys()],
    "8n"
  );
  stringsSeq.loop = true;
  stringsSeq.start(0);
}

// =====================================
// MEDIAPIPE + CANVAS
// =====================================
const video = document.getElementById("cam");
const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");
const readout = document.getElementById("readout");
const videoContainer = document.getElementById("videoContainer");
let recognizer;

function resizeCanvas() {
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
}

async function initMP() {
  const filesetResolver = await FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm"
  );
  recognizer = await GestureRecognizer.createFromOptions(filesetResolver, {
    baseOptions: {
      modelAssetPath:
        "https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task",
    },
    runningMode: "VIDEO",
    numHands: 1,
  });
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { width: 1280, height: 720 },
  });
  video.srcObject = stream;
  await video.play();
  resizeCanvas();
  window.addEventListener("resize", resizeCanvas);
  requestAnimationFrame(loop);
}

// =====================================
// GESTURES (pinch + bpm + single-finger pause in both modes)
// =====================================
function countFingersUp(lm) {
  const tips = [4, 8, 12, 16, 20],
    pips = [3, 6, 10, 14, 18];
  let up = 0;
  for (let i = 0; i < 5; i++) {
    const t = lm[tips[i]],
      p = lm[pips[i]];
    if (t && p && t.y < p.y) up++;
  }
  return up;
}

function getPinchDistance(lm) {
  const a = lm[4],
    b = lm[8];
  if (!a || !b) return null;
  const dx = (a.x - b.x) * canvas.width,
    dy = (a.y - b.y) * canvas.height;
  return Math.hypot(dx, dy);
}
const PINCH_ON = 70,
  PINCH_OFF = 95;
let pinchActive = false;
function updatePinchState(d) {
  if (d == null) {
    pinchActive = false;
    return false;
  }
  if (!pinchActive && d < PINCH_ON) pinchActive = true;
  else if (pinchActive && d > PINCH_OFF) pinchActive = false;
  return pinchActive;
}

function isHandNearBPMSlider(lm) {
  const i = lm[8];
  if (!i) return false;
  const x = canvas.width - i.x * canvas.width,
    left = canvas.width - 300;
  return x >= left && x <= canvas.width;
}
function getBPMSliderYPosition(lm) {
  const i = lm[8];
  if (!i) return null;
  const x = canvas.width - i.x * canvas.width,
    left = canvas.width - 300;
  if (x < left || x > canvas.width) return null;
  const y = i.y;
  return Math.max(0, Math.min(1, (y - 0.08) / 0.84));
}

// Drum circle pinch helper
function getBeatAtPinch(lm, cx, cy, r) {
  const t = lm[4];
  if (!t) return -1;
  const x = canvas.width - t.x * canvas.width,
    y = t.y * canvas.height;
  const dx = x - cx,
    dy = y - cy,
    dist = Math.hypot(dx, dy);
  if (Math.abs(dist - r) > 80) return -1;
  let ang = Math.atan2(dy, dx);
  if (ang < 0) ang += Math.PI * 2;
  ang = (ang + Math.PI / 2) % (Math.PI * 2);
  return Math.round((ang / (Math.PI * 2)) * 16) % 16;
}

// =====================================
// STRINGS layout + drag + delete zone
// =====================================
let chromaticRects = [],
  timelineSlots = [],
  activeDrag = null,
  hoverSlotIdx = -1,
  snappedSlotIdx = -1;

const CH_DOT_R = 16;
const CH_SPREAD_PAD = 32;
const SLOT_LINE_LEN_MIN = 26;
const SLOT_LINE_LEN_MAX = 42;
const SLOT_ROW_GAP = 68;

// medium snap hitbox
const SNAP_H_RATIO = 0.42;
const SNAP_V_PX = 34;

// Global delete zone (D1b): below bottom-most timeline row
const DELETE_MARGIN_PX = 40;
let timelineBottomY = 0; // computed per layout

function layoutStringsGeometry() {
  chromaticRects.length = 0;
  timelineSlots.length = 0;

  const topY = 120;
  const leftW = 200,
    rightW = 300,
    sidePad = 32;
  const usableW = canvas.width - (leftW + rightW + sidePad * 2);
  const startX = leftW + sidePad;
  const spread =
    (usableW - CH_SPREAD_PAD * (CHROMATIC.length - 1)) / CHROMATIC.length;

  let x = startX + spread * 0.5;
  for (let i = 0; i < CHROMATIC.length; i++) {
    chromaticRects.push({
      x,
      y: topY,
      r: CH_DOT_R,
      index: i,
      label: CHROMATIC[i],
      color: RAINBOW[i],
    });
    x += spread + CH_SPREAD_PAD;
  }

  const total = stringTimeline.length;
  const rows = Math.ceil(total / SLOTS_PER_ROW);
  const centerYBase = Math.max(canvas.height * 0.52, topY + 120);
  const rowStartY = centerYBase - ((rows - 1) * SLOT_ROW_GAP) / 2;

  const timelineUsableW = usableW - 40;
  const baseX = leftW + sidePad + 20;

  for (let i = 0; i < total; i++) {
    const row = Math.floor(i / SLOTS_PER_ROW);
    const col = i % SLOTS_PER_ROW;
    const rowSlotsCount = Math.min(SLOTS_PER_ROW, total - row * SLOTS_PER_ROW);
    const sectionW = timelineUsableW / rowSlotsCount;

    const cx = baseX + sectionW * (col + 0.5);
    const cy = rowStartY + row * SLOT_ROW_GAP;

    timelineSlots.push({ idx: i, centerX: cx, centerY: cy, sectionW });
  }

  // compute global bottom line for delete zone
  if (timelineSlots.length > 0) {
    // last row centerY
    const lastSlot = timelineSlots[timelineSlots.length - 1];
    const lastRow = Math.floor((timelineSlots.length - 1) / SLOTS_PER_ROW);
    timelineBottomY = rowStartY + lastRow * SLOT_ROW_GAP + 12; // +12 to align with slot baseline lines
  } else {
    timelineBottomY = centerYBase + 12; // fallback
  }
}

// =====================================
// DRAWING
// =====================================
function drawCircleInterface() {
  // hide drum visuals when in strings mode + Play All (per your preference)
  if (currentMode === "strings" && isPlayAllActive) return;

  const cx = canvas.width / 2,
    cy = canvas.height / 2;
  const r = Math.min(canvas.width, canvas.height) * 0.35;

  const patMap = {
    kick: kickSteps,
    closedhihat: closedHihatSteps,
    openhihat: openHihatSteps,
    snare: snareSteps,
  };
  const pat = patMap[selectedInstrument] || kickSteps;

  for (let i = 0; i < 16; i++) {
    const ang = (i / 16) * Math.PI * 2 - Math.PI / 2;
    const x = cx + Math.cos(ang) * r,
      y = cy + Math.sin(ang) * r;

    const active = !!pat[i];
    const current = i === currentStep && !drumsMuted;

    let pulse = 1;
    if (lastBeatTime[i]) {
      const dt = Date.now() - lastBeatTime[i];
      if (dt < 200) pulse = 1 + 0.5 * (1 - dt / 200);
    }
    let rad = 6,
      alpha = 0.6;
    if (active) {
      alpha = 0.95;
      rad = 12 * pulse;
    }
    if (current && active) {
      rad = 18 * pulse;
      alpha = 1;
    }

    if (current && active) {
      ctx.shadowBlur = 25;
      ctx.shadowColor = "rgba(255,0,136,1)";
      ctx.fillStyle = "rgba(255,0,136,1)";
    } else if (active) {
      ctx.shadowBlur = 15 * pulse;
      ctx.shadowColor = "rgba(0,255,136,0.9)";
      ctx.fillStyle = `rgba(0,255,136,${alpha})`;
    } else {
      ctx.shadowBlur = 0;
      ctx.fillStyle = `rgba(0,255,136,${alpha})`;
    }

    ctx.beginPath();
    ctx.arc(x, y, rad, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.shadowBlur = 0;
  ctx.font = "bold 20px system-ui";
  ctx.fillStyle = "rgba(255,255,255,0.9)";
  ctx.textAlign = "center";
  ctx.fillText(selectedInstrument.toUpperCase(), cx, cy - 10);
  if (drumsMuted) {
    ctx.font = "14px system-ui";
    ctx.fillStyle = "rgba(255,255,255,0.6)";
    ctx.fillText("Pinch to toggle beats", cx, cy + 30);
  }
}

function drawFallingParticles() {
  if (currentMode === "strings" && isPlayAllActive) return;
  if (currentMode !== "drums" && !isPlayAllActive) return;

  const cx = canvas.width / 2,
    cy = canvas.height / 2;
  for (let i = falling.length - 1; i >= 0; i--) {
    const o = falling[i];
    o.t += 0.02;
    const prog = o.t * o.t;
    const curve = 60 * Math.sin(Math.PI * prog) * o.curve;
    const perp = o.angle + (Math.PI / 2) * o.curve;
    const fx = o.x + (cx - o.x) * prog + curve * Math.cos(perp);
    const fy = o.y + (cy - o.y) * prog + curve * Math.sin(perp);

    // Add current position to path
    if (o.path) {
      o.path.push({ x: fx, y: fy });
      // Keep only last 20 points for streak
      if (o.path.length > 20) {
        o.path.shift();
      }
    }

    const fade = 80 * (1 - prog),
      size = 8 * (1 - prog) + 2;

    let col = "rgba(0,255,136,";
    switch (o.instrument) {
      case "kick":
        col = "rgba(77,238,234,";
        break;
      case "snare":
        col = "rgba(255,100,0,";
        break;
      case "closedhihat":
        col = "rgba(255,200,0,";
        break;
      case "openhihat":
        col = "rgba(240,0,255,";
        break;
    }

    // Draw streak trail
    if (o.path && o.path.length > 1) {
      ctx.strokeStyle = col + (fade * 0.5) / 100 + ")";
      ctx.lineWidth = 4;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(o.path[0].x, o.path[0].y);
      for (let p = 1; p < o.path.length; p++) {
        ctx.lineTo(o.path[p].x, o.path[p].y);
      }
      ctx.stroke();
    }

    for (let b = 5; b > 0; b--) {
      ctx.fillStyle = col + fade * (5 - b) * 0.01 + ")";
      ctx.beginPath();
      ctx.arc(fx, fy, size + b, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = col + fade / 100 + ")";
    ctx.beginPath();
    ctx.arc(fx, fy, size, 0, Math.PI * 2);
    ctx.fill();
    if (o.t >= 1) falling.splice(i, 1);
  }
}

function spawnParticleForStep(i) {
  const cx = canvas.width / 2,
    cy = canvas.height / 2,
    r = Math.min(canvas.width, canvas.height) * 0.3;
  const ang = (i / 16) * Math.PI * 2 - Math.PI / 2;
  const x = cx + Math.cos(ang) * r,
    y = cy + Math.sin(ang) * r,
    curveDir = Math.random() < 0.5 ? -1 : 1;
  let inst = "kick";
  if (snareSteps[i]) inst = "snare";
  else if (closedHihatSteps[i]) inst = "closedhihat";
  else if (openHihatSteps[i]) inst = "openhihat";
  falling.push({
    x,
    y,
    t: 0,
    angle: ang,
    curve: curveDir,
    instrument: inst,
    path: [{ x, y }], // Track path for streak
  });
}

// STRINGS UI (with pulse animation)
function drawStringsInterface() {
  layoutStringsGeometry();

  // Chromatic row
  ctx.textAlign = "center";
  chromaticRects.forEach((n) => {
    ctx.shadowBlur = 8;
    ctx.shadowColor = n.color + "AA";
    ctx.fillStyle = n.color + "DD";
    ctx.beginPath();
    ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = "#0b0f10";
    ctx.font = "bold 11px system-ui";
    ctx.fillText(n.label, n.x, n.y + 4);
  });

  const now = performance.now();

  // Timeline slots + placed notes
  timelineSlots.forEach((sl) => {
    const len = Math.max(
      SLOT_LINE_LEN_MIN,
      Math.min(SLOT_LINE_LEN_MAX, sl.sectionW * 0.55)
    );
    const x1 = sl.centerX - len / 2,
      x2 = sl.centerX + len / 2,
      y = sl.centerY + 12;
    const occupied = stringTimeline[sl.idx] !== null;
    const isHover = hoverSlotIdx === sl.idx;

    ctx.lineWidth = 3;
    ctx.strokeStyle = isHover
      ? "rgba(0,255,136,0.9)"
      : occupied
      ? "rgba(255,255,255,0.85)"
      : "rgba(255,255,255,0.3)";
    ctx.beginPath();
    ctx.moveTo(x1, y);
    ctx.lineTo(x2, y);
    ctx.stroke();

    const nIdx = stringTimeline[sl.idx];
    if (nIdx !== null) {
      // Pulse calc
      const t0 = stringPulseAt[sl.idx] || 0;
      const dt = Math.max(0, now - t0);
      const inPulse = dt < STRING_PULSE_MS;
      // ease (0..1): quick ramp up then down
      const f = inPulse ? 1 - dt / STRING_PULSE_MS : 0;
      const scale = 1 + (STRING_PULSE_SCALE - 1) * f; // up to +25%
      const r = 16 * scale;

      // During pulse: white; else rainbow
      const color = inPulse ? "#ffffff" : RAINBOW[nIdx];

      ctx.shadowBlur = inPulse ? 18 : 14;
      ctx.shadowColor = inPulse ? "rgba(255,255,255,0.9)" : color;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(sl.centerX, sl.centerY, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = "#0b0f10";
      ctx.font = "bold 11px system-ui";
      ctx.fillText(CHROMATIC[nIdx], sl.centerX, sl.centerY + 4);
    }
  });

  // Active drag ghost
  if (activeDrag) {
    const { noteIndex, ghostX, ghostY } = activeDrag;
    if (noteIndex != null && ghostX != null) {
      const color = RAINBOW[noteIndex];
      ctx.globalAlpha = 0.9;
      ctx.shadowBlur = 18;
      ctx.shadowColor = color;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(ghostX, ghostY, 18, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.shadowBlur = 0;
      ctx.fillStyle = "#0b0f10";
      ctx.font = "bold 11px system-ui";
      ctx.fillText(CHROMATIC[noteIndex], ghostX, ghostY + 4);
    }
  }
}

// Hand overlay (debug)
function drawLandmarks(lm) {
  const con = [
    [0, 1],
    [1, 2],
    [2, 3],
    [3, 4],
    [0, 5],
    [5, 6],
    [6, 7],
    [7, 8],
    [0, 9],
    [9, 10],
    [10, 11],
    [11, 12],
    [0, 13],
    [13, 14],
    [14, 15],
    [15, 16],
    [0, 17],
    [17, 18],
    [18, 19],
    [19, 20],
    [5, 9],
    [9, 13],
    [13, 17],
  ];
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 3;
  ctx.shadowBlur = 12;
  ctx.shadowColor = "rgba(255,255,255,0.8)";
  for (const [a, b] of con) {
    const p = lm[a],
      q = lm[b];
    if (p && q) {
      const x1 = canvas.width - p.x * canvas.width,
        y1 = p.y * canvas.height;
      const x2 = canvas.width - q.x * canvas.width,
        y2 = q.y * canvas.height;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }
  }
  for (let i = 0; i < lm.length; i++) {
    const o = lm[i],
      x = canvas.width - o.x * canvas.width,
      y = o.y * canvas.height,
      tip = [4, 8, 12, 16, 20].includes(i);
    ctx.shadowBlur = tip ? 16 : 8;
    ctx.shadowColor = "rgb(253,253,253)";
    ctx.fillStyle = tip ? "#ff0088" : "#ffffff";
    ctx.beginPath();
    ctx.arc(x, y, tip ? 8 : 5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.shadowBlur = 0;
}

// =====================================
// MAIN LOOP
// =====================================
function loop() {
  if (!recognizer) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (currentMode === "drums") {
    drawCircleInterface();
    drawFallingParticles();
  } else {
    drawStringsInterface();
  }

  const now = performance.now();
  const res = recognizer.recognizeForVideo(video, now);
  const lm = res?.landmarks?.[0];

  if (lm) {
    const fingers = countFingersUp(lm);
    const pd = getPinchDistance(lm);
    updatePinchState(pd);

    // 1 finger = pause ALL (buttons reflect off state); transport keeps running
    if (fingers === 1) {
      drumsMuted = true;
      stringsMuted = true;
      isPlayAllActive = false;
      updateTransportVisuals();
      updatePlayStatusText();
    }

    // BPM adjust (pinch while over slider)
    if (pinchActive && isHandNearBPMSlider(lm)) {
      const by = getBPMSliderYPosition(lm);
      if (by !== null) {
        const newBPM = Math.round(60 + (1 - by) * 120);
        currentBPM = Math.max(60, Math.min(180, newBPM));
        try {
          Tone.Transport.bpm.rampTo(currentBPM, 0.1);
        } catch {}
        updateBPMSlider();
        readout.textContent = `🎵 BPM: ${currentBPM}`;
      }
    } else if (currentMode === "drums") {
      handleDrumPinch(lm);
    } else {
      handleStringsGestures(lm, fingers);
    }

    drawLandmarks(lm);
  } else {
    pinchActive = false;
    activeDrag = null;
    hoverSlotIdx = -1;
    snappedSlotIdx = -1;
  }

  requestAnimationFrame(loop);
}

// DRUM PINCH TOGGLE (auto-unmute on first ON)
let wasPinching = false;
function handleDrumPinch(lm) {
  if (!pinchActive) {
    wasPinching = false;
    return;
  }
  const cx = canvas.width / 2,
    cy = canvas.height / 2,
    r = Math.min(canvas.width, canvas.height) * 0.35;
  const idx = getBeatAtPinch(lm, cx, cy, r);
  if (idx < 0) return;

  if (!wasPinching) {
    let pat;
    switch (selectedInstrument) {
      case "kick":
        pat = kickSteps;
        break;
      case "closedhihat":
        pat = closedHihatSteps;
        break;
      case "openhihat":
        pat = openHihatSteps;
        break;
      case "snare":
        pat = snareSteps;
        break;
      default:
        pat = kickSteps;
    }
    pat[idx] = pat[idx] ? 0 : 1;

    if (pat[idx] === 1) {
      primeTransportOnce();
      drumsMuted = false;
      isPlayAllActive = !drumsMuted && !stringsMuted;
      ensureTransportRunning();
      updateTransportVisuals();
      updatePlayStatusText();
    }

    wasPinching = true;
  }
}

// ---------- STRINGS GESTURES (magnetic snap S2 + D-B drop + delete zone)
// Global delete zone: y > timelineBottomY + DELETE_MARGIN_PX
function handleStringsGestures(lm, fingers) {
  const i = lm[8];
  if (!i) {
    activeDrag = null;
    hoverSlotIdx = -1;
    snappedSlotIdx = -1;
    return;
  }
  const px = canvas.width - i.x * canvas.width,
    py = i.y * canvas.height;

  // Determine closest slot within forgiving hitbox for magnetic snap
  let nearestIdx = -1,
    nearestDist = Infinity;
  for (const sl of timelineSlots) {
    const dx = Math.abs(px - sl.centerX);
    const dy = Math.abs(py - sl.centerY);
    const halfW = sl.sectionW * SNAP_H_RATIO;
    if (dx <= halfW && dy <= SNAP_V_PX) {
      const d = dx + dy * 1.25; // slight weight to vertical
      if (d < nearestDist) {
        nearestDist = d;
        nearestIdx = sl.idx;
      }
    }
  }

  // hover visualization (line highlight)
  hoverSlotIdx = nearestIdx;

  if (pinchActive) {
    // START DRAG (must begin with pinch)
    if (!activeDrag) {
      // start from chromatic row?
      const hit = chromaticRects.find(
        (n) => Math.hypot(px - n.x, py - n.y) <= n.r + 10
      );
      if (hit) {
        activeDrag = {
          from: "row",
          noteIndex: hit.index,
          originSlotIndex: null,
          ghostX: px,
          ghostY: py,
        };
        try {
          auditionSynth.triggerAttackRelease(NOTE_PITCHES[hit.index], 0.15);
        } catch {}
      } else {
        // pick up from slot?
        for (const sl of timelineSlots) {
          const halfW = sl.sectionW * SNAP_H_RATIO,
            halfH = SNAP_V_PX;
          if (
            Math.abs(px - sl.centerX) <= halfW &&
            Math.abs(py - sl.centerY) <= halfH &&
            stringTimeline[sl.idx] !== null
          ) {
            const nIdx = stringTimeline[sl.idx];
            stringTimeline[sl.idx] = null;
            activeDrag = {
              from: "slot",
              noteIndex: nIdx,
              originSlotIndex: sl.idx,
              ghostX: px,
              ghostY: py,
            };
            try {
              auditionSynth.triggerAttackRelease(NOTE_PITCHES[nIdx], 0.15);
            } catch {}
            break;
          }
        }
      }
    } else {
      // UPDATE DRAG
      activeDrag.ghostX = px;
      activeDrag.ghostY = py;

      // Live magnetic snap: attach if near; allow unsnap only while still pinching
      if (nearestIdx >= 0) {
        snappedSlotIdx = nearestIdx;
      } else {
        // unsnap allowed only while pinching
        snappedSlotIdx = -1;
      }
    }
  } else {
    // NOT PINCHING: DROP or DELETE
    if (activeDrag) {
      const inDeleteZone = py > timelineBottomY + DELETE_MARGIN_PX;

      if (inDeleteZone) {
        // delete: do nothing (note removed)
      } else if (snappedSlotIdx >= 0) {
        stringTimeline[snappedSlotIdx] = activeDrag.noteIndex;
        try {
          tok.triggerAttackRelease("C5", "16n");
        } catch {}
      } else if (
        activeDrag.from === "slot" &&
        activeDrag.originSlotIndex != null
      ) {
        // return to origin if not dropped anywhere
        if (stringTimeline[activeDrag.originSlotIndex] === null)
          stringTimeline[activeDrag.originSlotIndex] = activeDrag.noteIndex;
      }

      buildOrUpdateStringsSequence();
      primeTransportOnce();
    }
    activeDrag = null;

    // If user switched to 1-finger near a slot (D-B), we already dropped via non-pinching branch.
    snappedSlotIdx = -1;
  }
}

// =====================================
// UI CONTROLS (non-transport)
// =====================================
let bpmSlider, bpmSliderFill, currentBPMDisplay;

function initializeUI() {
  bpmSlider = document.getElementById("bpmSlider");
  bpmSliderFill = document.getElementById("bpmSliderFill");
  currentBPMDisplay = document.getElementById("currentBPM");
  updateBPMSlider();
  bpmSlider.addEventListener("click", handleBPMSliderClick);

  // instrument buttons (do not affect playback)
  document
    .querySelectorAll(".instrument-button[data-instrument]")
    ?.forEach((btn) => {
      btn.addEventListener("click", (e) => {
        document
          .querySelectorAll(".instrument-button[data-instrument]")
          .forEach((b) => b.classList.remove("active"));
        e.target.classList.add("active");
        selectedInstrument = e.target.dataset.instrument;
      });
    });

  // clear all
  document.getElementById("clearAll")?.addEventListener("click", () => {
    kickSteps.fill(0);
    closedHihatSteps.fill(0);
    openHihatSteps.fill(0);
    snareSteps.fill(0);
    stringTimeline.fill(null);
    buildOrUpdateStringsSequence();
    drumsMuted = true;
    stringsMuted = true;
    isPlayAllActive = false;
    updateTransportVisuals();
    updatePlayStatusText();
  });

  // mode switching
  document
    .getElementById("modeDrums")
    ?.addEventListener("click", () => switchMode("drums"));
  document
    .getElementById("modeStrings")
    ?.addEventListener("click", () => switchMode("strings"));

  // Left panel transport buttons (replacing key buttons)
  const leftPanelStringsBtn = document.getElementById("transportPlayStrings");
  const leftPanelAllBtn = document.getElementById("transportPlayAll");

  if (leftPanelStringsBtn) {
    leftPanelStringsBtn.addEventListener("click", () => {
      const stringsOnlyActive = !stringsMuted && drumsMuted && !isPlayAllActive;
      if (stringsOnlyActive) {
        stringsMuted = true;
        drumsMuted = true;
        isPlayAllActive = false;
      } else {
        isPlayAllActive = false;
        stringsMuted = false;
        drumsMuted = true;
        primeTransportOnce();
        ensureTransportRunning();
      }
      updateTransportVisuals();
      updatePlayStatusText();
    });
  }

  if (leftPanelAllBtn) {
    leftPanelAllBtn.addEventListener("click", () => {
      const allActive = isPlayAllActive && !drumsMuted && !stringsMuted;
      if (allActive) {
        isPlayAllActive = false;
        drumsMuted = true;
        stringsMuted = true;
      } else {
        isPlayAllActive = true;
        drumsMuted = false;
        stringsMuted = false;
        primeTransportOnce();
        ensureTransportRunning();
      }
      updateTransportVisuals();
      updatePlayStatusText();
    });
  }

  // strings timeline +/- (length change => rebuild sequence)
  document.getElementById("addSlot")?.addEventListener("click", () => {
    if (stringTimeline.length < MAX_SLOTS) {
      stringTimeline.push(null);
      buildOrUpdateStringsSequence();
    }
  });
  document.getElementById("subSlot")?.addEventListener("click", () => {
    if (stringTimeline.length > 1) {
      stringTimeline.pop();
      // trim pulse array happens in buildOrUpdateStringsSequence
      buildOrUpdateStringsSequence();
    }
  });

  // Create the transport buttons in the dedicated bar
  createTransportButtonsIfNeeded();
  updateTransportVisibilityByMode();
  updateTransportVisuals();
}

function switchMode(mode) {
  currentMode = mode;
  document
    .getElementById("modeDrums")
    ?.classList.toggle("active", mode === "drums");
  document
    .getElementById("modeStrings")
    ?.classList.toggle("active", mode === "strings");
  document
    .getElementById("stringsUI")
    ?.classList.toggle("hidden", mode !== "strings");
  document
    .getElementById("drumControlList")
    ?.classList.toggle("hidden", mode === "strings");
  document
    .getElementById("stringsControlList")
    ?.classList.toggle("hidden", mode !== "strings");
  updateTransportVisibilityByMode();
}

function updateBPMSlider() {
  const pct = ((currentBPM - 60) / (180 - 60)) * 100;
  const fill = document.getElementById("bpmSliderFill");
  if (fill) fill.style.height = pct + "%";
  const disp = document.getElementById("currentBPM");
  if (disp) disp.textContent = currentBPM + " BPM";
}
function handleBPMSliderClick(e) {
  const r = bpmSlider.getBoundingClientRect(),
    y = e.clientY - r.top,
    pct = 1 - y / r.height;
  currentBPM = Math.max(60, Math.min(180, Math.round(60 + pct * 120)));
  try {
    Tone.Transport.bpm.rampTo(currentBPM, 0.1);
  } catch {}
  updateBPMSlider();
}

// =====================================
// BOOT
// =====================================
document.getElementById("start").addEventListener("click", async () => {
  await Tone.start();
  buildOrUpdateStringsSequence(); // keep strings scheduled at all times
  if (!recognizer) await initMP();
  videoContainer.classList.add("active");
  document.querySelector(".card").classList.add("hidden");
  initializeUI();
  readout.textContent =
    "👌 Drums: pinch to toggle beats • Strings: pinch-drag notes • ☝️ 1-finger = pause • Drag below timeline to delete";
});

// Error suppressors (rare Tone timing edge cases)
window.addEventListener("error", (e) => {
  if (e.error?.message?.includes("Value must be within [0, Infinity]")) {
    e.preventDefault();
    return true;
  }
});
window.addEventListener("unhandledrejection", (e) => {
  if (e.reason?.message?.includes("Value must be within [0, Infinity]")) {
    e.preventDefault();
    return true;
  }
});
