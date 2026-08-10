const assert = require("node:assert/strict");
const test = require("node:test");

const {
  createOffscreenEnvironment,
  loadExtensionScript,
} = require("../test-support/extension-harness");

function loadOffscreen(environment) {
  loadExtensionScript("offscreen.js", {
    AudioContext: environment.AudioContext,
    chrome: environment.chrome,
    navigator: environment.navigator,
  });
}

test("offscreen clamps start/set volume to 0..6 and uses 1 for non-finite values", async () => {
  const environment = createOffscreenEnvironment();
  loadOffscreen(environment);

  const started = await environment.dispatch({
    target: "offscreen",
    type: "start-capture",
    streamId: "stream-5",
    tabId: 5,
    volume: 7,
  });
  assert.deepEqual(started, { ok: true, volume: 6 });

  const cases = [
    [-1, 0],
    [3.25, 3.25],
    [7, 6],
    ["not-a-number", 1],
    [Infinity, 1],
  ];
  for (const [input, expected] of cases) {
    const response = await environment.dispatch({
      target: "offscreen",
      type: "set-volume",
      tabId: 5,
      volume: input,
    });
    assert.deepEqual(response, { ok: true, volume: expected });
  }
});

test("offscreen reuses an existing session and exposes lifecycle state", async () => {
  const environment = createOffscreenEnvironment();
  loadOffscreen(environment);

  const first = await environment.dispatch({
    target: "offscreen",
    type: "start-capture",
    streamId: "stream-8",
    tabId: 8,
    volume: 1,
  });
  const second = await environment.dispatch({
    target: "offscreen",
    type: "start-capture",
    streamId: "unused-stream",
    tabId: 8,
    volume: 2,
  });
  const state = await environment.dispatch({
    target: "offscreen",
    type: "get-session-state",
    tabId: 8,
  });

  assert.deepEqual(first, { ok: true, volume: 1 });
  assert.deepEqual(second, { ok: true, volume: 2 });
  assert.deepEqual(state, { exists: true, volume: 2 });
  assert.equal(environment.calls.getUserMedia.length, 1);

  const destroyed = await environment.dispatch({
    target: "offscreen",
    type: "destroy-session",
    tabId: 8,
  });
  assert.deepEqual(destroyed, {
    ok: true,
    remainingSessions: 0,
    isIdle: true,
  });
  assert.equal(environment.calls.audioContexts[0].closed, true);
});
