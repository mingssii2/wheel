/**
 * Orthographic 3D Neo-Brutalist Swiss Editorial Wheel Renderer
 * Features:
 * - OffscreenCanvas O(1) static wheel caching (re-rasterized only on item/resize changes)
 * - Cycle-Graph (C_N) greedy palette coloring so adjacent slices NEVER clash (even on odd N)
 * - Grapheme-safe Thai + Emoji radial typography with live probability & weight sub-labels
 * - 3D extruded cylindrical drop-shadow rim, brass/ink perimeter pegs, and spring clapper pointer
 */

import { truncateGraphemes } from '../state/serializer.js';

/**
 * Curated Neo-Brutalist Swiss / Bauhaus Editorial Palette.
 * Each entry specifies fill color and high-contrast ink/cream text color.
 */
export const SWISS_PALETTE = [
  { fill: '#1E40AF', text: '#FAF7F2', subText: '#DBEAFE', name: 'Cobalt' },
  { fill: '#D9381E', text: '#FAF7F2', subText: '#FEE2E2', name: 'Vermilion' },
  { fill: '#EAB308', text: '#141413', subText: '#292524', name: 'Ochre' },
  { fill: '#15803D', text: '#FAF7F2', subText: '#DCFCE7', name: 'Forest' },
  { fill: '#F3EDE2', text: '#141413', subText: '#44403C', name: 'Editorial Cream' },
  { fill: '#C2410C', text: '#FAF7F2', subText: '#FFEDD5', name: 'Terracotta' },
  { fill: '#0F766E', text: '#FAF7F2', subText: '#CCFBF1', name: 'Deep Teal' },
  { fill: '#312E81', text: '#FAF7F2', subText: '#E0E7FF', name: 'Ultramarine' }
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

  // Binary search or linear scan over startAngle..endAngle
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

  // Offscreen cache for static wheel disc
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
   * Angle 0 in wheel space is at 12 o'clock (-PI/2 in standard canvas coordinates).
   */
  function rebuildWheelCache(wheelRadius) {
    const size = Math.ceil(wheelRadius * 2.15 * dpr);
    ensureOffscreen(size);

    const c = cacheCtx;
    c.save();
    c.clearRect(0, 0, size, size);
    c.scale(dpr, dpr);

    const center = size / (2 * dpr);
    const rOuter = wheelRadius;
    const rBezelInner = rOuter * 0.925;
    const rHub = rOuter * 0.175;
    const active = currentDistribution.activeItems;
    const n = active.length;

    // 1. Outer Swiss Architectural Bezel Ring (#141413)
    c.beginPath();
    c.arc(center, center, rOuter, 0, Math.PI * 2);
    c.fillStyle = '#141413';
    c.fill();

    // Fine degree tick marks on the dark bezel
    c.save();
    c.translate(center, center);
    for (let deg = 0; deg < 360; deg += 6) {
      const rad = (deg * Math.PI) / 180;
      const isMajor = deg % 30 === 0;
      const len = isMajor ? rOuter * 0.042 : rOuter * 0.022;
      c.beginPath();
      c.moveTo(Math.cos(rad) * (rOuter - 2), Math.sin(rad) * (rOuter - 2));
      c.lineTo(Math.cos(rad) * (rOuter - 2 - len), Math.sin(rad) * (rOuter - 2 - len));
      c.strokeStyle = isMajor ? 'rgba(250, 247, 242, 0.65)' : 'rgba(250, 247, 242, 0.25)';
      c.lineWidth = isMajor ? 1.5 : 1;
      c.stroke();
    }
    c.restore();

    if (n === 0) {
      // Empty wheel state
      c.beginPath();
      c.arc(center, center, rBezelInner, 0, Math.PI * 2);
      c.fillStyle = '#EFECE6';
      c.fill();
      c.lineWidth = 3;
      c.strokeStyle = '#141413';
      c.stroke();

      c.fillStyle = '#57534E';
      c.font = '700 15px "Plus Jakarta Sans", "Noto Sans Thai", sans-serif';
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText('กรุณาเพิ่มหรือเปิดใช้งานคำตอบอย่างน้อย 1 ข้อ', center, center - rOuter * 0.35);
      c.restore();
      cacheDirty = false;
      return;
    }

    const palette = assignCycleSafeColors(n);
    const TOP_OFFSET = -Math.PI / 2; // 12 o'clock

    // 2. Draw proportional slices
    for (let i = 0; i < n; i++) {
      const slice = active[i];
      const color = palette[i];
      const a0 = TOP_OFFSET + slice.startAngle;
      const a1 = TOP_OFFSET + slice.endAngle;
      const isWinner = highlightedWinnerId && slice.item.id === highlightedWinnerId;

      c.beginPath();
      c.moveTo(center, center);
      c.arc(center, center, rBezelInner, a0, a1, false);
      c.closePath();

      c.fillStyle = color.fill;
      c.fill();

      // Winner spotlight highlight overlay
      if (isWinner) {
        c.save();
        c.fillStyle = 'rgba(255, 255, 255, 0.16)';
        c.fill();
        c.lineWidth = 4;
        c.strokeStyle = '#FAF7F2';
        c.stroke();
        c.restore();
      }

      // Crisp Swiss ink slice divider
      c.lineWidth = n > 60 ? 1 : 2.5;
      c.strokeStyle = '#141413';
      c.stroke();
    }

    // 3. Draw radial text & probability/weight badges on slices
    for (let i = 0; i < n; i++) {
      const slice = active[i];
      const color = palette[i];
      const midAngle = TOP_OFFSET + (slice.startAngle + slice.endAngle) / 2;
      const spanDeg = (slice.angleSpan * 180) / Math.PI;

      // Hide radial text only if slice is narrower than 4.2 degrees (shown in Live Pointer HUD instead)
      if (spanDeg < 4.2) continue;

      c.save();
      c.translate(center, center);
      c.rotate(midAngle);

      const textRadius = rBezelInner * 0.88;
      const availableWidth = rBezelInner * 0.63;
      const fontSize = Math.max(9.5, Math.min(17, Math.floor(rBezelInner * 0.068 * Math.min(1, spanDeg / 18))));

      c.textAlign = 'right';
      c.textBaseline = 'middle';
      c.fillStyle = color.text;
      c.font = `700 ${fontSize}px "Plus Jakarta Sans", "Noto Sans Thai", sans-serif`;

      const maxChars = Math.max(5, Math.floor(availableWidth / (fontSize * 0.55)));
      const displayLabel = truncateGraphemes(slice.item.label, maxChars, true);

      if (spanDeg >= 12) {
        // Two-line or sub-badge layout: main label + exact P(i)% & weight
        c.fillText(displayLabel, textRadius, -fontSize * 0.36);
        const pctStr = `${(slice.probability * 100).toFixed(1)}% · W:${slice.baseWeight}`;
        c.font = `600 ${Math.max(8.5, Math.floor(fontSize * 0.66))}px "JetBrains Mono", monospace`;
        c.fillStyle = color.subText;
        c.fillText(pctStr, textRadius, fontSize * 0.55);
      } else {
        c.fillText(displayLabel, textRadius, 0);
      }

      c.restore();
    }

    // 4. Inner bezel ink ring
    c.beginPath();
    c.arc(center, center, rBezelInner, 0, Math.PI * 2);
    c.lineWidth = 3;
    c.strokeStyle = '#141413';
    c.stroke();

    // 5. Perimeter 3D Metallic/Brass Divider Pegs at each slice boundary
    if (n >= 2 && n <= 120) {
      for (let i = 0; i < n; i++) {
        const pegAngle = TOP_OFFSET + active[i].startAngle;
        const px = center + Math.cos(pegAngle) * rBezelInner;
        const py = center + Math.sin(pegAngle) * rBezelInner;
        const pegR = Math.max(2.5, Math.min(5.5, rOuter * 0.022));

        // Peg shadow
        c.beginPath();
        c.arc(px + 1, py + 1.5, pegR, 0, Math.PI * 2);
        c.fillStyle = 'rgba(20, 20, 19, 0.55)';
        c.fill();

        // Peg body (warm brass / cream cap with ink rim)
        c.beginPath();
        c.arc(px, py, pegR, 0, Math.PI * 2);
        c.fillStyle = '#F59E0B';
        c.fill();
        c.lineWidth = 1.8;
        c.strokeStyle = '#141413';
        c.stroke();

        // Specular dot
        c.beginPath();
        c.arc(px - pegR * 0.28, py - pegR * 0.28, pegR * 0.3, 0, Math.PI * 2);
        c.fillStyle = '#FEF3C7';
        c.fill();
      }
    }

    // 6. Inner hub shadow ring
    c.beginPath();
    c.arc(center, center, rHub * 1.12, 0, Math.PI * 2);
    c.fillStyle = '#141413';
    c.fill();

    c.restore();
    cacheDirty = false;
  }

  /**
   * Renders a single frame in O(1) time by blitting the cached wheel bitmap
   * and drawing the 3D extruded cylindrical shadow, center SPIN hub, and spring-damped pointer.
   *
   * @param {number} rotationRad - Current wheel rotation angle in radians
   * @param {number} pointerDeflectionRad - Spring deflection angle of top clapper in radians
   * @param {boolean} isSpinning
   */
  function renderFrame(rotationRad = 0, pointerDeflectionRad = 0, isSpinning = false) {
    const cx = width / 2;
    const cy = height / 2 + 4;
    const wheelRadius = Math.min(width, height) * 0.435;

    if (cacheDirty) {
      rebuildWheelCache(wheelRadius);
    }

    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    // 1. 3D Extruded Cylindrical Block Shadow (Neo-Brutalist Swiss Architectural Depth)
    const extrudeDepth = Math.max(8, wheelRadius * 0.048);
    ctx.beginPath();
    ctx.arc(cx + extrudeDepth * 0.75, cy + extrudeDepth, wheelRadius, 0, Math.PI * 2);
    ctx.fillStyle = '#141413';
    ctx.fill();

    // Subtle secondary ambient ground shadow
    ctx.beginPath();
    ctx.arc(cx + extrudeDepth * 0.9, cy + extrudeDepth * 1.35, wheelRadius * 0.99, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(20, 20, 19, 0.12)';
    ctx.fill();

    // 2. Blit Rotating Cached Wheel Disc (O(1) GPU Texture Draw)
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

    // 3. Stationary Top-Left 3D Lighting Sheen (gives tactile cylindrical depth while spinning)
    const sheenGrad = ctx.createLinearGradient(cx - wheelRadius, cy - wheelRadius, cx + wheelRadius, cy + wheelRadius);
    sheenGrad.addColorStop(0, 'rgba(255, 255, 255, 0.14)');
    sheenGrad.addColorStop(0.45, 'rgba(255, 255, 255, 0.0)');
    sheenGrad.addColorStop(1, 'rgba(0, 0, 0, 0.12)');
    ctx.beginPath();
    ctx.arc(cx, cy, wheelRadius * 0.92, 0, Math.PI * 2);
    ctx.fillStyle = sheenGrad;
    ctx.fill();

    // 4. Stationary 3D Tactile Center Hub ("SPIN" / "SKIP")
    const rHub = wheelRadius * 0.175;
    // Hub 3D offset shadow
    ctx.beginPath();
    ctx.arc(cx + 3, cy + 4, rHub, 0, Math.PI * 2);
    ctx.fillStyle = '#141413';
    ctx.fill();

    // Hub main body
    ctx.beginPath();
    ctx.arc(cx, cy, rHub, 0, Math.PI * 2);
    ctx.fillStyle = isSpinning ? '#EAB308' : '#FAF7F2';
    ctx.fill();
    ctx.lineWidth = 3.5;
    ctx.strokeStyle = '#141413';
    ctx.stroke();

    // Inner tactile ring
    ctx.beginPath();
    ctx.arc(cx, cy, rHub * 0.82, 0, Math.PI * 2);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = '#141413';
    ctx.stroke();

    ctx.fillStyle = '#141413';
    ctx.font = `800 ${Math.max(11, Math.floor(rHub * 0.36))}px "Plus Jakarta Sans", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(isSpinning ? 'SKIP' : 'SPIN', cx, cy + 1);

    // 5. Top 12 o'clock Mechanical Spring Clapper Pointer
    const pointerPivotX = cx;
    const pointerPivotY = cy - wheelRadius - wheelRadius * 0.035;
    const pointerLength = wheelRadius * 0.19;
    const pointerWidth = wheelRadius * 0.095;

    ctx.save();
    ctx.translate(pointerPivotX, pointerPivotY);
    ctx.rotate(pointerDeflectionRad);

    // Pointer hard drop shadow
    ctx.beginPath();
    ctx.moveTo(3, pointerLength + 4);
    ctx.lineTo(-pointerWidth + 3, -pointerWidth * 0.3 + 4);
    ctx.lineTo(pointerWidth + 3, -pointerWidth * 0.3 + 4);
    ctx.closePath();
    ctx.fillStyle = '#141413';
    ctx.fill();

    // Pointer body (Bauhaus Vermilion Red + Bold Ink Border)
    ctx.beginPath();
    ctx.moveTo(0, pointerLength);
    ctx.lineTo(-pointerWidth, -pointerWidth * 0.3);
    ctx.lineTo(pointerWidth, -pointerWidth * 0.3);
    ctx.closePath();
    ctx.fillStyle = '#D9381E';
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#141413';
    ctx.stroke();

    // Pivot housing cap
    ctx.beginPath();
    ctx.arc(0, -pointerWidth * 0.1, pointerWidth * 0.62, 0, Math.PI * 2);
    ctx.fillStyle = '#141413';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(0, -pointerWidth * 0.1, pointerWidth * 0.28, 0, Math.PI * 2);
    ctx.fillStyle = '#FAF7F2';
    ctx.fill();

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
