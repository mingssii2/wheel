/**
 * Procedural Web Audio Synthesizer for Mechanical Peg Ticks & Winner Fanfare
 * Zero external audio assets, zero memory leaks, safe browser autoplay handling.
 */

export function createSoundEngine() {
  let ctx = null;
  let enabled = true;
  let lastTickTime = 0;

  function ensureContext() {
    if (!enabled) return null;
    const AudioCtx = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AudioCtx) return null;
    if (!ctx) {
      ctx = new AudioCtx();
    }
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
    return ctx;
  }

  /**
   * Plays a crisp mechanical clapper-on-brass-peg transient click.
   * @param {number} [speedRatio=0.5] - Normalized angular velocity in [0, 1]
   */
  function playTick(speedRatio = 0.5) {
    if (!enabled) return;
    const nowMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
    // Rate-limit ticks to max ~45Hz so ultra-dense wheels don't clip the audio bus
    if (nowMs - lastTickTime < 22) return;
    lastTickTime = nowMs;

    const audio = ensureContext();
    if (!audio) return;

    const t = audio.currentTime;
    const clampedSpeed = Math.max(0.05, Math.min(1, speedRatio));

    // Short percussive wood/metal impulse
    const osc = audio.createOscillator();
    const gain = audio.createGain();

    const baseFreq = 520 + clampedSpeed * 420;
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(baseFreq, t);
    osc.frequency.exponentialRampToValueAtTime(140, t + 0.028);

    const peakGain = 0.08 + clampedSpeed * 0.1;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.linearRampToValueAtTime(peakGain, t + 0.002);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.032);

    osc.connect(gain);
    gain.connect(audio.destination);

    osc.start(t);
    osc.stop(t + 0.035);
  }

  /**
   * Plays a clean tactile Swiss-chime triad when the wheel settles on the winner.
   */
  function playWinFanfare() {
    if (!enabled) return;
    const audio = ensureContext();
    if (!audio) return;

    const notes = [523.25, 659.25, 783.99, 1046.5]; // C5, E5, G5, C6
    const baseTime = audio.currentTime;

    notes.forEach((freq, idx) => {
      const start = baseTime + idx * 0.065;
      const osc = audio.createOscillator();
      const gain = audio.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, start);

      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.linearRampToValueAtTime(0.11, start + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.42);

      osc.connect(gain);
      gain.connect(audio.destination);

      osc.start(start);
      osc.stop(start + 0.45);
    });
  }

  return {
    unlock: ensureContext,
    playTick,
    playWinFanfare,
    setEnabled(val) {
      enabled = Boolean(val);
    },
    isEnabled() {
      return enabled;
    }
  };
}
