// ─── Arcade Sound System ─────────────────────────────────
// Uses ZzFX (1.2KB) for procedural sound effects.
// All sounds are generated from parameter arrays — no audio files.
// Muted in presentation mode (band is playing live).
// Depends on: /lib/zzfx.min.js (ZzFXMicro)

(function() {
  'use strict';

  // ─── Mute Control ──────────────────────────────────────────
  let _muted = false;

  // ─── Sound Definitions ─────────────────────────────────────
  // Designed at https://killedbyapixel.github.io/ZzFX/
  // Format: [volume, randomness, frequency, attack, sustain, release,
  //          shape, shapeCurve, slide, deltaSlide, pitchJump, pitchJumpTime,
  //          repeatTime, noise, modulation, bitCrush, delay, sustainVolume,
  //          decay, tremolo, filter]

  const SOUNDS = {
    // Light hit — clean punchy tap (js13k2023)
    lightHit:     [.2,.5,289,.02,,.07,3,.39,-6.4,,,,,.5,34,.1,.02,.91,.04,.15],
    // Heavy hit — deep saw-wave body blow (remvst/knight, vol reduced)
    heavyHit:     [1.1,,71,.01,.05,.03,2,.14,,,,,.01,1.5,,.1,.19,.95,.05,.16],
    // Special move charge — deep rumble building up (ZzFX soundboard Heart, vol reduced)
    whoosh:       [,,20,.04,,.4,,1.31,,,-990,.06,.17,,,.04,.07],
    // Special move release — heavy bass boom (vol reduced)
    boom:         [.6,.05,35,.01,.1,.5,4,2,,-1,-50,.04,.1,3,,,,,,.1],
    // KO impact — long dramatic death hit (404-js13k)
    koImpact:     [1.3,,117,.12,.27,1.21,4,2,.7,,,,,.8,,.9,.34,1.1,.04,.2],
    // Cursor tick — clean minimal select (js13k2023)
    cursorTick:   [.3,.01,300,,.02,.02,,,,-6.4,,,,,,,,.26,.01],
    // VS slam — dramatic explosion sting (remvst/knight, vol reduced)
    vsSlam:       [1.0,,700,.05,1,1,1,3.65,.4,.9,,,,.6,,,.38,.44,.1],
    // Fight start — bright coin ding (ZzFX soundboard)
    fightStart:   [,,1675,,.06,.24,1,1.82,,,837,.06],
    // Stun — comedic boing
    stun:         [.4,.1,400,.01,.05,.15,0,,,,60,.05,.1,,,,,,,],
    // Boss entrance — electrical crackling (remvst/knight)
    bossEntrance: [2.11,,508,.02,.12,1,1,.46,3,.1,,,.15,.1,1.6,3,.3,.39,.11,.1],
    // Screen flash — brief white noise burst
    screenFlash:  [.2,,2e3,,.01,.01,4,,,,,,,,,,,,,,],
  };

  // ─── Public API ────────────────────────────────────────────

  // Fix browser autoplay policy — ZzFX creates AudioContext at parse time
  // which gets blocked. We replace it on first play attempt.

  window.ArcadeSFX = {
    /** Play a named sound effect */
    play(name) {
      if (_muted) return;
      // Respect FX off toggle and reduced-motion preference
      if (typeof animationsEnabled === 'function' && !animationsEnabled()) return;
      if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      if (!window.zzfx) return;
      // Create AudioContext on first play (inside user gesture = never blocked)
      if (!zzfxX || zzfxX.state === 'suspended' || zzfxX.state === 'closed') {
        try { zzfxX = new (window.AudioContext || window.webkitAudioContext)(); } catch(e) { return; }
      }
      const params = SOUNDS[name];
      if (params) {
        try { zzfx(...params); } catch(e) { /* ignore audio errors */ }
      }
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
      return Object.keys(SOUNDS);
    },
  };

})();
