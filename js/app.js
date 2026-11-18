import {
  state,
  PRESETS,
  formatTime,
  safeSaveProfile,
  saveActiveSession,
  restoreActiveSession,
  clearActiveSession,
  calculateRoR,
  getTurningPoint,
  getTargetBTAt
} from "./state.js";
import { initChart, updateChart } from "./chart.js";
import { toggleCamera, setCameraZoom, toggleOCR, forceSyncOCR, setRecordCallback } from "./ocr.js";
import { generateLightReport, downloadCSVLog, shareReport } from "./report.js";

// =========================================================================
// WakeLock
// =========================================================================
async function requestWakeLock() {
  if ("wakeLock" in navigator) {
    try { await navigator.wakeLock.request("screen"); } catch {}
  }
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && state.isRunning) {
    requestWakeLock();
  }
});

// =========================================================================
// Timer & Roasting Core
// =========================================================================
function tick() {
  state.seconds = Math.floor((Date.now() - state.startTimeMs) / 1000);
  if (state.ocrEnabled && (Date.now() - state.lastAcceptedTime > 6500)) {
    document.getElementById("stallBanner").classList.add("active");
  } else {
    document.getElementById("stallBanner").classList.remove("active");
  }
  updateChart();
  updateUI();
}

function toggleRoastTimer() {
  if (state.isDropped) return;
  requestWakeLock();
  if (state.isRunning) {
    clearInterval(state.timerId);
    state.isRunning = false;
  } else {
    const isFirstStart = (state.seconds === 0 && state.logs.length === 0);
    state.startTimeMs = Date.now() - state.seconds * 1000;
    state.timerId = setInterval(tick, 1000);
    state.isRunning = true;

    if (isFirstStart) {
      state.chargeSec = 0;
      recordData("투입");
    }
  }
  saveActiveSession();
  updateUI();
}

function confirmPause() {
  if (confirm("로스팅 타이머를 일시정지하시겠습니까?")) {
    toggleRoastTimer();
  }
}

function recordData(event = "", explicitBT = null) {
  if (!state.isRunning && state.seconds === 0 && event !== "투입") {
    toggleRoastTimer();
  }
  const lastBT = state.logs.length ? state.logs[state.logs.length - 1].bt : 0;
  const bt = explicitBT !== null ? explicitBT : (parseFloat(state.btBuffer) || lastBT);
  if (!bt || bt <= 0) return;

  const ror = calculateRoR(bt, state.seconds);
  state.logs.push({
    sec: state.seconds,
    timeStr: formatTime(state.seconds),
    bt,
    ror,
    gas: state.gas,
    event
  });
  state.currentRoR = ror;
  state.btBuffer = "";
  saveActiveSession();
  updateChart();
  updateUI();
}

setRecordCallback(recordData);

// =========================================================================
// Heater Knob, Milestones & Hold-to-Drop
// =========================================================================
function adjustGas(delta) {
  if (state.isDropped) return;
  const val = Math.round((state.gas + delta) * 10) / 10;
  state.gas = Math.min(8.0, Math.max(4.0, val));
  document.getElementById("gasSlider").value = state.gas;
  document.getElementById("gasValLabel").textContent = state.gas.toFixed(1) + "단";
}

function onGasSliderChange(val) {
  state.gas = Math.round(parseFloat(val) * 10) / 10;
  document.getElementById("gasValLabel").textContent = state.gas.toFixed(1) + "단";
}

function handleMilestone(type) {
  if (state.isDropped) return;
  if (type === "옐로우") {
    if (state.yellowSec !== null) {
      if (confirm("옐로우 기록을 취소하시겠습니까?")) {
        state.yellowSec = null;
        removeEventLog("옐로우");
      }
      return;
    }
    state.yellowSec = state.seconds;
    recordData("옐로우");
  } else if (type === "1차 크랙") {
    if (state.firstCrackSec !== null) {
      if (confirm("1차 팝 기록을 취소하시겠습니까?")) {
        state.firstCrackSec = null;
        removeEventLog("1차 크랙");
      }
      return;
    }
    state.firstCrackSec = state.seconds;
    recordData("1차 크랙");
  }
  updateUI();
}

