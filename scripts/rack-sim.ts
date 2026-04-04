#!/usr/bin/env bun
// ─── Rack Packet Stress Test Simulator ─────────────────────
// Headless timing simulation of the rack view packet scheduling engine.
// Mirrors topology, routing, scheduling from view-rack.js without DOM/SVG.
//
// Usage: bun run scripts/rack-sim.ts [mode] [count]
//   mode: "ingress" (default) or "rotation"
//   count: number of badges (default: runs multiple counts)
//
// Modes:
//   ingress  — Phase 2c: initial badge fill with dual-cloud bias sweep
//   rotation — Phase 3: perpetual rotation cycle (removal + ingress)

const args = process.argv.slice(2);
const MODE = args.includes('rotation') ? 'rotation' : 'ingress';
const countArg = args.find(a => /^\d+$/.test(a));

const INGRESS_BADGE_COUNTS = countArg ? [parseInt(countArg)] : [50, 100, 200, 500];
const ROTATION_POOL_SIZES = countArg ? [parseInt(countArg)] : [60, 100, 200, 500];

// SAME_SIDE_BIAS: probability badge enters from its "home" cloud (ingress mode sweeps this)
const BIAS_RATIOS = [1.0, 0.8, 0.7, 0.6, 0.5];
const ROTATION_BIAS = 0.7; // Fixed at 70% for rotation mode

// ─── Topology (mirrored from view-rack.js) ─────────────────

interface DivTopo {
  fw: string;
  core: string;
  switchCable: number;
  rackSide: 'A' | 'B';
  viaVpn?: boolean;
  panelCapacity: number;
}

const DIV_TOPOLOGY: Record<string, DivTopo> = {
  'IT':        { fw: 'fw-a', core: 'core-a', switchCable: 9,  rackSide: 'A', panelCapacity: 12 },
  'Punk':      { fw: 'fw-a', core: 'core-a', switchCable: 10, rackSide: 'A', panelCapacity: 12 },
  'Office':    { fw: 'fw-b', core: 'core-b', switchCable: 12, rackSide: 'B', panelCapacity: 12 },
  'Corporate': { fw: 'fw-b', core: 'core-b', switchCable: 13, rackSide: 'B', panelCapacity: 12 },
  '_custom':   { fw: 'fw-b', core: 'core-b', switchCable: 14, rackSide: 'B', viaVpn: true, panelCapacity: 24 },
};

const ADJACENCY_CABLES: Record<string, number> = {
  'cloud-a→fw-a': 15, 'cloud-b→fw-b': 16,
  'fw-a→core-a': 3, 'fw-b→core-b': 4,
  'wifi-ap→wlc': 8, 'wlc→core-a': 7,
  'core-a→core-b': 0, 'core-b→core-a': 1, // trunk 3 is cable 2
  'core-a→brs': 5, 'brs→core-a': 6,
  'core-b→brs-02': 17, 'brs-02→core-b': 18,
  'core-b→vpn': 11, 'vpn→sw-custom': 14,
  'core-a→storage': 19, 'storage→core-a': 20,
};

const DIVISIONS = ['IT', 'Punk', 'Office', 'Corporate', '_custom'];

// Estimated cable durations in ms (dramatic pacing)
const CABLE_DURATIONS: Record<number, number> = {
  0: 5000,  // cross-rack A→B
  1: 5000,  // cross-rack B→A
  2: 5000,  // cross-rack trunk 3
  3: 1700,  // FW-A → Core A
  4: 1700,  // FW-B → Core B
  5: 2300,  // Core A → BRS inbound
  6: 2500,  // BRS → Core A outbound
  7: 2400,  // WLC → Core A
  8: 2000,  // WLC → WiFi AP
  9: 3200,  // Core A → IT switch
  10: 3500, // Core A → Punk switch
  11: 2700, // VPN → Core B
  12: 3200, // Core B → Office switch
  13: 3500, // Core B → Corporate switch
  14: 5600, // VPN → Contractors
  15: 1000, // Cloud-A → FW-A
  16: 1000, // Cloud-B → FW-B
  17: 2300, // Core B → BRS-02 inbound
  18: 2500, // BRS-02 → Core B outbound
  19: 1800, // Core A → Storage (short drop)
  20: 1800, // Storage → Core A (return)
};

// ─── Timing Constants ──────────────────────────────────────

const MATERIALIZE_MS = 1200;
const FW_INSPECT_MS = 1200;
const BRS_RENDER_MS = 2500;
const BEAM_DOWN_MS = 2000;
const LAUNCH_INTERVAL_MS = 3000;
const MAX_IN_FLIGHT = 5;

// Phase 3 rotation timing
const REMOVAL_CLI_MS = 1500;     // division switch CLI popup
const REMOVAL_LED_MS = 800;      // LED green → amber → red
const REMOVAL_DEGAUSS_MS = 900;  // hue shimmer + squeeze + pop
const REMOVAL_NOSHUT_MS = 1000;  // no shutdown CLI + LED dim
const REMOVAL_TOTAL_MS = REMOVAL_CLI_MS + REMOVAL_LED_MS + REMOVAL_DEGAUSS_MS + REMOVAL_NOSHUT_MS; // ~4.2s
const CORE_DOWNLOAD_CLI_MS = 1500; // core "download badge.pkg" CLI
const SETTLE_PERIOD_MS = 30000;  // 30s after initial fill before cycling
const STORAGE_DETOUR_CHANCE = 0.15; // 15% of badges get storage side trip
const STORAGE_PAUSE_MS = 1000;   // "writing to disk" pause
const ROTATION_TICK_MS = 5000;   // how often scheduler checks for rotation opportunity

