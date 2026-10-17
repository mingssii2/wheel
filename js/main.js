/**
 * Main Application Entrypoint — FAIR WHEEL (Luxury Premium + Real Gravity Physics Edition)
 * Features:
 * - Interactive Drag-to-Spin with angular velocity tracking
 * - Real Downward Gravity (g at 6 o'clock) Rollback when dragged/flicked below threshold velocity
 * - Effortless 1-by-1 Choice Entry at the top, Rules in the middle, Preset Save at the bottom
 */

import {
  computeDistribution,
  sampleWinnerFromDistribution,
  computeTargetRotation
} from './math/csprng.js';
import { runFairnessAudit } from './math/chi-square.js';
import {
  encodePresetToUrlPayload,
  decodePresetFromUrlPayload,
  sanitizePreset
} from './state/serializer.js';
import { createStore, MODE_DESCRIPTIONS } from './state/store.js';
import { createSoundEngine } from './audio/sound-engine.js';
import {
  createWheelRenderer,
  assignCycleSafeColors,
  getSliceAtPointer
} from './wheel/renderer.js';
import { createWheelAnimator } from './wheel/animator.js';

const store = createStore();
const sound = createSoundEngine();

const SPIN_SPEED_CONFIG = {
  fast: { duration: 1800, minSpins: 4, maxSpins: 5 },
  normal: { duration: 3800, minSpins: 6, maxSpins: 8 },
  slow: { duration: 6500, minSpins: 9, maxSpins: 12 }
};

// Minimum angular velocity (rad/s) required when flicking the wheel to trigger a full spin.
// Below this threshold, downward gravity (g) pulls the wheel back to equilibrium!
const FLICK_VELOCITY_THRESHOLD = 2.6;

let selectedSpeedKey = 'normal';

// DOM Elements
const srAnnouncement = document.getElementById('srAnnouncement');
const toastBanner = document.getElementById('toastBanner');
const btnSoundToggle = document.getElementById('btnSoundToggle');
const soundIcon = document.getElementById('soundIcon');
const soundLabel = document.getElementById('soundLabel');
const btnShareUrl = document.getElementById('btnShareUrl');

const hudCurrentLabel = document.getElementById('hudCurrentLabel');
const hudCurrentProb = document.getElementById('hudCurrentProb');
const hudCurrentWeight = document.getElementById('hudCurrentWeight');
const physicsHintText = document.getElementById('physicsHintText');

const wheelViewport = document.getElementById('wheelViewport');
const wheelCanvas = document.getElementById('wheelCanvas');
const btnPrimarySpin = document.getElementById('btnPrimarySpin');
const btnResetStats = document.getElementById('btnResetStats');
const speedButtons = document.querySelectorAll('.speed-pill');

const winnerBanner = document.getElementById('winnerBanner');
const winnerNameText = document.getElementById('winnerNameText');
const winnerStatsText = document.getElementById('winnerStatsText');
const btnCloseWinner = document.getElementById('btnCloseWinner');

const storageStatusTag = document.getElementById('storageStatusTag');
const presetSelect = document.getElementById('presetSelect');
const btnNewPreset = document.getElementById('btnNewPreset');
const btnDeletePreset = document.getElementById('btnDeletePreset');
const presetNameForm = document.getElementById('presetNameForm');
const inputPresetName = document.getElementById('inputPresetName');
const btnExportJson = document.getElementById('btnExportJson');
const inputImportJson = document.getElementById('inputImportJson');

const btnModeIndependent = document.getElementById('btnModeIndependent');
const btnSubModeBalance = document.getElementById('btnSubModeBalance');
const btnSubModeMomentum = document.getElementById('btnSubModeMomentum');
const modeExplainerTitle = document.getElementById('modeExplainerTitle');
const modeExplainerFormula = document.getElementById('modeExplainerFormula');
const modeExplainerSummary = document.getElementById('modeExplainerSummary');
const chkEliminateWinner = document.getElementById('chkEliminateWinner');

