// ============================================================
// Simple Volume Control — Service Worker
// メッセージハブ / tabCapture / offscreen 管理
// ============================================================

// ---------- アクティブセッション管理 ----------
// tabId → { volume } を追跡し、二重キャプチャを防ぐ
const activeSessions = new Map();

// ---------- offscreen document 管理 ----------

const OFFSCREEN_URL = "offscreen.html";
const DEFAULT_VOLUME = 1.0;
const MIN_VOLUME = 0;
const MAX_VOLUME = 6;

let creatingOffscreen = null;

async function getOffscreenContexts() {
  return chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
    documentUrls: [chrome.runtime.getURL(OFFSCREEN_URL)],
  });
}

async function ensureOffscreen() {
  const contexts = await getOffscreenContexts();
  if (contexts.length === 0) {
    if (!creatingOffscreen) {
      creatingOffscreen = chrome.offscreen
        .createDocument({
          url: OFFSCREEN_URL,
          reasons: ["USER_MEDIA"],
          justification: "Tab audio capture and volume control via Web Audio API",
        })
        .finally(() => {
          creatingOffscreen = null;
        });
    }

    await creatingOffscreen;
  }
}

// ---------- offscreen 側のセッション確認 ----------

async function sendMessageToOffscreen(message, { createIfMissing = true } = {}) {
  let contexts;

  if (createIfMissing) {
    await ensureOffscreen();
    contexts = await getOffscreenContexts();
  } else {
    contexts = await getOffscreenContexts();
  }

  if (contexts.length === 0) {
    return null;
  }

  return chrome.runtime.sendMessage({
    ...message,
    target: "offscreen",
  });
}

async function getOffscreenSessionState(tabId) {
  try {
    const response = await sendMessageToOffscreen(
      {
        type: "get-session-state",
        tabId,
      },
      { createIfMissing: false }
    );

    return {
      exists: response?.exists || false,
      volume: response?.volume ?? 1.0,
    };
  } catch {
    return {
      exists: false,
      volume: 1.0,
    };
  }
}

// ---------- offscreen 側のセッション破棄 ----------

async function closeOffscreenDocument() {
  if (creatingOffscreen) {
    await creatingOffscreen;
  }

  const contexts = await getOffscreenContexts();
  if (contexts.length > 0) {
    await chrome.offscreen.closeDocument();
  }
}

function normalizeVolume(volume) {
  const numericVolume = Number(volume);
  if (!Number.isFinite(numericVolume)) {
    return DEFAULT_VOLUME;
  }

  return Math.min(MAX_VOLUME, Math.max(MIN_VOLUME, numericVolume));
}

async function destroyOffscreenSession(tabId) {
  try {
    const response = await sendMessageToOffscreen(
      {
        type: "destroy-session",
        tabId,
      },
      { createIfMissing: false }
    );

    if (response?.isIdle) {
      await closeOffscreenDocument();
    }

    return response;
  } catch {
    // offscreen が存在しない場合は無視
    return null;
  }
}

// ---------- tabCapture → offscreen ----------

async function startCapture(tabId) {
  // セッションのデフォルト音量
  let volume = DEFAULT_VOLUME;

  // ── ケース1: service worker 側にセッション情報あり → 既存利用 ──
  if (activeSessions.has(tabId)) {
    const session = activeSessions.get(tabId);
    const offscreenSession = await getOffscreenSessionState(tabId);

    if (offscreenSession.exists) {
      session.volume = offscreenSession.volume;
      return { volume: offscreenSession.volume };
    }

    // service worker 側だけに残った stale な状態は捨てて新規作成する
    activeSessions.delete(tabId);
  }

  // ── ケース2: service worker にはないが offscreen 側にセッションが残っている
  //     (service worker 再起動後などに発生)
  const offscreenSession = await getOffscreenSessionState(tabId);
  if (offscreenSession.exists) {
    // offscreen 側のセッションを再利用
    activeSessions.set(tabId, { volume: offscreenSession.volume });
    return { volume: offscreenSession.volume };
  }

  // ── ケース3: 完全に新規キャプチャ ──
  await ensureOffscreen();

  let streamId;
  try {
    streamId = await chrome.tabCapture.getMediaStreamId({
      targetTabId: tabId,
    });
  } catch (e) {
    // "Cannot capture a tab with an active stream." の場合、
    // 既存ストリームを破棄してリトライ
    if (
      e.message &&
      e.message.includes("active stream")
    ) {
      console.warn(
        "startCapture: active stream detected, destroying and retrying...",
        tabId
      );
      await destroyOffscreenSession(tabId);

      // リトライ（1回だけ）
      try {
        streamId = await chrome.tabCapture.getMediaStreamId({
          targetTabId: tabId,
        });
      } catch (retryError) {
        throw retryError;
      }
    } else {
      throw e;
    }
  }

  const response = await sendMessageToOffscreen({
    type: "start-capture",
    streamId,
    tabId,
    volume,
  });

  if (!response?.ok) {
    throw new Error(response?.error || "Failed to initialize offscreen audio");
  }

  // セッション登録
  activeSessions.set(tabId, { volume: response.volume });

  return { volume: response.volume };
}

// ---------- メッセージハンドラ ----------

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.target === "offscreen") return; // offscreen 向けはスルー

  switch (message.type) {
    case "init-popup": {
      handleInitPopup(message).then(sendResponse);
      return true; // async
    }

    case "set-volume": {
      handleSetVolume(message).then(sendResponse);
      return true; // async
    }

    case "reset": {
      handleSetVolume({
        ...message,
        volume: DEFAULT_VOLUME,
      }).then(sendResponse);
      return true; // async
    }

    case "session-ended": {
      handleSessionEnded(message);
      sendResponse({ ok: true });
      return false;
    }
  }
});

// ---------- タブ削除時のクリーンアップ ----------

chrome.tabs.onRemoved.addListener((tabId) => {
  activeSessions.delete(tabId);
  // offscreen のセッションも破棄
  destroyOffscreenSession(tabId);
});

// ---------- popup 初期化 ----------

async function handleInitPopup(message) {
  const tabId = message.tabId;

  try {
    const result = await startCapture(tabId);
    return {
      ok: true,
      volume: result.volume,
    };
  } catch (e) {
    console.error("startCapture failed:", e);
    return { ok: false, error: e.message };
  }
}

async function handleSetVolume(message) {
  const tabId = message.tabId;
  const volume = normalizeVolume(message.volume);

  try {
    const response = await sendMessageToOffscreen(
      {
        type: "set-volume",
        tabId,
        volume,
      },
      { createIfMissing: false }
    );

    if (!response?.ok) {
      return {
        ok: false,
        error: response?.error || "No active audio session",
      };
    }

    if (activeSessions.has(tabId)) {
      activeSessions.get(tabId).volume = response.volume;
    }

    return {
      ok: true,
      volume: response.volume,
    };
  } catch (e) {
    return {
      ok: false,
      error: e.message || "Failed to update volume",
    };
  }
}

async function handleSessionEnded(message) {
  activeSessions.delete(message.tabId);

  if (message.isIdle) {
    try {
      await closeOffscreenDocument();
    } catch (e) {
      console.warn("session-ended: failed to close offscreen document", e);
    }
  }
}
