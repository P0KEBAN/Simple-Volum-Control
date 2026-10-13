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

const VOLUME_STEP = 5;
const LARGE_VOLUME_STEP = 25;
const MIN_VOLUME_PERCENT = 0;
const MAX_VOLUME_PERCENT = 600;

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

    const volumePercent = normalizeVolumePercent(response.volume * 100);
    setSlider(volumePercent);
    updateDisplay(volumePercent);
    setControlsEnabled(true);
    // 開いた直後からキーボードで操作できるようにする
    slider.focus();
  } catch (e) {
    console.error("popup init error:", e);
    showError("初期化に失敗しました");
  }
});

// ---------- スライダー ----------

slider.addEventListener("input", () => {
  applyVolumePercent(slider.value);
});

// ---------- キーボード ----------
// 矢印: 5% / Shift+矢印: 25% / 0〜6: 0%〜600% / R: リセット
// フォーカスがスライダーにない場合も同じ操作になるよう document で受ける

const ARROW_DIRECTIONS = {
  ArrowUp: 1,
  ArrowRight: 1,
  ArrowDown: -1,
  ArrowLeft: -1,
};

document.addEventListener("keydown", (event) => {
  if (slider.disabled || event.ctrlKey || event.metaKey || event.altKey) {
    return;
  }

  const direction = ARROW_DIRECTIONS[event.key];
  if (direction) {
    const step = event.shiftKey ? LARGE_VOLUME_STEP : VOLUME_STEP;
    event.preventDefault();
    applyVolumePercent(Number(slider.value) + direction * step);
    return;
  }

  if (event.shiftKey) {
    return;
  }

  // IME 有効時も反応するよう、入力文字ではなく物理キーで判定する
  const digit = /^(?:Digit|Numpad)([0-6])$/.exec(event.code)?.[1];
  if (digit !== undefined) {
    event.preventDefault();
    applyVolumePercent(Number(digit) * 100);
    return;
  }

  if (event.code === "KeyR") {
    event.preventDefault();
    resetVolume();
  }
});

// ---------- Reset ----------

resetBtn.addEventListener("click", resetVolume);

async function resetVolume() {
  setSlider(100);
  updateDisplay(100);

  try {
    const response = await chrome.runtime.sendMessage({
      type: "reset",
      tabId: currentTabId,
    });

    if (!response?.ok) {
      showError(response?.error || "音量をリセットできませんでした");
    }
  } catch (e) {
    console.error("reset volume error:", e);
    showError("音量をリセットできませんでした");
  }
}

// ---------- ヘルパー ----------

function applyVolumePercent(value) {
  const percent = normalizeVolumePercent(value);
  setSlider(percent);
  updateDisplay(percent);
  sendVolume(percent / 100);
}

async function sendVolume(volume) {
  try {
    const response = await chrome.runtime.sendMessage({
      type: "set-volume",
      tabId: currentTabId,
      volume,
    });

    if (!response?.ok) {
      showError(response?.error || "音量を変更できませんでした");
    }
  } catch (e) {
    console.error("set volume error:", e);
    showError("音量を変更できませんでした");
  }
}

function setSlider(percent) {
  const normalizedPercent = normalizeVolumePercent(percent);
  slider.value = normalizedPercent;
  slider.setAttribute("aria-valuenow", String(normalizedPercent));
  slider.setAttribute("aria-valuetext", `${normalizedPercent}%`);
  updateSliderTrack(normalizedPercent);
}

function updateDisplay(percent) {
  const normalizedPercent = normalizeVolumePercent(percent);
  display.textContent = `${normalizedPercent}%`;

  if (normalizedPercent > 100) {
    display.classList.add("boosted");
  } else {
    display.classList.remove("boosted");
  }

  updateSliderTrack(normalizedPercent);
}

function updateSliderTrack(percent) {
  const ratio = percent / 600;
  const color = `linear-gradient(to right, var(--accent) 0%, var(--accent) ${ratio * 100}%, var(--surface) ${ratio * 100}%, var(--surface) 100%)`;
  slider.style.background = color;
}

function normalizeVolumePercent(value) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return 100;
  }

  const steppedValue = Math.round(numericValue / VOLUME_STEP) * VOLUME_STEP;
  return Math.min(
    MAX_VOLUME_PERCENT,
    Math.max(MIN_VOLUME_PERCENT, steppedValue)
  );
}

function showError(msg) {
  setControlsEnabled(false);
  mainView.style.display = "none";
  errorMsg.textContent = msg;
  errorView.style.display = "block";
}

function setControlsEnabled(enabled) {
  slider.disabled = !enabled;
  resetBtn.disabled = !enabled;
}
