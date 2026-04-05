#!/usr/bin/env bun
// ─── Rack Packet Simulator ─────────────────────────────────
// Headless timing simulation of the rack view scheduling engine.
// Mirrors topology, routing, scheduling from view-rack.js without DOM/SVG.
//
// Usage: bun run scripts/rack-sim.ts [mode] [count]
//   mode: "ingress" (default) or "ttl"
//   count: number of badges (default: runs multiple counts)
//
// Modes:
//   ingress — Cable stress test: initial badge fill with dual-cloud bias sweep
//   ttl     — WFQ scheduler: always-rotating, TTL-based eviction with weighted fair queuing

const args = process.argv.slice(2);
const MODE = args.includes('ttl') ? 'ttl' : 'ingress';
const countArg = args.find(a => /^\d+$/.test(a));

const INGRESS_BADGE_COUNTS = countArg ? [parseInt(countArg)] : [50, 100, 200, 500];

// SAME_SIDE_BIAS: probability badge enters from its "home" cloud (ingress mode sweeps this)
const BIAS_RATIOS = [1.0, 0.8, 0.7, 0.6, 0.5];
const WFQ_ROTATION_BIAS = 0.7; // Fixed at 70% for TTL mode

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
const BRS_RENDER_MS = 1500;
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
const STORAGE_DETOUR_CHANCE = 0.15; // 15% of badges get storage side trip
const STORAGE_PAUSE_MS = 1000;   // "writing to disk" pause

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

// ─── Reports & Formatting ─────────────────────────────────

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

// ═══════════════════════════════════════════════════════════
// TTL MODE — Always-rotating, request-driven scheduler
// No state machine. Every badge has a TTL on the panel.
// When TTL expires → evict → re-enter pool → re-request.
// Scheduler just rate-limits requests.
// ═══════════════════════════════════════════════════════════

interface TtlConfig {
  label: string;
  maxInFlight: number;           // global concurrent animations
  maxPerDiv: number;              // per-division concurrent animations
  ttlMinMs: number;               // min display time on panel
  ttlMaxMs: number;               // max display time on panel
  wfq: boolean;                   // Weighted Fair Queuing: bandwidth proportional to pool size
  wfqFirstPassPriority: boolean;  // first-display badges get expedited forwarding (fill before rotate)
  tickMs: number;                 // scheduler tick interval
}

interface TtlBadge {
  id: number;
  divTheme: string;
  displayCount: number;
  totalDisplayMs: number;      // cumulative time spent on panel
  lastPlacedAt: number;
}

interface TtlPanelEntry {
  badgeId: number;
  placedAt: number;
  ttl: number;                 // ms until eviction
}

interface TtlDivState {
  pool: TtlBadge[];            // all badges for this division
  panel: TtlPanelEntry[];      // currently displayed
  cap: number;
  overflowRatio: number;       // pool.length / cap (1.0 = exact fit, 1.5 = 50% overflow)
  rotationCount: number;
  evictionCount: number;
}

interface TtlResult {
  config: TtlConfig;
  poolSize: number;
  simDurationMs: number;
  // Per-division metrics
  perDiv: Record<string, {
    poolSize: number;
    panelCap: number;
    overflowRatio: number;
    rotations: number;
    evictions: number;
    animationsPerMin: number;
    avgBadgeVisibilityPct: number;  // avg across badges: time on panel / sim duration
    minBadgeVisibilityPct: number;
    maxBadgeVisibilityPct: number;
  }>;
  // Global metrics
  totalRotations: number;
  totalEvictions: number;
  globalAnimationsPerMin: number;
  maxInFlightSeen: number;
  maxPerDivSeen: number;
  fillTimeMs: number;              // time until all panels initially full (or pool exhausted)
  // Cable/BRS
  cableWaits: number;
  maxCableWaitMs: number;
  trunkWaits: number;
  maxTrunkWaitMs: number;
  brsRenders: Record<string, number>;
  brsSkips: number;
  // Badge fairness
  avgRepeatGapMs: number;
  minRepeatGapMs: number;
  maxRepeatGapMs: number;
  // Concurrency timeline (sampled)
  avgConcurrentAnimations: number;
  metrics: TransitMetrics;
}