function removeEventLog(evName) {
  for (let i = state.logs.length - 1; i >= 0; i--) {
    if (state.logs[i].event === evName) {
      state.logs.splice(i, 1);
      break;
    }
  }
  saveActiveSession();
  updateChart();
  updateUI();
}

function deleteLastLog() {
  const removed = state.logs.pop();
  if (!removed) return;
  if (removed.event === "투입") state.chargeSec = null;
  if (removed.event === "옐로우") state.yellowSec = null;
  if (removed.event === "1차 크랙") state.firstCrackSec = null;
  state.currentRoR = state.logs.length ? state.logs[state.logs.length - 1].ror : 0;
  saveActiveSession();
  updateChart();
  updateUI();
}

function setupHoldToDrop() {
  const bar = document.getElementById("holdDropBar");
  const fill = document.getElementById("holdDropFill");
  const label = document.getElementById("holdDropText");
  let holdStart = 0;
  let animFrame = null;
  let holding = false;

  function startHold(e) {
    if (state.isDropped) return;
    if (e.cancelable) e.preventDefault();
    holding = true;
    holdStart = performance.now();
    label.textContent = "계속 누르고 계세요";
    function step(now) {
      if (!holding) return;
      const pct = Math.min(100, ((now - holdStart) / 1000) * 100);
      fill.style.width = `${pct}%`;
      if (pct >= 100) {
        holding = false;
        fill.style.width = "0%";
        markDrop();
      } else {
        animFrame = requestAnimationFrame(step);
      }
    }
    animFrame = requestAnimationFrame(step);
  }

  function endHold() {
    if (!holding) return;
    holding = false;
    cancelAnimationFrame(animFrame);
    fill.style.width = "0%";
    label.textContent = "1초간 길게 눌러야 배출됩니다";
    setTimeout(() => {
      if (!holding) label.textContent = "길게 눌러 배출 (1초)";
    }, 1400);
  }

  bar.addEventListener("pointerdown", startHold);
  bar.addEventListener("touchstart", startHold, { passive: false });
  window.addEventListener("pointerup", endHold);
  window.addEventListener("touchend", endHold);
  window.addEventListener("pointercancel", endHold);
}

function markDrop() {
  if (state.isDropped) return;
  state.isDropped = true;
  state.dropSec = state.seconds;
  recordData("배출");
  clearInterval(state.timerId);
  state.isRunning = false;
  if (state.ocrEnabled) toggleOCR();
  saveActiveSession();
  updateUI();
}

function undoDrop() {
  if (!state.isDropped || state.isFinished) return;
  state.isDropped = false;
  state.dropSec = null;
  removeEventLog("배출");
  toggleRoastTimer();
}

