/**
 * Luxury Premium Wheel Renderer with Large High-Contrast Typography,
 * 6 o'clock Gravity Counterweight (g ↓), and Celebratory Particle Rendering.
 */

import { truncateGraphemes } from '../state/serializer.js';

/**
 * Curated Executive Premium Palette:
 * Rich jewel & editorial tones paired with ultra-high-contrast text and subtle stroke halos.
 */
export const SWISS_PALETTE = [
  { fill: '#1E293B', text: '#FFFFFF', stroke: '#090D16', subText: '#FDE68A', name: 'Obsidian Navy' },
  { fill: '#FEF3C7', text: '#0F172A', stroke: '#FFFFFF', subText: '#92400E', name: 'Champagne Gold' },
  { fill: '#065F46', text: '#FFFFFF', stroke: '#022C22', subText: '#A7F3D0', name: 'Emerald Velvet' },
  { fill: '#F8FAFC', text: '#0F172A', stroke: '#FFFFFF', subText: '#334155', name: 'Platinum Ivory' },
  { fill: '#991B1B', text: '#FFFFFF', stroke: '#450A0A', subText: '#FECACA', name: 'Royal Crimson' },
  { fill: '#E0E7FF', text: '#0F172A', stroke: '#FFFFFF', subText: '#1E3A8A', name: 'Sapphire Mist' },
  { fill: '#312E81', text: '#FFFFFF', stroke: '#1E1B4B', subText: '#C7D2FE', name: 'Imperial Indigo' },
  { fill: '#FDE68A', text: '#0F172A', stroke: '#FFFFFF', subText: '#78350F', name: 'Warm Amber' }
];

