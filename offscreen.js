// ============================================================
// Simple Volume Control — Offscreen Document
// Web Audio API による音量制御の本体
// ============================================================

// tabId → { audioContext, gainNode, source } のマップ
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
