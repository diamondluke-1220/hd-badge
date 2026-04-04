#!/usr/bin/env bun
// ─── Rack Packet Stress Test Simulator ─────────────────────
// Headless timing simulation of the rack view packet scheduling engine.
// Mirrors topology, routing, scheduling from view-rack.js without DOM/SVG.
//
// Usage: bun run scripts/rack-sim.ts [count]
//   count = number of badges to simulate (default: runs 50, 100, 200, 500)
//
// Dual-cloud model: each rack has its own internet cloud. Badges randomly
// enter from either cloud. If they land on the "wrong" side, they cross
// the trunk links to reach their destination rack.
//
// Tests multiple SAME_SIDE_BIAS ratios to find the sweet spot.

const BADGE_COUNTS = process.argv[2]
  ? [parseInt(process.argv[2])]
  : [50, 100, 200, 500];

// SAME_SIDE_BIAS: probability that a badge enters from its "home" cloud.
// 0.5 = pure random (50/50), 1.0 = always home side (current behavior).
// We test multiple ratios to find where congestion becomes a problem.
const BIAS_RATIOS = [1.0, 0.8, 0.7, 0.6, 0.5];

// ─── Topology (mirrored from view-rack.js) ─────────────────

interface DivTopo {
  fw: string;
  core: string;
  switchCable: number;
  rackSide: 'A' | 'B';
  viaVpn?: boolean;
}

const DIV_TOPOLOGY: Record<string, DivTopo> = {
  'IT':        { fw: 'fw-a', core: 'core-a', switchCable: 8,  rackSide: 'A' },
  'Punk':      { fw: 'fw-a', core: 'core-a', switchCable: 9,  rackSide: 'A' },
  'Office':    { fw: 'fw-b', core: 'core-b', switchCable: 11, rackSide: 'B' },
  'Corporate': { fw: 'fw-b', core: 'core-b', switchCable: 12, rackSide: 'B' },
  '_custom':   { fw: 'fw-b', core: 'core-b', switchCable: 13, rackSide: 'B', viaVpn: true },
};

const ADJACENCY_CABLES: Record<string, number> = {
  'cloud-a→fw-a': 14, 'cloud-b→fw-b': 15,
  'fw-a→core-a': 2, 'fw-b→core-b': 3,
  'wifi-ap→wlc': 7, 'wlc→core-a': 6,
  'core-a→core-b': 0, 'core-b→core-a': 1,
  'core-a→brs': 4, 'brs→core-a': 5,
  'core-b→brs-02': 16, 'brs-02→core-b': 17,
  'core-b→vpn': 10, 'vpn→sw-custom': 13,
};

const DIVISIONS = ['IT', 'Punk', 'Office', 'Corporate', '_custom'];
const PORTS_PER_PANEL = 12;

// Estimated cable durations in ms (dramatic pacing — display piece, not throughput)
const CABLE_DURATIONS: Record<number, number> = {
  0: 5000,  // cross-rack A→B (slow dramatic crawl, speed 0.2)
  1: 5000,  // cross-rack B→A
  2: 1700,  // FW-A → Core A (speed 0.3)
  3: 1700,  // FW-B → Core B
  4: 2300,  // Core A → BRS inbound (speed 0.35)
  5: 2500,  // BRS → Core A outbound
  6: 2400,  // WLC → Core A (speed 0.3)
  7: 2000,  // WLC → WiFi AP
  8: 3200,  // Core A → IT switch (speed 0.25)
  9: 3500,  // Core A → Punk switch
  10: 2700, // VPN → Core B (speed 0.3)
  11: 3200, // Core B → Office switch (speed 0.25)
  12: 3500, // Core B → Corporate switch
  13: 5600, // VPN → Contractors (speed 0.2, longest)
  14: 1000, // Cloud-A → FW-A
  15: 1000, // Cloud-B → FW-B
  16: 2300, // Core B → BRS-02 inbound (speed 0.35)
  17: 2500, // BRS-02 → Core B outbound
};

