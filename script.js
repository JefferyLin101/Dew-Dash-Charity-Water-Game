/* =========================================================
   Dew Dash — a three-lane runner inspired by charity: water
   ---------------------------------------------------------
   How the code is organized (top to bottom):
     1. Settings you can tweak (speed, spawn rates, jump)
     2. Facts the droplet shares on the home screen
     3. Saved stats (Current Progress, High Score, Last Score)
     4. Game state + screen layout / perspective math
     5. Spawning drops, obstacles, buckets, and scenery
     6. Game flow (start, run, die, game over, pause)
     7. Drawing everything on the canvas
     8. Controls (keyboard + swipe) and the main loop
   ========================================================= */

(() => {
  'use strict';

  /* ---------- 1. Settings ---------- */

  const CONFIG = {
    baseSpeed: 17,          // track units per second when a run starts
    maxSpeed: 42,           // top speed
    acceleration: 0.33,     // speed added every second, so top speed arrives after ~75 s
    viewDistance: 110,      // how far ahead things appear
    camDepth: 9,            // perspective strength (bigger = flatter road)

    firstObstacleAt: 45,    // free running room at the start of a run
    // Gap between obstacle rows, in SECONDS, so the player always gets reaction time.
    // Each value is [easy, hard]; the game slides from easy to hard over 75 s.
    rowGapMin: [0.95, 0.5],
    rowGapExtra: [0.6, 0.35],
    doubleObstacleChance: [0.12, 0.45], // chance a row blocks two lanes instead of one

    firstBucketAfter: 7.5,  // seconds into the run
    bucketEvery: [9, 15],   // seconds between buckets (random in this range)

    dropSpacing: 2.8,       // distance between drops in a line
    dropLine: [5, 10],      // how many drops in a line
    dropGap: [5, 12],       // empty track between lines

    jumpHeight: 150,        // in "u" units (1u = 1/120 of a lane's width)
    jumpTime: 0.62,         // seconds in the air
    laneSwitchSpeed: 9,     // lanes per second
  };

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

  /* ---------- 2. Facts (tap the droplet on the home screen) ---------- */
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

  /* ---------- 3. Saved stats ---------- */

  const STORE_KEY = 'dewdash-stats-v1';

  function loadStats() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        const d = JSON.parse(raw);
        return { progress: +d.progress || 0, high: +d.high || 0, last: +d.last || 0, runs: +d.runs || 0 };
      }
    } catch (e) { /* storage blocked (private window etc.) — play without saving */ }
    return { progress: 0, high: 0, last: 0, runs: 0 };
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

  /* ---------- 4. DOM, state, and layout ---------- */

  const $ = (id) => document.getElementById(id);
  const gameEl = $('game');
  const canvas = $('scene');
  const ctx = canvas.getContext('2d');
  const screens = { home: $('homeScreen'), over: $('gameOverScreen'), pause: $('pauseScreen') };
  const hudEl = $('hud');
  const hintEl = $('hint');
  const ui = {
    water: $('waterSize'), score: $('totalScore'),
    waterBox: $('hudWater'), scoreBox: $('hudScore'),
    progress: $('statProgress'), high: $('statHigh'), last: $('statLast'),
    overScore: $('overScore'), overNote: $('overNote'), overBest: $('overBest'),
    factBubble: $('factBubble'), factText: $('factText'), factSource: $('factSource'),
  };

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const touchFirst = window.matchMedia('(pointer: coarse)').matches;
  const HOME_SCALE = 1.25;   // the droplet is drawn a bit bigger on the home screen

  // Everything the game tracks
  const S = {
    mode: 'home',        // 'home' | 'starting' | 'running' | 'dying' | 'over'
    paused: false,
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
    hintShown: false,
  };

  // The player droplet
  const P = { lane: 0, x: 0, h: 0, vy: 0, jumping: false, phase: 0 };

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
    L.horizonY = L.H * (portrait ? 0.33 : 0.36);
    L.groundY = L.H * 0.8;
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

  function placeAvatarButton() {
    const h = 104 * L.u * HOME_SCALE;
    const w = 86 * L.u * HOME_SCALE;
    const top = L.groundY - h;
    gameEl.style.setProperty('--avatar-x', `${L.cx}px`);
    gameEl.style.setProperty('--avatar-top', `${top}px`);
    gameEl.style.setProperty('--avatar-w', `${w}px`);
    gameEl.style.setProperty('--avatar-h', `${h}px`);
    gameEl.style.setProperty('--bubble-bottom', `${L.H - top + 14}px`);
  }

  /* ---------- 5. Spawning ---------- */

  // 0 at the start of a run, 1 after 75 seconds
  const difficulty = () => clamp(S.runTime / 75, 0, 1);
  const targetSpeed = () => Math.min(CONFIG.maxSpeed, CONFIG.baseSpeed + CONFIG.acceleration * S.runTime);
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
    const d = difficulty();
    const count = Math.random() < lerp(...CONFIG.doubleObstacleChance, d) ? 2 : 1;
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
    const d = difficulty();

    // Buckets and obstacles are planned a little further out so drop lines can react to them
    while (S.nextBucketPos < ahead + 25) {
      placeBucket(S.nextBucketPos);
      S.nextBucketPos += rand(...CONFIG.bucketEvery) * targetSpeed();
    }
    while (S.nextRowPos < ahead + 25) {
      placeRow(S.nextRowPos);
      const gapSeconds = lerp(...CONFIG.rowGapMin, d) + Math.random() * lerp(...CONFIG.rowGapExtra, d);
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

  /* ---------- 6. Game flow ---------- */

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
    hudEl.hidden = true;
    hideHint();
    S.objects = [];
    S.particles = [];
    S.texts = [];
    P.lane = 0; P.x = 0; P.h = 0; P.vy = 0; P.jumping = false;
    S.turn = 0; S.pollute = 0; S.deathType = null; S.growth = 1; S.speed = 0;
    renderStats();
  }

  function renderStats() {
    ui.progress.textContent = fmt(stats.progress);
    ui.high.textContent = fmt(stats.high);
    ui.last.textContent = fmt(stats.last);
  }

  function startFromHome() {
    if (S.mode !== 'home') return;
    hideFact();
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    setMode('starting');
    S.turn = 0;
    screens.home.classList.add('is-leaving');
    setTimeout(() => { if (S.mode !== 'home') screens.home.hidden = true; }, 380);
  }

  function beginRun() {
    setMode('running');
    S.paused = false;
    S.objects = [];
    S.particles = [];
    S.texts = [];
    S.water = 0; S.score = 0; S.lostWater = 0;
    S.runTime = 0; S.speed = 0;
    S.nextRowPos = S.dist + CONFIG.firstObstacleAt;
    S.nextDropPos = S.dist + 20;
    S.nextBucketPos = S.dist + CONFIG.baseSpeed * CONFIG.firstBucketAfter;
    S.dropLine = { lane: 0, left: 0 };
    P.lane = 0; P.x = 0; P.h = 0; P.vy = 0; P.jumping = false;
    S.deathType = null; S.deathT = 0; S.pollute = 0; S.shake = 0; S.growth = 1; S.turn = 1;
    gameEl.classList.remove('is-gray');
    screens.over.hidden = true;
    hudEl.hidden = false;
    updateHud(true);
    if (!S.hintShown) showHint();
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

  function commitStats(score) {
    const best = score > stats.high && score > 0;
    stats.progress += score;
    stats.last = score;
    stats.high = Math.max(stats.high, score);
    stats.runs += 1;
    saveStats();
    return best;
  }

  function endRun() {
    setMode('over');
    hudEl.hidden = true;
    hideHint();
    const best = commitStats(S.score);
    gameEl.classList.add('is-gray');
    ui.overScore.textContent = fmt(S.score);
    ui.overBest.hidden = !best;
    const lost = S.lostWater;
    if (lost === 0) {
      ui.overNote.textContent = 'Nothing spilled. Every drop you picked up made it into a bucket.';
    } else if (S.deathType === 'crash') {
      ui.overNote.textContent = `You hit a rock and spilled ${fmt(lost)} drop${lost === 1 ? '' : 's'} you hadn't stored yet.`;
    } else {
      ui.overNote.textContent = `Mud polluted the ${fmt(lost)} drop${lost === 1 ? '' : 's'} you were carrying.`;
    }
    screens.over.hidden = false;
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

  /* ---------- HUD, hint, and facts ---------- */

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

  // Facts are dealt from a shuffled deck so every fact shows up before any repeats
  let factDeck = [];
  let factTimer = 0;
  function showFact() {
    if (S.mode !== 'home') return;
    if (!factDeck.length) factDeck = shuffle(FACTS.map((_, i) => i));
    const fact = FACTS[factDeck.pop()];
    ui.factText.textContent = fact.text;
    ui.factSource.textContent = `Source: ${fact.source}`;
    ui.factBubble.hidden = false;
    screens.home.classList.add('has-fact');
    pulseClass(ui.factBubble, 'pop');
    S.hop = 1;
    clearTimeout(factTimer);
    factTimer = setTimeout(hideFact, 8000);
  }
  function hideFact() {
    clearTimeout(factTimer);
    ui.factBubble.hidden = true;
    screens.home.classList.remove('has-fact');
  }
  function pulseClass(el, cls) {
    el.classList.remove(cls);
    void el.offsetWidth;
    el.classList.add(cls);
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
    const targetGrowth = 1 + Math.min(S.water, 40) * 0.008;
    S.growth += (targetGrowth - S.growth) * Math.min(1, dt * 8);

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

      if (o.kind === 'drop') {
        if (Math.abs(P.h + 45 - o.h) < 70) collectDrop(o);
      } else if (o.kind === 'bucket') {
        if (P.h < 90) hitBucket(o);
      } else if (o.kind === 'rock') {
        if (P.h < o.height - 6) { o.hitPlayer = true; die('crash'); return; }
      } else if (o.kind === 'mud') {
        if (P.h < 10) { o.hitPlayer = true; die('pollute'); return; }
      }
    }
  }

  function collectDrop(o) {
    o.done = true;
    S.water += 1;
    updateHud();
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
    } else {
      floatText(x, y - 60 * L.u, 'Empty bucket', 22);
    }
    updateHud();
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

  /* ---------- 7. Drawing ---------- */

  function render() {
    ctx.setTransform(L.dpr, 0, 0, L.dpr, 0, 0);
    ctx.save();
    if (S.shake > 0 && !reduceMotion) {
      ctx.translate((Math.random() - 0.5) * S.shake * 30, (Math.random() - 0.5) * S.shake * 30);
    }
    drawSky();
    drawGround();
    drawRoad();

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

    drawEffects();
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

    if (S.mode === 'home' || S.mode === 'starting') {
      const t = S.mode === 'starting' ? clamp(S.turn, 0, 1) : 0;
      const scale = lerp(HOME_SCALE, 1, easeInOut(t));
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
      drawSplat(x);
      return;
    }

    const scale = S.growth;
    const air = P.h > 0;
    const sq = S.land * 0.14;
    drawShadow(x, scale, P.h);
    drawAvatar(x, L.groundY - P.h * L.u, scale, {
      facing: 'back',
      run: S.mode === 'running' || S.speed > 1,
      air,
      pollute: S.pollute,
      sx: 1 + sq + S.pollute * 0.12,
      sy: (air ? 1.06 : 1) - sq - S.pollute * 0.16,
    });
  }

  function drawSplat(x) {
    const u = L.u;
    const y = L.groundY;
    ctx.globalAlpha = 0.85;
    ellipse(x, y, 46 * u, 12 * u, '#1769B8');
    ellipse(x - 30 * u, y + 4 * u, 14 * u, 5 * u, BRAND.blue);
    ellipse(x + 34 * u, y - 3 * u, 12 * u, 4 * u, BRAND.blue);
    ellipse(x + 8 * u, y + 9 * u, 10 * u, 3.5 * u, BRAND.blue);
    ellipse(x - 6 * u, y - 2 * u, 22 * u, 6 * u, '#7CC6FF');
    ctx.globalAlpha = 1;
  }

  // The droplet character. (x, groundY) is the point between its feet.
  function drawAvatar(x, groundY, scale, o) {
    const u = L.u * scale;
    const r = 30 * u;
    const leg = 13 * u;
    const cy = -leg - r;               // center of the round part of the body
    const pol = o.pollute || 0;
    const outline = mixColor('#0F4F8F', '#3A2512', pol);
    const limb = mixColor('#1769B8', '#4A3018', pol);

    ctx.save();
    ctx.translate(x, groundY);
    ctx.scale((o.flip ?? 1) * (o.sx ?? 1), o.sy ?? 1);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Legs
    ctx.strokeStyle = limb;
    ctx.lineWidth = 8 * u;
    for (let i = 0; i < 2; i++) {
      const lx = (i ? 1 : -1) * r * 0.36;
      let lift = 0;
      if (o.air) lift = 7 * u;
      else if (o.run) lift = Math.max(0, Math.sin(P.phase + i * Math.PI)) * 10 * u;
      ctx.beginPath();
      ctx.moveTo(lx, -leg - 2 * u);
      ctx.lineTo(lx, -3 * u - lift);
      ctx.stroke();
      ellipse(lx, -2.5 * u - lift, 6.5 * u, 3.8 * u, limb);
    }

    // Arms: tucked behind the body when running away from us, in front when facing us
    const shoulderY = cy - r * 0.05;
    const arm = (sx, ex, ey) => {
      ctx.strokeStyle = limb;
      ctx.lineWidth = 7 * u;
      ctx.beginPath();
      ctx.moveTo(sx, shoulderY);
      ctx.lineTo(ex, ey);
      ctx.stroke();
      ellipse(ex, ey, 4.8 * u, 4.8 * u, limb);
    };
    const drawArms = () => {
      if (o.wave) {
        const a = -0.85 + (reduceMotion ? 0 : Math.sin(S.time * 7) * 0.4);
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
    ctx.lineWidth = 2.6 * u;
    ctx.strokeStyle = outline;
    ctx.stroke();

    // Shine
    ctx.save();
    ctx.translate(-r * 0.42, cy - r * 0.48);
    ctx.rotate(-0.45);
    ellipse(0, 0, r * 0.14, r * 0.3, `rgba(255,255,255,${0.85 - pol * 0.5})`);
    ctx.restore();
    ellipse(-r * 0.2, cy - r * 1.02, r * 0.07, r * 0.07, `rgba(255,255,255,${0.85 - pol * 0.5})`);

    // Face (only when facing the player)
    if (o.facing === 'front') {
      const blink = (S.time % 3.7) < 0.12;
      const ey = cy - r * 0.02;
      for (const s of [-1, 1]) {
        const ex = s * r * 0.36;
        if (blink) {
          ctx.strokeStyle = BRAND.ink;
          ctx.lineWidth = 2.6 * u;
          ctx.beginPath();
          ctx.moveTo(ex - r * 0.15, ey);
          ctx.lineTo(ex + r * 0.15, ey);
          ctx.stroke();
        } else {
          ellipse(ex, ey, r * 0.2, r * 0.25, '#FFFFFF');
          ellipse(ex + r * 0.03, ey + r * 0.04, r * 0.11, r * 0.13, BRAND.ink);
          ellipse(ex + r * 0.07, ey - r * 0.03, r * 0.04, r * 0.04, '#FFFFFF');
        }
        ellipse(s * r * 0.62, cy + r * 0.26, r * 0.13, r * 0.08, 'rgba(241, 96, 97, 0.55)');
      }
      ctx.strokeStyle = BRAND.ink;
      ctx.lineWidth = 2.6 * u;
      ctx.beginPath();
      ctx.arc(0, cy + r * 0.22, r * 0.17, 0.15 * Math.PI, 0.85 * Math.PI);
      ctx.stroke();
      drawArms();
    }
    ctx.restore();
  }

  function drawEffects() {
    for (const p of S.particles) {
      ctx.globalAlpha = clamp(1 - p.life / p.max, 0, 1);
      ellipse(p.x, p.y, p.r, p.r, p.color);
    }
    ctx.globalAlpha = 1;
    for (const t of S.texts) {
      const a = clamp(1 - t.life / t.max, 0, 1);
      const size = t.size * L.u * (1 + Math.min(t.life * 3, 0.25));
      ctx.globalAlpha = a;
      ctx.font = `italic 900 ${size}px Montserrat, "Avenir Next", system-ui, sans-serif`;
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

  /* ---------- 8. Controls ---------- */

  function moveLane(dir) {
    P.lane = clamp(P.lane + dir, -1, 1);
  }

  function jump() {
    if (P.jumping) return;
    P.jumping = true;
    P.vy = (4 * CONFIG.jumpHeight) / CONFIG.jumpTime;
  }

  function dive() {
    // Swipe down / arrow down while in the air drops you back to the road faster
    if (P.jumping) P.vy = -(4 * CONFIG.jumpHeight) / CONFIG.jumpTime * 1.3;
  }

  const playing = () => S.mode === 'running' && !S.paused;

  window.addEventListener('keydown', (e) => {
    const k = e.key;
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
  $('retryBtn').addEventListener('click', retry);
  $('homeBtn').addEventListener('click', () => { if (S.mode === 'over') showHome(); });
  $('pauseBtn').addEventListener('click', () => setPaused(true));
  $('resumeBtn').addEventListener('click', () => setPaused(false));
  $('quitBtn').addEventListener('click', quitToHome);

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
})();