// Real badge distribution from production DB (2026-04-04)
const REAL_DISTRIBUTION: Record<string, number> = {
  'IT': 17,
  'Office': 16,
  'Punk': 12,
  'Corporate': 8,
  '_custom': 20,
};

function generateRealPool(): TtlBadge[] {
  const badges: TtlBadge[] = [];
  let id = 0;
  for (const [div, count] of Object.entries(REAL_DISTRIBUTION)) {
    for (let i = 0; i < count; i++) {
      badges.push({ id: id++, divTheme: div, displayCount: 0, totalDisplayMs: 0, lastPlacedAt: -1 });
    }
  }
  return badges;
}

function generateRandomPool(total: number): TtlBadge[] {
  const badges: TtlBadge[] = [];
  for (let i = 0; i < total; i++) {
    badges.push({
      id: i,
      divTheme: DIVISIONS[Math.floor(Math.random() * DIVISIONS.length)],
      displayCount: 0,
      totalDisplayMs: 0,
      lastPlacedAt: -1,
    });
  }
  return badges;
}

function simulateTtl(config: TtlConfig, useRealDist: boolean, randomPoolSize?: number): TtlResult {
  const SIM_DURATION = 10 * 60 * 1000; // 10 minutes

  const allBadges = useRealDist ? generateRealPool() : generateRandomPool(randomPoolSize || 73);

  // Initialize per-division state
  const divState: Record<string, TtlDivState> = {};
  for (const div of DIVISIONS) {
    const divBadges = allBadges.filter(b => b.divTheme === div);
    const cap = DIV_TOPOLOGY[div].panelCapacity;
    divState[div] = {
      pool: divBadges,
      panel: [],
      cap,
      overflowRatio: divBadges.length / cap,
      rotationCount: 0,
      evictionCount: 0,
    };
  }

  // Cable/BRS state
  const cableState: CableState = {
    cableFreeAt: new Map(),
    brsFreeAt: { 'brs-01': 0, 'brs-02': 0 },
  };
  const metrics = freshMetrics();

  // Animation tracking
  let simTime = 0;
  let inFlight = 0;
  let maxInFlightSeen = 0;
  let maxPerDivSeen = 0;
  const divInFlight: Record<string, number> = {};
  for (const div of DIVISIONS) divInFlight[div] = 0;

  let totalRotations = 0;
  let totalEvictions = 0;
  let fillTimeMs = -1;
  let concurrencySamples = 0;
  let concurrencySum = 0;

  // Badge appearance tracking for repeat gap
  const badgeAppearances: Record<number, number[]> = {};

  // Completion events
  const events: { time: number; action: () => void }[] = [];

  function processEvents() {
    events.sort((a, b) => a.time - b.time);
    while (events.length > 0 && events[0].time <= simTime) {
      events.shift()!.action();
    }
  }

  // ─── WFQ: Weighted Fair Queuing state ───────────────────
  // Each division gets a "virtual time" credit. Division with lowest virtual time
  // gets scheduled next. Credit cost is inversely proportional to weight (pool size).
  // Bigger pool = more weight = lower cost per request = more throughput.
  const wfqVirtualTime: Record<string, number> = {};
  const wfqWeight: Record<string, number> = {};
  const totalPoolSize = allBadges.length || 1;
  for (const div of DIVISIONS) {
    wfqVirtualTime[div] = 0;
    // Weight = division's share of total pool. Larger pool = higher weight = lower cost.
    const divSize = allBadges.filter(b => b.divTheme === div).length;
    wfqWeight[div] = divSize / totalPoolSize; // e.g., IT: 17/73 = 0.23
  }

  // Track whether each division has completed its initial fill (for DSCP first-pass priority)
  const divInitialFillComplete: Record<string, boolean> = {};
  for (const div of DIVISIONS) divInitialFillComplete[div] = false;

  function getWfqOrder(): string[] {
    // Sort divisions by virtual time (lowest first = most deserving of bandwidth)
    return [...DIVISIONS].sort((a, b) => wfqVirtualTime[a] - wfqVirtualTime[b]);
  }

  function recordWfqRequest(div: string) {
    // Cost = 1 / weight. Small divisions pay more per request (limiting their throughput).
    // But since they have fewer badges, they naturally make fewer requests.
    // The effect: each division gets throughput proportional to its pool size.
    const weight = wfqWeight[div] || 0.1;
    wfqVirtualTime[div] += 1 / weight;
  }

  function getTtl(): number {
    return config.ttlMinMs + Math.random() * (config.ttlMaxMs - config.ttlMinMs);
  }

  function getPoolWaiting(div: string): TtlBadge[] {
    const onPanel = new Set(divState[div].panel.map(e => e.badgeId));
    return divState[div].pool.filter(b => !onPanel.has(b.id));
  }

  function launchIngress(div: string, badge: TtlBadge) {
    divInFlight[div]++;
    inFlight++;
    if (inFlight > maxInFlightSeen) maxInFlightSeen = inFlight;
    if (divInFlight[div] > maxPerDivSeen) maxPerDivSeen = divInFlight[div];

    const useStorage = Math.random() < STORAGE_DETOUR_CHANCE;
    const route = resolveRoute(div, WFQ_ROTATION_BIAS, useStorage, 3);
    const transitEnd = route ? simulateTransit(route, simTime, cableState, metrics) : simTime + 10000;

    totalRotations++;
    divState[div].rotationCount++;

    events.push({
      time: transitEnd,
      action: () => {
        inFlight--;
        divInFlight[div]--;

        // Place badge on panel
        const ttl = getTtl();
        divState[div].panel.push({ badgeId: badge.id, placedAt: transitEnd, ttl });
        badge.displayCount++;
        badge.lastPlacedAt = transitEnd;
        if (!badgeAppearances[badge.id]) badgeAppearances[badge.id] = [];
        badgeAppearances[badge.id].push(transitEnd);
      },
    });
  }

  function launchEviction(div: string, entry: TtlPanelEntry) {
    divInFlight[div]++;
    inFlight++;
    if (inFlight > maxInFlightSeen) maxInFlightSeen = inFlight;
    if (divInFlight[div] > maxPerDivSeen) maxPerDivSeen = divInFlight[div];

    const removalEnd = simTime + REMOVAL_TOTAL_MS;

    totalEvictions++;
    divState[div].evictionCount++;

    // Track display time
    const badge = divState[div].pool.find(b => b.id === entry.badgeId);
    if (badge) {
      badge.totalDisplayMs += (simTime - entry.placedAt);
    }

    events.push({
      time: removalEnd,
      action: () => {
        inFlight--;
        divInFlight[div]--;
        // Remove from panel
        const idx = divState[div].panel.findIndex(e => e.badgeId === entry.badgeId);
        if (idx >= 0) divState[div].panel.splice(idx, 1);
      },
    });
  }

  // ─── Main simulation loop ───────────────────────────────
  while (simTime < SIM_DURATION) {
    processEvents();

    // Sample concurrency
    concurrencySamples++;
    concurrencySum += inFlight;

    // Check if all panels initially full (or pool exhausted) — track fill time
    if (fillTimeMs < 0) {
      const allFilled = DIVISIONS.every(div => {
        const ds = divState[div];
        return ds.panel.length >= Math.min(ds.cap, ds.pool.length);
      });
      if (allFilled) fillTimeMs = simTime;
    }

    // ─── Per-division: evict expired, then fill empty slots ───

    // Determine division ordering: WFQ sort or static
    let divOrder: string[] = config.wfq ? getWfqOrder() : DIVISIONS;

    // First-pass priority: unfilled divisions processed before filled ones
    if (config.wfqFirstPassPriority) {
      const unfilledDivs = divOrder.filter(d => !divInitialFillComplete[d]);
      const filledDivs = divOrder.filter(d => divInitialFillComplete[d]);
      divOrder = [...unfilledDivs, ...filledDivs];
    }

    for (const div of divOrder) {
      if (inFlight >= config.maxInFlight) break;

      const ds = divState[div];

      // DSCP first-pass: skip evictions for ALL divisions until this division's initial fill is done
      const skipEvictions = config.wfqFirstPassPriority && !divInitialFillComplete[div];

      // 1. Find expired panel entries (TTL elapsed)
      if (!skipEvictions) {
        const expired = ds.panel.filter(e => (simTime - e.placedAt) >= e.ttl);

        // 2. Evict expired badges (rate-limited)
        for (const entry of expired) {
          if (inFlight >= config.maxInFlight) break;
          if (divInFlight[div] >= config.maxPerDiv) break;
          launchEviction(div, entry);
          if (config.wfq) recordWfqRequest(div);
        }
      }

      // 3. Fill empty slots from pool (rate-limited)
      const currentPanelSize = ds.panel.length;
      const emptySlots = ds.cap - currentPanelSize;
      if (emptySlots > 0) {
        const waiting = getPoolWaiting(div);
        waiting.sort((a, b) => (a.lastPlacedAt ?? -1) - (b.lastPlacedAt ?? -1));

        for (let i = 0; i < Math.min(emptySlots, waiting.length); i++) {
          if (inFlight >= config.maxInFlight) break;
          if (divInFlight[div] >= config.maxPerDiv) break;
          launchIngress(div, waiting[i]);
          if (config.wfq) recordWfqRequest(div);
        }
      }

      // Track initial fill completion
      if (!divInitialFillComplete[div]) {
        const panelCount = ds.panel.length;
        const poolCount = ds.pool.length;
        if (panelCount >= Math.min(ds.cap, poolCount)) {
          divInitialFillComplete[div] = true;
        }
      }
    }

    simTime += config.tickMs;
  }

  // Drain remaining events and accumulate final display times
  processEvents();
  for (const div of DIVISIONS) {
    for (const entry of divState[div].panel) {
      const badge = divState[div].pool.find(b => b.id === entry.badgeId);
      if (badge) {
        badge.totalDisplayMs += (simTime - entry.placedAt);
      }
    }
  }

  // ─── Compute results ────────────────────────────────────
  const perDiv: TtlResult['perDiv'] = {};
  for (const div of DIVISIONS) {
    const ds = divState[div];
    const visibilities = ds.pool.map(b => (b.totalDisplayMs / SIM_DURATION) * 100);
    perDiv[div] = {
      poolSize: ds.pool.length,
      panelCap: ds.cap,
      overflowRatio: Math.round(ds.overflowRatio * 100) / 100,
      rotations: ds.rotationCount,
      evictions: ds.evictionCount,
      animationsPerMin: Math.round(((ds.rotationCount + ds.evictionCount) / (SIM_DURATION / 60000)) * 10) / 10,
      avgBadgeVisibilityPct: visibilities.length ? Math.round(visibilities.reduce((a, b) => a + b, 0) / visibilities.length * 10) / 10 : 0,
      minBadgeVisibilityPct: visibilities.length ? Math.round(Math.min(...visibilities) * 10) / 10 : 0,
      maxBadgeVisibilityPct: visibilities.length ? Math.round(Math.max(...visibilities) * 10) / 10 : 0,
    };
  }

  // Repeat gap
  let gapSum = 0, gapCount = 0, gapMin = Infinity, gapMax = 0;
  for (const times of Object.values(badgeAppearances)) {
    for (let i = 1; i < times.length; i++) {
      const gap = times[i] - times[i - 1];
      gapSum += gap;
      gapCount++;
      if (gap < gapMin) gapMin = gap;
      if (gap > gapMax) gapMax = gap;
    }
  }

  return {
    config,
    poolSize: allBadges.length,
    simDurationMs: SIM_DURATION,
    perDiv,
    totalRotations,
    totalEvictions,
    globalAnimationsPerMin: Math.round(((totalRotations + totalEvictions) / (SIM_DURATION / 60000)) * 10) / 10,
    maxInFlightSeen,
    maxPerDivSeen,
    fillTimeMs: fillTimeMs > 0 ? fillTimeMs : SIM_DURATION,
    cableWaits: metrics.cableWaits,
    maxCableWaitMs: metrics.maxCableWaitMs,
    trunkWaits: metrics.crossRackWaits,
    maxTrunkWaitMs: metrics.maxCrossRackWaitMs,
    brsRenders: metrics.brsRenders,
    brsSkips: metrics.brsSkips,
    avgRepeatGapMs: gapCount ? Math.round(gapSum / gapCount) : 0,
    minRepeatGapMs: gapCount ? Math.round(gapMin) : 0,
    maxRepeatGapMs: gapCount ? Math.round(gapMax) : 0,
    avgConcurrentAnimations: concurrencySamples ? Math.round((concurrencySum / concurrencySamples) * 100) / 100 : 0,
    metrics,
  };
}

