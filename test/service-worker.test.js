const assert = require("node:assert/strict");
const test = require("node:test");

const {
  createServiceWorkerChrome,
  deferred,
  flushAsync,
  loadExtensionScript,
} = require("../test-support/extension-harness");

function loadServiceWorker(environment) {
  loadExtensionScript("service_worker.js", { chrome: environment.chrome });
}

test("service worker clamps set-volume to 0..6 and uses 1 for non-finite values", async () => {
  const environment = createServiceWorkerChrome({
    contexts: [{}],
    sendMessage: async (message) => ({ ok: true, volume: message.volume }),
  });
  loadServiceWorker(environment);

  const cases = [
    [-1, 0],
    [2.75, 2.75],
    [7, 6],
    ["not-a-number", 1],
    [Infinity, 1],
  ];

  for (const [input, expected] of cases) {
    const response = await environment.dispatch({
      type: "set-volume",
      tabId: 7,
      volume: input,
    });

    assert.deepEqual(response, { ok: true, volume: expected });
    assert.equal(environment.calls.sendMessage.at(-1).volume, expected);
  }
});

test("service worker reports set-volume failure when the offscreen document is missing", async () => {
  const environment = createServiceWorkerChrome({ contexts: [] });
  loadServiceWorker(environment);

  const response = await environment.dispatch({
    type: "set-volume",
    tabId: 7,
    volume: 2,
  });

  assert.deepEqual(response, {
    ok: false,
    error: "No active audio session",
  });
  assert.equal(environment.calls.createDocument.length, 0);
  assert.equal(environment.calls.sendMessage.length, 0);
});

test("service worker reuses an existing offscreen session without recapturing the tab", async () => {
  const environment = createServiceWorkerChrome({
    contexts: [{}],
    sendMessage: async (message) => {
      assert.equal(message.type, "get-session-state");
      return { exists: true, volume: 2.5 };
    },
  });
  loadServiceWorker(environment);

  const first = await environment.dispatch({ type: "init-popup", tabId: 9 });
  const second = await environment.dispatch({ type: "init-popup", tabId: 9 });

  assert.deepEqual(first, { ok: true, volume: 2.5 });
  assert.deepEqual(second, { ok: true, volume: 2.5 });
  assert.equal(environment.calls.createDocument.length, 0);
  assert.equal(environment.calls.getMediaStreamId.length, 0);
});

test("concurrent initialization shares one gated offscreen creation", async () => {
  const createGate = deferred();
  const environment = createServiceWorkerChrome({
    contexts: [],
    createDocument: async () => createGate.promise,
    sendMessage: async (message) => {
      if (message.type === "get-session-state") {
        return { exists: false, volume: 1 };
      }
      return { ok: true, volume: message.volume };
    },
  });
  loadServiceWorker(environment);

  const first = environment.dispatch({ type: "init-popup", tabId: 1 });
  const second = environment.dispatch({ type: "init-popup", tabId: 2 });
  await flushAsync();

  assert.equal(environment.calls.createDocument.length, 1);
  assert.equal(environment.calls.getMediaStreamId.length, 0);

  createGate.resolve();
  assert.deepEqual(await first, { ok: true, volume: 1 });
  assert.deepEqual(await second, { ok: true, volume: 1 });
  assert.equal(environment.calls.createDocument.length, 1);
  assert.equal(environment.calls.getMediaStreamId.length, 2);
});

// offscreen document 側のセッション状態を模したフェイク。
// closeDocument で document ごとセッションが失われる実挙動を再現する。
function createOffscreenSessionFake({ sessions = [], gates = {} } = {}) {
  const liveSessions = new Map(sessions);
  const startCaptureCalls = [];

  return {
    liveSessions,
    startCaptureCalls,
    closeDocument: async () => {
      liveSessions.clear();
    },
    sendMessage: async (message) => {
      switch (message.type) {
        case "get-session-state":
          return {
            exists: liveSessions.has(message.tabId),
            volume: liveSessions.get(message.tabId) ?? null,
          };
        case "get-idle-state":
          return { isIdle: liveSessions.size === 0 };
        case "start-capture":
          startCaptureCalls.push(message.tabId);
          liveSessions.set(message.tabId, message.volume);
          return { ok: true, volume: message.volume };
        case "set-volume":
          if (!liveSessions.has(message.tabId)) {
            return { ok: false, error: "No active audio session" };
          }
          liveSessions.set(message.tabId, message.volume);
          return { ok: true, volume: message.volume };
        case "destroy-session": {
          liveSessions.delete(message.tabId);
          // 応答はこの時点の状態で確定し、配送だけが遅れる
          const response = {
            ok: true,
            remainingSessions: liveSessions.size,
            isIdle: liveSessions.size === 0,
          };
          if (gates.destroySession) {
            await gates.destroySession.promise;
          }
          return response;
        }
      }
      return undefined;
    },
  };
}