const choicesSummaryText = document.getElementById('choicesSummaryText');
const btnRestoreEliminated = document.getElementById('btnRestoreEliminated');
const btnToggleBulkEdit = document.getElementById('btnToggleBulkEdit');
const addChoiceForm = document.getElementById('addChoiceForm');
const inputNewLabel = document.getElementById('inputNewLabel');
const bulkEditPanel = document.getElementById('bulkEditPanel');
const textareaBulk = document.getElementById('textareaBulk');
const btnApplyBulk = document.getElementById('btnApplyBulk');
const btnCancelBulk = document.getElementById('btnCancelBulk');
const choicesListContainer = document.getElementById('choicesListContainer');

const btnRunAudit = document.getElementById('btnRunAudit');
const auditResultPanel = document.getElementById('auditResultPanel');
const auditStatusBadge = document.getElementById('auditStatusBadge');
const auditChiSquareVal = document.getElementById('auditChiSquareVal');
const auditPValueVal = document.getElementById('auditPValueVal');
const auditErrorTimeVal = document.getElementById('auditErrorTimeVal');
const auditBarsContainer = document.getElementById('auditBarsContainer');

const historyCountText = document.getElementById('historyCountText');
const historyListContainer = document.getElementById('historyListContainer');

// Local state
let currentDistribution = { activeItems: [], prefixSums: [], totalEffectiveWeight: 0 };
let highlightedWinnerId = null;
let toastTimer = null;

const renderer = createWheelRenderer(wheelCanvas);

const animator = createWheelAnimator({
  onFrame({ rotationRad, pointerAngle, spinning, currentSlice, particles }) {
    renderer.renderFrame(rotationRad, pointerAngle, spinning, particles);
    updatePointerHud(currentSlice);
  },
  onSliceTick(_slice, normalizedSpeed) {
    sound.playTick(normalizedSpeed);
  },
  onRollbackNotice() {
    physicsHintText.textContent =
      '⚓ แรงเหวี่ยงยังไม่พ้นจุดศูนย์ถ่วง — แรงโน้มถ่วง g ด้านล่างจึงดึงวงล้อหมุนกลับ (สะบัดให้แรงขึ้นหรือกดปุ่ม SPIN เพื่อสุ่ม!)';
  },
  onComplete(resultPayload) {
    btnPrimarySpin.textContent = '✦ หมุนวงล้อ (SPIN)';
    btnPrimarySpin.classList.remove('is-skip-mode');
    physicsHintText.textContent =
      '💡 กดปุ่ม SPIN หรือใช้นิ้ว/เมาส์ลากวงล้อแล้วสะบัดหมุน (หากดึงเบาเกินไป แรงโน้มถ่วง g ด้านล่างจะดึงวงล้อหมุนกลับตามฟิสิกส์จริง)';

    highlightedWinnerId = resultPayload.item.id;
    sound.playWinFanfare();

    store.recordWin(resultPayload.item.id, resultPayload.probability);

    winnerNameText.textContent = resultPayload.item.label;
    const pct = (resultPayload.probability * 100).toFixed(2);
    winnerStatsText.textContent = `โอกาสออกในรอบที่หมุน: ${pct}% (Weight: ${resultPayload.baseWeight})`;
    winnerBanner.hidden = false;

    announceScreenReader(`ผลการสุ่มได้แก่ ${resultPayload.item.label} โอกาสออก ${pct} เปอร์เซ็นต์`);
  }
});

function showToast(message) {
  if (toastTimer) clearTimeout(toastTimer);
  toastBanner.textContent = message;
  toastBanner.hidden = false;
  toastTimer = setTimeout(() => {
    toastBanner.hidden = true;
  }, 3200);
}

function announceScreenReader(text) {
  srAnnouncement.textContent = '';
  setTimeout(() => {
    srAnnouncement.textContent = text;
  }, 20);
}

function updatePointerHud(slice) {
  if (!slice) {
    hudCurrentLabel.textContent = 'ไม่มีตัวเลือก';
    hudCurrentProb.textContent = '0%';
    hudCurrentWeight.textContent = 'W: —';
    return;
  }
  hudCurrentLabel.textContent = slice.item.label;
  hudCurrentProb.textContent = `${(slice.probability * 100).toFixed(1)}%`;
  hudCurrentWeight.textContent = `W: ${slice.baseWeight}`;
}

