import { state } from "./state.js";

let onRecordTemp = null;
let lastFrameLuma = null;

export function setRecordCallback(fn) {
  onRecordTemp = fn;
}

function extractTemperatureFromText(text) {
  const s = text.replace(/[^\d]/g, "");
  if (!s) return null;

  const lastBT = state.logs.length ? state.logs[state.logs.length - 1].bt : null;
  const highTempContext = (lastBT !== null && lastBT >= 150.0) || state.seconds >= 50 || state.yellowSec !== null || state.firstCrackSec !== null;

  if (highTempContext && s.length === 3) {
    const intVal = parseFloat(s);
    if (intVal >= 175 && intVal <= 260) return intVal;
  }

  if (s.length >= 3 && s.length <= 4) {
    const decVal = parseFloat(s) / 10.0;
    if (lastBT !== null && Math.abs(parseFloat(s) - lastBT) < Math.abs(decVal - lastBT) && parseFloat(s) >= 175 && parseFloat(s) <= 260) {
      return parseFloat(s);
    }
    if (decVal >= 12 && decVal <= 260) return decVal;
  }
  return null;
}

function isReasonableReading(val) {
  if (val < 12 || val > 260) return false;
  if (state.allowNextJump) return true;
  if (!state.logs.length) return true;
  const last = state.logs[state.logs.length - 1];
  if (last.bt >= 140 && val < 60) return false;
  const dt = Math.max(state.seconds - last.sec, 1);
  const allowedJump = Math.min(9.0 * dt + 5.0, 45.0);
  return Math.abs(val - last.bt) <= allowedJump;
}

function ingestOCRValue(val) {
  const now = Date.now();
  document.getElementById("ocrStatusLabel").textContent = `인식 ${val.toFixed(1)}℃`;
  state.recentReadings = state.recentReadings.filter((r) => now - r.time <= 1500);

  const matched = state.recentReadings.find((r) => Math.abs(r.value - val) <= 3.5) || null;
  state.recentReadings.push({ value: val, time: now });
  if (state.recentReadings.length > 3) state.recentReadings.shift();

  if (!matched) return;
  if (now - state.lastEmitTime < 450) return;
  state.lastEmitTime = now;

  const agreed = Math.round(((val + matched.value) / 2.0) * 10) / 10;

  if (isReasonableReading(agreed)) {
    state.allowNextJump = false;
    state.lastAcceptedTime = now;
    document.getElementById("ocrDot").style.background = "var(--green)";
    document.getElementById("stallBanner").classList.remove("active");
    if (onRecordTemp) onRecordTemp("", agreed);
  } else {
    document.getElementById("ocrDot").style.background = "var(--red)";
  }
}

export async function toggleCamera() {
  const video = document.getElementById("cameraVideo");
  const btn = document.getElementById("camToggleBtn");
  const ocrBtn = document.getElementById("ocrToggleBtn");

  if (state.cameraStream) {
    state.cameraStream.getTracks().forEach((t) => t.stop());
    state.cameraStream = null;
    video.srcObject = null;
    state.ocrEnabled = false;
    btn.classList.remove("active-mint");
    ocrBtn.disabled = true;
    ocrBtn.classList.remove("active-amber");
    document.getElementById("ocrStatusLabel").textContent = "카메라 꺼짐";
    return;
  }

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    alert("카메라 기능은 HTTPS 환경의 Safari에서 작동합니다.");
    return;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false
    });
    state.cameraStream = stream;
    video.srcObject = stream;
    btn.classList.add("active-mint");
    ocrBtn.disabled = false;
    document.getElementById("ocrStatusLabel").textContent = "OCR 대기";
  } catch {
    alert("설정 > Safari > 카메라 권한을 허용해주세요.");
  }
}

export function setCameraZoom(level) {
  state.zoomLevel = level;
  [1, 2, 3].forEach((z) => {
    document.getElementById(`zoom${z}`).classList.toggle("active", z === level);
  });
  document.getElementById("cameraVideo").style.transform = `scale(${level})`;
}