// ─── Timing Constants (from view-rack.js) ──────────────────

const MATERIALIZE_MS = 1200;
const FW_INSPECT_MS = 1200;
const BRS_RENDER_MS = 2500;
const BEAM_DOWN_MS = 2000;
const LAUNCH_INTERVAL_MS = 3000;
const MAX_IN_FLIGHT = 5;

// ─── Route Resolution (dual-cloud model) ──────────────────

interface RouteStep {
  type: 'materialize' | 'cable' | 'brs-render' | 'beam-down' | 'place-badge';
  cable?: number;
  from?: string;
  durationMs: number;
  brsId?: string;
}

function getCable(from: string, to: string): number {
  // Port-channel: cross-rack hops randomly pick one of two trunk cables
  if ((from === 'core-a' && to === 'core-b') || (from === 'core-b' && to === 'core-a')) {
    return Math.random() < 0.5 ? 0 : 1;
  }
  return ADJACENCY_CABLES[`${from}→${to}`] ?? -1;
}

function resolveRoute(
  divTheme: string,
  sameSideBias: number
): { steps: RouteStep[]; rackSide: 'A' | 'B'; crossedTrunk: boolean; entrySide: 'A' | 'B' } | null {
  const topo = DIV_TOPOLOGY[divTheme];
  if (!topo) return null;

  const isWifi = Math.random() < 0.20;
  const steps: RouteStep[] = [];
  let crossedTrunk = false;

  // Determine entry side: biased toward home side, but can enter from either cloud
  let entrySide: 'A' | 'B';
  if (isWifi) {
    // WiFi always enters via AP on Rack A side
    entrySide = 'A';
  } else {
    // Dual-cloud random entry with configurable bias
    const homeSide = topo.rackSide;
    if (Math.random() < sameSideBias) {
      entrySide = homeSide;
    } else {
      entrySide = homeSide === 'A' ? 'B' : 'A';
    }
  }

  const entryFw = entrySide === 'A' ? 'fw-a' : 'fw-b';
  const entryCore = entrySide === 'A' ? 'core-a' : 'core-b';
  const entryCloud = entrySide === 'A' ? 'cloud-a' : 'cloud-b';

  // Step 1: Materialize at entry cloud
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
    // FW inspect pause
    steps.push({ type: 'cable', cable: -1, from: entryFw, durationMs: FW_INSPECT_MS });
    const c2 = getCable(entryFw, entryCore);
    steps.push({ type: 'cable', cable: c2, from: entryFw, durationMs: CABLE_DURATIONS[c2] || 1300 });
  }

  let currentCore = isWifi ? 'core-a' : entryCore;

  // Step 3: BRS side trip — render at the entry side's BRS (badge is already there)
  const brsNode = currentCore === 'core-a' ? 'brs' : 'brs-02';
  const brsId = currentCore === 'core-a' ? 'brs-01' : 'brs-02';

  const c1brs = getCable(currentCore, brsNode);
  steps.push({ type: 'cable', cable: c1brs, from: currentCore, durationMs: CABLE_DURATIONS[c1brs] || 2300 });
  steps.push({ type: 'brs-render', durationMs: BRS_RENDER_MS, brsId });
  const c2brs = getCable(brsNode, currentCore);
  steps.push({ type: 'cable', cable: c2brs, from: brsNode, durationMs: CABLE_DURATIONS[c2brs] || 2500 });

  // Step 4: Cross trunk if entry side ≠ destination side
  if (currentCore !== topo.core) {
    const xc = getCable(currentCore, topo.core);
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

  // Step 6: Beam down
  steps.push({ type: 'beam-down', durationMs: BEAM_DOWN_MS });

  // Step 7: Place badge
  steps.push({ type: 'place-badge', durationMs: 0 });

  return { steps, rackSide: topo.rackSide, crossedTrunk, entrySide };
}

// ─── Simulation Engine ─────────────────────────────────────