/**
 * Triggers a cryptographically fair spin or skips to result if already spinning.
 * @param {number} [direction=1] - +1 clockwise, -1 counter-clockwise
 * @param {number | null} [flickSpeedRadPerSec=null] - Optional flick velocity to scale spin duration
 */
function triggerSpinOrSkip(direction = 1, flickSpeedRadPerSec = null) {
  sound.unlock();

  if (animator.isSpinning()) {
    animator.skipToResult();
    return;
  }

  const state = store.getState();
  const dist = computeDistribution(state.currentPreset.items, state.currentPreset.mode);
  if (dist.activeItems.length === 0) {
    showToast('กรุณาเพิ่มหรือเปิดใช้งานคำตอบอย่างน้อย 1 ข้อก่อนหมุน');
    return;
  }

  highlightedWinnerId = null;
  winnerBanner.hidden = true;

  const sample = sampleWinnerFromDistribution(dist, false);
  if (!sample) return;

  const { winnerEntry } = sample;
  const speedCfg = SPIN_SPEED_CONFIG[selectedSpeedKey] || SPIN_SPEED_CONFIG.normal;

  // If triggered by a physical flick gesture, scale extra spins slightly with flick speed
  let minSpins = speedCfg.minSpins;
  let maxSpins = speedCfg.maxSpins;
  let duration = speedCfg.duration;
  if (flickSpeedRadPerSec !== null) {
    const boost = Math.min(4, Math.floor(Math.abs(flickSpeedRadPerSec) / 6));
    minSpins = Math.max(3, minSpins + boost - 1);
    maxSpins = Math.max(minSpins + 1, maxSpins + boost);
  }

  const currentRotation = animator.getRotation();
  const { targetRotation } = computeTargetRotation(currentRotation, winnerEntry, minSpins, maxSpins);

  const reducedMotion =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  btnPrimarySpin.textContent = '⏩ ข้ามไปดูผลทันที (SKIP)';
  btnPrimarySpin.classList.add('is-skip-mode');

  renderer.setDistribution(dist, null);
  animator.startSpin({
    targetRotation,
    duration,
    distribution: dist,
    reducedMotion,
    direction,
    resultPayload: {
      item: winnerEntry.item,
      probability: winnerEntry.probability,
      baseWeight: winnerEntry.baseWeight,
      mode: state.currentPreset.mode
    }
  });
}

// Speed selector pills
speedButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    const speed = btn.getAttribute('data-speed');
    if (speed && SPIN_SPEED_CONFIG[speed]) {
      selectedSpeedKey = speed;
      speedButtons.forEach((b) => b.classList.toggle('is-active', b === btn));
    }
  });
});

function renderPresetsSection(state) {
  if (document.activeElement !== inputPresetName) {
    inputPresetName.value = state.currentPreset.name;
  }

  presetSelect.replaceChildren();
  for (const preset of state.presets) {
    const opt = document.createElement('option');
    opt.value = preset.id;
    opt.textContent = `${preset.name} (${preset.items.length} ข้อ)`;
    if (preset.id === state.currentPreset.id) {
      opt.selected = true;
    }
    presetSelect.appendChild(opt);
  }
  btnDeletePreset.disabled = state.presets.length <= 1;
  storageStatusTag.textContent = state.storageAvailable ? '✓ บันทึกอัตโนมัติ' : 'Memory Mode';
}

function renderModeControls(state) {
  const mode = state.currentPreset.mode;

  btnModeIndependent.classList.toggle('is-active', mode === 'independent');
  btnSubModeBalance.classList.toggle('is-active', mode === 'balance');
  btnSubModeMomentum.classList.toggle('is-active', mode === 'momentum');

  const desc = MODE_DESCRIPTIONS[mode] || MODE_DESCRIPTIONS.independent;
  modeExplainerTitle.textContent = `${desc.badge}:`;
  modeExplainerSummary.textContent = desc.summary;
  modeExplainerFormula.textContent = desc.formulaText;

  chkEliminateWinner.checked = Boolean(state.currentPreset.eliminateWinner);
}