function printTtlReport(r: TtlResult) {
  console.log(`\n── ${r.config.label} ──────────────────────────────`);
  console.log(`  Pool: ${r.poolSize} badges | Sim: ${min(r.simDurationMs)} | Tick: ${sec(r.config.tickMs)}`);
  console.log(`  TTL: ${sec(r.config.ttlMinMs)}-${sec(r.config.ttlMaxMs)}${r.config.wfq ? ' (WFQ)' : ' (fixed)'}`);
  console.log(`  Rate limit: ${r.config.maxInFlight} global / ${r.config.maxPerDiv} per-div`);
  console.log(`  Fill time: ${sec(r.fillTimeMs)}`);
  console.log(`  Avg concurrent animations: ${r.avgConcurrentAnimations}`);
  console.log(`  Max in-flight: ${r.maxInFlightSeen} / ${r.config.maxInFlight} | Max per-div: ${r.maxPerDivSeen} / ${r.config.maxPerDiv}`);

  console.log(`\n  Global: ${r.totalRotations} ingress + ${r.totalEvictions} evictions = ${r.totalRotations + r.totalEvictions} total animations`);
  console.log(`  Rate: ${r.globalAnimationsPerMin} animations/min`);
  console.log(`  Repeat gap: ${sec(r.avgRepeatGapMs)} avg | ${sec(r.minRepeatGapMs)} min | ${sec(r.maxRepeatGapMs)} max`);

  console.log(`\n  Per-division breakdown:`);
  console.log(`  ${'Div'.padEnd(12)} Pool  Cap  Ratio  Rots  Evict  Anim/m  AvgVis%  MinVis%  MaxVis%`);
  console.log(`  ${'─'.repeat(12)} ────  ───  ─────  ────  ─────  ──────  ───────  ───────  ───────`);
  for (const div of DIVISIONS) {
    const d = r.perDiv[div];
    if (!d) continue;
    console.log(
      `  ${div.padEnd(12)} ` +
      `${String(d.poolSize).padStart(4)}  ` +
      `${String(d.panelCap).padStart(3)}  ` +
      `${d.overflowRatio.toFixed(2).padStart(5)}  ` +
      `${String(d.rotations).padStart(4)}  ` +
      `${String(d.evictions).padStart(5)}  ` +
      `${d.animationsPerMin.toFixed(1).padStart(6)}  ` +
      `${d.avgBadgeVisibilityPct.toFixed(1).padStart(7)}  ` +
      `${d.minBadgeVisibilityPct.toFixed(1).padStart(7)}  ` +
      `${d.maxBadgeVisibilityPct.toFixed(1).padStart(7)}`
    );
  }

  console.log(`\n  Cable: ${r.cableWaits} waits | max ${sec(r.maxCableWaitMs)} wait`);
  if (r.trunkWaits > 0) {
    console.log(`  Trunk: ${r.trunkWaits} waits | max ${sec(r.maxTrunkWaitMs)} wait`);
  }
  if (Object.keys(r.metrics.perCableWaits).length > 0) {
    const sorted = Object.entries(r.metrics.perCableWaits).sort((a, b) => b[1].count - a[1].count);
    for (const [cable, stats] of sorted.slice(0, 5)) {
      const name = (CABLE_NAMES[Number(cable)] || `Cable ${cable}`).padEnd(20);
      const avg = Math.round(stats.totalMs / stats.count);
      console.log(`    ${name} ${String(stats.count).padStart(3)}× wait | avg ${sec(avg)} | max ${sec(stats.maxMs)}`);
    }
  }
  console.log(`  BRS: ${r.brsRenders['brs-01']}/${r.brsRenders['brs-02']} renders | ${r.brsSkips} skips`);
}

