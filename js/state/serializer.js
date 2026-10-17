/**
 * Secure Preset Serializer, Grapheme Segmenter & URL Base64URL Codec
 * Enforces strict schema validation, XSS/control-char stripping, and prototype pollution guards.
 */

export const MAX_ITEMS = 500;
export const MAX_LABEL_GRAPHEMES = 120;
export const MAX_PRESET_NAME_GRAPHEMES = 60;
export const MIN_WEIGHT = 0.01;
export const MAX_WEIGHT = 10000;

const sharedSegmenter =
  typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function'
    ? new Intl.Segmenter('th', { granularity: 'grapheme' })
    : null;

/**
 * Splits a string into user-perceived characters (grapheme clusters),
 * preserving Thai combining marks (สระลอย/วรรณยุกต์) and ZWJ emojis.
 *
 * @param {string} text
 * @returns {string[]}
 */
export function splitGraphemes(text) {
  const str = String(text ?? '');
  if (!str) return [];
  if (sharedSegmenter) {
    const out = [];
    for (const seg of sharedSegmenter.segment(str)) {
      out.push(seg.segment);
    }
    return out;
  }
  return Array.from(str);
}

/**
 * Truncates text safely on grapheme cluster boundaries.
 *
 * @param {string} text
 * @param {number} maxGraphemes
 * @param {boolean} [addEllipsis=false]
 * @returns {string}
 */
export function truncateGraphemes(text, maxGraphemes, addEllipsis = false) {
  const clean = stripControlChars(text).trim();
  const graphemes = splitGraphemes(clean);
  if (graphemes.length <= maxGraphemes) {
    return clean;
  }
  const sliced = graphemes.slice(0, Math.max(1, addEllipsis ? maxGraphemes - 1 : maxGraphemes)).join('');
  return addEllipsis ? `${sliced}…` : sliced;
}

/**
 * Removes ASCII/Unicode control characters (except standard spaces).
 * @param {string} input
 * @returns {string}
 */
export function stripControlChars(input) {
  return String(input ?? '').replace(/[\u0000-\u001F\u007F-\u009F]/g, ' ');
}

/**
 * Generates a cryptographically random ID string.
 * @returns {string}
 */
export function generateSafeId() {
  if (typeof globalThis !== 'undefined' && globalThis.crypto) {
    if (typeof globalThis.crypto.randomUUID === 'function') {
      return globalThis.crypto.randomUUID();
    }
    const bytes = new Uint8Array(8);
    globalThis.crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  }
  return `id_${Date.now()}`;
}

/**
 * Checks whether a raw parsed JSON value contains forbidden prototype pollution keys.
 * @param {unknown} value
 * @returns {boolean}
 */
export function hasPrototypePollutionKey(value) {
  if (!value || typeof value !== 'object') return false;
  if (
    Object.prototype.hasOwnProperty.call(value, '__proto__') ||
    Object.prototype.hasOwnProperty.call(value, 'constructor') ||
    Object.prototype.hasOwnProperty.call(value, 'prototype')
  ) {
    return true;
  }
  if (Array.isArray(value)) {
    return value.some(hasPrototypePollutionKey);
  }
  for (const key of Object.keys(value)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
      return true;
    }
    if (hasPrototypePollutionKey(value[key])) {
      return true;
    }
  }
  return false;
}

/**
 * Validates and normalizes a single choice item.
 * @param {unknown} raw
 * @param {number} [fallbackIndex=0]
 * @returns {{id: string, label: string, weight: number, wins: number, eliminated: boolean} | null}
 */
export function sanitizeItem(raw, fallbackIndex = 0) {
  if (typeof raw === 'string') {
    const label = truncateGraphemes(raw, MAX_LABEL_GRAPHEMES);
    if (!label) return null;
    return {
      id: generateSafeId(),
      label,
      weight: 1,
      wins: 0,
      eliminated: false
    };
  }

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }

  const label = truncateGraphemes(raw.label ?? raw.name ?? '', MAX_LABEL_GRAPHEMES);
  if (!label) return null;

  const rawWeight = Number(raw.weight);
  const weight =
    Number.isFinite(rawWeight) && rawWeight > 0
      ? Math.round(Math.min(Math.max(rawWeight, MIN_WEIGHT), MAX_WEIGHT) * 100) / 100
      : 1;

  const rawWins = Number(raw.wins);
  const wins =
    Number.isFinite(rawWins) && rawWins >= 0
      ? Math.min(Math.floor(rawWins), 1000000)
      : 0;

  const id =
    typeof raw.id === 'string' && raw.id.trim().length > 0 && raw.id.length <= 64
      ? stripControlChars(raw.id).trim()
      : `${generateSafeId()}_${fallbackIndex}`;

  return {
    id,
    label,
    weight,
    wins,
    eliminated: Boolean(raw.eliminated)
  };
}

