/**
 * Cryptographically Fair Random Number & Discrete Distribution Engine
 * Uses W3C Web Crypto API (crypto.getRandomValues) + Exact Rejection Sampling (Lemire 2019).
 * Strictly zero Math.random() usage.
 */

const UINT32_MAX_PLUS_ONE = 0x100000000; // 2^32 = 4,294,967,296
const WEIGHT_SCALE = 10000; // Integer scaling factor for rational/history-adjusted weights

// Pre-allocated typed arrays to avoid garbage collection in hot loops
const singleUint32 = new Uint32Array(1);
const batchUint32 = new Uint32Array(4096);
let batchCursor = batchUint32.length;

/**
 * Returns the platform Web Crypto instance.
 */
function getCrypto() {
  if (typeof globalThis !== 'undefined' && globalThis.crypto && typeof globalThis.crypto.getRandomValues === 'function') {
    return globalThis.crypto;
  }
  throw new Error('Web Cryptography API (crypto.getRandomValues) is not available in this environment.');
}

/**
 * Draws a single raw 32-bit unsigned integer from the OS CSPRNG.
 * @returns {number} Integer in [0, 2^32 - 1]
 */
export function randomUint32() {
  getCrypto().getRandomValues(singleUint32);
  return singleUint32[0] >>> 0;
}

/**
 * Buffered CSPRNG draw for high-throughput Monte Carlo simulations (100,000+ spins).
 * Respects the 65,536-byte Web Crypto quota limit using a 16KB (4096 x Uint32) buffer.
 * @returns {number} Integer in [0, 2^32 - 1]
 */
export function bufferedRandomUint32() {
  if (batchCursor >= batchUint32.length) {
    getCrypto().getRandomValues(batchUint32);
    batchCursor = 0;
  }
  return batchUint32[batchCursor++] >>> 0;
}

/**
 * Unbiased discrete uniform integer in [0, bound - 1] via Rejection Sampling.
 * Eliminates modulo bias completely (Total Variation Distance = 0).
 *
 * @param {number} bound - Positive integer upper bound (exclusive), 1 <= bound <= 2^32
 * @param {boolean} [useBuffer=false] - Use batched CSPRNG buffer for bulk audits
 * @returns {number} Unbiased integer in [0, bound - 1]
 */
export function randomIntUnbiased(bound, useBuffer = false) {
  const n = Math.floor(Number(bound));
  if (!Number.isFinite(n) || n <= 0 || n > UINT32_MAX_PLUS_ONE) {
    throw new RangeError(`Invalid bound: ${bound}. Must be an integer in [1, 2^32].`);
  }
  if (n === 1) return 0;

  // Largest multiple of n <= 2^32. Any sample >= limit falls in the incomplete residue period and is rejected.
  const remainder = UINT32_MAX_PLUS_ONE % n;
  const limit = UINT32_MAX_PLUS_ONE - remainder;
  const draw = useBuffer ? bufferedRandomUint32 : randomUint32;

  while (true) {
    const x = draw();
    if (x < limit) {
      return x % n;
    }
  }
}

/**
 * Draws an unbiased uniform floating-point number in [0, 1) with 32-bit cryptographic resolution.
 * Used exclusively for visual sub-slice angle offset after the discrete winner is already locked.
 * @returns {number} Float in [0, 1)
 */
export function randomUnitFloat() {
  return randomUint32() / UINT32_MAX_PLUS_ONE;
}

/**
 * Computes effective integer weights and exact probabilities for active items
 * according to the selected Probability Mode:
 *
 * - 'independent': Memoryless I.I.D. -> W_eff = baseWeight * SCALE
 * - 'balance':     Inverse-Frequency (เกลี่ยให้ทั่วถึง / ลดโอกาสซ้ำ) -> W_eff = round((baseWeight * SCALE) / (1 + wins))
 * - 'momentum':    Pólya Urn Reinforcement (ยิ่งออกยิ่งมาแรง / เพิ่มโอกาสซ้ำ) -> W_eff = round(baseWeight * SCALE * (1 + wins))
 *
 * @param {Array<{id: string, label: string, weight: number, wins?: number, eliminated?: boolean}>} items
 * @param {'independent'|'balance'|'momentum'} [mode='independent']
 * @returns {{
 *   activeItems: Array<{index: number, item: object, baseWeight: number, wins: number, effectiveWeight: number, probability: number, angleSpan: number, startAngle: number, endAngle: number}>,
 *   prefixSums: number[],
 *   totalEffectiveWeight: number
 * }}
 */
