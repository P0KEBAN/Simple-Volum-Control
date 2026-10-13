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
  const events = [];
  const errorMsg = environment.elements["error-msg"];
  let errorText = "このタブでは音量制御を開始できません";
  Object.defineProperty(errorMsg, "textContent", {
    configurable: true,
    get: () => errorText,
    set: (value) => {
      errorText = String(value);
      events.push({ type: "text", value: errorText });
    },
  });

  const errorView = environment.elements["error-view"];
  let errorDisplay = "none";
  errorView.style = {};
  Object.defineProperty(errorView.style, "display", {
    configurable: true,
    get: () => errorDisplay,
    set: (value) => {
      errorDisplay = String(value);
      events.push({
        type: "display",
        value: errorDisplay,
        textAtDisplay: errorText,
      });
    },
  });
  loadExtensionScript("popup/popup.js", {
    chrome: environment.chrome,
    document: environment.document,
  });

  await environment.dispatchDocument("DOMContentLoaded");

  assert.equal(environment.elements["main-view"].style.display, "none");
  assert.equal(environment.elements["error-view"].style.display, "block");
  assert.equal(environment.elements["error-msg"].textContent, "操作できません");
  assert.deepEqual(events, [
    { type: "text", value: "操作できません" },
    { type: "display", value: "block", textAtDisplay: "操作できません" },
  ]);
});

async function loadInitializedPopup(overrides) {
  const environment = createPopupEnvironment(overrides);
  loadExtensionScript("popup/popup.js", {
    chrome: environment.chrome,
    document: environment.document,
  });
  await environment.dispatchDocument("DOMContentLoaded");
  return environment;
}

function pressKey(environment, event) {
  const keyEvent = {
    altKey: false,
    code: "",
    ctrlKey: false,
    defaultPrevented: false,
    key: "",
    metaKey: false,
    shiftKey: false,
    preventDefault() {
      this.defaultPrevented = true;
    },
    ...event,
  };
  environment.dispatchDocument("keydown", keyEvent);
  return keyEvent;
}

test("manifest suggests a shortcut that opens the popup", () => {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(__dirname, "../manifest.json"), "utf8")
  );

  assert.deepEqual(manifest.commands, {
    _execute_action: { suggested_key: { default: "Alt+Shift+V" } },
  });
});

test("popup focuses the slider once the controls are ready", async () => {
  const environment = await loadInitializedPopup({
    sendMessage: async () => ({ ok: true, volume: 1 }),
  });

  assert.equal(environment.elements["volume-slider"].focused, true);
});

test("popup does not focus the slider when initialization fails", async () => {
  const environment = await loadInitializedPopup({
    sendMessage: async () => ({ ok: false, error: "操作できません" }),
  });

  assert.equal(environment.elements["volume-slider"].focused, false);
});

test("popup keyboard shortcuts adjust, jump, and reset the volume", async () => {
  const environment = await loadInitializedPopup({
    sendMessage: async (message) => ({ ok: true, volume: message.volume ?? 1 }),
  });
  const slider = environment.elements["volume-slider"];
  const lastMessage = () => environment.calls.sendMessage.at(-1);

  const cases = [
    [{ key: "ArrowRight" }, 105],
    [{ key: "ArrowUp" }, 110],
    [{ key: "ArrowLeft" }, 105],
    [{ key: "ArrowDown" }, 100],
    [{ key: "ArrowUp", shiftKey: true }, 125],
    [{ key: "ArrowLeft", shiftKey: true }, 100],
    [{ key: "3", code: "Digit3" }, 300],
    [{ key: "6", code: "Numpad6" }, 600],
    [{ key: "ArrowRight", shiftKey: true }, 600],
    [{ key: "Process", code: "Digit0" }, 0],
    [{ key: "ArrowDown" }, 0],
  ];

  for (const [event, expected] of cases) {
    const keyEvent = pressKey(environment, event);

    assert.equal(slider.value, expected, JSON.stringify(event));
    assert.equal(slider.getAttribute("aria-valuetext"), `${expected}%`);
    assert.equal(keyEvent.defaultPrevented, true);
    assert.deepEqual(lastMessage(), {
      type: "set-volume",
      tabId: 123,
      volume: expected / 100,
    });
  }

  pressKey(environment, { key: "r", code: "KeyR" });
  await flushAsync();

  assert.equal(slider.value, 100);
  assert.deepEqual(lastMessage(), { type: "reset", tabId: 123 });
});

test("popup ignores unrelated keys, modifier combinations, and disabled controls", async () => {
  const environment = await loadInitializedPopup({
    sendMessage: async () => ({ ok: true, volume: 1 }),
  });
  const slider = environment.elements["volume-slider"];
  const sentBefore = environment.calls.sendMessage.length;

  const ignored = [
    { key: "7", code: "Digit7" },
    { key: "#", code: "Digit3", shiftKey: true },
    { key: "R", code: "KeyR", shiftKey: true },
    { key: "r", code: "KeyR", metaKey: true },
    { key: "ArrowUp", ctrlKey: true },
    { key: "ArrowUp", altKey: true },
    { key: "Tab", code: "Tab" },
  ];
  for (const event of ignored) {
    assert.equal(pressKey(environment, event).defaultPrevented, false);
  }

  slider.disabled = true;
  assert.equal(pressKey(environment, { key: "ArrowUp" }).defaultPrevented, false);

  assert.equal(slider.value, 100);
  assert.equal(environment.calls.sendMessage.length, sentBefore);
});
