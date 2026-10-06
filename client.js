/**
 * Client half of the DSH balance pet.
 *
 * A frame-wide companion: she stands in the bottom-left corner holding a tablet
 * whose screen shows the live DeepSeek balance. Every 0.01 CNY the balance drops
 * she flashes red, shakes, plays a hit sound and pops a red "-0.01" that rises
 * and fades; enough of them in a row cascade into a column.
 *
 * When the balance goes up, a rice bowl falls from the right edge instead of the
 * number moving. Carrying it onto her (anywhere on the body counts) feeds her:
 * the bowl vanishes, hearts rise and the top-up is credited in one go. A bowl
 * left alone for 10 seconds locks the fire-control nameplate onto every bowl on
 * the floor and then drags them all in.
 *
 * Eating a rice bowl drops an iron pot, which is a toy: it can be dragged onto
 * her head, where she wears it (flat face, tilted) until you double-click her
 * head to knock it off.
 *
 * Rendering is imperative on purpose: one requestAnimationFrame loop moves the
 * bowls, floaters and the nameplate through the DOM directly, so React only
 * re-renders for menu and settings changes, never once per frame.
 */
window.__ModuleLoader__.load({
  id: '@local/dsh-balance-pet',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    const ROUTE_PREFIX = '/api/dsh-balance-pet';
    const ASSET_URL = (name) => `${ROUTE_PREFIX}/assets/${name}`;
    const BALANCE_URL = `${ROUTE_PREFIX}/balance`;
    const KEY_URL = `${ROUTE_PREFIX}/key`;
    const REPORT_URL = `${ROUTE_PREFIX}/report`;

    /* The engine asks the React half to repaint through this slot, which the
       overlay fills in before it builds the engine. Keeping it a module-level
       hook (rather than a closure passed into the engine) means a notify that
       arrives while the engine is still being constructed is not lost. */
    /* The engine asks the React half to repaint through this slot, which the
       overlay fills in before it builds the engine. Keeping it a module-level
       hook (rather than a closure passed into the engine) means a notify that
       arrives while the engine is still being constructed is not lost. */
    let petRepaint = null;

    /* The engine of the *current* mount. `window.__DSH_BALANCE_PET__` can be
       left pointing at a detached engine when a reload disposes the old mount
       after the new one has started, so anything that wants the live pet reads
       this instead. */
    let livePet = null;

    /* The page reports what it is doing to the Host, because the Desktop Host
       refuses loopback HTTP to anything but its own renderer: `/pet-check` then
       reads that report instead of guessing. Every failure below is also drawn
       on the tablet, so the page never fails silently. */
    const watch = {
      started: Date.now(),
      loaded: false,
      engine: 'no',
      errors: [],
      images: [],
      readout: '',
      status: '',
    };

    function reportNow() {
      try {
        if (watch.engine === 'yes') {
          const images = Array.from(document.querySelectorAll('img'));
          watch.images = images.map((img) => ({
            src: String(img.src).split('/').pop(),
            ok: img.complete && img.naturalWidth > 0,
            nw: img.naturalWidth,
            opacity: img.style.opacity,
          }));
          const readout = document.querySelector('[data-pet-readout]');
          watch.readout = readout === null ? 'missing' : readout.textContent;
        }
        void fetch(REPORT_URL, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            module: watch.loaded ? 'loaded' : 'no',
            engine: watch.engine,
            images: watch.images,
            readout: watch.readout,
            status: watch.status,
            errors: watch.errors.slice(-6),
            elapsedMs: Date.now() - watch.started,
          }),
        }).catch(() => {});
      } catch {
        /* the report must never itself break the page */
      }
    }
    watch.report = reportNow;

    /* ---- artwork geometry, in the sprite's own 1024x1024 pixels ----------- */
    const SPRITE = 1024;
    /* Tablet panel corners (TL, TR, BR, BL), measured off sprite.png and
       re-checked on all four delivered expression sheets. */
    const QUAD = [
      [600.0, 699.0],
      [940.0, 645.0],
      [940.0, 867.0],
      [600.0, 921.0],
    ];
    /* The hurt flash paints the whole silhouette in this flat red, exactly the
       colour the desktop widget builds its overlay layer from. */
    const FLASH_RGB = '255, 48, 34';
    /* Desktop tint rule: 60% of a 113px sprite reads as a flash, 60% of a 454px
       one would just be a red silhouette, so it is toned down as she grows. */
    const flashMaxTint = (scale) => Math.max(0.34, 0.64 - scale * 0.75);

    /* ---- tuning: the same numbers as the desktop widget ------------------- */
    const STEP = 0.01;
    const CUE_GAP = 0.2;
    const MAX_CUES = 40;
    /* How long a landed rice bowl waits before it locks and is drawn in. The
       desktop original uses 10s; the user asked for 5. This is the same number the
       fire-control nameplate counts down as "LOCK", and the threshold that turns
       her aloof. */
    const BOWL_WAIT = 5.0;
    const LOCK_DELAY = 1.0;
    const SUCK_ACCEL = 960.0;
    const SUCK_MAX = 2400.0;
    const NERVOUS_HOLD = 1.0;
    const HIT_DUR = 0.55;
    const FLOATER_DUR = 1.05;
    const HEAD_SQUASH_DUR = 0.5;
    const IRON_TILT = -6.23;
    /* --- the pot: values taken from the desktop original, not estimated ---
       Its IronHeadAnchor() carries numbers the author measured by hand in a
       placement tool over the real sprite, with a comment saying not to tidy
       them, so they are reproduced as they are (all fractions of the sprite
       width w):
         cx      = w * 0.5558   the pot's centre
         rimY    = w * 0.3639   the row its rim rests on
         worn    = w * 0.7391   its width while worn (loose it is w * 0.44)
         roll    = -6.23 deg    in the placement tool's convention, so the drawn
                                rotation is the opposite sign (+6.23 here)
         aspect  = h / w of 0.2629 when the art is the flat pot
       The anchor is the pot's CENTRE, because a rotated pot has to turn about a
       point that does not move: anchoring by its top-left made the rim drift with
       the angle, which is exactly what "the rim is in the wrong place" was. */
    const POT_CX = 0.5558;
    /* The rim's row, as a fraction of the sprite WIDTH. 0.281 = sprite row 288.
       This value is not free: the pot's dome top lands at rim - height, and for her
       ahoge to show it has to land above the tuft (rows 0..80). The rim also has to
       sit where her hair is at least as wide as the pot, or the pot floats. Measured
       hair widths: 261 px at row 80, 569 at 260, 637 at 300. With a 200 px pot the
       dome top lands at row ~19 and the rim's hair is 219 px wide, so it is both
       supported and clear of the tuft. Larger pots cannot do both — at 224 px no rim
       row satisfies them. */
    const POT_RIM_Y = 0.281;
    /* The pot's width as a fraction of the sprite — 0.59 is 200 px at the default
       size, the version the user kept. Bounded from above by two things (see
       POT_RIM_Y): a wider pot's dome reaches down past her ahoge and hides it, and
       the rim needs hair at least as wide as the pot or it floats. (0.62 was tried
       as "a little wider" and then reverted.) */
    const POT_WORN_W = 0.59;
    /* The pot's VISIBLE height, as a fraction of the sprite width — 0.315, which is
       107 screen px at the default size. This is the user's chosen dome height, and
       it is expressed independently of the width on purpose: when the height was a
       multiple of the width, widening the pot silently made it taller as well. */
    const POT_HEIGHT = 0.281;
    /* The pot's rendered height as a fraction of the sprite width (the original's
       flat pot art has h / w = 0.2629 of the sprite). */
    const POT_ASPECT = 0.26;
    /* The delivered pot file is a padded 2048x2048 square: the bowl itself only
       occupies x 25..2022, y 655..1364 (measured in the page, and cropped there
       with a canvas so the element equals the visible pot). Sizing from the file
       is what flattened it. */
    const POT_CROP = { x: 25, y: 655, w: 1998, h: 710 };
    const POT_LOOSE_W = 0.44;
    const POT_ROLL_DEG = 6.23;
    /* Depth of the visible rim inside the pot's own rendered box, measured on the
       live box: the artwork carries slack below the dome. */
    const POT_RIM = 0.42;
    /* How far off the seat line the rim may be and still count as seated. The seat
       test measures from her unsquashed top while the pot's resting place follows
       the squash, a few pixels apart — without this tolerance the pot landed just
       outside its own test and fell off again every frame (it looked dragged). */
    const ON_HEAD_TOLERANCE = 6;
    /* How much flatter she is drawn than the delivered art, and only while the
       pot is actually on her head: it is the pot's weight that squashes her, so
       with the pot off she stands at her full height again.
       Applied with the transform origin at her feet, so she stays planted. */
    const PET_SQUASH = 0.9;
    const DOUBLE_CLICK_MS = 400;
    const SNAP_MS = 160;
    const POLL_SECONDS = 2.0;
    /* One engine tick. 33ms keeps the fall and the charge cues smooth when the
       page is visible, and a hidden tab still ticks about once a second. */
    const FRAME_MS = 33;
    /* Her head, as fractions of the pet square: x0, x1, y0, y1. */
    const HEAD_RECT = [0.30, 0.62, 0.02, 0.40];

    const STORE_KEY = 'dsh-balance-pet/v1';
    const KEY_STORE = 'dsh-balance-pet/api-key';
    /* The default size is 340 px, the first of the original's three presets
       (PresetPx = { 340, 454, 624 }, "mid / big / XL") — the choice the user asked
       for. The desktop original instead derives its default from 8.0 cm, which on
       this machine (144 dpi) works out at 454 px.
       A stored size is honoured within these bounds; anything else falls back. */
    const SIZES = [340, 454, 624];
    const DEFAULT_SIZE = 340;
    const DEFAULTS = { size: DEFAULT_SIZE, sound: true, volume: 80, theme: 'light', corner: 'content-gutter', menuLang: 'auto' };

    function loadPrefs() {
      try {
        const raw = window.localStorage.getItem(STORE_KEY);
        if (raw === null) return { ...DEFAULTS };
        const parsed = JSON.parse(raw);
        return {
          /* 340 (中杯) is the default; the menu also offers a custom entry, so any
             sane stored size is honoured and anything else falls back. */
          size: Number.isFinite(parsed.size) && parsed.size >= 120 && parsed.size <= 1400 ? Math.round(parsed.size) : DEFAULT_SIZE,
          sound: parsed.sound === undefined ? DEFAULTS.sound : Boolean(parsed.sound),
          volume: Number.isFinite(parsed.volume) ? Math.max(0, Math.min(100, Math.round(parsed.volume))) : DEFAULTS.volume,
          theme: parsed.theme === 'dark' ? 'dark' : 'light',
          corner: ['content-gutter', 'content-left', 'bottom-left', 'bottom-right', 'top-left', 'top-right'].includes(parsed.corner)
            ? parsed.corner
            : DEFAULTS.corner,
          menuLang: typeof parsed.menuLang === 'string' ? parsed.menuLang : DEFAULTS.menuLang,
        };
      } catch {
        return { ...DEFAULTS };
      }
    }

    function savePrefs(state) {
      try {
        window.localStorage.setItem(
          STORE_KEY,
          JSON.stringify({
            size: state.size,
            sound: state.sound,
            volume: state.volume,
            theme: state.theme,
            corner: state.corner,
            menuLang: state.lang,
          }),
        );
      } catch {
        /* private mode: the pet simply forgets between sessions */
      }
    }

    /* ------------------------------------------------------------ locale --- */

    const TEXT = {
  zh: {
    label: 'DSH \u4F59\u989D',
    refresh: '\u7ACB\u5373\u5237\u65B0\u4F59\u989D',
    groupTest: '\u6D4B\u8BD5',
    testCharge: '\u6D4B\u8BD5\u4E00\u6B21\u6263\u8D39\u6548\u679C',
    testTopup: '\u6D4B\u8BD5\u5145\u503C\u52A8\u753B',
    topup3: '\u6A21\u62DF\u5145\u503C 3 \u5143\uFF08\u6389\u7C73\u996D\u76C6\uFF09',
    radarOn: '\u6253\u5F00\u706B\u63A7\u96F7\u8FBE',
    custom: '\u81EA\u5B9A\u4E49\u2026',
    demo: '\u6F14\u793A\u8FDE\u7EED\u6263\u8D39',
    demoPrompt: '\u8981\u6F14\u793A\u6263\u591A\u5C11\uFF08\u5143\uFF09',
    topupPrompt: '\u8981\u6A21\u62DF\u5145\u591A\u5C11\uFF08\u5143\uFF09',
    volumePrompt: '\u97F3\u91CF\uFF080-100\uFF09',
    groupDisplay: '\u663E\u793A',
    size: '\u5C3A\u5BF8',
    sizeMid: '\u4E2D\u676F',
    sizeBig: '\u5927\u676F',
    sizeXl: '\u8D85\u5927\u676F',
    sizePrompt: '\u8FB9\u957F\uFF08\u50CF\u7D20\uFF0C\u6B63\u65B9\u5F62\uFF09',
    corner: '\u4F4D\u7F6E',
    cornerContentGutter: '\u4FA7\u680F\u65C1\u8FB9\uFF08\u9ED8\u8BA4\uFF09',
    cornerContentLeft: '\u5185\u5BB9\u533A\u5185\u5DE6\u4E0B',
    cornerBottomLeft: '\u7A97\u53E3\u5DE6\u4E0B\u89D2',
    cornerBottomRight: '\u7A97\u53E3\u53F3\u4E0B\u89D2',
    cornerTopLeft: '\u7A97\u53E3\u5DE6\u4E0A\u89D2',
    cornerTopRight: '\u7A97\u53E3\u53F3\u4E0A\u89D2',
    cornerHint: '\u4E5F\u53EF\u4EE5\u76F4\u63A5\u62D6\u5979',
    theme: '\u5916\u89C2',
    themeLight: '\u6D45\u8272',
    themeDark: '\u6DF1\u8272\uFF08DSH \u98CE\u683C\uFF09',
    sound: '\u58F0\u97F3',
    soundOn: '\u5F00\u542F\u58F0\u97F3',
    volumeLevel: '\u97F3\u91CF',
    volumeMute: '\u9759\u97F3',
    groupSystem: '\u7CFB\u7EDF',
    setKey: '\u8BBE\u7F6E API Key',
    quit: '\u9000\u51FA',
    keyPrompt: '\u7C98\u8D34 DeepSeek API Key\uFF08\u7559\u7A7A\u5219\u4E0D\u4FEE\u6539\uFF09',
  },
  en: {
    label: 'DSH balance',
    refresh: 'Refresh balance now',
    groupTest: 'Test',
    testCharge: 'Test one charge',
    testTopup: 'Test top-up animation',
    topup3: 'Simulate a 3 CNY top-up (rice bowl)',
    radarOn: 'Open fire-control radar',
    custom: 'Custom...',
    demo: 'Demo consecutive charges',
    demoPrompt: 'Amount to demo (CNY)',
    topupPrompt: 'Amount to simulate (CNY)',
    volumePrompt: 'Volume (0-100)',
    groupDisplay: 'Display',
    size: 'Size',
    sizeMid: 'Medium',
    sizeBig: 'Large',
    sizeXl: 'Extra large',
    sizePrompt: 'Edge length (pixels, square)',
    corner: 'Position',
    cornerContentGutter: 'Beside the sidebar (default)',
    cornerContentLeft: 'Content column, bottom left',
    cornerBottomLeft: 'Window bottom left',
    cornerBottomRight: 'Window bottom right',
    cornerTopLeft: 'Window top left',
    cornerTopRight: 'Window top right',
    cornerHint: 'or just drag her',
    theme: 'Appearance',
    themeLight: 'Light',
    themeDark: 'Dark (DSH style)',
    sound: 'Sound',
    soundOn: 'Sound on',
    volumeLevel: 'Volume',
    volumeMute: 'Mute',
    groupSystem: 'System',
    setKey: 'Set API key',
    quit: 'Quit',
    keyPrompt: 'Paste the DeepSeek API key (empty keeps the current one)',
  },
    };

    function pickLang() {
      const nav = typeof navigator === 'undefined' ? '' : navigator.language || '';
      return nav.toLowerCase().startsWith('zh') ? 'zh' : 'en';
    }

    /* ------------------------------------------------------------- audio --- */

    function createSound(state) {
      let actx = null;
      let gain = null;
      const buffers = {};
      let loading = null;
      let unlocked = false;

      async function ensure() {
        if (actx === null) {
          const Ctor = window.AudioContext || window.webkitAudioContext;
          if (Ctor === undefined) return undefined;
          actx = new Ctor();
          gain = actx.createGain();
          gain.connect(actx.destination);
        }
        if (actx.state === 'suspended') {
          try {
            await actx.resume();
          } catch {
            /* still locked; the next gesture retries */
          }
        }
        return actx;
      }

      /* Browsers refuse to start an AudioContext outside a user gesture. */
      function unlock() {
        if (unlocked) return;
        const onGesture = () => {
          unlocked = true;
          window.removeEventListener('pointerdown', onGesture, true);
          window.removeEventListener('keydown', onGesture, true);
          void ensure().then(() => load());
        };
        window.addEventListener('pointerdown', onGesture, true);
        window.addEventListener('keydown', onGesture, true);
      }

      /* Assets are public, so they are fetched directly; the balance and the API
         key go through the Host, which is the only side that may touch the key. */
      async function fetchArrayBuffer(url) {
        const response = await fetch(url, { headers: { accept: '*/*' } });
        if (!response.ok) throw new Error(`http-${response.status}`);
        return response.arrayBuffer();
      }

      async function load() {
        if (loading !== null) return loading;
        loading = (async () => {
          const made = await ensure();
          if (made === undefined) return;
          const names = { hit: 'hit.mp3', feed: 'feed.mp3' };
          for (const key of Object.keys(names)) {
            try {
              const bytes = await fetchArrayBuffer(ASSET_URL(names[key]));
              buffers[key] = await made.decodeAudioData(bytes);
            } catch {
              /* one missing sound never blocks the other */
            }
          }
        })();
        return loading;
      }
      function play(name) {
        if (!state.sound || state.volume <= 0 || actx === null || actx.state !== 'running') return;
        const buffer = buffers[name] ?? buffers.hit;
        if (buffer === undefined) {
          void load();
          return;
        }
        try {
          const src = actx.createBufferSource();
          src.buffer = buffer;
          gain.gain.value = state.volume / 100;
          src.connect(gain);
          src.start();
        } catch {
          /* a failed one-shot is not worth logging on every charge */
        }
      }

      unlock();

      return {
        load,
        playHit: () => play('hit'),
        playFeed: () => play('feed'),
        dispose() {
          if (actx !== null) {
            try {
              actx.close();
            } catch {
              /* already closed */
            }
          }
        },
      };
    }

    /* -------------------------------------------------------------- menu --- */

    /* Two palettes, the same choice the desktop menu's Appearance row offers:
       dark follows the DSH interface, light is the brighter popup. */
      function menuStyles(dark) {
        const ink = dark ? '#f2f4f8' : '#1b1d22';
        return {
          ink,
          panel: dark ? 'rgba(34, 35, 42, 0.97)' : 'rgba(252, 252, 253, 0.98)',
          stroke: dark ? 'rgba(255,255,255,.16)' : 'rgba(0,0,0,.12)',
          shadow: dark ? '0 10px 30px rgba(0,0,0,.45)' : '0 10px 30px rgba(0,0,0,.18)',
          muted: dark ? 'rgba(255,255,255,.45)' : 'rgba(0,0,0,.42)',
          hover: dark ? 'rgba(255,255,255,.09)' : 'rgba(0,0,0,.06)',
          track: dark ? 'rgba(255,255,255,.18)' : 'rgba(0,0,0,.14)',
          accent: '#4d6bfe',
        };
    }

    /* ------------------------------------------------------------- engine -- */

    function createEngine(host, onChange) {
      const state = {
        size: DEFAULTS.size,
        sound: DEFAULTS.sound,
        volume: DEFAULTS.volume,
        theme: DEFAULTS.theme,
        corner: DEFAULTS.corner,
        lang: 'zh',
        menuOpen: false,
        menuAt: { x: 0, y: 0 },
        radarManual: false,
        hidden: false,
        displayed: null,
        realBalance: null,
        status: 'starting',
        statusDetail: '',
        failures: 0,
        lastOk: 0,
        diag: '',
      };

      const sim = {
        scale: 1,
        petSize: state.size,
        petX: 8,
        petY: 8,
        homeX: 8,
        homeY: 8,
        drag: null,
        snap: null,
        /* True once she has been dragged somewhere by hand: that position then
           survives layout syncs and reloads instead of snapping home. */
        placed: false,
        bowls: [],
        iron: null,
        floaters: [],
        pending: 0,
        queued: 0,
        cueT: 0,
        cascade: 0,
        nervousT: 0,
        bowlWaitBasis: 0,
        locked: false,
        hitT: HIT_DUR,
        squashT: HEAD_SQUASH_DUR,
        headClickT: -1e9,
        headClickX: 0,
        headClickY: 0,
        pollT: 0,
        running: true,
      };

      const sound = createSound(state);
      /* The menu is plain DOM (see buildMenu): these are its live nodes. */
      let menuRoot = null;
      let menuGuard = null;
      /* Bound in start(), removed in dispose(). */
      let onContextMenu = null;
      let onPetDown = null;
      let onVisible = null;
      const view = {
        width: () => window.innerWidth,
        height: () => window.innerHeight,
        render: () => render(),
      };

      const canvas = document.createElement('canvas');
      canvas.setAttribute('aria-hidden', 'true');
      const g = canvas.getContext('2d');

      const elPet = document.createElement('div');
      Object.assign(elPet.style, {
        position: 'absolute',
        left: '0',
        top: '0',
        width: `${state.size}px`,
        height: `${state.size}px`,
        pointerEvents: 'auto',
        cursor: 'grab',
        touchAction: 'none',
      });

      const EXPR_KEYS = ['happy', 'nervous', 'aloof', 'calm'];
      const layers = EXPR_KEYS.map((key, index) => {
        const img = document.createElement('img');
        img.src = ASSET_URL(`expression_${key}.png`);
        img.alt = '';
        img.draggable = false;
        Object.assign(img.style, {
          position: 'absolute',
          left: '0',
          top: '0',
          width: '100%',
          height: '100%',
          opacity: index === 0 ? '1' : '0',
          transition: 'opacity 90ms linear',
          userSelect: 'none',
          pointerEvents: 'none',
        });
        elPet.appendChild(img);
        return img;
      });

      /* The hurt flash: a flat-red copy of the artwork, exactly like the
         desktop widget's BuildRedLayer (R 255, G 48, B 34, alpha preserved).
         It sits over the expression layer, and its opacity is the tint. */
      const elFlash = document.createElement('img');
      elFlash.alt = '';
      elFlash.draggable = false;
      elFlash.src = ASSET_URL('flash.png');
      Object.assign(elFlash.style, {
        position: 'absolute',
        left: '0',
        top: '0',
        width: '100%',
        height: '100%',
        opacity: '0',
        userSelect: 'none',
        pointerEvents: 'none',
        willChange: 'opacity',
      });
      elPet.appendChild(elFlash);

      /* The tablet readout: "DSH 余额" above the amount, placed at the panel's
         centre in the pet's own pixel space and rotated to the panel's tilt.
         Every size here is an absolute pixel value the layout code sets from the
         measured panel: no em inheritance, no flex line box, no matrix3d. */
      const elScreen = document.createElement('div');
      elScreen.setAttribute('data-pet-readout', '');
      Object.assign(elScreen.style, {
        position: 'absolute',
        left: '0',
        top: '0',
        /* Width stays auto so the box hugs the text: a fixed width made the box
           wider than the digits, which pushed the visible text off the panel's
           centre even though the box itself was centred. */
        width: 'auto',
        display: 'block',
        textAlign: 'center',
        transformOrigin: '50% 50%',
        fontFamily: '"Microsoft YaHei UI", "PingFang SC", "Segoe UI", system-ui, sans-serif',
        fontWeight: '700',
        pointerEvents: 'none',
        zIndex: '3',
      });
      const elLabel = document.createElement('div');
      Object.assign(elLabel.style, {
        display: 'block',
        fontSize: '20px',
        lineHeight: '1.2',
        fontWeight: '700',
        color: 'rgba(158, 182, 224, 0.95)',
        textShadow: '0 1px 2px rgba(0, 0, 0, 0.6)',
        whiteSpace: 'nowrap',
      });
      const elDigits = document.createElement('div');
      Object.assign(elDigits.style, {
        display: 'block',
        fontSize: '30px',
        lineHeight: '1.15',
        fontWeight: '700',
        color: '#f0f6ff',
        textShadow: '0 1px 3px rgba(0, 0, 0, 0.65)',
        whiteSpace: 'nowrap',
      });
      /* A third, smaller line that only appears when something is wrong: the
         tablet says why it has no number instead of staying blank. */
      const elDiag = document.createElement('div');
      Object.assign(elDiag.style, {
        display: 'none',
        fontSize: '10px',
        lineHeight: '1.25',
        fontWeight: '600',
        color: 'rgba(255, 176, 176, 0.95)',
        textShadow: '0 1px 2px rgba(0, 0, 0, 0.6)',
        whiteSpace: 'normal',
      });
      elScreen.appendChild(elLabel);
      elScreen.appendChild(elDigits);
      elScreen.appendChild(elDiag);

      elPet.appendChild(elScreen);

      const elProps = document.createElement('div');
      /* Every prop paints in FRONT of her: a bowl falling past her front, and a
         pot on her head clearly over her hair. The props layer therefore sits
         above her sprite, and the floaters above both. */
      Object.assign(elProps.style, { position: 'absolute', inset: '0', pointerEvents: 'none', zIndex: '4' });
      const elFloaters = document.createElement('div');
      Object.assign(elFloaters.style, { position: 'absolute', inset: '0', pointerEvents: 'none', zIndex: '8' });
      host.appendChild(canvas);
      host.appendChild(elPet);
      host.appendChild(elProps);
      host.appendChild(elFloaters);
      /* Her layer: props (4) and floaters (8) are both in front of her. */
      elPet.style.zIndex = '3';

      /* ---- prop pool ---- */
      const liveProps = [];
      const propPool = { rice: [], iron: [] };

      function createProp(kind) {
        const root = document.createElement('div');
        root.dataset.kind = kind;
        Object.assign(root.style, {
          position: 'absolute',
          left: '0',
          top: '0',
          pointerEvents: 'auto',
          cursor: 'grab',
          touchAction: 'none',
          willChange: 'transform',
        });
        const img = document.createElement('img');
        img.src = kind === 'iron' && potCroppedSrc !== null ? potCroppedSrc : ASSET_URL(kind === 'rice' ? 'rice.png' : 'iron_bowl.webp');
        img.alt = '';
        img.draggable = false;
        if (kind === 'iron') cropPotArt();
        Object.assign(img.style, {
          position: 'absolute',
          left: '0',
          top: '0',
          width: '100%',
          height: '100%',
          userSelect: 'none',
          pointerEvents: 'none',
        });
        root.appendChild(img);
        root.addEventListener('pointerdown', (event) => onPropPointerDown(event, root));
        return root;
      }

      function acquireProp(kind) {
        const pooled = propPool[kind];
        const node = pooled.length > 0 ? pooled.pop() : createProp(kind);
        elProps.appendChild(node);
        liveProps.push(node);
        return node;
      }

      function releaseProp(node) {
        const index = liveProps.indexOf(node);
        if (index >= 0) liveProps.splice(index, 1);
        if (node.parentNode !== null) node.parentNode.removeChild(node);
        node.style.cursor = 'grab';
        propPool[node.dataset.kind].push(node);
      }

      /* ---- floater pool ---- */
      const liveFloaters = [];
      const floaterPool = [];

      function acquireFloater() {
        if (floaterPool.length > 0) {
          const node = floaterPool.pop();
          elFloaters.appendChild(node);
          liveFloaters.push(node);
          return node;
        }
        const node = document.createElement('div');
        Object.assign(node.style, {
          position: 'absolute',
          left: '0',
          top: '0',
          pointerEvents: 'none',
          willChange: 'transform, opacity',
          fontWeight: '700',
          whiteSpace: 'nowrap',
          textShadow: '0 1px 2px rgba(0,0,0,0.45)',
        });
        node.appendChild(document.createElement('span'));
        elFloaters.appendChild(node);
        liveFloaters.push(node);
        return node;
      }

      function releaseFloater(node) {
        const index = liveFloaters.indexOf(node);
        if (index >= 0) liveFloaters.splice(index, 1);
        if (node.parentNode !== null) node.parentNode.removeChild(node);
        floaterPool.push(node);
      }

      /* ---- helpers ---- */
      const round2 = (value) => Math.round(value * 100) / 100;
      const money = (value) => `\u00A5${value.toFixed(2)}`;
      /* The pot's weight is what flattens her: at full height with the pot off. */
      const petSquash = () => (sim.iron !== null && sim.iron.onHead ? PET_SQUASH : 1);

      function headRect() {
        return {
          x0: sim.petX + sim.petSize * HEAD_RECT[0],
          x1: sim.petX + sim.petSize * HEAD_RECT[1],
          y0: sim.petY + sim.petSize * HEAD_RECT[2],
          y1: sim.petY + sim.petSize * HEAD_RECT[3],
        };
      }

      function headCenter() {
        return {
          x: sim.petX + sim.petSize * ((HEAD_RECT[0] + HEAD_RECT[1]) / 2),
          y: sim.petY + sim.petSize * ((HEAD_RECT[2] + HEAD_RECT[3]) / 2),
        };
      }

      /* ---- layout ---- */
      /**
       * The square she is actually drawn at. The size setting is a wish: a 454px
       * pet in a 470px-tall window would sit almost entirely below the fold,
       * which looks exactly like "the plugin does nothing". So the drawn size is
       * the largest preset that fits the window, and only if even the smallest
       * preset is too tall does she shrink below it.
       */
      function fittedSize() {
        const wanted = state.size;
        const available = Math.max(80, view.height() - 24);
        if (wanted <= available) return wanted;
        const presets = [340, 454, 624].filter((size) => size < wanted);
        for (let i = presets.length - 1; i >= 0; i -= 1) {
          if (presets[i] <= available) return presets[i];
        }
        return Math.max(80, Math.min(234, available));
      }

      /* Which corner she is parked in. The desktop widget always sits in the
         bottom-left, and it is a screen-sized topmost window: if both run, one
         covers the other, so the web pet can be moved out of its way.
         'content-left' is not a viewport corner at all: it anchors her to the
         bottom-left of the chat content column, which is where she sits by
         default — beside the window furniture rather than under it. */
      function contentColumn() {
        const column =
          document.querySelector('[class*="centerCol"]') ||
          document.querySelector('[class*="viewArea"]');
        return column === null ? null : column.getBoundingClientRect();
      }

      function homeFor(corner, size) {
        const inset = 8;
        const right = Math.max(inset, view.width() - size - inset);
        const bottom = Math.max(inset, view.height() - size - inset);
        if (corner === 'top-left') return { x: inset, y: inset };
        if (corner === 'top-right') return { x: right, y: inset };
        if (corner === 'bottom-right') return { x: right, y: bottom };
        if (corner === 'content-gutter') {
          const column = contentColumn();
          if (column !== null) {
            /* Her left edge lands at x≈126 with the default size, measured against
               the user's screenshots (their window and the CSS viewport are 1:1).
               The anchor is her right edge rather than her left because pinning
               the left edge moved her a whole body-width in one step. */
            const gutter = 186;
            return {
              x: Math.round(Math.max(inset, column.left - size + gutter)),
              y: Math.round(Math.min(Math.max(inset, column.bottom - size - inset), bottom)),
            };
          }
        }
        if (corner === 'content-left') {
          const column = contentColumn();
          if (column !== null) {
            const margin = 8;
            return {
              x: Math.round(Math.min(Math.max(inset, column.left + margin), right)),
              y: Math.round(Math.min(Math.max(inset, column.bottom - size - inset), bottom)),
            };
          }
        }
        return { x: inset, y: bottom };
      }

      function syncLayout() {
        /* Home is recomputed every layout: the content column moves when the
           sidebar is resized or a panel opens, and she should follow it. A manual
           drag clears `placed` only through the menu, so a hand-placed position
           still wins until a corner is chosen again. */
        sim.petSize = fittedSize();
        sim.scale = sim.petSize / SPRITE;
        elPet.style.width = `${sim.petSize}px`;
        elPet.style.height = `${sim.petSize}px`;

        /* The tablet readout is placed by hand at the panel's centre, in the
           pet's own pixel space, and rotated to match the panel's tilt.
           Deliberately NOT a matrix3d/flex/em construction: an earlier version
           set an em base on a 1x1 element, which inflated the text to 75,000px
           and threw it off screen where the frame's overflow clipped it. */
        const panel = panelGeometry();
        if (panel !== null) {
          elScreen.style.left = `${panel.cx.toFixed(2)}px`;
          elScreen.style.top = `${panel.cy.toFixed(2)}px`;
          elScreen.style.width = `${panel.width.toFixed(2)}px`;
          elScreen.style.transform = `translate(-50%, -50%) rotate(${panel.angleDeg.toFixed(2)}deg)`;
          elLabel.style.fontSize = `${panel.labelPx.toFixed(2)}px`;
          elDigits.style.fontSize = `${panel.valuePx.toFixed(2)}px`;
          elDiag.style.fontSize = `${panel.diagPx.toFixed(2)}px`;
          elLabel.textContent = TEXT[state.lang].label;
        }

        sim.home = homeFor(state.corner, sim.petSize);
        sim.homeX = sim.home.x;
        sim.homeY = sim.home.y;
        if (sim.drag === null && sim.placed !== true) {
          sim.petX = sim.homeX;
          sim.petY = sim.homeY;
        } else {
          /* Keep her inside the window after a resize. */
          sim.petX = Math.min(Math.max(0, sim.petX), Math.max(0, view.width() - sim.petSize));
          sim.petY = Math.min(Math.max(0, sim.petY), Math.max(0, view.height() - sim.petSize));
        }
        for (const bowl of sim.bowls) resizeProp(bowl);
        resizeCanvas();
      }

      /** Centre, tilt, and text sizes of the tablet panel, in pet pixels. */
      function panelGeometry() {
        const points = QUAD.map(([x, y]) => [x * sim.scale, y * sim.scale]);
        const [tl, tr, br, bl] = points;
        const cx = (tl[0] + tr[0] + br[0] + bl[0]) / 4;
        const cy = (tl[1] + tr[1] + br[1] + bl[1]) / 4;
        const width = (Math.hypot(tr[0] - tl[0], tr[1] - tl[1]) + Math.hypot(br[0] - bl[0], br[1] - bl[1])) / 2;
        const height = (Math.hypot(bl[0] - tl[0], bl[1] - tl[1]) + Math.hypot(br[0] - tr[0], br[1] - tr[1])) / 2;
        const angleDeg = (Math.atan2(tr[1] - tl[1], tr[0] - tl[0]) * 180) / Math.PI;
        return {
          cx,
          cy,
          width,
          height,
          angleDeg,
          labelPx: height * 0.15,
          valuePx: height * 0.23,
          diagPx: height * 0.075,
        };
      }

      function resizeProp(bowl) {
        /* Each kind keeps its own proportion. Listing the pot here as "not rice,
           so 0.46" silently overrode the size ironMetrics() sets on every layout,
           which is why enlarging the pot had no visible effect. */
        const width = bowl.kind === 'rice' ? sim.petSize * 0.44 : ironMetrics(bowl.onHead === true).width;
        bowl.w = width;
        bowl.h = width * bowl.aspect;
        bowl.node.style.width = `${bowl.w}px`;
        bowl.node.style.height = `${bowl.h}px`;
      }

      function resizeCanvas() {
        const ratio = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
        canvas.width = Math.max(1, Math.round(view.width() * ratio));
        canvas.height = Math.max(1, Math.round(view.height() * ratio));
        Object.assign(canvas.style, { width: '100%', height: '100%', pointerEvents: 'none' });
        g.setTransform(ratio, 0, 0, ratio, 0, 0);
      }

      /* ---- diagnostics ---- */
      /** Put a short reason on the tablet so an empty screen is never the answer. */
      function fail(reason) {
        state.diag = String(reason);
        state.status = 'offline';
        notify();
      }

      /* ---- balance ---- */
      function applyBalance(next) {
        state.status = 'live';
        state.statusDetail = '';
        state.lastOk = Date.now();
        if (state.displayed === null) {
          state.displayed = next;
          state.realBalance = next;
          return;
        }
        const delta = round2(next - state.realBalance);
        state.realBalance = next;
        if (delta > 1e-9) {
          /* A top-up: the cloud knows, the screen does not until it is fed. */
          sim.pending = round2(sim.pending + delta);
        } else if (delta < -1e-9) {
          const owed = round2(Math.abs(delta) - sim.pending);
          if (owed > 1e-9) {
            const cues = Math.min(MAX_CUES, Math.round(owed / STEP));
            sim.queued += cues;
            sim.pending = round2(Math.max(0, sim.pending - cues * STEP));
            sim.cueT = Math.min(sim.cueT, 0);
          }
        }
      }

      /* One place for every balance request: the readout cannot update while a
         request is in flight, which is what made a dropped poll look like a
         frozen tablet.
         `snap` is for the menu's "立即刷新余额": a plain poll only moves the real
         balance and queues the difference as charge cues, so the tablet number
         stays where it was and the row looked like it did nothing. A snap makes
         the tablet jump straight to the value the server just returned. */
      let polling = false;
      /* Counted so a probe can tell "the row never called poll" apart from "poll
         ran but the snap did not take". */
      const pollCount = { total: 0, snaps: 0, skipped: 0 };
      function poll(snap) {
        if (polling) {
          pollCount.skipped += 1;
          return;
        }
        pollCount.total += 1;
        if (snap === true) pollCount.snaps += 1;
        polling = true;
        fetch(BALANCE_URL, { headers: { accept: 'application/json' } })
          .then((response) => (response.ok ? response.json() : Promise.reject(new Error(`http-${response.status}`))))
          .then((payload) => {
            if (payload !== null && payload.ok === true && Number.isFinite(payload.total)) {
              applyBalance(round2(payload.total));
              state.diag = '';
              state.failures = 0;
              if (snap === true) {
                /* The user asked to see the number now: show the truth and drop
                   the animation queue rather than replaying the difference. */
                state.displayed = round2(payload.total);
                sim.queued = 0;
                sim.cueT = 0;
              }
            } else {
              state.status = 'offline';
              state.statusDetail = payload === null ? 'bad-response' : String(payload.error ?? 'error');
              state.failures += 1;
              state.diag = diagText(state.statusDetail);
            }
          })
          .catch((error) => {
            state.status = 'offline';
            state.statusDetail = error instanceof Error ? error.message : 'network';
            state.failures += 1;
            state.diag = diagText(state.statusDetail);
          })
          .then(() => {
            polling = false;
            render();
          });
      }

      /** One short line explaining a failed lookup, in the reader's language. */
      function diagText(detail) {
        const zh = state.lang === 'zh';
        if (detail === 'no-key') return zh ? '\u672A\u627E\u5230 API Key' : 'no API key';
        if (detail === 'network') return zh ? '\u53D6\u4F59\u989D\u5931\u8D25\uFF08\u7F51\u7EDC\uFF09' : 'balance failed (network)';
        if (detail === 'timeout') return zh ? '\u53D6\u4F59\u989D\u8D85\u65F6' : 'balance timed out';
        if (detail.startsWith('http-401') || detail.startsWith('http-403')) return zh ? 'API Key \u65E0\u6548' : 'API key rejected';
        return zh ? `\u53D6\u4F59\u989D\u5931\u8D25\uFF08${detail}\uFF09` : `balance failed (${detail})`;
      }

      /** Store a key override on the Host, then immediately re-read the balance. */
      async function setApiKey(key) {
        const response = await fetch(KEY_URL, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ key }),
        });
        if (!response.ok) throw new Error(`http-${response.status}`);
        state.status = 'starting';
        state.lastOk = 0;
        poll();
      }

      /* ---- cues ---- */
      function spawnFloater(kind, text, offsetX, offsetY, color, size, hidden) {
        const node = acquireFloater();
        sim.floaters.push({
          node,
          kind,
          text,
          offsetX,
          offsetY,
          color,
          size,
          hidden,
          t: 0,
          dur: FLOATER_DUR,
          jitter: (Math.random() - 0.5) * 20 * sim.scale,
          drift: (Math.random() - 0.5) * 34,
          phase: Math.random() * Math.PI * 2,
        });
      }

      function playCue(amount) {
        state.displayed = round2(Math.max(0, (state.displayed ?? 0) - amount));
        sim.hitT = 0;
        sim.nervousT = NERVOUS_HOLD;
        sound.playHit();
        const color = '#ff3022';
        const step = Math.max(20, 34 * sim.scale * 1.7);
        /* One label per cue: the steady 1.7-line cascade spacing keeps a run of
           charges readable instead of piling several numbers on one spot. */
        const index = sim.cascade;
        spawnFloater('number', `-${amount.toFixed(2)}`, 0.5, 0.06 + index * step, color, 30 * sim.scale, false);
        sim.cascade = (sim.cascade + 1) % 40;
      }

      function updateCues(dt) {
        sim.cueT -= dt;
        if (sim.queued > 0 && sim.cueT <= 0) {
          sim.queued -= 1;
          playCue(STEP);
          sim.cueT = CUE_GAP;
        }
      }

      /* ---- bowls ---- */
      function dropRiceBowl(amount) {
        const bowl = {
          kind: 'rice',
          node: acquireProp('rice'),
          x: view.width() * 0.5 + Math.random() * Math.max(40, view.width() * 0.22),
          y: -Math.max(60, sim.petSize * 0.44),
          vx: (Math.random() - 0.5) * 60,
          vy: 0,
          w: sim.petSize * 0.44,
          h: sim.petSize * 0.44,
          aspect: 1,
          dragging: false,
          grab: null,
          grabOffX: 0,
          grabOffY: 0,
          amount,
          wait: 0,
          lockT: 0,
          locked: false,
          sucking: false,
          angle: 0,
          spin: (Math.random() - 0.5) * 1.8,
          rest: false,
          onHead: false,
        };
        sim.bowls.push(bowl);
        bowl.node.style.width = `${bowl.w}px`;
        bowl.node.style.height = `${bowl.h}px`;
        measureProp(bowl, 'rice');
        return bowl;
      }

      function dropIronBowl(x, y) {
        if (sim.iron !== null) return;
        const metrics = ironMetrics(false);
        const bowl = {
          kind: 'iron',
          node: acquireProp('iron'),
          x,
          y,
          vx: (Math.random() - 0.5) * 60,
          vy: 30,
          w: metrics.width,
          h: metrics.height,
          aspect: metrics.height / metrics.width,
          dragging: false,
          grab: null,
          grabOffX: 0,
          grabOffY: 0,
          amount: 0,
          wait: 0,
          lockT: 0,
          locked: false,
          sucking: false,
          angle: ((IRON_TILT + 7) * Math.PI) / 180,
          spin: 0,
          rest: false,
          onHead: false,
          /* Seconds to stay airborne before it may settle on her head. */
          seatDelay: 0,
        };
        bowl.x = x - bowl.w / 2;
        sim.iron = bowl;
        sim.bowls.push(bowl);
        bowl.node.style.width = `${bowl.w}px`;
        bowl.node.style.height = `${bowl.h}px`;
        measureProp(bowl, 'iron');
      }

      /**
       * The pot artwork is a padded square: the bowl occupies only x 25..2022,
       * y 655..1364 of a 2048x2048 file. Cropping it here, in the page, is what
       * makes the element equal the visible pot — sizing from the file rendered it
       * at about 35% of the intended height, i.e. a flat plate on her head. The
       * crop is done once and the object URL cached; a CSS clip-path was tried
       * first and the render kept the uncropped box.
       */
      let potCroppedSrc = null;
      let potCropPending = false;

      function cropPotArt() {
        if (potCroppedSrc !== null || potCropPending) return;
        potCropPending = true;
        const source = new Image();
        source.onload = () => {
          try {
            const surface = document.createElement('canvas');
            surface.width = POT_CROP.w;
            surface.height = POT_CROP.h;
            const paint = surface.getContext('2d');
            paint.drawImage(source, POT_CROP.x, POT_CROP.y, POT_CROP.w, POT_CROP.h, 0, 0, POT_CROP.w, POT_CROP.h);
            surface.toBlob((blob) => {
              potCropPending = false;
              if (blob === null) return;
              potCroppedSrc = URL.createObjectURL(blob);
              /* Swap it in on every pot already built, and on future ones. */
              for (const bowl of sim.bowls) {
                if (bowl.kind !== 'iron') continue;
                const img = bowl.node.firstChild;
                img.style.clipPath = '';
                img.src = potCroppedSrc;
                bowl.aspect = POT_CROP.h / POT_CROP.w;
                resizeProp(bowl);
              }
            }, 'image/png');
          } catch {
            potCropPending = false;
          }
        };
        source.onerror = () => {
          potCropPending = false;
        };
        source.src = ASSET_URL('iron_bowl.webp');
      }

      function ironMetrics(worn) {
        /* The original keeps two sizes for the pot: 0.44 of the sprite width while
           it is loose (the same footprint as a rice bowl, so dragging feels the
           same) and 0.7391 once worn, which is the width measured in the placement
           tool. Height follows the visible pot's proportions, so these are the only
           numbers that size a pot — never the file's own dimensions, which include
           a large transparent margin. */
        const width = sim.petSize * (worn === true ? POT_WORN_W : POT_LOOSE_W);
        if (worn !== true) return { width, height: width * (POT_CROP.h / POT_CROP.w) * 1.7 };
        return { width, height: sim.petSize * POT_HEIGHT };
      }

      function measureProp(bowl, kind) {
        /* A rice bowl is sized from its own art. The pot is not: its file is a
           padded square, so reading the file's dimensions back is exactly how the
           pot ended up flattened — ironMetrics owns that size instead. */
        if (kind === 'iron') {
          resizeProp(bowl);
          return;
        }
        const img = bowl.node.firstChild;
        const apply = () => {
          if (img.naturalWidth > 0) {
            bowl.aspect = img.naturalHeight / img.naturalWidth;
            resizeProp(bowl);
          }
        };
        if (img.complete) apply();
        else img.addEventListener('load', apply, { once: true });
      }

      function overPet(bowl) {
        const cx = bowl.x + bowl.w / 2;
        const cy = bowl.y + bowl.h / 2;
        const pad = 0.06 * sim.petSize;
        return (
          cx > sim.petX - pad &&
          cx < sim.petX + sim.petSize + pad &&
          cy > sim.petY - pad &&
          cy < sim.petY + sim.petSize + pad
        );
      }

      function removeBowl(bowl) {
        const index = sim.bowls.indexOf(bowl);
        if (index >= 0) sim.bowls.splice(index, 1);
        releaseProp(bowl.node);
        if (sim.iron === bowl) sim.iron = null;
      }

      function feedRice(bowl) {
        const amount = bowl.amount;
        sim.pending = round2(Math.max(0, sim.pending - amount));
        state.displayed = round2((state.displayed ?? 0) + amount);
        sound.playFeed();
        const head = headCenter();
        for (let i = 0; i < 7; i += 1) {
          spawnFloater(
            'heart',
            '',
            head.x + (Math.random() - 0.5) * sim.petSize * 0.5,
            head.y,
            '#ff6f9c',
            14 * sim.scale + Math.random() * 16 * sim.scale,
            false,
          );
        }
        spawnFloater('number', `+${amount.toFixed(2)}`, 0.5, -0.12, '#5ce07a', 30 * sim.scale, false);
        removeBowl(bowl);
        /* Eating a rice bowl drops the iron pot onto her crown, where it settles
           by itself and becomes a lid. Dropping it where the bowl was left it off
           to one side and sliding away — measured at x=912 while her head is at
           144..289 — so it is dropped over the head instead. */
        dropIronBowl(sim.petX + sim.petSize * POT_CX, sim.petY);
      }

      function seatIronOnHead(bowl) {
        bowl.onHead = true;
        bowl.rest = true;
        bowl.vx = 0;
        bowl.vy = 0;
        bowl.sucking = false;
        bowl.locked = false;
        /* Worn, it is drawn at the measured width and at its measured roll. */
        bowl.angle = (POT_ROLL_DEG * Math.PI) / 180;
        const worn = ironMetrics(true);
        bowl.w = worn.width;
        bowl.h = worn.height;
        bowl.node.style.width = `${bowl.w}px`;
        bowl.node.style.height = `${bowl.h}px`;
        sim.squashT = 0;
      }

      function knockIronOff() {
        const bowl = sim.iron;
        if (bowl === null || !bowl.onHead) return false;
        /* Off the head it goes back to the loose footprint. */
        const loose = ironMetrics(false);
        bowl.w = loose.width;
        bowl.h = loose.height;
        bowl.node.style.width = `${bowl.w}px`;
        bowl.node.style.height = `${bowl.h}px`;
        bowl.onHead = false;
        bowl.rest = false;
        bowl.vy = -240;
        bowl.vx = (Math.random() - 0.5) * 120;
        bowl.spin = (Math.random() - 0.5) * 4;
        sim.squashT = 0;
        return true;
      }

      /* ---- simulation ---- */
      /**
       * Where a dragged bowl should be: from the latest pointer sample.
       *
       * The position is recomputed here, every tick, instead of only inside the
       * pointermove listener. A dropped or coalesced move event then cannot
       * leave the bowl behind the cursor, and the release check uses the same
       * source of truth the user sees.
       */
      function followPointer(bowl) {
        if (bowl.grab === null) return;
        bowl.x = bowl.grab.x - bowl.grabOffX;
        bowl.y = bowl.grab.y - bowl.grabOffY;
      }

      function updateSnap(dt) {
        if (sim.snap === null) return;
        sim.snap.t += (dt * 1000) / SNAP_MS;
        const k = Math.min(1, sim.snap.t);
        const eased = 1 - Math.pow(1 - k, 3);
        sim.petX = sim.snap.fromX + (sim.homeX - sim.snap.fromX) * eased;
        sim.petY = sim.snap.fromY + (sim.homeY - sim.snap.fromY) * eased;
        if (k >= 1) sim.snap = null;
      }

      function updateDeadline(dt) {
        let anyRice = false;
        let wait = 0;
        for (const bowl of sim.bowls) {
          if (bowl.kind !== 'rice' || bowl.dragging) continue;
          anyRice = true;
          if (bowl.rest && !bowl.locked) {
            bowl.wait += dt;
            if (bowl.wait >= BOWL_WAIT) {
              bowl.locked = true;
              bowl.lockT = 0;
            }
          }
          if (bowl.locked) {
            bowl.lockT += dt;
            if (bowl.lockT >= LOCK_DELAY) bowl.sucking = true;
          }
          if (bowl.wait > wait) wait = bowl.wait;
        }
        sim.bowlWaitBasis = anyRice ? wait : 0;
        sim.locked = sim.bowls.some((bowl) => bowl.kind === 'rice' && bowl.locked);
      }

      function updatePhysics(dt) {
        for (const bowl of sim.bowls.slice()) {
          if (bowl.onHead) {
            /* Slaved to the original's IronHeadAnchor(): the pot's CENTRE sits at
               (0.5558 w, 0.3639 w) measured from her sprite's top-left, its rim on
               that second row. The centre is the anchor because the pot is drawn
               rolled by POT_ROLL_DEG, and a rotation must turn about a point that
               stays put — anchoring by a corner made the rim drift with the angle.
               The anchor follows the squash she is drawn with, otherwise the pot
               would float whenever the pot is what makes her squat. */
            const squash = petSquash();
            const cx = sim.petX + sim.petSize * POT_CX;
            const rimY = sim.petY + sim.petSize * POT_RIM_Y * squash;
            bowl.angle = (POT_ROLL_DEG * Math.PI) / 180;
            /* Place the finished box so its rim lands on rimY: the rim sits
               POT_RIM of the box height above the box bottom. */
            bowl.x = cx - bowl.w / 2;
            bowl.y = rimY - bowl.h * (1 - POT_RIM);
            continue;
          }
          if (bowl.dragging) {
            followPointer(bowl);
            continue;
          }
          if (bowl.grab !== null) bowl.grab = null;
          const accel = bowl.kind === 'iron' ? 2400 : 3200;
          bowl.vy += accel * dt;
          if (bowl.sucking) {
            const head = headCenter();
            const dx = head.x - (bowl.x + bowl.w / 2);
            const dy = head.y - (bowl.y + bowl.h / 2);
            const dist = Math.max(1, Math.hypot(dx, dy));
            bowl.vx += (dx / dist) * SUCK_ACCEL * dt;
            bowl.vy += (dy / dist) * SUCK_ACCEL * dt;
            const speed = Math.hypot(bowl.vx, bowl.vy);
            const cap = SUCK_MAX * sim.scale;
            if (speed > cap) {
              bowl.vx = (bowl.vx / speed) * cap;
              bowl.vy = (bowl.vy / speed) * cap;
            }
          }
          bowl.x += bowl.vx * dt;
          bowl.y += bowl.vy * dt;
          bowl.angle += bowl.spin * dt;

          const floor = view.height() - bowl.h * 0.86;

          /* A pot that reaches her head settles onto it by itself — that is what
             the widget does when a bowl is eaten, and it is what makes the pot a
             lid. Without this it fell straight past her onto the floor unless it
             was dragged into place. */
          if (bowl.kind === 'iron' && !bowl.onHead && !bowl.sucking && bowl.vy > 0) {
            if (bowl.seatDelay > 0) {
              bowl.seatDelay = Math.max(0, bowl.seatDelay - dt);
            } else {
              const head = headRect();
              const foot = bowl.y + bowl.h * 0.86;
              const centre = bowl.x + bowl.w / 2;
              if (foot > head.y0 - bowl.h && foot < head.y1 + bowl.h * 0.5 && centre > head.x0 && centre < head.x1) {
                seatIronOnHead(bowl);
                continue;
              }
            }
          }
          if (bowl.y >= floor) {
            bowl.y = floor;
            if (bowl.sucking) {
              /* The magnet ignores the floor and keeps pulling. */
            } else if (Math.abs(bowl.vy) > 170) {
              bowl.vy = -bowl.vy * 0.42;
              bowl.vx *= 0.86;
              bowl.spin *= 0.6;
              bowl.rest = false;
            } else {
              bowl.vy = 0;
              bowl.vx *= 0.86;
              if (Math.abs(bowl.vx) < 6) {
                bowl.vx = 0;
                bowl.spin *= 0.8;
                if (Math.abs(bowl.spin) < 0.06) {
                  bowl.spin = 0;
                  bowl.angle *= 0.9;
                }
                bowl.rest = true;
              }
            }
          } else if (bowl.y < floor - 3) {
            bowl.rest = false;
          }

          const maxX = Math.max(0, view.width() - bowl.w);
          if (bowl.x < 0) {
            bowl.x = 0;
            bowl.vx = Math.abs(bowl.vx) * 0.4;
          } else if (bowl.x > maxX) {
            bowl.x = maxX;
            bowl.vx = -Math.abs(bowl.vx) * 0.4;
          }

          if (bowl.kind === 'iron' && !bowl.onHead && !bowl.sucking && bowl.seatDelay <= 0) {
            /* Seated when it reaches its anchor, the way the original's IronOnHead
               does: the pot's rim (the bottom of its visible box) inside the head
               box, not shooting upward. Testing the box against hard-coded
               fractions of the old pot height stopped matching once the artwork was
               cropped to the visible bowl. */
            const head = headRect();
            const rimX = bowl.x + bowl.w / 2;
            const rimY = bowl.y + bowl.h;
            const limit = sim.petY + sim.petSize * POT_RIM_Y;
            if (
              bowl.vy > -60 &&
              rimY >= limit - bowl.h - ON_HEAD_TOLERANCE &&
              rimY <= limit + bowl.h * 1.6 &&
              rimX > head.x0 &&
              rimX < head.x1
            ) {
              seatIronOnHead(bowl);
              continue;
            }
          }
          if (bowl.kind === 'rice' && bowl.sucking && overPet(bowl)) {
            feedRice(bowl);
          }
        }
      }

      function updateFloaters(dt) {
        for (let i = sim.floaters.length - 1; i >= 0; i -= 1) {
          const floater = sim.floaters[i];
          floater.t += dt;
          if (floater.t >= floater.dur) {
            sim.floaters.splice(i, 1);
            releaseFloater(floater.node);
          }
        }
      }

      function tick(dt) {
        sim.ticks = (sim.ticks || 0) + 1;
        sim.lastDt = dt;
        /* Fixed steps: a long catch-up after a hidden tab must not tunnel the
           bowl through the floor or teleport it past her. */
        let remaining = Math.min(2, Math.max(0, dt));
        while (remaining > 0) {
          const step = Math.min(0.05, remaining);
          remaining -= step;
          updateCues(step);
          updateDeadline(step);
          updatePhysics(step);
          updateFloaters(step);
          if (sim.hitT < HIT_DUR) sim.hitT += step;
          if (sim.squashT < HEAD_SQUASH_DUR) sim.squashT += step;
          if (sim.nervousT > 0) sim.nervousT = Math.max(0, sim.nervousT - step);
        }
        sim.pollT += dt;
        if (sim.pollT >= POLL_SECONDS) {
          sim.pollT = 0;
          poll();
        }
        render();
      }

      /* ---- rendering ---- */
      function expressionIndex() {
        const ironOnHead = sim.iron !== null && sim.iron.onHead;
        const anyRice = sim.bowls.some((bowl) => bowl.kind === 'rice');
        /* A charge run outranks the pot. The desktop original has it the other way
           round (its comment: "wearing the pot is the HIGHEST priority, above a
           charge run"), but the user asked for the wince to show while the balance
           is being deducted even with the pot on, and to return to the flat face
           once the spending stops — which is what nervousT already does, since it
           holds for NERVOUS_HOLD after the last cue. */
        if (sim.queued > 0 || sim.nervousT > 0) return 1; // nervous
        if (ironOnHead && !anyRice) return 3; // calm
        if (anyRice && sim.bowlWaitBasis >= BOWL_WAIT) return 2; // aloof
        return 0; // happy
      }

      function pulse() {
        if (sim.hitT >= HIT_DUR) return 0;
        if (sim.hitT < 0.2) return 1;
        const ease = Math.max(0, 1 - (sim.hitT - 0.2) / (HIT_DUR - 0.2));
        return Math.sin((sim.hitT - 0.2) * 26) * 0.55 * ease * ease;
      }

      let lastExpression = -1;
      let lastScreenKey = '';
      let lastClock = '';

      /* Every frame goes through here, so a throw inside render() would silently
         stop the expression layers and the tablet from ever updating again. That
         exact failure mode ("the charge expression stopped appearing") is otherwise
         invisible, so the first throw is reported once instead of every frame. */
      let renderError = '';
      function render() {
        try {
          renderFrame();
        } catch (error) {
          const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
          if (renderError !== message) {
            renderError = message;
            watch.errors.push(`render: ${message}`);
            watch.report();
          }
        }
      }

      function renderFrame() {
        const shake = pulse();
        const squash = sim.squashT < HEAD_SQUASH_DUR ? Math.sin((sim.squashT / HEAD_SQUASH_DUR) * Math.PI) : 0;
        const scaleY = 1 + squash * 0.06;
        /* She does not move when she is charged: the desktop widget nudges her
           sideways on every hit, but here that reads as the pet drifting out of
           place. The hit is carried by the red flash, and the little squash for
           a landing pot, both of which keep her centred where she stands. */
        elPet.style.transformOrigin = '50% 100%';
        elPet.style.transform =
          `translate3d(${sim.petX.toFixed(2)}px, ${sim.petY.toFixed(2)}px, 0)` +
          ` scaleY(${(petSquash() * scaleY).toFixed(4)})`;

        const expression = expressionIndex();
        if (expression !== lastExpression) {
          lastExpression = expression;
          for (let i = 0; i < layers.length; i += 1) layers[i].style.opacity = i === expression ? '1' : '0';
        }
        /* The flat-red overlay carries the hurt flash, exactly like the desktop
           widget blits its red layer over the sprite at the tint opacity. */
        const tint = Math.min(1, Math.max(0, shake) * flashMaxTint(sim.scale) / 0.55);
        elFlash.style.opacity = tint.toFixed(3);
        elFlash.style.display = tint > 0.004 ? '' : 'none';

        const text = state.displayed === null ? '--' : money(state.displayed);
        const screenKey = `${text}|${state.status}|${state.lang}|${state.diag}`;
        if (screenKey !== lastScreenKey) {
          lastScreenKey = screenKey;
          elDigits.textContent = text;
          if (state.displayed === null) {
            /* Never leave the tablet blank: say why it has nothing to show. */
            elLabel.textContent = state.status === 'offline' ? 'offline' : TEXT[state.lang].label;
            elLabel.style.color = state.status === 'offline' ? 'rgba(255, 150, 150, 0.95)' : 'rgba(158, 182, 224, 0.95)';
          } else {
            elLabel.textContent = TEXT[state.lang].label;
            elLabel.style.color = 'rgba(158, 182, 224, 0.95)';
          }
          if (state.diag.length > 0) {
            elDiag.textContent = state.diag;
            elDiag.style.display = 'block';
          } else {
            elDiag.style.display = 'none';
          }
        }

        for (const bowl of sim.bowls) {
          /* A seated pot keeps its own tilt; everything else gets the faint idle
             wobble, and a dragged bowl is left exactly under the cursor. */
          const tilt = bowl.dragging ? 0 : bowl.onHead ? 0 : Math.sin(Date.now() / 140 + bowl.w) * 0.012;
          bowl.node.style.transform =
            `translate3d(${bowl.x.toFixed(2)}px, ${bowl.y.toFixed(2)}px, 0) rotate(${(((bowl.angle + tilt) * 180) / Math.PI).toFixed(2)}deg)`;
          /* Both states sit in front of her (the props layer is above her sprite);
             a seated pot is lifted a little further so it also covers the tablet
             readout behind it. */
          bowl.node.style.zIndex = bowl.onHead ? '6' : '2';
          bowl.node.style.cursor = bowl.dragging ? 'grabbing' : 'grab';
        }

        const time = Date.now() / 1000;
        for (const floater of sim.floaters) {
          const k = Math.min(1, floater.t / floater.dur);
          const eased = 1 - Math.pow(1 - k, 2.2);
          const node = floater.node;
          if (floater.hidden === true) {
            node.style.opacity = '0';
            continue;
          }
          if (floater.kind === 'heart') {
            /* replaceChildren, not `textContent = ''`: assigning textContent
               deletes the pool node's child span, and the next number floater to
               reuse the node then threw on `node.firstChild.textContent` — which
               broke the whole frame, so the expression layers stopped updating
               right after a feed (hearts and numbers appear together). */
            node.replaceChildren();
            node.style.width = `${floater.size.toFixed(1)}px`;
            node.style.height = `${floater.size.toFixed(1)}px`;
            node.style.background = floater.color;
            node.style.clipPath = 'polygon(50% 100%, 4% 40%, 14% 14%, 36% 14%, 50% 32%, 64% 14%, 86% 14%, 96% 40%)';
            node.style.opacity = `${((1 - k) * 0.95).toFixed(2)}`;
            node.style.transform =
              `translate3d(${(floater.offsetX + Math.sin(time * 3 + floater.phase) * 12 * sim.scale).toFixed(2)}px, ` +
              `${(floater.offsetY - 96 * sim.scale * eased).toFixed(2)}px, 0)`;
            continue;
          }
          /* Defensive: a pooled node must always own its span, whatever a previous
             use did to it. Losing it here is what stopped the frame rendering. */
          if (node.firstChild === null) node.appendChild(document.createElement('span'));
          if (node.firstChild.textContent !== floater.text) node.firstChild.textContent = floater.text;
          if (node.childNodes.length > 1) {
            for (const extra of Array.from(node.childNodes).slice(1)) extra.remove();
          }
          node.style.width = '';
          node.style.height = '';
          node.style.background = '';
          node.style.clipPath = '';
          node.style.color = floater.color;
          node.style.fontSize = `${floater.size.toFixed(1)}px`;
          node.style.opacity = `${Math.min(1, (1 - k) * 1.6).toFixed(2)}`;
          const x = sim.petX + sim.petSize * 0.5 + floater.offsetX * sim.petSize + floater.jitter * eased + floater.drift * eased;
          const y = sim.petY + floater.offsetY * sim.petSize - 118 * sim.scale * eased;
          node.style.transform = `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, 0) translate(-50%, -50%)`;
        }

        g.clearRect(0, 0, view.width(), view.height());
        if (state.fallback === true) drawFallbackPet();
        if (sim.radarManual || sim.locked) {
          for (const bowl of sim.bowls) {
            if (bowl.kind !== 'rice') continue;
            if (!sim.radarManual && !bowl.locked) continue;
            drawNameplate(bowl);
          }
        }
      }

      /**
       * A plain drawn stand-in for the artwork: if the PNGs never decode, she is
       * still there, the tablet still shows the balance, and the menu still
       * works. Drawing it on the overlay canvas keeps it independent of images,
       * React and the host's DOM decisions.
       */
      function drawFallbackPet() {
        const size = sim.petSize;
        const left = sim.petX;
        const top = sim.petY;
        const pulse = pulse();
        g.save();
        g.translate(left, top);
        g.fillStyle = pulse > 0.1 ? `rgba(255, 48, 34, ${(0.35 + pulse * 0.5).toFixed(2)})` : 'rgba(74, 96, 180, 0.95)';
        /* head */
        g.beginPath();
        g.arc(size * 0.5, size * 0.24, size * 0.2, 0, Math.PI * 2);
        g.fill();
        /* body */
        g.beginPath();
        g.moveTo(size * 0.26, size * 0.95);
        g.lineTo(size * 0.34, size * 0.44);
        g.lineTo(size * 0.66, size * 0.44);
        g.lineTo(size * 0.74, size * 0.95);
        g.closePath();
        g.fill();
        /* the tablet, exactly where the artwork has it */
        const quad = QUAD.map(([x, y]) => [x * sim.scale, y * sim.scale]);
        g.beginPath();
        g.moveTo(quad[0][0], quad[0][1]);
        for (let i = 1; i < quad.length; i += 1) g.lineTo(quad[i][0], quad[i][1]);
        g.closePath();
        g.fillStyle = '#0b0b0c';
        g.fill();
        g.strokeStyle = '#8ea6d8';
        g.lineWidth = Math.max(1, size * 0.006);
        g.stroke();
        g.restore();
      }

      function drawNameplate(bowl) {
        const head = headCenter();
        const cx = bowl.x + bowl.w / 2;
        const cy = bowl.y + bowl.h / 2;
        const dx = cx - head.x;
        const dy = cy - head.y;
        const dist = Math.hypot(dx, dy);
        const closing = -((bowl.vx * dx + bowl.vy * dy) / Math.max(1, dist));
        const green = 'rgba(126, 255, 144, 0.92)';
        const pad = 9;
        const x0 = bowl.x - pad;
        const y0 = bowl.y - pad;
        const x1 = bowl.x + bowl.w + pad;
        const y1 = bowl.y + bowl.h + pad;
        const arm = Math.max(12, Math.min(x1 - x0, y1 - y0) * 0.24);
        g.save();
        g.strokeStyle = green;
        g.lineWidth = 1.4;
        g.beginPath();
        g.moveTo(x0, y0 + arm); g.lineTo(x0, y0); g.lineTo(x0 + arm, y0);
        g.moveTo(x1 - arm, y0); g.lineTo(x1, y0); g.lineTo(x1, y0 + arm);
        g.moveTo(x1, y1 - arm); g.lineTo(x1, y1); g.lineTo(x1 - arm, y1);
        g.moveTo(x0 + arm, y1); g.lineTo(x0, y1); g.lineTo(x0, y1 - arm);
        g.stroke();
        g.font = `${Math.max(11, 15 * sim.scale).toFixed(1)}px Consolas, monospace`;
        g.fillStyle = green;
        g.textAlign = 'left';
        g.textBaseline = 'top';
        const line = Math.max(14, 19 * sim.scale);
        const tx = Math.min(x1 + 9, view.width() - 130);
        g.fillText(`RNG ${(dist / 1000).toFixed(2)} kpx`, tx, y0);
        g.fillText(`Vc ${closing.toFixed(0)} px/s`, tx, y0 + line);
        g.fillText(`Alt ${(-dy).toFixed(0)} px`, tx, y0 + line * 2);
        const r = Math.max(11, 15 * sim.scale);
        const ringX = tx + r;
        const ringY = y0 + line * 3 + r + 8;
        g.beginPath();
        g.arc(ringX, ringY, r, 0, Math.PI * 2);
        g.stroke();
        const angle = Math.atan2(dy, dx);
        g.beginPath();
        g.moveTo(ringX, ringY);
        g.lineTo(ringX + Math.cos(angle) * r, ringY + Math.sin(angle) * r);
        g.stroke();
        g.fillStyle = 'rgba(126, 255, 144, 0.72)';
        g.fillText(`LOCK ${Math.max(0, BOWL_WAIT - bowl.wait).toFixed(1)}s`, x0, y1 + 5);
        g.restore();
      }

      /* ---- input ---- */
      function onPropPointerDown(event, node) {
        if (event.button !== 0) return;
        const bowl = sim.bowls.find((entry) => entry.node === node);
        if (bowl === undefined) return;
        /* A worn pot covers her head, so double-clicking "her head" actually lands
           on the pot — and that press only ever reached the drag path, which is why
           double-clicking never knocked it off. The same test runs here: second
           press, close to the first, on a pot that is on her head, and the pot goes
           flying instead of being picked up. */
        if (bowl.kind === 'iron' && bowl.onHead === true) {
          const now = performance.now();
          const age = now - sim.headClickT;
          const near =
            Math.abs(event.clientX - sim.headClickX) < 24 && Math.abs(event.clientY - sim.headClickY) < 24;
          const again = age < DOUBLE_CLICK_MS && near;
          sim.knockProbe = `calls=${(sim.knockProbeCalls = (sim.knockProbeCalls || 0) + 1)} age=${Math.round(age)} near=${near} again=${again}`;
          if (again && knockIronOff()) {
            sim.headClickT = -1e9;
            event.preventDefault();
            event.stopPropagation();
            notify();
            return;
          }
          sim.headClickT = now;
          sim.headClickX = event.clientX;
          sim.headClickY = event.clientY;
        }
        const rect = node.getBoundingClientRect();
        bowl.dragging = true;
        bowl.grabOffX = event.clientX - rect.left;
        bowl.grabOffY = event.clientY - rect.top;
        bowl.grab = { x: event.clientX, y: event.clientY };
        bowl.wait = 0;
        bowl.locked = false;
        bowl.lockT = 0;
        bowl.sucking = false;
        /* A worn pot is NOT taken off her head on the press itself: a press is also
           the first half of a double-click, and lifting it here meant the second
           press could never find a pot on her head to knock off. It leaves the head
           in the move handler below, i.e. only once it is actually dragged. */
        event.preventDefault();
        event.stopPropagation();
        try {
          node.setPointerCapture(event.pointerId);
        } catch {
          /* capture is a nicety, not a requirement */
        }
        const move = (moveEvent) => {
          if (!bowl.dragging) return;
          if (bowl.kind === 'iron' && bowl.onHead) {
            bowl.onHead = false;
            sim.squashT = 0;
          }
          bowl.grab = { x: moveEvent.clientX, y: moveEvent.clientY };
          /* Move it on the spot as well, so the drop lands where the pointer is
             even if the release arrives in the same task as the last move. */
          followPointer(bowl);
        };
        const up = () => {
          window.removeEventListener('pointermove', move);
          window.removeEventListener('pointerup', up);
          window.removeEventListener('pointercancel', up);
          if (!bowl.dragging) return;
          bowl.dragging = false;
          if (bowl.kind === 'rice' && overPet(bowl)) {
            feedRice(bowl);
            return;
          }
          if (bowl.kind === 'iron') {
            const head = headRect();
            const bottom = bowl.y + bowl.h * 0.92;
            const centre = bowl.x + bowl.w / 2;
            if (bottom > head.y0 - bowl.h * 0.4 && bottom < head.y1 && centre > head.x0 && centre < head.x1) {
              seatIronOnHead(bowl);
              return;
            }
          }
          bowl.vy = 60;
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
        window.addEventListener('pointercancel', up);
      }

      function onPetPointerDown(event) {
        if (event.button !== 0) return;
        /* Only her own pixels move her. A press that lands on a prop — the pot on
           her head, or a bowl — is that prop's business, handled by its own
           pointerdown listener, so it must not also start dragging the pet. */
        const hit = document.elementFromPoint(event.clientX, event.clientY);
        if (hit !== null && hit !== elPet && !elPet.contains(hit)) return;
        const now = performance.now();
        const nearHead =
          event.clientY < sim.petY + sim.petSize * 0.6 &&
          Math.abs(event.clientX - (sim.petX + sim.petSize * 0.5)) < sim.petSize * 0.45;
        /* A double click on her head knocks the pot off. A press that turns into
           a drag is not a click, so the timer is started here and cancelled in
           onPetPointerMove once the pointer actually travels. */
        const isSecondClick =
          nearHead &&
          now - sim.headClickT < DOUBLE_CLICK_MS &&
          Math.abs(event.clientX - sim.headClickX) < 24 &&
          Math.abs(event.clientY - sim.headClickY) < 24;
        if (isSecondClick && knockIronOff()) {
          sim.headClickT = -1e9;
          event.preventDefault();
          return;
        }
        sim.headClickT = isSecondClick || sim.headClickT < 0 ? now : sim.headClickT;
        sim.headClickX = event.clientX;
        sim.headClickY = event.clientY;
        sim.snap = null;
        sim.drag = { offX: event.clientX - sim.petX, offY: event.clientY - sim.petY, moved: false };
        elPet.style.cursor = 'grabbing';
        event.preventDefault();
        /* Listen before capturing. `setPointerCapture` retargets every following
           event of that pointer to this element, so a capture taken before these
           listeners exist leaves them never called — which is exactly why the pet
           could not be dragged even though the press was accepted. */
        window.addEventListener('pointermove', onPetPointerMove);
        window.addEventListener('pointerup', onPetPointerUp);
        window.addEventListener('pointercancel', onPetPointerUp);
        /* Capture is a nicety (it keeps the drag alive outside the window); it is
           skipped for synthetic pointer ids, which have no active pointer. */
        if (event.isTrusted === true && typeof event.pointerId === 'number' && event.pointerId > 0) {
          try {
            elPet.setPointerCapture(event.pointerId);
          } catch {
            /* ignore */
          }
        }
      }

      function onPetPointerMove(event) {
        if (sim.drag === null) return;
        const maxX = Math.max(0, view.width() - sim.petSize);
        const maxY = Math.max(0, view.height() - sim.petSize);
        const nextX = Math.min(maxX, Math.max(0, event.clientX - sim.drag.offX));
        const nextY = Math.min(maxY, Math.max(0, event.clientY - sim.drag.offY));
        if (!sim.drag.moved && (Math.abs(nextX - sim.petX) > 3 || Math.abs(nextY - sim.petY) > 3)) {
          sim.drag.moved = true;
          sim.headClickT = -1e9;
        }
        sim.petX = nextX;
        sim.petY = nextY;
      }

      function onPetPointerUp() {
        window.removeEventListener('pointermove', onPetPointerMove);
        window.removeEventListener('pointerup', onPetPointerUp);
        window.removeEventListener('pointercancel', onPetPointerUp);
        if (sim.drag === null) return;
        sim.drag = null;
        elPet.style.cursor = 'grab';
        /* A position she was dragged to sticks. It used to snap back to the home
           corner, which made her look immovable: the drag worked, and then the
           animation put her straight back. */
        sim.placed = true;
        sim.snap = null;
        savePrefs(state);
      }

      /* ---- menu ---- */
      /* The same entries, groups and submenus the desktop tray menu builds:
         refresh / Test (charge, top-up, demo) / Display (size, appearance,
         sound) / System (key, quit). */
      function menuModel() {
        const t = TEXT[state.lang];
        const withPrefs = (next) => {
          Object.assign(state, next);
          savePrefs(state);
          /* Choosing a corner is an explicit "put her there", so it overrides a
             position she was dragged to. */
          if (next.corner !== undefined) {
            sim.placed = false;
            /* A saved corner from before this mode existed still needs a home. */
            syncLayout();
          }
          if (next.size !== undefined) syncLayout();
          notify();
        };
        const cueCount = (amount) => Math.max(1, Math.round(Math.abs(amount) / STEP));
        const runDemo = (amount) => {
          sim.queued += Math.min(MAX_CUES, cueCount(amount));
          sim.cueT = 0;
          notify();
        };
        return [
          { label: t.refresh, onClick: () => poll(true) },
          { separator: true },
          { group: t.groupTest },
          { label: t.testCharge, onClick: () => { sim.queued += 1; sim.cueT = 0; notify(); } },
          {
            label: t.testTopup,
            children: [
              {
                label: t.topup3,
                onClick: () => {
                  sim.pending = round2(sim.pending + 3);
                  dropRiceBowl(3);
                  notify();
                },
              },
              {
                label: t.radarOn,
                check: state.radarManual,
                onClick: () => {
                  state.radarManual = !state.radarManual;
                  notify();
                },
              },
              { separator: true },
              {
                label: t.custom,
                onClick: () => {
                  void customInput(t.topupPrompt, '3').then((amount) => {
                    if (amount !== null && amount > 0) {
                      sim.pending = round2(sim.pending + amount);
                      dropRiceBowl(amount);
                      notify();
                    }
                  });
                },
              },
            ],
          },
          {
            label: t.demo,
            children: [0.05, 0.1, 0.2, 0.5, 1].map((amount) => ({
              label: `-${amount}`,
              hint: `${cueCount(amount)}`,
              onClick: () => runDemo(amount),
            })).concat([
              { separator: true },
              {
                label: t.custom,
                onClick: () => {
                  void customInput(t.demoPrompt, '-0.1').then((amount) => {
                    if (amount !== null && amount < 0) runDemo(amount);
                  });
                },
              },
            ]),
          },
          { separator: true },
          { group: t.groupDisplay },
          {
            label: t.size,
            children: [
              { label: `${t.sizeMid}  340 px`, check: state.size === 340, onClick: () => withPrefs({ size: 340 }) },
              { label: `${t.sizeBig}  454 px`, check: state.size === 454, onClick: () => withPrefs({ size: 454 }) },
              { label: `${t.sizeXl}  624 px`, check: state.size === 624, onClick: () => withPrefs({ size: 624 }) },
              { separator: true },
              {
                label: t.custom,
                onClick: () => {
                  void customInput(t.sizePrompt, String(state.size)).then((size) => {
                    if (size !== null && size >= 120 && size <= 1400) withPrefs({ size: Math.round(size) });
                  });
                },
              },
            ],
          },
          {
            label: t.corner,
            hint: t.cornerHint,
            children: [
              { label: t.cornerContentGutter, check: state.corner === 'content-gutter', onClick: () => withPrefs({ corner: 'content-gutter' }) },
              { label: t.cornerContentLeft, check: state.corner === 'content-left', onClick: () => withPrefs({ corner: 'content-left' }) },
              { label: t.cornerBottomLeft, check: state.corner === 'bottom-left', onClick: () => withPrefs({ corner: 'bottom-left' }) },
              { label: t.cornerBottomRight, check: state.corner === 'bottom-right', onClick: () => withPrefs({ corner: 'bottom-right' }) },
              { label: t.cornerTopLeft, check: state.corner === 'top-left', onClick: () => withPrefs({ corner: 'top-left' }) },
              { label: t.cornerTopRight, check: state.corner === 'top-right', onClick: () => withPrefs({ corner: 'top-right' }) },
            ],
          },
          {
            label: t.theme,
            children: [
              { label: t.themeLight, check: state.theme === 'light', onClick: () => withPrefs({ theme: 'light' }) },
              { label: t.themeDark, check: state.theme === 'dark', onClick: () => withPrefs({ theme: 'dark' }) },
            ],
          },
          {
            label: t.sound,
            children: [
              { label: t.soundOn, check: state.sound, onClick: () => withPrefs({ sound: !state.sound }) },
              { separator: true },
              { group: t.volumeLevel },
              ...[0, 25, 50, 75, 100].map((level) => ({
                label: level === 0 ? t.volumeMute : `${level} %`,
                check: state.volume === level,
                onClick: () => withPrefs({ volume: level }),
              })),
              { separator: true },
              {
                label: t.custom,
                onClick: () => {
                  void customInput(t.volumePrompt, String(state.volume)).then((level) => {
                    if (level !== null && level >= 0 && level <= 100) withPrefs({ volume: Math.round(level) });
                  });
                },
              },
            ],
          },
          { separator: true },
          { group: t.groupSystem },
          {
            label: t.setKey,
            onClick: () => {
              const key = window.prompt(t.keyPrompt, '');
              if (key === null || key.trim().length === 0) return;
              setApiKey(key.trim()).catch(() => {
                state.status = 'offline';
                state.statusDetail = 'key-write-failed';
                notify();
              });
            },
          },
          {
            label: t.quit,
            onClick: () => {
              state.hidden = true;
              elPet.style.display = 'none';
              elProps.style.display = 'none';
              elFloaters.style.display = 'none';
              notify();
            },
          },
        ];
      }

      function openMenu(x, y) {
        state.menuOpen = true;
        state.menuAt = { x, y };
        buildMenu();
        notify();
      }

      /**
       * The right-click menu, built as plain DOM.
       *
       * It cannot be a React tree: the host renders this plugin's component as a
       * static element, so a state update never re-renders it and a declarative
       * menu would simply never appear. Everything dynamic here is therefore
       * imperative, the same way the pet itself is drawn.
       */
      function buildMenu() {
        if (state.hidden) return;
        if (menuRoot !== null) {
          menuRoot.remove();
          menuRoot = null;
        }
        if (!state.menuOpen) return;
        const model = menuModel();
        const styles = menuStyles(state.theme === 'dark');
        const width = 252;
        const anchorX = Math.max(8, Math.min(state.menuAt.x, view.width() - width - 8));
        menuRoot = document.createElement('div');
        menuRoot.setAttribute('data-pet-menu-root', '');
        Object.assign(menuRoot.style, { position: 'fixed', inset: '0', pointerEvents: 'none', zIndex: '2147483000' });
        document.body.appendChild(menuRoot);

        const renderPanel = (items, left, top, depth, trailing) => {
          const panel = document.createElement('div');
          panel.setAttribute('data-pet-menu', '');
          panel.style.cssText = panelCss(styles, left, top);
          for (const entry of items) {
            if (entry.group !== undefined) {
              const header = document.createElement('div');
              header.textContent = entry.group;
              header.style.cssText = headerCss(styles);
              panel.appendChild(header);
              continue;
            }
            if (entry.separator === true) {
              const line = document.createElement('div');
              line.style.cssText = separatorCss(styles);
              panel.appendChild(line);
              continue;
            }
            if (entry.volume === true) {
              panel.appendChild(volumeRow(styles, trailing));
              continue;
            }
            const row = document.createElement('div');
            row.style.cssText = rowCss(styles);
            const tick = document.createElement('span');
            tick.textContent = entry.check === true ? '\u2713' : '';
            tick.style.cssText = `width:14px;display:inline-block;text-align:center;color:${styles.accent}`;
            const label = document.createElement('span');
            label.textContent = entry.label;
            row.append(tick, label);
            if (entry.hint !== undefined) {
              const hint = document.createElement('span');
              hint.textContent = entry.hint;
              hint.style.cssText = 'margin-left:auto;opacity:.5;font-size:11px';
              row.appendChild(hint);
            }
            const hasChildren = Array.isArray(entry.children);
            if (hasChildren) {
              const chevron = document.createElement('span');
              chevron.textContent = '\u25B8';
              chevron.style.cssText = 'margin-left:auto;opacity:.55';
              row.appendChild(chevron);
            }
            row.addEventListener('mouseenter', () => {
              row.style.background = styles.hover;
              if (hasChildren) {
                if (trailing !== null) trailing.remove();
                trailing = renderPanel(entry.children, left + width - 4, top + 4, depth + 1, null);
              } else if (trailing !== null) {
                trailing.remove();
                trailing = null;
              }
            });
            row.addEventListener('mouseleave', () => {
              row.style.background = 'transparent';
            });
            row.addEventListener('click', (event) => {
              event.stopPropagation();
              if (hasChildren) return;
              closeMenu();
              entry.onClick();
            });
            panel.appendChild(row);
          }
          menuRoot.appendChild(panel);
          return panel;
        };

        /* Keep the open submenu from collapsing while the pointer crosses into it. */
        let trailing = null;
        const panel = renderPanel(model, anchorX, Math.max(8, Math.min(state.menuAt.y, view.height() - 320)), 0, null);
        panel.addEventListener('mouseleave', () => {
          if (trailing !== null) {
            trailing.remove();
            trailing = null;
          }
        });
        const guard = (event) => {
          if (event.target instanceof Node && menuRoot !== null && menuRoot.contains(event.target)) return;
          closeMenu();
          notify();
        };
        menuGuard = guard;
        window.addEventListener('pointerdown', guard, true);
      }

      function closeMenu() {
        state.menuOpen = false;
        if (menuRoot !== null) {
          menuRoot.remove();
          menuRoot = null;
        }
        if (menuGuard !== null) {
          window.removeEventListener('pointerdown', menuGuard, true);
          menuGuard = null;
        }
      }

      function volumeRow(styles, anchorPanel) {
        const wrap = document.createElement('div');
        wrap.style.cssText = 'display:flex;align-items:center;gap:8px;padding:4px 14px 8px';
        const label = document.createElement('span');
        label.textContent = TEXT[state.lang].volumeLevel;
        label.style.cssText = 'opacity:.7;font-size:12px';
        const track = document.createElement('div');
        track.style.cssText = `flex:1;height:4px;border-radius:2px;background:${styles.track};position:relative;cursor:pointer`;
        const fill = document.createElement('div');
        fill.style.cssText = `position:absolute;left:0;top:0;bottom:0;width:${state.volume}%;border-radius:2px;background:${styles.accent}`;
        track.appendChild(fill);
        const readout = document.createElement('span');
        readout.textContent = `${state.volume}%`;
        readout.style.cssText = 'width:36px;text-align:right;opacity:.8';
        track.addEventListener('click', (event) => {
          const rect = track.getBoundingClientRect();
          const value = Math.max(0, Math.min(100, Math.round(((event.clientX - rect.left) / rect.width) * 100)));
          state.volume = value;
          savePrefs(state);
          fill.style.width = `${value}%`;
          readout.textContent = `${value}%`;
          soundPreview();
        });
        wrap.append(label, track, readout);
        void anchorPanel;
        return wrap;
      }

      function panelCss(styles, left, top) {
        return [
          'position:fixed',
          `left:${left}px`,
          `top:${top}px`,
          `min-width:252px`,
          'padding:5px 0',
          'border-radius:10px',
          `background:${styles.panel}`,
          `color:${styles.ink}`,
          `border:0.5px solid ${styles.stroke}`,
          `box-shadow:${styles.shadow}`,
          'font:13px/1.5 "Microsoft YaHei UI","PingFang SC","Segoe UI",system-ui,sans-serif',
          'user-select:none',
          'pointer-events:auto',
        ].join(';');
      }

      function rowCss(styles) {
        return `display:flex;align-items:center;gap:8px;height:30px;padding:0 14px;cursor:pointer;white-space:nowrap;color:${styles.ink}`;
      }

      function headerCss(styles) {
        return `padding:6px 14px 2px;font-size:11px;letter-spacing:.04em;color:${styles.muted}`;
      }

      function separatorCss(styles) {
        return `height:1px;margin:5px 8px;background:${styles.stroke}`;
      }

      /**
       * An in-page text box, in the menu's own palette.
       *
       * This replaces `window.prompt`, which Electron does not implement: it
       * returned null, so every "自定义…" entry did nothing at all — the preset
       * rows only appeared to work because they skip the prompt. The dialog is
       * owned by the engine and removed as soon as it is answered, so nothing of
       * it is left over if the page changes under it.
       */
      let dialogRoot = null;

      function closeDialog() {
        if (dialogRoot === null) return;
        const hostage = dialogRoot;
        dialogRoot = null;
        hostage.remove();
      }

      function customInput(prompt, initial) {
        return new Promise((resolve) => {
          closeDialog();
          const styles = menuStyles(state.theme === 'dark');
          const root = document.createElement('div');
          root.setAttribute('data-pet-dialog', '');
          dialogRoot = root;
          Object.assign(root.style, {
            position: 'fixed',
            inset: '0',
            zIndex: '2147483001',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(0,0,0,.35)',
          });

          const panel = document.createElement('div');
          panel.style.cssText = [
            'min-width:280px',
            'max-width:min(420px, 86vw)',
            'padding:16px 18px 14px',
            `border-radius:12px`,
            `background:${styles.panel}`,
            `color:${styles.ink}`,
            `border:0.5px solid ${styles.stroke}`,
            `box-shadow:${styles.shadow}`,
            'font:13px/1.6 "Microsoft YaHei UI","PingFang SC","Segoe UI",system-ui,sans-serif',
          ].join(';');

          const label = document.createElement('div');
          label.textContent = prompt;
          label.style.cssText = 'margin-bottom:10px;white-space:pre-wrap';

          const field = document.createElement('input');
          field.type = 'text';
          field.value = initial === undefined ? '' : String(initial);
          field.style.cssText = [
            'width:100%',
            'box-sizing:border-box',
            'padding:7px 9px',
            'border-radius:8px',
            `border:1px solid ${styles.stroke}`,
            `background:${state.theme === 'dark' ? 'rgba(255,255,255,.06)' : 'rgba(0,0,0,.04)'}`,
            `color:${styles.ink}`,
            'font:13px/1.4 "Microsoft YaHei UI","PingFang SC","Segoe UI",system-ui,sans-serif',
            'outline:none',
          ].join(';');

          const buttons = document.createElement('div');
          buttons.style.cssText = 'display:flex;justify-content:flex-end;gap:8px;margin-top:14px';

          const makeButton = (text, primary) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.textContent = text;
            button.style.cssText = [
              'padding:6px 16px',
              'border-radius:8px',
              'cursor:pointer',
              `border:1px solid ${styles.stroke}`,
              primary === true ? `background:${styles.accent};color:#fff;border-color:transparent` : 'background:transparent',
              primary === true ? '' : `color:${styles.ink}`,
              'font:13px/1.4 inherit',
            ].join(';');
            return button;
          };

          const cancel = makeButton(TEXT[state.lang].quit, false);
          const accept = makeButton('OK', true);
          buttons.append(cancel, accept);
          panel.append(label, field, buttons);
          root.appendChild(panel);
          document.body.appendChild(root);

          /* Answering removes the dialog before the value is used, so a caller
             that acts on it cannot be looking at a detached tree. */
          const settle = (value) => {
            if (dialogRoot !== root) return;
            closeDialog();
            resolve(value);
          };
          const readValue = () => {
            const raw = field.value;
            if (raw === null) return null;
            const parsed = Number.parseFloat(String(raw).replace(/[^0-9.\-]/g, ''));
            return Number.isFinite(parsed) ? parsed : null;
          };

          accept.addEventListener('click', () => settle(readValue()));
          cancel.addEventListener('click', () => settle(null));
          field.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              settle(readValue());
            } else if (event.key === 'Escape') {
              event.preventDefault();
              settle(null);
            }
          });
          /* Clicking the dimmed backdrop cancels, the way a modal should. */
          root.addEventListener('pointerdown', (event) => {
            if (event.target === root) settle(null);
          });
          window.setTimeout(() => {
            field.focus();
            field.select();
          }, 0);
        });
      }

      function soundPreview() {
        sound.playHit();
      }

      /** Ask the React half to repaint (menu and settings live there). */
      function notify() {
        if (petRepaint !== null) petRepaint();
        else if (typeof onChange === 'function') onChange();
      }

      /* ---- lifecycle ---- */
      /**
       * The engine is driven by a timer, not by requestAnimationFrame.
       *
       * In the Harness page rAF can be stopped for a long time — the tab is a
       * hidden one (measured: document.visibilityState === "hidden"), and a
       * hidden tab gets no animation frames at all. With rAF as the only clock
       * the bowl never fell, the charge cues never played and the display froze
       * on whatever it last showed. A timer keeps ticking (throttled to about
       * once a second when hidden), and the elapsed real time is integrated in
       * fixed steps, so a burst is caught up the moment the page is looked at
       * again instead of being lost.
       */
      let timer = 0;
      let last = 0;

      function frame() {
        const now = Date.now();
        const dt = last === 0 ? 0.016 : Math.min(2, (now - last) / 1000);
        last = now;
        updateSnap(dt);
        tick(dt);
      }

      function start() {
        syncLayout();
        /* Crop the pot art now rather than when the first pot appears, so the pot
           is already the right shape the moment it is dropped. */
        cropPotArt();
        /* A previous mount's menu may still be in the DOM after a reload: its
           root is owned by that engine instance, so clear any leftovers. */
        for (const node of document.querySelectorAll('[data-pet-menu-root]')) node.remove();
        menuRoot = null;
        /* The frame must be in the document and painted on top, whatever the
           host did with it while React re-rendered the tree. */
        try {
          if (!document.body.contains(host)) document.body.appendChild(host);
          Object.assign(host.style, { position: 'fixed', inset: '0', zIndex: '2147482000', pointerEvents: 'none', overflow: 'hidden' });
          elPet.style.pointerEvents = 'auto';
        } catch {
          /* a host that cannot be re-anchored still draws where it was placed */
        }
        /* The right-click handler lives here, not on a React prop: React may
           replace the element it is attached to, and a menu that silently stops
           working is worse than one bound by hand. The hit test is her own
           rectangle, so nothing else on the page is affected. */
        onContextMenu = (event) => {
          if (state.hidden) return;
          const rect = elPet.getBoundingClientRect();
          const inside =
            rect.width > 0 &&
            event.clientX >= rect.left &&
            event.clientX <= rect.right &&
            event.clientY >= rect.top &&
            event.clientY <= rect.bottom;
          if (!inside) return;
          event.preventDefault();
          openMenu(event.clientX, event.clientY);
        };
        window.addEventListener('contextmenu', onContextMenu, true);
        /* Dragging is bound here too, for the same reason: React's onPointerDown
           prop on the frame was never called (a drag test left `placed: false`),
           so the pet could not actually be moved. The hit test is her own
           rectangle, which keeps the rest of the page untouched. */
        onPetDown = (event) => {
          if (event.button !== 0 || state.hidden) return;
          const rect = elPet.getBoundingClientRect();
          if (
            event.clientX < rect.left ||
            event.clientX > rect.right ||
            event.clientY < rect.top ||
            event.clientY > rect.bottom
          ) {
            return;
          }
          onPetPointerDown(event);
        };
        window.addEventListener('pointerdown', onPetDown, true);
        /* If the artwork never decodes, draw her instead: an empty screen must
           never be the answer. */
        window.setTimeout(() => {
          const broken = layers.every((img) => img.naturalWidth === 0);
          if (broken) state.fallback = true;
          state.drawn = layers.map((img) => `${img.complete ? 'c' : '-'}${img.naturalWidth}`);
          render();
        }, 1200);
        poll();
        last = Date.now();
        timer = window.setInterval(frame, FRAME_MS);
        /* Coming back to the page must not wait for the next tick to catch up. */
        onVisible = () => frame();
        document.addEventListener('visibilitychange', onVisible);
      }

      function dispose() {
        sim.running = false;
        if (timer !== 0) window.clearInterval(timer);
        if (onVisible !== null) document.removeEventListener('visibilitychange', onVisible);
        if (onContextMenu !== null) window.removeEventListener('contextmenu', onContextMenu, true);
        if (onPetDown !== null) window.removeEventListener('pointerdown', onPetDown, true);
        sound.dispose();
        elPet.remove();
        elProps.remove();
        elFloaters.remove();
        canvas.remove();
      }

      return {
        state,
        sim,
        sound,
        elPet,
        canvas,
        start,
        dispose,
        syncLayout,
        poll,
        openMenu,
        menuModel,
        notify,
        dropRiceBowl,
        elFloaters,
        elProps,
        removeBowlForProbe: (bowl) => removeBowl(bowl),
        headRectForProbe: () => headRect(),
        savePrefsForProbe: () => savePrefs(state),
        potCropState: () => (potCroppedSrc === null ? 'not cropped' : `${potCroppedSrc.slice(0, 20)}…`),
        customInputForProbe: (prompt, initial) => customInput(prompt, initial),
        knockProbeForProbe: () => sim.knockProbe ?? 'head branch never ran',
        frameProbe: () => ({ ticks: sim.ticks || 0, lastDt: Number((sim.lastDt || 0).toFixed(3)), timer: timer !== 0 }),
        pollCallsForProbe: () => ({ total: pollCount.total, snaps: pollCount.snaps, skipped: pollCount.skipped }),
        setPrefsForProbe: (next) => {
          Object.assign(state, next);
          savePrefs(state);
          if (next.corner !== undefined) sim.placed = false;
          syncLayout();
          notify();
        },
        topUpForProbe: (amount) => {
          sim.pending = round2(sim.pending + amount);
          dropRiceBowl(amount);
          notify();
        },
        renderErrorForProbe: () => (renderError === '' ? 'none' : renderError),
        seatProgress: (bowl) => {
          const head = headRect();
          const reach = sim.petY + sim.petSize * POT_RIM_Y;
          return [
            `y=${Math.round(bowl.y)}`,
            `w=${Math.round(bowl.w)}`,
            `h=${Math.round(bowl.h)}`,
            `vy=${Math.round(bowl.vy)}`,
            `onHead=${bowl.onHead}`,
            `delay=${bowl.seatDelay.toFixed(2)}`,
            `rimY=${Math.round(bowl.y + bowl.h)}`,
            `window=${Math.round(reach - bowl.h)}..${Math.round(reach + bowl.h * 1.6)}`,
            `rimX=${Math.round(bowl.x + bowl.w / 2)}`,
            `headX=${Math.round(head.x0)}..${Math.round(head.x1)}`,
          ].join(' ');
        },
        feedBowlForProbe: (bowl) => feedRice(bowl),
        dropRiceBowlsOnPotForProbe: () => {
          const bowl = dropRiceBowl(state.displayed === null ? 0 : 1);
          if (bowl !== null) {
            /* Aim it at the pot so the drop is what is being tested. */
            bowl.x = sim.petX + sim.petSize * POT_CX - bowl.w / 2;
            bowl.y = sim.petY - bowl.h * 2.2;
            bowl.vy = 320;
            bowl.vx = 0;
          }
          return bowl;
        },
        closeMenu,
        buildMenu,
        soundPreview,
        setApiKey,
        onPetPointerDown,
        onPetPointerMove,
        onPetPointerUp,
      };
    }

    /* ------------------------------------------------------ error boundary -- */

    /**
     * A render error inside the pet must be visible rather than silent: React
     * would otherwise unmount the whole subtree and the page would simply show
     * nothing, which is impossible to tell apart from "the plugin is off".
     */
    class PetBoundary extends React.Component {
      constructor(props) {
        super(props);
        this.state = { error: null };
      }

      static getDerivedStateFromError(error) {
        return { error: error instanceof Error ? `${error.name}: ${error.message}` : String(error) };
      }

      componentDidCatch(error, info) {
        watch.errors.push(`render: ${error instanceof Error ? error.message : String(error)}`);
        watch.report();
        void info;
      }

      render() {
        /* The child arrives as `child` (not `children`) so the boundary does not
           depend on how the host passes JSX children through. */
        if (this.state.error === null) return this.props.child === undefined ? null : this.props.child;
        return h(
          'div',
          {
            'data-pet-error': '',
            style: {
              position: 'fixed',
              left: '12px',
              bottom: '12px',
              maxWidth: '52ch',
              padding: '10px 12px',
              borderRadius: '8px',
              background: 'rgba(120, 20, 20, 0.94)',
              color: '#ffe9e9',
              font: '12px/1.5 ui-monospace, Consolas, monospace',
              whiteSpace: 'pre-wrap',
              pointerEvents: 'auto',
              zIndex: 2147483001,
            },
          },
          `\u4F59\u989D\u5BA0\u7269\u6E32\u67D3\u5931\u8D25\n${this.state.error}`,
        );
      }
    }

    /* ------------------------------------------------------- projection --- */

    /**
     * Homography of the unit square onto `quad` (TL, TR, BR, BL), returned in the
     * CSS matrix3d column order [a, b, c, d, tx, ty]: the four-point case of the
     * classic square-to-quadrilateral solve.
     */
    function projectUnitSquare(quad) {
      const [p0, p1, p2, p3] = quad;
      const dx1 = p1[0] - p2[0];
      const dx2 = p3[0] - p2[0];
      const dx3 = p0[0] - p1[0] + p2[0] - p3[0];
      const dy1 = p1[1] - p2[1];
      const dy2 = p3[1] - p2[1];
      const dy3 = p0[1] - p1[1] + p2[1] - p3[1];
      let g = 0;
      let hh = 0;
      if (Math.abs(dx3) > 1e-9 || Math.abs(dy3) > 1e-9) {
        const det = dx1 * dy2 - dx2 * dy1;
        if (Math.abs(det) < 1e-9) return null;
        g = (dx3 * dy2 - dx2 * dy3) / det;
        hh = (dx1 * dy3 - dx3 * dy1) / det;
      }
      return [
        p1[0] - p0[0] + g * p1[0],
        p1[1] - p0[1] + g * p1[1],
        p3[0] - p0[0] + hh * p3[0],
        p3[1] - p0[1] + hh * p3[1],
        p0[0],
        p0[1],
      ];
    }

    /* ------------------------------------------------------- component ---- */

    function PetOverlay() {
      const hostRef = React.useRef(null);
      const [engine, setEngine] = React.useState(null);
      const [, bump] = React.useState(0);
      watch.renders = (watch.renders || 0) + 1;

      React.useEffect(() => {
        const host = hostRef.current;
        if (host === null) return undefined;
        let built = null;
        /* The engine owns every dynamic surface, including the right-click menu,
           which it builds as plain DOM. Nothing here may depend on a re-render:
           the host mounts this component as a static element, so a state update
           never repaints it. */
        petRepaint = () => {
          bump((n) => n + 1);
        };
        /* The tablet readout must never end up empty: if it does, say so. */
        watch.frame = host;
        try {
          built = createEngine(host);
        } catch (error) {
          watch.errors.push(`engine: ${error instanceof Error ? error.message : String(error)}`);
          watch.report();
          /* A startup failure must be visible: draw it where the pet would be. */
          const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
          const banner = document.createElement('div');
          banner.textContent = `balance pet failed to start\n${message}`;
          Object.assign(banner.style, {
            position: 'fixed',
            left: '12px',
            bottom: '12px',
            maxWidth: '46ch',
            padding: '10px 12px',
            borderRadius: '8px',
            background: 'rgba(120, 20, 20, 0.92)',
            color: '#ffe9e9',
            font: '12px/1.5 ui-monospace, Consolas, monospace',
            whiteSpace: 'pre-wrap',
            zIndex: 2147483001,
          });
          host.appendChild(banner);
          return () => banner.remove();
        }
        setEngine(built);
        watch.engine = 'yes';
        watch.report();
        /* Keep the Host's copy fresh so `/pet-check` can show the live page. */
        const reporter = window.setInterval(() => {
          watch.status = `${built.state.status}/${built.state.diag}`;
          watch.report();
        }, 5000);
        window.setTimeout(() => watch.report(), 800);
        /* The test harness and the Inspect probe read the live engine from
           here; in the page it is just a property nobody else looks at. */
        livePet = built;
        window.__DSH_BALANCE_PET__ = built;
        /* The frame is the engine's own host: keep it painted on top of every
           other overlay occupant, and make sure it is really in the document. */
        try {
          host.style.zIndex = '2147482000';
          if (!document.body.contains(host)) document.body.appendChild(host);
        } catch {
          /* a host that cannot be re-anchored still draws where it was placed */
        }
        const onError = (event) => {
          const message = event.error instanceof Error ? `${event.error.name}: ${event.error.message}` : String(event.message ?? 'error');
          try {
            built.state.diag = message.slice(0, 120);
            built.notify();
          } catch {
            /* the banner is the last resort; never throw from the handler */
          }
        };
        window.addEventListener('error', onError);
        return () => {
          window.removeEventListener('error', onError);
          window.clearInterval(reporter);
          petRepaint = null;
          if (livePet === built) livePet = null;
          built.dispose();
          setEngine(null);
        };
      }, []);

      React.useEffect(() => {
        if (engine === null) return undefined;
        engine.start();
        const onResize = () => engine.syncLayout();
        const onVisibility = () => {
          if (document.visibilityState === 'visible') engine.poll();
        };
        window.addEventListener('resize', onResize);
        document.addEventListener('visibilitychange', onVisibility);
        return () => {
          window.removeEventListener('resize', onResize);
          document.removeEventListener('visibilitychange', onVisibility);
        };
      }, [engine]);


      const onContextMenu = React.useCallback(
        (event) => {
          if (engine === null) return;
          event.preventDefault();
          engine.openMenu(event.clientX, event.clientY);
        },
        [engine],
      );

      const onPetRef = React.useCallback(
        (node) => {
          if (node === null || engine === null) return;
          node.addEventListener('pointerdown', engine.onPetPointerDown);
          node.ownerDocument.addEventListener('pointermove', engine.onPetPointerMove);
          node.ownerDocument.addEventListener('pointerup', engine.onPetPointerUp);
          node.ownerDocument.addEventListener('pointercancel', engine.onPetPointerUp);
        },
        [engine],
      );

      const children = [
        h('div', {
          key: 'pet',
          ref: onPetRef,
          /* Deliberately without handlers: React props on this element were not
             being called at all, so the right-click menu, the drag and the double
             click are all bound to the window by the engine instead. */
          style: {
            position: 'absolute',
            left: 0,
            top: 0,
            width: 1,
            height: 1,
            pointerEvents: 'none',
          },
        }),
      ];

      const frame = h(
        'div',
        {
          /* A callback ref, not the ref object: React calls it with the element
             on mount, which is the only thing this component needs. */
          ref: (node) => {
            hostRef.current = node;
          },
          style: {
            position: 'fixed',
            inset: 0,
            zIndex: 2147482000,
            pointerEvents: 'none',
            overflow: 'hidden',
          },
        },
        children,
      );
      return frame;
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        watch.loaded = true;
        watch.report();
        window.addEventListener('error', (event) => {
          watch.errors.push(String(event.message).slice(0, 160));
          watch.report();
        });

        /* Register a read-only Inspect provider so the live page state can be
           queried from outside (`cordis_inspect_query`, platform `client`,
           provider `PetStatus`). It answers with the same facts the Host report
           carries, which is the only way to see this page from the Host side:
           the Desktop browser gate refuses loopback HTTP to anything else. */
        try {
          const inspect = ctx.get('cordisInspect');
          if (inspect !== undefined && typeof inspect.register === 'function') {
            const engineInfo = () => {
              const engine = livePet !== null ? livePet : window.__DSH_BALANCE_PET__;
              if (engine === undefined || engine === null) return { state: 'missing' };
              const rect = engine.elPet.getBoundingClientRect();
              return {
                state: 'running',
                size: engine.state.size,
                status: engine.state.status,
                detail: engine.state.statusDetail,
                diag: engine.state.diag,
                displayed: engine.state.displayed,
                real: engine.state.realBalance,
                bowls: engine.sim.bowls.length,
                queued: engine.sim.queued,
                menuOpen: engine.state.menuOpen,
                petX: Math.round(engine.sim.petX),
                petY: Math.round(engine.sim.petY),
                drawnSize: engine.sim.petSize,
                viewport: { w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio },
                rect: { left: Math.round(rect.left), top: Math.round(rect.top), width: Math.round(rect.width), height: Math.round(rect.height), bottom: Math.round(rect.bottom) },
                transform: engine.elPet.style.transform,
              };
            };
            ctx.effect(
              () =>
                inspect.register({
                  manifest: {
                    id: 'PetStatus',
                    description: 'Live state of the DSH balance pet in this page: module load, engine, artwork, tablet readout and page errors.',
                    methods: [
                      {
                        name: 'getStatus',
                        description: 'Report what the balance pet is doing right now in this browser page.',
                        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
                        outputSchema: { description: 'Module load flag, engine state, image load results, tablet text and collected page errors.' },
                      },
                      {
                        name: 'act',
                        description: 'Drive one pet action from outside the page (open the menu, run a charge cue, drop a test rice bowl, toggle the radar) and report what changed.',
                        inputSchema: {
                          type: 'object',
                          properties: {
                            action: { type: 'string', enum: ['openMenu', 'closeMenu', 'charge', 'topUp', 'radar', 'probe', 'rightclick', 'bowlCheck', 'potCheck', 'dragCheck', 'clickRow', 'sizeCheck', 'dom', 'potArt', 'headProfile', 'lockCheck', 'faceCheck', 'dialogCheck', 'rowCheck', 'refreshCheck', 'knockCheck'] },
                            via: { type: 'string' },
                            text: { type: 'string' },
                            mode: { type: 'string' },
                            size: { type: 'number' },
                          },
                          required: ['action'],
                          additionalProperties: false,
                        },
                        outputSchema: { description: 'The engine state after the action, plus how many menu rows are on screen.' },
                      },
                    ],
                  },
                  async query(method, input) {
                    const engine = livePet !== null ? livePet : window.__DSH_BALANCE_PET__;
                    if (method === 'act') {
                      if (engine === undefined || engine === null) throw new Error('the pet engine is not running');
                      const action = String(input && input.action);
                      if (action === 'openMenu') {
                        const rect = engine.elPet.getBoundingClientRect();
                        engine.openMenu(Math.round(rect.left + rect.width / 2), Math.round(rect.top + rect.height / 4));
                      } else if (action === 'closeMenu') {
                        engine.state.menuOpen = false;
                        engine.notify();
                      } else if (action === 'charge') {
                        engine.sim.queued += 1;
                        engine.sim.cueT = 0;
                        engine.notify();
                      } else if (action === 'topUp') {
                        engine.sim.pending = Math.round((engine.sim.pending + 3) * 100) / 100;
                        engine.dropRiceBowl(3);
                        engine.notify();
                      } else if (action === 'radar') {
                        engine.state.radarManual = !engine.state.radarManual;
                        engine.notify();
                      } else if (action === 'rightclick') {
                        /* Simulate the user's actual right-click on her: dispatch
                           a real contextmenu event at a point inside her box and
                           see whether anything opens. This separates a broken
                           handler from a broken hit-test. */
                        const rect = engine.elPet.getBoundingClientRect();
                        const x = Math.round(rect.left + rect.width / 2);
                        const y = Math.round(rect.top + rect.height / 4);
                        const target = document.elementFromPoint(x, y);
                        const hitStyle = target === null ? null : window.getComputedStyle(target);
                        const petStyle = window.getComputedStyle(engine.elPet);
                        const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 2 });
                        const dispatchTarget = target === null ? engine.elPet : target;
                        const notCancelled = dispatchTarget.dispatchEvent(event);
                        await new Promise((resolve) => window.setTimeout(resolve, 150));
                        return {
                          action,
                          point: `${x},${y}`,
                          hitTarget: target === null ? 'none' : `${target.tagName}${target.dataset && target.dataset.kind ? `[${target.dataset.kind}]` : ''}`,
                          hitIsPet: target === engine.elPet,
                          hitIsInsidePet: target !== null && engine.elPet.contains(target),
                          hitPointerEvents: hitStyle === null ? 'n/a' : hitStyle.pointerEvents,
                          petPointerEvents: petStyle.pointerEvents,
                          defaultNotPrevented: notCancelled,
                          menuOpen: engine.state.menuOpen,
                          menuRowCount: document.querySelectorAll('[data-pet-menu] > *').length,
                          visibility: document.visibilityState,
                          hasFocus: document.hasFocus(),
                        };
                      } else if (action === 'clickRow') {
                        /* Click a menu row by its text, through the menu's own
                           listeners: exactly what the user's mouse does. */
                        const wanted = String((input && input.text) || '测试一次扣费效果');
                        engine.openMenu(160, 200);
                        await new Promise((resolve) => window.setTimeout(resolve, 120));
                        const panels = () => Array.from(document.querySelectorAll('[data-pet-menu]'));
                        const findIn = (panel, text) =>
                          panel === undefined ? undefined : Array.from(panel.children).find((node) => node.textContent.includes(text));
                        /* Search the root panel first. A row that opens a submenu
                           does it on hover, the way the desktop drop-downs do, so
                           when the text is not in the root, hover each submenu row
                           until its panel contains it. */
                        let row = findIn(panels()[0], wanted);
                        if (row === undefined) {
                          const opens = Array.from(panels()[0].children).filter((node) => node.textContent.includes('\u25B8'));
                          for (const parent of opens) {
                            parent.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }));
                            await new Promise((resolve) => window.setTimeout(resolve, 140));
                            const sub = findIn(panels()[1], wanted);
                            if (sub !== undefined) {
                              row = sub;
                              break;
                            }
                          }
                        }
                        if (row === undefined) {
                          return {
                            action,
                            found: false,
                            wanted,
                            root: Array.from(panels()[0].children).map((n) => n.textContent).slice(0, 20),
                            sub: panels().length > 1 ? Array.from(panels()[1].children).map((n) => n.textContent) : [],
                          };
                        }
                        const before = { queued: engine.sim.queued, displayed: engine.state.displayed, bowls: engine.sim.bowls.length, radar: engine.state.radarManual };
                        row.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
                        await new Promise((resolve) => window.setTimeout(resolve, 400));
                        return {
                          action,
                          found: true,
                          wanted,
                          before,
                          after: { queued: engine.sim.queued, displayed: engine.state.displayed, bowls: engine.sim.bowls.length, radar: engine.state.radarManual },
                          menuClosed: engine.state.menuOpen === false,
                        };
                      } else if (action === 'refreshCheck') {
                        /* Click the real "立即刷新余额" row and watch the tablet:
                           a plain poll only moves the real balance, so the row
                           looked dead. This checks the displayed number actually
                           jumps to what the server returns. */
                        const before = {
                          displayed: engine.state.displayed,
                          real: engine.state.realBalance,
                          queued: engine.sim.queued,
                        };
                        engine.sim.queued = 5; /* proving the snap also clears the queue */
                        /* Put the tablet deliberately wrong first, or a value that
                           already matches proves nothing about the snap. */
                        if (engine.state.displayed !== null) {
                          engine.state.displayed = engine.state.displayed - 1;
                        }
                        const drifted = engine.state.displayed;
                        engine.openMenu(160, 200);
                        await new Promise((resolve) => window.setTimeout(resolve, 140));
                        const panel = document.querySelector('[data-pet-menu]');
                        const row =
                          panel === null
                            ? undefined
                            : Array.from(panel.children).find((node) => node.textContent.includes('\u7ACB\u5373\u5237\u65B0'));
                        if (row === undefined) {
                          engine.closeMenu();
                          return { action, foundRow: false };
                        }
                        row.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
                        const menuClosed = engine.state.menuOpen === false;
                        await new Promise((resolve) => window.setTimeout(resolve, 900));
                        return {
                          action,
                          foundRow: true,
                          pollCalls: engine.pollCallsForProbe(),
                          menuClosed,
                          before,
                          drifted,
                          after: {
                            displayed: engine.state.displayed,
                            real: engine.state.realBalance,
                            queued: engine.sim.queued,
                            status: engine.state.status,
                            diag: engine.state.diag,
                          },
                          snapped: engine.state.displayed === engine.state.realBalance,
                          readout: (document.querySelector('[data-pet-readout]') || {}).textContent || null,
                        };
                      } else if (action === 'knockCheck') {
                        /* Double-click the pot with real pointer events: it covers
                           her head, so this is the gesture that must knock it off.
                           Two presses on the same point inside DOUBLE_CLICK_MS. */
                        const seatIt = [];
                        if (engine.sim.iron === null || !engine.sim.iron.onHead) {
                          engine.sim.pending = Math.round((engine.sim.pending + 1) * 100) / 100;
                          engine.feedBowlForProbe(engine.dropRiceBowl(1));
                          for (let i = 0; i < 6; i += 1) {
                            await new Promise((resolve) => window.setTimeout(resolve, 110));
                            const pot = engine.sim.iron;
                            seatIt.push(pot === null ? 'gone' : `onHead=${pot.onHead}`);
                            if (pot !== null && pot.onHead) break;
                          }
                        }
                        const pot = engine.sim.iron;
                        if (pot === null || !pot.onHead) {
                          return { action, error: 'the pot never seated', seatIt };
                        }
                        const box = pot.node.getBoundingClientRect();
                        const x = Math.round(box.left + box.width / 2);
                        const y = Math.round(box.top + box.height / 2);
                        /* What the browser actually hit-tests at that point: if it
                           is not the pot, this gesture is being delivered
                           somewhere else and the test would be meaningless. */
                        const hit = document.elementFromPoint(x, y);
                        const hitKind = hit === null ? 'none' : hit === pot.node ? 'pot' : `${hit.tagName}${hit.dataset && hit.dataset.kind ? `[${hit.dataset.kind}]` : ''}`;
                        const press = () =>
                          (hit === null ? pot.node : hit).dispatchEvent(
                            new PointerEvent('pointerdown', {
                              bubbles: true,
                              cancelable: true,
                              button: 0,
                              clientX: x,
                              clientY: y,
                              pointerId: 21,
                              pointerType: 'mouse',
                            }),
                          );
                        press();
                        const afterFirst = engine.sim.iron === null ? 'gone' : `onHead=${engine.sim.iron.onHead} y=${Math.round(engine.sim.iron.y)} vy=${Math.round(engine.sim.iron.vy)}`;
                        /* The two presses must land inside DOUBLE_CLICK_MS. A hidden
                           page is throttled to about 1 Hz, so awaiting even 90 ms
                           here stretched the gap to ~1 s and the "double" click was
                           never a double click. */
                        press();
                        await new Promise((resolve) => window.setTimeout(resolve, 160));
                        const now = engine.sim.iron;
                        return {
                          action,
                          seatIt,
                          point: `${x},${y}`,
                          hitKind,
                          afterFirstPress: afterFirst,
                          afterSecondPress: now === null ? 'gone' : `onHead=${now.onHead} y=${Math.round(now.y)} vy=${Math.round(now.vy)}`,
                          knockProbe: engine.knockProbeForProbe(),
                          frames: engine.frameProbe(),
                          /* Knocked off means it was thrown: the pot the code flies
                             away has a big upward velocity, while one that was merely
                             picked up and released is left with vy = 60. */
                          thrown: now !== null && now.vy < -100,
                        };
                      } else if (action === 'rowCheck') {
                        /* Drive one "自定义…" row through the real menu: open it,
                           hover the submenu that holds the row, click it, answer the
                           dialog, and read back whatever that row is supposed to
                           change. `via` names the submenu label to hover. */
                        const via = String((input && input.via) || '');
                        const value = String((input && input.text) || '200');
                        const readOut = () => ({
                          queued: engine.sim.queued,
                          size: engine.state.size,
                          drawn: engine.sim.petSize,
                          volume: engine.state.volume,
                          store: (() => {
                            try {
                              return window.localStorage.getItem('dsh-balance-pet/v1') || '';
                            } catch {
                              return 'unreadable';
                            }
                          })(),
                        });
                        const before = readOut();
                        engine.openMenu(160, 200);
                        await new Promise((resolve) => window.setTimeout(resolve, 140));
                        const panelsOf = () => Array.from(document.querySelectorAll('[data-pet-menu]'));
                        let row;
                        for (const parent of Array.from(panelsOf()[0].children)) {
                          if (!parent.textContent.includes(via)) continue;
                          parent.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }));
                          await new Promise((resolve) => window.setTimeout(resolve, 160));
                          const sub = panelsOf()[1];
                          if (sub === undefined) break;
                          row = Array.from(sub.children).find((node) => node.textContent.includes('\u81EA\u5B9A\u4E49'));
                          break;
                        }
                        if (row === undefined) {
                          const rootLabels = Array.from(panelsOf()[0].children).map((n) => n.textContent);
                          engine.closeMenu();
                          return { action, via, foundRow: false, rootLabels };
                        }
                        row.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
                        await new Promise((resolve) => window.setTimeout(resolve, 160));
                        const dialog = document.querySelector('[data-pet-dialog]');
                        if (dialog === null) {
                          return { action, via, foundRow: true, dialogOpened: false };
                        }
                        const field = dialog.querySelector('input');
                        const ok = Array.from(dialog.querySelectorAll('button')).find((b) => b.textContent === 'OK');
                        if (field !== null) field.value = value;
                        if (ok !== undefined) ok.click();
                        await new Promise((resolve) => window.setTimeout(resolve, 200));
                        return {
                          action,
                          via,
                          foundRow: true,
                          dialogOpened: true,
                          typed: value,
                          dialogClosed: document.querySelector('[data-pet-dialog]') === null,
                          before,
                          after: readOut(),
                        };
                      } else if (action === 'bowlCheck') {
                        /* Run the top-up flow the way the user does: drop a bowl,
                           then drag it onto her with real pointer events and see
                           whether it is eaten, credited and turned into the pot. */
                        const steps = [];
                        engine.sim.pending = Math.round((engine.sim.pending + 3) * 100) / 100;
                        const bowl = engine.dropRiceBowl(3);
                        const before = engine.state.displayed;
                        const samples = [];
                        for (let i = 0; i < 12; i += 1) {
                          await new Promise((resolve) => window.setTimeout(resolve, 250));
                          const box = bowl.node.getBoundingClientRect();
                          samples.push(`${i}:${Math.round(bowl.x)},${Math.round(bowl.y)} node=${Math.round(box.left)},${Math.round(box.top)} ${Math.round(box.width)}x${Math.round(box.height)} rest=${bowl.rest}`);
                          if (bowl.rest) break;
                        }
                        steps.push(...samples);
                        const box = bowl.node.getBoundingClientRect();
                        const startX = Math.round(box.left + box.width / 2);
                        const startY = Math.round(box.top + box.height / 2);
                        const petRect = engine.elPet.getBoundingClientRect();
                        const endX = Math.round(petRect.left + petRect.width * 0.45);
                        const endY = Math.round(petRect.top + petRect.height * 0.45);
                        const pointer = (type, x, y) => new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, pointerId: 7, pointerType: 'mouse' });
                        bowl.node.dispatchEvent(pointer('pointerdown', startX, startY));
                        steps.push(`after pointerdown dragging=${bowl.dragging}`);
                        window.dispatchEvent(pointer('pointermove', (startX + endX) / 2, (startY + endY) / 2));
                        window.dispatchEvent(pointer('pointermove', endX, endY));
                        window.dispatchEvent(pointer('pointerup', endX, endY));
                        await new Promise((resolve) => window.setTimeout(resolve, 300));
                        steps.push(`after drag: displayed ${before} -> ${engine.state.displayed}, bowls=${engine.sim.bowls.filter((b) => b.kind === 'rice').length}, iron=${engine.sim.iron === null ? 'none' : 'yes'}`);
                        if (engine.sim.bowls.includes(bowl)) {
                          const r = bowl.node.getBoundingClientRect();
                          const petBox = engine.elPet.getBoundingClientRect();
                          steps.push(`diagnose: dragging=${bowl.dragging} bowlRect=${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)} w=${Math.round(bowl.w)} pet=${Math.round(petBox.left)},${Math.round(petBox.top)} ${Math.round(petBox.width)}x${Math.round(petBox.height)}`);
                          steps.push(`diagnose: centre=${Math.round(r.left + r.width / 2)},${Math.round(r.top + r.height / 2)} overPet=${r.left + r.width / 2 > petBox.left - 27 && r.left + r.width / 2 < petBox.right + 27 && r.top + r.height / 2 > petBox.top - 27 && r.top + r.height / 2 < petBox.bottom + 27}`);
                          /* Feed the way a release does, to tell a geometry
                             problem apart from a release-path problem. */
                          engine.sim.bowls = engine.sim.bowls.filter((b) => b !== bowl);
                          engine.feedBowlForProbe(bowl);
                          await new Promise((resolve) => window.setTimeout(resolve, 200));
                          steps.push(`forced feed: displayed=${engine.state.displayed} iron=${engine.sim.iron === null ? 'none' : 'yes'} pending=${engine.sim.pending}`);
                        }
                        return {
                          action,
                          steps,
                          displayed: engine.state.displayed,
                          real: engine.state.realBalance,
                          pending: engine.sim.pending,
                          riceBowls: engine.sim.bowls.filter((b) => b.kind === 'rice').length,
                          iron: engine.sim.iron === null ? null : { onHead: engine.sim.iron.onHead, x: Math.round(engine.sim.iron.x), y: Math.round(engine.sim.iron.y) },
                          potOnHead: engine.sim.iron !== null && engine.sim.iron.onHead,
                        };
                      } else if (action === 'dragCheck') {
                        /* Drag with real pointer events, release, then force a
                           layout sync: a position that does not survive the sync
                           is the "she cannot be moved" bug.
                           `mode: "pot"` presses on the pot instead, which must
                           move the pot and leave her exactly where she was. */
                        const mode = String((input && input.mode) || 'pet');
                        if (mode === 'clear') {
                          /* Put the scene back to idle so the next check starts
                             from a clean state, and send her home: a check that
                             leaves her parked somewhere is a check that changes
                             what the user sees. */
                          for (const stray of engine.sim.bowls.slice()) {
                            if (stray.kind === 'rice') engine.removeBowlForProbe(stray);
                          }
                          engine.sim.iron = null;
                          engine.sim.placed = false;
                          engine.syncLayout();
                          const box = engine.elPet.getBoundingClientRect();
                          const mid = Math.round(box.top + box.height * 0.9);
                          const hit = document.elementFromPoint(Math.round(box.left + box.width / 2), mid);
                          return {
                            action,
                            cleared: true,
                            home: `${Math.round(engine.sim.petX)},${Math.round(engine.sim.petY)}`,
                            homeSetting: engine.state.corner,
                            petState: engine.state.hidden,
                            placed: engine.sim.placed === true,
                            hitAtBody: hit === engine.elPet ? 'pet' : String(hit && hit.tagName),
                          };
                        }
                        const pot = engine.sim.iron;
                        if (mode === 'pot' && (pot === null || !pot.onHead)) {
                          return { action, error: 'the pot is not on her head', pot: pot === null ? 'missing' : `onHead=${pot.onHead}` };
                        }
                        const before = { x: Math.round(engine.sim.petX), y: Math.round(engine.sim.petY) };
                        const potWasX = mode === 'pot' ? pot.x : 0;
                        const potWasY = mode === 'pot' ? pot.y : 0;
                        const target = mode === 'pot' ? pot.node.getBoundingClientRect() : engine.elPet.getBoundingClientRect();
                        /* For the pet, press her body rather than her head: the pot
                           sits over the head and would rightly swallow the press. */
                        const fromX = Math.round(target.left + target.width / 2);
                        const fromY = Math.round(target.top + target.height * (mode === 'pot' ? 0.75 : 0.9));
                        /* Where the pointer lands decides which drag starts. */
                        const hit = document.elementFromPoint(fromX, fromY);
                        const toX = fromX + 320;
                        const toY = fromY - 220;
                        const pointer = (type, x, y) => new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, pointerId: 11, pointerType: 'mouse' });
                        const pressTarget = hit === null ? engine.elPet : hit;
                        pressTarget.dispatchEvent(pointer('pointerdown', fromX, fromY));
                        window.dispatchEvent(pointer('pointermove', fromX + 60, fromY - 40));
                        window.dispatchEvent(pointer('pointermove', toX, toY));
                        window.dispatchEvent(pointer('pointerup', toX, toY));
                        const dropped = { x: Math.round(engine.sim.petX), y: Math.round(engine.sim.petY) };
                        engine.syncLayout();
                        const afterSync = { x: Math.round(engine.sim.petX), y: Math.round(engine.sim.petY) };
                        const home = { x: Math.round(engine.sim.homeX), y: Math.round(engine.sim.homeY) };
                        const potNow = engine.sim.iron;
                        return {
                          action,
                          mode,
                          hitTarget: hit === null ? 'none' : `${hit.tagName}${hit === engine.elPet ? '[pet]' : hit === pot.node ? '[pot]' : `[other cls=${String(hit.className).slice(0, 24)} kind=${hit.dataset ? hit.dataset.kind || '-' : '-'}]`}`,
                          before,
                          dropped,
                          afterSync,
                          home,
                          movedBy: `${dropped.x - before.x},${dropped.y - before.y}`,
                          stuckToDrop: dropped.x === afterSync.x && dropped.y === afterSync.y,
                          atHome: afterSync.x === home.x && afterSync.y === home.y,
                          placed: engine.sim.placed === true,
                          potOnHead: potNow === null ? 'gone' : potNow.onHead,
                          potFrom: pot === null ? 'n/a' : `${Math.round(potWasX)},${Math.round(potWasY)}`,
                          potNow: potNow === null ? 'gone' : `${Math.round(potNow.x)},${Math.round(potNow.y)}`,
                          potMoved: potNow === null || pot === null ? 'n/a' : `${Math.round(potNow.x - potWasX)},${Math.round(potNow.y - potWasY)}`,
                        };
                      } else if (action === 'sizeCheck') {
                        /* Report, set and store the size. The point is to see both
                           the live value and what a reload would restore: a size
                           that is only in memory looks correct until the page is
                           refreshed. */
                        const wanted = Number(input && input.size);
                        const readStore = () => {
                          try {
                            return window.localStorage.getItem('dsh-balance-pet/v1') || '(empty)';
                          } catch {
                            return '(unreadable)';
                          }
                        };
                        const before = { size: engine.state.size, drawn: engine.sim.petSize, store: readStore() };
                        if (Number.isFinite(wanted)) {
                          engine.state.size = wanted;
                          engine.syncLayout();
                          engine.savePrefsForProbe();
                        }
                        await new Promise((resolve) => window.setTimeout(resolve, 150));
                        return {
                          action,
                          before,
                          after: { size: engine.state.size, drawn: engine.sim.petSize, store: readStore() },
                          presets: [340, 454, 624],
                          options: engine.menuModel()
                            .filter((entry) => entry.label === TEXT[engine.state.lang].size)
                            .map((entry) => (entry.children || []).map((child) => `${child.label}${child.check ? ' *' : ''}`))[0],
                        };
                      } else if (action === 'dom') {
                        /* Report the frame's own geometry so a position can be
                           anchored to the real content column and compared with
                           the pet's, instead of estimated from a screenshot. */
                        const rectOf = (selector) => {
                          const node = document.querySelector(selector);
                          if (node === null) return 'none';
                          const rect = node.getBoundingClientRect();
                          return `[${Math.round(rect.left)},${Math.round(rect.top)} ${Math.round(rect.width)}x${Math.round(rect.height)}]`;
                        };
                        const pet = livePet !== null ? livePet : window.__DSH_BALANCE_PET__;
                        /* Candidates for a left-hand anchor: the sidebar and its
                           furniture, plus the account chip, so the default position
                           can be chosen to clear the app's own UI instead of
                           covering it. */
                        const describe = (node) => {
                          const rect = node.getBoundingClientRect();
                          return `${String(node.className).slice(0, 26)}[${Math.round(rect.left)},${Math.round(rect.top)} ${Math.round(rect.width)}x${Math.round(rect.height)}]`;
                        };
                        const leftSide = Array.from(document.querySelectorAll('div'))
                          .map((node) => ({ node, rect: node.getBoundingClientRect() }))
                          .filter((entry) => entry.rect.left <= 20 && entry.rect.height > 300 && entry.rect.width > 100 && entry.rect.width < 420)
                          .slice(0, 6)
                          .map((entry) => describe(entry.node));
                        /* Whatever holds the account chip: the lowest small box in
                           the sidebar. */
                        const accountish = Array.from(document.querySelectorAll('div,button'))
                          .map((node) => ({ node, rect: node.getBoundingClientRect() }))
                          .filter((entry) => entry.rect.left < 280 && entry.rect.top > window.innerHeight - 140 && entry.rect.width > 60 && entry.rect.width < 280 && entry.rect.height > 18 && entry.rect.height < 80)
                          .slice(0, 6)
                          .map((entry) => describe(entry.node));
                        return {
                          action,
                          viewport: `${window.innerWidth}x${window.innerHeight}`,
                          frame: rectOf('[class*="_frame"]'),
                          centerCol: rectOf('[class*="centerCol"]'),
                          viewArea: rectOf('[class*="viewArea"]'),
                          leftSide,
                          accountish,
                          pet:
                            pet === undefined || pet === null
                              ? 'none'
                              : `${Math.round(pet.sim.petX)},${Math.round(pet.sim.petY)} size=${Math.round(pet.sim.petSize)}`,
                          home: pet === undefined || pet === null ? 'none' : `${Math.round(pet.sim.homeX)},${Math.round(pet.sim.homeY)}`,
                        };
                      } else if (action === 'potArt') {
                        /* Measure the pot artwork's visible bounds in the page, where
                           a real image decoder exists. The delivered file is a padded
                           square, so the node has to be sized from the visible pot
                           rather than from the file, or the bowl renders at about
                           half the width the layout assumes. */
                        const url = `${ASSET_URL('iron_bowl.webp')}`;
                        const img = new Image();
                        img.src = url;
                        await new Promise((resolve, reject) => {
                          img.onload = () => resolve();
                          img.onerror = () => reject(new Error('pot art failed to load'));
                        });
                        const surface = document.createElement('canvas');
                        surface.width = img.naturalWidth;
                        surface.height = img.naturalHeight;
                        const paint = surface.getContext('2d');
                        paint.drawImage(img, 0, 0);
                        const data = paint.getImageData(0, 0, surface.width, surface.height).data;
                        let left = surface.width;
                        let right = -1;
                        let top = surface.height;
                        let bottom = -1;
                        for (let y = 0; y < surface.height; y += 1) {
                          for (let x = 0; x < surface.width; x += 1) {
                            const i = (y * surface.width + x) * 4;
                            const a = data[i + 3];
                            const r = data[i];
                            const g = data[i + 1];
                            const b = data[i + 2];
                            /* The art is an opaque white background: the pot is what
                               is neither white nor transparent. */
                            if (a < 24) continue;
                            if (r > 238 && g > 238 && b > 238) continue;
                            if (x < left) left = x;
                            if (x > right) right = x;
                            if (y < top) top = y;
                            if (y > bottom) bottom = y;
                          }
                        }
                        const cw = right - left + 1;
                        const ch = bottom - top + 1;
                        /* Row-by-row opacity, so a boundary that is only partly
                           transparent cannot silently shrink the measured pot. */
                        const rows = [];
                        for (let y = 0; y < surface.height; y += Math.round(surface.height / 26)) {
                          let opaque = 0;
                          let near = 0;
                          let minA = 255;
                          for (let x = 0; x < surface.width; x += 1) {
                            const a = data[(y * surface.width + x) * 4 + 3];
                            if (a > 24) opaque += 1;
                            if (a > 200) near += 1;
                            if (a < minA) minA = a;
                          }
                          if (opaque > 0) rows.push(`y${y}: a>24=${opaque} a>200=${near} minA=${minA}`);
                        }
                        return {
                          action,
                          file: `${img.naturalWidth}x${img.naturalHeight}`,
                          contentBox: `${left},${top} ${cw}x${ch}`,
                          contentAspect: Number((ch / cw).toFixed(4)),
                          visibleHeightFraction: Number((ch / img.naturalHeight).toFixed(4)),
                          rows: rows.slice(0, 26),
                        };
                      } else if (action === 'headProfile') {
                        /* How wide is her hair at each row near the top? A pot can
                           only rest where the hair is at least as wide as the pot,
                           so this is what decides whether the tuft can show above a
                           rim without the pot floating. */
                        const img = engine.elPet.firstChild;
                        if (img === null || img.naturalWidth === 0) return { action, error: 'sprite not loaded' };
                        const surface = document.createElement('canvas');
                        surface.width = img.naturalWidth;
                        surface.height = img.naturalHeight;
                        const paint = surface.getContext('2d');
                        paint.drawImage(img, 0, 0);
                        const data = paint.getImageData(0, 0, surface.width, surface.height).data;
                        const scale = 1024 / img.naturalWidth;
                        const rows = [];
                        for (let row = 0; row <= 400; row += 20) {
                          const y = Math.min(surface.height - 1, Math.round(row / scale));
                          let left = -1;
                          let right = -1;
                          for (let x = 0; x < surface.width; x += 1) {
                            if (data[(y * surface.width + x) * 4 + 3] <= 24) continue;
                            if (left < 0) left = x;
                            right = x;
                          }
                          if (left < 0) continue;
                          rows.push(`${row}: ${Math.round((right - left) * scale)}`);
                        }
                        return {
                          action,
                          sprite: `${img.naturalWidth}x${img.naturalHeight}`,
                          potWidthPx: Math.round(engine.sim.petSize * 0.66),
                          hairWidthByRow: rows,
                        };
                      } else if (action === 'lockCheck') {
                        /* Drop a bowl and just watch: it should sit until its wait
                           reaches BOWL_WAIT, then lock, then be drawn in. This is
                           the only way to see the countdown's constant actually
                           driving the simulation rather than only the label. */
                        engine.sim.pending = Math.round((engine.sim.pending + 1) * 100) / 100;
                        const watching = engine.dropRiceBowl(1);
                        const trace = [];
                        for (let i = 0; i < 22; i += 1) {
                          await new Promise((resolve) => window.setTimeout(resolve, 260));
                          const alive = engine.sim.bowls.includes(watching);
                          trace.push(
                            `${(i * 0.26).toFixed(2)}s alive=${alive} rest=${watching.rest} wait=${watching.wait.toFixed(1)} locked=${watching.locked} sucking=${watching.sucking}`,
                          );
                          if (!alive) break;
                        }
                        return {
                          action,
                          bowlWaitSeconds: 5,
                          trace,
                          eaten: engine.sim.bowls.includes(watching) === false,
                          displayed: engine.state.displayed,
                        };
                      } else if (action === 'faceCheck') {
                        /* Charge once and read the expression layer at each moment:
                           this is what tells "the reaction is gone" apart from "the
                           pot is on her head, so the rule says calm". */
                        const readFace = () => {
                          const on = [];
                          for (const node of engine.elPet.querySelectorAll('img')) {
                            const name = String(node.src).split('/').pop();
                            if (!name.startsWith('expression_')) continue;
                            if (node.style.opacity === '1') on.push(name.replace('expression_', '').replace('.png', ''));
                          }
                          return on.length === 0 ? 'none' : on.join('+');
                        };
                        const seen = [`idle: ${readFace()}`];
                        void input;
                        engine.sim.queued += 1;
                        engine.sim.cueT = 0;
                        engine.notify();
                        for (let i = 0; i < 7; i += 1) {
                          await new Promise((resolve) => window.setTimeout(resolve, 110));
                          seen.push(
                            `${((i + 1) * 0.11).toFixed(2)}s face=${readFace()} queued=${engine.sim.queued} nervousT=${engine.sim.nervousT.toFixed(2)}`,
                          );
                        }
                        return {
                          action,
                          ironOnHead: engine.sim.iron !== null && engine.sim.iron.onHead,
                          riceBowls: engine.sim.bowls.filter((b) => b.kind === 'rice').length,
                          seen,
                          /* Any throw the frame loop has swallowed, and the page's
                             own collected errors: a broken render is the one thing
                             that stops the expression layers from updating. */
                          renderError: engine.renderErrorForProbe(),
                          pageErrors: watch.errors.slice(-6),
                        };
                      } else if (action === 'dialogCheck') {
                        /* Drive the custom-amount dialog the way a person does:
                           open it, type a number, press OK. window.prompt used to
                           return null here, which is why every 自定义… row did
                           nothing, so this checks the replacement end to end. */
                        const typed = String((input && input.text) || '2.5');
                        let answer;
                        try {
                          answer = engine.customInputForProbe('amount', '3');
                        } catch (error) {
                          return { action, opened: false, threw: error instanceof Error ? `${error.name}: ${error.message}` : String(error) };
                        }
                        await new Promise((resolve) => window.setTimeout(resolve, 120));
                        const root = document.querySelector('[data-pet-dialog]');
                        if (root === null) {
                          return { action, opened: false, error: 'no [data-pet-dialog] in the DOM' };
                        }
                        const field = root.querySelector('input');
                        const buttons = Array.from(root.querySelectorAll('button'));
                        const shape = {
                          opened: true,
                          hasField: field !== null,
                          buttons: buttons.map((b) => b.textContent),
                          fieldValue: field === null ? null : field.value,
                          focused: document.activeElement === field,
                        };
                        if (field !== null) {
                          field.value = typed;
                          field.dispatchEvent(new Event('input', { bubbles: true }));
                        }
                        const ok = buttons.find((b) => b.textContent === 'OK');
                        if (ok !== undefined) ok.click();
                        const resolved = await answer;
                        /* Feed the answered value into the same path the menu row
                           uses, so the check covers "answer drives the simulation"
                           and not just "the box returns a number". */
                        if (resolved !== null && resolved > 0) engine.topUpForProbe(resolved);
                        await new Promise((resolve) => window.setTimeout(resolve, 80));
                        return {
                          action,
                          ...shape,
                          typed,
                          resolved,
                          parsedOk: resolved === Number.parseFloat(typed),
                          closed: document.querySelector('[data-pet-dialog]') === null,
                          pending: engine.sim.pending,
                          riceBowls: engine.sim.bowls.filter((b) => b.kind === 'rice').length,
                        };
                      } else if (action === 'potCheck') {
                        /* Put the pot on her head (feeding seats it), let it
                           settle, measure where it lands against the measured
                           crown, then drop a rice bowl on it to see whether the
                           lid deflects it. */
                        const seat = [];
                        for (let attempt = 0; attempt < 2; attempt += 1) {
                          engine.sim.pending = Math.round((engine.sim.pending + 1) * 100) / 100;
                          engine.feedBowlForProbe(engine.dropRiceBowl(1));
                          for (let i = 0; i < 3; i += 1) {
                            await new Promise((resolve) => window.setTimeout(resolve, 90));
                            const iron = engine.sim.iron;
                            if (iron === null) break;
                            const head = engine.headRectForProbe();
                            seat.push(
                              `try${attempt}.${i}: y=${Math.round(iron.y)} x=${Math.round(iron.x)} w=${Math.round(iron.w)} h=${Math.round(iron.h)}` +
                                ` vy=${Math.round(iron.vy)} ang=${iron.angle.toFixed(3)} onHead=${iron.onHead}` +
                                ` headX=${Math.round(head.x0)}..${Math.round(head.x1)} headY=${Math.round(head.y0)}..${Math.round(head.y1)}` +
                                ` foot=${Math.round(iron.y + iron.h * 0.86)} centre=${Math.round(iron.x + iron.w / 2)}`,
                            );
                            if (iron.onHead) break;
                          }
                          if (engine.sim.iron !== null && engine.sim.iron.onHead) break;
                        }
                        const iron = engine.sim.iron;
                        if (iron === null || !iron.onHead) return { action, error: 'the pot is not on her head', iron: iron === null ? null : iron.onHead, seat };
                        if (String((input && input.mode) || '') === 'seatOnly') {
                          return { action, seated: true, seat: seat.slice(-2), pot: `${Math.round(iron.x)},${Math.round(iron.y)}` };
                        }
                        const box = iron.node.getBoundingClientRect();
                        const petBox = engine.elPet.getBoundingClientRect();
                        const scale = engine.sim.scale;
                        /* The anchor the original measures from: her sprite's
                           top-left plus (0.5558 w, 0.3639 w). */
                        const anchorX = engine.sim.petX + engine.sim.petSize * 0.5558;
                        const anchorY = engine.sim.petY + engine.sim.petSize * 0.281;
                        /* She is drawn squashed about her feet, so a sprite row
                           sits higher on screen than petY + row*scale. */
                        const drawnBottom = petBox.top + petBox.height;
                        const spriteRow = (row) =>
                          Math.round(drawnBottom - (petBox.height - (row * engine.sim.petSize) / 1024) * 0.9);
                        const eyeY = spriteRow(430);
                        const crownY = spriteRow(156);
                        const rimY = box.bottom - box.height * 0.42;
                        const placed = {
                          potCentreX: Math.round(box.left + box.width / 2),
                          anchorX: Math.round(anchorX),
                          offBy: Math.round(box.left + box.width / 2 - anchorX),
                          potRimY: Math.round(rimY),
                          anchorY: Math.round(anchorY),
                          rimAboveEyesBy: Math.round(eyeY - rimY),
                          rimBelowCrownBy: Math.round(rimY - crownY),
                          potWidthRatio: Number((box.width / engine.sim.petSize).toFixed(4)),
                          /* What the browser actually painted for the pot: the node's
                             box, the inner <img>'s box, and the image's intrinsic
                             size. These three disagreeing is the whole bug. */
                          potNode: `${Math.round(iron.node.getBoundingClientRect().width)}x${Math.round(iron.node.getBoundingClientRect().height)}`,
                          potCss: `${iron.node.style.width}x${iron.node.style.height}`,
                          potImg: (() => {
                            const img = iron.node.firstChild;
                            if (img === null) return 'none';
                            const r = img.getBoundingClientRect();
                            return `${Math.round(r.width)}x${Math.round(r.height)} natural=${img.naturalWidth}x${img.naturalHeight} clip=${img.style.clipPath || 'none'} src=${String(img.src).slice(0, 24)}`;
                          })(),
                          potCropped: engine.potCropState(),
                          /* Which expression layer is actually showing, so a missing
                             reaction is a number rather than an impression. */
                          expression: {
                            showing: (() => {
                              const on = [];
                              for (const node of engine.elPet.querySelectorAll('img')) {
                                const name = String(node.src).split('/').pop();
                                if (!name.startsWith('expression_')) continue;
                                if (node.style.opacity === '1') on.push(name.replace('expression_', '').replace('.png', ''));
                              }
                              return on.length === 0 ? 'none' : on.join('+');
                            })(),
                            ironOnHead: engine.sim.iron !== null && engine.sim.iron.onHead,
                            riceBowls: engine.sim.bowls.filter((b) => b.kind === 'rice').length,
                            queued: engine.sim.queued,
                            nervousT: Number(engine.sim.nervousT.toFixed(2)),
                            bowlWaitBasis: Number(engine.sim.bowlWaitBasis.toFixed(2)),
                          },
                          /* Does the ahoge clear the pot? Her topmost hair sits in
                             sprite rows 0..80 and the pot's rim is the bar that can
                             hide it, so the useful number is how much of the tuft
                             shows above the rim's TOP edge on screen. */
                          ahoge: (() => {
                            const img = engine.elPet.firstChild;
                            let tip = 0;
                            let top = 0;
                            if (img !== null && img.naturalHeight > 0) {
                              /* Sprite rows, squashed about her feet like the
                                 rendered pet, then converted to screen y. */
                              const drawnBottom = petBox.top + petBox.height;
                              const rowY = (row) =>
                                drawnBottom - (petBox.height - (row * engine.sim.petSize) / img.naturalHeight) * 0.9;
                              tip = Math.round(rowY(0));
                              top = Math.round(rowY(124));
                            }
                            const potTop = Math.round(box.top);
                            return {
                              tipY: tip,
                              crownY: top,
                              potTopY: potTop,
                              tuftAbovePotBy: tip - potTop,
                              hidden: potTop <= tip,
                            };
                          })(),
                          potRollDeg: Number(((iron.angle * 180) / Math.PI).toFixed(2)),
                          petDrawn: `${Math.round(petBox.width)}x${Math.round(petBox.height)}`,
                          petTransform: engine.elPet.style.transform,
                          /* Layering: props must paint in front of her, and a
                             seated pot in front of everything of hers. */
                          layers: {
                            petZ: window.getComputedStyle(engine.elPet).zIndex,
                            propsZ: window.getComputedStyle(iron.node.parentElement).zIndex,
                            potZ: window.getComputedStyle(iron.node).zIndex,
                            floatersZ: window.getComputedStyle(engine.elFloaters).zIndex,
                            petAboveProps: false,
                          },
                          potDrawn: `${Math.round(box.width)}x${Math.round(box.height)}`,
                          rimOffBy: Math.round(rimY - anchorY),
                          potSize: `${Math.round(box.width)}x${Math.round(box.height)}`,
                          pet: `${Math.round(petBox.width)}x${Math.round(petBox.height)}`,
                          scale: Number(scale.toFixed(4)),
                        };
                        /* Drop a bowl straight onto the pot from above. */
                        engine.sim.pending = Math.round((engine.sim.pending + 1) * 100) / 100;
                        const falling = engine.dropRiceBowlsOnPotForProbe();
                        const track = [];
                        for (let i = 0; i < 5; i += 1) {
                          await new Promise((resolve) => window.setTimeout(resolve, 80));
                          track.push(`${Math.round(falling.x)},${Math.round(falling.y)} vy=${Math.round(falling.vy)}`);
                          if (falling.hitLid !== undefined) break;
                        }
                        return {
                          action,
                          placed,
                          deflected: falling.hitLid !== undefined,
                          bouncedSideways: Math.abs(falling.vx) > 50,
                          heading: falling.vx === 0 ? 'straight' : falling.vx < 0 ? 'left' : 'right',
                          track,
                          eaten: engine.sim.bowls.includes(falling) === false,
                          displayed: engine.state.displayed,
                          seat: seat.slice(-6),
                        };
                      } else if (action === 'probe') {
                        /* Structural report: what the slot actually handed this
                           component, so a render that produces nothing is visible. */
                        const walk = (node, depth, out) => {
                          if (node === null || depth > 3) return out;
                          out.push(`${'  '.repeat(depth)}${node.tagName.toLowerCase()}${node.getAttribute && node.getAttribute('data-pet-readout') !== null ? '[readout]' : ''} children=${node.children.length}`);
                          for (const child of node.children) walk(child, depth + 1, out);
                          return out;
                        };
                        const pet = window.__DSH_BALANCE_PET__;
                        const chain = [];
                        if (pet !== undefined && pet !== null) {
                          for (let node = pet.elPet; node !== null && chain.length < 12; node = node.parentElement) {                            const style = window.getComputedStyle(node);
                            const rect = node.getBoundingClientRect();
                            chain.push({
                              tag: node.tagName.toLowerCase(),
                              cls: String(node.className).slice(0, 40),
                              position: style.position,
                              transform: style.transform === 'none' ? 'none' : style.transform.slice(0, 40),
                              filter: style.filter,
                              contain: style.contain,
                              overflow: style.overflow,
                              zIndex: style.zIndex,
                              opacity: style.opacity,
                              visibility: style.visibility,
                              display: style.display,
                              rect: `${Math.round(rect.left)},${Math.round(rect.top)} ${Math.round(rect.width)}x${Math.round(rect.height)}`,
                            });
                          }
                        }
                        const happy = document.querySelectorAll('img')[11];
                        const frameAncestor = pet ? pet.elPet.parentElement : null;
                        /* Where the browser actually puts the tablet text: the
                           transformed element's box, and what is hit-tested at
                           that point. A non-zero box whose centre hit-tests to
                           something else means the text is painted elsewhere. */
                        let readoutProbe = null;
                        if (pet) {
                          const readout = pet.elPet.querySelector('[data-pet-readout]');
                          if (readout) {
                            const rect = readout.getBoundingClientRect();
                            const petRect = pet.elPet.getBoundingClientRect();
                            const kids = Array.from(readout.children).map((child) => {
                              const box = child.getBoundingClientRect();
                              return `${child.textContent}:${Math.round(box.left)},${Math.round(box.top)} ${Math.round(box.width)}x${Math.round(box.height)}`;
                            });
                            const style = window.getComputedStyle(readout);
                            const hit = document.elementFromPoint(Math.round(rect.left + rect.width / 2), Math.round(rect.top + rect.height / 2));
                            /* Where the tablet panel actually is, so the readout can be
                               compared against it rather than guessed at. */
                            const s = pet.sim.scale;
                            const quad = [[600, 699], [940, 645], [940, 867], [600, 921]].map(([x, y]) => [x * s, y * s]);
                            const panelLeft = Math.min(...quad.map((p) => p[0])) + petRect.left;
                            const panelRight = Math.max(...quad.map((p) => p[0])) + petRect.left;
                            const panelTop = Math.min(...quad.map((p) => p[1])) + petRect.top;
                            const panelBottom = Math.max(...quad.map((p) => p[1])) + petRect.top;
                            const textLeft = Math.min(...Array.from(readout.children).map((c) => c.getBoundingClientRect().left).filter((v) => v > 0));
                            const textRight = Math.max(...Array.from(readout.children).map((c) => c.getBoundingClientRect().right));
                            readoutProbe = {
                              box: `${Math.round(rect.left)},${Math.round(rect.top)} ${Math.round(rect.width)}x${Math.round(rect.height)}`,
                              children: kids,
                              fontSize: style.fontSize,
                              visibility: style.visibility,
                              hit: hit === null ? 'none' : `${hit.tagName}${hit.getAttribute('data-pet-readout') !== null ? '[readout]' : ''}`,
                              panel: `${Math.round(panelLeft)},${Math.round(panelTop)}..${Math.round(panelRight)},${Math.round(panelBottom)}`,
                              panelCentreX: Math.round((panelLeft + panelRight) / 2),
                              panelCentreY: Math.round((panelTop + panelBottom) / 2),
                              textCentreX: Math.round((textLeft + textRight) / 2),
                              offsetFromPanelCentre: `${Math.round((textLeft + textRight) / 2 - (panelLeft + panelRight) / 2)},${Math.round(rect.top + rect.height / 2 - (panelTop + panelBottom) / 2)}`,
                            };
                          }
                        }
                        return {
                          action,
                          engineGlobal: typeof window.__DSH_BALANCE_PET__,
                          readoutNodes: document.querySelectorAll('[data-pet-readout]').length,
                          menuNodes: document.querySelectorAll('[data-pet-menu]').length,
                          imgCount: document.querySelectorAll('img').length,
                          readoutProbe,
                          /* The question that keeps mattering: is the engine's DOM
                             still inside the document, or did a re-render detach it? */
                          connected: {
                            pet: pet ? document.body.contains(pet.elPet) : null,
                            readout: pet ? document.body.contains(pet.elPet.querySelector('[data-pet-readout]')) : null,
                            canvas: pet ? document.body.contains(pet.canvas) : null,
                            frame: frameAncestor !== null ? document.body.contains(frameAncestor) : null,
                            frameChildren: frameAncestor === null ? -1 : frameAncestor.children.length,
                            frameTags: frameAncestor === null ? '' : Array.from(frameAncestor.children).map((n) => n.tagName).join(','),
                          },
                          petImages: pet ? Array.from(pet.elPet.querySelectorAll('img')).map((img) => `${img.src.split('/').pop()}:${img.naturalWidth}x${img.naturalHeight}:o${img.style.opacity}`) : [],
                          petRect: pet ? JSON.stringify(pet.elPet.getBoundingClientRect()) : null,
                          petComputed: pet ? {
                            position: window.getComputedStyle(pet.elPet).position,
                            zIndex: window.getComputedStyle(pet.elPet).zIndex,
                            transform: pet.elPet.style.transform,
                            spriteOpacity: happy ? happy.style.opacity : 'n/a',
                            spriteRect: happy ? JSON.stringify(happy.getBoundingClientRect()) : 'n/a',
                            spritePos: happy ? window.getComputedStyle(happy).position : 'n/a',
                          } : null,
                          ancestorChain: chain,
                        };
                      } else {
                        throw new Error(`unknown pet action "${action}"`);
                      }
                      /* React repaints on its own schedule: let it land before the
                         DOM is read back, otherwise the menu always reads empty. */
                      await new Promise((resolve) => window.setTimeout(resolve, 350));
                      const rows = document.querySelectorAll('[data-pet-menu] > *');
                      const menuText = Array.from(rows).map((node) => node.textContent).join('|');
                      const bowls = engine.sim.bowls.map((entry) => ({ kind: entry.kind, x: Math.round(entry.x), y: Math.round(entry.y) }));
                      const floaters = Array.from(document.querySelectorAll('div'))
                        .filter((node) => node.textContent.trim().startsWith('-') && String(node.style.transform).includes('translate3d'))
                        .map((node) => node.textContent.trim());
                      const imageList = document.querySelectorAll('img');
                      return {
                        action,
                        menuOpen: engine.state.menuOpen,
                        renders: watch.renders || 0,
                        menuRowCount: rows.length,
                        menuText: menuText.slice(0, 240),
                        queued: engine.sim.queued,
                        displayed: engine.state.displayed,
                        bowls,
                        floaters,
                        flashOpacity: imageList.length > 4 ? imageList[4].style.opacity : 'n/a',
                        readout: (document.querySelector('[data-pet-readout]') || {}).textContent || null,
                      };
                    }
                    if (method !== 'getStatus') throw new Error(`unknown PetStatus method "${method}"`);
                    const images = Array.from(document.querySelectorAll('img')).map((img) => ({
                      src: String(img.src).split('/').pop(),
                      ok: img.complete && img.naturalWidth > 0,
                      natural: `${img.naturalWidth}x${img.naturalHeight}`,
                      opacity: img.style.opacity || '1',
                    }));
                    const readout = document.querySelector('[data-pet-readout]');
                    const centre = document.elementFromPoint(Math.round(window.innerWidth / 2), Math.round(window.innerHeight / 2));
                    const chain = [];
                    for (let node = centre; node !== null && chain.length < 6; node = node.parentElement) {
                      const rect = node.getBoundingClientRect();
                      chain.push(`${node.tagName.toLowerCase()}.${String(node.className).slice(0, 24)}[${Math.round(rect.left)},${Math.round(rect.top)} ${Math.round(rect.width)}x${Math.round(rect.height)}]`);
                    }
                    return Promise.resolve({
                      moduleLoaded: watch.loaded,
                      renders: watch.renders || 0,
                      elapsedMs: Date.now() - watch.started,
                      viewport: { w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio },
                      petBox: (() => {
                        const engine = livePet !== null ? livePet : window.__DSH_BALANCE_PET__;
                        if (engine === undefined || engine === null) return null;
                        const rect = engine.elPet.getBoundingClientRect();
                        return { left: Math.round(rect.left), top: Math.round(rect.top), width: Math.round(rect.width), height: Math.round(rect.height), bottom: Math.round(rect.bottom), styleTransform: engine.elPet.style.transform };
                      })(),
                      elementAtCentre: chain,
                      engine: engineInfo(),
                      images,
                      readout: readout === null ? null : readout.textContent,
                      errors: watch.errors.slice(-8),
                      hostReport: watch.status,
                    });
                  },
                }),
              'dsh-balance-pet: PetStatus inspect provider',
            );
          }
        } catch {
          /* an inspect registration failure must never break the pet */
        }

        ctx.slots.inject('shell.overlay', () =>
          ctx.slots.register(
            {
              name: 'shell.overlay',
              id: 'dsh-balance-pet',
              order: 60,
              /* The owner re-reads this thunk on every projection, so the engine's
                 live state is readable from outside through the slot listing. It
                 is the fallback channel for when the Inspect provider is not
                 available on the page: a size that silently stays wrong is
                 impossible to tell apart from a size that cannot be set. */
              label: () => {
                const engine = livePet !== null ? livePet : window.__DSH_BALANCE_PET__;
                if (engine === undefined || engine === null) return 'dsh-balance-pet: idle';
                return `dsh-balance-pet: size=${engine.state.size} drawn=${Math.round(engine.sim.petSize)} x=${Math.round(engine.sim.petX)} y=${Math.round(engine.sim.petY)}`;
              },
            },
            function PetRoot() {
              return h(PetBoundary, { child: h(PetOverlay, null) });
            },
          ),
        );
      },
    };
  },
});

