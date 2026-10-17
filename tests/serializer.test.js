import test from 'node:test';
import assert from 'node:assert/strict';
import {
  splitGraphemes,
  truncateGraphemes,
  sanitizePreset,
  encodePresetToUrlPayload,
  decodePresetFromUrlPayload
} from '../js/state/serializer.js';

test('splitGraphemes and truncateGraphemes preserve Thai combining characters and ZWJ emojis', () => {
  const thaiWord = 'ผู้ใหญ่ใจดี'; // 'ผู้' is 1 grapheme cluster (ผ + ู + ้), 'ใ' + 'ห' + 'ญ่' + 'ใ' + 'จ' + 'ดี'
  const graphemes = splitGraphemes(thaiWord);
  assert.equal(graphemes[0], 'ผู้');

  const truncated = truncateGraphemes(thaiWord, 3, true);
  // First 2 graphemes + ellipsis -> 'ผู้ใ…' without orphan tone marks
  assert.equal(truncated, 'ผู้ใ…');

  const emojiStr = '👨‍👩‍👧‍👦🎉🔥';
  const emojiClusters = splitGraphemes(emojiStr);
  assert.equal(emojiClusters.length, 3);
  assert.equal(emojiClusters[0], '👨‍👩‍👧‍👦');
});

test('sanitizePreset rejects prototype pollution payloads and clamps bounds', () => {
  const maliciousJson = JSON.parse('{"name":"Hack","__proto__":{"polluted":true},"items":["A"]}');
  assert.throws(() => sanitizePreset(maliciousJson), /Security violation/);

  const nestedMalicious = {
    name: 'Nested',
    items: [{ label: 'Ok', constructor: { prototype: {} } }]
  };
  assert.throws(() => sanitizePreset(nestedMalicious), /Security violation/);

  const valid = sanitizePreset({
    name: '   ชุดทดสอบ   ',
    mode: 'balance',
    eliminateWinner: 1,
    items: [
      { label: 'ตัวเลือก 1', weight: 999999, wins: -10 },
      { label: 'ตัวเลือก 2', weight: -5, wins: 3.9 }
    ]
  });

  assert.equal(valid.name, 'ชุดทดสอบ');
  assert.equal(valid.mode, 'balance');
  assert.equal(valid.eliminateWinner, true);
  assert.equal(valid.items[0].weight, 10000); // clamped to MAX_WEIGHT
  assert.equal(valid.items[0].wins, 0); // negative wins reset to 0
  assert.equal(valid.items[1].weight, 1); // negative weight defaults to 1
  assert.equal(valid.items[1].wins, 3);
});

test('URL payload round-trip preserves Thai text, emojis, weights, and probability mode', () => {
  const original = {
    name: 'มื้อเที่ยงวันศุกร์ 🍣🔥',
    mode: 'momentum',
    eliminateWinner: true,
    items: [
      { id: '1', label: 'ซูชิโอมากาเสะ 🍣', weight: 1.5, wins: 2, eliminated: false },
      { id: '2', label: 'ส้มตำปูปลาร้า 🌶️', weight: 3, wins: 0, eliminated: true }
    ]
  };

  const encoded = encodePresetToUrlPayload(original);
  assert.ok(encoded.length > 0 && !encoded.includes('+') && !encoded.includes('/'));

  const decoded = decodePresetFromUrlPayload(encoded);
  assert.equal(decoded.name, original.name);
  assert.equal(decoded.mode, 'momentum');
  assert.equal(decoded.eliminateWinner, true);
  assert.equal(decoded.items.length, 2);
  assert.equal(decoded.items[0].label, 'ซูชิโอมากาเสะ 🍣');
  assert.equal(decoded.items[0].weight, 1.5);
  assert.equal(decoded.items[0].wins, 2);
  assert.equal(decoded.items[1].eliminated, true);
});
