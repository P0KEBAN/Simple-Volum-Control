// ============================================================
// Simple Volume Control — Offscreen Document
// Web Audio API による音量制御の本体
// ============================================================

// tabId → { audioContext, gainNode, source, stream } のマップ
const audioSessions = new Map();
let pendingCaptures = 0;

const DEFAULT_VOLUME = 1.0;
const MIN_VOLUME = 0;
const MAX_VOLUME = 6;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.target !== "offscreen") return;

  switch (message.type) {
    case "start-capture":
      handleStartCapture(message)
        .then((response) => sendResponse(response))
        .catch((error) => {
          sendResponse({
            ok: false,
            error: error.message || "Failed to start capture",
          });
        });
      return true;

    case "set-volume":
      sendResponse(handleSetVolume(message));
      return true;

    // Service Worker からセッション状態確認を受ける
    case "get-session-state": {
      const tabId = message.tabId;
      const session = audioSessions.get(tabId);
      sendResponse({
        exists: Boolean(session),
        volume: session ? session.gainNode.gain.value : null,
      });
      return true;
    }

    // セッション破棄リクエスト
    case "destroy-session": {
      const tabId = message.tabId;
      destroySession(tabId);
      sendResponse({
        ok: true,
        remainingSessions: audioSessions.size,
        isIdle: audioSessions.size === 0 && pendingCaptures === 0,
      });
      return true;
    }
  }
});

// ---------- キャプチャ開始 ----------

async function handleStartCapture(message) {
  const { streamId, tabId } = message;
  const volume = normalizeVolume(message.volume);

  // 既存セッションがあれば音量だけ更新
  if (audioSessions.has(tabId)) {
    const session = audioSessions.get(tabId);
    session.gainNode.gain.value = volume;
    return { ok: true, volume: session.gainNode.gain.value };
  }

  pendingCaptures += 1;

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: {
          chromeMediaSource: "tab",
          chromeMediaSourceId: streamId,
        },
      },
    });

    try {
      const audioContext = new AudioContext();
      const source = audioContext.createMediaStreamSource(stream);
      const gainNode = audioContext.createGain();

      gainNode.gain.value = volume;

      source.connect(gainNode);
      gainNode.connect(audioContext.destination);

      audioSessions.set(tabId, { audioContext, gainNode, source, stream });
      stream.getTracks().forEach((track) => {
        track.addEventListener(
          "ended",
          () => {
            destroySession(tabId, { notifyServiceWorker: true });
          },
          { once: true }
        );
      });

      return { ok: true, volume: gainNode.gain.value };
    } catch (e) {
      stream.getTracks().forEach((track) => track.stop());
      throw e;
    }
  } finally {
    pendingCaptures -= 1;
  }
}

// ---------- 音量変更 ----------

function handleSetVolume(message) {
  const { tabId, volume } = message;
  const session = audioSessions.get(tabId);
  if (!session) {
    return {
      ok: false,
      error: "No active audio session",
    };
  }

  session.gainNode.gain.value = normalizeVolume(volume);

  return {
    ok: true,
    volume: session.gainNode.gain.value,
  };
}

// ---------- セッション破棄 ----------

function destroySession(tabId, { notifyServiceWorker = false } = {}) {
  const session = audioSessions.get(tabId);
  if (!session) {
    return;
  }

  try {
    session.source.disconnect();
    session.gainNode.disconnect();
    session.audioContext.close();
    // MediaStream のトラックも停止
    session.stream.getTracks().forEach((track) => track.stop());
  } catch (e) {
    console.warn("offscreen: destroy session error", e);
  }

  audioSessions.delete(tabId);

  if (notifyServiceWorker) {
    notifySessionEnded(tabId);
  }
}

function notifySessionEnded(tabId) {
  chrome.runtime
    .sendMessage({
      type: "session-ended",
      tabId,
      isIdle: audioSessions.size === 0 && pendingCaptures === 0,
    })
    .catch(() => {
      // service worker が停止中でも次回 popup 初期化時に状態を再同期する
    });
}

function normalizeVolume(volume) {
  const numericVolume = Number(volume);
  if (!Number.isFinite(numericVolume)) {
    return DEFAULT_VOLUME;
  }

  return Math.min(MAX_VOLUME, Math.max(MIN_VOLUME, numericVolume));
}