// =========================================================================
// UI Sync
// =========================================================================
function updateUI() {
  document.getElementById("timerDisplay").textContent = formatTime(state.seconds);
  document.getElementById("pauseBtn").style.display = (state.isRunning && !state.isDropped) ? "inline-flex" : "none";
  document.getElementById("exportBtn").disabled = state.logs.length === 0;
  document.getElementById("delLastLogBtn").style.visibility = (state.logs.length > 0 && !state.isDropped) ? "visible" : "hidden";

  const dot = document.getElementById("statusDot");
  const stText = document.getElementById("statusText");
  if (state.isFinished) {
    dot.style.background = "var(--green)"; stText.style.color = "var(--green)"; stText.textContent = "저장 완료";
  } else if (state.isDropped) {
    dot.style.background = "var(--accent)"; stText.style.color = "var(--accent)"; stText.textContent = "무게 입력 대기";
  } else if (state.firstCrackSec !== null) {
    dot.style.background = "var(--accent)"; stText.style.color = "var(--accent)"; stText.textContent = "디벨롭 진행 중";
  } else if (state.yellowSec !== null) {
    dot.style.background = "var(--yellow)"; stText.style.color = "var(--yellow)"; stText.textContent = "메이야르 진행 중";
  } else if (state.isRunning) {
    dot.style.background = "var(--green)"; stText.style.color = "var(--text)"; stText.textContent = "로스팅 중";
  } else {
    dot.style.background = "var(--text-muted)"; stText.style.color = "var(--text-muted)";
    stText.textContent = state.seconds > 0 ? "일시정지" : "로스팅 대기";
  }

  const lastBT = state.logs.length ? state.logs[state.logs.length - 1].bt : 0;
  document.getElementById("heroBT").textContent = lastBT > 0 ? lastBT.toFixed(1) : "--.-";
  document.getElementById("heroRoR").textContent = (state.currentRoR >= 0 ? "+" : "") + state.currentRoR.toFixed(1);

  const guideRow = document.getElementById("heroGuidanceRow");
  if (state.profilePoints.length > 0) {
    guideRow.style.display = "flex";
    const target = getTargetBTAt(state.isDropped ? (state.dropSec || state.seconds) : state.seconds);
    document.getElementById("targetBTLabel").textContent = `목표 ${target.toFixed(1)}℃`;
    const gLabel = document.getElementById("heaterGuidanceLabel");
    if (lastBT > 0) {
      const delta = lastBT - target;
      if (delta >= 3.0) {
        gLabel.textContent = `+${delta.toFixed(1)}℃ 초과 · 감발 권장`;
        gLabel.style.color = "var(--accent)";
      } else if (delta <= -3.0) {
        gLabel.textContent = `${delta.toFixed(1)}℃ 부족 · 증발 권장`;
        gLabel.style.color = "var(--accent)";
      } else {
        gLabel.textContent = `궤적 일치 (${delta >= 0 ? "+" : ""}${delta.toFixed(1)}℃)`;
        gLabel.style.color = "var(--green)";
      }
    }
  } else {
    guideRow.style.display = "none";
  }

  const effSec = state.isDropped ? (state.dropSec || state.seconds) : state.seconds;
  let dtrStr = "0.0%";
  let devStr = "00:00";
  if (state.firstCrackSec !== null && effSec >= state.firstCrackSec && effSec > 0) {
    const dev = effSec - state.firstCrackSec;
    devStr = formatTime(dev);
    dtrStr = `${((dev / effSec) * 100).toFixed(1)}%`;
  }
  document.getElementById("metricDTR").textContent = dtrStr;
  document.getElementById("metricDevTime").textContent = devStr;

  const tp = getTurningPoint();
  document.getElementById("metricTP").textContent = tp ? `${tp.bt.toFixed(0)}℃` : "- ℃";

  const total = Math.max(effSec, 1);
  const ySec = state.yellowSec !== null ? state.yellowSec : Math.min(total, state.firstCrackSec !== null ? state.firstCrackSec : total);
  const fcSec = state.firstCrackSec !== null ? state.firstCrackSec : total;
  const dryS = Math.max(0, Math.min(ySec, total));
  const mailS = Math.max(0, Math.min(fcSec, total) - dryS);
  const devS = Math.max(0, total - Math.max(dryS, Math.min(fcSec, total)));

  const dryPct = (dryS / total) * 100;
  const mailPct = (mailS / total) * 100;
  const devPct = (devS / total) * 100;

  document.getElementById("dryTime").textContent = formatTime(dryS);
  document.getElementById("dryPct").textContent = `${dryPct.toFixed(1)}%`;
  document.getElementById("mailTime").textContent = formatTime(mailS);
  document.getElementById("mailPct").textContent = `${mailPct.toFixed(1)}%`;
  document.getElementById("devPhaseTime").textContent = formatTime(devS);
  document.getElementById("devPhasePct").textContent = `${devPct.toFixed(1)}%`;

  document.getElementById("barDry").style.width = `${dryPct}%`;
  document.getElementById("barMail").style.width = `${mailPct}%`;
  document.getElementById("barDev").style.width = `${devPct}%`;

  const bYellow = document.getElementById("btnYellow");
  bYellow.textContent = state.yellowSec !== null ? "✓ 옐로우" : "옐로우";
  bYellow.classList.toggle("marked", state.yellowSec !== null);

  const bCrack = document.getElementById("btnCrack");
  bCrack.textContent = state.firstCrackSec !== null ? "✓ 1차 팝" : "1차 팝";
  bCrack.classList.toggle("marked", state.firstCrackSec !== null);

  const startBtn = document.getElementById("mainStartBtn");
  const holdBar = document.getElementById("holdDropBar");
  const afterRow = document.getElementById("afterDropRow");

  if (state.isDropped) {
    startBtn.style.display = "none";
    holdBar.style.display = "none";
    afterRow.style.display = "flex";
  } else if (state.isRunning) {
    startBtn.style.display = "none";
    holdBar.style.display = "flex";
    afterRow.style.display = "none";
  } else {
    startBtn.style.display = "flex";
    document.getElementById("mainStartText").textContent = state.seconds > 0 ? "타이머 재개" : "로스팅 시작";
    holdBar.style.display = "none";
    afterRow.style.display = "none";
  }

  const tbody = document.getElementById("logBody");
  tbody.innerHTML = state.logs.slice().reverse().map((l) => {
    const note = l.event ? l.event : dtrStr;
    const color = l.event ? "var(--accent)" : "var(--text)";
    return `<div class="log-row" style="color:${color}">` +
      `<span>${l.timeStr}</span>` +
      `<span>${l.bt.toFixed(1)}</span>` +
      `<span style="color:var(--ror)">${l.ror.toFixed(1)}</span>` +
      `<span style="color:var(--text-sec)">${l.gas.toFixed(1)}</span>` +
      `<span>${note}</span>` +
      `<span></span>` +
    `</div>`;
  }).join("");
}

