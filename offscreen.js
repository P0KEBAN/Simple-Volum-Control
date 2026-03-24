// ============================================================
// Simple Volume Control — Offscreen Document
// Web Audio API による音量制御の本体
// ============================================================

// tabId → { audioContext, gainNode, source, stream } のマップ
const audioSessions = new Map();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.target !== "offscreen") return;

  switch (message.type) {
    case "start-capture":
      handleStartCapture(message);
      break;

    case "set-volume":
      handleSetVolume(message);
      break;

    // Service Worker からセッション存在確認を受ける
    case "check-session": {
      const tabId = message.tabId;
      const exists = audioSessions.has(tabId);
      sendResponse({ exists });
      return true;
    }

    // セッション破棄リクエスト
    case "destroy-session": {
      const tabId = message.tabId;
      destroySession(tabId);
      sendResponse({ ok: true });
      return true;
    }
  }
});

// ---------- キャプチャ開始 ----------

async function handleStartCapture(message) {
  const { streamId, tabId, volume } = message;

  // 既存セッションがあれば音量だけ更新
  if (audioSessions.has(tabId)) {
    const session = audioSessions.get(tabId);
    session.gainNode.gain.value = volume;
    return;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: {
          chromeMediaSource: "tab",
          chromeMediaSourceId: streamId,
        },
      },
    });

    const audioContext = new AudioContext();
    const source = audioContext.createMediaStreamSource(stream);
    const gainNode = audioContext.createGain();

    gainNode.gain.value = volume;

    source.connect(gainNode);
    gainNode.connect(audioContext.destination);

    audioSessions.set(tabId, { audioContext, gainNode, source, stream });
  } catch (e) {
    console.error("offscreen: capture failed", e);
  }
}

// ---------- 音量変更 ----------

function handleSetVolume(message) {
  const { tabId, volume } = message;
  const session = audioSessions.get(tabId);
  if (session) {
    session.gainNode.gain.value = volume;
  }
}

// ---------- セッション破棄 ----------

function destroySession(tabId) {
  const session = audioSessions.get(tabId);
  if (session) {
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
  }
}
