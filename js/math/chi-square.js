/**
 * Pearson's Chi-Squared (χ²) Goodness-of-Fit Statistical Verification Engine
 * Executes 100,000 cryptographic spins and computes exact χ² and incomplete gamma p-value.
 */

import { computeDistribution, sampleWinnerFromDistribution } from './csprng.js';

/**
 * Lanczos approximation for ln(Gamma(z)) accurate to ~15 decimal digits.
 * @param {number} z
 * @returns {number}
 */
function logGamma(z) {
  const g = 7;
  const p = [
    0.99999999999980993,
    676.5203681218851,
    -1259.1392167224028,
    771.32342877765313,
    -176.61502916214059,
    12.507343278686905,
    -0.13857109526572012,
    9.9843695780195716e-6,
    1.5056327351493116e-7
  ];

  if (z < 0.5) {
    return Math.log(Math.PI) - Math.log(Math.sin(Math.PI * z)) - logGamma(1 - z);
  }

  z -= 1;
  let x = p[0];
  for (let i = 1; i < g + 2; i++) {
    x += p[i] / (z + i);
  }
  const t = z + g + 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
}

/**
 * Regularized Lower Incomplete Gamma P(a, x) via series expansion.
 */
function gammaSeriesP(a, x) {
  if (x <= 0) return 0;
  const maxIter = 500;
  const eps = 1e-14;
  let ap = a;
  let sum = 1 / a;
  let del = sum;

  for (let n = 1; n <= maxIter; n++) {
    ap += 1;
    del *= x / ap;
    sum += del;
    if (Math.abs(del) < Math.abs(sum) * eps) {
      break;
    }
  }
  return sum * Math.exp(-x + a * Math.log(x) - logGamma(a));
}

/**
 * Regularized Upper Incomplete Gamma Q(a, x) via Lentz's continued fraction method.
 */
function gammaContinuedFractionQ(a, x) {
  const maxIter = 500;
  const eps = 1e-14;
  const fpMin = 1e-300;

  let b = x + 1 - a;
  let c = 1 / fpMin;
  let d = 1 / b;
  let h = d;

  for (let i = 1; i <= maxIter; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < fpMin) d = fpMin;
    c = b + an / c;
    if (Math.abs(c) < fpMin) c = fpMin;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < eps) {
      break;
    }
  }
  return Math.exp(-x + a * Math.log(x) - logGamma(a)) * h;
}

/**
 * Computes the exact survival function (p-value) for a Chi-Squared statistic:
 * p = P(X >= chiSquare) = Q(df / 2, chiSquare / 2)
 *
 * @param {number} chiSquare
 * @param {number} degreesOfFreedom
 * @returns {number} p-value in [0, 1]
 */
export function chiSquarePValue(chiSquare, degreesOfFreedom) {
  if (degreesOfFreedom <= 0) return 1;
  if (chiSquare <= 0) return 1;

  const a = degreesOfFreedom / 2;
  const x = chiSquare / 2;

  if (x < a + 1) {
    return Math.max(0, Math.min(1, 1 - gammaSeriesP(a, x)));
  }
  return Math.max(0, Math.min(1, gammaContinuedFractionQ(a, x)));
}

/**
 * Runs a high-speed Monte Carlo simulation using the exact Web Crypto CSPRNG + Rejection Sampler
 * and evaluates Pearson's Chi-Squared goodness-of-fit test.
 *
 * @param {Array<{id: string, label: string, weight: number, wins?: number, eliminated?: boolean}>} items
 * @param {'independent'|'balance'|'momentum'} [mode='independent']
 * @param {number} [trials=100000]
 * @returns {{
 *   trials: number,
 *   degreesOfFreedom: number,
 *   chiSquare: number,
 *   pValue: number,
 *   passed: boolean,
 *   maxRelativeErrorPct: number,
 *   durationMs: number,
 *   results: Array<{label: string, observed: number, expected: number, probabilityPct: number, observedPct: number, deviationPct: number}>
 * }}
 */
export function runFairnessAudit(items, mode = 'independent', trials = 100000) {
  const startTime = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const dist = computeDistribution(items, mode);
  const k = dist.activeItems.length;

  if (k === 0) {
    return {
      trials: 0,
      degreesOfFreedom: 0,
      chiSquare: 0,
      pValue: 1,
      passed: true,
      maxRelativeErrorPct: 0,
      durationMs: 0,
      results: []
    };
  }

  const counts = new Uint32Array(k);
  for (let t = 0; t < trials; t++) {
    const sample = sampleWinnerFromDistribution(dist, true);
    counts[sample.winnerActiveIndex]++;
  }

  let chiSquare = 0;
  let maxRelativeErrorPct = 0;
  const results = new Array(k);

  for (let i = 0; i < k; i++) {
    const entry = dist.activeItems[i];
    const observed = counts[i];
    const expected = trials * entry.probability;
    const diff = observed - expected;
    if (expected > 0) {
      chiSquare += (diff * diff) / expected;
    }

    const probabilityPct = entry.probability * 100;
    const observedPct = (observed / trials) * 100;
    const deviationPct = observedPct - probabilityPct;
    const absDev = Math.abs(deviationPct);
    if (absDev > maxRelativeErrorPct) {
      maxRelativeErrorPct = absDev;
    }

    results[i] = {
      label: entry.item.label,
      observed,
      expected: Math.round(expected),
      probabilityPct,
      observedPct,
      deviationPct
    };
  }

  const degreesOfFreedom = Math.max(0, k - 1);
  const pValue = degreesOfFreedom > 0 ? chiSquarePValue(chiSquare, degreesOfFreedom) : 1;
  const endTime = typeof performance !== 'undefined' ? performance.now() : Date.now();

  // At alpha = 0.001, pValue >= 0.001 indicates the observed frequencies are consistent with the theoretical distribution
  return {
    trials,
    degreesOfFreedom,
    chiSquare,
    pValue,
    passed: pValue >= 0.001,
    maxRelativeErrorPct,
    durationMs: Math.max(1, Math.round((endTime - startTime) * 10) / 10),
    results
  };
}
