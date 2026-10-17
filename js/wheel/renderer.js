/**
 * Minimal High-Legibility Wheel Renderer
 * Features:
 * - OffscreenCanvas O(1) static wheel caching
 * - Cycle-Graph (C_N) soft minimal palette so adjacent slices never clash and ALL text is dark & easy to read
 * - Stationary, rock-steady orthographic layout with a prominent center SPIN button
 */

import { truncateGraphemes } from '../state/serializer.js';

/**
 * Calm Minimalist Palette:
 * Soft, pleasant Nordic/MUJI-inspired pastel & warm neutral tints.
 * Every slice uses high-contrast deep slate (#0F172A) text for effortless reading.
 */
export const SWISS_PALETTE = [
  { fill: '#E8F0FE', text: '#0F172A', subText: '#334155', name: 'Soft Sky' },
  { fill: '#FEF3C7', text: '#0F172A', subText: '#334155', name: 'Warm Sand' },
  { fill: '#DCFCE7', text: '#0F172A', subText: '#334155', name: 'Sage Mint' },
  { fill: '#FCE7F3', text: '#0F172A', subText: '#334155', name: 'Rose Mist' },
  { fill: '#EDE9FE', text: '#0F172A', subText: '#334155', name: 'Lavender Fog' },
  { fill: '#FFEDD5', text: '#0F172A', subText: '#334155', name: 'Soft Peach' },
  { fill: '#CCFBF1', text: '#0F172A', subText: '#334155', name: 'Seafoam' },
  { fill: '#F1F5F9', text: '#0F172A', subText: '#334155', name: 'Cool Stone' }
];

/**
 * Assigns palette colors to N slices around a cycle graph C_N such that
 * slice[i] !== slice[i-1] AND slice[N-1] !== slice[0] for all N >= 2.
 *
 * @param {number} count
 * @returns {Array<{fill: string, text: string, subText: string}>}
 */
export function assignCycleSafeColors(count) {
  if (count <= 0) return [];
  const k = SWISS_PALETTE.length;
  const assigned = new Array(count);

  for (let i = 0; i < count; i++) {
    let colorIdx = i % k;
    if (i === count - 1 && count > 1) {
      const firstIdx = 0;
      const prevIdx = assigned[i - 1]._idx;
      while (colorIdx === firstIdx || colorIdx === prevIdx) {
        colorIdx = (colorIdx + 1) % k;
      }
    }
    assigned[i] = { ...SWISS_PALETTE[colorIdx], _idx: colorIdx };
  }
  return assigned;
}

/**
 * Determines which slice in `distribution.activeItems` is currently under the 12 o'clock pointer
 * for a given clockwise wheel rotation angle `rotationRad`.
 *
 * @param {object} distribution
 * @param {number} rotationRad
 * @returns {object | null}
 */
export function getSliceAtPointer(distribution, rotationRad) {
  if (!distribution || !distribution.activeItems || distribution.activeItems.length === 0) {
    return null;
  }
  const active = distribution.activeItems;
  if (active.length === 1) return active[0];

  const TWO_PI = Math.PI * 2;
  const pointerWheelAngle = (TWO_PI - ((rotationRad % TWO_PI + TWO_PI) % TWO_PI)) % TWO_PI;

  let low = 0;
  let high = active.length - 1;
  while (low <= high) {
    const mid = (low + high) >>> 1;
    const s = active[mid];
    if (pointerWheelAngle >= s.startAngle && pointerWheelAngle < s.endAngle) {
      return s;
    }
    if (pointerWheelAngle < s.startAngle) {
      high = mid - 1;
    } else {
      low = mid + 1;
    }
  }
  return active[active.length - 1];
}