function renderChoicesList(state, dist) {
  choicesListContainer.replaceChildren();

  const items = state.currentPreset.items;
  const activeColors = assignCycleSafeColors(dist.activeItems.length);
  const activeMap = new Map();
  dist.activeItems.forEach((entry, activeIdx) => {
    activeMap.set(entry.item.id, {
      entry,
      color: activeColors[activeIdx]
    });
  });

  let eliminatedCount = 0;
  for (const item of items) {
    if (item.eliminated) eliminatedCount++;
  }

  choicesSummaryText.textContent =
    eliminatedCount > 0
      ? `ตัวเลือกที่เปิดอยู่ (${dist.activeItems.length}) · พักไว้ (${eliminatedCount})`
      : `ตัวเลือกทั้งหมด (${dist.activeItems.length})`;
  btnRestoreEliminated.hidden = eliminatedCount === 0;

  if (items.length === 0) {
    const emptyMsg = document.createElement('div');
    emptyMsg.className = 'history-item';
    emptyMsg.textContent = 'ยังไม่มีคำตอบ พิมพ์คำตอบช่องด้านบนแล้วกด Enter ได้เลย!';
    choicesListContainer.appendChild(emptyMsg);
    return;
  }

  for (const item of items) {
    const activeInfo = activeMap.get(item.id);
    const probPct = activeInfo ? activeInfo.entry.probability * 100 : 0;

    const row = document.createElement('div');
    row.className = `choice-row${item.eliminated ? ' is-eliminated' : ''}`;
    row.setAttribute('role', 'listitem');

    // 1. Color swatch + large editable label
    const cellMain = document.createElement('div');
    cellMain.className = 'choice-cell-main';

    const swatch = document.createElement('span');
    swatch.className = 'choice-swatch';
    swatch.style.backgroundColor = activeInfo ? activeInfo.color.fill : '#475569';

    const labelInput = document.createElement('input');
    labelInput.type = 'text';
    labelInput.className = 'choice-label-input';
    labelInput.value = item.label;
    labelInput.maxLength = 120;
    labelInput.setAttribute('aria-label', `ชื่อคำตอบ ${item.label}`);
    labelInput.addEventListener('change', () => {
      store.updateItem(item.id, { label: labelInput.value });
    });

    cellMain.append(swatch, labelInput);

    // 2. Weight Stepper [- value +] for effortless adjustment
    const stepper = document.createElement('div');
    stepper.className = 'weight-stepper';

    const btnMinus = document.createElement('button');
    btnMinus.type = 'button';
    btnMinus.className = 'weight-step-btn';
    btnMinus.textContent = '−';
    btnMinus.title = 'ลดน้ำหนัก';
    btnMinus.addEventListener('click', () => {
      const nextW = Math.max(1, Math.round((Number(item.weight) - 1) * 10) / 10);
      store.updateItem(item.id, { weight: nextW });
    });

    const weightInput = document.createElement('input');
    weightInput.type = 'number';
    weightInput.className = 'choice-weight-input';
    weightInput.min = '0.1';
    weightInput.max = '10000';
    weightInput.step = 'any';
    weightInput.value = String(item.weight);
    weightInput.setAttribute('aria-label', `น้ำหนักของ ${item.label}`);
    weightInput.addEventListener('change', () => {
      store.updateItem(item.id, { weight: weightInput.value });
    });

    const btnPlus = document.createElement('button');
    btnPlus.type = 'button';
    btnPlus.className = 'weight-step-btn';
    btnPlus.textContent = '+';
    btnPlus.title = 'เพิ่มน้ำหนัก';
    btnPlus.addEventListener('click', () => {
      const nextW = Math.min(10000, Math.round((Number(item.weight) + 1) * 10) / 10);
      store.updateItem(item.id, { weight: nextW });
    });

    stepper.append(btnMinus, weightInput, btnPlus);

    // 3. Probability % + wins
    const cellProb = document.createElement('div');
    cellProb.className = 'choice-prob-cell';

    const probTop = document.createElement('div');
    probTop.className = 'choice-prob-top';

    const probText = document.createElement('span');
    probText.className = 'choice-prob-pct';
    probText.textContent = item.eliminated ? 'พักไว้' : `${probPct.toFixed(1)}%`;

    const winsBadge = document.createElement('span');
    winsBadge.className = 'choice-wins-badge';
    winsBadge.textContent = item.wins > 0 ? `ชนะ ${item.wins}` : '';

    probTop.append(probText, winsBadge);

    const barTrack = document.createElement('div');
    barTrack.className = 'choice-prob-bar-track';
    const barFill = document.createElement('div');
    barFill.className = 'choice-prob-bar-fill';
    barFill.style.width = `${Math.min(100, Math.max(0, probPct)).toFixed(1)}%`;
    barTrack.appendChild(barFill);

    cellProb.append(probTop, barTrack);

    // 4. Actions
    const cellActions = document.createElement('div');
    cellActions.className = 'choice-actions-cell';

    const btnToggleActive = document.createElement('button');
    btnToggleActive.type = 'button';
    btnToggleActive.className = 'choice-icon-btn';
    btnToggleActive.title = item.eliminated ? 'นำกลับเข้าวงล้อ' : 'พักคำตอบนี้ชั่วคราว';
    btnToggleActive.textContent = item.eliminated ? '↺' : '⏸';
    btnToggleActive.addEventListener('click', () => {
      store.updateItem(item.id, { eliminated: !item.eliminated });
    });

    const btnDelete = document.createElement('button');
    btnDelete.type = 'button';
    btnDelete.className = 'choice-icon-btn';
    btnDelete.title = 'ลบคำตอบนี้';
    btnDelete.textContent = '✕';
    btnDelete.addEventListener('click', () => {
      store.removeItem(item.id);
    });

    cellActions.append(btnToggleActive, btnDelete);
    row.append(cellMain, stepper, cellProb, cellActions);
    choicesListContainer.appendChild(row);
  }
}

