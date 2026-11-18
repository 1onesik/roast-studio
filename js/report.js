import { state, formatTime, getTurningPoint } from "./state.js";
import { mappedRoR } from "./chart.js";

let staticChart = null;

function renderStaticChartForReport() {
  const ctx = document.getElementById("reportStaticChart").getContext("2d");

  const dataLabelsPlugin = {
    id: "calloutLabels",
    afterDatasetsDraw(chartInstance) {
      const c = chartInstance.ctx;
      chartInstance.data.datasets[0].data.forEach((dp, index) => {
        if (!dp.event) return;
        const meta = chartInstance.getDatasetMeta(0);
        const { x, y } = meta.data[index];

        c.save();
        c.fillStyle = "#1D1D1F";
        c.beginPath();
        c.roundRect(x - 34, y - 46, 68, 36, 8);
        c.fill();

        c.beginPath();
        c.moveTo(x - 5, y - 10);
        c.lineTo(x + 5, y - 10);
        c.lineTo(x, y - 4);
        c.fill();

        c.fillStyle = "#FFFFFF";
        c.font = "600 11px -apple-system, sans-serif";
        c.textAlign = "center";
        c.fillText(dp.event, x, y - 31);

        c.fillStyle = "#A1A1A6";
        c.font = "10px ui-monospace, monospace";
        c.fillText(`${formatTime(dp.x)} · ${dp.y.toFixed(1)}℃`, x, y - 17);
        c.restore();
      });
    }
  };

  if (staticChart) staticChart.destroy();

  const mapBySec = new Map();
  state.logs.forEach((l) => mapBySec.set(l.sec, l));
  const deduped = Array.from(mapBySec.values()).sort((a, b) => a.sec - b.sec);
  const maxSec = deduped.length ? deduped[deduped.length - 1].sec : 240;

  staticChart = new window.Chart(ctx, {
    type: "line",
    data: {
      datasets: [
        {
          label: "BT (℃)",
          data: deduped.map((l) => ({ x: l.sec, y: l.bt, event: l.event })),
          borderColor: "#E07A00",
          backgroundColor: "#E07A00",
          borderWidth: 3.5,
          pointRadius: (c) => (c.raw && c.raw.event ? 5 : 0),
          pointBackgroundColor: "#E07A00",
          pointBorderColor: "#FFFFFF",
          pointBorderWidth: 2,
          tension: 0.3
        },
        {
          label: "RoR",
          data: deduped.map((l) => ({ x: l.sec, y: mappedRoR(l.ror) })),
          borderColor: "#007AFF",
          backgroundColor: "rgba(0, 122, 255, 0.08)",
          borderWidth: 2,
          fill: true,
          pointRadius: 0,
          tension: 0.35
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
          max: maxSec + 30,
          grid: { color: "rgba(0,0,0,0.05)" },
          ticks: { color: "#6E6E73", font: { size: 11 }, callback: (val) => formatTime(val) }
        },
        y: {
          min: 0,
          max: 260,
          grid: { color: "rgba(0,0,0,0.05)" },
          ticks: { color: "#6E6E73", font: { size: 11 }, stepSize: 50 }
        }
      },
      plugins: { legend: { display: false } }
    },
    plugins: [dataLabelsPlugin]
  });
}