// ─── Route Resolution ──────────────────────────────────────

interface RouteStep {
  type: 'materialize' | 'cable' | 'brs-render' | 'beam-down' | 'place-badge' | 'storage-pause';
  cable?: number;
  from?: string;
  durationMs: number;
  brsId?: string;
}

// Extra trunk cables: 20 = A→B #2, 21 = B→A #2 (same duration as 0/1)
const EXTRA_TRUNK_CABLES = [20, 21];

function getCable(from: string, to: string, trunkCount: number = 3): number {
  if ((from === 'core-a' && to === 'core-b') || (from === 'core-b' && to === 'core-a')) {
    // Distribute across trunk cables (0, 1, 2)
    if (trunkCount === 2) {
      return Math.random() < 0.5 ? 0 : 1;
    } else {
      // 3 trunks: 0 (A→B), 1 (B→A), 2 (bidirectional) — LACP-style
      const r = Math.random();
      return r < 0.33 ? 0 : r < 0.66 ? 1 : 2;
    }
  }
  return ADJACENCY_CABLES[`${from}→${to}`] ?? -1;
}

function resolveRoute(
  divTheme: string,
  sameSideBias: number,
  storageDetour: boolean = false,
  trunkCount: number = 2,
): { steps: RouteStep[]; rackSide: 'A' | 'B'; crossedTrunk: boolean; entrySide: 'A' | 'B'; hasStorage: boolean } | null {
  const topo = DIV_TOPOLOGY[divTheme];
  if (!topo) return null;

  const isWifi = Math.random() < 0.20;
  const steps: RouteStep[] = [];
  let crossedTrunk = false;
  const hasStorage = storageDetour && !isWifi; // WiFi badges skip storage

  let entrySide: 'A' | 'B';
  if (isWifi) {
    entrySide = 'A';
  } else {
    const homeSide = topo.rackSide;
    entrySide = Math.random() < sameSideBias ? homeSide : (homeSide === 'A' ? 'B' : 'A');
  }

  const entryFw = entrySide === 'A' ? 'fw-a' : 'fw-b';
  const entryCore = entrySide === 'A' ? 'core-a' : 'core-b';
  const entryCloud = entrySide === 'A' ? 'cloud-a' : 'cloud-b';

  // Step 1: Materialize
  steps.push({ type: 'materialize', durationMs: MATERIALIZE_MS });

  // Step 2: Entry cables
  if (isWifi) {
    const c1 = getCable('wifi-ap', 'wlc');
    steps.push({ type: 'cable', cable: c1, from: 'wifi-ap', durationMs: CABLE_DURATIONS[c1] || 2000 });
    const c2 = getCable('wlc', 'core-a');
    steps.push({ type: 'cable', cable: c2, from: 'wlc', durationMs: CABLE_DURATIONS[c2] || 2000 });
  } else {
    const c1 = getCable(entryCloud, entryFw);
    steps.push({ type: 'cable', cable: c1, from: entryCloud, durationMs: CABLE_DURATIONS[c1] || 1000 });
    steps.push({ type: 'cable', cable: -1, from: entryFw, durationMs: FW_INSPECT_MS });
    const c2 = getCable(entryFw, entryCore);
    steps.push({ type: 'cable', cable: c2, from: entryFw, durationMs: CABLE_DURATIONS[c2] || 1300 });
  }

  let currentCore = isWifi ? 'core-a' : entryCore;

  // Step 3: BRS side trip
  const brsNode = currentCore === 'core-a' ? 'brs' : 'brs-02';
  const brsId = currentCore === 'core-a' ? 'brs-01' : 'brs-02';
  const c1brs = getCable(currentCore, brsNode);
  steps.push({ type: 'cable', cable: c1brs, from: currentCore, durationMs: CABLE_DURATIONS[c1brs] || 2300 });
  steps.push({ type: 'brs-render', durationMs: BRS_RENDER_MS, brsId });
  const c2brs = getCable(brsNode, currentCore);
  steps.push({ type: 'cable', cable: c2brs, from: brsNode, durationMs: CABLE_DURATIONS[c2brs] || 2500 });

  // Step 3.5: Storage detour (15% chance, only on Rack A side via Core A)
  if (hasStorage) {
    if (currentCore !== 'core-a') {
      const xc = getCable(currentCore, 'core-a', trunkCount);
      steps.push({ type: 'cable', cable: xc, from: currentCore, durationMs: CABLE_DURATIONS[xc] || 5000 });
      currentCore = 'core-a';
      crossedTrunk = true;
    }
    const cs1 = getCable('core-a', 'storage');
    steps.push({ type: 'cable', cable: cs1, from: 'core-a', durationMs: CABLE_DURATIONS[cs1] || 1800 });
    steps.push({ type: 'storage-pause', durationMs: STORAGE_PAUSE_MS });
    const cs2 = getCable('storage', 'core-a');
    steps.push({ type: 'cable', cable: cs2, from: 'storage', durationMs: CABLE_DURATIONS[cs2] || 1800 });
  }

  // Step 4: Cross trunk if needed
  if (currentCore !== topo.core) {
    const xc = getCable(currentCore, topo.core, trunkCount);
    steps.push({ type: 'cable', cable: xc, from: currentCore, durationMs: CABLE_DURATIONS[xc] || 5000 });
    currentCore = topo.core;
    crossedTrunk = true;
  }

  // Step 5: Route to destination switch
  if (topo.viaVpn) {
    const c1 = getCable('core-b', 'vpn');
    steps.push({ type: 'cable', cable: c1, from: 'core-b', durationMs: CABLE_DURATIONS[c1] || 2000 });
    const c2 = getCable('vpn', 'sw-custom');
    steps.push({ type: 'cable', cable: c2, from: 'vpn', durationMs: CABLE_DURATIONS[c2] || 2800 });
  } else {
    steps.push({ type: 'cable', cable: topo.switchCable, from: topo.core, durationMs: CABLE_DURATIONS[topo.switchCable] || 2000 });
  }

  // Step 6: Beam down + place
  steps.push({ type: 'beam-down', durationMs: BEAM_DOWN_MS });
  steps.push({ type: 'place-badge', durationMs: 0 });

  return { steps, rackSide: topo.rackSide, crossedTrunk, entrySide, hasStorage };
}

