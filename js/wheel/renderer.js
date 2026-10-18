/**
 * Luxury Premium Wheel Renderer — Clean Multi-Line Typography Edition
 * Features:
 * - Zero text outline/stroke/gloss effects for razor-sharp Thai & English legibility
 * - Automatic multi-line text wrapping (ขึ้นบรรทัดใหม่อัตโนมัติ) inside each wheel slice
 * - Cycle-Graph (C_N) high-contrast palette & 6 o'clock Gravity (g ↓) badge
 */

import { splitGraphemes, truncateGraphemes } from '../state/serializer.js';

const wordSegmenter =
  typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function'
    ? new Intl.Segmenter('th', { granularity: 'word' })
    : null;

/**
 * High-contrast, clean solid slice colors with pure flat text (no blurry strokes or gloss).
 */
export const SWISS_PALETTE = [
  { fill: '#1E293B', text: '#FFFFFF', subText: '#FDE68A', name: 'Obsidian Navy' },
  { fill: '#FEF3C7', text: '#0F172A', subText: '#78350F', name: 'Champagne Cream' },
  { fill: '#065F46', text: '#FFFFFF', subText: '#A7F3D0', name: 'Emerald Velvet' },
  { fill: '#F8FAFC', text: '#0F172A', subText: '#334155', name: 'Platinum White' },
  { fill: '#991B1B', text: '#FFFFFF', subText: '#FECACA', name: 'Royal Crimson' },
  { fill: '#E0E7FF', text: '#0F172A', subText: '#1E3A8A', name: 'Soft Sapphire' },
  { fill: '#312E81', text: '#FFFFFF', subText: '#C7D2FE', name: 'Deep Indigo' },
  { fill: '#FDE68A', text: '#0F172A', subText: '#78350F', name: 'Warm Gold' }
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

/**
 * Tokenizes Thai/English text into wrap-friendly word or grapheme chunks.
 * @param {string} text
 * @returns {string[]}
 */
function tokenizeForWrap(text) {
  const clean = String(text ?? '').trim();
  if (!clean) return [];
  if (wordSegmenter) {
    const tokens = [];
    for (const seg of wordSegmenter.segment(clean)) {
      tokens.push(seg.segment);
    }
    return tokens;
  }
  return splitGraphemes(clean);
}

/**
 * Wraps text into multiple lines that fit within `maxWidthPx` using `ctx.measureText`.
 * Supports Thai word boundaries and falls back to grapheme wrapping for long single words.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {string} text
 * @param {number} maxWidthPx
 * @param {number} maxLines
 * @returns {string[]}
 */
function wrapSliceText(ctx, text, maxWidthPx, maxLines = 2) {
  const clean = String(text ?? '').trim();
  if (!clean) return [''];
  if (maxLines <= 1 || ctx.measureText(clean).width <= maxWidthPx) {
    if (ctx.measureText(clean).width <= maxWidthPx) return [clean];
    const approxChars = Math.max(4, Math.floor((maxWidthPx / ctx.measureText(clean).width) * splitGraphemes(clean).length));
    return [truncateGraphemes(clean, approxChars, true)];
  }

  const tokens = tokenizeForWrap(clean);
  const lines = [];
  let currentLine = '';

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const candidate = currentLine + token;

    if (ctx.measureText(candidate).width <= maxWidthPx) {
      currentLine = candidate;
    } else if (!currentLine) {
      // Single token is wider than maxWidthPx -> split token by graphemes
      const graphemes = splitGraphemes(token);
      let chunk = '';
      for (const g of graphemes) {
        if (ctx.measureText(chunk + g).width <= maxWidthPx) {
          chunk += g;
        } else {
          if (lines.length < maxLines - 1) {
            lines.push(chunk);
            chunk = g;
          } else {
            chunk += g;
          }
        }
      }
      currentLine = chunk;
    } else {
      lines.push(currentLine.trim());
      currentLine = token.trimStart();
      if (lines.length >= maxLines - 1) {
        // Put remaining tokens into the final line and truncate cleanly if needed
        const rest = currentLine + tokens.slice(i + 1).join('');
        if (ctx.measureText(rest).width <= maxWidthPx) {
          currentLine = rest;
        } else {
          const gRest = splitGraphemes(rest);
          let fit = '';
          for (const g of gRest) {
            if (ctx.measureText(`${fit + g}…`).width <= maxWidthPx) {
              fit += g;
            } else {
              break;
            }
          }
          currentLine = `${fit.trimEnd()}…`;
        }
        break;
      }
    }
  }

  if (currentLine) {
    lines.push(currentLine.trim());
  }

  return lines.slice(0, maxLines);
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
   * Renders the static wheel face onto the offscreen canvas.
   * Uses pure flat typography (no stroke/glow effects) and supports multi-line text wrapping.
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
    const rGoldRing = rOuter * 0.958;
    const rInner = rOuter * 0.938;
    const active = currentDistribution.activeItems;
    const n = active.length;

    // 1. Heavy Outer Flywheel Rim
    c.beginPath();
    c.arc(center, center, rOuter, 0, Math.PI * 2);
    c.fillStyle = '#0F172A';
    c.fill();

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
      c.font = '700 17px "Noto Sans Thai", "Plus Jakarta Sans", sans-serif';
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

      c.lineWidth = n > 50 ? 1 : 2;
      c.strokeStyle = '#D97706';
      c.stroke();
    }

    // 3. Draw Clean, Effect-Free Multi-Line Typography inside each slice
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

      const textOuterX = rInner * 0.89;
      const maxTextWidth = rInner * 0.54;

      // Determine how many lines this slice angle can comfortably hold at mid-radius (0.62 * rInner)
      const chordHeightAtMid = 2 * (rInner * 0.58) * Math.sin(Math.min(Math.PI / 2, slice.angleSpan / 2));
      const maxAllowedLines = spanDeg >= 24 ? 3 : spanDeg >= 13 ? 2 : 1;

      let fontSize = Math.max(
        13,
        Math.min(21, Math.floor(rInner * 0.078 * Math.min(1.05, spanDeg / 18)))
      );

      c.font = `700 ${fontSize}px "Noto Sans Thai", "Plus Jakarta Sans", sans-serif`;
      let lines = wrapSliceText(c, slice.item.label, maxTextWidth, maxAllowedLines);

      // If wrapped into multiple lines, ensure total block height fits comfortably inside the slice chord
      const lineSpacing = fontSize * 1.22;
      const showProbLine = spanDeg >= 14;
      const totalLinesCount = lines.length + (showProbLine ? 1 : 0);
      if (totalLinesCount * lineSpacing > chordHeightAtMid * 0.86 && fontSize > 12) {
        fontSize = Math.max(12, Math.floor((chordHeightAtMid * 0.84) / (totalLinesCount * 1.22)));
        c.font = `700 ${fontSize}px "Noto Sans Thai", "Plus Jakarta Sans", sans-serif`;
        lines = wrapSliceText(c, slice.item.label, maxTextWidth, maxAllowedLines);
      }

      const finalLineHeight = fontSize * 1.22;
      const subFontSize = Math.max(10.5, Math.floor(fontSize * 0.68));
      const totalBlockHeight =
        lines.length * finalLineHeight + (showProbLine ? subFontSize * 1.15 : 0);

      let startY = -totalBlockHeight / 2 + finalLineHeight / 2;

      c.textAlign = 'right';
      c.textBaseline = 'middle';
      c.fillStyle = isWinner ? '#0F172A' : color.text;

      for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
        c.fillText(lines[lineIdx], textOuterX, startY + lineIdx * finalLineHeight);
      }

      if (showProbLine) {
        const pctStr = `${(slice.probability * 100).toFixed(1)}%`;
        c.font = `600 ${subFontSize}px "JetBrains Mono", monospace`;
        c.fillStyle = isWinner ? '#1E293B' : color.subText;
        const probY = startY + lines.length * finalLineHeight - (finalLineHeight - subFontSize) * 0.25;
        c.fillText(pctStr, textOuterX, probY);
      }

      c.restore();
    }

    // 4. Perimeter Brass Divider Pegs
    if (n >= 2 && n <= 100) {
      for (let i = 0; i < n; i++) {
        const pegAngle = TOP_OFFSET + active[i].startAngle;
        const px = center + Math.cos(pegAngle) * rInner;
        const py = center + Math.sin(pegAngle) * rInner;
        const pegR = Math.max(3, Math.min(5.2, rOuter * 0.019));

        c.beginPath();
        c.arc(px, py, pegR, 0, Math.PI * 2);
        c.fillStyle = '#FDE68A';
        c.fill();
        c.lineWidth = 1.6;
        c.strokeStyle = '#78350F';
        c.stroke();
      }
    }

    c.restore();
    cacheDirty = false;
  }

  /**
   * Renders a single frame in O(1) time.
   * No glossy overlay over the slices so the multi-line text stays 100% sharp.
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

    // 1. Clean Ground Shadow
    ctx.beginPath();
    ctx.arc(cx, cy + 7, wheelRadius * 1.005, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(2, 6, 23, 0.45)';
    ctx.fill();

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

    // 3. 6 o'clock Downward Gravity (g ↓) Counterweight Badge
    const gBadgeY = cy + wheelRadius + 13;
    ctx.save();
    ctx.fillStyle = '#1E293B';
    ctx.strokeStyle = '#F59E0B';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(cx - 44, gBadgeY - 10, 88, 20, 10);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#FDE68A';
    ctx.font = '700 11px "JetBrains Mono", "Noto Sans Thai", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('↓ แรงโน้มถ่วง g', cx, gBadgeY);
    ctx.restore();

    // 4. Prominent Center "SPIN" Medallion
    const rHubOuter = wheelRadius * 0.235;
    const rHubInner = wheelRadius * 0.202;

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, rHubOuter, 0, Math.PI * 2);
    ctx.fillStyle = '#F59E0B';
    ctx.fill();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = '#FEF3C7';
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(cx, cy, rHubInner, 0, Math.PI * 2);
    ctx.fillStyle = isSpinning ? '#F59E0B' : '#0F172A';
    ctx.fill();

    const mainFont = Math.max(15, Math.floor(rHubInner * 0.42));
    const subFont = Math.max(10, Math.floor(rHubInner * 0.22));
    ctx.fillStyle = isSpinning ? '#090D16' : '#FFFFFF';
    ctx.font = `800 ${mainFont}px "Plus Jakarta Sans", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(isSpinning ? 'SKIP' : 'SPIN', cx, cy - subFont * 0.52);

    ctx.font = `600 ${subFont}px "Noto Sans Thai", sans-serif`;
    ctx.fillStyle = isSpinning ? '#1E293B' : '#FDE68A';
    ctx.fillText(isSpinning ? 'ข้ามไปดูผล' : 'กดหรือลากหมุน', cx, cy + mainFont * 0.56);
    ctx.restore();

    // 5. Top 12 o'clock Clapper Pointer
    const pointerPivotX = cx;
    const pointerPivotY = cy - wheelRadius - 5;
    const pointerLength = wheelRadius * 0.16;
    const pointerWidth = wheelRadius * 0.076;

    ctx.save();
    ctx.translate(pointerPivotX, pointerPivotY);
    ctx.rotate(pointerDeflectionRad);

    ctx.beginPath();
    ctx.moveTo(0, pointerLength);
    ctx.lineTo(-pointerWidth, -5);
    ctx.lineTo(pointerWidth, -5);
    ctx.closePath();
    ctx.fillStyle = '#E11D48';
    ctx.fill();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = '#FEF3C7';
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(0, -3, pointerWidth * 0.55, 0, Math.PI * 2);
    ctx.fillStyle = '#F59E0B';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#0F172A';
    ctx.stroke();

    ctx.restore();

    // 6. Celebratory Confetti Particles
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
