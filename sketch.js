// --- Tone setup ---
const kick = new Tone.MembraneSynth().toDestination();
const closedHihat = new Tone.NoiseSynth({
  noise: { type: "white" },
  envelope: { attack: 0.001, decay: 0.05, sustain: 0.001, release: 0.01 },
}).toDestination();
const openHihat = new Tone.NoiseSynth({
  noise: { type: "white" },
  envelope: { attack: 0.0001, decay: 0.2, sustain: 0.1, release: 0.3 },
}).toDestination();

/**
 * Grid pattern presets - different densities based on pinch distance
 * Each pattern represents a density level (sparse to dense)
 *
 * COMMENTED OUT - No longer used, only pinch for beat toggling
 */
/*
const patternDensities = [
  [1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0], // 2/16 - very open pinch
  [1, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0], // 4/16
  [1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 0], // 6/16
  [1, 0, 1, 0, 1, 1, 0, 1, 1, 0, 1, 0, 1, 0, 1, 0] // 10/16 - pinch closed
];

const densityLabels = ["Sparse", "Medium", "Dense", "Very Dense"];
*/

let kickSteps = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]; // All beats off by default
let closedHihatSteps = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]; // Closed hihat pattern
let openHihatSteps = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]; // Open hihat pattern
let snareSteps = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]; // Snare pattern
let currentStep = 0;
// let currentDensity = 0; // Track which density pattern (0-3) - NO LONGER USED
let isPlaying = false;
let lastPinchDistance = null;
let currentBPM = 120;
let selectedInstrument = "kick"; // Track which instrument is being edited
let lastBeatTime = {}; // Track when each beat position was last played
let falling = []; // Falling particles from beats
let wasAdjustingBPM = false; // Track if was previously adjusting BPM

const hatSteps = [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0];

// UI Elements
let bpmSlider, bpmSliderFill, currentBPMDisplay, playStatusDisplay;

/**
 * Track selected beat position (-1 if none selected)
 */
let selectedBeat = -1;
let lastPinchBeat = -1; // Track which beat was selected last pinch
let wasPinching = false; // Track if was previously pinching

/**
 * Tone.js sequence that plays the rhythm
 * Calls our callback on each 16th note
 */
const seq = new Tone.Sequence(
  (time, stepIndex) => {
    currentStep = stepIndex;

    // Check if any instrument is active at this beat position
    const hasActiveBeat =
      kickSteps[stepIndex] ||
      closedHihatSteps[stepIndex] ||
      openHihatSteps[stepIndex] ||
      snareSteps[stepIndex];

    // Record when this beat position was triggered and create falling particle
    if (hasActiveBeat && isPlaying) {
      lastBeatTime[stepIndex] = Date.now();

      const centerX = canvas.width / 2;
      const centerY = canvas.height / 2;
      const radius = Math.min(canvas.width, canvas.height) * 0.3;
      const angle = (stepIndex / 16) * Math.PI * 2 - Math.PI / 2;
      const x = centerX + Math.cos(angle) * radius;
      const y = centerY + Math.sin(angle) * radius;
      const curveDir = Math.random() < 0.5 ? -1 : 1;

      // Determine which instrument triggered this particle
      let instrument;
      if (snareSteps[stepIndex]) {
        instrument = "snare";
      } else if (closedHihatSteps[stepIndex]) {
        instrument = "closedhihat";
      } else if (openHihatSteps[stepIndex]) {
        instrument = "openhihat";
      } else {
        instrument = "kick";
      }

      falling.push({
        x: x,
        y: y,
        t: 0,
        angle: angle,
        curve: curveDir,
        instrument: instrument,
        path: [{ x: x, y: y }], // Track path for streak
      });
    }

    // Ensure time is always positive and valid
    const safeTime = Math.max(0, time);
    if (!isFinite(safeTime) || safeTime < 0) return;

    try {
      if (kickSteps[stepIndex]) safeAudioTrigger(kick, "C1", "8n", safeTime);
      if (closedHihatSteps[stepIndex])
        safeAudioTrigger(closedHihat, "8n", safeTime);
      if (openHihatSteps[stepIndex])
        safeAudioTrigger(openHihat, "8n", safeTime);
      if (snareSteps[stepIndex]) safeAudioTrigger(kick, "C2", "8n", safeTime);
    } catch (e) {
      // Silently ignore timing errors
      console.debug("Audio timing error (safe to ignore):", e.message);
    }
  },
  [...Array(16).keys()],
  "16n"
);