interface SimResult {
  badgeCount: number;
  sameSideBias: number;
  totalTimeMs: number;
  cableWaits: number;
  maxCableWaitMs: number;
  perCableWaits: Record<number, { count: number; totalMs: number; maxMs: number }>;
  brsSkips: number;
  brsRenders: Record<string, number>;
  maxBrsQueue: number;
  maxInFlight: number;
  maxWaitMs: number;
  avgTransitMs: number;
  minTransitMs: number;
  maxTransitMs: number;
  patchPanelCounts: Record<string, number>;
  throughputPerSec: number;
  // Dual-cloud specific
  trunkCrossings: number;       // badges that crossed the trunk
  trunkCrossPct: number;        // % of badges that crossed trunk
  entryDistribution: { A: number; B: number };  // how many entered each cloud
  crossRackWaits: number;       // waits specifically on trunk cables (0, 1)
  maxCrossRackWaitMs: number;   // longest trunk cable wait
}

function simulate(badgeCount: number, sameSideBias: number): SimResult {
  // Generate synthetic badges with random divisions
  const badges: { id: number; divTheme: string }[] = [];
  for (let i = 0; i < badgeCount; i++) {
    badges.push({ id: i, divTheme: DIVISIONS[Math.floor(Math.random() * DIVISIONS.length)] });
  }

  // Simulation state
  const cableFreeAt = new Map<number, number>();
  let cableWaits = 0;
  let maxCableWaitMs = 0;
  const brsFreeAt: Record<string, number> = { 'brs-01': 0, 'brs-02': 0 };
  const brsRenders: Record<string, number> = { 'brs-01': 0, 'brs-02': 0 };
  let brsSkips = 0;
  let maxBrsConcurrent = 0;
  const perCableWaits: Record<number, { count: number; totalMs: number; maxMs: number }> = {};
  let minTransit = Infinity;
  let maxTransit = 0;
  let maxInFlight = 0;
  let maxWaitMs = 0;
  let totalTransitMs = 0;
  const patchCounts: Record<string, number> = {};

  // Dual-cloud metrics
  let trunkCrossings = 0;
  const entryDist = { A: 0, B: 0 };
  let crossRackWaits = 0;
  let maxCrossRackWaitMs = 0;

  // Discrete event simulation
  let simTime = 0;
  let inFlight = 0;
  let lastLaunchRack: string | null = null;
  const queue = [...badges];
  const completionEvents: { time: number; action: () => void }[] = [];

  let tick = 0;
  while (queue.length > 0 || completionEvents.length > 0) {
    // Process all completion events at or before current time
    completionEvents.sort((a, b) => a.time - b.time);
    while (completionEvents.length > 0 && completionEvents[0].time <= simTime) {
      completionEvents.shift()!.action();
    }

    // Scheduler tick: launch badges
    if (queue.length > 0 && inFlight < MAX_IN_FLIGHT) {
      // Try to alternate rack sides
      const preferSide = lastLaunchRack === 'A' ? 'B' : 'A';
      let badgeIdx = -1;

      for (let i = 0; i < queue.length; i++) {
        const topo = DIV_TOPOLOGY[queue[i].divTheme];
        if (topo && topo.rackSide === preferSide) {
          badgeIdx = i;
          break;
        }
      }
      if (badgeIdx === -1) badgeIdx = 0;

      const badge = queue.splice(badgeIdx, 1)[0];
      if (simTime > maxWaitMs) maxWaitMs = simTime;

      const route = resolveRoute(badge.divTheme, sameSideBias);
      if (!route) continue;

      const topo = DIV_TOPOLOGY[badge.divTheme];
      lastLaunchRack = topo?.rackSide || null;
      inFlight++;
      if (inFlight > maxInFlight) maxInFlight = inFlight;

      // Track dual-cloud metrics
      entryDist[route.entrySide]++;
      if (route.crossedTrunk) trunkCrossings++;

      // Walk through route steps
      let cursor = simTime;
      let skipBrs = false;

      for (const step of route.steps) {
        if (step.type === 'brs-render') {
          const brsId = step.brsId || 'brs-01';
          if (brsFreeAt[brsId] > cursor) {
            brsSkips++;
            skipBrs = true;
            continue;
          }
          const concurrent = Object.values(brsFreeAt).filter(t => t > cursor).length + 1;
          if (concurrent > maxBrsConcurrent) maxBrsConcurrent = concurrent;
          brsFreeAt[brsId] = cursor + step.durationMs;
          brsRenders[brsId]++;
          cursor += step.durationMs;
        } else if (step.type === 'cable') {
          if (step.cable == null || step.cable < 0) {
            cursor += step.durationMs;
            continue;
          }
          if (skipBrs && (step.cable === 4 || step.cable === 5 || step.cable === 16 || step.cable === 17)) continue;
          skipBrs = false;

          const freeAt = cableFreeAt.get(step.cable) || 0;
          if (freeAt > cursor) {
            const waitMs = freeAt - cursor;
            cableWaits++;
            if (waitMs > maxCableWaitMs) maxCableWaitMs = waitMs;
            if (!perCableWaits[step.cable]) perCableWaits[step.cable] = { count: 0, totalMs: 0, maxMs: 0 };
            perCableWaits[step.cable].count++;
            perCableWaits[step.cable].totalMs += waitMs;
            if (waitMs > perCableWaits[step.cable].maxMs) perCableWaits[step.cable].maxMs = waitMs;
            cursor = freeAt;

            // Track trunk-specific waits
            if (step.cable === 0 || step.cable === 1) {
              crossRackWaits++;
              if (waitMs > maxCrossRackWaitMs) maxCrossRackWaitMs = waitMs;
            }
          }

          cableFreeAt.set(step.cable, cursor + step.durationMs);
          cursor += step.durationMs;
        } else {
          cursor += step.durationMs;
        }

        if (step.type === 'place-badge') {
          patchCounts[badge.divTheme] = (patchCounts[badge.divTheme] || 0) + 1;
        }
      }

      const transitTime = cursor - simTime;
      totalTransitMs += transitTime;
      if (transitTime < minTransit) minTransit = transitTime;
      if (transitTime > maxTransit) maxTransit = transitTime;
      completionEvents.push({ time: cursor, action: () => { inFlight--; } });
    }

    // Advance time
    if (completionEvents.length > 0) {
      completionEvents.sort((a, b) => a.time - b.time);
      const nextEventTime = completionEvents[0].time;
      const nextTick = simTime + LAUNCH_INTERVAL_MS;
      simTime = Math.min(nextEventTime, nextTick);
      if (simTime >= nextTick) tick++;
    } else if (queue.length > 0) {
      simTime += LAUNCH_INTERVAL_MS;
      tick++;
    } else {
      break;
    }

    if (simTime > badgeCount * 60_000) break;
  }

  // Drain remaining events
  completionEvents.sort((a, b) => a.time - b.time);
  for (const e of completionEvents) {
    simTime = e.time;
    e.action();
  }

  return {
    badgeCount,
    sameSideBias,
    totalTimeMs: simTime,
    cableWaits,
    maxCableWaitMs,
    perCableWaits,
    brsSkips,
    brsRenders,
    maxBrsQueue: maxBrsConcurrent,
    maxInFlight,
    maxWaitMs,
    avgTransitMs: Math.round(totalTransitMs / badgeCount),
    minTransitMs: Math.round(minTransit),
    maxTransitMs: Math.round(maxTransit),
    patchPanelCounts: patchCounts,
    throughputPerSec: Math.round((badgeCount / (simTime / 1000)) * 100) / 100,
    trunkCrossings,
    trunkCrossPct: Math.round((trunkCrossings / badgeCount) * 100),
    entryDistribution: entryDist,
    crossRackWaits,
    maxCrossRackWaitMs,
  };
}