// ─── Cable simulation helper ───────────────────────────────

interface CableState {
  cableFreeAt: Map<number, number>;
  brsFreeAt: Record<string, number>;
}

interface TransitMetrics {
  cableWaits: number;
  maxCableWaitMs: number;
  perCableWaits: Record<number, { count: number; totalMs: number; maxMs: number }>;
  brsSkips: number;
  brsRenders: Record<string, number>;
  maxBrsQueue: number;
  crossRackWaits: number;
  maxCrossRackWaitMs: number;
  trunkCrossings: number;
  storageDetours: number;
}

function simulateTransit(
  route: ReturnType<typeof resolveRoute>,
  cursor: number,
  state: CableState,
  metrics: TransitMetrics,
): number {
  if (!route) return cursor;

  if (route.crossedTrunk) metrics.trunkCrossings++;
  if (route.hasStorage) metrics.storageDetours++;

  let skipBrs = false;

  for (const step of route.steps) {
    if (step.type === 'brs-render') {
      const brsId = step.brsId || 'brs-01';
      if (state.brsFreeAt[brsId] > cursor) {
        metrics.brsSkips++;
        skipBrs = true;
        continue;
      }
      const concurrent = Object.values(state.brsFreeAt).filter(t => t > cursor).length + 1;
      if (concurrent > metrics.maxBrsQueue) metrics.maxBrsQueue = concurrent;
      state.brsFreeAt[brsId] = cursor + step.durationMs;
      metrics.brsRenders[brsId]++;
      cursor += step.durationMs;
    } else if (step.type === 'cable') {
      if (step.cable == null || step.cable < 0) {
        cursor += step.durationMs;
        continue;
      }
      if (skipBrs && (step.cable === 5 || step.cable === 6 || step.cable === 17 || step.cable === 18)) continue;
      skipBrs = false;

      const freeAt = state.cableFreeAt.get(step.cable) || 0;
      if (freeAt > cursor) {
        const waitMs = freeAt - cursor;
        metrics.cableWaits++;
        if (waitMs > metrics.maxCableWaitMs) metrics.maxCableWaitMs = waitMs;
        if (!metrics.perCableWaits[step.cable]) metrics.perCableWaits[step.cable] = { count: 0, totalMs: 0, maxMs: 0 };
        metrics.perCableWaits[step.cable].count++;
        metrics.perCableWaits[step.cable].totalMs += waitMs;
        if (waitMs > metrics.perCableWaits[step.cable].maxMs) metrics.perCableWaits[step.cable].maxMs = waitMs;
        cursor = freeAt;

        if (step.cable === 0 || step.cable === 1) {
          metrics.crossRackWaits++;
          if (waitMs > metrics.maxCrossRackWaitMs) metrics.maxCrossRackWaitMs = waitMs;
        }
      }

      state.cableFreeAt.set(step.cable, cursor + step.durationMs);
      cursor += step.durationMs;
    } else {
      cursor += step.durationMs;
    }
  }

  return cursor;
}

function freshMetrics(): TransitMetrics {
  return {
    cableWaits: 0, maxCableWaitMs: 0, perCableWaits: {},
    brsSkips: 0, brsRenders: { 'brs-01': 0, 'brs-02': 0 }, maxBrsQueue: 0,
    crossRackWaits: 0, maxCrossRackWaitMs: 0, trunkCrossings: 0, storageDetours: 0,
  };
}

// ═══════════════════════════════════════════════════════════
// INGRESS MODE (Phase 2c — unchanged from previous sim)
// ═══════════════════════════════════════════════════════════

interface IngressResult {
  badgeCount: number;
  sameSideBias: number;
  totalTimeMs: number;
  maxInFlight: number;
  maxWaitMs: number;
  avgTransitMs: number;
  minTransitMs: number;
  maxTransitMs: number;
  patchPanelCounts: Record<string, number>;
  throughputPerSec: number;
  entryDistribution: { A: number; B: number };
  trunkCrossPct: number;
  metrics: TransitMetrics;
}