// =========================================================================
// Inline Keypad (Collapsible + 3-digit Auto-Commit) + Keyboard
// =========================================================================
let keypadResetTimer = null;

function toggleKeypad(forceOpen) {
  const panel = document.getElementById("inlineKeypadPanel");
  const btn = document.getElementById("keypadToggleBtn");
  const text = document.getElementById("keypadToggleText");
  const isCollapsed = typeof forceOpen === "boolean"
    ? !forceOpen
    : !panel.classList.contains("collapsed");

  panel.classList.toggle("collapsed", isCollapsed);
  btn.setAttribute("aria-expanded", String(!isCollapsed));
  text.textContent = isCollapsed ? "열기" : "닫기";
  try { localStorage.setItem("roast_keypad_open", isCollapsed ? "0" : "1"); } catch {}
}

function commitKeypadValue(val) {
  const display = document.getElementById("inlineKeypadDisplay");
  state.allowNextJump = true;
  recordData("", val);
  state.btBuffer = "";

  if (keypadResetTimer) clearTimeout(keypadResetTimer);
  display.style.color = "var(--green)";
  display.textContent = `${val}℃ ✓`;
  keypadResetTimer = setTimeout(() => {
    display.style.color = "var(--accent)";
    display.textContent = `${state.btBuffer || "---"} ℃`;
  }, 650);
}

function pressKey(k) {
  const display = document.getElementById("inlineKeypadDisplay");
  if (keypadResetTimer) {
    clearTimeout(keypadResetTimer);
    keypadResetTimer = null;
    display.style.color = "var(--accent)";
  }

  if (k === "DEL") {
    state.btBuffer = state.btBuffer.slice(0, -1);
  } else if (k === "ENT") {
    if (state.btBuffer) {
      const entVal = parseFloat(state.btBuffer);
      if (!isNaN(entVal) && entVal > 0) {
        commitKeypadValue(entVal);
        return;
      }
    }
  } else {
    state.btBuffer += k;
    if (state.btBuffer.length >= 3) {
      const autoVal = parseFloat(state.btBuffer.slice(0, 3));
      if (!isNaN(autoVal) && autoVal > 0) {
        commitKeypadValue(autoVal);
        return;
      }
      state.btBuffer = "";
    }
  }
  display.textContent = `${state.btBuffer || "---"} ℃`;
}