export function computeDistribution(items, mode = 'independent') {
  if (!Array.isArray(items)) {
    return { activeItems: [], prefixSums: [], totalEffectiveWeight: 0 };
  }

  const activeItems = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (!item || item.eliminated) continue;

    const rawWeight = Number(item.weight);
    const baseWeight = Number.isFinite(rawWeight) && rawWeight > 0 ? Math.min(Math.max(rawWeight, 0.01), 10000) : 1;
    const wins = Number.isFinite(Number(item.wins)) && Number(item.wins) > 0 ? Math.floor(Number(item.wins)) : 0;

    let effectiveWeight;
    if (mode === 'balance') {
      effectiveWeight = Math.max(1, Math.round((baseWeight * WEIGHT_SCALE) / (1 + wins)));
    } else if (mode === 'momentum') {
      effectiveWeight = Math.max(1, Math.round(baseWeight * WEIGHT_SCALE * (1 + wins)));
    } else {
      effectiveWeight = Math.max(1, Math.round(baseWeight * WEIGHT_SCALE));
    }

    activeItems.push({
      index: i,
      item,
      baseWeight,
      wins,
      effectiveWeight,
      probability: 0,
      angleSpan: 0,
      startAngle: 0,
      endAngle: 0
    });
  }

  const prefixSums = new Array(activeItems.length);
  let runningTotal = 0;
  for (let i = 0; i < activeItems.length; i++) {
    runningTotal += activeItems[i].effectiveWeight;
    prefixSums[i] = runningTotal;
  }

  if (runningTotal > 0) {
    let currentAngle = 0;
    const TWO_PI = Math.PI * 2;
    for (let i = 0; i < activeItems.length; i++) {
      const prob = activeItems[i].effectiveWeight / runningTotal;
      const span = i === activeItems.length - 1 ? Math.max(0, TWO_PI - currentAngle) : prob * TWO_PI;
      activeItems[i].probability = prob;
      activeItems[i].angleSpan = span;
      activeItems[i].startAngle = currentAngle;
      activeItems[i].endAngle = currentAngle + span;
      currentAngle += span;
    }
  }

  return {
    activeItems,
    prefixSums,
    totalEffectiveWeight: runningTotal
  };
}

/**
 * Binary searches the cumulative prefix sum array for target u in [0, totalEffectiveWeight - 1].
 * Runs in O(log N) time with zero floating-point precision loss.
 *
 * @param {number[]} prefixSums
 * @param {number} u
 * @returns {number} Index in activeItems
 */
export function binarySearchPrefixSum(prefixSums, u) {
  let low = 0;
  let high = prefixSums.length - 1;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (u < prefixSums[mid]) {
      high = mid;
    } else {
      low = mid + 1;
    }
  }
  return low;
}

/**
 * Selects a single winning slice from a precomputed distribution using CSPRNG + Exact Rejection Sampling.
 *
 * @param {{activeItems: Array, prefixSums: number[], totalEffectiveWeight: number}} dist
 * @param {boolean} [useBuffer=false]
 * @returns {{winnerActiveIndex: number, winnerEntry: object} | null}
 */
export function sampleWinnerFromDistribution(dist, useBuffer = false) {
  if (!dist || dist.activeItems.length === 0 || dist.totalEffectiveWeight <= 0) {
    return null;
  }
  if (dist.activeItems.length === 1) {
    return {
      winnerActiveIndex: 0,
      winnerEntry: dist.activeItems[0]
    };
  }

  const u = randomIntUnbiased(dist.totalEffectiveWeight, useBuffer);
  const winnerActiveIndex = binarySearchPrefixSum(dist.prefixSums, u);
  return {
    winnerActiveIndex,
    winnerEntry: dist.activeItems[winnerActiveIndex]
  };
}

/**
 * Computes the deterministic target wheel rotation angle (in radians) so that the stationary
 * pointer at 12 o'clock (-PI/2 or 3*PI/2 in standard canvas coordinates, normalized to 0 rad at top)
 * lands inside the winning slice's angular span with a 4% visual safety margin from the border pegs.
 *
 * @param {number} currentRotation - Current wheel rotation angle in radians
 * @param {{startAngle: number, endAngle: number, angleSpan: number}} winnerSlice
 * @param {number} [minSpins=6]
 * @param {number} [maxSpins=9]
 * @returns {{targetRotation: number, landingOffsetRad: number, subSliceRatio: number}}
 */
export function computeTargetRotation(currentRotation, winnerSlice, minSpins = 6, maxSpins = 9) {
  const TWO_PI = Math.PI * 2;
  const guardMargin = 0.06; // 6% margin from slice divider pins so pointer never looks ambiguous
  const uSub = guardMargin + (1 - 2 * guardMargin) * randomUnitFloat();
  const landingOffsetRad = winnerSlice.startAngle + winnerSlice.angleSpan * uSub;

  // In our renderer, wheel angle 0 places slice angle 0 at 12 o'clock (top pointer).
  // Rotating the wheel clockwise by +theta brings slice angle (-theta mod 2PI) to the 12 o'clock pointer.
  const desiredModAngle = (TWO_PI - (landingOffsetRad % TWO_PI)) % TWO_PI;
  const currentModAngle = ((currentRotation % TWO_PI) + TWO_PI) % TWO_PI;

  let deltaForward = desiredModAngle - currentModAngle;
  if (deltaForward <= 0) {
    deltaForward += TWO_PI;
  }

  const extraRevolutions = minSpins + randomIntUnbiased(Math.max(1, maxSpins - minSpins + 1));
  const targetRotation = currentRotation + extraRevolutions * TWO_PI + deltaForward;

  return {
    targetRotation,
    landingOffsetRad,
    subSliceRatio: uSub
  };
}