export function createWheelRenderer(canvas) {
  const ctx = canvas.getContext('2d', { alpha: true });
  let dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  let width = 520;
  let height = 520;

  let cacheCanvas = null;
  let cacheCtx = null;
  let cacheDirty = true;
  let currentDistribution = { activeItems: [], prefixSums: [], totalEffectiveWeight: 0 };
  let highlightedWinnerId = null;

  function ensureOffscreen(pixelSize) {
    if (!cacheCanvas) {
      if (typeof OffscreenCanvas !== 'undefined') {
        cacheCanvas = new OffscreenCanvas(pixelSize, pixelSize);
      } else {
        cacheCanvas = document.createElement('canvas');
      }
      cacheCtx = cacheCanvas.getContext('2d');
    }
    if (cacheCanvas.width !== pixelSize || cacheCanvas.height !== pixelSize) {
      cacheCanvas.width = pixelSize;
      cacheCanvas.height = pixelSize;
      cacheDirty = true;
    }
  }

  function resize(newCssWidth, newCssHeight) {
    dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    width = Math.max(240, Math.floor(newCssWidth));
    height = Math.max(240, Math.floor(newCssHeight));
    const pixelW = Math.floor(width * dpr);
    const pixelH = Math.floor(height * dpr);

    if (canvas.width !== pixelW || canvas.height !== pixelH) {
      canvas.width = pixelW;
      canvas.height = pixelH;
      cacheDirty = true;
    }
  }

  function setDistribution(dist, winnerId = null) {
    currentDistribution = dist;
    highlightedWinnerId = winnerId;
    cacheDirty = true;
  }

  /**
   * Renders the static wheel face onto the offscreen canvas.
   */
  function rebuildWheelCache(wheelRadius) {
    const size = Math.ceil(wheelRadius * 2.12 * dpr);
    ensureOffscreen(size);

    const c = cacheCtx;
    c.save();
    c.clearRect(0, 0, size, size);
    c.scale(dpr, dpr);

    const center = size / (2 * dpr);
    const rOuter = wheelRadius;
    const rInner = rOuter * 0.965;
    const active = currentDistribution.activeItems;
    const n = active.length;

    // 1. Clean Minimal Outer Rim
    c.beginPath();
    c.arc(center, center, rOuter, 0, Math.PI * 2);
    c.fillStyle = '#1E293B';
    c.fill();

    if (n === 0) {
      c.beginPath();
      c.arc(center, center, rInner, 0, Math.PI * 2);
      c.fillStyle = '#F8FAFC';
      c.fill();

      c.fillStyle = '#64748B';
      c.font = '600 15px "Plus Jakarta Sans", "Noto Sans Thai", sans-serif';
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText('เพิ่มคำตอบด้านขวาเพื่อเริ่มหมุน', center, center - rOuter * 0.42);
      c.restore();
      cacheDirty = false;
      return;
    }

    const palette = assignCycleSafeColors(n);
    const TOP_OFFSET = -Math.PI / 2;

    // 2. Draw proportional slices with soft minimal tones
    for (let i = 0; i < n; i++) {
      const slice = active[i];
      const color = palette[i];
      const a0 = TOP_OFFSET + slice.startAngle;
      const a1 = TOP_OFFSET + slice.endAngle;
      const isWinner = highlightedWinnerId && slice.item.id === highlightedWinnerId;

      c.beginPath();
      c.moveTo(center, center);
      c.arc(center, center, rInner, a0, a1, false);
      c.closePath();

      c.fillStyle = isWinner ? '#FDE68A' : color.fill;
      c.fill();

      c.lineWidth = n > 50 ? 1 : 1.75;
      c.strokeStyle = '#CBD5E1';
      c.stroke();

      if (isWinner) {
        c.save();
        c.lineWidth = 3.5;
        c.strokeStyle = '#0F172A';
        c.stroke();
        c.restore();
      }
    }

    // 3. Draw high-legibility dark typography on each slice
    for (let i = 0; i < n; i++) {
      const slice = active[i];
      const color = palette[i];
      const midAngle = TOP_OFFSET + (slice.startAngle + slice.endAngle) / 2;
      const spanDeg = (slice.angleSpan * 180) / Math.PI;

      if (spanDeg < 4.5) continue;

      c.save();
      c.translate(center, center);
      c.rotate(midAngle);

      const textRadius = rInner * 0.90;
      const availableWidth = rInner * 0.56;
      const fontSize = Math.max(11, Math.min(18, Math.floor(rInner * 0.072 * Math.min(1, spanDeg / 16))));

      c.textAlign = 'right';
      c.textBaseline = 'middle';
      c.fillStyle = color.text;
      c.font = `700 ${fontSize}px "Plus Jakarta Sans", "Noto Sans Thai", sans-serif`;

      const maxChars = Math.max(6, Math.floor(availableWidth / (fontSize * 0.54)));
      const displayLabel = truncateGraphemes(slice.item.label, maxChars, true);

      if (spanDeg >= 13) {
        c.fillText(displayLabel, textRadius, -fontSize * 0.34);
        const pctStr = `${(slice.probability * 100).toFixed(1)}%`;
        c.font = `600 ${Math.max(9.5, Math.floor(fontSize * 0.68))}px "JetBrains Mono", monospace`;
        c.fillStyle = color.subText;
        c.fillText(pctStr, textRadius, fontSize * 0.56);
      } else {
        c.fillText(displayLabel, textRadius, 0);
      }

      c.restore();
    }

    // 4. Clean subtle perimeter pins
    if (n >= 2 && n <= 100) {
      for (let i = 0; i < n; i++) {
        const pegAngle = TOP_OFFSET + active[i].startAngle;
        const px = center + Math.cos(pegAngle) * rInner;
        const py = center + Math.sin(pegAngle) * rInner;
        const pegR = Math.max(2, Math.min(4, rOuter * 0.015));

        c.beginPath();
        c.arc(px, py, pegR, 0, Math.PI * 2);
        c.fillStyle = '#FFFFFF';
        c.fill();
        c.lineWidth = 1.5;
        c.strokeStyle = '#1E293B';
        c.stroke();
      }
    }

    c.restore();
    cacheDirty = false;
  }

  /**
   * Renders a single frame in O(1) time.
   * Keeps the wheel stationary and makes the center SPIN hub the unmistakable hero button.
   */
  function renderFrame(rotationRad = 0, pointerDeflectionRad = 0, isSpinning = false) {
    const cx = width / 2;
    const cy = height / 2 + 4;
    const wheelRadius = Math.min(width, height) * 0.445;

    if (cacheDirty) {
      rebuildWheelCache(wheelRadius);
    }

    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    // 1. Soft Minimal Drop Shadow under the wheel
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy + 6, wheelRadius, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(15, 23, 42, 0.08)';
    ctx.fill();
    ctx.restore();

    // 2. Blit Rotating Cached Wheel Disc
    const cacheCssSize = cacheCanvas.width / dpr;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rotationRad);
    ctx.drawImage(
      cacheCanvas,
      0,
      0,
      cacheCanvas.width,
      cacheCanvas.height,
      -cacheCssSize / 2,
      -cacheCssSize / 2,
      cacheCssSize,
      cacheCssSize
    );
    ctx.restore();

    // 3. Prominent Hero Center "SPIN" Button (Stationary, Crisp & High-Contrast)
    const rHubOuter = wheelRadius * 0.235;
    const rHubInner = wheelRadius * 0.205;

    // Outer white halo ring to separate SPIN button cleanly from slice text
    ctx.beginPath();
    ctx.arc(cx, cy, rHubOuter, 0, Math.PI * 2);
    ctx.fillStyle = '#FFFFFF';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#E2E8F0';
    ctx.stroke();

    // Main center button circle
    ctx.beginPath();
    ctx.arc(cx, cy, rHubInner, 0, Math.PI * 2);
    ctx.fillStyle = isSpinning ? '#F59E0B' : '#0F172A';
    ctx.fill();

    // Center button label + sub-caption
    ctx.fillStyle = isSpinning ? '#0F172A' : '#FFFFFF';
    const mainFont = Math.max(14, Math.floor(rHubInner * 0.40));
    const subFont = Math.max(9.5, Math.floor(rHubInner * 0.23));
    ctx.font = `800 ${mainFont}px "Plus Jakarta Sans", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(isSpinning ? 'SKIP' : 'SPIN', cx, cy - subFont * 0.55);

    ctx.font = `600 ${subFont}px "Noto Sans Thai", "Plus Jakarta Sans", sans-serif`;
    ctx.fillStyle = isSpinning ? '#1E293B' : '#CBD5E1';
    ctx.fillText(isSpinning ? 'กดเพื่อหยุด' : 'กดหมุนที่นี่', cx, cy + mainFont * 0.58);

    // 4. Clean Minimal Pointer Needle at 12 o'clock
    const pointerPivotX = cx;
    const pointerPivotY = cy - wheelRadius - 4;
    const pointerLength = wheelRadius * 0.14;
    const pointerWidth = wheelRadius * 0.068;

    ctx.save();
    ctx.translate(pointerPivotX, pointerPivotY);
    ctx.rotate(pointerDeflectionRad);

    ctx.beginPath();
    ctx.moveTo(0, pointerLength);
    ctx.lineTo(-pointerWidth, -4);
    ctx.lineTo(pointerWidth, -4);
    ctx.closePath();
    ctx.fillStyle = '#0F172A';
    ctx.fill();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = '#FFFFFF';
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(0, -2, pointerWidth * 0.45, 0, Math.PI * 2);
    ctx.fillStyle = '#FFFFFF';
    ctx.fill();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = '#0F172A';
    ctx.stroke();

    ctx.restore();
    ctx.restore();
  }

  return {
    resize,
    setDistribution,
    renderFrame,
    invalidate() {
      cacheDirty = true;
    }
  };
}
