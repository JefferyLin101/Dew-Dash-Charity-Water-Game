/* =========================================================
   Dew Dash — a three-lane runner inspired by charity: water
   ---------------------------------------------------------
   How the code is organized (top to bottom):
     1. Settings you can tweak (speed, spawn rates, jump)
     2. Difficulty levels (Easy / Normal / Hard)
     3. Checkpoints (how the droplet levels up over many runs)
        + Milestone messages during a run
     4. Facts the droplet shares on the home screen
     5. Saved stats (Current Progress, High Scores, Last Score, sound setting)
        + Sound effects
     6. Game state + screen layout / perspective math
     7. Spawning drops, obstacles, buckets, and scenery
     8. Game flow (start, run, die, game over, pause, checkpoints)
     9. Drawing everything on the canvas
    10. Controls (keyboard + swipe) and the main loop

   Rubric items are marked with "RUBRIC:" comments so they're easy to find.
   ========================================================= */

(() => {
  'use strict';

  /* ---------- 1. Settings ---------- */

  const CONFIG = {
    acceleration: 0.33,     // speed added every second
    viewDistance: 110,      // how far ahead things appear
    camDepth: 9,            // perspective strength (bigger = flatter road)

    // Gap between obstacle rows, in SECONDS, so the player always gets reaction time.
    // Each value is [start of run, 75 s in]; the game slides from one to the other.
    // The difficulty's obstacleGap multiplies these.
    rowGapMin: [0.95, 0.5],
    rowGapExtra: [0.6, 0.35],

    firstBucketAfter: 7.5,  // seconds into the run

    dropSpacing: 2.8,       // distance between drops in a line
    dropLine: [5, 10],      // how many drops in a line
    dropGap: [5, 12],       // empty track between lines

    jumpHeight: 150,        // in "u" units (1u = 1/120 of a lane's width)
    jumpTime: 0.62,         // seconds in the air
    laneSwitchSpeed: 9,     // lanes per second
  };

  /* ---------- 2. Difficulty levels ---------- */
  // RUBRIC: Difficulty Modes. Each level changes the rules of a run, not just the speed.
  //   startSpeed / maxSpeed: how fast the run starts and the fastest it can get.
  //   obstacleGap: multiplies the time between obstacle rows (above 1 = fewer obstacles, below 1 = more).
  //   doubleObstacleChance: chance a row blocks two lanes, at the start of a run and 75 s in.
  //   firstObstacleAt: free running room before the first obstacle.
  //   bucketEvery: seconds between buckets (more buckets = less risk carrying water).
  //   dropValue: how much Water Size each drop adds.
  //   shields: hits you can survive. A shield pops instead of ending the run,
  //            but you still spill the water you were carrying.
  const DIFFICULTIES = {
    easy: {
      label: 'Easy', note: 'Slower · fewer obstacles · more buckets · 1-hit shield',
      startSpeed: 13, maxSpeed: 34, obstacleGap: 1.35, doubleObstacleChance: [0.05, 0.3], firstObstacleAt: 60,
      bucketEvery: [6, 10], dropValue: 1, shields: 1,
    },
    normal: {
      label: 'Normal', note: 'Standard speed, obstacles, and buckets',
      startSpeed: 17, maxSpeed: 42, obstacleGap: 1, doubleObstacleChance: [0.12, 0.45], firstObstacleAt: 45,
      bucketEvery: [9, 15], dropValue: 1, shields: 0,
    },
    hard: {
      label: 'Hard', note: 'Faster · more obstacles · fewer buckets · drops worth 2',
      startSpeed: 22, maxSpeed: 50, obstacleGap: 0.8, doubleObstacleChance: [0.2, 0.55], firstObstacleAt: 35,
      bucketEvery: [12, 18], dropValue: 2, shields: 0,
    },
  };

  /* ---------- 3. Checkpoints ---------- */
  // Current Progress (every point ever stored in a bucket) unlocks these.
  // Each one makes the droplet a little bigger and adds to how it looks.
  // The looks stack: a River droplet also has the sweatband, shoes, and eyebrows.
  const CHECKPOINTS = [
    { at: 0,    name: 'Dewdrop',    unlock: 'Where every droplet starts',           scale: 1.00 },
    { at: 50,   name: 'Droplet',    unlock: 'A yellow sweatband',                   scale: 1.04 },
    { at: 150,  name: 'Splash',     unlock: 'Running shoes',                        scale: 1.08 },
    { at: 400,  name: 'Stream',     unlock: 'Game-face eyebrows and a water trail', scale: 1.11 },
    { at: 1000, name: 'River',      unlock: 'Stronger arms and a ripple aura',      scale: 1.14 },
    { at: 2500, name: 'Wellspring', unlock: 'A golden glow',                        scale: 1.18 },
  ];

  function tierFor(progress) {
    let tier = 0;
    CHECKPOINTS.forEach((cp, i) => { if (progress >= cp.at) tier = i; });
    return tier;
  }

  // Where the player sits between two checkpoints (used by the progress bars)
  function progressInfo(progress) {
    const tier = tierFor(progress);
    const cur = CHECKPOINTS[tier];
    const next = CHECKPOINTS[tier + 1];
    if (!next) return { tier, pct: 100, caption: `${cur.name} · Every checkpoint reached` };
    return {
      tier,
      pct: ((progress - cur.at) / (next.at - cur.at)) * 100,
      caption: `${cur.name} · ${fmt(next.at - progress)} to ${next.name}`,
    };
  }

  /* ---------- Milestone messages during a run ---------- */
  // RUBRIC: Track and Display Milestones. checkMilestones() loops over this array after
  // every drop and bucket and shows each message once per run when its condition is met.
  //   type 'score': Total Score (water stored this run) has reached `at`
  //   type 'water': Water Size (water carried but not stored) has reached `at` (a warning)
  const MILESTONES = [
    { type: 'score', at: 10,  text: '10 stored! Nice start.' },
    { type: 'score', at: 25,  text: '25 stored! Keep it flowing.' },
    { type: 'score', at: 50,  text: '50 stored! Halfway to 100.' },
    { type: 'score', at: 100, text: '100 stored! Clean water hero.' },
    { type: 'score', at: 200, text: '200 stored! Unstoppable.' },
    { type: 'water', at: 15,  text: 'Carrying 15 drops. Find a bucket before you spill!' },
    { type: 'water', at: 30,  text: '30 drops at risk! Get to a bucket!' },
  ];

  /* ---------- 4. Facts (tap the droplet on the home screen) ---------- */
  // The charity: water impact numbers change over time. These were checked on charitywater.org in October 2026.
  const FACTS = [
    { text: 'Nearly 1 in 10 people in the world live without clean water.', source: 'JMP 2024, via charity: water' },
    { text: 'Illness from dirty water takes more lives each year than all forms of violence, war included.', source: 'UNICEF 2019, via charity: water' },
    { text: 'For kids under five, illness from unsafe water and poor sanitation is over 20 times deadlier than conflict.', source: 'UNICEF 2019, via charity: water' },
    { text: 'In 8 out of 10 homes where water has to be fetched, women and girls are the ones who carry it.', source: 'JMP 2022, via charity: water' },
    { text: 'Every $1 put into clean water and sanitation brings back about $4.30 in economic returns.', source: 'WHO 2012, via charity: water' },
    { text: '100% of public donations to charity: water go to water projects. Private donors pay for operating costs.', source: 'charitywater.org' },
    { text: 'charity: water proves every project it funds with photos and GPS coordinates.', source: 'charitywater.org' },
    { text: 'charity: water has funded over 200,000 water projects in 29 countries, including India.', source: 'charitywater.org' },
    { text: 'Projects funded by charity: water will serve more than 21 million people.', source: 'charitywater.org' },
    { text: 'About $20 a month can bring clean water to six people, a whole family, every year.', source: 'charitywater.org' },
  ];

  /* ---------- 5. Saved stats ---------- */

  const STORE_KEY = 'dewdash-stats-v1';

  function loadStats() {
    const s = {
      progress: 0,                              // Current Progress: every point ever stored
      high: { easy: 0, normal: 0, hard: 0 },    // High Score for each difficulty
      last: 0,                                  // Last Score
      lastDifficulty: 'normal',
      runs: 0,
      difficulty: 'normal',                     // the difficulty picked on the home screen
      sound: true,                              // sound effects on or off
    };
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (!raw) return s;
      const d = JSON.parse(raw);
      s.progress = +d.progress || 0;
      s.last = +d.last || 0;
      s.runs = +d.runs || 0;
      // Saves from before difficulties existed had one high score; those runs were Normal
      if (typeof d.high === 'number') s.high.normal = d.high;
      else if (d.high) for (const k of Object.keys(s.high)) s.high[k] = +d.high[k] || 0;
      if (DIFFICULTIES[d.difficulty]) s.difficulty = d.difficulty;
      if (DIFFICULTIES[d.lastDifficulty]) s.lastDifficulty = d.lastDifficulty;
      s.sound = d.sound !== false;
    } catch (e) { /* storage blocked (private window etc.) — play without saving */ }
    return s;
  }

  function saveStats() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(stats)); } catch (e) { /* ignore */ }
  }

  const stats = loadStats();

  /* ---------- Small helpers ---------- */

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const rand = (a, b) => a + Math.random() * (b - a);
  const randInt = (a, b) => Math.floor(rand(a, b + 1));
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const fmt = (n) => Math.round(n).toLocaleString();
  const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
  const lowerFirst = (s) => s.charAt(0).toLowerCase() + s.slice(1);

  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  // Seeded random numbers so the distant skyline doesn't reshuffle when the window resizes
  function seeded(seed) {
    return () => {
      seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Color helpers: mixColor('#ff0000', '#0000ff', 0.5) -> 'rgb(128,0,128)'
  const rgbCache = new Map();
  function toRgb(hex) {
    if (!rgbCache.has(hex)) {
      const n = parseInt(hex.slice(1), 16);
      rgbCache.set(hex, [(n >> 16) & 255, (n >> 8) & 255, n & 255]);
    }
    return rgbCache.get(hex);
  }
  function mixColor(a, b, t, mult = 1) {
    const A = toRgb(a), B = toRgb(b);
    const c = (i) => Math.round(clamp(lerp(A[i] * mult, B[i], t), 0, 255));
    return `rgb(${c(0)},${c(1)},${c(2)})`;
  }

  // charity: water brand colors (2016 brand book): primary yellow + blue, plus the secondary set
  const BRAND = {
    yellow: '#FFC907',
    blue: '#2E9DF7',
    teal: '#8BD1CB',
    green: '#4FCB53',
    orange: '#FF902A',
    red: '#F5402C',
    darkGreen: '#159A48',
    pink: '#F16061',
    ink: '#15130F',
  };

  /* ---------- Sound effects ---------- */
  // RUBRIC: Sound Effect. Every sound is generated with the Web Audio API, so there are
  // no audio files to download. Browsers only allow sound after the player clicks or
  // presses a key, so the audio engine starts on the first click/tap/keypress.
  const Sound = (() => {
    let ac = null;
    let master = null;
    let enabled = stats.sound;

    function ensure() {
      if (!ac) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        ac = new AC();
        master = ac.createGain();
        master.gain.value = 0.55;
        master.connect(ac.destination);
      }
      if (ac.state === 'suspended') ac.resume();
      return ac;
    }

    // One note that can slide from one pitch to another
    function tone({ type = 'sine', from, to = from, start = 0, dur = 0.12, vol = 0.25 }) {
      const t = ac.currentTime + start;
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(from, t);
      if (to !== from) osc.frequency.exponentialRampToValueAtTime(to, t + dur);
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(vol, t + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(gain);
      gain.connect(master);
      osc.start(t);
      osc.stop(t + dur + 0.03);
    }

    // A burst of filtered noise (splashes, crashes, pops)
    function noise({ start = 0, dur = 0.25, vol = 0.3, filter = 'lowpass', from = 2000, to = from, q = 1 }) {
      const t = ac.currentTime + start;
      const length = Math.ceil(ac.sampleRate * dur);
      const buffer = ac.createBuffer(1, length, ac.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
      const src = ac.createBufferSource();
      src.buffer = buffer;
      const f = ac.createBiquadFilter();
      f.type = filter;
      f.Q.value = q;
      f.frequency.setValueAtTime(from, t);
      if (to !== from) f.frequency.exponentialRampToValueAtTime(to, t + dur);
      const gain = ac.createGain();
      gain.gain.setValueAtTime(vol, t);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(f);
      f.connect(gain);
      gain.connect(master);
      src.start(t);
      src.stop(t + dur);
    }

    const notes = (list, opts) => list.forEach((f, i) => tone({ ...opts, from: f, start: (opts.start || 0) + i * opts.gap }));

    const SFX = {
      // drops in a row climb in pitch, like coins in Subway Surfers
      collect(streak = 0) {
        const f = 880 * Math.pow(2, Math.min(streak, 12) / 12);
        tone({ from: f, to: f * 1.5, dur: 0.09, vol: 0.16 });
      },
      bucket() {
        noise({ dur: 0.35, vol: 0.22, from: 3200, to: 300 });
        notes([523, 659, 784, 1047], { type: 'triangle', start: 0.04, gap: 0.06, dur: 0.18, vol: 0.18 });
      },
      emptyBucket() { tone({ type: 'triangle', from: 260, to: 180, dur: 0.15, vol: 0.18 }); },
      jump() { tone({ type: 'triangle', from: 330, to: 660, dur: 0.16, vol: 0.14 }); },
      crash() {
        noise({ dur: 0.5, vol: 0.4, from: 1800, to: 120 });
        tone({ from: 150, to: 40, dur: 0.35, vol: 0.45 });
      },
      mud() {
        tone({ type: 'sawtooth', from: 190, to: 60, dur: 0.55, vol: 0.1 });
        noise({ dur: 0.45, vol: 0.2, filter: 'bandpass', from: 700, to: 150, q: 3 });
      },
      shield() {
        tone({ from: 520, to: 1500, dur: 0.12, vol: 0.22 });
        noise({ dur: 0.1, vol: 0.18, filter: 'highpass', from: 2500 });
      },
      milestone() { notes([784, 1175], { type: 'triangle', gap: 0.1, dur: 0.24, vol: 0.18 }); },
      warning() { notes([494, 494], { type: 'square', gap: 0.14, dur: 0.1, vol: 0.06 }); },
      start() { notes([392, 523, 659], { type: 'triangle', gap: 0.07, dur: 0.16, vol: 0.14 }); },
      gameOver() { notes([523, 440, 349], { type: 'triangle', gap: 0.16, dur: 0.3, vol: 0.18 }); },
      highScore() { notes([523, 659, 784, 1047, 1319], { type: 'triangle', gap: 0.09, dur: 0.26, vol: 0.18 }); },
      levelUp() {
        notes([392, 523, 659, 784], { type: 'square', gap: 0.08, dur: 0.18, vol: 0.06 });
        tone({ type: 'triangle', from: 1047, start: 0.34, dur: 0.5, vol: 0.18 });
      },
      click() { tone({ from: 660, to: 880, dur: 0.05, vol: 0.08 }); },
    };

    return {
      play(name, arg) {
        if (!enabled || !ensure()) return;
        try { SFX[name](arg); } catch (e) { /* never let a sound break the game */ }
      },
      unlock() { if (enabled) ensure(); },
      setEnabled(on) { enabled = on; if (on) ensure(); },
      get enabled() { return enabled; },
    };
  })();

  /* ---------- 6. DOM, state, and layout ---------- */

  const $ = (id) => document.getElementById(id);
  const gameEl = $('game');
  const canvas = $('scene');
  const mainCtx = canvas.getContext('2d');
  let ctx = mainCtx;   // the drawing helpers use this; checkpoint previews swap in their own canvas
  const screens = {
    home: $('homeScreen'), over: $('gameOverScreen'), pause: $('pauseScreen'), checkpoints: $('checkpointScreen'),
  };
  const hudEl = $('hud');
  const hintEl = $('hint');
  const toastEl = $('toast');
  const footerEl = $('cwFooter');
  const soundBtns = [...document.querySelectorAll('.sound-btn')];
  const giveEl = $('giveLink');
  const logoEl = $('giveLogo');
  const diffInputs = [...document.querySelectorAll('input[name="difficulty"]')];
  const ui = {
    water: $('waterSize'), score: $('totalScore'),
    waterBox: $('hudWater'), scoreBox: $('hudScore'),
    progressBtn: $('progressBtn'), progress: $('statProgress'),
    progressFill: $('progressFill'), progressCaption: $('progressCaption'),
    high: $('statHigh'), highTag: $('statHighTag'), last: $('statLast'), diffNote: $('difficultyNote'),
    overScore: $('overScore'), overDiff: $('overDiff'), overNote: $('overNote'),
    overBadges: $('overBadges'), overBest: $('overBest'), overLevel: $('overLevel'),
    overProgress: $('overProgress'), overFill: $('overFill'), overCaption: $('overCaption'),
    factBubble: $('factBubble'), factText: $('factText'), factSource: $('factSource'),
    cpList: $('cpList'),
  };

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const touchFirst = window.matchMedia('(pointer: coarse)').matches;
  const HOME_SCALE = 1.1;   // the droplet is drawn a bit bigger on the home screen
  // Canvas text uses the same brand font stack as the CSS
  const FONT = getComputedStyle(document.documentElement).getPropertyValue('--font-brand').trim()
    || 'Montserrat, system-ui, sans-serif';

  // Everything the game tracks
  const S = {
    mode: 'home',        // 'home' | 'starting' | 'running' | 'dying' | 'over'
    paused: false,
    diff: DIFFICULTIES.normal,
    runDifficulty: 'normal',
    tier: tierFor(stats.progress),   // checkpoint the droplet has reached
    pendingLevel: -1,    // checkpoint to celebrate when the player returns home
    time: 0,             // seconds since the page loaded (drives idle animations)
    dist: 0,             // how far along the street the camera is
    speed: 0,
    runTime: 0,
    water: 0,            // "Water Size": drops collected but not stored yet
    score: 0,            // "Total Score": drops stored in buckets this run
    lostWater: 0,
    objects: [],         // drops, obstacles, buckets
    decor: [],           // buildings and palm trees
    particles: [],
    texts: [],
    nextRowPos: 0, nextDropPos: 0, nextBucketPos: 0,
    dropLine: { lane: 0, left: 0 },
    decorCursor: { '-1': { building: -6, palm: -2 }, '1': { building: -3, palm: 4 } },
    turn: 0,             // 0..1 turn-around animation when a run starts
    hop: 0,              // little hop when the droplet is tapped
    deathType: null,     // 'crash' (rock) or 'pollute' (mud)
    deathT: 0,
    pollute: 0,
    shake: 0,
    land: 0,
    growth: 1,
    trailT: 0,
    shields: 0,          // Easy mode: hits the bubble shield can still block
    invuln: 0,           // seconds of safety right after a shield pops
    milestonesHit: [],   // indexes of MILESTONES already shown this run
    streak: 0,           // drops collected close together (raises the pickup sound's pitch)
    lastCollect: -1,
    hintShown: false,
  };

  // The player droplet
  const P = { lane: 0, x: 0, h: 0, vy: 0, jumping: false, phase: 0 };

  const tierScale = () => CHECKPOINTS[S.tier].scale;

  // Screen layout. Positions on the road use:
  //   z = distance ahead of the player (0 = the player's feet)
  //   x = lane offset (-1 left, 0 middle, 1 right)
  //   h = height above the road in "u" units
  const L = { W: 1, H: 1, dpr: 1, cx: 0, horizonY: 0, groundY: 0, lane: 120, u: 1 };
  let skyline = [];

  function resize() {
    const r = gameEl.getBoundingClientRect();
    L.W = Math.max(1, r.width);
    L.H = Math.max(1, r.height);
    L.dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(L.W * L.dpr);
    canvas.height = Math.round(L.H * L.dpr);
    L.cx = L.W / 2;
    // Tall phone screens get a wider road (its edges can run off-screen) so things aren't tiny
    const portrait = L.H > L.W * 1.15;
    // Short screens lift the road a little so the droplet clears the Start button and footer
    const shortLandscape = L.H < 560 && L.W > L.H;    // phones held sideways
    const shortPortrait = portrait && L.H < 700;      // small phones like the iPhone SE
    L.horizonY = L.H * (portrait ? 0.33 : 0.36);
    L.groundY = L.H * (shortLandscape ? 0.72 : shortPortrait ? 0.76 : 0.8);
    const roadWidth = Math.min(L.W * (portrait ? 1.12 : 0.94), (L.groundY - L.horizonY) * 1.75, 620);
    L.lane = roadWidth / 3;
    L.u = L.lane / 120;
    buildSkyline();
    placeAvatarButton();
  }

  // Perspective: things farther away get smaller and move toward the horizon
  function scaleAt(z) {
    return CONFIG.camDepth / (Math.max(z, -3.2) + CONFIG.camDepth);
  }
  function proj(z, x = 0, h = 0) {
    const s = scaleAt(z);
    return {
      x: L.cx + x * L.lane * s,
      y: L.horizonY + (L.groundY - L.horizonY) * s - h * L.u * s,
      s,
    };
  }

  function buildSkyline() {
    const rnd = seeded(7);
    const k = L.H / 800;
    skyline = [];
    let x = -20;
    while (x < L.W + 20) {
      const w = (22 + rnd() * 50) * k;
      const h = (8 + rnd() * 30) * k;
      const r = rnd();
      skyline.push({ x, w, h, type: r < 0.14 ? 'dome' : r < 0.24 ? 'tower' : 'box' });
      x += w * (0.65 + rnd() * 0.5);
    }
  }

  // Keeps the invisible tap target lined up with the droplet drawn on the canvas
  function placeAvatarButton() {
    const s = HOME_SCALE * tierScale();
    const h = 104 * L.u * s;
    const w = 86 * L.u * s;
    const top = L.groundY - h;
    gameEl.style.setProperty('--avatar-x', `${L.cx}px`);
    gameEl.style.setProperty('--avatar-top', `${top}px`);
    gameEl.style.setProperty('--avatar-w', `${w}px`);
    gameEl.style.setProperty('--avatar-h', `${h}px`);
    gameEl.style.setProperty('--bubble-bottom', `${L.H - top + 14}px`);
    placeGiveButton();
  }

  // Keeps the Give button below the stats and difficulty picker on every screen size
  function placeGiveButton() {
    const homeTop = screens.home.querySelector('.home-top');
    if (screens.home.hidden || screens.home.classList.contains('is-leaving')) return;
    // offsetTop/offsetHeight ignore the slide-in animation, so this measures the resting spot
    const below = homeTop.offsetTop + homeTop.offsetHeight + 16;
    gameEl.style.setProperty('--give-top', `${Math.max(L.H * 0.47, below)}px`);
  }

  /* ---------- 7. Spawning ---------- */

  // 0 at the start of a run, 1 after 75 seconds
  const ramp = () => clamp(S.runTime / 75, 0, 1);
  const targetSpeed = () => Math.min(S.diff.maxSpeed, S.diff.startSpeed + CONFIG.acceleration * S.runTime);
  const isObstacle = (o) => o.kind === 'rock' || o.kind === 'mud';

  function obstacleNear(pos, lane, range) {
    return S.objects.find((o) => isObstacle(o) && o.lane === lane && Math.abs(o.pos - pos) < range);
  }
  function bucketNear(pos, lane, range) {
    return S.objects.some((o) => o.kind === 'bucket' && o.lane === lane && Math.abs(o.pos - pos) < range);
  }

  function rockShape() {
    // A lumpy dome: points from the right edge, over the top, to the left edge
    const pts = [[1, 0]];
    const steps = 7;
    for (let i = 1; i < steps; i++) {
      const a = (i / steps) * Math.PI;
      const j = rand(0.82, 1.08);
      pts.push([Math.cos(a) * j, Math.sin(a) * j]);
    }
    pts.push([-1, 0]);
    return pts;
  }

  function addObstacle(pos, lane) {
    const kind = Math.random() < 0.5 ? 'rock' : 'mud';
    S.objects.push(kind === 'rock'
      ? { kind, pos, lane, half: 0.8, height: 62, shape: rockShape() }
      : { kind, pos, lane, half: 1.25, height: 8, wobble: rand(0, 6.28) });
  }

  function placeRow(pos) {
    const count = Math.random() < lerp(...S.diff.doubleObstacleChance, ramp()) ? 2 : 1;
    const lanes = shuffle([-1, 0, 1]).filter((l) => !bucketNear(pos, l, 5));
    // Never block all three lanes
    for (let i = 0; i < Math.min(count, lanes.length, 2); i++) addObstacle(pos, lanes[i]);
  }

  function placeBucket(pos) {
    const lanes = shuffle([-1, 0, 1]);
    const free = lanes.find((l) => !obstacleNear(pos, l, 4));
    const lane = free !== undefined ? free : lanes[0];
    // Clear anything sitting right on top of the bucket
    S.objects = S.objects.filter((o) => !(isObstacle(o) && o.lane === lane && Math.abs(o.pos - pos) < 4));
    S.objects.push({ kind: 'bucket', pos, lane, half: 1.0 });
  }

  function placeDrop(pos, lane) {
    if (bucketNear(pos, lane, 2.2)) return;
    let h = 26;
    // If a rock or puddle is in this lane, arc the drops over it (a hint to jump)
    const ob = obstacleNear(pos, lane, 4.6);
    if (ob) {
      const t = (pos - ob.pos) / 4.6;
      h = 26 + 144 * (1 - t * t);
    }
    S.objects.push({ kind: 'drop', pos, lane, half: 0.9, h, bob: rand(0, 6.28) });
  }

  function spawnAhead() {
    const ahead = S.dist + CONFIG.viewDistance;
    const k = ramp();

    // Buckets and obstacles are planned a little further out so drop lines can react to them
    while (S.nextBucketPos < ahead + 25) {
      placeBucket(S.nextBucketPos);
      S.nextBucketPos += rand(...S.diff.bucketEvery) * targetSpeed();
    }
    while (S.nextRowPos < ahead + 25) {
      placeRow(S.nextRowPos);
      const gapSeconds = (lerp(...CONFIG.rowGapMin, k) + Math.random() * lerp(...CONFIG.rowGapExtra, k)) * S.diff.obstacleGap;
      S.nextRowPos += Math.max(8, gapSeconds * targetSpeed());
    }
    // Drops come in lines, like coins in Subway Surfers
    while (S.nextDropPos < ahead) {
      const line = S.dropLine;
      if (line.left <= 0) {
        S.nextDropPos += rand(...CONFIG.dropGap);
        line.lane = Math.random() < 0.4 ? line.lane : pick([-1, 0, 1].filter((l) => l !== line.lane));
        line.left = randInt(...CONFIG.dropLine);
        continue;
      }
      placeDrop(S.nextDropPos, line.lane);
      line.left--;
      S.nextDropPos += CONFIG.dropSpacing;
    }
  }

  // Street scenery: houses in charity: water's secondary colors, plus palm trees
  const HOUSE_COLORS = [BRAND.pink, BRAND.teal, BRAND.orange, BRAND.yellow, BRAND.green, '#F3E2C3', '#E9A0B4'];
  const AWNING_COLORS = [BRAND.blue, BRAND.darkGreen, BRAND.red, BRAND.ink];

  function spawnDecor(upTo) {
    for (const side of [-1, 1]) {
      const c = S.decorCursor[side];
      while (c.building < upTo) {
        const len = rand(7, 13);
        const h = rand(120, 235);
        S.decor.push({
          kind: 'building', side, pos: c.building, len, h,
          x0: 2.35, x1: 4.8,
          color: pick(HOUSE_COLORS),
          floors: h > 175 ? 2 : 1,
          door: rand(0.25, 0.75),
          awning: Math.random() < 0.55 ? pick(AWNING_COLORS) : null,
        });
        c.building += len + rand(0.8, 3);
      }
      while (c.palm < upTo) {
        S.decor.push({ kind: 'palm', side, pos: c.palm, x: 1.98, h: rand(230, 300), lean: rand(0.02, 0.14) });
        c.palm += rand(13, 26);
      }
    }
  }

  function cull() {
    S.objects = S.objects.filter((o) => !o.done && o.pos - S.dist > -4);
    S.decor = S.decor.filter((b) => b.pos + (b.len || 0) - S.dist > -4);
  }

  /* ---------- 8. Game flow ---------- */

  function setMode(mode) {
    S.mode = mode;
    gameEl.dataset.mode = mode;
  }

  function showHome() {
    setMode('home');
    S.paused = false;
    gameEl.classList.remove('is-gray');
    screens.home.hidden = false;
    screens.home.classList.remove('is-leaving');
    screens.over.hidden = true;
    screens.pause.hidden = true;
    screens.checkpoints.hidden = true;
    hudEl.hidden = true;
    hideHint();
    hideFact();
    hideToast();
    S.objects = [];
    S.particles = [];
    S.texts = [];
    P.lane = 0; P.x = 0; P.h = 0; P.vy = 0; P.jumping = false;
    S.turn = 0; S.pollute = 0; S.deathType = null; S.growth = 1; S.speed = 0;
    renderStats();
    // Just passed a checkpoint? Show off the new look.
    if (S.pendingLevel > 0) {
      const tier = S.pendingLevel;
      S.pendingLevel = -1;
      setTimeout(() => celebrateLevel(tier), 450);
    }
  }

  function renderStats() {
    const d = DIFFICULTIES[stats.difficulty];
    const info = progressInfo(stats.progress);
    ui.progress.textContent = fmt(stats.progress);
    ui.progressFill.style.width = `${info.pct}%`;
    ui.progressCaption.textContent = info.caption;
    ui.progressBtn.setAttribute('aria-label', `Current Progress ${fmt(stats.progress)}. ${info.caption}. Show checkpoints.`);
    ui.high.textContent = fmt(stats.high[stats.difficulty]);
    ui.highTag.textContent = d.label;
    ui.last.textContent = fmt(stats.last);
    ui.diffNote.textContent = d.note;
    for (const input of diffInputs) input.checked = input.value === stats.difficulty;
    S.tier = info.tier;
    placeAvatarButton();
  }

  function setDifficulty(key) {
    if (!DIFFICULTIES[key]) return;
    stats.difficulty = key;
    saveStats();
    renderStats();
  }

  function startFromHome() {
    if (S.mode !== 'home') return;
    hideFact();
    screens.checkpoints.hidden = true;
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    Sound.play('start');
    setMode('starting');
    S.turn = 0;
    screens.home.classList.add('is-leaving');
    setTimeout(() => { if (S.mode !== 'home') screens.home.hidden = true; }, 380);
  }

  function beginRun() {
    setMode('running');
    S.runDifficulty = stats.difficulty;
    S.diff = DIFFICULTIES[S.runDifficulty];
    S.paused = false;
    S.objects = [];
    S.particles = [];
    S.texts = [];
    S.water = 0; S.score = 0; S.lostWater = 0;
    S.runTime = 0; S.speed = 0;
    S.nextRowPos = S.dist + S.diff.firstObstacleAt;
    S.nextDropPos = S.dist + 20;
    S.nextBucketPos = S.dist + S.diff.startSpeed * CONFIG.firstBucketAfter;
    S.dropLine = { lane: 0, left: 0 };
    P.lane = 0; P.x = 0; P.h = 0; P.vy = 0; P.jumping = false;
    S.deathType = null; S.deathT = 0; S.pollute = 0; S.shake = 0; S.growth = 1; S.turn = 1;
    S.shields = S.diff.shields;
    S.invuln = 0;
    S.milestonesHit = [];
    S.streak = 0;
    gameEl.classList.remove('is-gray');
    screens.over.hidden = true;
    hudEl.hidden = false;
    hideToast();
    updateHud(true);
    if (!S.hintShown) showHint();
    if (S.shields > 0) showToast('Easy mode: your bubble shield blocks one hit.', 'info');
  }

  function retry() {
    if (S.mode !== 'over') return;
    beginRun();
  }

  function die(type) {
    setMode('dying');
    S.deathType = type;
    S.deathT = 0;
    S.lostWater = S.water;
    S.water = 0;
    updateHud();
    hideToast();
    Sound.play(type === 'crash' ? 'crash' : 'mud');
    const x = L.cx + P.x * L.lane;
    const y = L.groundY - (P.h + 40) * L.u;
    if (type === 'crash') {
      S.shake = 0.4;
      burst(x, y, 34, { speed: 420, spread: Math.PI * 2, angle: 0, size: 9, life: 0.9, gravity: 900,
        colors: ['#9AD7FF', BRAND.blue, '#1769B8', '#FFFFFF'] });
    } else {
      S.shake = 0.15;
      burst(x, L.groundY - 10 * L.u, 16, { speed: 220, spread: 1.6, angle: -Math.PI / 2, size: 7, life: 0.7, gravity: 700,
        colors: ['#6B4423', '#8D6239', '#4A3018'] });
    }
  }

  // Adds a finished run to the saved stats. Returns what changed so the game over screen can show it.
  function commitStats(score) {
    const key = S.runDifficulty;
    const before = stats.progress;
    const best = score > 0 && score > stats.high[key];
    stats.progress += score;
    stats.last = score;
    stats.lastDifficulty = key;
    stats.high[key] = Math.max(stats.high[key], score);
    stats.runs += 1;
    saveStats();
    const fromTier = tierFor(before);
    const toTier = tierFor(stats.progress);
    if (toTier > fromTier) S.pendingLevel = toTier;
    return { best, before, fromTier, toTier };
  }

  function endRun() {
    setMode('over');
    hudEl.hidden = true;
    hideHint();
    const r = commitStats(S.score);
    gameEl.classList.add('is-gray');
    Sound.play(r.best ? 'highScore' : 'gameOver');

    ui.overScore.textContent = fmt(S.score);
    ui.overDiff.textContent = S.diff.label;
    ui.overBest.hidden = !r.best;
    ui.overLevel.hidden = r.toTier === r.fromTier;
    if (r.toTier > r.fromTier) ui.overLevel.textContent = `Checkpoint reached: ${CHECKPOINTS[r.toTier].name}`;
    ui.overBadges.hidden = ui.overBest.hidden && ui.overLevel.hidden;

    const lost = S.lostWater;
    if (lost === 0) {
      ui.overNote.textContent = 'Nothing spilled. Every drop you picked up made it into a bucket.';
    } else if (S.deathType === 'crash') {
      ui.overNote.textContent = `You hit a rock and spilled ${fmt(lost)} drop${lost === 1 ? '' : 's'} you hadn't stored yet.`;
    } else {
      ui.overNote.textContent = `Mud polluted the ${fmt(lost)} drop${lost === 1 ? '' : 's'} you were carrying.`;
    }

    // Progress bar: starts where it was before this run, then fills up
    const was = progressInfo(r.before);
    const now = progressInfo(stats.progress);
    ui.overProgress.textContent = fmt(stats.progress);
    ui.overCaption.textContent = now.caption;
    const fill = ui.overFill;
    fill.style.transition = 'none';
    fill.style.width = `${was.tier === now.tier ? was.pct : 0}%`;
    screens.over.hidden = false;
    void fill.offsetWidth;          // apply the starting width before animating
    fill.style.transition = '';
    setTimeout(() => { fill.style.width = `${now.pct}%`; }, 250);

    $('retryBtn').focus({ preventScroll: true });
  }

  function setPaused(on) {
    if (S.mode !== 'running') return;
    S.paused = on;
    screens.pause.hidden = !on;
    if (on) $('resumeBtn').focus({ preventScroll: true });
  }

  function quitToHome() {
    // Stored water still counts when quitting mid-run
    if (S.mode === 'running') commitStats(S.score);
    showHome();
  }

  /* ---------- Checkpoints panel ---------- */

  function openCheckpoints() {
    if (S.mode !== 'home') return;
    hideFact();
    buildCheckpointList();
    screens.checkpoints.hidden = false;
    $('cpClose').focus({ preventScroll: true });
  }

  function closeCheckpoints() {
    if (screens.checkpoints.hidden) return;
    screens.checkpoints.hidden = true;
    ui.progressBtn.focus({ preventScroll: true });
  }

  // RUBRIC: DOM add/remove. Builds the checkpoint cards with createElement every time
  // the panel opens, so they always match the player's current progress.
  function buildCheckpointList() {
    const progress = stats.progress;
    const tier = tierFor(progress);
    ui.cpList.textContent = '';
    CHECKPOINTS.forEach((cp, i) => {
      const li = document.createElement('li');
      li.className = 'cp';
      if (i <= tier) li.classList.add('is-unlocked');
      if (i === tier) li.classList.add('is-current');

      const art = document.createElement('canvas');
      art.className = 'cp-art';
      art.setAttribute('aria-hidden', 'true');

      const text = document.createElement('div');
      text.className = 'cp-text';
      const num = document.createElement('p');
      num.className = 'cp-num';
      num.textContent = `Checkpoint ${i + 1}${cp.at ? ` · ${fmt(cp.at)} points` : ''}`;
      const name = document.createElement('h3');
      name.className = 'cp-name';
      name.textContent = cp.name;
      const unlock = document.createElement('p');
      unlock.className = 'cp-unlock';
      unlock.textContent = cp.unlock;
      const state = document.createElement('p');
      state.className = 'cp-state';
      state.textContent = i === tier ? 'Your droplet now'
        : i < tier ? 'Unlocked'
        : `${fmt(cp.at - progress)} more to unlock`;
      text.append(num, name, unlock, state);

      li.append(art, text);
      ui.cpList.append(li);
      drawPreview(art, i);
    });
  }

  // Draws a small front-facing droplet for one checkpoint
  function drawPreview(cv, tier) {
    const W = 64, H = 76;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    cv.width = W * dpr;
    cv.height = H * dpr;
    const prev = ctx;
    ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const scale = CHECKPOINTS[tier].scale;
    const unit = (H - 12) / (100 * 1.18);
    const ground = H - 8;
    ellipse(W / 2, ground, 30 * unit * scale, 7 * unit * scale, 'rgba(0,0,0,0.3)');
    drawAvatar(W / 2, ground, scale, { tier, unit, facing: 'front', time: 1.3 });
    ctx = prev;
  }

  /* ---------- HUD, hint, facts, level-ups ---------- */

  // RUBRIC: DOM change. The HUD numbers update and pulse whenever the player grabs a drop or hits a bucket.
  const hudCache = { water: -1, score: -1 };
  function updateHud(force) {
    if (force || S.water !== hudCache.water) {
      if (!force && S.water > hudCache.water) pulse(ui.waterBox);
      ui.water.textContent = fmt(S.water);
      hudCache.water = S.water;
    }
    if (force || S.score !== hudCache.score) {
      if (!force && S.score > hudCache.score) pulse(ui.scoreBox);
      ui.score.textContent = fmt(S.score);
      hudCache.score = S.score;
    }
  }

  function pulse(el) {
    el.classList.remove('pulse');
    void el.offsetWidth; // restart the CSS animation
    el.classList.add('pulse');
  }

  let hintTimer = 0;
  function showHint() {
    S.hintShown = true;
    hintEl.innerHTML = touchFirst
      ? 'Swipe left or right to switch lanes, swipe up to jump. Run through yellow buckets to store your water!'
      : 'Use <kbd>←</kbd> <kbd>→</kbd> to switch lanes and <kbd>↑</kbd> or <kbd>Space</kbd> to jump. Run through yellow buckets to store your water!';
    hintEl.classList.remove('is-fading');
    hintEl.hidden = false;
    clearTimeout(hintTimer);
    hintTimer = setTimeout(() => {
      hintEl.classList.add('is-fading');
      hintTimer = setTimeout(() => { hintEl.hidden = true; }, 500);
    }, 4500);
  }
  function hideHint() {
    clearTimeout(hintTimer);
    hintEl.hidden = true;
  }

  // Message banner under the HUD (milestones, shield pops). kind: 'good' | 'warn' | 'info'
  let toastTimer = 0;
  function showToast(text, kind = 'good') {
    toastEl.textContent = text;
    toastEl.dataset.kind = kind;
    toastEl.hidden = false;
    pulseClass(toastEl, 'show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, 2800);
  }
  function hideToast() {
    clearTimeout(toastTimer);
    toastEl.hidden = true;
  }

  // RUBRIC: Milestones. Loops over the MILESTONES array and uses conditionals to decide
  // which message to show. Each milestone shows once per run.
  function checkMilestones() {
    let latest = null;
    for (let i = 0; i < MILESTONES.length; i++) {
      const m = MILESTONES[i];
      if (S.milestonesHit.includes(i)) continue;
      const value = m.type === 'score' ? S.score : S.water;
      if (value >= m.at) {
        S.milestonesHit.push(i);
        latest = m;          // if a bucket jumps past several at once, show the biggest one
      }
    }
    if (!latest) return;
    if (latest.type === 'water') {
      showToast(latest.text, 'warn');
      Sound.play('warning');
    } else {
      showToast(latest.text, 'good');
      Sound.play('milestone');
    }
  }

  // Speech bubble above the droplet on the home screen.
  // RUBRIC: DOM change. Tapping the droplet shows this bubble; tapping the bubble removes it.
  let bubbleTimer = 0;
  function showBubble(text, sub) {
    ui.factText.textContent = text;
    ui.factSource.textContent = sub;
    ui.factBubble.hidden = false;
    screens.home.classList.add('has-fact');
    pulseClass(ui.factBubble, 'pop');
    S.hop = 1;
    clearTimeout(bubbleTimer);
    bubbleTimer = setTimeout(hideFact, 8000);
  }

  // Facts are dealt from a shuffled deck so every fact shows up before any repeats
  let factDeck = [];
  function showFact() {
    if (S.mode !== 'home') return;
    if (!factDeck.length) factDeck = shuffle(FACTS.map((_, i) => i));
    const fact = FACTS[factDeck.pop()];
    showBubble(fact.text, `Source: ${fact.source}`);
  }

  function hideFact() {
    clearTimeout(bubbleTimer);
    ui.factBubble.hidden = true;
    screens.home.classList.remove('has-fact');
  }

  function pulseClass(el, cls) {
    el.classList.remove(cls);
    void el.offsetWidth;
    el.classList.add(cls);
  }

  function celebrateLevel(tier) {
    if (S.mode !== 'home') return;
    const cp = CHECKPOINTS[tier];
    showBubble(
      `Checkpoint reached: ${cp.name}! New look: ${lowerFirst(cp.unlock)}.`,
      `Checkpoint ${tier + 1} of ${CHECKPOINTS.length}. Tap Current Progress to see them all.`
    );
    Sound.play('levelUp');
    const y = L.groundY - 60 * L.u * HOME_SCALE * tierScale();
    burst(L.cx, y, 30, { speed: 360, spread: Math.PI * 2, angle: 0, size: 6, life: 1, gravity: 300,
      colors: [BRAND.yellow, '#FFFFFF', '#9AD7FF', BRAND.blue] });
  }

  /* ---------- Particles + floating text (screen space) ---------- */

  function burst(x, y, n, o) {
    for (let i = 0; i < n; i++) {
      const a = o.angle + (Math.random() - 0.5) * o.spread;
      const sp = o.speed * L.u * rand(0.4, 1.2);
      S.particles.push({
        x, y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        r: o.size * L.u * rand(0.5, 1.2),
        life: 0,
        max: o.life * rand(0.7, 1.3),
        color: pick(o.colors),
        g: o.gravity * L.u,
      });
    }
  }

  function floatText(x, y, text, size = 34) {
    S.texts.push({ x, y, text, size, life: 0, max: 1.1 });
  }

  /* ---------- Update ---------- */

  function update(dt) {
    S.time += dt;
    S.hop = Math.max(0, S.hop - dt * 2.6);
    S.shake = Math.max(0, S.shake - dt);
    S.land = Math.max(0, S.land - dt * 5);

    if (S.mode === 'starting') {
      S.turn += dt / 0.5;
      if (S.turn >= 1) beginRun();
    } else if (S.mode === 'running' && !S.paused) {
      updateRun(dt);
    } else if (S.mode === 'dying') {
      updateDying(dt);
    }

    if (!S.paused) updateEffects(dt);
    spawnDecor(S.dist + CONFIG.viewDistance + 40);
  }

  function updateRun(dt) {
    S.runTime += dt;
    S.invuln = Math.max(0, S.invuln - dt);
    // Ease in from standing still, then keep speeding up
    S.speed = targetSpeed() * Math.min(1, S.runTime / 0.7);
    const step = S.speed * dt;
    S.dist += step;
    P.phase += dt * (9 + S.speed * 0.28);

    // Slide toward the chosen lane
    const diff = P.lane - P.x;
    const move = CONFIG.laneSwitchSpeed * dt;
    P.x = Math.abs(diff) <= move ? P.lane : P.x + Math.sign(diff) * move;

    // Jump physics
    if (P.jumping) {
      const g = (8 * CONFIG.jumpHeight) / (CONFIG.jumpTime * CONFIG.jumpTime);
      P.vy -= g * dt;
      P.h += P.vy * dt;
      if (P.h <= 0) {
        P.h = 0; P.vy = 0; P.jumping = false; S.land = 1;
      }
    }

    // The droplet swells as it carries more water, and shrinks back after a bucket
    const targetGrowth = 1 + Math.min(S.water, 40) * 0.006;
    S.growth += (targetGrowth - S.growth) * Math.min(1, dt * 8);

    // Stream checkpoint and up: leave a little water trail
    if (S.tier >= 3 && !reduceMotion) {
      S.trailT -= dt;
      if (S.trailT <= 0) {
        S.trailT = 0.045;
        const x = L.cx + P.x * L.lane;
        S.particles.push({
          x: x + rand(-14, 14) * L.u, y: L.groundY - P.h * L.u - 4 * L.u,
          vx: rand(-25, 25) * L.u, vy: rand(150, 230) * L.u,
          r: rand(2.5, 4.5) * L.u, life: 0, max: 0.35, g: 0, ground: true,
          color: pick(['#9AD7FF', '#CDEBFF', BRAND.blue]),
        });
      }
    }

    spawnAhead();
    checkCollisions(step);
    cull();
  }

  function checkCollisions(step) {
    const PLAYER_HALF = 0.6;     // how deep the droplet is along the road
    const LANE_HIT = 0.55;       // how close in lanes counts as touching
    for (const o of S.objects) {
      if (o.done) continue;
      const z = o.pos - S.dist;
      const prevZ = z + step;    // where it was last frame, so fast speeds can't skip past
      if (z - o.half > PLAYER_HALF || prevZ + o.half < -PLAYER_HALF) continue;
      if (Math.abs(o.lane - P.x) > LANE_HIT) continue;
      if (isObstacle(o) && S.invuln > 0) continue;   // just lost the shield: a moment of safety

      if (o.kind === 'drop') {
        if (Math.abs(P.h + 45 - o.h) < 70) collectDrop(o);
      } else if (o.kind === 'bucket') {
        if (P.h < 90) hitBucket(o);
      } else if (o.kind === 'rock') {
        if (P.h < o.height - 6) { hitObstacle(o, 'crash'); return; }
      } else if (o.kind === 'mud') {
        if (P.h < 10) { hitObstacle(o, 'pollute'); return; }
      }
    }
  }

  // Hitting a rock or mud ends the run, unless an Easy-mode shield is still up
  function hitObstacle(o, type) {
    if (S.shields > 0) {
      popShield();
      return;
    }
    o.hitPlayer = true;
    die(type);
  }

  function popShield() {
    S.shields -= 1;
    S.invuln = 1.1;
    const spilled = S.water;
    S.water = 0;              // the shield saves the run, not the water you were carrying
    updateHud();
    S.shake = 0.15;
    Sound.play('shield');
    const x = L.cx + P.x * L.lane;
    const y = L.groundY - (P.h + 50) * L.u;
    burst(x, y, 26, { speed: 320, spread: Math.PI * 2, angle: 0, size: 5, life: 0.6, gravity: 200,
      colors: ['#FFFFFF', '#CDEBFF', '#9AD7FF'] });
    const lost = spilled > 0 ? ` You spilled ${fmt(spilled)} drop${spilled === 1 ? '' : 's'}.` : '';
    showToast(`Shield popped!${lost} The next hit ends the run.`, 'warn');
  }

  function collectDrop(o) {
    o.done = true;
    S.water += S.diff.dropValue;   // drops are worth 2 on Hard
    updateHud();
    S.streak = S.time - S.lastCollect < 0.6 ? S.streak + 1 : 0;
    S.lastCollect = S.time;
    Sound.play('collect', S.streak);
    checkMilestones();
    const x = L.cx + P.x * L.lane;
    const y = L.groundY - (P.h + 55) * L.u * S.growth;
    burst(x, y, 6, { speed: 160, spread: Math.PI * 2, angle: 0, size: 4, life: 0.4, gravity: 0,
      colors: ['#FFFFFF', '#9AD7FF', BRAND.blue] });
  }

  function hitBucket(o) {
    o.done = true;
    const x = L.cx + P.x * L.lane;
    const y = L.groundY - 50 * L.u;
    burst(x, y, S.water > 0 ? 26 : 10, { speed: 380, spread: 1.9, angle: -Math.PI / 2, size: 7, life: 0.8, gravity: 1100,
      colors: ['#FFFFFF', '#9AD7FF', BRAND.blue, BRAND.yellow] });
    if (S.water > 0) {
      S.score += S.water;
      floatText(x, y - 60 * L.u, `+${fmt(S.water)}`);
      S.water = 0;
      Sound.play('bucket');
    } else {
      floatText(x, y - 60 * L.u, 'Empty bucket', 22);
      Sound.play('emptyBucket');
    }
    updateHud();
    checkMilestones();
  }

  function updateDying(dt) {
    S.deathT += dt;
    if (S.deathType === 'crash') {
      S.speed = Math.max(0, S.speed - S.speed * dt * 14);
      if (S.deathT > 0.9) endRun();
    } else {
      // Polluted: the droplet browns and slows to a stop
      S.speed = Math.max(0, S.speed - S.speed * dt * 3.2);
      S.pollute = Math.min(1, S.deathT / 0.8);
      P.phase += dt * (9 + S.speed * 0.28);
      if (S.deathT > 1.25) endRun();
    }
    S.dist += S.speed * dt;
    if (P.h > 0) { P.vy -= 3000 * dt; P.h = Math.max(0, P.h + P.vy * dt); }
  }

  function updateEffects(dt) {
    for (const p of S.particles) {
      p.life += dt;
      p.vy += p.g * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
    S.particles = S.particles.filter((p) => p.life < p.max);
    for (const t of S.texts) {
      t.life += dt;
      t.y -= 70 * L.u * dt;
    }
    S.texts = S.texts.filter((t) => t.life < t.max);
  }

  /* ---------- 9. Drawing ---------- */

  function render() {
    ctx.setTransform(L.dpr, 0, 0, L.dpr, 0, 0);
    ctx.save();
    if (S.shake > 0 && !reduceMotion) {
      ctx.translate((Math.random() - 0.5) * S.shake * 30, (Math.random() - 0.5) * S.shake * 30);
    }
    drawSky();
    drawGround();
    drawRoad();
    drawParticles(true);   // water trail sits on the road, under everything else

    // Draw everything from far to near so closer things cover farther ones
    const list = [];
    for (const b of S.decor) {
      const z = b.pos - S.dist;
      if (z > CONFIG.viewDistance + 40) continue;
      list.push({ z: b.kind === 'building' ? Math.max(z, -3) : z, o: b });
    }
    for (const o of S.objects) {
      if (!o.done) list.push({ z: o.pos - S.dist, o });
    }
    list.push({ z: 0, player: true });
    list.sort((a, b) => b.z - a.z);

    for (const item of list) {
      if (item.player) { drawPlayer(); continue; }
      const o = item.o;
      const z = o.pos - S.dist;
      if (o.kind === 'building') drawBuilding(o);
      else if (o.kind === 'palm') drawPalm(o, z);
      else if (o.kind === 'drop') drawPickupDrop(o, z);
      else if (o.kind === 'bucket') drawBucket(o, z);
      else if (o.kind === 'rock') drawRock(o, z);
      else if (o.kind === 'mud') drawMud(o, z);
    }

    drawParticles(false);
    drawTexts();
    ctx.restore();
  }

  function fillPoly(points, fill) {
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
  }

  function ellipse(x, y, rx, ry, fill) {
    ctx.beginPath();
    ctx.ellipse(x, y, Math.max(0.1, rx), Math.max(0.1, ry), 0, 0, Math.PI * 2);
    ctx.fillStyle = fill;
    ctx.fill();
  }

  function drawSky() {
    const g = ctx.createLinearGradient(0, 0, 0, L.horizonY);
    g.addColorStop(0, '#6FC0EF');
    g.addColorStop(0.7, '#CDE9F0');
    g.addColorStop(1, '#FFE4AD');
    ctx.fillStyle = g;
    ctx.fillRect(-40, -40, L.W + 80, L.horizonY + 41);

    // Sun
    const k = L.H / 800;
    const sx = L.W * 0.8, sy = L.horizonY * 0.45, sr = 36 * k;
    const glow = ctx.createRadialGradient(sx, sy, sr * 0.5, sx, sy, sr * 3.2);
    glow.addColorStop(0, 'rgba(255, 236, 170, 0.75)');
    glow.addColorStop(1, 'rgba(255, 236, 170, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(sx - sr * 3.2, sy - sr * 3.2, sr * 6.4, sr * 6.4);
    ellipse(sx, sy, sr, sr, '#FFF3C4');

    // Hazy city in the distance
    ctx.fillStyle = 'rgba(214, 160, 128, 0.45)';
    const base = L.horizonY + 1;
    for (const b of skyline) {
      ctx.fillRect(b.x, base - b.h, b.w, b.h);
      if (b.type === 'dome') {
        ctx.beginPath();
        ctx.arc(b.x + b.w / 2, base - b.h, b.w * 0.32, Math.PI, 0);
        ctx.fill();
        ctx.fillRect(b.x + b.w / 2 - 1, base - b.h - b.w * 0.32 - 6 * k, 2, 6 * k);
      } else if (b.type === 'tower') {
        ctx.fillRect(b.x + b.w * 0.4, base - b.h * 2.1, b.w * 0.2, b.h * 1.1);
        ellipse(b.x + b.w * 0.5, base - b.h * 2.1, b.w * 0.2, b.w * 0.16, 'rgba(214, 160, 128, 0.45)');
      }
    }
  }

  function drawGround() {
    const g = ctx.createLinearGradient(0, L.horizonY, 0, L.H);
    g.addColorStop(0, '#F1D7AA');
    g.addColorStop(1, '#D8A96B');
    ctx.fillStyle = g;
    ctx.fillRect(-40, L.horizonY, L.W + 80, L.H - L.horizonY + 40);
  }

  function roadQuad(z0, z1, xa, xb, fill) {
    fillPoly([proj(z0, xa), proj(z0, xb), proj(z1, xb), proj(z1, xa)], fill);
  }

  function drawRoad() {
    const zN = -3.2, zF = 700;

    // Packed-dirt sidewalks
    for (const s of [-1, 1]) roadQuad(zN, zF, s * 1.62, s * 2.3, '#E2C394');

    // Road surface
    const g = ctx.createLinearGradient(0, L.horizonY, 0, L.H);
    g.addColorStop(0, '#6A615A');
    g.addColorStop(1, '#2F2A27');
    roadQuad(zN, zF, -1.5, 1.5, g);

    // Black curbs with yellow blocks that scroll by
    for (const s of [-1, 1]) roadQuad(zN, zF, s * 1.5, s * 1.64, BRAND.ink);
    const blk = 2.6;
    for (let i = Math.floor((S.dist + zN) / blk); ; i++) {
      const z0 = i * blk - S.dist;
      if (z0 > 170) break;
      if (i % 2 === 0) continue;
      const a = Math.max(z0, zN);
      for (const s of [-1, 1]) roadQuad(a, z0 + blk, s * 1.5, s * 1.64, BRAND.yellow);
    }

    // Dashed yellow lane lines
    const per = 7, len = 3.2;
    ctx.globalAlpha = 0.9;
    for (let i = Math.floor((S.dist + zN - len) / per); ; i++) {
      const z0 = i * per - S.dist;
      if (z0 > 190) break;
      const z1 = z0 + len;
      if (z1 < zN) continue;
      const a = Math.max(z0, zN);
      for (const lx of [-0.5, 0.5]) roadQuad(a, z1, lx - 0.025, lx + 0.025, BRAND.yellow);
    }
    ctx.globalAlpha = 1;
  }

  // Far-away scenery fades toward the hazy horizon
  const fogAt = (z) => clamp((z - 35) / 80, 0, 0.75);
  const FOG = '#F3DDB4';

  function wallQuad(x, za, zb, h0, h1, fill) {
    fillPoly([proj(za, x, h0), proj(zb, x, h0), proj(zb, x, h1), proj(za, x, h1)], fill);
  }

  function drawBuilding(b) {
    const z0 = b.pos - S.dist;
    const z1 = z0 + b.len;
    if (z1 < -3) return;
    const zn = Math.max(z0, -3);
    const fog = fogAt(z0);
    const xa = b.side * b.x0, xb = b.side * b.x1;
    const col = (hex, m = 1) => mixColor(hex, FOG, fog, m);

    // Flat roof (seen from above), near end wall, then the wall facing the street
    fillPoly([proj(zn, xa, b.h), proj(z1, xa, b.h), proj(z1, xb, b.h), proj(zn, xb, b.h)], col('#D9CBB4'));
    if (z0 > -3) fillPoly([proj(z0, xa, 0), proj(z0, xb, 0), proj(z0, xb, b.h), proj(z0, xa, b.h)], col(b.color, 0.78));
    wallQuad(xa, zn, z1, 0, b.h, col(b.color));
    wallQuad(xa, zn, z1, b.h - 12, b.h, col(b.color, 0.82)); // roof ledge

    if (z0 > 80) return; // skip small details when far away

    const clampZ = (z) => clamp(z, zn, z1);
    const doorZ = z0 + b.door * b.len;
    // Windows
    for (let f = 0; f < b.floors; f++) {
      const h0 = 34 + f * 82, h1 = h0 + 32;
      for (let wz = z0 + 1.4; wz < z1 - 1.6; wz += 2.9) {
        if (f === 0 && Math.abs(wz + 0.6 - doorZ) < 1.6) continue;
        if (wz + 1.2 < zn) continue;
        wallQuad(xa, clampZ(wz - 0.15), clampZ(wz + 1.35), h0 - 4, h1 + 4, col('#FFF4DE'));
        wallQuad(xa, clampZ(wz), clampZ(wz + 1.2), h0, h1, col('#2F3A44'));
      }
    }
    // Door + awning
    if (doorZ + 0.7 > zn) {
      wallQuad(xa, clampZ(doorZ - 0.7), clampZ(doorZ + 0.7), 0, 62, col('#4A3326'));
      if (b.awning) wallQuad(xa, clampZ(doorZ - 1.2), clampZ(doorZ + 1.2), 66, 76, col(b.awning));
    }
  }

  function drawPalm(p, z) {
    if (z < -3) return;
    const fog = fogAt(z);
    const x = p.side * p.x;
    const base = proj(z, x, 0);
    const top = proj(z, x + p.side * p.lean, p.h);
    const u = L.u * base.s;

    ctx.lineCap = 'round';
    ctx.strokeStyle = mixColor('#8A5A33', FOG, fog);
    ctx.lineWidth = 9 * u;
    ctx.beginPath();
    ctx.moveTo(base.x, base.y);
    ctx.quadraticCurveTo(base.x - p.side * 16 * u, (base.y + top.y) / 2, top.x, top.y);
    ctx.stroke();

    const leaves = 7;
    ctx.lineWidth = 11 * u;
    for (let i = 0; i < leaves; i++) {
      const a = Math.PI + 0.35 - (i / (leaves - 1)) * (Math.PI + 0.7);
      const len = 78 * u;
      const ex = top.x + Math.cos(a) * len;
      const ey = top.y - Math.sin(a) * len * 0.45 + 34 * u;
      const cx = top.x + Math.cos(a) * len * 0.55;
      const cy = top.y - Math.sin(a) * len * 0.8 - 8 * u;
      ctx.strokeStyle = mixColor(i % 2 ? BRAND.darkGreen : BRAND.green, FOG, fog);
      ctx.beginPath();
      ctx.moveTo(top.x, top.y);
      ctx.quadraticCurveTo(cx, cy, ex, ey);
      ctx.stroke();
    }
    ellipse(top.x - 4 * u, top.y + 6 * u, 5 * u, 5 * u, mixColor('#6B4423', FOG, fog));
    ellipse(top.x + 5 * u, top.y + 7 * u, 5 * u, 5 * u, mixColor('#6B4423', FOG, fog));
  }

  // The classic water-drop outline: pointed top, round bottom, centered on (cx, cy)
  function teardropPath(cx, cy, r) {
    const a = Math.acos(1 / 1.65);
    const tipY = cy - 1.65 * r;
    ctx.beginPath();
    ctx.moveTo(cx, tipY);
    ctx.quadraticCurveTo(cx + r * 0.44, cy - r * 1.15, cx + r * Math.sin(a), cy - r * Math.cos(a));
    ctx.arc(cx, cy, r, -Math.PI / 2 + a, Math.PI * 1.5 - a);
    ctx.quadraticCurveTo(cx - r * 0.44, cy - r * 1.15, cx, tipY);
    ctx.closePath();
  }

  function drawPickupDrop(o, z) {
    if (z < -3) return;
    const bob = reduceMotion ? 0 : Math.sin(S.time * 4 + o.bob) * 5;
    const ground = proj(z, o.lane, 0);
    const p = proj(z, o.lane, o.h + bob);
    const r = 11 * L.u * p.s;
    if (o.h < 60) ellipse(ground.x, ground.y, r * 1.1, r * 0.35, 'rgba(0,0,0,0.25)');

    const cy = p.y - r;
    const glow = ctx.createRadialGradient(p.x, cy - r * 0.4, 0, p.x, cy - r * 0.4, r * 2.6);
    glow.addColorStop(0, 'rgba(160, 220, 255, 0.55)');
    glow.addColorStop(1, 'rgba(160, 220, 255, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(p.x - r * 2.6, cy - r * 3, r * 5.2, r * 5.2);

    teardropPath(p.x, cy, r);
    const g = ctx.createLinearGradient(p.x - r, cy - r * 1.6, p.x + r, cy + r);
    g.addColorStop(0, '#B5E3FF');
    g.addColorStop(0.5, BRAND.blue);
    g.addColorStop(1, '#1769B8');
    ctx.fillStyle = g;
    ctx.fill();
    ctx.lineWidth = Math.max(1, 1.6 * L.u * p.s);
    ctx.strokeStyle = '#0F4F8F';
    ctx.stroke();
    ellipse(p.x - r * 0.38, cy - r * 0.35, r * 0.18, r * 0.3, 'rgba(255,255,255,0.85)');
  }

  function drawBucket(o, z) {
    if (z < -3) return;
    const p = proj(z, o.lane, 0);
    const u = L.u * p.s;
    const pulseAmt = reduceMotion ? 0.5 : 0.5 + 0.5 * Math.sin(S.time * 5);

    // Pulsing halo so buckets read as something to grab
    const hy = p.y - 32 * u;
    const halo = ctx.createRadialGradient(p.x, hy, 0, p.x, hy, 70 * u * (1 + pulseAmt * 0.12));
    halo.addColorStop(0, 'rgba(255, 201, 7, 0.55)');
    halo.addColorStop(1, 'rgba(255, 201, 7, 0)');
    ctx.fillStyle = halo;
    ctx.fillRect(p.x - 80 * u, hy - 80 * u, 160 * u, 160 * u);

    ellipse(p.x, p.y, 30 * u, 8 * u, 'rgba(0,0,0,0.3)');

    const wTop = 27 * u, wBot = 20 * u, h = 52 * u;
    const top = p.y - h;
    ctx.lineWidth = Math.max(1, 3 * u);
    ctx.strokeStyle = BRAND.ink;
    ctx.lineJoin = 'round';

    // Handle
    ctx.beginPath();
    ctx.ellipse(p.x, top, wTop * 0.9, 26 * u, 0, Math.PI, 0);
    ctx.stroke();

    // Body
    ctx.beginPath();
    ctx.moveTo(p.x - wTop, top);
    ctx.lineTo(p.x + wTop, top);
    ctx.lineTo(p.x + wBot, p.y);
    ctx.lineTo(p.x - wBot, p.y);
    ctx.closePath();
    const g = ctx.createLinearGradient(p.x - wTop, 0, p.x + wTop, 0);
    g.addColorStop(0, '#FFE066');
    g.addColorStop(0.55, BRAND.yellow);
    g.addColorStop(1, '#D9A600');
    ctx.fillStyle = g;
    ctx.fill();
    ctx.stroke();

    // Two bands around the bucket
    ctx.lineWidth = Math.max(1, 2 * u);
    for (const t of [0.3, 0.72]) {
      const y = top + h * t;
      const w = lerp(wTop, wBot, t);
      ctx.beginPath();
      ctx.moveTo(p.x - w, y);
      ctx.lineTo(p.x + w, y);
      ctx.stroke();
    }

    // Rim with water inside
    ellipse(p.x, top, wTop, 7 * u, BRAND.ink);
    ellipse(p.x, top + 1 * u, wTop * 0.82, 4.6 * u, BRAND.blue);
  }

  function drawRock(o, z) {
    if (z < -3) return;
    const p = proj(z, o.lane, 0);
    const w = 0.34 * L.lane * p.s;
    const h = o.height * L.u * p.s;
    ellipse(p.x, p.y, w * 1.15, w * 0.24, 'rgba(0,0,0,0.3)');

    ctx.beginPath();
    o.shape.forEach((pt, i) => {
      const x = p.x + pt[0] * w;
      const y = p.y - pt[1] * h;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.closePath();
    const g = ctx.createLinearGradient(p.x - w, p.y - h, p.x + w * 0.6, p.y);
    g.addColorStop(0, '#CDBFA9');
    g.addColorStop(1, '#6F6457');
    ctx.fillStyle = g;
    ctx.fill();
    ctx.lineWidth = Math.max(1, 3 * L.u * p.s);
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#2A241F';
    ctx.stroke();
    ellipse(p.x - w * 0.3, p.y - h * 0.68, w * 0.2, h * 0.1, 'rgba(255,255,255,0.35)');
  }

  function drawMud(o, z) {
    if (z < -3) return;
    const near = proj(z - o.half, o.lane, 0);
    const far = proj(z + o.half, o.lane, 0);
    const c = proj(z, o.lane, 0);
    const rx = 0.42 * L.lane * c.s;
    const ry = Math.max(1, (near.y - far.y) / 2);
    const cy = (near.y + far.y) / 2;
    const wob = o.wobble;

    // Splashed rim, then the dark puddle, then shine and bubbles
    ellipse(c.x, cy, rx * 1.08, ry * 1.18, '#9A6B3E');
    ellipse(c.x + rx * 0.35, cy + ry * 0.2, rx * 0.55, ry * 0.85, '#9A6B3E');
    ellipse(c.x, cy, rx, ry, '#5A3A1F');
    ellipse(c.x + rx * 0.32, cy + ry * 0.18, rx * 0.48, ry * 0.7, '#5A3A1F');
    ellipse(c.x - rx * 0.3, cy - ry * 0.25, rx * 0.35, ry * 0.22, 'rgba(255, 220, 170, 0.22)');
    const bt = S.time * 2 + wob;
    for (let i = 0; i < 3; i++) {
      const bx = c.x + Math.cos(wob + i * 2.1) * rx * 0.5;
      const by = cy + Math.sin(wob + i * 2.1) * ry * 0.45;
      const br = (2.2 + Math.sin(bt + i) * 0.8) * L.u * c.s * 2;
      ellipse(bx, by, br, br * 0.8, '#7A5130');
    }
  }

  function drawShadow(x, scale, height) {
    const r = 30 * L.u * scale;
    const k = clamp(1 - height / 260, 0.35, 1);
    ellipse(x, L.groundY, r * 1.05 * k, r * 0.28 * k, 'rgba(0,0,0,0.3)');
  }

  function drawPlayer() {
    const x = L.cx + P.x * L.lane;
    const ts = tierScale();

    if (S.mode === 'home' || S.mode === 'starting') {
      const t = S.mode === 'starting' ? clamp(S.turn, 0, 1) : 0;
      const scale = lerp(HOME_SCALE, 1, easeInOut(t)) * ts;
      const hop = Math.sin(S.hop * Math.PI) * 28;
      const breathe = reduceMotion ? 0 : Math.sin(S.time * 2.4) * 0.025;
      drawShadow(x, scale, hop);
      drawAvatar(x, L.groundY - hop * L.u * scale, scale, {
        facing: t < 0.5 ? 'front' : 'back',
        flip: Math.max(0.06, Math.abs(Math.cos(t * Math.PI))),
        wave: S.mode === 'home',
        sx: 1 - breathe, sy: 1 + breathe,
      });
      return;
    }

    if (S.deathType === 'crash') {
      drawSplat(x, ts);
      return;
    }

    const scale = S.growth * ts;
    const air = P.h > 0;
    const sq = S.land * 0.14;
    const feetY = L.groundY - P.h * L.u;
    drawShadow(x, scale, P.h);
    // Blink for a moment after the shield pops
    const blinking = S.invuln > 0 && Math.floor(S.invuln * 12) % 2 === 0;
    if (blinking) ctx.globalAlpha = 0.4;
    drawAvatar(x, feetY, scale, {
      facing: 'back',
      run: S.mode === 'running' || S.speed > 1,
      air,
      pollute: S.pollute,
      sx: 1 + sq + S.pollute * 0.12,
      sy: (air ? 1.06 : 1) - sq - S.pollute * 0.16,
    });
    ctx.globalAlpha = 1;
    if (S.shields > 0 && S.mode === 'running') drawShieldBubble(x, feetY, scale);
  }

  // Easy mode's bubble shield around the droplet
  function drawShieldBubble(x, feetY, scale) {
    const u = L.u * scale;
    const cy = feetY - 50 * u;
    const R = 64 * u * (1 + (reduceMotion ? 0 : Math.sin(S.time * 4) * 0.025));
    const g = ctx.createRadialGradient(x - R * 0.3, cy - R * 0.35, R * 0.1, x, cy, R);
    g.addColorStop(0, 'rgba(255, 255, 255, 0.08)');
    g.addColorStop(0.75, 'rgba(154, 215, 255, 0.12)');
    g.addColorStop(1, 'rgba(154, 215, 255, 0.45)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, cy, R, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 2.5 * u;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.75)';
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, cy, R * 0.8, Math.PI * 1.1, Math.PI * 1.45);
    ctx.lineWidth = 4 * u;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.lineCap = 'round';
    ctx.stroke();
  }

  function drawSplat(x, scale) {
    const u = L.u * scale;
    const y = L.groundY;
    ctx.globalAlpha = 0.85;
    ellipse(x, y, 46 * u, 12 * u, '#1769B8');
    ellipse(x - 30 * u, y + 4 * u, 14 * u, 5 * u, BRAND.blue);
    ellipse(x + 34 * u, y - 3 * u, 12 * u, 4 * u, BRAND.blue);
    ellipse(x + 8 * u, y + 9 * u, 10 * u, 3.5 * u, BRAND.blue);
    ellipse(x - 6 * u, y - 2 * u, 22 * u, 6 * u, '#7CC6FF');
    ctx.globalAlpha = 1;
  }

  // A four-point sparkle (Wellspring checkpoint)
  function sparkle(x, y, s) {
    ctx.beginPath();
    ctx.moveTo(x, y - s);
    ctx.quadraticCurveTo(x, y, x + s, y);
    ctx.quadraticCurveTo(x, y, x, y + s);
    ctx.quadraticCurveTo(x, y, x - s, y);
    ctx.quadraticCurveTo(x, y, x, y - s);
    ctx.fillStyle = BRAND.yellow;
    ctx.fill();
    ellipse(x, y, s * 0.22, s * 0.22, '#FFFFFF');
  }

  // The droplet character. (x, groundY) is the point between its feet.
  // o.tier picks which checkpoint look to draw (defaults to the player's current checkpoint).
  function drawAvatar(x, groundY, scale, o) {
    const tier = o.tier ?? S.tier;
    const time = o.time ?? S.time;
    const u = (o.unit ?? L.u) * scale;
    const r = 30 * u;
    const leg = 13 * u;
    const cy = -leg - r;               // center of the round part of the body
    const pol = o.pollute || 0;
    const strong = tier >= 4;          // River: thicker arms and legs
    const golden = tier >= 5;          // Wellspring: gold outline and glow
    const outline = mixColor(golden ? '#D99A00' : '#0F4F8F', '#3A2512', pol);
    const limb = mixColor('#1769B8', '#4A3018', pol);

    ctx.save();
    ctx.translate(x, groundY);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // River: water ripples spreading out on the ground (drawn before the turn-around squish)
    if (tier >= 4 && pol === 0) {
      for (let i = 0; i < 2; i++) {
        const k = reduceMotion ? 0.4 + i * 0.3 : (time * 0.8 + i * 0.5) % 1;
        ctx.globalAlpha = (1 - k) * 0.6;
        ctx.strokeStyle = '#9AD7FF';
        ctx.lineWidth = 2.4 * u;
        ctx.beginPath();
        ctx.ellipse(0, 0, r * (0.9 + k * 0.9), r * (0.24 + k * 0.24), 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

    ctx.scale((o.flip ?? 1) * (o.sx ?? 1), o.sy ?? 1);

    // Wellspring: warm glow behind the body
    if (golden && pol < 0.5) {
      const glow = ctx.createRadialGradient(0, cy - r * 0.3, r * 0.6, 0, cy - r * 0.3, r * 2.3);
      glow.addColorStop(0, 'rgba(255, 201, 7, 0.5)');
      glow.addColorStop(1, 'rgba(255, 201, 7, 0)');
      ctx.fillStyle = glow;
      ctx.fillRect(-r * 2.3, cy - r * 2.6, r * 4.6, r * 4.6);
    }

    // Legs + feet (Splash: yellow running shoes)
    ctx.strokeStyle = limb;
    ctx.lineWidth = (strong ? 10 : 8) * u;
    for (let i = 0; i < 2; i++) {
      const lx = (i ? 1 : -1) * r * 0.36;
      let lift = 0;
      if (o.air) lift = 7 * u;
      else if (o.run) lift = Math.max(0, Math.sin(P.phase + i * Math.PI)) * 10 * u;
      ctx.strokeStyle = limb;
      ctx.lineWidth = (strong ? 10 : 8) * u;
      ctx.beginPath();
      ctx.moveTo(lx, -leg - 2 * u);
      ctx.lineTo(lx, -3 * u - lift);
      ctx.stroke();
      if (tier >= 2) {
        ellipse(lx, -3.5 * u - lift, 8.5 * u, 5 * u, mixColor(BRAND.yellow, '#8D6239', pol));
        ctx.lineWidth = 1.8 * u;
        ctx.strokeStyle = BRAND.ink;
        ctx.stroke();
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(lx - 7 * u, -2.4 * u - lift, 14 * u, 1.6 * u);   // white sole stripe
      } else {
        ellipse(lx, -2.5 * u - lift, 6.5 * u, 3.8 * u, limb);
      }
    }

    // Arms: tucked behind the body when running away from us, in front when facing us
    const shoulderY = cy - r * 0.05;
    const armW = (strong ? 9.5 : 7) * u;
    const handR = (strong ? 6 : 4.8) * u;
    const arm = (sx, ex, ey) => {
      ctx.strokeStyle = limb;
      ctx.lineWidth = armW;
      ctx.beginPath();
      ctx.moveTo(sx, shoulderY);
      ctx.lineTo(ex, ey);
      ctx.stroke();
      ellipse(ex, ey, handR, handR, limb);
    };
    const drawArms = () => {
      if (o.wave) {
        const a = -0.85 + (reduceMotion ? 0 : Math.sin(time * 7) * 0.4);
        arm(r * 0.78, r * 0.78 + Math.cos(a) * 30 * u, shoulderY + Math.sin(a) * 30 * u);
        arm(-r * 0.78, -r * 1.14, shoulderY + r * 0.62);
      } else if (o.run) {
        const sw = Math.sin(P.phase) * 7 * u;
        arm(-r * 0.8, -r * 1.12, shoulderY + r * 0.35 + sw);
        arm(r * 0.8, r * 1.12, shoulderY + r * 0.35 - sw);
      } else {
        arm(-r * 0.78, -r * 1.14, shoulderY + r * 0.62);
        arm(r * 0.78, r * 1.14, shoulderY + r * 0.62);
      }
    };
    if (o.facing !== 'front') drawArms();

    // Body
    teardropPath(0, cy, r);
    const g = ctx.createLinearGradient(-r, cy - r * 1.6, r, cy + r);
    g.addColorStop(0, mixColor('#B5E3FF', '#C4925A', pol));
    g.addColorStop(0.45, mixColor(BRAND.blue, '#875427', pol));
    g.addColorStop(1, mixColor('#1769B8', '#4E2E12', pol));
    ctx.fillStyle = g;
    ctx.fill();
    ctx.lineWidth = (golden ? 3.4 : 2.6) * u;
    ctx.strokeStyle = outline;
    ctx.stroke();

    // Droplet checkpoint: yellow sweatband with tails tied at the side
    if (tier >= 1) {
      const bandTop = cy - r * 0.82;
      const bandH = r * 0.24;
      const bandColor = mixColor(BRAND.yellow, '#9C7A2A', pol);
      ctx.save();
      teardropPath(0, cy, r);
      ctx.clip();
      ctx.fillStyle = bandColor;
      ctx.fillRect(-r * 1.2, bandTop, r * 2.4, bandH);
      ctx.fillStyle = 'rgba(21, 19, 15, 0.22)';
      ctx.fillRect(-r * 1.2, bandTop + bandH * 0.7, r * 2.4, bandH * 0.3);
      ctx.restore();
      teardropPath(0, cy, r);
      ctx.lineWidth = (golden ? 3.4 : 2.6) * u;
      ctx.strokeStyle = outline;
      ctx.stroke();

      // Knot on the side with two short ribbon ends hanging down
      const kx = r * 0.72, ky = bandTop + bandH / 2;
      const flutter = reduceMotion ? 0 : Math.sin(time * 14) * 2 * u * (o.run ? 1 : 0.4);
      for (const [w, c] of [[5.6 * u, BRAND.ink], [3.4 * u, bandColor]]) {
        ctx.strokeStyle = c;
        ctx.lineWidth = w;
        ctx.beginPath();
        ctx.moveTo(kx, ky);
        ctx.quadraticCurveTo(kx + 7 * u, ky + 3 * u, kx + 10 * u + flutter, ky + 11 * u);
        ctx.moveTo(kx, ky);
        ctx.quadraticCurveTo(kx + 3 * u, ky + 6 * u, kx + 3 * u - flutter, ky + 14 * u);
        ctx.stroke();
      }
      ellipse(kx, ky, 3.4 * u, 3.4 * u, bandColor);
      ctx.lineWidth = 1.6 * u;
      ctx.strokeStyle = BRAND.ink;
      ctx.stroke();
    }

    // Shine
    ctx.save();
    ctx.translate(-r * 0.42, cy - r * 0.42);
    ctx.rotate(-0.45);
    ellipse(0, 0, r * 0.13, r * 0.26, `rgba(255,255,255,${0.85 - pol * 0.5})`);
    ctx.restore();
    if (tier < 1) ellipse(-r * 0.2, cy - r * 1.02, r * 0.07, r * 0.07, `rgba(255,255,255,${0.85 - pol * 0.5})`);

    // Face (only when facing the player)
    if (o.facing === 'front') {
      const blink = (time % 3.7) < 0.12;
      const ey = cy - r * 0.02;
      ctx.strokeStyle = BRAND.ink;
      ctx.lineWidth = 2.6 * u;
      for (const s of [-1, 1]) {
        const ex = s * r * 0.36;
        if (blink) {
          ctx.beginPath();
          ctx.moveTo(ex - r * 0.15, ey);
          ctx.lineTo(ex + r * 0.15, ey);
          ctx.stroke();
        } else {
          ellipse(ex, ey, r * 0.2, r * 0.25, '#FFFFFF');
          ellipse(ex + r * 0.03, ey + r * 0.04, r * 0.11, r * 0.13, BRAND.ink);
          ellipse(ex + r * 0.07, ey - r * 0.03, r * 0.04, r * 0.04, '#FFFFFF');
        }
        // Stream checkpoint: determined eyebrows
        if (tier >= 3) {
          ctx.lineWidth = 3.2 * u;
          ctx.beginPath();
          ctx.moveTo(s * r * 0.56, ey - r * 0.36);
          ctx.lineTo(s * r * 0.18, ey - r * 0.27);
          ctx.stroke();
          ctx.lineWidth = 2.6 * u;
        }
        ellipse(s * r * 0.62, cy + r * 0.26, r * 0.13, r * 0.08, 'rgba(241, 96, 97, 0.55)');
      }
      ctx.beginPath();
      ctx.arc(0, cy + r * 0.22, r * 0.17, 0.15 * Math.PI, 0.85 * Math.PI);
      ctx.stroke();
      drawArms();
    }

    // Wellspring: sparkles circling the droplet
    if (golden && pol < 0.5) {
      for (let i = 0; i < 3; i++) {
        const a = time * 1.6 + i * 2.094;
        const s = (4.2 + Math.sin(time * 5 + i) * 1.2) * u;
        sparkle(Math.cos(a) * r * 1.3, cy - r * 0.45 + Math.sin(a) * r * 0.55, s);
      }
    }
    ctx.restore();
  }

  function drawParticles(groundLayer) {
    for (const p of S.particles) {
      if (!!p.ground !== groundLayer) continue;
      ctx.globalAlpha = clamp(1 - p.life / p.max, 0, 1);
      ellipse(p.x, p.y, p.r, p.r, p.color);
    }
    ctx.globalAlpha = 1;
  }

  function drawTexts() {
    for (const t of S.texts) {
      const a = clamp(1 - t.life / t.max, 0, 1);
      const size = t.size * L.u * (1 + Math.min(t.life * 3, 0.25));
      ctx.globalAlpha = a;
      ctx.font = `italic 900 ${size}px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = Math.max(3, size * 0.18);
      ctx.strokeStyle = BRAND.ink;
      ctx.lineJoin = 'round';
      ctx.strokeText(t.text, t.x, t.y);
      ctx.fillStyle = BRAND.yellow;
      ctx.fillText(t.text, t.x, t.y);
    }
    ctx.globalAlpha = 1;
  }

  /* ---------- 10. Controls ---------- */

  function moveLane(dir) {
    P.lane = clamp(P.lane + dir, -1, 1);
  }

  function jump() {
    if (P.jumping) return;
    P.jumping = true;
    P.vy = (4 * CONFIG.jumpHeight) / CONFIG.jumpTime;
    Sound.play('jump');
  }

  function dive() {
    // Swipe down / arrow down while in the air drops you back to the road faster
    if (P.jumping) P.vy = -(4 * CONFIG.jumpHeight) / CONFIG.jumpTime * 1.3;
  }

  const playing = () => S.mode === 'running' && !S.paused;

  window.addEventListener('keydown', (e) => {
    const k = e.key;
    if ((k === 'm' || k === 'M') && !e.repeat) { toggleSound(); return; }
    if (!screens.checkpoints.hidden) {
      if (k === 'Escape') { closeCheckpoints(); e.preventDefault(); }
      return;
    }
    if (playing()) {
      if (k === 'ArrowLeft' || k === 'a' || k === 'A') { moveLane(-1); e.preventDefault(); }
      else if (k === 'ArrowRight' || k === 'd' || k === 'D') { moveLane(1); e.preventDefault(); }
      else if (k === 'ArrowUp' || k === 'w' || k === 'W' || k === ' ') { if (!e.repeat) jump(); e.preventDefault(); }
      else if (k === 'ArrowDown' || k === 's' || k === 'S') { dive(); e.preventDefault(); }
      else if (k === 'p' || k === 'P' || k === 'Escape') { setPaused(true); e.preventDefault(); }
    } else if (S.mode === 'running' && S.paused) {
      if (k === 'p' || k === 'P' || k === 'Escape') { setPaused(false); e.preventDefault(); }
    } else if (S.mode === 'home' && k === 'Enter' && document.activeElement === document.body) {
      startFromHome();
    } else if (S.mode === 'over' && k === 'Enter' && document.activeElement === document.body) {
      retry();
    }
  });

  // Swipes: fire as soon as the finger has moved far enough, so lane changes feel instant
  let swipe = null;
  gameEl.addEventListener('pointerdown', (e) => {
    if (!playing() || e.target.closest('button, a')) return;
    swipe = { id: e.pointerId, x: e.clientX, y: e.clientY };
  });
  gameEl.addEventListener('pointermove', (e) => {
    if (!swipe || e.pointerId !== swipe.id || !playing()) return;
    const dx = e.clientX - swipe.x;
    const dy = e.clientY - swipe.y;
    const min = 28;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < min) return;
    if (Math.abs(dx) > Math.abs(dy)) moveLane(dx > 0 ? 1 : -1);
    else if (dy < 0) jump();
    else dive();
    // Re-arm from here so one drag can chain moves
    swipe.x = e.clientX;
    swipe.y = e.clientY;
  });
  const endSwipe = () => { swipe = null; };
  gameEl.addEventListener('pointerup', endSwipe);
  gameEl.addEventListener('pointercancel', endSwipe);

  // Buttons
  $('startBtn').addEventListener('click', startFromHome);
  $('avatarBtn').addEventListener('click', showFact);
  ui.factBubble.addEventListener('click', hideFact);
  ui.progressBtn.addEventListener('click', openCheckpoints);
  $('cpClose').addEventListener('click', closeCheckpoints);
  screens.checkpoints.addEventListener('click', (e) => { if (e.target === screens.checkpoints) closeCheckpoints(); });
  $('retryBtn').addEventListener('click', retry);
  $('homeBtn').addEventListener('click', () => { if (S.mode === 'over') showHome(); });
  $('pauseBtn').addEventListener('click', () => setPaused(true));
  $('resumeBtn').addEventListener('click', () => setPaused(false));
  $('quitBtn').addEventListener('click', quitToHome);
  for (const input of diffInputs) {
    input.addEventListener('change', () => {
      if (input.checked) setDifficulty(input.value);
      Sound.play('click');
    });
  }

  // Sound on/off (footer button, in-game button, or the M key). The choice is saved.
  function renderSound() {
    for (const btn of soundBtns) {
      btn.setAttribute('aria-pressed', String(Sound.enabled));
      btn.title = Sound.enabled ? 'Sound is on (M)' : 'Sound is off (M)';
    }
  }
  function toggleSound() {
    stats.sound = !stats.sound;
    Sound.setEnabled(stats.sound);
    saveStats();
    renderSound();
    Sound.play('click');
  }
  for (const btn of soundBtns) {
    btn.addEventListener('click', () => {
      toggleSound();
      if (S.mode === 'running') btn.blur();   // so Space jumps instead of pressing the button again
    });
  }
  renderSound();
  // Browsers block audio until the player interacts, so start the sound engine on the first input
  window.addEventListener('pointerdown', () => Sound.unlock(), { once: true });
  window.addEventListener('keydown', () => Sound.unlock(), { once: true });

  // The home and game over screens leave room at the bottom for the footer
  function measureFooter() {
    gameEl.style.setProperty('--footer-h', `${footerEl.offsetHeight}px`);
  }
  if ('ResizeObserver' in window) new ResizeObserver(measureFooter).observe(footerEl);
  measureFooter();

  // Official logo on the Give button: switch it on once the image has loaded.
  // If it can't load (offline, blocked), the plain drop icon stays.
  function useLogo() { giveEl.classList.add('has-logo'); }
  if (logoEl) {
    if (logoEl.complete && logoEl.naturalWidth > 0) useLogo();
    else logoEl.addEventListener('load', useLogo, { once: true });
  }

  // Pause automatically if the player switches tabs or apps
  document.addEventListener('visibilitychange', () => { if (document.hidden) setPaused(true); });
  window.addEventListener('blur', () => setPaused(true));
  window.addEventListener('resize', resize);

  /* ---------- Main loop ---------- */

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    update(dt);
    render();
    requestAnimationFrame(frame);
  }

  resize();
  showHome();
  spawnDecor(S.dist + CONFIG.viewDistance + 40);
  requestAnimationFrame(frame);
  // Text can change size once the web font arrives, so re-check the Give button's spot
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(placeGiveButton);
})();