test("stale session-ended notification does not close a newer session", async () => {
  const offscreen = createOffscreenSessionFake();
  const environment = createServiceWorkerChrome({
    contexts: [{}],
    closeDocument: offscreen.closeDocument,
    sendMessage: offscreen.sendMessage,
  });
  loadServiceWorker(environment);

  // タブ1のセッション終了通知 (isIdle: true) が作られた後、
  // 配送される前にタブ2のセッションが始まった状況
  assert.deepEqual(await environment.dispatch({ type: "init-popup", tabId: 2 }), {
    ok: true,
    volume: 1,
  });
  await environment.dispatch({ type: "session-ended", tabId: 1, isIdle: true });
  await flushAsync();

  assert.equal(environment.calls.closeDocument, 0);
  assert.deepEqual(
    await environment.dispatch({ type: "set-volume", tabId: 2, volume: 2 }),
    { ok: true, volume: 2 }
  );
});

test("session-ended closes the offscreen document once it is really idle", async () => {
  const offscreen = createOffscreenSessionFake();
  const environment = createServiceWorkerChrome({
    contexts: [{}],
    closeDocument: offscreen.closeDocument,
    sendMessage: offscreen.sendMessage,
  });
  loadServiceWorker(environment);

  await environment.dispatch({ type: "session-ended", tabId: 1, isIdle: true });
  await flushAsync();

  assert.equal(environment.calls.closeDocument, 1);
});

test("tab removal racing with another tab's start does not drop the new session", async () => {
  const destroyGate = deferred();
  const offscreen = createOffscreenSessionFake({
    sessions: [[1, 1]],
    gates: { destroySession: destroyGate },
  });
  const environment = createServiceWorkerChrome({
    contexts: [{}],
    closeDocument: offscreen.closeDocument,
    sendMessage: offscreen.sendMessage,
  });
  loadServiceWorker(environment);

  environment.events.onRemoved.listeners[0](1);
  await flushAsync();
  const started = environment.dispatch({ type: "init-popup", tabId: 2 });
  await flushAsync();
  destroyGate.resolve();

  assert.deepEqual(await started, { ok: true, volume: 1 });
  await flushAsync();

  assert.equal(offscreen.liveSessions.has(2), true);
  assert.deepEqual(
    await environment.dispatch({ type: "set-volume", tabId: 2, volume: 3 }),
    { ok: true, volume: 3 }
  );
});

test("concurrent initialization of the same tab shares one capture", async () => {
  const offscreen = createOffscreenSessionFake();
  const environment = createServiceWorkerChrome({
    contexts: [{}],
    closeDocument: offscreen.closeDocument,
    sendMessage: offscreen.sendMessage,
  });
  loadServiceWorker(environment);

  const first = environment.dispatch({ type: "init-popup", tabId: 5 });
  const second = environment.dispatch({ type: "init-popup", tabId: 5 });

  assert.deepEqual(await first, { ok: true, volume: 1 });
  assert.deepEqual(await second, { ok: true, volume: 1 });
  assert.equal(environment.calls.getMediaStreamId.length, 1);
  assert.deepEqual(offscreen.startCaptureCalls, [5]);
});

test("a failed shared start is reported to every caller and can be retried", async () => {
  const offscreen = createOffscreenSessionFake();
  let failNext = true;
  const environment = createServiceWorkerChrome({
    contexts: [{}],
    closeDocument: offscreen.closeDocument,
    getMediaStreamId: async (options) => {
      if (failNext) {
        failNext = false;
        throw new Error("capture denied");
      }
      return `stream-${options.targetTabId}`;
    },
    sendMessage: offscreen.sendMessage,
  });
  loadServiceWorker(environment);

  const first = environment.dispatch({ type: "init-popup", tabId: 5 });
  const second = environment.dispatch({ type: "init-popup", tabId: 5 });

  assert.deepEqual(await first, { ok: false, error: "capture denied" });
  assert.deepEqual(await second, { ok: false, error: "capture denied" });
  assert.deepEqual(await environment.dispatch({ type: "init-popup", tabId: 5 }), {
    ok: true,
    volume: 1,
  });
});