function simulateIngress(badgeCount: number, sameSideBias: number): IngressResult {
  const badges: { id: number; divTheme: string }[] = [];
  for (let i = 0; i < badgeCount; i++) {
    badges.push({ id: i, divTheme: DIVISIONS[Math.floor(Math.random() * DIVISIONS.length)] });
  }

  const state: CableState = {
    cableFreeAt: new Map(),
    brsFreeAt: { 'brs-01': 0, 'brs-02': 0 },
  };
  const metrics = freshMetrics();
  const patchCounts: Record<string, number> = {};
  const entryDist = { A: 0, B: 0 };

  let simTime = 0;
  let inFlight = 0;
  let maxInFlight = 0;
  let maxWaitMs = 0;
  let totalTransitMs = 0;
  let minTransit = Infinity;
  let maxTransit = 0;
  let lastLaunchRack: string | null = null;
  const queue = [...badges];
  const completionEvents: { time: number; action: () => void }[] = [];

  while (queue.length > 0 || completionEvents.length > 0) {
    completionEvents.sort((a, b) => a.time - b.time);
    while (completionEvents.length > 0 && completionEvents[0].time <= simTime) {
      completionEvents.shift()!.action();
    }

    if (queue.length > 0 && inFlight < MAX_IN_FLIGHT) {
      const preferSide = lastLaunchRack === 'A' ? 'B' : 'A';
      let badgeIdx = -1;
      for (let i = 0; i < queue.length; i++) {
        const topo = DIV_TOPOLOGY[queue[i].divTheme];
        if (topo && topo.rackSide === preferSide) { badgeIdx = i; break; }
      }
      if (badgeIdx === -1) badgeIdx = 0;

      const badge = queue.splice(badgeIdx, 1)[0];
      if (simTime > maxWaitMs) maxWaitMs = simTime;

      const useStorage = Math.random() < STORAGE_DETOUR_CHANCE;
      const route = resolveRoute(badge.divTheme, sameSideBias, useStorage);
      if (!route) continue;

      lastLaunchRack = DIV_TOPOLOGY[badge.divTheme]?.rackSide || null;
      inFlight++;
      if (inFlight > maxInFlight) maxInFlight = inFlight;
      entryDist[route.entrySide]++;

      const endTime = simulateTransit(route, simTime, state, metrics);
      patchCounts[badge.divTheme] = (patchCounts[badge.divTheme] || 0) + 1;

      const transitTime = endTime - simTime;
      totalTransitMs += transitTime;
      if (transitTime < minTransit) minTransit = transitTime;
      if (transitTime > maxTransit) maxTransit = transitTime;
      completionEvents.push({ time: endTime, action: () => { inFlight--; } });
    }

    if (completionEvents.length > 0) {
      completionEvents.sort((a, b) => a.time - b.time);
      const nextTick = simTime + LAUNCH_INTERVAL_MS;
      simTime = Math.min(completionEvents[0].time, nextTick);
    } else if (queue.length > 0) {
      simTime += LAUNCH_INTERVAL_MS;
    } else {
      break;
    }

    if (simTime > badgeCount * 60_000) break;
  }

  completionEvents.sort((a, b) => a.time - b.time);
  for (const e of completionEvents) { simTime = e.time; e.action(); }

  return {
    badgeCount, sameSideBias, totalTimeMs: simTime,
    maxInFlight, maxWaitMs,
    avgTransitMs: Math.round(totalTransitMs / badgeCount),
    minTransitMs: Math.round(minTransit),
    maxTransitMs: Math.round(maxTransit),
    patchPanelCounts: patchCounts,
    throughputPerSec: Math.round((badgeCount / (simTime / 1000)) * 100) / 100,
    entryDistribution: entryDist,
    trunkCrossPct: Math.round((metrics.trunkCrossings / badgeCount) * 100),
    metrics,
  };
}

// ═══════════════════════════════════════════════════════════
// ROTATION MODE (Phase 3 — perpetual cycling)
// ═══════════════════════════════════════════════════════════

interface RotationResult {
  poolSize: number;
  simDurationMs: number;
  totalRotations: number;
  rotationsPerDiv: Record<string, number>;
  avgCycleMs: number;         // avg time for full rotation (removal + ingress)
  minCycleMs: number;
  maxCycleMs: number;
  avgIngressMs: number;
  fullRosterCycles: number;   // how many times entire pool was displayed
  recencySkips: number;       // times recency suppression fired
  divSkips: number;           // times division in-flight limit blocked
  maxInFlight: number;
  uniqueBadgesDisplayed: number;
  badgeRepeatGap: { avg: number; min: number; max: number }; // time between same badge appearances
  storagePct: number;
  metrics: TransitMetrics;
}

interface RotationOptions {
  maxInFlight?: number;
  trunkCount?: number; // 2 = default (cables 0,1), 3 = add cable 20, 4 = add cables 20+21
}

