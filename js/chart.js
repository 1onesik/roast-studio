import { state, formatTime } from "./state.js";

let chart = null;

export function mappedRoR(ror) {
  const min = -20;
  const max = 160;
  const clamped = Math.min(Math.max(ror, min), max);
  return ((clamped - min) / (max - min)) * 260;
}

export function initChart() {
  if (typeof window.Chart === "undefined") {
    drawNativeFallbackChart();
    return;
  }
  try {
    const ctx = document.getElementById("roastChart").getContext("2d");
    chart = new window.Chart(ctx, {
      type: "line",
      data: {
        datasets: [
          {
            label: "BT (℃)",
            data: [],
            borderColor: "#FF9F0A",
            backgroundColor: "#FF9F0A",
            borderWidth: 3,
            pointRadius: (c) => (c.raw && c.raw.event ? 5 : 0),
            pointBackgroundColor: "#FF9F0A",
            tension: 0.25
          },
          {
            label: "RoR",
            data: [],
            borderColor: "#32ADE6",
            backgroundColor: "rgba(50, 173, 230, 0.1)",
            borderWidth: 1.5,
            fill: true,
            pointRadius: 0,
            tension: 0.3
          },
          {
            label: "목표 프로파일",
            data: [],
            borderColor: "rgba(191, 90, 242, 0.7)",
            borderDash: [5, 4],
            borderWidth: 1.75,
            pointRadius: 2.5,
            pointBackgroundColor: "#BF5AF2",
            tension: 0.25
          },
          {
            label: "200℃ 기준선",
            data: [{ x: 0, y: 200 }, { x: 600, y: 200 }],
            borderColor: "rgba(255, 255, 255, 0.1)",
            borderDash: [4, 4],
            borderWidth: 1,
            pointRadius: 0
          },
          {
            label: "현재 시각",
            data: [],
            borderColor: "rgba(255, 255, 255, 0.35)",
            borderDash: [2, 2],
            borderWidth: 1.5,
            pointRadius: 0
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        scales: {
          x: {
            type: "linear",
            min: 0,
            max: 360,
            grid: { color: "rgba(255, 255, 255, 0.05)" },
            ticks: {
              color: "#636366",
              font: { family: "ui-monospace, Menlo, monospace", size: 10 },
              callback: (val) => formatTime(Math.round(val))
            }
          },
          y: {
            min: 0,
            max: 260,
            grid: { color: "rgba(255, 255, 255, 0.05)" },
            ticks: {
              color: "#636366",
              font: { family: "ui-monospace, Menlo, monospace", size: 10 },
              stepSize: 50
            }
          }
        },
        plugins: { legend: { display: false } }
      }
    });
    updateChart();
  } catch {
    drawNativeFallbackChart();
  }
}

function drawNativeFallbackChart() {
  const canvas = document.getElementById("roastChart");
  if (!canvas) return;
  const rect = canvas.parentElement.getBoundingClientRect();
  canvas.width = Math.max(rect.width, 300);
  canvas.height = Math.max(rect.height, 150);
  const ctx = canvas.getContext("2d");
  const w = canvas.width;
  const h = canvas.height;
  const padL = 36, padR = 14, padT = 14, padB = 24;
  const plotW = w - padL - padR;
  const plotH = h - padT - padB;

  ctx.clearRect(0, 0, w, h);
  const maxLogSec = state.logs.length ? state.logs[state.logs.length - 1].sec : 0;
  const maxProfSec = state.profilePoints.length ? state.profilePoints[state.profilePoints.length - 1].sec : 0;
  const maxX = Math.max(maxLogSec, maxProfSec, state.seconds, 240) + 30;

  const xPos = (sec) => padL + (sec / maxX) * plotW;
  const yPos = (temp) => padT + plotH - (Math.min(Math.max(temp, 0), 260) / 260) * plotH;

  ctx.strokeStyle = "rgba(255,255,255,0.05)";
  ctx.fillStyle = "#636366";
  ctx.font = "10px monospace";
  [0, 50, 100, 150, 200, 250].forEach((yv) => {
    const y = yPos(yv);
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(w - padR, y);
    ctx.stroke();
    ctx.fillText(String(yv), 6, y + 3);
  });

  if (state.logs.length > 0) {
    ctx.strokeStyle = "#FF9F0A";
    ctx.lineWidth = 3;
    ctx.beginPath();
    state.logs.forEach((l, i) => {
      const x = xPos(l.sec);
      const y = yPos(l.bt);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }
}

export function updateChart() {
  if (!chart && typeof window.Chart !== "undefined") {
    initChart();
  }
  if (!chart) {
    drawNativeFallbackChart();
    return;
  }
  const mapBySec = new Map();
  state.logs.forEach((l) => mapBySec.set(l.sec, l));
  const deduped = Array.from(mapBySec.values()).sort((a, b) => a.sec - b.sec);

  chart.data.datasets[0].data = deduped.map((l) => ({ x: l.sec, y: l.bt, event: l.event }));
  chart.data.datasets[1].data = deduped.map((l) => ({ x: l.sec, y: mappedRoR(l.ror), realRoR: l.ror }));
  chart.data.datasets[2].data = state.profilePoints.map((p) => ({ x: p.sec, y: p.temp }));

  const maxLogSec = deduped.length ? deduped[deduped.length - 1].sec : 0;
  const maxProfSec = state.profilePoints.length ? state.profilePoints[state.profilePoints.length - 1].sec : 0;
  const maxX = Math.max(maxLogSec, maxProfSec, state.seconds, 240) + 30;
  chart.options.scales.x.max = maxX;
  chart.data.datasets[3].data = [{ x: 0, y: 200 }, { x: maxX, y: 200 }];

  chart.data.datasets[4].data = state.seconds > 0
    ? [{ x: state.seconds, y: 0 }, { x: state.seconds, y: 260 }]
    : [];

  chart.update("none");
}
