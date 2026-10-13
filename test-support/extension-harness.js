const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const REPO_ROOT = path.resolve(__dirname, "..");

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, resolve, reject };
}

function createChromeEvent() {
  const listeners = [];

  return {
    addListener(listener) {
      listeners.push(listener);
    },
    listeners,
  };
}

function loadExtensionScript(relativePath, globals) {
  const filename = path.join(REPO_ROOT, relativePath);
  const source = fs.readFileSync(filename, "utf8");
  const context = vm.createContext({
    console: {
      error() {},
      log() {},
      warn() {},
    },
    ...globals,
  });

  new vm.Script(source, { filename }).runInContext(context);
  return context;
}

function dispatchRuntimeMessage(onMessage, message, sender = {}) {
  const listener = onMessage.listeners[0];
  if (!listener) {
    throw new Error("runtime.onMessage listener was not registered");
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    const sendResponse = (response) => {
      settled = true;
      resolve(structuredClone(response));
    };

    try {
      const result = listener(message, sender, sendResponse);
      if (result !== true && !settled) {
        resolve(undefined);
      }
    } catch (error) {
      reject(error);
    }
  });
}

function createServiceWorkerChrome(overrides = {}) {
  const onMessage = createChromeEvent();
  const onRemoved = createChromeEvent();
  const calls = {
    closeDocument: 0,
    createDocument: [],
    getContexts: [],
    getMediaStreamId: [],
    sendMessage: [],
  };
  let contexts = overrides.contexts ? [...overrides.contexts] : [];

  const chrome = {
    runtime: {
      getContexts: async (query) => {
        calls.getContexts.push(query);
        if (overrides.getContexts) {
          return overrides.getContexts(query);
        }
        return [...contexts];
      },
      getURL: (relativePath) => `chrome-extension://test/${relativePath}`,
      onMessage,
      sendMessage: async (message) => {
        const clonedMessage = structuredClone(message);
        calls.sendMessage.push(clonedMessage);
        if (overrides.sendMessage) {
          return overrides.sendMessage(clonedMessage);
        }
        return undefined;
      },
    },
    offscreen: {
      closeDocument: async () => {
        calls.closeDocument += 1;
        if (overrides.closeDocument) {
          await overrides.closeDocument();
        }
        contexts = [];
      },
      createDocument: async (options) => {
        calls.createDocument.push(options);
        if (overrides.createDocument) {
          await overrides.createDocument(options);
        }
        contexts = [{}];
      },
    },
    tabCapture: {
      getMediaStreamId: async (options) => {
        calls.getMediaStreamId.push(options);
        if (overrides.getMediaStreamId) {
          return overrides.getMediaStreamId(options);
        }
        return `stream-${options.targetTabId}`;
      },
    },
    tabs: {
      onRemoved,
    },
  };

  return {
    calls,
    chrome,
    dispatch: (message, sender) =>
      dispatchRuntimeMessage(onMessage, message, sender),
    events: { onMessage, onRemoved },
    setContexts(nextContexts) {
      contexts = [...nextContexts];
    },
  };
}

function createClassList() {
  const values = new Set();
  return {
    add: (value) => values.add(value),
    contains: (value) => values.has(value),
    remove: (value) => values.delete(value),
  };
}

function createElement(initial = {}) {
  const listeners = new Map();
  const attributes = new Map();
  return {
    attributes,
    classList: createClassList(),
    disabled: false,
    focused: false,
    style: {},
    textContent: "",
    value: "",
    ...initial,
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
    focus() {
      this.focused = !this.disabled;
    },
    getAttribute(name) {
      return attributes.has(name) ? attributes.get(name) : null;
    },
    setAttribute(name, value) {
      attributes.set(name, String(value));
    },
    dispatch(type) {
      const listener = listeners.get(type);
      if (!listener) {
        throw new Error(`element listener was not registered: ${type}`);
      }
      return listener();
    },
  };
}

function createPopupEnvironment(overrides = {}) {
  const documentListeners = new Map();
  const elements = {
    "error-msg": createElement(),
    "error-view": createElement({ style: { display: "none" } }),
    "main-view": createElement({ style: { display: "block" } }),
    "reset-btn": createElement(),
    "volume-display": createElement({ textContent: "100%" }),
    "volume-slider": createElement({ value: "100" }),
  };
  const calls = {
    query: [],
    sendMessage: [],
  };
  const document = {
    addEventListener(type, listener) {
      documentListeners.set(type, listener);
    },
    getElementById(id) {
      return elements[id];
    },
  };
  const chrome = {
    runtime: {
      sendMessage: async (message) => {
        const clonedMessage = structuredClone(message);
        calls.sendMessage.push(clonedMessage);
        if (overrides.sendMessage) {
          return overrides.sendMessage(clonedMessage);
        }
        return { ok: true };
      },
    },
    tabs: {
      query: async (query) => {
        calls.query.push(query);
        if (overrides.queryTabs) {
          return overrides.queryTabs(query);
        }
        return [{ id: 123 }];
      },
    },
  };

  return {
    calls,
    chrome,
    document,
    elements,
    dispatchDocument(type, event) {
      const listener = documentListeners.get(type);
      if (!listener) {
        throw new Error(`document listener was not registered: ${type}`);
      }
      return listener(event);
    },
  };
}

function createMediaStream() {
  const endedListeners = [];
  const track = {
    stopped: false,
    addEventListener(type, listener) {
      if (type === "ended") {
        endedListeners.push(listener);
      }
    },
    stop() {
      this.stopped = true;
    },
  };

  return {
    endedListeners,
    getTracks: () => [track],
    track,
  };
}

function createOffscreenEnvironment(overrides = {}) {
  const onMessage = createChromeEvent();
  const calls = {
    audioContexts: [],
    getUserMedia: [],
    sendMessage: [],
  };

  class FakeAudioContext {
    constructor() {
      this.destination = {};
      this.closed = false;
      this.gainNode = {
        connect() {},
        disconnect() {},
        gain: { value: 1 },
      };
      this.source = {
        connect() {},
        disconnect() {},
      };
      calls.audioContexts.push(this);
    }

    close() {
      this.closed = true;
    }

    createGain() {
      return this.gainNode;
    }

    createMediaStreamSource() {
      return this.source;
    }
  }

  const chrome = {
    runtime: {
      onMessage,
      sendMessage: async (message) => {
        const clonedMessage = structuredClone(message);
        calls.sendMessage.push(clonedMessage);
        if (overrides.sendMessage) {
          return overrides.sendMessage(clonedMessage);
        }
        return { ok: true };
      },
    },
  };
  const navigator = {
    mediaDevices: {
      getUserMedia: async (constraints) => {
        calls.getUserMedia.push(constraints);
        if (overrides.getUserMedia) {
          return overrides.getUserMedia(constraints);
        }
        return createMediaStream();
      },
    },
  };

  return {
    AudioContext: FakeAudioContext,
    calls,
    chrome,
    dispatch: (message, sender) =>
      dispatchRuntimeMessage(onMessage, message, sender),
    events: { onMessage },
    navigator,
  };
}

function flushAsync() {
  return new Promise((resolve) => setImmediate(resolve));
}

module.exports = {
  createOffscreenEnvironment,
  createPopupEnvironment,
  createServiceWorkerChrome,
  deferred,
  flushAsync,
  loadExtensionScript,
};