function quickRecordTemp(val) {
  commitKeypadValue(val);
}

window.addEventListener("keydown", (e) => {
  if (document.querySelector("dialog[open]")) return;
  if (e.target && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA")) return;
  if (e.key >= "0" && e.key <= "9") pressKey(e.key);
  else if (e.key === "Backspace") pressKey("DEL");
  else if (e.key === "Enter") pressKey("ENT");
});

// =========================================================================
// Native Top-Layer Dialogs
// =========================================================================
let supportsDisplayTransition;
function canTransitionDisplay() {
  if (supportsDisplayTransition !== undefined) return supportsDisplayTransition;
  if (!window.CSS?.supports?.("transition-behavior", "allow-discrete") || !document.body) {
    return false;
  }
  const probe = document.createElement("div");
  probe.style.cssText = "transition: display 1s allow-discrete !important; display: block;";
  document.body.appendChild(probe);
  getComputedStyle(probe).display;
  probe.style.display = "none";
  supportsDisplayTransition = getComputedStyle(probe).display === "block";
  probe.remove();
  return supportsDisplayTransition;
}

function supportsTopLayerExit() {
  return Boolean(window.CSS?.supports?.("overlay", "auto") && canTransitionDisplay());
}

async function closeTopLayer(dialog) {
  if (!dialog || !dialog.open) return;
  if (!supportsTopLayerExit()) {
    dialog.setAttribute("data-closing", "");
    const animations = dialog.getAnimations ? dialog.getAnimations({ subtree: true }) : [];
    if (animations.length > 0) {
      await Promise.race([
        Promise.allSettled(animations.map((a) => a.finished)),
        new Promise((r) => setTimeout(r, 300))
      ]);
    }
    if (!dialog.hasAttribute("data-closing")) return;
    dialog.removeAttribute("data-closing");
  }
  dialog.close();
}

function openModal(id) {
  const dialog = document.getElementById(id);
  if (dialog && !dialog.open) {
    dialog.removeAttribute("data-closing");
    dialog.showModal();
  }
}

function closeModal(id) {
  closeTopLayer(document.getElementById(id));
}

document.querySelectorAll("dialog.modal-dialog").forEach((dialog) => {
  dialog.addEventListener("cancel", (e) => {
    e.preventDefault();
    closeTopLayer(dialog);
  });

  if (!("closedBy" in HTMLDialogElement.prototype)) {
    let pressedOutside = false;
    const isOutside = (e) => {
      const r = dialog.getBoundingClientRect();
      return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
    };
    dialog.addEventListener("pointerdown", (e) => { pressedOutside = isOutside(e); });
    dialog.addEventListener("pointerup", (e) => {
      if (pressedOutside && isOutside(e)) closeTopLayer(dialog);
    });
  }
});

// =========================================================================
// Profile, Bean & Weight Helpers
// =========================================================================
function saveProfileToStorage() {
  state.profilePoints.sort((a, b) => a.sec - b.sec);
  safeSaveProfile(state.profilePoints);
  refreshProfileUI();
  updateChart();
  updateUI();
}

function applyPreset(key) {
  state.profilePoints = PRESETS[key].map((p) => ({ sec: p.sec, temp: p.temp }));
  saveProfileToStorage();
}

function clearProfilePoints() {
  state.profilePoints = [];
  saveProfileToStorage();
}

function addProfilePointManual() {
  const tRaw = document.getElementById("profTimeInput").value.trim();
  const temp = parseFloat(document.getElementById("profTempInput").value);
  if (!tRaw || isNaN(temp)) return;
  let sec = 0;
  if (tRaw.includes(":")) {
    const parts = tRaw.split(":");
    sec = (parseInt(parts[0], 10) || 0) * 60 + (parseInt(parts[1], 10) || 0);
  } else {
    sec = Math.round(parseFloat(tRaw));
  }
  state.profilePoints.push({ sec, temp });
  document.getElementById("profTimeInput").value = "";
  document.getElementById("profTempInput").value = "";
  saveProfileToStorage();
}

function removeProfilePointAt(idx) {
  state.profilePoints.splice(idx, 1);
  saveProfileToStorage();
}

function handleCSVFile(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    const lines = String(ev.target.result || "").split(/\r?\n/);
    const pts = [];
    lines.forEach((line) => {
      const parts = line.split(",");
      if (parts.length >= 2) {
        const tStr = parts[0].trim();
        const temp = parseFloat(parts[1].trim());
        let sec = NaN;
        if (tStr.includes(":")) {
          const [mRaw, sRaw] = tStr.split(":");
          const m = parseInt(mRaw, 10);
          const s = parseInt(sRaw, 10);
          if (!isNaN(m) && !isNaN(s)) sec = m * 60 + s;
        } else {
          sec = Math.round(parseFloat(tStr));
        }
        if (!isNaN(sec) && !isNaN(temp)) pts.push({ sec, temp });
      }
    });
    if (pts.length > 0) {
      state.profilePoints = pts;
      saveProfileToStorage();
    } else {
      alert("유효한 (시간, 온도) 데이터를 찾지 못했습니다.");
    }
  };
  reader.readAsText(file);
}