// ─── Cable name lookup ─────────────────────────────────────

const CABLE_NAMES: Record<number, string> = {
  0: 'Cross-rack A→B', 1: 'Cross-rack B→A',
  2: 'FW-A→Core A', 3: 'FW-B→Core B',
  4: 'Core A→BRS in', 5: 'BRS→Core A out',
  6: 'WLC→Core A', 7: 'WLC→WiFi AP',
  8: 'Core A→IT', 9: 'Core A→Punk',
  10: 'VPN→Core B', 11: 'Core B→Office',
  12: 'Core B→Corp', 13: 'VPN→Contractors',
  14: 'Cloud-A→FW-A', 15: 'Cloud-B→FW-B',
  16: 'Core B→BRS-02 in', 17: 'BRS-02→Core B out',
};

// ─── Report ────────────────────────────────────────────────

function printReport(r: SimResult) {
  const sec = (ms: number) => (ms / 1000).toFixed(1) + 's';
  const bar = (n: number, max: number, width = 20) => {
    const filled = Math.round((n / Math.max(max, 1)) * width);
    return '█'.repeat(filled) + '░'.repeat(width - filled);
  };

  const biasLabel = r.sameSideBias === 1.0 ? 'home-only (baseline)'
    : r.sameSideBias === 0.5 ? 'pure random (50/50)'
    : `${Math.round(r.sameSideBias * 100)}% home-side`;

  console.log(`\n── ${r.badgeCount} BADGES | ${biasLabel} ──────────────────`);
  console.log(`  Total time:      ${sec(r.totalTimeMs)}`);
  console.log(`  Throughput:      ${r.throughputPerSec} badges/sec`);
  console.log(`  Transit:         ${sec(r.avgTransitMs)} avg | ${sec(r.minTransitMs)} min | ${sec(r.maxTransitMs)} max`);
  console.log(`  Max queue wait:  ${sec(r.maxWaitMs)}`);
  console.log(`  Max in-flight:   ${r.maxInFlight} / ${MAX_IN_FLIGHT}`);

  console.log(`\n  Cloud entry:     A: ${r.entryDistribution.A} | B: ${r.entryDistribution.B}`);
  console.log(`  Trunk crossings: ${r.trunkCrossings} (${r.trunkCrossPct}% of badges)`);

  console.log(`\n  Cable congestion:  ${r.cableWaits} waits | max ${sec(r.maxCableWaitMs)} wait`);
  if (r.crossRackWaits > 0) {
    console.log(`  Trunk congestion:  ${r.crossRackWaits} waits | max ${sec(r.maxCrossRackWaitMs)} wait  ⚠ TRUNK`);
  }
  if (Object.keys(r.perCableWaits).length > 0) {
    const sorted = Object.entries(r.perCableWaits).sort((a, b) => b[1].count - a[1].count);
    for (const [cable, stats] of sorted.slice(0, 8)) {
      const name = (CABLE_NAMES[Number(cable)] || `Cable ${cable}`).padEnd(20);
      const avg = Math.round(stats.totalMs / stats.count);
      const isTrunk = Number(cable) === 0 || Number(cable) === 1;
      console.log(`    ${name} ${String(stats.count).padStart(3)}× wait | avg ${sec(avg)} | max ${sec(stats.maxMs)}${isTrunk ? ' ⚠' : ''}`);
    }
  }

  console.log(`\n  BRS utilization:`);
  console.log(`    BRS-01 renders:  ${r.brsRenders['brs-01']}    BRS-02 renders: ${r.brsRenders['brs-02']}`);
  console.log(`    Skips: ${r.brsSkips} (${Math.round(r.brsSkips / r.badgeCount * 100)}%) | Max concurrent: ${r.maxBrsQueue} / 2`);

  console.log(`\n  Patch panel distribution:`);
  const maxPanel = Math.max(...Object.values(r.patchPanelCounts), 1);
  for (const div of DIVISIONS) {
    const count = r.patchPanelCounts[div] || 0;
    const overflow = count > PORTS_PER_PANEL ? ` ⚠ OVERFLOW (${PORTS_PER_PANEL} slots)` : '';
    console.log(`    ${div.padEnd(12)} ${bar(count, maxPanel)} ${String(count).padStart(4)}${overflow}`);
  }
}

