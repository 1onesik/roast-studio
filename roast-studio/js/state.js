const PROFILE_KEY = "roast_profile_points";
const SESSION_KEY = "roast_active_session";

export function safeLoadProfile() {
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function safeSaveProfile(pts) {
  try {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(pts));
  } catch {}
}

export const state = {
  seconds: 0,
  isRunning: false,
  timerId: null,
  startTimeMs: null,
  gas: 6.0,
  btBuffer: "",
  logs: [],
  chargeSec: null,
  yellowSec: null,
  firstCrackSec: null,
  dropSec: null,
  isDropped: false,
  isFinished: false,
  finalWeight: null,
  currentRoR: 0.0,
  allowNextJump: false,
  beanInfo: { name: "", process: "", chargeWeight: null, targetLevel: 3.0 },
  profilePoints: safeLoadProfile(),
  cameraStream: null,
  zoomLevel: 1,
  ocrEnabled: false,
  ocrWorker: null,
  ocrBusy: false,
  recentReadings: [],
  lastEmitTime: 0,
  lastAcceptedTime: Date.now()
};

export const PRESETS = {
  light: [
    { sec: 0, temp: 165 }, { sec: 35, temp: 98 }, { sec: 90, temp: 132 },
    { sec: 150, temp: 162 }, { sec: 210, temp: 184 }, { sec: 270, temp: 199 }, { sec: 330, temp: 207 }
  ],
  medium: [
    { sec: 0, temp: 170 }, { sec: 40, temp: 96 }, { sec: 100, temp: 130 },
    { sec: 170, temp: 158 }, { sec: 240, temp: 180 }, { sec: 315, temp: 198 }, { sec: 390, temp: 213 }
  ],
  dark: [
    { sec: 0, temp: 175 }, { sec: 42, temp: 100 }, { sec: 110, temp: 134 },
    { sec: 180, temp: 160 }, { sec: 260, temp: 183 }, { sec: 330, temp: 199 }, { sec: 390, temp: 212 }, { sec: 435, temp: 221 }
  ]
};

export function formatTime(s) {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return String(m).padStart(2, "0") + ":" + String(sec).padStart(2, "0");
}

export function saveActiveSession() {
  try {
    const snapshot = {
      seconds: state.seconds,
      gas: state.gas,
      logs: state.logs,
      chargeSec: state.chargeSec,
      yellowSec: state.yellowSec,
      firstCrackSec: state.firstCrackSec,
      dropSec: state.dropSec,
      isDropped: state.isDropped,
      isFinished: state.isFinished,
      finalWeight: state.finalWeight,
      currentRoR: state.currentRoR,
      beanInfo: state.beanInfo,
      savedAt: Date.now()
    };
    localStorage.setItem(SESSION_KEY, JSON.stringify(snapshot));
  } catch {}
}

export function restoreActiveSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return false;
    const saved = JSON.parse(raw);
    if (!saved || !Array.isArray(saved.logs) || saved.logs.length === 0) return false;
    // Only auto-restore sessions from the last 12 hours
    if (Date.now() - (saved.savedAt || 0) > 12 * 60 * 60 * 1000) return false;

    state.seconds = saved.seconds || 0;
    state.gas = typeof saved.gas === "number" ? saved.gas : 6.0;
    state.logs = saved.logs;
    state.chargeSec = saved.chargeSec ?? null;
    state.yellowSec = saved.yellowSec ?? null;
    state.firstCrackSec = saved.firstCrackSec ?? null;
    state.dropSec = saved.dropSec ?? null;
    state.isDropped = Boolean(saved.isDropped);
    state.isFinished = Boolean(saved.isFinished);
    state.finalWeight = saved.finalWeight ?? null;
    state.currentRoR = saved.currentRoR || 0;
    if (saved.beanInfo) state.beanInfo = saved.beanInfo;
    return true;
  } catch {
    return false;
  }
}

export function clearActiveSession() {
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch {}
}

export function calculateRoR(currentBt, atSec) {
  if (!state.logs.length) return 0;
  const first = state.logs[0];
  const windowSec = 20;
  if (atSec - first.sec < windowSec / 2) return 0;
  const targetSec = atSec - windowSec;
  let ref = first;
  for (let i = state.logs.length - 1; i >= 0; i--) {
    if (state.logs[i].sec <= targetSec) {
      ref = state.logs[i];
      break;
    }
  }
  const dt = atSec - ref.sec;
  return dt > 0 ? ((currentBt - ref.bt) / dt) * 60.0 : 0;
}

export function getTurningPoint() {
  if (state.logs.length < 2) return null;
  const startSec = state.chargeSec !== null ? state.chargeSec : 0;
  const upper = state.yellowSec !== null
    ? state.yellowSec
    : (state.firstCrackSec !== null ? state.firstCrackSec : Math.max(state.seconds, 120));
  const limitSec = Math.min(upper, startSec + 120);
  const cands = state.logs.filter((l) => l.sec >= startSec && l.sec <= limitSec && l.bt > 0);
  if (!cands.length) return null;
  return cands.reduce((min, cur) => (cur.bt < min.bt ? cur : min), cands[0]);
}

export function getTargetBTAt(sec) {
  const pts = state.profilePoints;
  if (!pts.length) return null;
  for (let i = 0; i < pts.length; i++) {
    if (pts[i].sec === sec) return pts[i].temp;
  }
  let nextIdx = -1;
  for (let j = 0; j < pts.length; j++) {
    if (pts[j].sec > sec) {
      nextIdx = j;
      break;
    }
  }
  if (nextIdx === -1) return pts[pts.length - 1].temp;
  if (nextIdx === 0) return pts[0].temp;
  const p0 = pts[nextIdx - 1];
  const p1 = pts[nextIdx];
  const ratio = (sec - p0.sec) / Math.max(p1.sec - p0.sec, 1);
  return p0.temp + ratio * (p1.temp - p0.temp);
}