function printTtlComparison(results: TtlResult[]) {
  console.log(`\n  ══ COMPARISON TABLE ══════════════════════════════════════════════════════`);
  console.log(`  ${'Config'.padEnd(28)} FillTm  Anim/m  AvgCon  MaxFly  AvgGap  CbleW  TrnkW  BRS1  BRS2  Skip`);
  console.log(`  ${'─'.repeat(28)} ──────  ──────  ──────  ──────  ──────  ─────  ─────  ────  ────  ────`);

  for (const r of results) {
    console.log(
      `  ${r.config.label.padEnd(28)} ` +
      `${sec(r.fillTimeMs).padStart(6)}  ` +
      `${r.globalAnimationsPerMin.toFixed(1).padStart(6)}  ` +
      `${r.avgConcurrentAnimations.toFixed(2).padStart(6)}  ` +
      `${String(r.maxInFlightSeen).padStart(6)}  ` +
      `${sec(r.avgRepeatGapMs).padStart(6)}  ` +
      `${String(r.cableWaits).padStart(5)}  ` +
      `${String(r.trunkWaits).padStart(5)}  ` +
      `${String(r.brsRenders['brs-01']).padStart(4)}  ` +
      `${String(r.brsRenders['brs-02']).padStart(4)}  ` +
      `${String(r.brsSkips).padStart(4)}`
    );
  }
}

