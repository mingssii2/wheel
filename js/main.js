/**
 * Main Application Entrypoint — FAIR WHEEL
 * Orchestrates CSPRNG math engine, OffscreenCanvas 3D renderer, Web Audio synthesizer,
 * Preset serialization/URL sharing, and strict XSS-safe DOM updates.
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

// DOM References
const srAnnouncement = document.getElementById('srAnnouncement');
const toastBanner = document.getElementById('toastBanner');
const btnSoundToggle = document.getElementById('btnSoundToggle');
const soundIcon = document.getElementById('soundIcon');
const soundLabel = document.getElementById('soundLabel');
const btnShareUrl = document.getElementById('btnShareUrl');

const hudCurrentLabel = document.getElementById('hudCurrentLabel');
const hudCurrentProb = document.getElementById('hudCurrentProb');
const hudCurrentWeight = document.getElementById('hudCurrentWeight');

const wheelViewport = document.getElementById('wheelViewport');
const wheelCanvas = document.getElementById('wheelCanvas');
const btnPrimarySpin = document.getElementById('btnPrimarySpin');
const btnResetStats = document.getElementById('btnResetStats');

const winnerBanner = document.getElementById('winnerBanner');
const winnerNameText = document.getElementById('winnerNameText');
const winnerStatsText = document.getElementById('winnerStatsText');
const btnCloseWinner = document.getElementById('btnCloseWinner');

const storageStatusTag = document.getElementById('storageStatusTag');
const presetSelect = document.getElementById('presetSelect');
const btnNewPreset = document.getElementById('btnNewPreset');
const btnRenamePreset = document.getElementById('btnRenamePreset');
const btnDeletePreset = document.getElementById('btnDeletePreset');
const presetNameForm = document.getElementById('presetNameForm');
const inputPresetName = document.getElementById('inputPresetName');
const btnCancelPresetName = document.getElementById('btnCancelPresetName');
const btnExportJson = document.getElementById('btnExportJson');
const inputImportJson = document.getElementById('inputImportJson');

const btnModeIndependent = document.getElementById('btnModeIndependent');
const btnModeHistory = document.getElementById('btnModeHistory');
const historySubModePanel = document.getElementById('historySubModePanel');
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
const inputNewWeight = document.getElementById('inputNewWeight');
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

// Local UI state
let currentDistribution = { activeItems: [], prefixSums: [], totalEffectiveWeight: 0 };
let lastHistorySubMode = 'balance';
let nameFormMode = 'rename'; // 'rename' | 'new'
let highlightedWinnerId = null;
let toastTimer = null;

const renderer = createWheelRenderer(wheelCanvas);

const animator = createWheelAnimator({
  onFrame({ rotationRad, pointerAngle, spinning, currentSlice }) {
    renderer.renderFrame(rotationRad, pointerAngle, spinning);
    updatePointerHud(currentSlice);
  },
  onSliceTick(_slice, normalizedSpeed) {
    sound.playTick(normalizedSpeed);
  },
  onComplete(resultPayload) {
    btnPrimarySpin.textContent = '🎯 หมุนวงล้อ (SPIN)';
    btnPrimarySpin.classList.remove('is-skip-mode');

    highlightedWinnerId = resultPayload.item.id;
    sound.playWinFanfare();

    // Record win in state store (updates win count & optional elimination)
    store.recordWin(resultPayload.item.id, resultPayload.probability);

    // Show Winner Banner
    winnerNameText.textContent = resultPayload.item.label;
    const pct = (resultPayload.probability * 100).toFixed(2);
    const modeTitle = MODE_DESCRIPTIONS[resultPayload.mode]?.title || resultPayload.mode;
    winnerStatsText.textContent = `โอกาสออกในรอบที่หมุน: ${pct}% (Weight ตั้งต้น: ${resultPayload.baseWeight} · โหมด: ${modeTitle})`;
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
  }, 3600);
}

function announceScreenReader(text) {
  srAnnouncement.textContent = '';
  setTimeout(() => {
    srAnnouncement.textContent = text;
  }, 20);
}

function updatePointerHud(slice) {
  if (!slice) {
    hudCurrentLabel.textContent = 'ไม่มีตัวเลือกที่เปิดใช้งาน';
    hudCurrentProb.textContent = 'P: 0.00%';
    hudCurrentWeight.textContent = 'W: —';
    return;
  }
  hudCurrentLabel.textContent = slice.item.label;
  hudCurrentProb.textContent = `P: ${(slice.probability * 100).toFixed(2)}%`;
  hudCurrentWeight.textContent = `W: ${slice.baseWeight}`;
}

/**
 * Triggers a cryptographically fair spin or skips to result if already spinning.
 */