function refreshProfileUI() {
  document.getElementById("profileActiveBadge").textContent = state.profilePoints.length ? "ON" : "";
  const list = document.getElementById("profilePointsList");
  list.innerHTML = state.profilePoints.map((p, idx) =>
    `<div style="display:flex; justify-content:space-between; background:var(--control); padding:7px 10px; border-radius:8px;">` +
      `<span>${formatTime(p.sec)}</span>` +
      `<span style="color:var(--profile); font-weight:600;">${p.temp}℃</span>` +
      `<button type="button" style="color:var(--red); cursor:pointer;" onclick="removeProfilePointAt(${idx})">삭제</button>` +
    `</div>`
  ).join("");
}

function selectProcess(proc) {
  document.getElementById("beanProcessInput").value = proc;
}

function updateRoastLevelLabel(val) {
  const v = parseFloat(val);
  let name = "중배전";
  if (v <= 1.8) name = "약배전";
  else if (v <= 2.6) name = "중약배전";
  else if (v <= 3.4) name = "중배전";
  else if (v <= 4.2) name = "중강배전";
  else name = "강배전";
  document.getElementById("roastLevelText").textContent = `${name} (${v.toFixed(1)})`;
}

function saveBeanInfo() {
  state.beanInfo.name = document.getElementById("beanNameInput").value.trim();
  state.beanInfo.process = document.getElementById("beanProcessInput").value.trim();
  state.beanInfo.chargeWeight = parseFloat(document.getElementById("beanChargeInput").value) || null;
  state.beanInfo.targetLevel = parseFloat(document.getElementById("beanLevelInput").value);
  document.getElementById("beanBtnText").textContent = state.beanInfo.name || "생두 정보";
  saveActiveSession();
  closeModal("beanModal");
}

function appendNoteTag(tag) {
  const el = document.getElementById("roasterNotesInput");
  el.value = el.value ? `${el.value}, ${tag}` : tag;
}

