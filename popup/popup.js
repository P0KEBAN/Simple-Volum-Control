// ============================================================
// Simple Volume Control — Popup Script
// UI ロジック / service_worker 連携
// ============================================================

const slider = document.getElementById("volume-slider");
const display = document.getElementById("volume-display");
const resetBtn = document.getElementById("reset-btn");
const mainView = document.getElementById("main-view");
const errorView = document.getElementById("error-view");
const errorMsg = document.getElementById("error-msg");

let currentTabId = null;

// ---------- 初期化 ----------

document.addEventListener("DOMContentLoaded", async () => {
  setControlsEnabled(false);

  try {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });

    if (!tab) {
      showError("アクティブなタブが見つかりません");
      return;
    }

    currentTabId = tab.id;

    const response = await chrome.runtime.sendMessage({
      type: "init-popup",
      tabId: tab.id,
    });

    if (!response || !response.ok) {
      showError(
        response?.error || "このタブでは音量制御を開始できません"
      );
      return;
    }

    const volumePercent = Math.round(response.volume * 100);
    setSlider(volumePercent);
    updateDisplay(volumePercent);
    setControlsEnabled(true);
  } catch (e) {
    console.error("popup init error:", e);
    showError("初期化に失敗しました");
  }
});

// ---------- スライダー ----------

slider.addEventListener("input", () => {
  const percent = parseInt(slider.value, 10);
  updateDisplay(percent);
  sendVolume(percent / 100);
});

// ---------- Reset ----------

resetBtn.addEventListener("click", () => {
  setSlider(100);
  updateDisplay(100);

  chrome.runtime.sendMessage({
    type: "reset",
    tabId: currentTabId,
  });
});

// ---------- ヘルパー ----------

function sendVolume(volume) {
  chrome.runtime.sendMessage({
    type: "set-volume",
    tabId: currentTabId,
    volume,
  });
}

function setSlider(percent) {
  slider.value = percent;
  updateSliderTrack(percent);
}

function updateDisplay(percent) {
  display.textContent = `${percent}%`;

  if (percent > 100) {
    display.classList.add("boosted");
  } else {
    display.classList.remove("boosted");
  }

  updateSliderTrack(percent);
}

function updateSliderTrack(percent) {
  const ratio = percent / 600;
  const color = `linear-gradient(to right, var(--accent) 0%, var(--accent) ${ratio * 100}%, var(--surface) ${ratio * 100}%, var(--surface) 100%)`;
  slider.style.background = color;
}

function showError(msg) {
  setControlsEnabled(false);
  mainView.style.display = "none";
  errorView.style.display = "block";
  errorMsg.textContent = msg;
}

function setControlsEnabled(enabled) {
  slider.disabled = !enabled;
  resetBtn.disabled = !enabled;
}