function triggerSpinOrSkip() {
  sound.unlock();

  if (animator.isSpinning()) {
    animator.skipToResult();
    return;
  }

  const state = store.getState();
  const dist = computeDistribution(state.currentPreset.items, state.currentPreset.mode);
  if (dist.activeItems.length === 0) {
    showToast('กรุณาเพิ่มหรือเปิดใช้งานคำตอบอย่างน้อย 1 ข้อก่อนหมุนวงล้อ');
    return;
  }

  highlightedWinnerId = null;
  winnerBanner.hidden = true;

  // 1. Outcome-First CSPRNG Selection
  const sample = sampleWinnerFromDistribution(dist, false);
  if (!sample) return;

  const { winnerEntry } = sample;
  const currentRotation = animator.getRotation();
  const { targetRotation } = computeTargetRotation(currentRotation, winnerEntry, 6, 9);

  const reducedMotion =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  btnPrimarySpin.textContent = '⏩ ข้ามไปดูผลทันที (SKIP)';
  btnPrimarySpin.classList.add('is-skip-mode');

  renderer.setDistribution(dist, null);
  animator.startSpin({
    targetRotation,
    duration: 4500,
    distribution: dist,
    reducedMotion,
    resultPayload: {
      item: winnerEntry.item,
      probability: winnerEntry.probability,
      baseWeight: winnerEntry.baseWeight,
      mode: state.currentPreset.mode
    }
  });
}

/**
 * Renders the Preset selector dropdown safely.
 */
function renderPresetsDropdown(state) {
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
  storageStatusTag.textContent = state.storageAvailable
    ? 'บันทึกอัตโนมัติใน Browser'
    : 'Memory Mode (Storage ปิดอยู่)';
}

/**
 * Updates the Probability Mode segmented buttons & plain-language explanation card.
 */
function renderModeControls(state) {
  const mode = state.currentPreset.mode;
  if (mode === 'balance' || mode === 'momentum') {
    lastHistorySubMode = mode;
  }

  const isIndependent = mode === 'independent';
  btnModeIndependent.classList.toggle('is-active', isIndependent);
  btnModeIndependent.setAttribute('aria-pressed', String(isIndependent));

  btnModeHistory.classList.toggle('is-active', !isIndependent);
  btnModeHistory.setAttribute('aria-pressed', String(!isIndependent));

  historySubModePanel.hidden = isIndependent;

  btnSubModeBalance.classList.toggle('is-selected', mode === 'balance');
  btnSubModeMomentum.classList.toggle('is-selected', mode === 'momentum');

  const desc = MODE_DESCRIPTIONS[mode] || MODE_DESCRIPTIONS.independent;
  modeExplainerTitle.textContent = desc.title;
  modeExplainerFormula.textContent = desc.formulaText;
  modeExplainerSummary.textContent = desc.summary;

  chkEliminateWinner.checked = Boolean(state.currentPreset.eliminateWinner);
}

