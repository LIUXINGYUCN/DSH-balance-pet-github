/*
 * A very small React stand-in: enough of the createElement contract and the hooks
 * for function components, so the plugin's page half can be driven in a Node
 * harness without the app's React build. Only the tests use it; the shipped
 * plugin runs on the Harness React runtime.
 *
 * Hooks resolve through one module-level dispatcher that is pinned to the
 * component instance being rendered, and restored right after each render — the
 * same shape the real React uses, so an effect closure keeps writing into the
 * hook slot of the component that created it.
 */
const harness = (global.__HARNESS__ = global.__HARNESS__ || { errors: [] });
harness.errors = harness.errors || [];
const report = (message) => harness.errors.push(message);
const debug = process.env.HARNESS_DEBUG === '1';
const isClass = (type) => typeof type === 'function' && /^\s*class[\s{]/.test(Function.prototype.toString.call(type));

const createElement = (type, props, ...children) => ({
  __el: true,
  type,
  props: props === null || props === undefined ? {} : props,
  children: children.flat(Infinity).filter((child) => child !== null && child !== undefined && child !== false),
});

const Fragment = Symbol('fragment');
let contextSeq = 0;
const createContext = (defaultValue) => ({ defaultValue, Provider: `provider-${(contextSeq += 1)}` });

/* A minimal class component: enough for the plugin's error boundary, which is
   the only class it uses. */
class Component {
  constructor(props) {
    this.props = props || {};
    this.state = {};
  }

  setState(next) {
    const patch = typeof next === 'function' ? next(this.state) : next;
    this.state = { ...this.state, ...patch };
    if (this.__instance !== undefined) this.__instance.schedule();
  }
}

/* The real React object; the client takes its hooks from here. */
const react = {
  createElement,
  Fragment,
  version: 'harness-mini-react',
  createContext,
};

let dispatcher = null;
const hooksOf = (hook) => {
  if (debug) process.stdout.write(`[mini] hook ${hook} dispatcher=${dispatcher === null ? 'null' : 'set'}\n`);
  if (dispatcher === null) throw new Error('harness: a React hook was called outside a component render');
  return dispatcher;
};
react.useState = (initial) => hooksOf('useState').useState(initial);
react.useEffect = (create, deps) => hooksOf('useEffect').useEffect(create, deps);
react.useRef = (initial) => hooksOf('useRef').useRef(initial);
react.useCallback = (callback, deps) => hooksOf('useCallback').useCallback(callback, deps);
react.useMemo = (factory, deps) => hooksOf('useMemo').useMemo(factory, deps);
react.useContext = (context) => hooksOf('useContext').useContext(context);
react.useLayoutEffect = react.useEffect;

const contexts = new Map();
const allInstances = [];
let slotSeq = 0;
const slotIds = new WeakMap();
const slotId = (slot) => {
  if (!slotIds.has(slot)) slotIds.set(slot, `s${(slotSeq += 1)}`);
  return slotIds.get(slot);
};

const createInstance = (component, props) => {
  const instance = {
    component,
    name: (component && component.name) || 'anonymous',
    props,
    slots: [],
    pending: [],
    cursor: 0,
    host: null,
    dirty: true,
  };
  allInstances.push(instance);

  const slotAt = (index, initial) => {
    if (index >= instance.slots.length) instance.slots[index] = initial();
    return instance.slots[index];
  };
  const depsChanged = (slot, deps) =>
    deps === undefined ||
    slot.deps === undefined ||
    deps.length !== slot.deps.length ||
    deps.some((dep, index) => !Object.is(dep, slot.deps[index]));

  instance.api = {
    useState(initial) {
      const index = instance.cursor++;
      const slot = slotAt(index, () => ({ value: typeof initial === 'function' ? initial() : initial }));
      return [
        slot.value,
        (next) => {
          const value = typeof next === 'function' ? next(slot.value) : next;
          if (Object.is(value, slot.value)) return;
          slot.value = value;
          instance.schedule();
        },
      ];
    },
    useRef(initial) {
      const index = instance.cursor++;
      const slot = slotAt(index, () => ({ current: initial }));
      if (debug) process.stdout.write(`[mini]   useRef ${instance.name} index=${index} slot=${slotId(slot)} value=${slot.current === null ? 'null' : 'node'}\n`);
      return slot;
    },
    useEffect(create, deps) {
      const index = instance.cursor++;
      const slot = slotAt(index, () => ({ deps: undefined, cleanup: undefined }));
      if (!depsChanged(slot, deps)) return;
      slot.deps = deps === undefined ? undefined : [...deps];
      instance.pending.push({
        get cleanup() {
          return slot.cleanup;
        },
        set cleanup(value) {
          slot.cleanup = value;
        },
        create,
      });
    },
    useCallback(callback, deps) {
      const index = instance.cursor++;
      const slot = slotAt(index, () => ({ deps: undefined, value: callback }));
      if (depsChanged(slot, deps)) {
        slot.deps = deps === undefined ? undefined : [...deps];
        slot.value = callback;
      }
      return slot.value;
    },
    useMemo(factory, deps) {
      const index = instance.cursor++;
      const slot = slotAt(index, () => ({ deps: undefined, value: undefined }));
      if (depsChanged(slot, deps)) {
        slot.deps = deps === undefined ? undefined : [...deps];
        slot.value = factory();
      }
      return slot.value;
    },
    useContext(context) {
      return contexts.has(context) ? contexts.get(context) : context.defaultValue;
    },
  };

  instance.render = () => {
    instance.cursor = 0;
    instance.pending = [];
    instance.renders = (instance.renders || 0) + 1;
    const previous = dispatcher;
    dispatcher = instance.api;
    try {
      if (debug) process.stdout.write(`[mini] render ${instance.name} #${instance.renders} slots=${instance.slots.length}\n`);
      return instance.component(instance.props);
    } finally {
      dispatcher = previous;
    }
  };

  instance.runEffects = () => {
    const effects = instance.pending;
    instance.pending = [];
    const previous = dispatcher;
    dispatcher = instance.api;
    try {
      for (const effect of effects) {
        if (typeof effect.cleanup === 'function') {
          try {
            effect.cleanup();
          } catch (error) {
            report(`effect cleanup threw: ${error && error.message}`);
          }
        }
        try {
          const next = effect.create();
          effect.cleanup = typeof next === 'function' ? next : undefined;
        } catch (error) {
          report(`effect threw: ${error && error.message}`);
        }
      }
    } finally {
      dispatcher = previous;
    }
  };

  instance.schedule = () => {
    instance.dirty = true;
    queue.add(instance);
    flush();
  };

  instance.renderNow = () => {
    if (!instance.dirty || instance.host === null) return;
    instance.dirty = false;
    const element = instance.render();
    /* Real React leaves DOM the component appended by hand alone, so the
       harness only removes the nodes the previous render owned. Wiping the host
       instead used to delete the engine's own canvas on the first re-render. */
    const owned = [];
    mount(instance, element, instance.host, (node) => owned.push(node));
    for (const node of instance.owned || []) {
      if (!owned.includes(node)) node.remove();
    }
    instance.owned = owned;
    instance.runEffects();
  };

  return instance;
};

const queue = new Set();
let flushing = false;
const flush = () => {
  if (flushing) return;
  flushing = true;
  try {
    let guard = 0;
    while (queue.size > 0 && guard < 200) {
      guard += 1;
      const batch = [...queue];
      queue.clear();
      for (const instance of batch) instance.renderNow();
    }
  } finally {
    flushing = false;
  }
};

const makeElement = (tag) => {
  const dom = global.document.createElement(tag);
  return {
    dom,
    setProp(name, value) {
      if (name === 'key' || name === 'children') return;
      if (name === 'style' && value !== null && typeof value === 'object') {
        for (const key of Object.keys(value)) {
          if (value[key] === undefined || value[key] === null) continue;
          dom.style[key] = value[key];
        }
        return;
      }
      if (name === 'ref' && typeof value === 'function') {
        if (debug) process.stdout.write(`[mini]   ref prop on ${dom.tagName}\n`);
        value(dom);
        return;
      }
      if (name.startsWith('on') && typeof value === 'function') {
        dom.addEventListener(name.slice(2).toLowerCase(), value);
        return;
      }
      if (value === true) {
        dom.setAttribute(name, '');
        return;
      }
      if (value === false || value === undefined || value === null) {
        dom.removeAttribute(name);
        return;
      }
      dom.setAttribute(name, String(value));
    },
  };
};

const mount = (owner, child, parent, onOwned) => {
  if (debug) {
    const kind = child === null || child === undefined ? 'empty' : Array.isArray(child) ? 'array' : typeof child === 'string' || typeof child === 'number' ? 'text' : String(child.type && (child.type.name || child.type));
    process.stdout.write(`[mini]   mount ${kind}\n`);
  }
  if (child === null || child === undefined || child === false || child === true) return;
  if (typeof child === 'string' || typeof child === 'number') {
    parent.dom.appendChild(global.document.createTextNode(String(child)));
    return;
  }
  if (Array.isArray(child)) {
    for (const entry of child) mount(owner, entry, parent, onOwned);
    return;
  }
  if (child.type === Fragment) {
    for (const entry of child.children) mount(owner, entry, parent, onOwned);
    return;
  }
  if (child.type !== null && typeof child.type === 'object' && typeof child.type.Provider === 'string') {
    const previous = contexts.get(child.type);
    contexts.set(child.type, child.props.value);
    for (const entry of child.children) mount(owner, entry, parent, onOwned);
    if (previous === undefined) contexts.delete(child.type);
    else contexts.set(child.type, previous);
    return;
  }
  if (typeof child.type === 'function' && isClass(child.type)) {
    const component = new child.type(child.props);
    component.__instance = null;
    const renderClass = () => {
      try {
        return component.render();
      } catch (error) {
        report(`class component threw: ${error && error.message}`);
        throw error;
      }
    };
    const instance = createInstance(renderClass, child.props);
    component.__instance = instance;
    instance.host = parent;
    const element = instance.render();
    mount(instance, element, parent);
    instance.runEffects();
    return;
  }
  if (typeof child.type === 'function') {
    const instance = createInstance(child.type, child.props);
    instance.host = parent;
    const element = instance.render();
    const owned = [];
    mount(instance, element, parent, (node) => owned.push(node));
    for (const node of instance.owned || []) {
      if (!owned.includes(node)) node.remove();
    }
    instance.owned = owned;
    instance.runEffects();
    return;
  }
  const element = makeElement(typeof child.type === 'string' ? child.type : 'div');
  /* React detaches an old callback ref before attaching the new one. Skipping
     that made every re-render null out the plugin's host ref, which is exactly
     the bug this harness exists to catch. */
  if (element.dom.__petRef !== undefined && element.dom.__petRef !== child.props.ref) {
    try {
      element.dom.__petRef(null);
    } catch (error) {
      report(`ref detach threw: ${error && error.message}`);
    }
  }
  element.dom.__petRef = child.props.ref;
  for (const name of Object.keys(child.props)) element.setProp(name, child.props[name]);
  parent.dom.appendChild(element.dom);
  if (onOwned !== undefined) onOwned(element.dom);
  const childHost = { dom: element.dom, replaceChildren: () => element.dom.replaceChildren() };
  for (const entry of child.children) mount(owner, entry, childHost, onOwned);
};

const findTag = (node, tag, out = []) => {
  for (const child of node.children) {
    if (child.tagName === tag) out.push(child);
    findTag(child, tag, out);
  }
  return out;
};

const createRoot = (host) => {
  const rootHost = { dom: host, replaceChildren: () => host.replaceChildren() };
  return {
    render(element) {
      host.replaceChildren();
      const instance = createInstance(() => element, {});
      instance.host = rootHost;
      instance.renderNow();
      return instance;
    },
    unmount() {
      host.replaceChildren();
    },
  };
};

harness.react = react;
react.Component = Component;
harness.createRoot = createRoot;
harness.mini = { createInstance, mount, contexts, flush, findTag, instances: allInstances };

module.exports = harness;
