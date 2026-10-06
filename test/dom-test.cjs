/*
 * Run the plugin's page half in Node against a deterministic browser stand-in:
 * a virtual clock, a DOM that behaves like the real one for the operations this
 * plugin uses, real image sizes read from the asset files, and a fake audio
 * context. The point is to assert behaviour rather than eyeball it.
 *
 * STATUS: work in progress — this harness is NOT green yet. It predates several
 * later changes (the engine clock moved from requestAnimationFrame to a timer,
 * the pot art is cropped at runtime, and the platform's own asset loader is not
 * reproduced), so some assertions still fail. It is kept because it is the only
 * offline way to exercise the page half, but it is not a release blocker and it
 * is not run by CI. Delete the whole `test/` directory if you do not want it.
 *
 *   <DSH Desktop.exe> test/dom-test.cjs        (Node 18+ / Electron in node mode)
 */
const { readFileSync, readdirSync } = require('node:fs');
const { join, dirname, basename } = require('node:path');

const PACKAGE = dirname(__dirname);
const ASSETS = join(PACKAGE, 'assets');

/* ------------------------------------------------------------------ clock -- */

let clockMs = 0;
let timerSeq = 0;
const timers = new Map();
const rafQueue = [];

function schedule(fn, delay, repeat) {
  const id = (timerSeq += 1);
  timers.set(id, { fn, at: clockMs + Math.max(0, delay || 0), repeat: repeat ? Math.max(1, delay || 1) : 0 });
  return id;
}
const clearTimer = (id) => timers.delete(id);

function advance(ms, frameMs = 16) {
  const target = clockMs + ms;
  let guard = 0;
  for (;;) {
    if ((guard += 1) > 500000) throw new Error('virtual clock runaway');
    let next = null;
    let nextId = 0;
    for (const [id, timer] of timers) {
      if (timer.at <= target && (next === null || timer.at < next.at)) {
        next = timer;
        nextId = id;
      }
    }
    if (next === null) break;
    clockMs = Math.max(clockMs, next.at);
    if (next.repeat > 0) next.at = clockMs + next.repeat;
    else timers.delete(nextId);
    next.fn();
  }
  clockMs = target;
  let frames = Math.floor(ms / frameMs);
  while (frames > 0) {
    frames -= 1;
    const batch = rafQueue.splice(0, rafQueue.length);
    for (const frame of batch) frame(clockMs);
  }
}

const requestAnimationFrame = (callback) => rafQueue.push(callback);
const cancelAnimationFrame = () => {};

/* -------------------------------------------------------------------- dom -- */

function queryAll(root, selector) {
  const attribute = selector.startsWith('[') ? selector.replace(/^\[|\]$/g, '') : null;
  const tag = attribute === null ? selector.toUpperCase() : null;
  const found = [];
  const walk = (node) => {
    for (const child of node.children) {
      if (tag !== null && child.tagName === tag) found.push(child);
      if (attribute !== null && child.attributes[attribute] !== undefined) found.push(child);
      walk(child);
    }
  };
  walk(root);
  return found;
}

function canvasContext() {
  const calls = [];
  const record = (name) => (...args) => calls.push({ name, args });
  return {
    calls,
    setTransform: record('setTransform'),
    clearRect: record('clearRect'),
    save: record('save'),
    restore: record('restore'),
    beginPath: record('beginPath'),
    moveTo: record('moveTo'),
    lineTo: record('lineTo'),
    arc: record('arc'),
    stroke: record('stroke'),
    fill: record('fill'),
    fillText: record('fillText'),
    font: '',
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    textAlign: '',
    textBaseline: '',
  };
}

