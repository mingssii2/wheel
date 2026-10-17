/**
 * Physical & Time-Parametric Wheel Animator with Downward Gravity (g)
 *
 * Supports two distinct physical regimes:
 * 1. Sub-Threshold Real Physics (Gravity Rollback / Pendulum Settle):
 *    When the user drags the wheel and releases with angular speed |ω_0| < ω_threshold,
 *    the wheel does NOT trigger a random spin. Instead, it obeys rigid-body rotational
 *    physics with a downward gravity counterweight (g at 6 o'clock) + top clapper spring
 *    restoring torque, coasting and rolling backward (หมุนกลับ) with damped oscillation.
 *
 * 2. Full CSPRNG Fair Spin with Physical Gravity Micro-Settle:
 *    When the user clicks SPIN or flicks with |ω_0| >= ω_threshold, the winner k* is
 *    chosen via Web Crypto CSPRNG + Lemire Rejection Sampling. The wheel spins in the
 *    flick direction and finishes with a realistic gravity/peg micro-rollback into the
 *    exact predetermined target angle θ_target.
 */

import { getSliceAtPointer } from './renderer.js';

/**
 * Realistic physical spin curve with a subtle end-of-spin gravity rollback settle.
 * - For tau in [0, 0.88]: C² quartic friction deceleration from 0 to 1 + overshootRatio
 * - For tau in (0.88, 1.0]: Gravity (g) and peg resistance gently pull the wheel back
 *   from 1 + overshootRatio to 1.000000 (exact CSPRNG target angle).
 *
 * @param {number} tau - Normalized time in [0, 1]
 * @param {number} [overshootRatio=0.008] - Fraction of total delta to overshoot before rolling back
 * @returns {number}
 */
export function physicalSpinCurve(tau, overshootRatio = 0.008) {
  const t = Math.max(0, Math.min(1, tau));
  const peakTau = 0.89;

  if (t <= peakTau) {
    const u = t / peakTau;
    const inv = 1 - u;
    const eased = 1 - inv * inv * inv * inv;
    return eased * (1 + overshootRatio);
  }

  // Gravity rollback phase: smooth cosine settle from (1 + overshootRatio) back to 1.0
  const v = (t - peakTau) / (1 - peakTau);
  const settle = 0.5 * (1 + Math.cos(Math.PI * v));
  return 1 + overshootRatio * settle;
}

/**
 * Legacy helper exported for unit test compatibility.
 */
export function quarticEaseOut(tau) {
  const t = Math.max(0, Math.min(1, tau));
  const inv = 1 - t;
  return 1 - inv * inv * inv * inv;
}

