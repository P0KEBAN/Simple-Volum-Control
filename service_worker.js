// ============================================================
// Simple Volume Control — Service Worker
// メッセージハブ / tabCapture / offscreen 管理
// ============================================================

// ---------- アクティブセッション管理 ----------
// tabId → { volume } を追跡し、二重キャプチャを防ぐ
const activeSessions = new Map();

// ---------- offscreen document 管理 ----------

const OFFSCREEN_URL = "offscreen.html";

async function ensureOffscreen() {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
    documentUrls: [chrome.runtime.getURL(OFFSCREEN_URL)],
  });
  if (contexts.length === 0) {
    await chrome.offscreen.createDocument({
      url: OFFSCREEN_URL,
      reasons: ["USER_MEDIA"],
      justification: "Tab audio capture and volume control via Web Audio API",
    });
  }
}

// ---------- offscreen 側のセッション確認 ----------

async function checkOffscreenSession(tabId) {
  try {
    await ensureOffscreen();
    const response = await chrome.runtime.sendMessage({
      type: "check-session",
      target: "offscreen",
      tabId,
    });
    return response?.exists || false;
  } catch {
    return false;
  }
}

// ---------- offscreen 側のセッション破棄 ----------

async function destroyOffscreenSession(tabId) {
  try {
    await ensureOffscreen();
    await chrome.runtime.sendMessage({
      type: "destroy-session",
      target: "offscreen",
      tabId,
    });
  } catch {
    // offscreen が存在しない場合は無視
  }
}

// ---------- tabCapture → offscreen ----------

async function startCapture(tabId) {
  // セッションのデフォルト音量
  let volume = 1.0;

  // ── ケース1: service worker 側にセッション情報あり → 既存利用 ──
  if (activeSessions.has(tabId)) {
    const session = activeSessions.get(tabId);
    return { volume: session.volume };
  }

  // ── ケース2: service worker にはないが offscreen 側にセッションが残っている
  //     (service worker 再起動後などに発生)
  const offscreenHasSession = await checkOffscreenSession(tabId);
  if (offscreenHasSession) {
    // offscreen 側のセッションを再利用
    activeSessions.set(tabId, { volume });
    return { volume };
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

  await chrome.runtime.sendMessage({
    type: "start-capture",
    target: "offscreen",
    streamId,
    tabId,
    volume,
  });

  // セッション登録
  activeSessions.set(tabId, { volume });

  return { volume };
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
      // offscreen に転送
      chrome.runtime.sendMessage({
        type: "set-volume",
        target: "offscreen",
        tabId: message.tabId,
        volume: message.volume,
      });

      // セッション状態を更新
      if (activeSessions.has(message.tabId)) {
        activeSessions.get(message.tabId).volume = message.volume;
      }

      sendResponse({ ok: true });
      return false;
    }

    case "reset": {
      chrome.runtime.sendMessage({
        type: "set-volume",
        target: "offscreen",
        tabId: message.tabId,
        volume: 1.0,
      });

      // セッション状態を更新
      if (activeSessions.has(message.tabId)) {
        activeSessions.get(message.tabId).volume = 1.0;
      }

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
