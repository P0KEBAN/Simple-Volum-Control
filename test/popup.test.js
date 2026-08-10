const assert = require("node:assert/strict");
const test = require("node:test");

const {
  createPopupEnvironment,
  flushAsync,
  loadExtensionScript,
} = require("../test-support/extension-harness");

test("popup applies 5% steps, clamps to 0..600%, and falls back to 100%", async () => {
  const environment = createPopupEnvironment();
  loadExtensionScript("popup/popup.js", {
    chrome: environment.chrome,
    document: environment.document,
  });

  const cases = [
    [102, 100],
    [103, 105],
    [-20, 0],
    [700, 600],
    ["not-a-number", 100],
    [Infinity, 100],
  ];

  for (const [input, expected] of cases) {
    environment.elements["volume-slider"].value = input;
    environment.elements["volume-slider"].dispatch("input");
    await flushAsync();

    assert.equal(environment.elements["volume-slider"].value, expected);
    assert.equal(
      environment.elements["volume-display"].textContent,
      `${expected}%`
    );
    assert.deepEqual(environment.calls.sendMessage.at(-1), {
      type: "set-volume",
      tabId: null,
      volume: expected / 100,
    });
  }
});

test("popup initializes inside the fake tab/runtime environment", async () => {
  const environment = createPopupEnvironment({
    sendMessage: async (message) => {
      assert.deepEqual(message, { type: "init-popup", tabId: 42 });
      return { ok: true, volume: 2.534 };
    },
    queryTabs: async () => [{ id: 42 }],
  });
  loadExtensionScript("popup/popup.js", {
    chrome: environment.chrome,
    document: environment.document,
  });

  await environment.dispatchDocument("DOMContentLoaded");

  assert.equal(environment.elements["volume-slider"].value, 255);
  assert.equal(environment.elements["volume-display"].textContent, "255%");
  assert.equal(environment.elements["volume-slider"].disabled, false);
  assert.equal(environment.elements["reset-btn"].disabled, false);
});