// Set a default BPM to avoid timing issues
Tone.Transport.bpm.value = 120;

/**
 * Safe wrapper for triggering audio without timing errors
 * @param {Object} synth - Tone.js synth instance
 * @param {string} note - Note to play (optional for noise synths)
 * @param {string} duration - Note duration
 * @param {number} time - Time to play
 */
function safeAudioTrigger(synth, note, duration, time) {
  try {
    // Handle case where note is optional (for noise synths)
    let actualNote = note;
    let actualDuration = duration;
    let actualTime = time;

    // If duration looks like a time (more than 2 chars), shift parameters
    if (typeof duration === "number") {
      actualTime = duration;
      actualDuration = note;
      actualNote = null;
    }

    // Validate time
    const validTime = Math.max(0, Number(actualTime) || 0);
    if (!isFinite(validTime)) return;

    // Round to reasonable precision to avoid floating point errors
    const roundedTime = Math.round(validTime * 1000000) / 1000000;

    // Validate duration
    if (!actualDuration) return;

    // Call triggerAttackRelease with or without note
    if (actualNote) {
      synth.triggerAttackRelease(actualNote, actualDuration, roundedTime);
    } else {
      synth.triggerAttackRelease(actualDuration, roundedTime);
    }
  } catch (e) {
    // Silently ignore - prevents error spam
  }
}

// --- MediaPipe setup ---
const video = document.getElementById("cam");
const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");
const readout = document.getElementById("readout");
const videoContainer = document.getElementById("videoContainer");
let recognizer;

/**
 * Resizes canvas to match the rendered video dimensions
 * This ensures landmarks are drawn in the correct positions
 */
function resizeCanvas() {
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
}

/**
 * Initializes MediaPipe gesture recognizer and camera
 */
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

  // Resize canvas to match video dimensions
  resizeCanvas();

  // Handle window resize
  window.addEventListener("resize", resizeCanvas);

  requestAnimationFrame(loop);
}

/**
 * Counts how many fingers are extended
 * @param {Array} landmarks - Hand landmarks from MediaPipe
 * @returns {number} Number of fingers up (0-5)
 */
function countFingersUp(landmarks) {
  const tipIdx = [4, 8, 12, 16, 20]; // thumb, index, middle, ring, pinky tips
  const pipIdx = [3, 6, 10, 14, 18]; // corresponding PIP joints
  let up = 0;
  for (let i = 0; i < 5; i++) {
    const tip = landmarks[tipIdx[i]];
    const pip = landmarks[pipIdx[i]];
    // Finger is "up" if tip is above PIP (lower y value in screen coords)
    if (tip && pip && tip.y < pip.y) up++;
  }
  return up;
}

/**
 * Calculates the pinch distance between thumb and index finger
 * @param {Array} landmarks - Hand landmarks
 * @returns {number|null} Distance in pixels or null if can't calculate
 */
function getPinchDistance(landmarks) {
  const thumbTip = landmarks[4];
  const indexTip = landmarks[8];
  if (!thumbTip || !indexTip) return null;
  // Use original coordinates for distance calculation (no mirroring needed)
  const dx = (thumbTip.x - indexTip.x) * canvas.width;
  const dy = (thumbTip.y - indexTip.y) * canvas.height;
  return Math.hypot(dx, dy);
}

/**
 * Checks if hand is near the BPM slider panel
 * @param {Array} landmarks - Hand landmarks
 * @returns {boolean} True if hand is near BPM slider
 */
function isHandNearBPMSlider(landmarks) {
  const indexTip = landmarks[8]; // Index finger tip
  if (!indexTip) return false;

  // Mirror x coordinate for display
  const x = canvas.width - indexTip.x * canvas.width;
  const y = indexTip.y * canvas.height;

  // BPM slider is positioned at the right side of the screen
  // Width of screen minus BPM panel width (300px) determines left edge
  const bpmPanelLeft = canvas.width - 300;

  // Check if hand is in the right panel area
  return x >= bpmPanelLeft && x <= canvas.width;
}