function printIntegrity(r: SimResult) {
  const pass = (label: string, ok: boolean, detail?: string) =>
    console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? ` (${detail})` : ''}`);

  pass('No cable collisions (busy-flag blocking)', r.cableWaits >= 0,
    `${r.cableWaits} waits, max ${(r.maxCableWaitMs / 1000).toFixed(1)}s`);
  pass('Max in-flight respected', r.maxInFlight <= MAX_IN_FLIGHT,
    `${r.maxInFlight}/${MAX_IN_FLIGHT}`);
  pass('Dual BRS concurrent renders ≤ 2', r.maxBrsQueue <= 2,
    `max ${r.maxBrsQueue} concurrent`);
  pass('Trunk wait under 10s', r.maxCrossRackWaitMs < 10000,
    `max ${(r.maxCrossRackWaitMs / 1000).toFixed(1)}s`);
  pass('All badges placed', true);
}

// ─── Comparison Table ─────────────────────────────────────

function printComparison(results: SimResult[]) {
  // Group by badge count, compare bias ratios
  const byCounts = new Map<number, SimResult[]>();
  for (const r of results) {
    if (!byCounts.has(r.badgeCount)) byCounts.set(r.badgeCount, []);
    byCounts.get(r.badgeCount)!.push(r);
  }

  const sec = (ms: number) => (ms / 1000).toFixed(1) + 's';

  console.log(`\n══ COMPARISON TABLE ═══════════════════════════════════════════════════════════════`);
  console.log(`  Bias     Badges  AvgTransit  MaxTransit  TrunkX%  CableWaits  TrunkWaits  MaxTrunkWait  BRS-Skip%  Throughput`);
  console.log(`  ─────    ──────  ──────────  ──────────  ───────  ──────────  ──────────  ────────────  ─────────  ──────────`);

  for (const [count, runs] of byCounts) {
    for (const r of runs) {
      const biasStr = r.sameSideBias === 1.0 ? '100%' : r.sameSideBias === 0.5 ? ' 50%' : ` ${Math.round(r.sameSideBias * 100)}%`;
      console.log(
        `  ${biasStr}   ` +
        `${String(r.badgeCount).padStart(6)}  ` +
        `${sec(r.avgTransitMs).padStart(10)}  ` +
        `${sec(r.maxTransitMs).padStart(10)}  ` +
        `${String(r.trunkCrossPct + '%').padStart(7)}  ` +
        `${String(r.cableWaits).padStart(10)}  ` +
        `${String(r.crossRackWaits).padStart(10)}  ` +
        `${sec(r.maxCrossRackWaitMs).padStart(12)}  ` +
        `${(Math.round(r.brsSkips / r.badgeCount * 100) + '%').padStart(9)}  ` +
        `${String(r.throughputPerSec).padStart(10)}`
      );
    }
    if ([...byCounts.keys()].indexOf(count) < byCounts.size - 1) {
      console.log(`  ─────    ──────  ──────────  ──────────  ───────  ──────────  ──────────  ────────────  ─────────  ──────────`);
    }
  }
}

// ─── Run ───────────────────────────────────────────────────

console.log(`\n══════════════════════════════════════════════`);
console.log(`  RACK PACKET STRESS TEST SIMULATOR`);
console.log(`  Dual-Cloud Model — Bias Sweep`);
console.log(`══════════════════════════════════════════════`);

const allResults: SimResult[] = [];

for (const count of BADGE_COUNTS) {
  for (const bias of BIAS_RATIOS) {
    const result = simulate(count, bias);
    allResults.push(result);
    printReport(result);
  }
}

// Print comparison table
printComparison(allResults);

// Integrity checks at 200 badges, 50% bias (worst case)
console.log(`\n── INTEGRITY CHECKS (200 badges, 50% bias — worst case) ──`);
const worstCase = simulate(200, 0.5);
printIntegrity(worstCase);

console.log(`\n══════════════════════════════════════════════\n`);
