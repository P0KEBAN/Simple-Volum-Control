// ============================================================
// Simple Volume Control — Service Worker
// メッセージハブ / tabCapture / offscreen 管理 / storage 管理
// ============================================================

// ---------- アクティブセッション管理 ----------
// tabId → { volume, url, saved } を追跡し、二重キャプチャを防ぐ
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

// ---------- tabCapture → offscreen ----------

async function startCapture(tabId) {
  const tab = await chrome.tabs.get(tabId);
  const url = tab.url;

  // 保存済み音量を取得
  let volume = 1.0;
  let saved = false;

  if (url) {
    const data = await chrome.storage.local.get("volumes");
    const volumes = data.volumes || {};
    if (volumes[url]) {
      volume = volumes[url].volume;
      saved = volumes[url].saved;
    }
  }

  // 既にキャプチャ中のタブなら、音量だけ更新して返す
  if (activeSessions.has(tabId)) {
    const session = activeSessions.get(tabId);

    // URLが変わっていたら保存データを再確認
    if (session.url !== url) {
      session.url = url;
      session.saved = saved;
      // 保存済みなら音量を復元
      if (saved) {
        session.volume = volume;
        chrome.runtime.sendMessage({
          type: "set-volume",
          target: "offscreen",
          tabId,
          volume,
        });
      }
    }

    return { volume: session.volume, saved: session.saved, url: session.url };
  }

  // 新規キャプチャ
  await ensureOffscreen();

  const streamId = await chrome.tabCapture.getMediaStreamId({
    targetTabId: tabId,
  });

  await chrome.runtime.sendMessage({
    type: "start-capture",
    target: "offscreen",
    streamId,
    tabId,
    volume,
  });

  // セッション登録
  activeSessions.set(tabId, { volume, saved, url });

  return { volume, saved, url };
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

      // Save ON なら storage も更新
      if (message.save && message.url) {
        saveVolume(message.url, message.volume);
      }

      sendResponse({ ok: true });
      return false;
    }

    case "save-on": {
      // セッション状態を更新
      for (const [, session] of activeSessions) {
        if (session.url === message.url) {
          session.saved = true;
        }
      }
      saveVolume(message.url, message.volume).then(() =>
        sendResponse({ ok: true })
      );
      return true;
    }

    case "save-off": {
      // セッション状態を更新
      for (const [, session] of activeSessions) {
        if (session.url === message.url) {
          session.saved = false;
        }
      }
      deleteVolume(message.url).then(() => sendResponse({ ok: true }));
      return true;
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

      if (message.save && message.url) {
        saveVolume(message.url, 1.0).then(() => sendResponse({ ok: true }));
        return true;
      }

      sendResponse({ ok: true });
      return false;
    }
  }
});

// ---------- タブ削除時のクリーンアップ ----------

chrome.tabs.onRemoved.addListener((tabId) => {
  activeSessions.delete(tabId);
});

// ---------- popup 初期化 ----------

async function handleInitPopup(message) {
  const tabId = message.tabId;

  try {
    const result = await startCapture(tabId);
    return {
      ok: true,
      volume: result.volume,
      saved: result.saved,
      url: result.url,
    };
  } catch (e) {
    console.error("startCapture failed:", e);
    return { ok: false, error: e.message };
  }
}

// ---------- storage helpers ----------

async function saveVolume(url, volume) {
  const data = await chrome.storage.local.get("volumes");
  const volumes = data.volumes || {};
  volumes[url] = {
    volume,
    saved: true,
    updatedAt: Date.now(),
  };
  await chrome.storage.local.set({ volumes });
}

async function deleteVolume(url) {
  const data = await chrome.storage.local.get("volumes");
  const volumes = data.volumes || {};
  delete volumes[url];
  await chrome.storage.local.set({ volumes });
}