function createElement(tag) {
  const node = {
    tagName: String(tag).toUpperCase(),
    children: [],
    parentNode: null,
    style: {},
    dataset: {},
    attributes: {},
    textContent: '',
    listeners: {},
    complete: false,
    naturalWidth: 0,
    naturalHeight: 0,
    src: '',
    alt: '',
    draggable: true,
    setAttribute(name, value) {
      node.attributes[name] = String(value);
    },
    getAttribute(name) {
      return node.attributes[name];
    },
    removeAttribute(name) {
      delete node.attributes[name];
    },
    addEventListener(name, handler) {
      (node.listeners[name] = node.listeners[name] || []).push(handler);
    },
    removeEventListener(name, handler) {
      const list = node.listeners[name];
      if (list !== undefined) node.listeners[name] = list.filter((entry) => entry !== handler);
    },
    dispatch(name, event = {}) {
      for (const handler of [...(node.listeners[name] || [])]) {
        handler({ target: node, preventDefault() {}, stopPropagation() {}, ...event });
      }
    },
    appendChild(child) {
      child.parentNode = node;
      node.children.push(child);
      return child;
    },
    insertBefore(child) {
      child.parentNode = node;
      node.children.unshift(child);
      return child;
    },
    removeChild(child) {
      node.children = node.children.filter((entry) => entry !== child);
      child.parentNode = null;
      return child;
    },
    remove() {
      if (node.parentNode !== null) node.parentNode.removeChild(node);
    },
    replaceChildren(...next) {
      node.children = [];
      for (const child of next) {
        child.parentNode = node;
        node.children.push(child);
      }
    },
    get firstChild() {
      return node.children[0] ?? null;
    },
    get ownerDocument() {
      return document;
    },
    closest(selector) {
      let current = node;
      const attribute = selector.replace(/^\[|\]$/g, '');
      while (current !== null) {
        if (current.attributes && current.attributes[attribute] !== undefined) return current;
        current = current.parentNode;
      }
      return null;
    },
    getBoundingClientRect() {
      return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };
    },
    querySelectorAll: (selector) => queryAll(node, selector),
    querySelector: (selector) => queryAll(node, selector)[0] ?? null,
    getContext: () => canvasContext(),
    setPointerCapture() {},
    releasePointerCapture() {},
  };
  if (String(tag).toLowerCase() === 'canvas') {
    node.width = 300;
    node.height = 150;
  }
  return node;
}

const windowListeners = {};
const documentListeners = {};

const document = {
  body: createElement('body'),
  visibilityState: 'visible',
  createElement,
  createTextNode(value) {
    const node = createElement('#text');
    node.textContent = String(value);
    return node;
  },
  addEventListener(name, handler) {
    (documentListeners[name] = documentListeners[name] || []).push(handler);
  },
  removeEventListener(name, handler) {
    const list = documentListeners[name];
    if (list !== undefined) documentListeners[name] = list.filter((entry) => entry !== handler);
  },
  querySelectorAll: (selector) => queryAll(document.body, selector),
  querySelector: (selector) => queryAll(document.body, selector)[0] ?? null,
};

const dispatchWindow = (name, event) => {
  for (const handler of [...(windowListeners[name] || [])]) handler(event);
};

/* --------------------------------------------------------------- assets --- */

