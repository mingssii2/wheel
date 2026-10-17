import test from 'node:test';
import assert from 'node:assert/strict';
import {
  randomIntUnbiased,
  computeDistribution,
  sampleWinnerFromDistribution,
  computeTargetRotation
} from '../js/math/csprng.js';
import { runFairnessAudit, chiSquarePValue } from '../js/math/chi-square.js';
import { assignCycleSafeColors, getSliceAtPointer } from '../js/wheel/renderer.js';

test('randomIntUnbiased returns values strictly within [0, bound - 1] and handles bound = 1', () => {
  assert.equal(randomIntUnbiased(1), 0);
  for (let i = 0; i < 1000; i++) {
    const val = randomIntUnbiased(7);
    assert.ok(Number.isInteger(val) && val >= 0 && val < 7, `Out of bounds: ${val}`);
  }
  assert.throws(() => randomIntUnbiased(0), RangeError);
  assert.throws(() => randomIntUnbiased(-5), RangeError);
});

test('computeDistribution calculates exact probabilities for Independent, Balance, and Momentum modes', () => {
  const sampleItems = [
    { id: 'a', label: 'กะเพรา', weight: 1, wins: 1, eliminated: false },
    { id: 'b', label: 'ส้มตำ', weight: 1, wins: 0, eliminated: false },
    { id: 'c', label: 'ข้าวผัด', weight: 1, wins: 0, eliminated: false }
  ];

  // 1. Independent Mode: wins are ignored -> 1/3 each
  const distInd = computeDistribution(sampleItems, 'independent');
  assert.equal(distInd.activeItems.length, 3);
  assert.ok(Math.abs(distInd.activeItems[0].probability - 1 / 3) < 1e-9);
  assert.ok(Math.abs(distInd.activeItems[1].probability - 1 / 3) < 1e-9);

  // 2. Balance Mode: item 'a' has 1 win -> weight 1/(1+1) = 0.5; others have 1.0 -> total 2.5
  // Prob(a) = 0.5 / 2.5 = 20%, Prob(b) = Prob(c) = 1.0 / 2.5 = 40%
  const distBal = computeDistribution(sampleItems, 'balance');
  assert.ok(Math.abs(distBal.activeItems[0].probability - 0.2) < 1e-6);
  assert.ok(Math.abs(distBal.activeItems[1].probability - 0.4) < 1e-6);
  assert.ok(Math.abs(distBal.activeItems[2].probability - 0.4) < 1e-6);

  // 3. Momentum Mode: item 'a' has 1 win -> weight 1*(1+1) = 2; others have 1 -> total 4
  // Prob(a) = 2 / 4 = 50%, Prob(b) = Prob(c) = 1 / 4 = 25%
  const distMom = computeDistribution(sampleItems, 'momentum');
  assert.ok(Math.abs(distMom.activeItems[0].probability - 0.5) < 1e-6);
  assert.ok(Math.abs(distMom.activeItems[1].probability - 0.25) < 1e-6);
  assert.ok(Math.abs(distMom.activeItems[2].probability - 0.25) < 1e-6);
});

test('100,000-spin Monte Carlo Chi-Squared fairness test passes on non-power-of-two prime slices (N=7)', () => {
  const items = Array.from({ length: 7 }, (_, i) => ({
    id: `item_${i}`,
    label: `Choice ${i + 1}`,
    weight: 1,
    wins: 0,
    eliminated: false
  }));

  const audit = runFairnessAudit(items, 'independent', 100000);
  assert.equal(audit.trials, 100000);
  assert.equal(audit.degreesOfFreedom, 6);
  assert.ok(audit.pValue >= 0.0005, `Unexpectedly low p-value: ${audit.pValue} (chi2=${audit.chiSquare})`);
  assert.ok(audit.maxRelativeErrorPct < 1.0, `Max deviation too high: ${audit.maxRelativeErrorPct}%`);
});

test('100,000-spin Monte Carlo Chi-Squared test passes on weighted slices (1 : 2 : 5)', () => {
  const items = [
    { id: 'w1', label: 'Rare (12.5%)', weight: 1, wins: 0, eliminated: false },
    { id: 'w2', label: 'Uncommon (25%)', weight: 2, wins: 0, eliminated: false },
    { id: 'w3', label: 'Common (62.5%)', weight: 5, wins: 0, eliminated: false }
  ];

  const audit = runFairnessAudit(items, 'independent', 100000);
  assert.ok(audit.pValue >= 0.0005, `Weighted p-value failed: ${audit.pValue}`);
  assert.ok(Math.abs(audit.results[0].observedPct - 12.5) < 0.6);
  assert.ok(Math.abs(audit.results[1].observedPct - 25.0) < 0.8);
  assert.ok(Math.abs(audit.results[2].observedPct - 62.5) < 0.8);
});

test('computeTargetRotation lands strictly inside the winning slice angular span', () => {
  const items = [
    { id: '1', label: 'A', weight: 1 },
    { id: '2', label: 'B', weight: 2 },
    { id: '3', label: 'C', weight: 3 }
  ];
  const dist = computeDistribution(items, 'independent');
  const TWO_PI = Math.PI * 2;

  for (const slice of dist.activeItems) {
    const { targetRotation } = computeTargetRotation(1.234, slice, 6, 9);
    const pointerAngleOnWheel = (TWO_PI - (targetRotation % TWO_PI)) % TWO_PI;
    assert.ok(
      pointerAngleOnWheel > slice.startAngle && pointerAngleOnWheel < slice.endAngle,
      `Pointer angle ${pointerAngleOnWheel} did not land inside [${slice.startAngle}, ${slice.endAngle}]`
    );
  }
});

test('assignCycleSafeColors prevents adjacent color collisions for all N from 2 to 50 (including odd N)', () => {
  for (let n = 2; n <= 50; n++) {
    const colors = assignCycleSafeColors(n);
    assert.equal(colors.length, n);
    for (let i = 0; i < n; i++) {
      const next = (i + 1) % n;
      assert.notEqual(
        colors[i].fill,
        colors[next].fill,
        `Adjacent slices ${i} and ${next} collided with color ${colors[i].fill} for N=${n}`
      );
    }
  }
});

test('getSliceAtPointer maps targetRotation back to the exact winning slice', () => {
  const items = [
    { id: '1', label: 'ก', weight: 1 },
    { id: '2', label: 'ข', weight: 3 },
    { id: '3', label: 'ค', weight: 2 },
    { id: '4', label: 'ง', weight: 4 }
  ];
  const dist = computeDistribution(items, 'independent');

  for (const slice of dist.activeItems) {
    const { targetRotation } = computeTargetRotation(0.5, slice, 6, 8);
    const landed = getSliceAtPointer(dist, targetRotation);
    assert.equal(landed.item.id, slice.item.id);
  }
});

test('chiSquarePValue returns accurate survival probabilities', () => {
  const x = 4.605170185988092; // -2 * ln(0.1)
  const p = chiSquarePValue(x, 2);
  assert.ok(Math.abs(p - 0.1) < 1e-6, `Expected ~0.1, got ${p}`);
});