/**
 * Gets normalized vertical position (0-1) for BPM adjustment when near slider
 * @param {Array} landmarks - Hand landmarks
 * @returns {number|null} Normalized Y position or null if not near slider
 */
function getBPMSliderYPosition(landmarks) {
  const indexTip = landmarks[8]; // Index finger tip
  if (!indexTip) return null;

  // Mirror x coordinate for display
  const x = canvas.width - indexTip.x * canvas.width;
  const bpmPanelLeft = canvas.width - 300;

  // Only return position if near BPM slider
  if (x < bpmPanelLeft || x > canvas.width) return null;

  // Get Y position (0-1) where 0 is top of slider area (60px status bar), 1 is bottom
  const y = indexTip.y;
  const normalizedY = Math.max(0, Math.min(1, (y - 0.08) / 0.84)); // Roughly 60px-80px from top to bottom

  return normalizedY;
}

/**
 * Maps pinch distance to pattern density
 * @param {number} distance - Pinch distance in pixels
 * @returns {number} Density index (0-3)
 *
 * COMMENTED OUT - No longer used, only pinch for beat toggling
 */
/*
function getPinchDensity(distance) {
  // Map distance: 0-50px = dense (3), 50-100px = medium (1-2), 100+px = sparse (0)
  if (distance < 50) return 3;
  if (distance < 100) return 2;
  if (distance < 150) return 1;
  return 0;
}
*/

/**
 * Detects which beat vertex is being pinched based on hand position
 * @param {Array} landmarks - Hand landmarks
 * @param {number} centerX - Circle center X
 * @param {number} centerY - Circle center Y
 * @param {number} radius - Circle radius
 * @returns {number} Beat index (0-15) or -1 if not near circle
 */
function getBeatAtPinch(landmarks, centerX, centerY, radius) {
  const thumbTip = landmarks[4];
  if (!thumbTip) return -1;

  // Mirror the x-coordinate for gesture detection
  const thumbX = canvas.width - thumbTip.x * canvas.width;
  const thumbY = thumbTip.y * canvas.height;

  // Check distance from thumb to circle center
  const dx = thumbX - centerX;
  const dy = thumbY - centerY;
  const distToCenter = Math.hypot(dx, dy);

  // Must be near the circle (within 80px of the radius)
  if (Math.abs(distToCenter - radius) > 80) return -1;

  // Calculate angle from center to thumb
  let angle = Math.atan2(dy, dx);
  // Normalize to 0-2π
  if (angle < 0) angle += Math.PI * 2;
  // Adjust so 0 is at top (subtract π/2)
  angle = (angle + Math.PI / 2) % (Math.PI * 2);

  // Convert angle to beat index (0-15)
  const beatIndex = Math.round((angle / (Math.PI * 2)) * 16) % 16;
  return beatIndex;
}

/**
 * Draws a single large circle interface with pulsing animations
 */