function simulateRotation(poolSize: number, opts: RotationOptions = {}): RotationResult {
  const SIM_DURATION = 10 * 60 * 1000;
  const localMaxInFlight = opts.maxInFlight ?? MAX_IN_FLIGHT;
  const trunkCount = opts.trunkCount ?? 2;

  // Generate pool with random divisions
  interface PoolBadge { id: number; divTheme: string; lastDisplayedAt: number; displayCount: number }
  const pool: PoolBadge[] = [];
  for (let i = 0; i < poolSize; i++) {
    pool.push({ id: i, divTheme: DIVISIONS[Math.floor(Math.random() * DIVISIONS.length)], lastDisplayedAt: -Infinity, displayCount: 0 });
  }

  // Fill panels initially
  const panelContents: Record<string, number[]> = {}; // div → array of badge IDs currently displayed
  for (const div of DIVISIONS) {
    const cap = DIV_TOPOLOGY[div].panelCapacity;
    const divBadges = pool.filter(b => b.divTheme === div);
    panelContents[div] = [];
    for (let i = 0; i < Math.min(cap, divBadges.length); i++) {
      panelContents[div].push(divBadges[i].id);
      divBadges[i].lastDisplayedAt = 0;
      divBadges[i].displayCount = 1;
    }
  }

  const totalDisplayed = Object.values(panelContents).reduce((s, a) => s + a.length, 0);

  // State
  const state: CableState = {
    cableFreeAt: new Map(),
    brsFreeAt: { 'brs-01': 0, 'brs-02': 0 },
  };
  const metrics = freshMetrics();

  let simTime = SETTLE_PERIOD_MS; // start after settle
  let poolCursor = 0;
  let totalRotations = 0;
  const rotationsPerDiv: Record<string, number> = {};
  for (const div of DIVISIONS) rotationsPerDiv[div] = 0;
  let recencySkips = 0;
  let divSkips = 0;
  let maxInFlight = 0;
  let inFlight = 0;
  const divInFlight: Record<string, boolean> = {};
  for (const div of DIVISIONS) divInFlight[div] = false;

  const cycleTimes: number[] = [];
  const ingressTimes: number[] = [];
  const badgeAppearances: Record<number, number[]> = {}; // badge id → array of display timestamps
  const displayedBadgeIds = new Set<number>();

  // Track initial fill
  for (const div of DIVISIONS) {
    for (const id of panelContents[div]) {
      displayedBadgeIds.add(id);
      if (!badgeAppearances[id]) badgeAppearances[id] = [];
      badgeAppearances[id].push(0);
    }
  }

  const completionEvents: { time: number; action: () => void }[] = [];

  // Recency suppression: skip badges displayed within last N rotations worth of time
  const RECENCY_WINDOW_MS = 120000; // 2 minutes — don't re-show within this window
  const MAX_RECENCY_SKIPS = 10; // don't skip more than 10 in a row (prevent infinite loop in small pools)

  // Shuffle helper
  function shuffle<T>(arr: T[]): void {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
  }

  function advancePool(): PoolBadge {
    let skips = 0;
    while (skips < MAX_RECENCY_SKIPS) {
      const badge = pool[poolCursor];
      poolCursor++;
      if (poolCursor >= pool.length) {
        shuffle(pool);
        poolCursor = 0;
      }
      // Recency check: skip if displayed too recently
      if (badge.lastDisplayedAt > 0 && (simTime - badge.lastDisplayedAt) < RECENCY_WINDOW_MS) {
        skips++;
        recencySkips++;
        continue;
      }
      return badge;
    }
    // Fallback: just take current cursor position
    const badge = pool[poolCursor];
    poolCursor++;
    if (poolCursor >= pool.length) {
      shuffle(pool);
      poolCursor = 0;
    }
    return badge;
  }

  // Main rotation loop — event-driven, concurrent rotations across divisions
  let lastRotationDiv: string | null = null;

  function launchRotation(badge: PoolBadge, targetDiv: string) {
    const topo = DIV_TOPOLOGY[targetDiv];
    const panel = panelContents[targetDiv];
    const panelFull = panel.length >= topo.panelCapacity;

    divInFlight[targetDiv] = true;
    inFlight++;
    if (inFlight > maxInFlight) maxInFlight = inFlight;
    // Note: localMaxInFlight controls launch gate, maxInFlight tracks peak

    const cycleStart = simTime;
    let cursor = simTime;

    // Phase A: Removal (if panel is full)
    if (panelFull) {
      const removedId = panel.shift()!;
      cursor += REMOVAL_CLI_MS;
      cursor += REMOVAL_LED_MS;
      cursor += REMOVAL_DEGAUSS_MS;
      cursor += REMOVAL_NOSHUT_MS;
    }

    // Core download CLI
    cursor += CORE_DOWNLOAD_CLI_MS;

    // Phase B: Ingress
    const ingressStart = cursor;
    const useStorage = Math.random() < STORAGE_DETOUR_CHANCE;
    const route = resolveRoute(targetDiv, ROTATION_BIAS, useStorage, trunkCount);
    if (route) {
      cursor = simulateTransit(route, cursor, state, metrics);
    }
    const ingressEnd = cursor;
    ingressTimes.push(ingressEnd - ingressStart);

    // Place badge
    panel.push(badge.id);
    badge.lastDisplayedAt = cursor;
    badge.displayCount++;
    displayedBadgeIds.add(badge.id);
    if (!badgeAppearances[badge.id]) badgeAppearances[badge.id] = [];
    badgeAppearances[badge.id].push(cursor);

    totalRotations++;
    rotationsPerDiv[targetDiv]++;
    lastRotationDiv = targetDiv;
    cycleTimes.push(cursor - cycleStart);

    completionEvents.push({
      time: cursor,
      action: () => {
        inFlight--;
        divInFlight[targetDiv] = false;
      },
    });
  }

  while (simTime < SIM_DURATION) {
    // Process completion events up to current time
    completionEvents.sort((a, b) => a.time - b.time);
    while (completionEvents.length > 0 && completionEvents[0].time <= simTime) {
      completionEvents.shift()!.action();
    }

    // Try to launch rotations (multiple per tick if slots available)
    let launchedThisTick = 0;
    while (inFlight < localMaxInFlight && launchedThisTick < 3) {
      const badge = advancePool();
      const targetDiv = badge.divTheme;

      if (divInFlight[targetDiv]) {
        divSkips++;
        // Try a few more times to find an open division
        let found = false;
        for (let attempt = 0; attempt < 4; attempt++) {
          const alt = advancePool();
          if (!divInFlight[alt.divTheme]) {
            launchRotation(alt, alt.divTheme);
            launchedThisTick++;
            found = true;
            break;
          } else {
            divSkips++;
          }
        }
        if (!found) break; // all divisions busy
      } else {
        launchRotation(badge, targetDiv);
        launchedThisTick++;
      }
    }

    // Advance to next tick
    simTime += ROTATION_TICK_MS;
  }

  // Drain remaining events
  completionEvents.sort((a, b) => a.time - b.time);
  for (const e of completionEvents) { simTime = e.time; e.action(); }

  // Compute badge repeat gap stats
  let gapSum = 0, gapCount = 0, gapMin = Infinity, gapMax = 0;
  for (const [, times] of Object.entries(badgeAppearances)) {
    for (let i = 1; i < times.length; i++) {
      const gap = times[i] - times[i - 1];
      gapSum += gap;
      gapCount++;
      if (gap < gapMin) gapMin = gap;
      if (gap > gapMax) gapMax = gap;
    }
  }

  // Full roster cycles = how many times we showed all pool badges
  const minDisplayCount = pool.reduce((m, b) => Math.min(m, b.displayCount), Infinity);

  return {
    poolSize,
    simDurationMs: SIM_DURATION,
    totalRotations,
    rotationsPerDiv,
    avgCycleMs: cycleTimes.length ? Math.round(cycleTimes.reduce((a, b) => a + b, 0) / cycleTimes.length) : 0,
    minCycleMs: cycleTimes.length ? Math.round(Math.min(...cycleTimes)) : 0,
    maxCycleMs: cycleTimes.length ? Math.round(Math.max(...cycleTimes)) : 0,
    avgIngressMs: ingressTimes.length ? Math.round(ingressTimes.reduce((a, b) => a + b, 0) / ingressTimes.length) : 0,
    fullRosterCycles: minDisplayCount === Infinity ? 0 : minDisplayCount,
    recencySkips,
    divSkips,
    maxInFlight,
    uniqueBadgesDisplayed: displayedBadgeIds.size,
    badgeRepeatGap: {
      avg: gapCount ? Math.round(gapSum / gapCount) : 0,
      min: gapCount ? Math.round(gapMin) : 0,
      max: gapCount ? Math.round(gapMax) : 0,
    },
    storagePct: metrics.storageDetours > 0 ? Math.round((metrics.storageDetours / totalRotations) * 100) : 0,
    metrics,
  };
}