/**
 * Renders the per-choice table with Color Swatch, Label input, Weight input,
 * Session Win Count badge, and Exact Probability (%) bar.
 */
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
      ? `เปิดใช้งาน ${dist.activeItems.length} ข้อ (พักไว้ชั่วคราว ${eliminatedCount} ข้อ)`
      : `เปิดใช้งานทั้งหมด ${dist.activeItems.length} ข้อ`;
  btnRestoreEliminated.hidden = eliminatedCount === 0;

  if (items.length === 0) {
    const emptyMsg = document.createElement('div');
    emptyMsg.className = 'history-item';
    emptyMsg.textContent = 'ยังไม่มีคำตอบในชุดนี้ พิมพ์คำตอบด้านบนเพื่อเริ่มใช้งาน';
    choicesListContainer.appendChild(emptyMsg);
    return;
  }

  for (const item of items) {
    const activeInfo = activeMap.get(item.id);
    const probPct = activeInfo ? activeInfo.entry.probability * 100 : 0;

    const row = document.createElement('div');
    row.className = `choice-row${item.eliminated ? ' is-eliminated' : ''}`;
    row.setAttribute('role', 'listitem');

    // Cell 1: Color Swatch + Editable Label
    const cellMain = document.createElement('div');
    cellMain.className = 'choice-cell-main';

    const swatch = document.createElement('span');
    swatch.className = 'choice-swatch';
    swatch.style.backgroundColor = activeInfo ? activeInfo.color.fill : '#D6D3D1';

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

    // Cell 2: Base Weight Input
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

    // Cell 3: Live Probability (%) + Win Count + Visual Bar
    const cellProb = document.createElement('div');
    cellProb.className = 'choice-prob-cell';

    const probTop = document.createElement('div');
    probTop.className = 'choice-prob-top';

    const probText = document.createElement('span');
    probText.className = 'choice-prob-pct';
    probText.textContent = item.eliminated ? 'พักไว้ (0%)' : `P: ${probPct.toFixed(2)}%`;

    const winsBadge = document.createElement('span');
    winsBadge.className = 'choice-wins-badge';
    winsBadge.textContent = `ชนะ ${item.wins || 0}`;

    probTop.append(probText, winsBadge);

    const barTrack = document.createElement('div');
    barTrack.className = 'choice-prob-bar-track';
    const barFill = document.createElement('div');
    barFill.className = 'choice-prob-bar-fill';
    barFill.style.width = `${Math.min(100, Math.max(0, probPct)).toFixed(1)}%`;
    if (activeInfo) {
      barFill.style.backgroundColor = activeInfo.color.fill;
    }
    barTrack.appendChild(barFill);

    cellProb.append(probTop, barTrack);

    // Cell 4: Toggle Active/Eliminated + Delete
    const cellActions = document.createElement('div');
    cellActions.className = 'choice-actions-cell';

    const btnToggleActive = document.createElement('button');
    btnToggleActive.type = 'button';
    btnToggleActive.className = 'choice-icon-btn';
    btnToggleActive.title = item.eliminated ? 'นำกลับเข้าวงล้อ' : 'พักคำตอบนี้ชั่วคราว';
    btnToggleActive.textContent = item.eliminated ? '↺' : '👁';
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
    row.append(cellMain, weightInput, cellProb, cellActions);
    choicesListContainer.appendChild(row);
  }
}

/**
 * Renders the session spin history log.
 */
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

  state.history.slice(0, 30).forEach((entry, idx) => {
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
    meta.textContent = `P: ${Number(entry.probabilityPct).toFixed(2)}% · ${timeStr}`;

    row.append(left, meta);
    historyListContainer.appendChild(row);
  });
}

/**
 * Synchronizes full UI and Wheel Canvas whenever store state updates.
 */