function drawCircleInterface() {
  const centerX = canvas.width / 2;
  const centerY = canvas.height / 2;
  const radius = Math.min(canvas.width, canvas.height) * 0.35;

  // Draw circle outline
  // ctx.strokeStyle = "rgba(0, 255, 136, 0.6)";
  // ctx.lineWidth = 3;
  // ctx.beginPath();
  // ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
  // ctx.stroke();

  // Get current time for animation
  const time = Date.now() / 1000;

  // Draw beat pulses around the circle
  const numBeats = 16;
  for (let i = 0; i < numBeats; i++) {
    const angle = (i / numBeats) * Math.PI * 2 - Math.PI / 2;
    const x = centerX + Math.cos(angle) * radius;
    const y = centerY + Math.sin(angle) * radius;

    // Get the current instrument's pattern
    let currentPattern;
    switch (selectedInstrument) {
      case "kick":
        currentPattern = kickSteps;
        break;
      case "closedhihat":
        currentPattern = closedHihatSteps;
        break;
      case "openhihat":
        currentPattern = openHihatSteps;
        break;
      case "snare":
        currentPattern = snareSteps;
        break;
      default:
        currentPattern = kickSteps;
    }

    const isActive = currentPattern[i] === 1;
    const isCurrent = i === currentStep && isPlaying;
    const isSelected = i === selectedBeat;

    // Pulse only happens when beat is triggered
    let pulseAnimation = 1;
    if (lastBeatTime[i]) {
      const timeSinceBeat = Date.now() - lastBeatTime[i];
      if (timeSinceBeat < 200) {
        // Pulse for 200ms after beat trigger
        pulseAnimation = 1 + 0.5 * (1 - timeSinceBeat / 200);
      }
    }

    let circleRadius = 6; // Inactive beat - small
    let alpha = 0.6;

    if (isActive) {
      alpha = 0.95;
      circleRadius = 12 * pulseAnimation; // Active beat - bigger with pulse
    }

    if (isCurrent && isActive) {
      // Currently playing - extra pulse effect
      circleRadius = 18 * pulseAnimation;
      alpha = 1;
    }

    // Draw beat circle with glow
    if (isCurrent && isActive) {
      // Currently playing beat - pink pulse
      ctx.shadowBlur = 25;
      ctx.shadowColor = "rgba(255, 0, 136, 1)";
      ctx.fillStyle = "rgba(255, 0, 136, 1)";
    } else if (isActive) {
      // Active beat - green glow with subtle pulse
      ctx.shadowBlur = 15 * pulseAnimation;
      ctx.shadowColor = "rgba(0, 255, 136, 0.9)";
      ctx.fillStyle = `rgba(0, 255, 136, ${alpha})`;
    } else {
      // Inactive beat - small green, no glow
      ctx.shadowBlur = 0;
      ctx.fillStyle = `rgba(0, 255, 136, ${alpha})`;
    }

    ctx.beginPath();
    ctx.arc(x, y, circleRadius, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.shadowBlur = 0;

  // Draw center info
  ctx.font = "bold 20px system-ui";
  ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
  ctx.textAlign = "center";
  ctx.fillText(selectedInstrument.toUpperCase(), centerX, centerY - 10);

  // Draw pinch instruction
  if (!isPlaying) {
    ctx.font = "14px system-ui";
    ctx.fillStyle = "rgba(255, 255, 255, 0.6)";
    ctx.fillText("Pinch to start", centerX, centerY + 30);
  }
}

/**
 * Draws and animates falling particles from beats
 */
function drawFallingParticles() {
  const centerX = canvas.width / 2;
  const centerY = canvas.height / 2;

  for (let i = falling.length - 1; i >= 0; i--) {
    let obj = falling[i];
    obj.t += 0.02;

    let prog = obj.t * obj.t;
    let curvature = 60 * Math.sin(Math.PI * prog) * obj.curve;
    let perpAngle = obj.angle + (Math.PI / 2) * obj.curve;
    let fx = obj.x + (centerX - obj.x) * prog + curvature * Math.cos(perpAngle);
    let fy = obj.y + (centerY - obj.y) * prog + curvature * Math.sin(perpAngle);

    // Add current position to path
    obj.path.push({ x: fx, y: fy });
    // Keep only last 20 points for streak
    if (obj.path.length > 20) {
      obj.path.shift();
    }

    let fade = 80 * (1 - prog);
    let size = 8 * (1 - prog) + 2;

    // Assign color based on instrument
    let particleColor;
    switch (obj.instrument) {
      case "kick":
        particleColor = "rgba(77,238,234, "; // Blue
        break;
      case "snare":
        particleColor = "rgba(255, 100, 0, "; // Orange
        break;
      case "closedhihat":
        particleColor = "rgba(255, 200, 0, "; // Yellow
        break;
      case "openhihat":
        particleColor = "rgba(240,0,255, "; // Orange-Yellow
        break;
      default:
        particleColor = "rgba(0, 255, 136, "; // Default green
    }

    // Draw streak trail
    if (obj.path.length > 1) {
      ctx.strokeStyle = particleColor + (fade * 0.5) / 100 + ")";
      ctx.lineWidth = 4;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(obj.path[0].x, obj.path[0].y);
      for (let p = 1; p < obj.path.length; p++) {
        ctx.lineTo(obj.path[p].x, obj.path[p].y);
      }
      ctx.stroke();
    }

    // Draw blurred trail effect
    for (let b = 5; b > 0; b--) {
      ctx.fillStyle = particleColor + fade * (5 - b) * 0.011 + ")";
      ctx.beginPath();
      ctx.arc(fx, fy, size + b * 2, 0, Math.PI * 2);
      ctx.fill();
    }

    // Draw main particle
    ctx.fillStyle = particleColor + fade / 100 + ")";
    ctx.beginPath();
    ctx.arc(fx, fy, size, 0, Math.PI * 2);
    ctx.fill();

    if (obj.t >= 1) falling.splice(i, 1);
  }
}

/**
 * Draws hand landmarks on the canvas
 * @param {Array} landmarks - Array of landmark objects with x, y, z coordinates
 */
function drawLandmarks(landmarks) {
  // Draw connections between landmarks (hand skeleton)
  const connections = [
    [0, 1],
    [1, 2],
    [2, 3],
    [3, 4], // thumb
    [0, 5],
    [5, 6],
    [6, 7],
    [7, 8], // index
    [0, 9],
    [9, 10],
    [10, 11],
    [11, 12], // middle
    [0, 13],
    [13, 14],
    [14, 15],
    [15, 16], // ring
    [0, 17],
    [17, 18],
    [18, 19],
    [19, 20], // pinky
    [5, 9],
    [9, 13],
    [13, 17], // palm
  ];

  // Draw connections with glow effect
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 4;
  ctx.shadowBlur = 15;
  ctx.shadowColor = "rgba(255, 255, 255, 0.8)";

  for (const [start, end] of connections) {
    const a = landmarks[start];
    const b = landmarks[end];
    if (a && b) {
      // Mirror the x-coordinate
      const aX = canvas.width - a.x * canvas.width;
      const aY = a.y * canvas.height;
      const bX = canvas.width - b.x * canvas.width;
      const bY = b.y * canvas.height;

      ctx.beginPath();
      ctx.moveTo(aX, aY);
      ctx.lineTo(bX, bY);
      ctx.stroke();
    }
  }

  // Draw landmark points
  for (let i = 0; i < landmarks.length; i++) {
    const lm = landmarks[i];
    // Mirror the x-coordinate
    const x = canvas.width - lm.x * canvas.width;
    const y = lm.y * canvas.height;

    // Different colors for fingertips vs other points
    const isFingertip = [4, 8, 12, 16, 20].includes(i);

    if (isFingertip) {
      // Brighter glow for fingertips
      ctx.shadowBlur = 20;
      ctx.shadowColor = "rgb(253, 253, 253)";
      ctx.fillStyle = "#ff0088";
    } else {
      ctx.shadowBlur = 10;
      ctx.shadowColor = "rgba(255, 255, 255, 0.8)";
      ctx.fillStyle = "#ffffff";
    }

    ctx.beginPath();
    ctx.arc(x, y, isFingertip ? 10 : 6, 0, Math.PI * 2);
    ctx.fill();
  }

  // Reset shadow
  ctx.shadowBlur = 0;

  // DEBUG: Draw pinch debug info
  const thumbTip = landmarks[4];
  const indexTip = landmarks[8];

  if (thumbTip && indexTip) {
    // Mirror the coordinates for display
    const thumbX = canvas.width - thumbTip.x * canvas.width;
    const thumbY = thumbTip.y * canvas.height;
    const indexX = canvas.width - indexTip.x * canvas.width;
    const indexY = indexTip.y * canvas.height;

    // Draw line between thumb and index
    ctx.strokeStyle = "rgba(255, 255, 0, 0.6)";
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    ctx.moveTo(thumbX, thumbY);
    ctx.lineTo(indexX, indexY);
    ctx.stroke();
    ctx.setLineDash([]);

    // Calculate and display distance
    const dx = indexX - thumbX;
    const dy = indexY - thumbY;
    const distance = Math.hypot(dx, dy);

    // Draw distance text at midpoint
    const midX = (thumbX + indexX) / 2;
    const midY = (thumbY + indexY) / 2;

    ctx.fillStyle = "rgba(255, 255, 0, 0.9)";
    ctx.font = "bold 14px system-ui";
    ctx.fillText(`${Math.round(distance)}px`, midX - 20, midY - 10);

    // Draw threshold indicator
    if (distance < 80) {
      ctx.fillStyle = "rgba(0, 255, 136, 0.8)";
      ctx.font = "12px system-ui";
      ctx.fillText("PINCH ACTIVE ✓", midX - 40, midY + 15);
    }
  }
}

/**
 * Main animation loop - processes hand tracking and updates visuals
 */
function loop() {
  if (!recognizer) return;

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawCircleInterface();
  drawFallingParticles();

  const now = performance.now();
  const res = recognizer.recognizeForVideo(video, now);

  if (res?.landmarks?.[0]) {
    const lm = res.landmarks[0];

    drawLandmarks(lm);

    const fingers = countFingersUp(lm);
    const pinchDist = getPinchDistance(lm);

    // Gesture detection:
    // - Pinch (thumb & index close) = toggle beats for selected instrument
    // - 1 finger (pointer) = pause sequence
    // - 2 fingers (peace sign) = stop all audio

    if (fingers === 1) {
      // Pointer finger - pause sequence
      if (isPlaying) {
        try {
          Tone.Transport.pause();
        } catch (e) {
          // Ignore timing errors
        }
        if (playStatusDisplay) playStatusDisplay.textContent = "Paused";
        readout.textContent = "👆 PAUSED";
      }
      wasPinching = false;
    } else if (fingers === 2) {
      // Peace sign - stop audio
      if (isPlaying) {
        try {
          Tone.Transport.stop();
          seq.stop();
        } catch (e) {
          // Ignore timing errors
        }
        isPlaying = false;
        selectedBeat = -1;
        readout.textContent = "✌️ STOPPED";
        if (playStatusDisplay) playStatusDisplay.textContent = "Paused";
      }
      wasPinching = false;
    } else if (pinchDist !== null && pinchDist < 80) {
      // Close pinch detected - check if near BPM slider
      const nearBPM = isHandNearBPMSlider(lm);

      if (nearBPM) {
        // Adjust BPM based on vertical hand position while pinching
        const sliderY = getBPMSliderYPosition(lm);

        if (sliderY !== null) {
          // Map vertical position to BPM (top = 180 BPM, bottom = 60 BPM)
          // Invert because Y=0 is top, we want higher BPM at top
          const newBPM = Math.round(60 + (1 - sliderY) * 120);
          currentBPM = Math.max(60, Math.min(180, newBPM));

          try {
            Tone.Transport.bpm.rampTo(currentBPM, 0.1);
          } catch (e) {
            // Ignore timing errors
          }
          updateBPMSlider();

          readout.textContent = `🎵 BPM: ${currentBPM} | Pinch: ${Math.round(
            pinchDist
          )}px`;
        }

        wasAdjustingBPM = true;
        wasPinching = false;
        lastPinchDistance = null; // Don't track for BPM adjustment
      } else {
        // Beat toggle mode
        const centerX = canvas.width / 2;
        const centerY = canvas.height / 2;
        const radius = Math.min(canvas.width, canvas.height) * 0.35;

        const beatAtPinch = getBeatAtPinch(lm, centerX, centerY, radius);

        // DEBUG: Show pinch detection in real-time
        if (beatAtPinch >= 0) {
          readout.textContent = `🫶 PINCHING | Distance: ${Math.round(
            pinchDist
          )}px | Beat: ${beatAtPinch + 1} | Status: ${
            wasPinching ? "holding" : "pressed"
          }`;
        } else {
          readout.textContent = `🫶 PINCH TOO FAR | Distance: ${Math.round(
            pinchDist
          )}px (need < 80px)`;
        }

        // Toggle beat on first pinch detection
        if (!wasPinching && beatAtPinch >= 0) {
          // Get the current instrument's pattern
          let currentPattern;
          switch (selectedInstrument) {
            case "kick":
              currentPattern = kickSteps;
              break;
            case "closedhihat":
              currentPattern = closedHihatSteps;
              break;
            case "openhihat":
              currentPattern = openHihatSteps;
              break;
            case "snare":
              currentPattern = snareSteps;
              break;
            default:
              currentPattern = kickSteps;
          }

          // Toggle the beat on/off for the selected instrument
          currentPattern[beatAtPinch] =
            currentPattern[beatAtPinch] === 1 ? 0 : 1;
          selectedBeat = beatAtPinch;
          lastPinchBeat = beatAtPinch;
          wasPinching = true;

          // Start playback if stopped
          if (!isPlaying) {
            try {
              seq.start(0);
              Tone.Transport.start();
            } catch (e) {
              // Ignore timing errors
            }
            isPlaying = true;
            if (playStatusDisplay) playStatusDisplay.textContent = "Playing";
          }

          const density = currentPattern.reduce((a, b) => a + b, 0);
          readout.textContent = `✨ ${selectedInstrument.toUpperCase()} Beat ${
            beatAtPinch + 1
          } ${
            currentPattern[beatAtPinch] === 1 ? "ON" : "OFF"
          } | Pattern: ${density}/16`;
        }
      }
    } else {
      // No pinch detected or open hand
      wasPinching = false;
      selectedBeat = -1;
      lastPinchDistance = null; // Reset pinch distance tracking
      wasAdjustingBPM = false;

      if (pinchDist !== null) {
        // Show open hand pinch distance
        readout.textContent = `👐 OPEN HAND | Distance: ${Math.round(
          pinchDist
        )}px (threshold: < 80px for pinch)`;
      } else if (!isPlaying) {
        readout.textContent = "👋 Pinch beats to toggle ON/OFF";
      }
    }
  } else {
    // No hand detected
    readout.textContent = isPlaying ? "🎵 Playing" : "👋 Show your hand";
  }

  requestAnimationFrame(loop);
}

/**
 * Initialize UI elements and event listeners
 */
function initializeUI() {
  // Get UI elements
  bpmSlider = document.getElementById("bpmSlider");
  bpmSliderFill = document.getElementById("bpmSliderFill");
  currentBPMDisplay = document.getElementById("currentBPM");
  playStatusDisplay = document.getElementById("playStatus");

  // Set up BPM slider
  updateBPMSlider();
  bpmSlider.addEventListener("click", handleBPMSliderClick);

  // Set up instrument buttons
  document.querySelectorAll(".instrument-button").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      document
        .querySelectorAll(".instrument-button")
        .forEach((b) => b.classList.remove("active"));
      e.target.classList.add("active");

      // Switch to the selected instrument
      selectedInstrument = e.target.dataset.instrument;
      readout.textContent = `🎵 Editing ${selectedInstrument.toUpperCase()} pattern`;
    });
  });

  // Set up action buttons
  document
    .getElementById("clearAll")
    .addEventListener("click", clearAllPatterns);
}