export function createWheelAnimator({ onFrame, onSliceTick, onComplete, onRollbackNotice }) {
  let rotationRad = 0;
  let startRotationRad = 0;
  let targetRotationRad = 0;
  let startTimeMs = 0;
  let durationMs = 3800;
  let mode = 'idle'; // 'idle' | 'dragging' | 'gravity_rollback' | 'spinning' | 'celebrating'
  let rafId = null;
  let activeDistribution = null;
  let pendingResult = null;
  let lastSliceIndex = -1;

  // Gravity & pendulum rollback state
  let angularVelocity = 0; // rad/s
  let gravityAnchorRad = 0; // Equilibrium angle where the 6 o'clock counterweight rests
  let lastPhysicsTimeMs = 0;

  // Top mechanical clapper spring-damper state
  let pointerAngle = 0;
  let pointerVelocity = 0;

  // Celebratory confetti particles rendered on canvas after a win
  let particles = [];

  function spawnWinParticles() {
    particles = [];
    const colors = ['#F59E0B', '#FDE68A', '#38BDF8', '#34D399', '#F43F5E', '#A78BFA'];
    const count = 42;
    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count + (i % 3) * 0.12;
      const speed = 140 + (i % 5) * 55;
      particles.push({
        x: 0,
        y: 0,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 90,
        size: 5 + (i % 4) * 2,
        rot: (i * 0.7) % (Math.PI * 2),
        vRot: (i % 2 === 0 ? 1 : -1) * (3 + (i % 4)),
        color: colors[i % colors.length],
        alpha: 1
      });
    }
  }

  function stepSpringAndParticles(dt) {
    // 1. Clapper pointer spring physics
    const stiffness = 280;
    const damping = 19;
    const accel = -stiffness * pointerAngle - damping * pointerVelocity;
    pointerVelocity += accel * dt;
    pointerAngle += pointerVelocity * dt;

    if (Math.abs(pointerAngle) < 0.001 && Math.abs(pointerVelocity) < 0.001) {
      pointerAngle = 0;
      pointerVelocity = 0;
    }

    // 2. Confetti particles under downward gravity g
    if (particles.length > 0) {
      const gravityPx = 420; // Downward gravity g on particles
      let alive = 0;
      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vy += gravityPx * dt;
        p.vx *= 0.985;
        p.rot += p.vRot * dt;
        p.alpha -= dt * 0.72;
        if (p.alpha > 0.02) {
          particles[alive++] = p;
        }
      }
      particles.length = alive;
    }
  }

  function checkPegCrossing(currentRot, speedNorm, directionSign) {
    const currentSlice = getSliceAtPointer(activeDistribution, currentRot);
    if (currentSlice) {
      if (lastSliceIndex !== -1 && currentSlice.index !== lastSliceIndex) {
        const kickDir = directionSign >= 0 ? -1 : 1;
        const impulse = kickDir * Math.min(0.55, 0.2 + speedNorm * 0.35);
        pointerAngle = Math.max(-0.6, Math.min(0.6, impulse));
        pointerVelocity = kickDir * 2.4 * speedNorm;
        if (typeof onSliceTick === 'function') {
          onSliceTick(currentSlice, speedNorm);
        }
      }
      lastSliceIndex = currentSlice.index;
    }
    return currentSlice;
  }

  function tickSpin(nowMs) {
    if (mode !== 'spinning') return;

    const dt = lastPhysicsTimeMs > 0 ? Math.min(0.05, (nowMs - lastPhysicsTimeMs) / 1000) : 0.016;
    lastPhysicsTimeMs = nowMs;

    const elapsed = nowMs - startTimeMs;
    const tau = Math.max(0, Math.min(1, elapsed / durationMs));
    const totalDelta = targetRotationRad - startRotationRad;

    // Slight physical overshoot (capped so it never crosses into a wrong slice) followed by gravity rollback
    const maxSafeOvershootRad = Math.min(0.06, Math.abs(totalDelta) * 0.004);
    const overshootRatio = Math.abs(totalDelta) > 0 ? maxSafeOvershootRad / Math.abs(totalDelta) : 0;

    const prevRot = rotationRad;
    const curveVal = physicalSpinCurve(tau, overshootRatio);
    rotationRad = startRotationRad + totalDelta * curveVal;

    const instantVel = (rotationRad - prevRot) / Math.max(0.001, dt);
    const directionSign = instantVel >= 0 ? 1 : -1;
    const normalizedSpeed = Math.min(1, Math.abs(instantVel) / 18);

    const currentSlice = checkPegCrossing(rotationRad, normalizedSpeed, directionSign);
    stepSpringAndParticles(dt);

    if (typeof onFrame === 'function') {
      onFrame({
        rotationRad,
        pointerAngle,
        spinning: tau < 1,
        currentSlice,
        normalizedSpeed,
        progress: tau,
        particles
      });
    }

    if (tau < 1) {
      rafId = requestAnimationFrame(tickSpin);
    } else {
      finishSpin();
    }
  }

  /**
   * Simulates real rotational pendulum physics under downward gravity (g at 6 o'clock)
   * when the user drags and releases the wheel without enough velocity for a full spin.
   */
  function tickGravityRollback(nowMs) {
    if (mode !== 'gravity_rollback') return;

    const dt = lastPhysicsTimeMs > 0 ? Math.min(0.04, (nowMs - lastPhysicsTimeMs) / 1000) : 0.016;
    lastPhysicsTimeMs = nowMs;

    // Angular displacement from the bottom-heavy equilibrium anchor
    const displacement = rotationRad - gravityAnchorRad;

    // Downward gravity restoring torque: tau_g = -(g / R) * sin(displacement)
    // Combined with rotational spring stiffness near equilibrium so even large displacements roll back smoothly
    const gravityTorque = -14.5 * Math.sin(displacement) - 4.2 * displacement;
    const viscousDamping = -3.6 * angularVelocity;

    const angularAccel = gravityTorque + viscousDamping;
    angularVelocity += angularAccel * dt;
    rotationRad += angularVelocity * dt;

    const directionSign = angularVelocity >= 0 ? 1 : -1;
    const normalizedSpeed = Math.min(1, Math.abs(angularVelocity) / 10);
    const currentSlice = checkPegCrossing(rotationRad, normalizedSpeed, directionSign);

    stepSpringAndParticles(dt);

    const isSettled =
      Math.abs(displacement) < 0.003 &&
      Math.abs(angularVelocity) < 0.015 &&
      Math.abs(pointerAngle) < 0.003;

    if (typeof onFrame === 'function') {
      onFrame({
        rotationRad: isSettled ? gravityAnchorRad : rotationRad,
        pointerAngle,
        spinning: false,
        currentSlice,
        normalizedSpeed,
        progress: 0,
        particles
      });
    }

    if (!isSettled) {
      rafId = requestAnimationFrame(tickGravityRollback);
    } else {
      rotationRad = gravityAnchorRad;
      angularVelocity = 0;
      mode = 'idle';
      rafId = null;
    }
  }

  function tickCelebration(nowMs) {
    if (mode !== 'celebrating') return;
    const dt = lastPhysicsTimeMs > 0 ? Math.min(0.05, (nowMs - lastPhysicsTimeMs) / 1000) : 0.016;
    lastPhysicsTimeMs = nowMs;

    stepSpringAndParticles(dt);
    const currentSlice = getSliceAtPointer(activeDistribution, rotationRad);

    if (typeof onFrame === 'function') {
      onFrame({
        rotationRad,
        pointerAngle,
        spinning: false,
        currentSlice,
        normalizedSpeed: 0,
        progress: 1,
        particles
      });
    }

    if (particles.length > 0 || Math.abs(pointerAngle) > 0.002) {
      rafId = requestAnimationFrame(tickCelebration);
    } else {
      mode = 'idle';
      rafId = null;
    }
  }

  function finishSpin() {
    if (mode !== 'spinning') return;
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }

    const TWO_PI = Math.PI * 2;
    rotationRad = ((targetRotationRad % TWO_PI) + TWO_PI) % TWO_PI;
    gravityAnchorRad = rotationRad;
    angularVelocity = 0;

    spawnWinParticles();
    mode = 'celebrating';
    lastPhysicsTimeMs = performance.now();

    const finalSlice = getSliceAtPointer(activeDistribution, rotationRad);
    if (typeof onFrame === 'function') {
      onFrame({
        rotationRad,
        pointerAngle: 0,
        spinning: false,
        currentSlice: finalSlice,
        normalizedSpeed: 0,
        progress: 1,
        particles
      });
    }

    const resultToDeliver = pendingResult;
    pendingResult = null;
    if (typeof onComplete === 'function' && resultToDeliver) {
      onComplete(resultToDeliver);
    }

    rafId = requestAnimationFrame(tickCelebration);
  }

  return {
    startSpin({
      targetRotation,
      duration = 3800,
      distribution,
      resultPayload,
      reducedMotion = false,
      direction = 1
    }) {
      if (mode === 'spinning') return false;
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }

      activeDistribution = distribution;
      pendingResult = resultPayload;
      startRotationRad = rotationRad;

      if (direction < 0) {
        // Counter-clockwise spin Landing at the exact same final modulo angle
        const TWO_PI = Math.PI * 2;
        const totalForward = targetRotation - rotationRad;
        const desiredMod = ((targetRotation % TWO_PI) + TWO_PI) % TWO_PI;
        const currentMod = ((rotationRad % TWO_PI) + TWO_PI) % TWO_PI;
        let deltaBack = desiredMod - currentMod;
        if (deltaBack >= 0) deltaBack -= TWO_PI;
        const approxRevs = Math.max(4, Math.round(totalForward / TWO_PI));
        targetRotationRad = rotationRad - approxRevs * TWO_PI + deltaBack;
      } else {
        targetRotationRad = reducedMotion
          ? rotationRad + ((targetRotation - rotationRad) % (Math.PI * 2)) + Math.PI * 2
          : targetRotation;
      }

      durationMs = reducedMotion ? 700 : duration;
      startTimeMs = performance.now();
      lastPhysicsTimeMs = startTimeMs;
      mode = 'spinning';

      const initialSlice = getSliceAtPointer(activeDistribution, rotationRad);
      lastSliceIndex = initialSlice ? initialSlice.index : -1;

      rafId = requestAnimationFrame(tickSpin);
      return true;
    },

    /**
     * Begins interactive user drag on the wheel.
     */
    beginDrag(distribution) {
      if (mode === 'spinning') return false;
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      activeDistribution = distribution;
      if (mode === 'idle' || mode === 'celebrating') {
        gravityAnchorRad = rotationRad;
      }
      mode = 'dragging';
      angularVelocity = 0;
      const initialSlice = getSliceAtPointer(activeDistribution, rotationRad);
      lastSliceIndex = initialSlice ? initialSlice.index : -1;
      return true;
    },

    /**
     * Updates wheel rotation while user drags with finger/mouse.
     */
    dragBy(deltaRad, dtSeconds) {
      if (mode !== 'dragging') return;
      rotationRad += deltaRad;
      const instantVel = deltaRad / Math.max(0.004, dtSeconds);
      angularVelocity = angularVelocity * 0.45 + instantVel * 0.55;

      const directionSign = deltaRad >= 0 ? 1 : -1;
      const speedNorm = Math.min(1, Math.abs(angularVelocity) / 14);
      const currentSlice = checkPegCrossing(rotationRad, speedNorm, directionSign);
      stepSpringAndParticles(Math.min(0.03, dtSeconds));

      if (typeof onFrame === 'function') {
        onFrame({
          rotationRad,
          pointerAngle,
          spinning: false,
          currentSlice,
          normalizedSpeed: speedNorm,
          progress: 0,
          particles
        });
      }
    },

    /**
     * Releases drag: if release velocity is below threshold, triggers real downward gravity (g)
     * rollback & pendulum oscillation back to equilibrium!
     */
    startGravityRollback(initialVelocityRadPerSec = 0) {
      if (mode === 'spinning') return;
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      mode = 'gravity_rollback';
      angularVelocity = initialVelocityRadPerSec;
      lastPhysicsTimeMs = performance.now();
      if (typeof onRollbackNotice === 'function') {
        onRollbackNotice();
      }
      rafId = requestAnimationFrame(tickGravityRollback);
    },

    skipToResult() {
      if (mode !== 'spinning') return false;
      finishSpin();
      return true;
    },

    isSpinning() {
      return mode === 'spinning';
    },

    getRotation() {
      return rotationRad;
    },

    setRotation(rad) {
      if (mode === 'spinning') return;
      rotationRad = rad;
      gravityAnchorRad = rad;
    }
  };
}
