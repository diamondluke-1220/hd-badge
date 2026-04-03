// Help Desk Badge App — Presentation Mode Engine
// Server-side state machine for live show display on /presentation route
// Admin-triggered via /api/admin/presentation/* endpoints

import { log } from './logger';

// ─── Types ───────────────────────────────────────────────

export type PresentationPhase = 'inactive' | 'band_intro' | 'rotation';
export type PresentationView = 'grid' | 'rack' | 'arcade';

interface PresentationState {
  active: boolean;
  phase: PresentationPhase;
  currentView: PresentationView;
  bandIntroIndex: number;         // which band member (0-4), -1 when not in intro
  chyronMessages: string[];
  startedAt: number | null;
  viewStartedAt: number | null;
  _bandIntroTimer: ReturnType<typeof setInterval> | null;
  _rotationTimer: ReturnType<typeof setInterval> | null;
}

// ─── Constants ───────────────────────────────────────────

const VIEW_ORDER: PresentationView[] = ['grid', 'rack', 'arcade'];
const VIEW_DURATION_MS = 90_000;       // 90 seconds per view
const BAND_INTRO_DURATION_MS = 18_000; // 18 seconds per band member
const BAND_MEMBER_COUNT = 5;           // HD-00001 through HD-00005

const DEFAULT_CHYRON: string[] = [
  'GET YOUR BADGE → hdbadge.nav.computer',
  'HELP DESK — Live in Madison, WI',
  'Join the org chart — scan the QR code at the merch table',
];

// ─── State ───────────────────────────────────────────────

const state: PresentationState = {
  active: false,
  phase: 'inactive',
  currentView: 'grid',
  bandIntroIndex: -1,
  chyronMessages: [],
  startedAt: null,
  viewStartedAt: null,
  _bandIntroTimer: null,
  _rotationTimer: null,
};

// ─── Broadcast Wiring ────────────────────────────────────

type BroadcastFn = (event: string, data: any) => void;
let _broadcast: BroadcastFn = () => {};

export function initPresentation(opts: { broadcast: BroadcastFn }) {
  _broadcast = opts.broadcast;
}

// ─── Public API ──────────────────────────────────────────

export function startPresentation(opts?: { chyronMessages?: string[] }) {
  if (state.active) {
    return { error: 'Presentation already running.' };
  }

  state.active = true;
  state.phase = 'band_intro';
  state.bandIntroIndex = 0;
  state.chyronMessages = opts?.chyronMessages?.length ? opts.chyronMessages : [...DEFAULT_CHYRON];
  state.startedAt = Date.now();
  state.currentView = 'grid';
  state.viewStartedAt = null;

  log('info', 'presentation', 'Presentation started — band intro phase');

  // Broadcast initial state
  _broadcast('presentation-state', getPublicState());

  // Send first band member immediately
  _broadcast('presentation-band-member', {
    index: 0,
    total: BAND_MEMBER_COUNT,
  });

  // Timer to advance through band members
  state._bandIntroTimer = setInterval(() => {
    state.bandIntroIndex++;

    if (state.bandIntroIndex >= BAND_MEMBER_COUNT) {
      // Band intro complete → transition to rotation
      clearInterval(state._bandIntroTimer!);
      state._bandIntroTimer = null;
      startRotation();
      return;
    }

    _broadcast('presentation-band-member', {
      index: state.bandIntroIndex,
      total: BAND_MEMBER_COUNT,
    });

    _broadcast('presentation-state', getPublicState());
  }, BAND_INTRO_DURATION_MS);

  return { success: true, phase: 'band_intro', bandMembers: BAND_MEMBER_COUNT };
}

export function stopPresentation() {
  if (!state.active) {
    return { error: 'No presentation running.' };
  }

  // Clear all timers
  if (state._bandIntroTimer) {
    clearInterval(state._bandIntroTimer);
    state._bandIntroTimer = null;
  }
  if (state._rotationTimer) {
    clearInterval(state._rotationTimer);
    state._rotationTimer = null;
  }

  state.active = false;
  state.phase = 'inactive';
  state.bandIntroIndex = -1;
  state.startedAt = null;
  state.viewStartedAt = null;

  log('info', 'presentation', 'Presentation stopped');

  _broadcast('presentation-state', getPublicState());

  return { success: true };
}

export function updateChyron(messages: string[]) {
  state.chyronMessages = messages.length ? messages : [...DEFAULT_CHYRON];

  if (state.active) {
    _broadcast('presentation-chyron', { messages: state.chyronMessages });
  }

  log('info', 'presentation', `Chyron updated: ${state.chyronMessages.length} messages`);
  return { success: true };
}

export function skipBandIntro() {
  if (!state.active || state.phase !== 'band_intro') {
    return { error: 'Not in band intro phase.' };
  }

  if (state._bandIntroTimer) {
    clearInterval(state._bandIntroTimer);
    state._bandIntroTimer = null;
  }

  log('info', 'presentation', 'Band intro skipped — jumping to rotation');
  startRotation();
  return { success: true };
}

export function getPresentationState() {
  return {
    ...getPublicState(),
    chyronMessages: state.chyronMessages,
  };
}

export function getPublicState() {
  return {
    active: state.active,
    phase: state.phase,
    currentView: state.currentView,
    bandIntroIndex: state.bandIntroIndex,
  };
}

export function isPresentationActive(): boolean {
  return state.active;
}

// ─── Internal ────────────────────────────────────────────

function startRotation() {
  state.phase = 'rotation';
  state.bandIntroIndex = -1;
  state.currentView = VIEW_ORDER[0];
  state.viewStartedAt = Date.now();

  log('info', 'presentation', `Rotation started — view: ${state.currentView}`);

  _broadcast('presentation-state', getPublicState());
  _broadcast('presentation-view-change', { view: state.currentView });

  state._rotationTimer = setInterval(() => {
    const currentIdx = VIEW_ORDER.indexOf(state.currentView);
    const nextIdx = (currentIdx + 1) % VIEW_ORDER.length;
    state.currentView = VIEW_ORDER[nextIdx];
    state.viewStartedAt = Date.now();

    log('info', 'presentation', `View rotation: ${state.currentView}`);
    _broadcast('presentation-state', getPublicState());
    _broadcast('presentation-view-change', { view: state.currentView });
  }, VIEW_DURATION_MS);
}