function previewWeightLoss() {
  const w = parseFloat(document.getElementById("finalWeightInput").value);
  const box = document.getElementById("lossPreviewBox");
  if (state.beanInfo.chargeWeight && w > 0 && w <= state.beanInfo.chargeWeight) {
    const lossG = state.beanInfo.chargeWeight - w;
    const lossPct = (lossG / state.beanInfo.chargeWeight) * 100;
    box.textContent = `손실량 ${lossG.toFixed(1)}g · 손실률 ${lossPct.toFixed(1)}%`;
  } else {
    box.textContent = state.beanInfo.chargeWeight ? "" : "생두 정보에서 투입량을 입력하면 손실률이 계산됩니다.";
  }
}

function saveFinalWeightAndReport() {
  const w = parseFloat(document.getElementById("finalWeightInput").value);
  if (w > 0) {
    state.finalWeight = w;
    state.isFinished = true;
    if (state.beanInfo.chargeWeight) {
      const pct = ((state.beanInfo.chargeWeight - w) / state.beanInfo.chargeWeight) * 100;
      const badge = document.getElementById("headerLossBadge");
      badge.style.display = "inline-flex";
      badge.textContent = `손실률 ${pct.toFixed(1)}%`;
    }
  }
  saveActiveSession();
  closeModal("weightModal");
  updateUI();
  generateLightReport(openModal);
}

function confirmReset() {
  if (!confirm("새 로스팅을 시작하시겠습니까? 현재 기록이 모두 삭제됩니다.")) return;
  clearInterval(state.timerId);
  state.seconds = 0;
  state.isRunning = false;
  state.gas = 6.0;
  document.getElementById("gasSlider").value = 6.0;
  document.getElementById("gasValLabel").textContent = "6.0단";
  state.logs = [];
  state.chargeSec = null;
  state.yellowSec = null;
  state.firstCrackSec = null;
  state.dropSec = null;
  state.isDropped = false;
  state.isFinished = false;
  state.finalWeight = null;
  state.currentRoR = 0;
  state.btBuffer = "";
  document.getElementById("inlineKeypadDisplay").textContent = "--- ℃";
  document.getElementById("headerLossBadge").style.display = "none";
  clearActiveSession();
  updateChart();
  updateUI();
}

// Expose handlers for declarative HTML buttons
Object.assign(window, {
  openModal,
  closeModal,
  toggleRoastTimer,
  confirmPause,
  confirmReset,
  adjustGas,
  onGasSliderChange,
  toggleCamera,
  setCameraZoom,
  toggleOCR,
  forceSyncOCR,
  handleMilestone,
  undoDrop,
  deleteLastLog,
  toggleKeypad,
  pressKey,
  quickRecordTemp,
  applyPreset,
  clearProfilePoints,
  addProfilePointManual,
  removeProfilePointAt,
  handleCSVFile,
  selectProcess,
  updateRoastLevelLabel,
  saveBeanInfo,
  appendNoteTag,
  previewWeightLoss,
  saveFinalWeightAndReport,
  generateLightReport: () => generateLightReport(openModal),
  downloadCSVLog,
  shareReport
});

// =========================================================================
// Boot
// =========================================================================
window.addEventListener("DOMContentLoaded", () => {
  try {
    if (localStorage.getItem("roast_keypad_open") === "0") {
      toggleKeypad(false);
    }
  } catch {}

  if (restoreActiveSession()) {
    document.getElementById("gasSlider").value = state.gas;
    document.getElementById("gasValLabel").textContent = state.gas.toFixed(1) + "단";
    if (state.beanInfo.name) {
      document.getElementById("beanBtnText").textContent = state.beanInfo.name;
    }
    if (state.beanInfo.chargeWeight && state.finalWeight) {
      const pct = ((state.beanInfo.chargeWeight - state.finalWeight) / state.beanInfo.chargeWeight) * 100;
      const badge = document.getElementById("headerLossBadge");
      badge.style.display = "inline-flex";
      badge.textContent = `손실률 ${pct.toFixed(1)}%`;
    }
  }

  setupHoldToDrop();
  refreshProfileUI();
  updateUI();
  initChart();

  window.addEventListener("load", () => {
    initChart();
  });

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }
});