export async function toggleOCR() {
  const ocrBtn = document.getElementById("ocrToggleBtn");
  state.ocrEnabled = !state.ocrEnabled;
  if (!state.ocrEnabled) {
    ocrBtn.classList.remove("active-amber");
    document.getElementById("ocrStatusLabel").textContent = "OCR 꺼짐";
    document.getElementById("stallBanner").classList.remove("active");
    return;
  }

  if (typeof window.Tesseract === "undefined") {
    alert("OCR 엔진을 불러오는 중입니다. 잠시 후 다시 시도해주세요.");
    state.ocrEnabled = false;
    return;
  }

  ocrBtn.classList.add("active-amber");
  state.lastAcceptedTime = Date.now();
  document.getElementById("ocrStatusLabel").textContent = "엔진 준비중";

  try {
    if (!state.ocrWorker) {
      state.ocrWorker = await window.Tesseract.createWorker("eng");
      await state.ocrWorker.setParameters({
        tessedit_char_whitelist: "0123456789",
        tessedit_pageseg_mode: "7"
      });
    }
    document.getElementById("ocrStatusLabel").textContent = "인식 중";
    runOCRLoop();
  } catch {
    document.getElementById("ocrStatusLabel").textContent = "초기화 실패";
  }
}

function apply7SegmentDilation(ctx, width, height) {
  const imgData = ctx.getImageData(0, 0, width, height);
  const data = imgData.data;
  const bin = new Uint8Array(width * height);
  let sum = 0;

  for (let i = 0; i < data.length; i += 4) {
    const luma = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
    data[i] = data[i + 1] = data[i + 2] = luma;
    sum += luma;
  }
  const threshold = (sum / (width * height)) * 0.85;

  for (let j = 0; j < data.length; j += 4) {
    bin[j / 4] = data[j] < threshold ? 1 : 0;
  }

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = y * width + x;
      const p = idx * 4;
      if (bin[idx] === 0) {
        if (bin[idx - 1] === 1 || bin[idx + 1] === 1 || bin[idx - width] === 1 || bin[idx + width] === 1) {
          data[p] = data[p + 1] = data[p + 2] = 0;
        } else {
          data[p] = data[p + 1] = data[p + 2] = 255;
        }
      } else {
        data[p] = data[p + 1] = data[p + 2] = 0;
      }
    }
  }
  ctx.putImageData(imgData, 0, 0);
}

function isFrameStable(ctx, width, height) {
  const data = ctx.getImageData(width / 2 - 20, height / 2 - 20, 40, 40).data;
  if (!lastFrameLuma) {
    lastFrameLuma = data;
    return false;
  }
  let diff = 0;
  for (let i = 0; i < data.length; i += 4) {
    diff += Math.abs(data[i] - lastFrameLuma[i]);
  }
  lastFrameLuma = data;
  return (diff / (40 * 40)) < 12.0;
}

async function runOCRLoop() {
  if (!state.ocrEnabled || !state.cameraStream) return;
  if (!state.ocrBusy) {
    state.ocrBusy = true;
    try {
      const video = document.getElementById("cameraVideo");
      const canvas = document.getElementById("ocrCanvas");
      if (video.videoWidth > 0) {
        const vw = video.videoWidth / state.zoomLevel;
        const vh = video.videoHeight / state.zoomLevel;
        const cropW = vw * 0.48;
        const cropH = vh * 0.40;
        const sx = (video.videoWidth - cropW) / 2;
        const sy = (video.videoHeight - cropH) / 2;

        canvas.width = 300;
        canvas.height = 120;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        ctx.drawImage(video, sx, sy, cropW, cropH, 0, 0, canvas.width, canvas.height);

        if (isFrameStable(ctx, canvas.width, canvas.height)) {
          apply7SegmentDilation(ctx, canvas.width, canvas.height);
          const res = await state.ocrWorker.recognize(canvas);
          const temp = extractTemperatureFromText(res.data.text);
          if (temp !== null) ingestOCRValue(temp);
        }
      }
    } catch {}
    state.ocrBusy = false;
  }
  if (state.ocrEnabled) setTimeout(runOCRLoop, 180);
}

export function forceSyncOCR() {
  state.allowNextJump = true;
  state.recentReadings = [];
  state.lastAcceptedTime = Date.now();
  document.getElementById("stallBanner").classList.remove("active");
}
