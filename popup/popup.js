// ============================================================
// Simple Volume Control — Popup Script
// UI ロジック / service_worker 連携
// ============================================================

const slider = document.getElementById("volume-slider");
const display = document.getElementById("volume-display");
const resetBtn = document.getElementById("reset-btn");
const saveBtn = document.getElementById("save-btn");
const saveLabel = document.getElementById("save-label");
const mainView = document.getElementById("main-view");
const errorView = document.getElementById("error-view");
const errorMsg = document.getElementById("error-msg");

let currentTabId = null;
let currentUrl = null;
let isSaved = false;

// ---------- 初期化 ----------

document.addEventListener("DOMContentLoaded", async () => {
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

    currentUrl = response.url;
    isSaved = response.saved || false;

    const volumePercent = Math.round(response.volume * 100);
    setSlider(volumePercent);
    updateDisplay(volumePercent);
    updateSaveButton();
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
    url: currentUrl,
    save: isSaved,
  });
});

// ---------- Save トグル ----------

saveBtn.addEventListener("click", () => {
  isSaved = !isSaved;
  updateSaveButton();

  if (isSaved) {
    const volume = parseInt(slider.value, 10) / 100;
    chrome.runtime.sendMessage({
      type: "save-on",
      url: currentUrl,
      volume,
    });
  } else {
    chrome.runtime.sendMessage({
      type: "save-off",
      url: currentUrl,
    });
  }
});

// ---------- ヘルパー ----------

function sendVolume(volume) {
  chrome.runtime.sendMessage({
    type: "set-volume",
    tabId: currentTabId,
    volume,
    url: currentUrl,
    save: isSaved,
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

function updateSaveButton() {
  if (isSaved) {
    saveBtn.classList.add("active");
    saveLabel.textContent = "Saved";
  } else {
    saveBtn.classList.remove("active");
    saveLabel.textContent = "Save";
  }
}

function showError(msg) {
  mainView.style.display = "none";
  errorView.style.display = "block";
  errorMsg.textContent = msg;
}