// ─── Cable name lookup ─────────────────────────────────────

const CABLE_NAMES: Record<number, string> = {
  0: 'Cross-rack A→B', 1: 'Cross-rack B→A', 2: 'Trunk 3',
  3: 'FW-A→Core A', 4: 'FW-B→Core B',
  5: 'Core A→BRS in', 6: 'BRS→Core A out',
  7: 'WLC→Core A', 8: 'WLC→WiFi AP',
  9: 'Core A→IT', 10: 'Core A→Punk',
  11: 'VPN→Core B', 12: 'Core B→Office',
  13: 'Core B→Corp', 14: 'VPN→Contractors',
  15: 'Cloud-A→FW-A', 16: 'Cloud-B→FW-B',
  17: 'Core B→BRS-02 in', 18: 'BRS-02→Core B out',
  19: 'Core A→Storage', 20: 'Storage→Core A',
};

// ─── Reports ───────────────────────────────────────────────

const sec = (ms: number) => (ms / 1000).toFixed(1) + 's';
const min = (ms: number) => (ms / 60000).toFixed(1) + 'm';
const bar = (n: number, max: number, width = 20) => {
  const filled = Math.round((n / Math.max(max, 1)) * width);
  return '█'.repeat(filled) + '░'.repeat(width - filled);
};