export async function generateLightReport(openModal) {
  const now = new Date();
  document.getElementById("repDate").textContent =
    `${now.getFullYear()}.${String(now.getMonth() + 1).padStart(2, "0")}.${String(now.getDate()).padStart(2, "0")} ` +
    `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

  document.getElementById("repBeanName").textContent = state.beanInfo.name || "미지정 생두";
  document.getElementById("repProcess").textContent = `${state.beanInfo.process || "가공방식 미정"} · 목표 ${state.beanInfo.targetLevel.toFixed(1)}`;

  document.getElementById("repCharge").textContent = state.beanInfo.chargeWeight ? state.beanInfo.chargeWeight.toFixed(1) : "0.0";
  document.getElementById("repFinal").textContent = state.finalWeight ? state.finalWeight.toFixed(1) : "0.0";

  if (state.beanInfo.chargeWeight && state.finalWeight) {
    const loss = ((state.beanInfo.chargeWeight - state.finalWeight) / state.beanInfo.chargeWeight) * 100;
    document.getElementById("repLoss").textContent = `손실률 ${loss.toFixed(1)}%`;
  } else {
    document.getElementById("repLoss").textContent = "손실률 -";
  }

  const effSec = state.dropSec || state.seconds;
  const safeTotal = Math.max(effSec, 1);
  document.getElementById("repTotalTime").textContent = formatTime(effSec);
  const lastBT = state.logs.length ? state.logs[state.logs.length - 1].bt : 0;
  document.getElementById("repDropTemp").textContent = `배출 온도 ${lastBT > 0 ? lastBT.toFixed(1) : "--.-"}℃`;

  if (state.firstCrackSec !== null && effSec > 0) {
    const dev = effSec - state.firstCrackSec;
    document.getElementById("repDevTime").textContent = formatTime(dev);
    document.getElementById("repDtr").textContent = `DTR ${((dev / effSec) * 100).toFixed(1)}%`;
  } else {
    document.getElementById("repDevTime").textContent = "-";
    document.getElementById("repDtr").textContent = "DTR -";
  }

  const tp = getTurningPoint();
  document.getElementById("repTpTemp").textContent = `TP ${tp ? tp.bt.toFixed(1) + "℃" : "-"}`;
  document.getElementById("repFcTime").textContent = state.firstCrackSec ? formatTime(state.firstCrackSec) : "-";

  const ySec = state.yellowSec !== null ? state.yellowSec : Math.min(safeTotal, state.firstCrackSec !== null ? state.firstCrackSec : safeTotal);
  const fcSec = state.firstCrackSec !== null ? state.firstCrackSec : safeTotal;
  const dryS = Math.max(0, Math.min(ySec, safeTotal));
  const mailS = Math.max(0, Math.min(fcSec, safeTotal) - dryS);
  const devS = Math.max(0, safeTotal - Math.max(dryS, Math.min(fcSec, safeTotal)));

  const dryPct = (dryS / safeTotal) * 100;
  const mailPct = (mailS / safeTotal) * 100;
  const devPct = (devS / safeTotal) * 100;

  document.getElementById("repPhaseDry").style.width = `${dryPct}%`;
  document.getElementById("repPhaseDry").textContent = dryPct >= 12 ? `DRY ${dryPct.toFixed(0)}%` : "";
  document.getElementById("repPhaseMail").style.width = `${mailPct}%`;
  document.getElementById("repPhaseMail").textContent = mailPct >= 16 ? `MAILLARD ${mailPct.toFixed(0)}%` : "";
  document.getElementById("repPhaseDev").style.width = `${devPct}%`;
  document.getElementById("repPhaseDev").textContent = devPct >= 12 ? `DEV ${devPct.toFixed(0)}%` : "";

  const notes = document.getElementById("roasterNotesInput").value.trim();
  document.getElementById("repNotes").innerHTML = notes ? notes.replace(/\n/g, "<br>") : "입력된 메모가 없습니다.";

  document.getElementById("reportRendererWrap").style.zIndex = "1";
  renderStaticChartForReport();

  if (typeof window.html2canvas !== "undefined") {
    setTimeout(async () => {
      const canvas = await window.html2canvas(document.getElementById("reportRendererWrap"), {
        backgroundColor: "#F5F5F7",
        scale: 2
      });
      const dataUrl = canvas.toDataURL("image/png");
      document.getElementById("generatedReportImg").src = dataUrl;
      document.getElementById("downloadReportLink").href = dataUrl;
      document.getElementById("reportRendererWrap").style.zIndex = "-1";
      openModal("reportModal");
    }, 300);
  }
}

export function downloadCSVLog() {
  if (state.logs.length === 0) return;
  let csv = "Time(s),Time_Str,BT,RoR,Gas,Event\n";
  state.logs.forEach((l) => {
    csv += `${l.sec},${l.timeStr},${l.bt.toFixed(1)},${l.ror.toFixed(2)},${l.gas.toFixed(1)},${l.event || ""}\n`;
  });
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `roast_log_${Date.now()}.csv`;
  link.click();
}

export async function shareReport() {
  const imgUrl = document.getElementById("generatedReportImg").src;
  try {
    const res = await fetch(imgUrl);
    const blob = await res.blob();
    const file = new File([blob], "roast_report.png", { type: "image/png" });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({
        files: [file],
        title: "로스팅 리포트",
        text: `${state.beanInfo.name || "원두"} 로스팅 리포트`
      });
    } else {
      alert("이 브라우저에서는 공유 기능을 지원하지 않습니다. 이미지 저장 버튼을 이용해주세요.");
    }
  } catch (err) {
    console.error(err);
  }
}
