const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  createPopupEnvironment,
  flushAsync,
  loadExtensionScript,
} = require("../test-support/extension-harness");

const popupHtml = fs.readFileSync(
  path.join(__dirname, "../popup/popup.html"),
  "utf8"
);
const popupCss = fs.readFileSync(
  path.join(__dirname, "../popup/popup.css"),
  "utf8"
);

test("popup declares accessible slider and error contracts", () => {
  const sliderTag = popupHtml.match(/<input\b[^>]*id="volume-slider"[^>]*>/s)?.[0];
  const errorViewTag = popupHtml.match(/<div\b[^>]*id="error-view"[^>]*>/s)?.[0];

  assert.ok(sliderTag);
  assert.match(sliderTag, /aria-label="音量"/);
  assert.match(sliderTag, /aria-valuemin="0"/);
  assert.match(sliderTag, /aria-valuemax="600"/);
  assert.match(sliderTag, /aria-valuenow="100"/);
  assert.match(sliderTag, /aria-valuetext="100%"/);
  assert.doesNotMatch(sliderTag, /aria-live=/);

  assert.ok(errorViewTag);
  assert.match(errorViewTag, /role="alert"/);
  assert.match(errorViewTag, /aria-live="assertive"/);
  assert.match(errorViewTag, /aria-atomic="true"/);
});

test("popup keeps keyboard focus visible and marker text opaque", () => {
  assert.doesNotMatch(
    popupCss,
    /input\[type="range"\][^{]*\{[^}]*outline:\s*none/s
  );
  assert.match(
    popupCss,
    /input\[type="range"\]:focus-visible[\s\S]*?outline:\s*2px\s+solid\s+currentColor/
  );
  assert.match(
    popupCss,
    /@media\s*\(forced-colors:\s*active\)[\s\S]*?outline:\s*2px\s+solid\s+CanvasText/
  );
  assert.match(
    popupCss,
    /\.marker\s*\{[\s\S]*?opacity:\s*1;/
  );
});

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
  assert.equal(
    environment.elements["volume-slider"].getAttribute("aria-valuenow"),
    "255"
  );
  assert.equal(
    environment.elements["volume-slider"].getAttribute("aria-valuetext"),
    "255%"
  );
  assert.equal(environment.elements["volume-slider"].disabled, false);
  assert.equal(environment.elements["reset-btn"].disabled, false);
});

test("popup synchronizes the accessible percent value on input and reset", async () => {
  const environment = createPopupEnvironment();
  loadExtensionScript("popup/popup.js", {
    chrome: environment.chrome,
    document: environment.document,
  });

  const slider = environment.elements["volume-slider"];
  slider.value = 305;
  slider.dispatch("input");

  assert.equal(slider.getAttribute("aria-valuenow"), "305");
  assert.equal(slider.getAttribute("aria-valuetext"), "305%");

  await environment.elements["reset-btn"].dispatch("click");

  assert.equal(slider.value, 100);
  assert.equal(slider.getAttribute("aria-valuenow"), "100");
  assert.equal(slider.getAttribute("aria-valuetext"), "100%");
});

test("popup exposes runtime errors through the alert view", async () => {
  const environment = createPopupEnvironment({
    sendMessage: async () => ({ ok: false, error: "操作できません" }),
  });
  loadExtensionScript("popup/popup.js", {
    chrome: environment.chrome,
    document: environment.document,
  });

  await environment.dispatchDocument("DOMContentLoaded");

  assert.equal(environment.elements["main-view"].style.display, "none");
  assert.equal(environment.elements["error-view"].style.display, "block");
  assert.equal(environment.elements["error-msg"].textContent, "操作できません");
});