function printIngressReport(r: IngressResult) {
  const biasLabel = r.sameSideBias === 1.0 ? 'home-only (baseline)'
    : r.sameSideBias === 0.5 ? 'pure random (50/50)'
    : `${Math.round(r.sameSideBias * 100)}% home-side`;

  console.log(`\n── ${r.badgeCount} BADGES | ${biasLabel} ──────────────────`);
  console.log(`  Total time:      ${sec(r.totalTimeMs)}`);
  console.log(`  Throughput:      ${r.throughputPerSec} badges/sec`);
  console.log(`  Transit:         ${sec(r.avgTransitMs)} avg | ${sec(r.minTransitMs)} min | ${sec(r.maxTransitMs)} max`);
  console.log(`  Max in-flight:   ${r.maxInFlight} / ${MAX_IN_FLIGHT}`);
  console.log(`  Cloud entry:     A: ${r.entryDistribution.A} | B: ${r.entryDistribution.B}`);
  console.log(`  Trunk crossings: ${r.trunkCrossPct}%`);
  if (r.metrics.storageDetours > 0) {
    console.log(`  Storage detours: ${r.metrics.storageDetours} (${Math.round(r.metrics.storageDetours / r.badgeCount * 100)}%)`);
  }

  console.log(`\n  Cable congestion:  ${r.metrics.cableWaits} waits | max ${sec(r.metrics.maxCableWaitMs)} wait`);
  if (r.metrics.crossRackWaits > 0) {
    console.log(`  Trunk congestion:  ${r.metrics.crossRackWaits} waits | max ${sec(r.metrics.maxCrossRackWaitMs)} wait  ⚠ TRUNK`);
  }
  if (Object.keys(r.metrics.perCableWaits).length > 0) {
    const sorted = Object.entries(r.metrics.perCableWaits).sort((a, b) => b[1].count - a[1].count);
    for (const [cable, stats] of sorted.slice(0, 8)) {
      const name = (CABLE_NAMES[Number(cable)] || `Cable ${cable}`).padEnd(20);
      const avg = Math.round(stats.totalMs / stats.count);
      const isTrunk = Number(cable) === 0 || Number(cable) === 1;
      console.log(`    ${name} ${String(stats.count).padStart(3)}× wait | avg ${sec(avg)} | max ${sec(stats.maxMs)}${isTrunk ? ' ⚠' : ''}`);
    }
  }

  console.log(`\n  BRS: ${r.metrics.brsRenders['brs-01']} / ${r.metrics.brsRenders['brs-02']} renders | ${r.metrics.brsSkips} skips (${Math.round(r.metrics.brsSkips / r.badgeCount * 100)}%)`);

  const maxPanel = Math.max(...Object.values(r.patchPanelCounts), 1);
  console.log(`\n  Patch panel distribution:`);
  for (const div of DIVISIONS) {
    const count = r.patchPanelCounts[div] || 0;
    console.log(`    ${div.padEnd(12)} ${bar(count, maxPanel)} ${String(count).padStart(4)}`);
  }
}

function printRotationReport(r: RotationResult) {
  console.log(`\n══ ROTATION: ${r.poolSize} badges in pool ══════════════════`);
  console.log(`  Sim duration:       ${min(r.simDurationMs)}`);
  console.log(`  Total rotations:    ${r.totalRotations}`);
  console.log(`  Cycle time:         ${sec(r.avgCycleMs)} avg | ${sec(r.minCycleMs)} min | ${sec(r.maxCycleMs)} max`);
  console.log(`  Ingress time:       ${sec(r.avgIngressMs)} avg`);
  console.log(`  Max in-flight:      ${r.maxInFlight} / ${MAX_IN_FLIGHT}`);
  console.log(`  Full roster cycles: ${r.fullRosterCycles} (every badge shown ${r.fullRosterCycles}× minimum)`);
  console.log(`  Unique displayed:   ${r.uniqueBadgesDisplayed} / ${r.poolSize}`);
  console.log(`  Storage detours:    ${r.storagePct}%`);

  console.log(`\n  Badge repeat gap:   ${sec(r.badgeRepeatGap.avg)} avg | ${sec(r.badgeRepeatGap.min)} min | ${sec(r.badgeRepeatGap.max)} max`);
  console.log(`  Recency skips:      ${r.recencySkips}`);
  console.log(`  Division skips:     ${r.divSkips} (in-flight limit)`);

  console.log(`\n  Rotations per division:`);
  const maxRot = Math.max(...Object.values(r.rotationsPerDiv), 1);
  for (const div of DIVISIONS) {
    const count = r.rotationsPerDiv[div] || 0;
    console.log(`    ${div.padEnd(12)} ${bar(count, maxRot)} ${String(count).padStart(4)}`);
  }

  console.log(`\n  Cable congestion:  ${r.metrics.cableWaits} waits | max ${sec(r.metrics.maxCableWaitMs)} wait`);
  if (r.metrics.crossRackWaits > 0) {
    console.log(`  Trunk congestion:  ${r.metrics.crossRackWaits} waits | max ${sec(r.metrics.maxCrossRackWaitMs)} wait`);
  }
  if (Object.keys(r.metrics.perCableWaits).length > 0) {
    const sorted = Object.entries(r.metrics.perCableWaits).sort((a, b) => b[1].count - a[1].count);
    for (const [cable, stats] of sorted.slice(0, 8)) {
      const name = (CABLE_NAMES[Number(cable)] || `Cable ${cable}`).padEnd(20);
      const avg = Math.round(stats.totalMs / stats.count);
      console.log(`    ${name} ${String(stats.count).padStart(3)}× wait | avg ${sec(avg)} | max ${sec(stats.maxMs)}`);
    }
  }

  console.log(`\n  BRS: ${r.metrics.brsRenders['brs-01']} / ${r.metrics.brsRenders['brs-02']} renders | ${r.metrics.brsSkips} skips`);
}