function renderHistoryList(state) {
  historyCountText.textContent = String(state.history.length);
  historyListContainer.replaceChildren();

  if (state.history.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'history-item';
    empty.textContent = 'ยังไม่มีประวัติการหมุนในรอบนี้';
    historyListContainer.appendChild(empty);
    return;
  }

  state.history.slice(0, 25).forEach((entry, idx) => {
    const row = document.createElement('div');
    row.className = 'history-item';

    const left = document.createElement('div');
    left.className = 'history-item__left';
    const num = document.createElement('span');
    num.className = 'mono-pill';
    num.textContent = `#${state.history.length - idx}`;

    const name = document.createElement('span');
    name.textContent = entry.label;
    left.append(num, name);

    const meta = document.createElement('span');
    meta.className = 'history-item__meta';
    const timeStr = new Date(entry.timestamp).toLocaleTimeString('th-TH', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
    meta.textContent = `${Number(entry.probabilityPct).toFixed(1)}% · ${timeStr}`;

    row.append(left, meta);
    historyListContainer.appendChild(row);
  });
}

function syncAll(state) {
  sound.setEnabled(state.soundEnabled);
  btnSoundToggle.setAttribute('aria-pressed', String(state.soundEnabled));
  soundIcon.textContent = state.soundEnabled ? '🔊' : '🔇';
  soundLabel.textContent = state.soundEnabled ? 'เสียง' : 'ปิดเสียง';

  currentDistribution = computeDistribution(state.currentPreset.items, state.currentPreset.mode);
  btnPrimarySpin.disabled = currentDistribution.activeItems.length === 0 && !animator.isSpinning();

  renderPresetsSection(state);
  renderModeControls(state);
  renderChoicesList(state, currentDistribution);
  renderHistoryList(state);

  renderer.setDistribution(currentDistribution, highlightedWinnerId);
  if (!animator.isSpinning()) {
    const rot = animator.getRotation();
    renderer.renderFrame(rot, 0, false);
    updatePointerHud(getSliceAtPointer(currentDistribution, rot));
  }
}

store.subscribe(syncAll);

function checkUrlHashForSharedPreset() {
  const hash = window.location.hash || '';
  if (!hash.startsWith('#preset=')) return;
  const payload = hash.slice('#preset='.length).trim();
  if (!payload) return;

  try {
    const imported = decodePresetFromUrlPayload(payload);
    store.importValidatedPreset(imported);
    history.replaceState(null, '', window.location.pathname + window.location.search);
    showToast(`โหลดชุดคำตอบ "${imported.name}" สำเร็จ!`);
  } catch {
    showToast('ลิงก์ชุดคำตอบไม่ถูกต้อง ระบบใช้ชุดคำตอบเริ่มต้นแทน');
  }
}

const resizeObserver = new ResizeObserver((entries) => {
  for (const entry of entries) {
    const box = entry.contentRect;
    const size = Math.min(box.width, box.height);
    if (size > 0) {
      renderer.resize(size, size);
      renderer.renderFrame(animator.getRotation(), 0, animator.isSpinning());
    }
  }
});
resizeObserver.observe(wheelViewport);

/**
 * Interactive Wheel Drag & Real Gravity Physics Handler:
 * - Clicking the center SPIN medallion triggers a full CSPRNG spin immediately.
 * - Dragging the outer wheel rotates it in real time with peg clicks:
 *   - If released with angular speed >= FLICK_VELOCITY_THRESHOLD -> Full CSPRNG Spin in flick direction!
 *   - If released with angular speed < FLICK_VELOCITY_THRESHOLD -> Real Gravity (g at 6 o'clock) pulls it back!
 */
let dragState = null;

function unwrapAngleDelta(newAngle, prevAngle) {
  let d = newAngle - prevAngle;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

wheelCanvas.addEventListener('pointerdown', (e) => {
  sound.unlock();
  if (animator.isSpinning()) {
    triggerSpinOrSkip();
    return;
  }

  const rect = wheelCanvas.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const distFromCenter = Math.hypot(e.clientX - cx, e.clientY - cy);
  const wheelRadiusPx = rect.width * 0.445;

  // Clicking the center SPIN medallion (inner 25% of radius) spins immediately
  if (distFromCenter <= wheelRadiusPx * 0.26) {
    triggerSpinOrSkip(1, null);
    return;
  }

  wheelCanvas.setPointerCapture(e.pointerId);
  animator.beginDrag(currentDistribution);

  dragState = {
    pointerId: e.pointerId,
    lastAngle: Math.atan2(e.clientY - cy, e.clientX - cx),
    lastTimeMs: performance.now(),
    totalAbsMovedRad: 0,
    velocityRadPerSec: 0
  };
});

wheelCanvas.addEventListener('pointermove', (e) => {
  if (!dragState || dragState.pointerId !== e.pointerId) return;

  const rect = wheelCanvas.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const nowMs = performance.now();
  const dtSec = Math.max(0.004, (nowMs - dragState.lastTimeMs) / 1000);

  const currentAngle = Math.atan2(e.clientY - cy, e.clientX - cx);
  const deltaRad = unwrapAngleDelta(currentAngle, dragState.lastAngle);

  dragState.lastAngle = currentAngle;
  dragState.lastTimeMs = nowMs;
  dragState.totalAbsMovedRad += Math.abs(deltaRad);

  const instantVel = deltaRad / dtSec;
  dragState.velocityRadPerSec = dragState.velocityRadPerSec * 0.4 + instantVel * 0.6;

  animator.dragBy(deltaRad, dtSec);
});

function handlePointerRelease(e) {
  if (!dragState || dragState.pointerId !== e.pointerId) return;
  const nowMs = performance.now();
  const idleSinceMoveSec = (nowMs - dragState.lastTimeMs) / 1000;
  // Decay velocity if user held pointer still before releasing
  const releaseVelocity = idleSinceMoveSec > 0.12 ? 0 : dragState.velocityRadPerSec;
  const totalMoved = dragState.totalAbsMovedRad;
  dragState = null;

  // Quick tap without dragging -> spin
  if (totalMoved < 0.035) {
    triggerSpinOrSkip(1, null);
    return;
  }

  // Strong flick -> Full CSPRNG spin in the direction of the flick
  if (Math.abs(releaseVelocity) >= FLICK_VELOCITY_THRESHOLD) {
    const dir = releaseVelocity >= 0 ? 1 : -1;
    triggerSpinOrSkip(dir, releaseVelocity);
  } else {
    // Weak drag / sub-threshold release -> Real downward gravity (g) rollback physics!
    animator.startGravityRollback(releaseVelocity);
  }
}

wheelCanvas.addEventListener('pointerup', handlePointerRelease);
wheelCanvas.addEventListener('pointercancel', handlePointerRelease);

window.addEventListener('keydown', (e) => {
  const tag = document.activeElement?.tagName;
  const isTyping = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';

  if (e.code === 'Space' && !isTyping) {
    e.preventDefault();
    triggerSpinOrSkip(1, null);
  } else if (e.code === 'Escape' && !winnerBanner.hidden) {
    winnerBanner.hidden = true;
  }
});

btnPrimarySpin.addEventListener('click', () => triggerSpinOrSkip(1, null));

btnResetStats.addEventListener('click', () => {
  if (animator.isSpinning()) return;
  highlightedWinnerId = null;
  winnerBanner.hidden = true;
  store.resetSessionStats();
  showToast('รีเซ็ตสถิติและคืนค่าตัวเลือกทั้งหมดเรียบร้อย');
});

btnCloseWinner.addEventListener('click', () => {
  winnerBanner.hidden = true;
});

btnSoundToggle.addEventListener('click', () => {
  const current = store.getState().soundEnabled;
  store.setSoundEnabled(!current);
});

btnShareUrl.addEventListener('click', async () => {
  try {
    const state = store.getState();
    const payload = encodePresetToUrlPayload(state.currentPreset);
    const shareUrl = `${window.location.origin}${window.location.pathname}#preset=${payload}`;
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      await navigator.clipboard.writeText(shareUrl);
      showToast('คัดลอกลิงก์แชร์ชุดคำตอบลง Clipboard แล้ว!');
    } else {
      window.location.hash = `preset=${payload}`;
      showToast('อัปเดตลิงก์บนแถบ URL แล้ว คัดลอกไปแชร์ได้เลย');
    }
  } catch {
    showToast('ไม่สามารถสร้างลิงก์แชร์ได้');
  }
});

// Section 1: Quick Add Single Choice (Type & Enter)
addChoiceForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const label = inputNewLabel.value.trim();
  if (!label) return;
  if (store.addItem(label, 1)) {
    inputNewLabel.value = '';
    inputNewLabel.focus();
  }
});