function syncAll(state) {
  sound.setEnabled(state.soundEnabled);
  btnSoundToggle.setAttribute('aria-pressed', String(state.soundEnabled));
  soundIcon.textContent = state.soundEnabled ? '🔊' : '🔇';
  soundLabel.textContent = state.soundEnabled ? 'เสียง: เปิด' : 'เสียง: ปิด';

  currentDistribution = computeDistribution(state.currentPreset.items, state.currentPreset.mode);
  btnPrimarySpin.disabled = currentDistribution.activeItems.length === 0 && !animator.isSpinning();

  renderPresetsDropdown(state);
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

// Subscribe to store updates
store.subscribe(syncAll);

// Check URL hash (#preset=...) on startup for shared presets
function checkUrlHashForSharedPreset() {
  const hash = window.location.hash || '';
  if (!hash.startsWith('#preset=')) return;
  const payload = hash.slice('#preset='.length).trim();
  if (!payload) return;

  try {
    const imported = decodePresetFromUrlPayload(payload);
    store.importValidatedPreset(imported);
    history.replaceState(null, '', window.location.pathname + window.location.search);
    showToast(`โหลดชุดคำตอบ "${imported.name}" จากลิงก์ที่แชร์สำเร็จ!`);
  } catch {
    showToast('ลิงก์ชุดคำตอบไม่ถูกต้องหรือเสียหาย ระบบใช้ชุดคำตอบเริ่มต้นแทน');
  }
}

// ResizeObserver for crisp high-DPI responsiveness
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

// Interactive 3D Tilt & Drag-to-Spin on the Wheel Canvas
let dragState = null;

wheelCanvas.addEventListener('pointermove', (e) => {
  const rect = wheelCanvas.getBoundingClientRect();
  const nx = ((e.clientX - rect.left) / rect.width - 0.5) * 2;
  const ny = ((e.clientY - rect.top) / rect.height - 0.5) * 2;

  // Subtle 3D tilt following cursor
  wheelCanvas.style.transform = `rotateX(${(-ny * 5.5).toFixed(2)}deg) rotateY(${(nx * 5.5).toFixed(2)}deg)`;

  if (dragState && !animator.isSpinning()) {
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const currentAngle = Math.atan2(e.clientY - cy, e.clientX - cx);
    const delta = currentAngle - dragState.lastAngle;
    dragState.lastAngle = currentAngle;
    dragState.movedDistance += Math.abs(delta);

    const newRot = animator.getRotation() + delta;
    animator.setRotation(newRot);
    renderer.renderFrame(newRot, 0, false);
    updatePointerHud(getSliceAtPointer(currentDistribution, newRot));
  }
});

wheelCanvas.addEventListener('pointerleave', () => {
  wheelCanvas.style.transform = 'rotateX(0deg) rotateY(0deg)';
});

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

  // Clicking center SPIN hub directly spins immediately
  if (distFromCenter <= rect.width * 0.12) {
    triggerSpinOrSkip();
    return;
  }

  wheelCanvas.setPointerCapture(e.pointerId);
  dragState = {
    pointerId: e.pointerId,
    lastAngle: Math.atan2(e.clientY - cy, e.clientX - cx),
    movedDistance: 0,
    startTime: performance.now()
  };
});

wheelCanvas.addEventListener('pointerup', (e) => {
  if (!dragState || dragState.pointerId !== e.pointerId) return;
  const elapsed = performance.now() - dragState.startTime;
  const moved = dragState.movedDistance;
  dragState = null;

  // Either a quick tap or a deliberate swipe/flick triggers a full CSPRNG spin
  if (moved < 0.08 || moved > 0.14 || elapsed < 260) {
    triggerSpinOrSkip();
  }
});

// Keyboard accessibility: Space or Enter on canvas (or global Space when not typing in an input)
window.addEventListener('keydown', (e) => {
  const tag = document.activeElement?.tagName;
  const isTyping = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';

  if (e.code === 'Space' && !isTyping) {
    e.preventDefault();
    triggerSpinOrSkip();
  } else if (e.code === 'Escape' && !winnerBanner.hidden) {
    winnerBanner.hidden = true;
  }
});

// Button Event Listeners
btnPrimarySpin.addEventListener('click', triggerSpinOrSkip);

btnResetStats.addEventListener('click', () => {
  if (animator.isSpinning()) return;
  highlightedWinnerId = null;
  winnerBanner.hidden = true;
  store.resetSessionStats();
  showToast('รีเซ็ตสถิติจำนวนครั้งที่ชนะและคืนค่าทุกตัวเลือกเรียบร้อยแล้ว');
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
      showToast('คัดลอกลิงก์แชร์ชุดคำตอบลง Clipboard แล้ว! ส่งให้เพื่อนเปิดได้เลย');
    } else {
      window.location.hash = `preset=${payload}`;
      showToast('อัปเดตลิงก์บนแถบ URL ด้านบนแล้ว คัดลอก URL ไปแชร์ได้เลย');
    }
  } catch {
    showToast('ไม่สามารถสร้างลิงก์แชร์ได้');
  }
});

// Preset Controls
presetSelect.addEventListener('change', () => {
  highlightedWinnerId = null;
  winnerBanner.hidden = true;
  store.selectPreset(presetSelect.value);
});

