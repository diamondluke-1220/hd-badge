// ─── Arcade Sound System ─────────────────────────────────
// Hybrid: ZzFX for UI sounds, NSFRL sample packs for fight SFX.
// Sample files in /sfx/*.mp3 (CC0 — NSFRL Retro Combat + Magic FX).
// Muted in presentation mode (band is playing live).
// Depends on: /lib/zzfx.min.js (ZzFXMicro)

(function() {
  'use strict';

  // ─── Mute Control ──────────────────────────────────────────
  let _muted = false;
  let _audioCtx = null;
  let _masterGain = null;

  // ─── ZzFX Sounds (UI + boss entrance) ─────────────────────
  const ZZFX_SOUNDS = {
    cursorTick:   [.3,.01,300,,.02,.02,,,,-6.4,,,,,,,,.26,.01],
    screenFlash:  [.2,,2e3,,.01,.01,4,,,,,,,,,,,,,,],
    bossEntrance: [2.11,,508,.02,.12,1,1,.46,3,.1,,,.15,.1,1.6,3,.3,.39,.11,.1],
  };

  // ─── Sample-Based Sounds ──────────────────────────────────
  const SAMPLE_MAP = {
    // Fight flow
    lightHit:       ['/sfx/hit-light.mp3', '/sfx/hit-light-2.mp3', '/sfx/hit-light-3.mp3', '/sfx/hit-light-4.mp3'],
    heavyHit:       ['/sfx/hit-heavy.mp3', '/sfx/hit-heavy-2.mp3', '/sfx/hit-heavy-3.mp3'],
    koImpact:       '/sfx/ko-impact.mp3',
    vsSlam:         '/sfx/vs-slam.mp3',       // SpecialFX_Magic_2 — swap to vs-slam-alt.mp3 (SwordSwing_4_A) if preferred
    vsSlamAlt:      '/sfx/vs-slam-alt.mp3',
    fightStart:     '/sfx/fight-start.mp3',
    stun:           '/sfx/stun.mp3',
    winner:         '/sfx/winner.mp3',
    bandEntrance:   '/sfx/band-entrance.mp3',
    selectConfirm:  '/sfx/select-confirm.mp3',
    quoteTaunt:     '/sfx/quote-taunt.mp3',
    // Special move charge/release
    whoosh:         '/sfx/special-microwave.mp3',
    boom:           '/sfx/ko-impact.mp3',
    // Creature specials
    specialSlash:     '/sfx/special-slash.mp3',
    specialMicrowave: '/sfx/special-microwave.mp3',
    specialHazmat:    '/sfx/special-hazmat.mp3',
    specialPaper:     '/sfx/special-paper.mp3',
    specialPacket:    '/sfx/special-packet.mp3',
    specialAnecdote:  '/sfx/special-anecdote.mp3',
    specialLockdown:  '/sfx/special-lockdown.mp3',
    specialCode:      '/sfx/special-code.mp3',
    // Boss specials
    specialFeedback:  '/sfx/special-feedback.mp3',
    specialDrumhit:   '/sfx/special-drumhit.mp3',
    // Todd laser (two-part)
    laserFire:        '/sfx/laser-fire.mp3',
    laserImpact:      '/sfx/laser-impact.mp3',
  };

  // Per-sound volume overrides (default 0.6)
  const VOLUME_MAP = {
    winner: 0.3,
    bandEntrance: 0.3,
    cursorTick: 0.4,
    selectConfirm: 0.3,
    quoteTaunt: 0.4,
  };

  const _buffers = {};   // name → AudioBuffer or AudioBuffer[] (preloaded)
  let _preloaded = false;

  function _ensureCtx() {
    if (_audioCtx && _audioCtx.state !== 'closed') {
      if (_audioCtx.state === 'suspended') _audioCtx.resume();
      return _audioCtx;
    }
    try {
      _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      // Master gain + compressor — prevents clipping when multiple sounds overlap
      const compressor = _audioCtx.createDynamicsCompressor();
      compressor.threshold.value = -12;  // start compressing at -12dB
      compressor.knee.value = 6;
      compressor.ratio.value = 4;        // 4:1 compression
      compressor.attack.value = 0.003;   // fast attack catches transients
      compressor.release.value = 0.15;
      compressor.connect(_audioCtx.destination);
      _masterGain = _audioCtx.createGain();
      _masterGain.gain.value = 0.7; // overall volume cap
      _masterGain.connect(compressor);
      return _audioCtx;
    } catch(e) { return null; }
  }

  function _loadOne(url, ctx) {
    return fetch(url)
      .then(r => r.arrayBuffer())
      .then(buf => ctx.decodeAudioData(buf))
      .catch(() => null);
  }

  function _preloadSamples() {
    if (_preloaded) return;
    _preloaded = true;
    const ctx = _ensureCtx();
    if (!ctx) return;
    for (const [name, entry] of Object.entries(SAMPLE_MAP)) {
      if (Array.isArray(entry)) {
        // Multiple variants — load all
        Promise.all(entry.map(url => _loadOne(url, ctx)))
          .then(buffers => { _buffers[name] = buffers.filter(Boolean); })
          .catch(err => console.warn(`[ArcadeSFX] Failed to load ${name}:`, err));
      } else {
        _loadOne(entry, ctx)
          .then(buf => { if (buf) _buffers[name] = buf; })
          .catch(err => console.warn(`[ArcadeSFX] Failed to load ${name}:`, err));
      }
    }
  }

  function _playSample(name, volume) {
    const ctx = _ensureCtx();
    if (!ctx) return false;
    let buffer = _buffers[name];
    if (!buffer) return false;
    // Pick random variant if array
    if (Array.isArray(buffer)) {
      if (buffer.length === 0) return false;
      buffer = buffer[Math.floor(Math.random() * buffer.length)];
    }
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const gain = ctx.createGain();
    gain.gain.value = volume;
    source.connect(gain);
    gain.connect(_masterGain || ctx.destination);
    source.start(0);
    return true;
  }

  function _playZzfx(name) {
    const params = ZZFX_SOUNDS[name];
    if (!params || !window.zzfx) return;
    try {
      // Share our AudioContext with ZzFX so everything routes through the same output
      const ctx = _ensureCtx();
      if (ctx) zzfxX = ctx;
      // Scale ZzFX volume down — ZzFX params have raw volume as first element
      const scaled = [...params];
      scaled[0] = (scaled[0] || 1) * 0.5; // reduce ZzFX volume to prevent initial blast
      zzfx(...scaled);
    } catch(e) { /* ignore audio errors */ }
  }

  // ─── Public API ────────────────────────────────────────────

  window.ArcadeSFX = {
    /** Play a named sound effect */
    play(name, opts) {
      if (_muted) return;
      // UI sounds (cursor, select) play regardless of FX toggle
      const isUI = name === 'cursorTick' || name === 'selectConfirm';
      if (!isUI && typeof animationsEnabled === 'function' && !animationsEnabled()) return;
      if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

      const vol = (opts && opts.volume) || VOLUME_MAP[name] || 0.6;

      // Try sample first, then ZzFX fallback
      if (_buffers[name]) {
        _playSample(name, vol);
      } else {
        _playZzfx(name);
      }
    },

    /** Play with delay (ms) */
    playDelayed(name, delayMs, opts) {
      setTimeout(() => this.play(name, opts), delayMs);
    },

    /** Preload all sample files */
    preload() {
      _preloadSamples();
    },

    /** Set mute state (true = silent) */
    setMuted(muted) {
      _muted = !!muted;
    },

    /** Check if muted */
    isMuted() {
      return _muted;
    },

    /** Get available sound names */
    list() {
      return [...Object.keys(ZZFX_SOUNDS), ...Object.keys(SAMPLE_MAP)];
    },
  };

})();