btnRestoreEliminated.addEventListener('click', () => {
  store.restoreEliminatedItems();
  showToast('คืนค่าตัวเลือกที่พักไว้ทั้งหมดแล้ว');
});

btnToggleBulkEdit.addEventListener('click', () => {
  const isHidden = bulkEditPanel.hidden;
  if (isHidden) {
    const items = store.getState().currentPreset.items;
    textareaBulk.value = items
      .map((item) => (item.weight !== 1 ? `${item.label} | ${item.weight}` : item.label))
      .join('\n');
    bulkEditPanel.hidden = false;
    textareaBulk.focus();
  } else {
    bulkEditPanel.hidden = true;
  }
});

btnCancelBulk.addEventListener('click', () => {
  bulkEditPanel.hidden = true;
});

btnApplyBulk.addEventListener('click', () => {
  store.replaceItemsFromBulkText(textareaBulk.value);
  bulkEditPanel.hidden = true;
  showToast('อัปเดตรายการคำตอบจากข้อความหลายบรรทัดเรียบร้อย');
});

// Section 2: Mode Selection
btnModeIndependent.addEventListener('click', () => {
  store.setMode('independent');
});

btnSubModeBalance.addEventListener('click', () => {
  store.setMode('balance');
});

btnSubModeMomentum.addEventListener('click', () => {
  store.setMode('momentum');
});