/**
 * Validates and normalizes a full Preset object.
 * Rejects prototype pollution attempts and enforces item & character bounds.
 *
 * @param {unknown} rawPreset
 * @returns {{
 *   id: string,
 *   name: string,
 *   mode: 'independent'|'balance'|'momentum',
 *   eliminateWinner: boolean,
 *   items: Array<{id: string, label: string, weight: number, wins: number, eliminated: boolean}>
 * }}
 */
export function sanitizePreset(rawPreset) {
  if (!rawPreset || typeof rawPreset !== 'object' || Array.isArray(rawPreset)) {
    throw new Error('Invalid preset format: root must be a JSON object.');
  }
  if (hasPrototypePollutionKey(rawPreset)) {
    throw new Error('Security violation: forbidden prototype key detected.');
  }

  const name = truncateGraphemes(rawPreset.name || 'ชุดคำตอบของฉัน', MAX_PRESET_NAME_GRAPHEMES) || 'ชุดคำตอบของฉัน';
  const validModes = new Set(['independent', 'balance', 'momentum']);
  const mode = validModes.has(rawPreset.mode) ? rawPreset.mode : 'independent';
  const eliminateWinner = Boolean(rawPreset.eliminateWinner);

  const rawItems = Array.isArray(rawPreset.items) ? rawPreset.items.slice(0, MAX_ITEMS) : [];
  const seenIds = new Set();
  const items = [];

  for (let i = 0; i < rawItems.length; i++) {
    const clean = sanitizeItem(rawItems[i], i);
    if (!clean) continue;
    if (seenIds.has(clean.id)) {
      clean.id = `${generateSafeId()}_${i}`;
    }
    seenIds.add(clean.id);
    items.push(clean);
  }

  if (items.length === 0) {
    throw new Error('Preset must contain at least 1 valid item.');
  }

  const id =
    typeof rawPreset.id === 'string' && rawPreset.id.trim().length > 0 && rawPreset.id.length <= 64
      ? stripControlChars(rawPreset.id).trim()
      : generateSafeId();

  return {
    id,
    name,
    mode,
    eliminateWinner,
    items
  };
}

/**
 * Encodes a Preset into a compact, URL-safe Base64 string (#preset=...).
 * Preserves full UTF-8 (Thai, emojis, symbols).
 *
 * @param {object} preset
 * @returns {string}
 */
export function encodePresetToUrlPayload(preset) {
  const clean = sanitizePreset(preset);
  const compact = {
    n: clean.name,
    m: clean.mode,
    e: clean.eliminateWinner ? 1 : 0,
    i: clean.items.map((item) =>
      item.weight === 1 && item.wins === 0 && !item.eliminated
        ? item.label
        : [item.label, item.weight, item.wins || 0, item.eliminated ? 1 : 0]
    )
  };

  const json = JSON.stringify(compact);
  const bytes = new TextEncoder().encode(json);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  const base64 = btoa(binary);
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Decodes a compact URL-safe Base64 string back into a validated Preset object.
 *
 * @param {string} payload
 * @returns {ReturnType<typeof sanitizePreset>}
 */
export function decodePresetFromUrlPayload(payload) {
  if (typeof payload !== 'string' || payload.length === 0 || payload.length > 32768) {
    throw new Error('Invalid or oversized URL preset payload.');
  }

  const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }

  const json = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const parsed = JSON.parse(json);

  if (hasPrototypePollutionKey(parsed)) {
    throw new Error('Security violation: forbidden prototype key in URL payload.');
  }

  // Support both compact format {n, m, e, i} and full format
  if (parsed && typeof parsed === 'object' && Array.isArray(parsed.i)) {
    const expandedItems = parsed.i.slice(0, MAX_ITEMS).map((entry) => {
      if (typeof entry === 'string') {
        return { label: entry, weight: 1, wins: 0, eliminated: false };
      }
      if (Array.isArray(entry)) {
        return {
          label: entry[0],
          weight: entry[1] ?? 1,
          wins: entry[2] ?? 0,
          eliminated: Boolean(entry[3])
        };
      }
      return entry;
    });

    return sanitizePreset({
      name: parsed.n || 'Shared Preset',
      mode: parsed.m || 'independent',
      eliminateWinner: Boolean(parsed.e),
      items: expandedItems
    });
  }

  return sanitizePreset(parsed);
}