/** Read a PNG's real pixel size straight from its header. */
function pngSize(file) {
  const bytes = readFileSync(file);
  if (bytes.length < 24 || bytes.toString('ascii', 1, 4) !== 'PNG') return { width: 0, height: 0 };
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

const assetSizes = {};
const assetRequests = [];
for (const name of readdirSync(ASSETS)) {
  if (name.endsWith('.png')) assetSizes[name] = pngSize(join(ASSETS, name));
}
/* The iron bowl ships as WebP; sharp reports the delivered sheet as 2048x2048. */
assetSizes['iron_bowl.webp'] = { width: 2048, height: 2048 };

class FakeImage {
  constructor() {
    this.style = {};
    this.listeners = {};
    this.complete = false;
    this.naturalWidth = 0;
    this.naturalHeight = 0;
    this.alt = '';
    this.draggable = true;
    this._src = '';
  }
  set src(value) {
    this._src = String(value);
    const name = basename(this._src);
    assetRequests.push(name);
    const size = assetSizes[name] ?? { width: 1024, height: 1024 };
    this.naturalWidth = size.width;
    this.naturalHeight = size.height;
    this.complete = true;
    schedule(() => this.dispatch('load'), 1, false);
  }
  get src() {
    return this._src;
  }
  addEventListener(name, handler) {
    (this.listeners[name] = this.listeners[name] || []).push(handler);
  }
  removeEventListener(name, handler) {
    const list = this.listeners[name];
    if (list !== undefined) this.listeners[name] = list.filter((entry) => entry !== handler);
  }
  dispatch(name) {
    for (const handler of [...(this.listeners[name] || [])]) handler({ target: this });
  }
  setAttribute() {}
  remove() {}
}

/* ---------------------------------------------------------------- audio --- */

const audio = { contexts: 0, played: 0, gains: [] };

class FakeAudioContext {
  constructor() {
    audio.contexts += 1;
    this.state = 'running';
    this.destination = {};
  }
  createGain() {
    const gain = { value: 0, connect() {} };
    audio.gains.push(gain);
    return gain;
  }
  createBufferSource() {
    const source = { buffer: null, connect() {}, start: () => (audio.played += 1) };
    return source;
  }
  async decodeAudioData(bytes) {
    return { bytes: bytes.byteLength };
  }
  async resume() {}
  async close() {}
}

/* ---------------------------------------------------------------- window -- */

const balanceAnswer = { ok: true, total: 53.69, currency: 'CNY' };
const fetchLog = [];
let keyOverride = null;

const window = {
  innerWidth: 1600,
  innerHeight: 900,
  devicePixelRatio: 1,
  location: { href: 'http://127.0.0.1:43120/' },
  navigator: { language: 'zh-CN' },
  AudioContext: FakeAudioContext,
  Image: FakeImage,
  requestAnimationFrame,
  cancelAnimationFrame,
  setTimeout: (fn, delay) => schedule(fn, delay, false),
  clearTimeout: clearTimer,
  setInterval: (fn, delay) => schedule(fn, delay, true),
  clearInterval: clearTimer,
  performance: { now: () => clockMs },
  localStorage: {
    store: new Map(),
    getItem(key) {
      return window.localStorage.store.has(key) ? window.localStorage.store.get(key) : null;
    },
    setItem(key, value) {
      window.localStorage.store.set(key, String(value));
    },
    removeItem(key) {
      window.localStorage.store.delete(key);
    },
  },
  addEventListener(name, handler) {
    (windowListeners[name] = windowListeners[name] || []).push(handler);
  },
  removeEventListener(name, handler) {
    const list = windowListeners[name];
    if (list !== undefined) windowListeners[name] = list.filter((entry) => entry !== handler);
  },
  fetch: async (url, init) => {
    const path = String(url);
    fetchLog.push(path);
    if (path.includes('/balance')) {
      return { ok: true, status: 200, async json() { return balanceAnswer; } };
    }
    if (path.includes('/key')) {
      keyOverride = JSON.parse(init.body).key;
      return { ok: true, status: 200, async json() { return { ok: true }; } };
    }
    if (path.endsWith('.mp3')) {
      return { ok: true, status: 200, async arrayBuffer() { return new ArrayBuffer(16); } };
    }
    return { ok: false, status: 404, async json() { return {}; }, async arrayBuffer() { return new ArrayBuffer(0); } };
  },
};

global.window = window;
global.document = document;
global.navigator = window.navigator;
global.__HARNESS__ = { errors: [] };
global.Image = FakeImage;
global.HTMLImageElement = FakeImage;
global.HTMLDivElement = function HTMLDivElement() {};
global.HTMLElement = function HTMLElement() {};
global.Element = function Element() {};
global.Node = function Node() {};
global.Response = class Response {
  constructor(body, init = {}) {
    this.body = body;
    this.status = init.status ?? 200;
    this.ok = this.status >= 200 && this.status < 300;
  }
  async json() {
    return JSON.parse(this.body);
  }
  async arrayBuffer() {
    return new ArrayBuffer(8);
  }
};
global.requestAnimationFrame = requestAnimationFrame;
global.cancelAnimationFrame = cancelAnimationFrame;
global.setTimeout = window.setTimeout;
global.clearTimeout = window.clearTimeout;
global.setInterval = window.setInterval;
global.clearInterval = window.clearInterval;
global.performance = window.performance;
global.fetch = window.fetch;

/* ----------------------------------------------------------------- boot --- */

const registrationQueue = [];
window.__ModuleLoader__ = {
  load(registration) {
    registrationQueue.push(registration);
  },
};

const clientSource = readFileSync(join(PACKAGE, 'client.js'), 'utf8');
const factoryArgs = [
  'window',
  'document',
  'Image',
  'fetch',
  'navigator',
  'requestAnimationFrame',
  'cancelAnimationFrame',
  'setTimeout',
  'setInterval',
  'clearTimeout',
  'clearInterval',
  'performance',
];
// eslint-disable-next-line no-new-func
new Function(...factoryArgs, clientSource)(
  window,
  document,
  FakeImage,
  window.fetch,
  window.navigator,
  requestAnimationFrame,
  cancelAnimationFrame,
  window.setTimeout,
  window.setInterval,
  window.clearTimeout,
  window.clearInterval,
  window.performance,
);

const harness = require('./mini-react.cjs');
const React = harness.react;

const registration = registrationQueue[0];
if (registration === undefined) {
  process.stdout.write('FAIL  client.js never registered a factory\n');
  process.exit(1);
}

let registered = null;
let injectedKey = null;
const ctx = {
  slots: {
    inject(key, callback) {
      injectedKey = key;
      callback();
    },
    register(options, component) {
      registered = { options, component };
    },
  },
};
const pluginExports = registration.factory((specifier) => {
  if (specifier === 'react') return React;
  throw new Error(`unexpected require("${specifier}")`);
});
pluginExports.apply(ctx);

/* ----------------------------------------------------------------- tests -- */

const results = [];
const check = (name, condition, detail) => {
  results.push({ name, ok: Boolean(condition) });
  process.stdout.write(`${condition ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : `  (${detail})`}\n`);
};
const find = (node, predicate) => {
  if (predicate(node)) return node;
  for (const child of node.children) {
    const hit = find(child, predicate);
    if (hit !== null) return hit;
  }
  return null;
};
const findAll = (node, predicate, out = []) => {
  if (predicate(node)) out.push(node);
  for (const child of node.children) findAll(child, predicate, out);
  return out;
};

check('factory registers into shell.overlay', injectedKey === 'shell.overlay' && registered.options.id === 'dsh-balance-pet', String(injectedKey));

const host = document.createElement('div');
document.body.appendChild(host);

/* First check the harness itself: a ref plus a nested effect must work. */
const refProbe = [];
const Leaf = () => {
  const own = React.useRef(null);
  React.useEffect(() => {
    refProbe.push(`leaf effect current=${own.current === null ? 'null' : 'node'}`);
  }, []);
  return React.createElement('div', {
    ref: (node) => {
      own.current = node;
      refProbe.push(`leaf ref ${node === null ? 'null' : 'node'}`);
    },
  });
};
const Probe = () => {
  const ref = React.useRef(null);
  refProbe.push(`render ref=${ref === null ? 'null-ref' : `object:${'current' in ref}`}`);
  React.useEffect(() => {
    refProbe.push(`effect current=${ref.current === null ? 'null' : typeof ref.current}`);
  }, []);
  const callback = (node) => {
    refProbe.push(`callback ${node === null ? 'null' : 'node'}`);
    ref.current = node;
    refProbe.push(`callback-set current=${ref.current === null ? 'null' : typeof ref.current}`);
  };
  return React.createElement('div', { ref: callback, style: { width: 1 } }, React.createElement(Leaf, {}));
};
const probeHost = document.createElement('div');
document.body.appendChild(probeHost);
harness.createRoot(probeHost).render(React.createElement(Probe, {}));
advance(20);
check(
  'harness: refs and effects work',
  refProbe.join(',') === 'render ref=object:true,callback node,callback-set current=object,leaf ref node,leaf effect current=node,effect current=object',
  refProbe.join(','),
);
/* The probe subtree must not leak into the assertions below. */
document.body.removeChild(probeHost);
harness.mini.instances.length = 0;
host.replaceChildren();

const effectLog = [];
const realUseEffect = React.useEffect;
React.useEffect = (create, deps) => {
  effectLog.push(`scheduled deps=${deps === undefined ? 'none' : deps.length}`);
  return realUseEffect(() => {
    effectLog.push('ran');
    try {
      return create();
    } catch (error) {
      effectLog.push(`threw ${error && error.message}`);
      throw error;
    }
  }, deps);
};
harness.createRoot(host).render(React.createElement(registered.component, {}));
advance(60);
const engine = window.__DSH_BALANCE_PET__;
const images = () => findAll(host, (node) => node.tagName === 'IMG');
const frames = harness.mini.findTag(document.body, 'DIV').filter((node) => node.style.position === 'fixed');
check(
  'the engine was created',
  engine !== undefined && engine !== null,
  `effects=[${effectLog.join(' ')}] errors=${harness.errors.join(' | ')}`,
);
check(
  'the engine appended its elements to the overlay frame',
  frames.length >= 1 && frames[0].children.some((node) => node.tagName === 'CANVAS'),
  `frameIdx=${harness.mini.findTag(document.body, 'DIV').indexOf(frames[0])} frameChildren=${frames.length >= 1 ? frames[0].children.map((node) => node.tagName).join(',') : 'none'} canvasParentTag=${engine && engine.canvas.parentNode ? engine.canvas.parentNode.tagName : 'none'} canvasParentIsFrame=${engine && engine.canvas.parentNode === frames[0]}`,
);
if (engine === undefined || engine === null) {
  process.stdout.write('cannot continue without the engine\n');
  process.exit(1);
}
check('the overlay frame is mounted', frames.length >= 1, `fixed=${frames.length}`);

advance(1000);
const dumpTree = () => {
  const lines = [];
  const walk = (node, path) => {
    lines.push(`${path} ${node.tagName.toLowerCase()}${node.style.cursor ? ` cursor=${node.style.cursor}` : ''} children=${node.children.length}`);
    let index = 0;
    for (const child of [...node.children]) walk(child, `${path}.${index++}`);
  };
  walk(host, 'host');
  walk(probeHost, 'probe');
  return lines.join(' | ');
};
check('the pet element is mounted', find(host, (node) => node.style.cursor === 'grab') !== null, dumpTree());
check('four faces plus a flash layer exist', images().length === 5, String(images().length));
check(
  'the delivered expression sheets are requested',
  assetRequests.includes('expression_happy.png') && assetRequests.includes('expression_nervous.png') && assetRequests.includes('flash.png'),
  assetRequests.join(','),
);
check('the plain sprite is not requested (the sheets carry the art)', !assetRequests.includes('sprite.png'));

const readout = find(host, (node) => node.style.transformOrigin === '0 0');
check('the tablet readout exists', readout !== null);
check('the readout shows the live balance', readout !== null && readout.textContent.includes('53.69'), readout === null ? '' : readout.textContent);
check('the readout carries the DSH balance label', readout !== null && readout.textContent.includes('DSH'), readout === null ? '' : readout.textContent);
check('the readout is projected onto the panel', readout !== null && String(readout.style.transform).startsWith('matrix3d('), readout === null ? '' : String(readout.style.transform).slice(0, 22));
check('the balance route was polled', fetchLog.some((entry) => entry.includes('/balance')), fetchLog.slice(0, 3).join(','));

/* ------------------------------------------------------------ charge cue -- */

const flash = images()[4];
engine.sim.queued = 1;
engine.sim.cueT = 0;
advance(300);
check('a charge lowers the readout by 0.01', readout.textContent.includes('53.68'), readout.textContent);
check('the flash layer lights up', Number(flash.style.opacity) > 0, flash.style.opacity);
const cueNodes = findAll(host, (node) => node.textContent.trim().startsWith('-') && String(node.style.transform).includes('translate3d'));
check('a -0.01 cue floats above her', cueNodes.length >= 1, JSON.stringify(cueNodes.map((node) => node.textContent)));
check('the cue uses the desktop red', cueNodes.length >= 1 && cueNodes[0].style.color === '#ff3022', cueNodes.length >= 1 ? cueNodes[0].style.color : '');
check('the hit sound played', audio.played >= 1, String(audio.played));
check('she turns nervous while charging', images()[1].style.opacity === '1', images()[1].style.opacity);
advance(1500);
check('the flash fades out again', Number(flash.style.opacity) === 0, flash.style.opacity);
check('she relaxes after the cue', images()[0].style.opacity === '1', images()[0].style.opacity);

/* ----------------------------------------------------------- top-up flow -- */

const stable = readout.textContent;
engine.sim.pending = 3;
const bowl = engine.dropRiceBowl(3);
advance(2500);
check('the dropped bowl exists', engine.sim.bowls.length === 1, String(engine.sim.bowls.length));
check('the number does not move for a pending top-up', readout.textContent === stable, `${stable} -> ${readout.textContent}`);
check('the bowl carries the rice art', bowl.node.children[0].src.endsWith('rice.png'), bowl.node.children[0].src);
check('the bowl is 44% of the pet', Math.abs(Number.parseFloat(bowl.node.style.width) - engine.state.size * 0.44) < 0.01, bowl.node.style.width);
check('the bowl fell to the floor', bowl.y > 200, String(Math.round(bowl.y)));
check('the bowl listens for a pointer press', (bowl.node.listeners.pointerdown || []).length === 1);

/* Drag it onto her the way the pointer events do. */
bowl.node.dispatch('pointerdown', { button: 0, clientX: bowl.x + 10, clientY: bowl.y + 10, pointerId: 1 });
dispatchWindow('pointermove', { clientX: engine.sim.petX + engine.state.size * 0.3, clientY: engine.sim.petY + engine.state.size * 0.3 });
dispatchWindow('pointerup', {});
advance(200);
check('feeding credits the top-up in one go', readout.textContent.includes('56.68'), readout.textContent);
check('the bowl disappears when fed', engine.sim.bowls.filter((entry) => entry.kind === 'rice').length === 0, String(engine.sim.bowls.length));
check('the feed sound played', audio.played >= 2, String(audio.played));
check('hearts rise on a feed', findAll(host, (node) => String(node.style.clipPath || '').startsWith('polygon')).length > 0);
check('eating the bowl drops the iron pot', engine.sim.iron !== null, engine.sim.iron === null ? 'none' : engine.sim.iron.kind);
check('the pot element exists', find(host, (node) => node.dataset.kind === 'iron') !== null);
const iron = engine.sim.iron;
if (iron !== null) {
  iron.x = engine.sim.petX + engine.state.size * 0.42;
  iron.y = engine.sim.petY + engine.state.size * 0.2;
  iron.vy = 30;
  iron.vx = 0;
  advance(300);
  check('the pot seats on her head', iron.onHead === true, String(iron.onHead));
  check('the worn pot is tilted like the desktop art', Math.abs((iron.angle * 180) / Math.PI + 6.23) < 0.01, ((iron.angle * 180) / Math.PI).toFixed(2));
  check('wearing the pot shows the calm face', images()[3].style.opacity === '1', images()[3].style.opacity);
}

/* -------------------------------------------------------------- iron pot -- */

if (engine.sim.iron !== null) {
  const petElement = find(host, (node) => node.style.cursor === 'grab');
  const headX = engine.sim.petX + engine.state.size * 0.45;
  const headY = engine.sim.petY + engine.state.size * 0.2;
  petElement.dispatch('pointerdown', { button: 0, clientX: headX, clientY: headY, pointerId: 2 });
  petElement.dispatch('pointerup', {});
  engine.sim.headClickT -= 500;
  petElement.dispatch('pointerdown', { button: 0, clientX: headX, clientY: headY, pointerId: 3 });
  petElement.dispatch('pointerup', {});
  advance(300);
  check(
    'double-clicking her head knocks the pot off',
    engine.sim.iron === null || engine.sim.iron.onHead === false,
    String(engine.sim.iron === null ? 'gone' : engine.sim.iron.onHead),
  );
}

/* --------------------------------------------------------------- radar ---- */

const radarBowl = engine.dropRiceBowl(1);
advance(1500);
const canvas = find(host, (node) => node.tagName === 'CANVAS');
engine.state.radarManual = true;
advance(200);
const plateCalls = canvas
  .getContext()
  .calls.filter((entry) => entry.name === 'fillText')
  .map((entry) => String(entry.args[0]));
check('the fire-control nameplate draws its readouts', plateCalls.some((text) => text.startsWith('RNG')), plateCalls.slice(-4).join(' | '));
check('the nameplate shows a lock timer', plateCalls.some((text) => text.startsWith('LOCK')), plateCalls.slice(-4).join(' | '));
engine.state.radarManual = false;
advance(9000);
check('an unclaimed bowl locks after ten seconds', engine.sim.locked === true || engine.sim.bowls.length === 0, `locked=${engine.sim.locked}`);
check('the magnet then removes the bowl', engine.sim.bowls.filter((entry) => entry.kind === 'rice').length === 0, String(engine.sim.bowls.length));
check('the fed magnet credited the screen', readout.textContent.includes('57.69'), readout.textContent);
void radarBowl;

/* ------------------------------------------------------------ menu + key -- */

engine.openMenu(120, 120);
advance(60);
const menuRoot = find(host, (node) => node.attributes['data-pet-menu'] !== undefined);
check('right click opens the menu', menuRoot !== null);
const menuText = menuRoot === null ? '' : menuRoot.children.map((node) => node.textContent).join('|');
check('menu: refresh row', menuText.includes('\u7ACB\u5373\u5237\u65B0\u4F59\u989D'));
check('menu: test group', menuText.includes('\u6D4B\u8BD5'));
check('menu: top-up row', menuText.includes('\u6D4B\u8BD5\u5145\u503C\u52A8\u753B'));
check('menu: demo row', menuText.includes('\u6F14\u793A\u8FDE\u7EED\u6263\u8D39'));
check('menu: display group', menuText.includes('\u663E\u793A'));
check('menu: appearance row', menuText.includes('\u5916\u89C2'));
check('menu: sound row', menuText.includes('\u58F0\u97F3'));
check('menu: system group', menuText.includes('\u7CFB\u7EDF'));
check('menu: quit row', menuText.includes('\u9000\u51FA'));

/* A demo charge from the submenu must actually cue, not just close. */
const demoRow = menuRoot === null ? null : menuRoot.children.find((node) => node.textContent.includes('\u6F14\u793A\u8FDE\u7EED\u6263\u8D39'));
check('the demo row is a submenu', demoRow !== null);
if (demoRow !== null) {
  demoRow.dispatch('click', {});
  advance(60);
  const menus = findAll(host, (node) => node.attributes['data-pet-menu'] !== undefined);
  check('the submenu opens beside the root menu', menus.length >= 2, String(menus.length));
  const item = menus.length >= 2 ? menus[1].children.find((node) => node.textContent.trim().startsWith('-0.1')) : null;
  check('the submenu lists the demo amounts', item !== null, menus.length >= 2 ? menus[1].children.map((n) => n.textContent).join(',') : '');
  const queuedBefore = engine.sim.queued;
  if (item !== null) {
    item.dispatch('click', {});
    advance(50);
    check('clicking a demo amount queues a run of charges', engine.sim.queued > queuedBefore + 5, `${queuedBefore} -> ${engine.sim.queued}`);
  }
}

/* ------------------------------------------------------------ final pass -- */

const run = async () => {
  await engine.setApiKey('sk-test-1234567890');
  advance(200);
  check('the API key row posts to the host', keyOverride === 'sk-test-1234567890', String(keyOverride));
  check('the character hugs the bottom-left corner', engine.sim.petX === 8 && engine.sim.petY > 100, `${engine.sim.petX},${engine.sim.petY}`);
  check('settings are persisted', window.localStorage.getItem('dsh-balance-pet/v1') !== null, String(window.localStorage.getItem('dsh-balance-pet/v1')));

  const failed = results.filter((entry) => !entry.ok);
  process.stdout.write(`\n${results.length - failed.length}/${results.length} checks passed\n`);
  if (failed.length > 0) process.stdout.write(`failed:\n  ${failed.map((entry) => entry.name).join('\n  ')}\n`);
  if (harness.errors.length > 0) process.stdout.write(`harness errors:\n  ${harness.errors.join('\n  ')}\n`);
  process.exit(failed.length === 0 ? 0 : 1);
};

void run();