chkEliminateWinner.addEventListener('change', () => {
  store.setEliminateWinner(chkEliminateWinner.checked);
});

// Section 3 (Bottom): Preset Save & Load
presetNameForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const name = inputPresetName.value.trim();
  if (!name) return;
  store.saveCurrentPresetAs(name);
  showToast(`บันทึกชื่อชุดคำตอบ "${name}" เรียบร้อยแล้ว`);
});

btnNewPreset.addEventListener('click', () => {
  const customName =
    inputPresetName.value.trim() || `ชุดคำตอบ #${store.getState().presets.length + 1}`;
  const created = store.createNewPreset(customName);
  showToast(`บันทึกแยกเป็นชุดคำตอบใหม่ "${created.name}" เรียบร้อยแล้ว`);
});

presetSelect.addEventListener('change', () => {
  highlightedWinnerId = null;
  winnerBanner.hidden = true;
  store.selectPreset(presetSelect.value);
});

btnDeletePreset.addEventListener('click', () => {
  const current = store.getState().currentPreset;
  if (store.deletePreset(current.id)) {
    showToast(`ลบชุดคำตอบ "${current.name}" แล้ว`);
  }
});

btnExportJson.addEventListener('click', () => {
  const preset = store.getState().currentPreset;
  const clean = sanitizePreset(preset);
  const blob = new Blob([JSON.stringify(clean, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const safeFile = clean.name.replace(/[^\w\u0E00-\u0E7F\- ]+/g, '').trim() || 'fair-wheel-preset';
  a.href = url;
  a.download = `${safeFile}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  showToast('ดาวน์โหลดไฟล์ .JSON เรียบร้อย');
});

inputImportJson.addEventListener('change', async () => {
  const file = inputImportJson.files?.[0];
  if (!file) return;
  try {
    if (file.size > 512 * 1024) {
      throw new Error('File too large');
    }
    const text = await file.text();
    const parsed = JSON.parse(text);
    const imported = store.importValidatedPreset(parsed);
    showToast(`นำเข้าชุดคำตอบ "${imported.name}" สำเร็จ!`);
  } catch {
    showToast('ไฟล์ JSON ไม่ถูกต้อง');
  } finally {
    inputImportJson.value = '';
  }
});

// 100,000-Spin Chi-Squared Fairness Audit
btnRunAudit.addEventListener('click', () => {
  const state = store.getState();
  const audit = runFairnessAudit(state.currentPreset.items, state.currentPreset.mode, 100000);
  if (audit.trials === 0) {
    showToast('ต้องมีตัวเลือกอย่างน้อย 1 ข้อ');
    return;
  }

  auditResultPanel.hidden = false;
  auditStatusBadge.textContent = audit.passed ? '✓ PASS (แฟร์ตามทฤษฎี)' : '⚠ ลองรันซ้ำ';
  auditChiSquareVal.textContent = `${audit.chiSquare.toFixed(2)} (df=${audit.degreesOfFreedom})`;
  auditPValueVal.textContent = audit.pValue.toFixed(4);
  auditErrorTimeVal.textContent = `±${audit.maxRelativeErrorPct.toFixed(2)}% (${audit.durationMs}ms)`;

  auditBarsContainer.replaceChildren();
  const maxPct = Math.max(...audit.results.map((r) => Math.max(r.observedPct, r.probabilityPct)), 1);

  for (const row of audit.results) {
    const itemEl = document.createElement('div');
    itemEl.className = 'audit-bar-row';

    const labelEl = document.createElement('span');
    labelEl.className = 'audit-bar-label';
    labelEl.textContent = row.label;

    const trackEl = document.createElement('div');
    trackEl.className = 'audit-bar-track';
    const fillEl = document.createElement('div');
    fillEl.className = 'audit-bar-fill';
    fillEl.style.width = `${Math.min(100, (row.observedPct / maxPct) * 100).toFixed(1)}%`;
    trackEl.appendChild(fillEl);

    const statsEl = document.createElement('span');
    statsEl.className = 'audit-bar-stats';
    statsEl.textContent = `${row.observedPct.toFixed(2)}% (ทฤษฎี ${row.probabilityPct.toFixed(2)}%)`;

    itemEl.append(labelEl, trackEl, statsEl);
    auditBarsContainer.appendChild(itemEl);
  }
});

checkUrlHashForSharedPreset();
syncAll(store.getState());