function printTtlIntegrity(r: TtlResult) {
  const pass = (label: string, ok: boolean, detail?: string) =>
    console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? ` (${detail})` : ''}`);

  pass('Max in-flight respected', r.maxInFlightSeen <= r.config.maxInFlight,
    `${r.maxInFlightSeen}/${r.config.maxInFlight}`);
  pass('Max per-div respected', r.maxPerDivSeen <= r.config.maxPerDiv,
    `${r.maxPerDivSeen}/${r.config.maxPerDiv}`);
  pass('All divisions active', DIVISIONS.every(d => (r.perDiv[d]?.rotations || 0) > 0),
    DIVISIONS.map(d => `${d}:${r.perDiv[d]?.rotations || 0}`).join(' '));
  pass('Trunk wait under 10s', r.maxTrunkWaitMs < 10000,
    `max ${sec(r.maxTrunkWaitMs)}`);
  pass('Avg concurrent < maxInFlight', r.avgConcurrentAnimations < r.config.maxInFlight,
    `${r.avgConcurrentAnimations} avg`);

  // Fairness: no division should have >3x the animations/min of another (accounting for pool size differences)
  const animRates = DIVISIONS.map(d => r.perDiv[d]?.animationsPerMin || 0).filter(r => r > 0);
  const rateRatio = animRates.length > 1 ? Math.max(...animRates) / Math.min(...animRates) : 1;
  pass('Division fairness (max/min rate < 5x)', rateRatio < 5,
    `ratio ${rateRatio.toFixed(1)}x`);

  // Visibility: every badge should be visible at least some % of the time
  const allMinVis = DIVISIONS.map(d => r.perDiv[d]?.minBadgeVisibilityPct || 0);
  const worstVis = Math.min(...allMinVis);
  pass('No badge starved (>5% visibility)', worstVis > 5,
    `worst ${worstVis.toFixed(1)}%`);

  // Cadence: should have meaningful activity but not chaos
  pass('Animations/min > 5 (not dead)', r.globalAnimationsPerMin > 5,
    `${r.globalAnimationsPerMin}/min`);
  pass('Animations/min < 60 (not chaos)', r.globalAnimationsPerMin < 60,
    `${r.globalAnimationsPerMin}/min`);
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

} else if (MODE === 'ttl') {
  console.log(`\n══════════════════════════════════════════════`);
  console.log(`  TTL MODE — Always-Rotating Scheduler`);
  console.log(`  No state machine. Badge TTL → evict → re-request.`);
  console.log(`  10-minute sim | 70% home-side bias | 3 trunks`);
  console.log(`  Real distribution: IT:17 Off:16 Punk:12 Corp:8 Con:20`);
  console.log(`══════════════════════════════════════════════`);

  // Default config = production settings (WFQ + first-pass priority)
  const defaults: TtlConfig = {
    label: '', maxInFlight: 5, maxPerDiv: 2, ttlMinMs: 15000, ttlMaxMs: 25000,
    wfq: true, wfqFirstPassPriority: true, tickMs: 2000,
  };

  const configs: TtlConfig[] = [
    // ─── Production config ───
    { ...defaults, label: 'WFQ+FP (production)' },

    // ─── Baseline (no fairness — for comparison) ───
    { ...defaults, label: 'BASELINE: no fairness', wfq: false, wfqFirstPassPriority: false },

    // ─── TTL tuning ───
    { ...defaults, label: 'WFQ+FP TTL 8-15s (short)', ttlMinMs: 8000, ttlMaxMs: 15000 },
    { ...defaults, label: 'WFQ+FP TTL 25-40s (long)', ttlMinMs: 25000, ttlMaxMs: 40000 },

    // ─── Capacity planning ───
    { ...defaults, label: 'WFQ+FP MIF=3', maxInFlight: 3 },
    { ...defaults, label: 'WFQ+FP MIF=7', maxInFlight: 7 },
  ];

  const results: TtlResult[] = [];

  // Run each config with real distribution (average 3 runs for stability)
  for (const cfg of configs) {
    const runs = [0, 1, 2].map(() => simulateTtl(cfg, true));
    // Use middle run (sorted by total rotations) for detailed report
    runs.sort((a, b) => a.totalRotations - b.totalRotations);
    const median = runs[1];
    results.push(median);
    printTtlReport(median);
  }

  // Comparison table
  printTtlComparison(results);

  // Integrity checks on key configs
  console.log(`\n── INTEGRITY CHECKS ──`);

  // Check baseline, round-robin, and best WFQ
  const checkConfigs = [
    { label: 'BASELINE', result: results[0] },
    { label: 'ROUND ROBIN', result: results[1] },
  ];

  // Find best WFQ config (most divisions active, then highest anim/min)
  const wfqResults = results.filter(r => r.config.wfq);
  if (wfqResults.length > 0) {
    const bestWfq = wfqResults.reduce((best, r) => {
      const activeCount = DIVISIONS.filter(d => (r.perDiv[d]?.rotations || 0) > 0).length;
      const bestActive = DIVISIONS.filter(d => (best.perDiv[d]?.rotations || 0) > 0).length;
      if (activeCount > bestActive) return r;
      if (activeCount === bestActive) {
        // Prefer lower fairness ratio (more even distribution)
        const rRates = DIVISIONS.map(d => r.perDiv[d]?.animationsPerMin || 0).filter(x => x > 0);
        const bRates = DIVISIONS.map(d => best.perDiv[d]?.animationsPerMin || 0).filter(x => x > 0);
        const rRatio = rRates.length > 1 ? Math.max(...rRates) / Math.min(...rRates) : Infinity;
        const bRatio = bRates.length > 1 ? Math.max(...bRates) / Math.min(...bRates) : Infinity;
        if (rRatio < bRatio) return r;
      }
      return best;
    });
    checkConfigs.push({ label: `BEST WFQ: ${bestWfq.config.label}`, result: bestWfq });
  }

  for (const { label, result } of checkConfigs) {
    console.log(`\n  [${label}]`);
    printTtlIntegrity(result);
  }

  // Scale test with best WFQ config
  if (wfqResults.length > 0) {
    const bestWfqConfig = wfqResults.reduce((best, r) => {
      const ac = DIVISIONS.filter(d => (r.perDiv[d]?.rotations || 0) > 0).length;
      const bc = DIVISIONS.filter(d => (best.perDiv[d]?.rotations || 0) > 0).length;
      return ac > bc ? r : best;
    }).config;

    console.log(`\n── SCALE TEST: 150 badges with ${bestWfqConfig.label} ──`);
    const scaleResult = simulateTtl(bestWfqConfig, false, 150);
    printTtlReport(scaleResult);
    printTtlIntegrity(scaleResult);
  }
}

console.log(`\n══════════════════════════════════════════════\n`);