/**
 * Assigns palette colors to N slices around a cycle graph C_N such that
 * slice[i] !== slice[i-1] AND slice[N-1] !== slice[0] for all N >= 2.
 *
 * @param {number} count
 * @returns {Array<{fill: string, text: string, stroke: string, subText: string}>}
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
  let width = 560;
  let height = 560;

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
    width = Math.max(260, Math.floor(newCssWidth));
    height = Math.max(260, Math.floor(newCssHeight));
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
   * Renders the static luxury wheel face onto the offscreen canvas.
   */
  function rebuildWheelCache(wheelRadius) {
    const size = Math.ceil(wheelRadius * 2.16 * dpr);
    ensureOffscreen(size);

    const c = cacheCtx;
    c.save();
    c.clearRect(0, 0, size, size);
    c.scale(dpr, dpr);

    const center = size / (2 * dpr);
    const rOuter = wheelRadius;
    const rGoldRing = rOuter * 0.955;
    const rInner = rOuter * 0.935;
    const active = currentDistribution.activeItems;
    const n = active.length;

    // 1. Luxury Brushed Obsidian & Champagne Gold Outer Bezel
    const bezelGrad = c.createLinearGradient(0, 0, size / dpr, size / dpr);
    bezelGrad.addColorStop(0, '#1E293B');
    bezelGrad.addColorStop(0.5, '#0F172A');
    bezelGrad.addColorStop(1, '#090D16');

    c.beginPath();
    c.arc(center, center, rOuter, 0, Math.PI * 2);
    c.fillStyle = bezelGrad;
    c.fill();

    // Champagne Gold metallic trim ring
    c.beginPath();
    c.arc(center, center, rGoldRing, 0, Math.PI * 2);
    c.lineWidth = 3;
    c.strokeStyle = '#F59E0B';
    c.stroke();

    if (n === 0) {
      c.beginPath();
      c.arc(center, center, rInner, 0, Math.PI * 2);
      c.fillStyle = '#111827';
      c.fill();

      c.fillStyle = '#F8FAFC';
      c.font = '700 17px "Plus Jakarta Sans", "Noto Sans Thai", sans-serif';
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText('พิมพ์คำตอบด้านขวาเพื่อเริ่มหมุน', center, center - rOuter * 0.42);
      c.restore();
      cacheDirty = false;
      return;
    }

    const palette = assignCycleSafeColors(n);
    const TOP_OFFSET = -Math.PI / 2;

    // 2. Draw proportional slices
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

      c.fillStyle = isWinner ? '#F59E0B' : color.fill;
      c.fill();

      // Gold metallic divider line
      c.lineWidth = n > 50 ? 1 : 2.2;
      c.strokeStyle = '#D97706';
      c.stroke();

      if (isWinner) {
        c.save();
        c.lineWidth = 4.5;
        c.strokeStyle = '#FFFFFF';
        c.stroke();
        c.restore();
      }
    }

    // 3. Draw LARGE, Bold, Crystal-Clear Typography on each slice
    for (let i = 0; i < n; i++) {
      const slice = active[i];
      const color = palette[i];
      const isWinner = highlightedWinnerId && slice.item.id === highlightedWinnerId;
      const midAngle = TOP_OFFSET + (slice.startAngle + slice.endAngle) / 2;
      const spanDeg = (slice.angleSpan * 180) / Math.PI;

      if (spanDeg < 4.2) continue;

      c.save();
      c.translate(center, center);
      c.rotate(midAngle);

      const textRadius = rInner * 0.895;
      const availableWidth = rInner * 0.58;
      // Significantly larger font for immediate readability
      const fontSize = Math.max(
        13,
        Math.min(24, Math.floor(rInner * 0.088 * Math.min(1.08, spanDeg / 18)))
      );

      c.textAlign = 'right';
      c.textBaseline = 'middle';
      c.font = `800 ${fontSize}px "Plus Jakarta Sans", "Noto Sans Thai", sans-serif`;

      const maxChars = Math.max(6, Math.floor(availableWidth / (fontSize * 0.54)));
      const displayLabel = truncateGraphemes(slice.item.label, maxChars, true);

      const textColor = isWinner ? '#0F172A' : color.text;
      const strokeColor = isWinner ? '#FEF3C7' : color.stroke;

      if (spanDeg >= 12) {
        const yLabel = -fontSize * 0.34;
        c.lineWidth = 3.2;
        c.lineJoin = 'round';
        c.strokeStyle = strokeColor;
        c.strokeText(displayLabel, textRadius, yLabel);
        c.fillStyle = textColor;
        c.fillText(displayLabel, textRadius, yLabel);

        const pctStr = `${(slice.probability * 100).toFixed(1)}%`;
        const subFontSize = Math.max(11, Math.floor(fontSize * 0.65));
        c.font = `700 ${subFontSize}px "JetBrains Mono", monospace`;
        c.fillStyle = isWinner ? '#1E293B' : color.subText;
        c.fillText(pctStr, textRadius, fontSize * 0.58);
      } else {
        c.lineWidth = 2.8;
        c.lineJoin = 'round';
        c.strokeStyle = strokeColor;
        c.strokeText(displayLabel, textRadius, 0);
        c.fillStyle = textColor;
        c.fillText(displayLabel, textRadius, 0);
      }

      c.restore();
    }

    // 4. 3D Gold Divider Pegs around the circumference
    if (n >= 2 && n <= 100) {
      for (let i = 0; i < n; i++) {
        const pegAngle = TOP_OFFSET + active[i].startAngle;
        const px = center + Math.cos(pegAngle) * rInner;
        const py = center + Math.sin(pegAngle) * rInner;
        const pegR = Math.max(3, Math.min(5.5, rOuter * 0.02));

        c.beginPath();
        c.arc(px + 1, py + 1.5, pegR, 0, Math.PI * 2);
        c.fillStyle = 'rgba(0, 0, 0, 0.45)';
        c.fill();

        c.beginPath();
        c.arc(px, py, pegR, 0, Math.PI * 2);
        c.fillStyle = '#FDE68A';
        c.fill();
        c.lineWidth = 1.8;
        c.strokeStyle = '#92400E';
        c.stroke();
      }
    }

    c.restore();
    cacheDirty = false;
  }

  /**
   * Renders a single frame in O(1) time, including:
   * - Premium ambient glow & shadow
   * - Rotating cached wheel disc
   * - 6 o'clock Gravity (g ↓) Plumb-Bob indicator
   * - Prominent Hero Center SPIN medallion
   * - 12 o'clock Jeweled Gold Clapper Pointer
   * - Celebratory confetti particles
   */
  function renderFrame(rotationRad = 0, pointerDeflectionRad = 0, isSpinning = false, particles = []) {
    const cx = width / 2;
    const cy = height / 2;
    const wheelRadius = Math.min(width, height) * 0.445;

    if (cacheDirty) {
      rebuildWheelCache(wheelRadius);
    }

    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    // 1. Luxury Deep Elevation Shadow + Golden Rim Glow
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy + 8, wheelRadius * 1.01, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(2, 6, 23, 0.45)';
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

    // 3. Stationary Specular Lighting Gloss over the wheel
    const gloss = ctx.createRadialGradient(
      cx - wheelRadius * 0.3,
      cy - wheelRadius * 0.35,
      wheelRadius * 0.05,
      cx,
      cy,
      wheelRadius
    );
    gloss.addColorStop(0, 'rgba(255, 255, 255, 0.12)');
    gloss.addColorStop(0.6, 'rgba(255, 255, 255, 0.0)');
    gloss.addColorStop(1, 'rgba(0, 0, 0, 0.18)');
    ctx.beginPath();
    ctx.arc(cx, cy, wheelRadius * 0.935, 0, Math.PI * 2);
    ctx.fillStyle = gloss;
    ctx.fill();

    // 4. 6 o'clock Downward Gravity (g ↓) Counterweight Badge at Bottom Rim
    const gBadgeY = cy + wheelRadius + 13;
    ctx.save();
    ctx.fillStyle = '#1E293B';
    ctx.strokeStyle = '#F59E0B';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(cx - 42, gBadgeY - 10, 84, 20, 10);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#FDE68A';
    ctx.font = '700 11px "JetBrains Mono", "Noto Sans Thai", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('↓ แรงโน้มถ่วง g', cx, gBadgeY);
    ctx.restore();

    // 5. Prominent Hero Center "SPIN" Medallion (Brushed Gold & Obsidian)
    const rHubOuter = wheelRadius * 0.245;
    const rHubInner = wheelRadius * 0.21;

    // Gold outer bezel ring with drop shadow
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy + 3, rHubOuter, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
    ctx.fill();

    const goldGrad = ctx.createLinearGradient(cx - rHubOuter, cy - rHubOuter, cx + rHubOuter, cy + rHubOuter);
    goldGrad.addColorStop(0, '#FDE68A');
    goldGrad.addColorStop(0.5, '#F59E0B');
    goldGrad.addColorStop(1, '#B45309');

    ctx.beginPath();
    ctx.arc(cx, cy, rHubOuter, 0, Math.PI * 2);
    ctx.fillStyle = goldGrad;
    ctx.fill();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = '#FEF3C7';
    ctx.stroke();

    // Inner medallion core
    const coreGrad = ctx.createRadialGradient(cx, cy - rHubInner * 0.3, 2, cx, cy, rHubInner);
    if (isSpinning) {
      coreGrad.addColorStop(0, '#F59E0B');
      coreGrad.addColorStop(1, '#B45309');
    } else {
      coreGrad.addColorStop(0, '#1E293B');
      coreGrad.addColorStop(1, '#090D16');
    }

    ctx.beginPath();
    ctx.arc(cx, cy, rHubInner, 0, Math.PI * 2);
    ctx.fillStyle = coreGrad;
    ctx.fill();

    const mainFont = Math.max(15, Math.floor(rHubInner * 0.42));
    const subFont = Math.max(10, Math.floor(rHubInner * 0.22));
    ctx.fillStyle = isSpinning ? '#090D16' : '#FEF3C7';
    ctx.font = `800 ${mainFont}px "Plus Jakarta Sans", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(isSpinning ? 'SKIP' : 'SPIN', cx, cy - subFont * 0.55);

    ctx.font = `600 ${subFont}px "Noto Sans Thai", sans-serif`;
    ctx.fillStyle = isSpinning ? '#1E293B' : '#F59E0B';
    ctx.fillText(isSpinning ? 'ข้ามไปดูผล' : 'กดหรือลากหมุน', cx, cy + mainFont * 0.58);
    ctx.restore();

    // 6. Top 12 o'clock Jeweled Gold & Crimson Clapper Pointer
    const pointerPivotX = cx;
    const pointerPivotY = cy - wheelRadius - 5;
    const pointerLength = wheelRadius * 0.165;
    const pointerWidth = wheelRadius * 0.08;

    ctx.save();
    ctx.translate(pointerPivotX, pointerPivotY);
    ctx.rotate(pointerDeflectionRad);

    // Pointer shadow
    ctx.beginPath();
    ctx.moveTo(2, pointerLength + 4);
    ctx.lineTo(-pointerWidth + 2, -4);
    ctx.lineTo(pointerWidth + 2, -4);
    ctx.closePath();
    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.fill();

    // Pointer blade
    ctx.beginPath();
    ctx.moveTo(0, pointerLength);
    ctx.lineTo(-pointerWidth, -5);
    ctx.lineTo(pointerWidth, -5);
    ctx.closePath();
    ctx.fillStyle = '#E11D48';
    ctx.fill();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = '#FDE68A';
    ctx.stroke();

    // Gold pivot cap
    ctx.beginPath();
    ctx.arc(0, -3, pointerWidth * 0.58, 0, Math.PI * 2);
    ctx.fillStyle = '#F59E0B';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#0F172A';
    ctx.stroke();

    ctx.restore();

    // 7. Celebratory Confetti Particles (when winner is announced)
    if (Array.isArray(particles) && particles.length > 0) {
      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        ctx.save();
        ctx.globalAlpha = Math.max(0, p.alpha);
        ctx.translate(cx + p.x, cy + p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.65);
        ctx.restore();
      }
    }

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