function printRotationIntegrity(r: RotationResult) {
  const pass = (label: string, ok: boolean, detail?: string) =>
    console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? ` (${detail})` : ''}`);

  pass('Max in-flight respected', r.maxInFlight <= MAX_IN_FLIGHT,
    `${r.maxInFlight}/${MAX_IN_FLIGHT}`);
  pass('All badges displayed at least once', r.uniqueBadgesDisplayed === r.poolSize,
    `${r.uniqueBadgesDisplayed}/${r.poolSize}`);
  pass('Division fairness (max/min < 2x)',
    Math.max(...Object.values(r.rotationsPerDiv)) / Math.max(Math.min(...Object.values(r.rotationsPerDiv)), 1) < 2,
    Object.entries(r.rotationsPerDiv).map(([d, n]) => `${d}:${n}`).join(' '));
  pass('No starvation (full roster cycled)', r.fullRosterCycles >= 1,
    `${r.fullRosterCycles} full cycles`);
  pass('Trunk wait under 10s', r.metrics.maxCrossRackWaitMs < 10000,
    `max ${sec(r.metrics.maxCrossRackWaitMs)}`);
  pass('Avg repeat gap > 60s', r.badgeRepeatGap.avg > 60000,
    `avg ${sec(r.badgeRepeatGap.avg)}`);
  pass('Dual BRS concurrent ≤ 2', r.metrics.maxBrsQueue <= 2,
    `max ${r.metrics.maxBrsQueue}`);
}

// ─── Run ───────────────────────────────────────────────────

if (MODE === 'ingress') {
  console.log(`\n══════════════════════════════════════════════`);
  console.log(`  RACK PACKET STRESS TEST SIMULATOR`);
  console.log(`  Ingress Mode — Dual-Cloud Bias Sweep`);
  console.log(`  (includes 15% storage detour)`);
  console.log(`══════════════════════════════════════════════`);

  for (const count of INGRESS_BADGE_COUNTS) {
    for (const bias of BIAS_RATIOS) {
      printIngressReport(simulateIngress(count, bias));
    }
  }

  console.log(`\n── INTEGRITY CHECKS (200 badges, 50% bias) ──`);
  const r = simulateIngress(200, 0.5);
  const pass = (label: string, ok: boolean, detail?: string) =>
    console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? ` (${detail})` : ''}`);
  pass('Max in-flight respected', r.maxInFlight <= MAX_IN_FLIGHT, `${r.maxInFlight}/${MAX_IN_FLIGHT}`);
  pass('Dual BRS concurrent ≤ 2', r.metrics.maxBrsQueue <= 2, `max ${r.metrics.maxBrsQueue}`);
  pass('Trunk wait under 10s', r.metrics.maxCrossRackWaitMs < 10000, `max ${sec(r.metrics.maxCrossRackWaitMs)}`);

} else {
  console.log(`\n══════════════════════════════════════════════`);
  console.log(`  RACK ROTATION SIMULATOR`);
  console.log(`  Phase 3 — Pool Rotation Cycle`);
  console.log(`  10-minute sim | 70% home-side bias`);
  console.log(`  ${REMOVAL_TOTAL_MS}ms removal + ingress per cycle`);
  console.log(`  15% storage detour | 30s settle`);
  console.log(`══════════════════════════════════════════════`);

  for (const size of ROTATION_POOL_SIZES) {
    printRotationReport(simulateRotation(size));
  }

  // Congestion comparison at 500 badges
  console.log(`\n══ CONGESTION COMPARISON (500-badge pool, 3 trunks) ═══════════`);
  const variants: { label: string; opts: RotationOptions }[] = [
    { label: '3 in-flight', opts: { maxInFlight: 3 } },
    { label: '4 in-flight', opts: { maxInFlight: 4 } },
    { label: '5 in-flight (default)', opts: {} },
  ];

  console.log(`  ${'Variant'.padEnd(32)}  Rotations  MaxTrunkWait  TrunkWaits  CableWaits  MaxCableWait  Unique/500`);
  console.log(`  ${'─'.repeat(32)}  ─────────  ────────────  ──────────  ──────────  ────────────  ──────────`);
  for (const v of variants) {
    const r = simulateRotation(500, v.opts);
    console.log(
      `  ${v.label.padEnd(32)}  ` +
      `${String(r.totalRotations).padStart(9)}  ` +
      `${sec(r.metrics.maxCrossRackWaitMs).padStart(12)}  ` +
      `${String(r.metrics.crossRackWaits).padStart(10)}  ` +
      `${String(r.metrics.cableWaits).padStart(10)}  ` +
      `${sec(r.metrics.maxCableWaitMs).padStart(12)}  ` +
      `${(r.uniqueBadgesDisplayed + '/500').padStart(10)}`
    );
  }

  console.log(`\n── INTEGRITY CHECKS (200-badge pool) ────────`);
  printRotationIntegrity(simulateRotation(200));
}

console.log(`\n══════════════════════════════════════════════\n`);