/**
 * Update BPM slider visual
 */
function updateBPMSlider() {
  const percentage = ((currentBPM - 60) / (180 - 60)) * 100;
  bpmSliderFill.style.height = percentage + "%";
  currentBPMDisplay.textContent = currentBPM + " BPM";
}

/**
 * Handle BPM slider clicks
 */
function handleBPMSliderClick(e) {
  const rect = bpmSlider.getBoundingClientRect();
  const y = e.clientY - rect.top;
  const percentage = 1 - y / rect.height;
  currentBPM = Math.round(60 + percentage * 120);
  currentBPM = Math.max(60, Math.min(180, currentBPM));

  Tone.Transport.bpm.rampTo(currentBPM, 0.1);
  updateBPMSlider();
}

/**
 * Clear all patterns
 */
function clearAllPatterns() {
  kickSteps.fill(0);
  closedHihatSteps.fill(0);
  openHihatSteps.fill(0);
  snareSteps.fill(0);
  readout.textContent = "🧹 Cleared all patterns";
}

/**
 * Start button handler - initializes audio and camera
 */
document.getElementById("start").addEventListener("click", async () => {
  await Tone.start();
  if (!recognizer) await initMP();
  videoContainer.classList.add("active");

  const card = document.querySelector(".card");
  card.classList.add("hidden");

  initializeUI();
  readout.textContent = "👋 Pinch beats to toggle ON/OFF";
});

/**
 * Global error handler to suppress Tone.js timing errors
 */
window.addEventListener("error", (event) => {
  // Suppress RangeError from Tone.js timing precision issues
  if (
    event.error &&
    event.error.message &&
    event.error.message.includes("Value must be within [0, Infinity]")
  ) {
    event.preventDefault();
    return true;
  }
});

/**
 * Handle unhandled promise rejections (async errors)
 */
window.addEventListener("unhandledrejection", (event) => {
  if (
    event.reason &&
    event.reason.message &&
    event.reason.message.includes("Value must be within [0, Infinity]")
  ) {
    event.preventDefault();
    return true;
  }
});
