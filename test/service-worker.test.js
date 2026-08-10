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
