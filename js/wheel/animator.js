/**
 * Deterministic Time-Parametric Wheel Animator & Spring Clapper Physics
 * Strictly decoupled from outcome determination: winner k* and targetRotation
 * are computed by CSPRNG before animation begins.
 */

import { getSliceAtPointer } from './renderer.js';

/**
 * C²-continuous quartic ease-out curve: E(tau) = 1 - (1 - tau)^4
 * Derivative E'(tau) = 4 * (1 - tau)^3 -> smoothly decelerates to 0 at tau = 1.
 *
 * @param {number} tau - Normalized time in [0, 1]
 * @returns {number}
 */
export function quarticEaseOut(tau) {
  const t = Math.max(0, Math.min(1, tau));
  const inv = 1 - t;
  return 1 - inv * inv * inv * inv;
}

export function createWheelAnimator({ onFrame, onSliceTick, onComplete }) {
  let rotationRad = 0;
  let startRotationRad = 0;
  let targetRotationRad = 0;
  let startTimeMs = 0;
  let durationMs = 4600;
  let spinning = false;
  let rafId = null;
  let activeDistribution = null;
  let pendingResult = null;
  let lastSliceIndex = -1;

  // Spring-damper state for the top mechanical pointer clapper
  let pointerAngle = 0;
  let pointerVelocity = 0;
  let lastFrameTimeMs = 0;

  function stepSpringPhysics(nowMs) {
    const dt = lastFrameTimeMs > 0 ? Math.min(0.05, (nowMs - lastFrameTimeMs) / 1000) : 0.016;
    lastFrameTimeMs = nowMs;

    const stiffness = 260;
    const damping = 18;
    const accel = -stiffness * pointerAngle - damping * pointerVelocity;
    pointerVelocity += accel * dt;
    pointerAngle += pointerVelocity * dt;

    if (Math.abs(pointerAngle) < 0.001 && Math.abs(pointerVelocity) < 0.001) {
      pointerAngle = 0;
      pointerVelocity = 0;
    }
  }

  function tick(nowMs) {
    if (!spinning) return;

    const elapsed = nowMs - startTimeMs;
    const tau = Math.max(0, Math.min(1, elapsed / durationMs));
    const eased = quarticEaseOut(tau);
    const totalDelta = targetRotationRad - startRotationRad;

    rotationRad = startRotationRad + totalDelta * eased;

    // Instantaneous normalized speed E'(tau) / 4 = (1 - tau)^3 in [0, 1]
    const inv = 1 - tau;
    const normalizedSpeed = inv * inv * inv;

    // Detect slice boundary crossing under the 12 o'clock pointer
    const currentSlice = getSliceAtPointer(activeDistribution, rotationRad);
    if (currentSlice) {
      if (lastSliceIndex !== -1 && currentSlice.index !== lastSliceIndex) {
        // Kick the clapper pointer in the direction of wheel motion (clockwise -> negative angle kick)
        const impulse = -Math.min(0.52, 0.18 + normalizedSpeed * 0.34);
        pointerAngle = Math.max(-0.58, Math.min(pointerAngle, impulse));
        pointerVelocity = -2.2 * normalizedSpeed;
        if (typeof onSliceTick === 'function') {
          onSliceTick(currentSlice, normalizedSpeed);
        }
      }
      lastSliceIndex = currentSlice.index;
    }

    stepSpringPhysics(nowMs);

    if (typeof onFrame === 'function') {
      onFrame({
        rotationRad,
        pointerAngle,
        spinning: tau < 1,
        currentSlice,
        normalizedSpeed,
        progress: tau
      });
    }

    if (tau < 1) {
      rafId = requestAnimationFrame(tick);
    } else {
      finishSpin();
    }
  }

  function finishSpin() {
    if (!spinning) return;
    spinning = false;
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    rotationRad = targetRotationRad % (Math.PI * 2);
    pointerAngle = 0;
    pointerVelocity = 0;

    const finalSlice = getSliceAtPointer(activeDistribution, rotationRad);
    if (typeof onFrame === 'function') {
      onFrame({
        rotationRad,
        pointerAngle: 0,
        spinning: false,
        currentSlice: finalSlice,
        normalizedSpeed: 0,
        progress: 1
      });
    }

    const resultToDeliver = pendingResult;
    pendingResult = null;
    if (typeof onComplete === 'function' && resultToDeliver) {
      onComplete(resultToDeliver);
    }
  }

  return {
    startSpin({ targetRotation, duration = 4600, distribution, resultPayload, reducedMotion = false }) {
      if (spinning) return false;

      activeDistribution = distribution;
      pendingResult = resultPayload;
      startRotationRad = rotationRad;
      targetRotationRad = reducedMotion
        ? rotationRad + ((targetRotation - rotationRad) % (Math.PI * 2)) + Math.PI * 2
        : targetRotation;
      durationMs = reducedMotion ? 650 : duration;
      startTimeMs = performance.now();
      lastFrameTimeMs = startTimeMs;
      spinning = true;

      const initialSlice = getSliceAtPointer(activeDistribution, rotationRad);
      lastSliceIndex = initialSlice ? initialSlice.index : -1;

      rafId = requestAnimationFrame(tick);
      return true;
    },

    skipToResult() {
      if (!spinning) return false;
      finishSpin();
      return true;
    },

    isSpinning() {
      return spinning;
    },

    getRotation() {
      return rotationRad;
    },

    setRotation(rad) {
      if (spinning) return;
      rotationRad = rad;
    }
  };
}