btnNewPreset.addEventListener('click', () => {
  nameFormMode = 'new';
  inputPresetName.value = `ชุดคำตอบใหม่ #${store.getState().presets.length + 1}`;
  presetNameForm.hidden = false;
  inputPresetName.focus();
  inputPresetName.select();
});

btnRenamePreset.addEventListener('click', () => {
  nameFormMode = 'rename';
  inputPresetName.value = store.getState().currentPreset.name;
  presetNameForm.hidden = false;
  inputPresetName.focus();
  inputPresetName.select();
});

btnCancelPresetName.addEventListener('click', () => {
  presetNameForm.hidden = true;
});

presetNameForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const name = inputPresetName.value.trim();
  if (!name) return;
  if (nameFormMode === 'new') {
    store.createNewPreset(name);
    showToast(`สร้างชุดคำตอบ "${name}" เรียบร้อยแล้ว`);
  } else {
    store.saveCurrentPresetAs(name);
    showToast(`เปลี่ยนชื่อชุดคำตอบเป็น "${name}" เรียบร้อยแล้ว`);
  }
  presetNameForm.hidden = true;
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
  showToast('ดาวน์โหลดไฟล์ Preset .JSON เรียบร้อยแล้ว');
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
    showToast('ไฟล์ JSON ไม่ถูกต้องหรือมีโครงสร้างไม่ปลอดภัย');
  } finally {
    inputImportJson.value = '';
  }
});

// Probability Mode Controls
btnModeIndependent.addEventListener('click', () => {
  store.setMode('independent');
});

btnModeHistory.addEventListener('click', () => {
  store.setMode(lastHistorySubMode);
});

btnSubModeBalance.addEventListener('click', () => {
  lastHistorySubMode = 'balance';
  store.setMode('balance');
});

btnSubModeMomentum.addEventListener('click', () => {
  lastHistorySubMode = 'momentum';
  store.setMode('momentum');
});

chkEliminateWinner.addEventListener('change', () => {
  store.setEliminateWinner(chkEliminateWinner.checked);
});

// Add Choice & Bulk Edit Controls
addChoiceForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const label = inputNewLabel.value.trim();
  const weight = Number(inputNewWeight.value) || 1;
  if (!label) return;
  if (store.addItem(label, weight)) {
    inputNewLabel.value = '';
    inputNewWeight.value = '1';
    inputNewLabel.focus();
  }
});

btnRestoreEliminated.addEventListener('click', () => {
  store.restoreEliminatedItems();
  showToast('นำตัวเลือกที่ถูกพักไว้กลับเข้าวงล้อทั้งหมดแล้ว');
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
  showToast('อัปเดตรายการคำตอบจากข้อความหลายบรรทัดเรียบร้อยแล้ว');
});

// 100,000-Spin Chi-Squared Fairness Audit
btnRunAudit.addEventListener('click', () => {
  const state = store.getState();
  const audit = runFairnessAudit(state.currentPreset.items, state.currentPreset.mode, 100000);
  if (audit.trials === 0) {
    showToast('ต้องมีตัวเลือกที่เปิดใช้งานอย่างน้อย 1 ข้อเพื่อรันการพิสูจน์');
    return;
  }

  auditResultPanel.hidden = false;
  auditStatusBadge.textContent = audit.passed
    ? '✓ PASS (แฟร์ตามทฤษฎีคณิตศาสตร์)'
    : '⚠ p-value ต่ำกว่าเกณฑ์ (ลองรันซ้ำเพื่อตรวจ)';
  auditStatusBadge.className = `audit-metric__value ${audit.passed ? 'audit-pass' : ''}`;
  auditChiSquareVal.textContent = `${audit.chiSquare.toFixed(3)} (df=${audit.degreesOfFreedom})`;
  auditPValueVal.textContent = audit.pValue.toFixed(4);
  auditErrorTimeVal.textContent = `±${audit.maxRelativeErrorPct.toFixed(2)}% · ${audit.durationMs}ms`;

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

// Initialize app
checkUrlHashForSharedPreset();
syncAll(store.getState());
