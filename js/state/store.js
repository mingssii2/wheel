/**
 * Application State Store & Preset Persistence Manager
 * Handles Presets (localStorage + Built-in Starters), Active Choices, Spin Modes, and History Log.
 */

import {
  sanitizePreset,
  sanitizeItem,
  generateSafeId,
  truncateGraphemes,
  MAX_ITEMS,
  MAX_PRESET_NAME_GRAPHEMES
} from './serializer.js';

const STORAGE_KEY = 'fair_wheel_state_v1';

export const STARTER_PRESETS = [
  {
    id: 'preset_lunch_th',
    name: 'มื้อนี้กินอะไรดี 🍜',
    mode: 'balance',
    eliminateWinner: false,
    items: [
      { id: 'l1', label: 'กะเพราหมูกรอบไข่ดาว', weight: 2, wins: 0, eliminated: false },
      { id: 'l2', label: 'ส้มตำไก่ย่าง + ข้าวเหนียว', weight: 1, wins: 0, eliminated: false },
      { id: 'l3', label: 'ก๋วยเตี๋ยวเรือน้ำตก', weight: 1, wins: 0, eliminated: false },
      { id: 'l4', label: 'ข้าวมันไก่ต้มผสมทอด', weight: 1, wins: 0, eliminated: false },
      { id: 'l5', label: 'ชาบู / ปิ้งย่าง', weight: 1, wins: 0, eliminated: false },
      { id: 'l6', label: 'ข้าวผัดปู', weight: 1, wins: 0, eliminated: false }
    ]
  },
  {
    id: 'preset_team_standup',
    name: 'สุ่มคนเริ่มประชุม 🎯',
    mode: 'independent',
    eliminateWinner: true,
    items: [
      { id: 't1', label: 'ทีม Product', weight: 1, wins: 0, eliminated: false },
      { id: 't2', label: 'ทีม Frontend', weight: 1, wins: 0, eliminated: false },
      { id: 't3', label: 'ทีม Backend', weight: 1, wins: 0, eliminated: false },
      { id: 't4', label: 'ทีม QA / Security', weight: 1, wins: 0, eliminated: false },
      { id: 't5', label: 'ทีม Data / AI', weight: 1, wins: 0, eliminated: false }
    ]
  },
  {
    id: 'preset_yes_no',
    name: 'ตัดสินใจด่วน (ใช่ / ไม่ใช่) ⚡',
    mode: 'independent',
    eliminateWinner: false,
    items: [
      { id: 'y1', label: 'ลุยเลย! (YES)', weight: 2, wins: 0, eliminated: false },
      { id: 'y2', label: 'พักก่อน (NO)', weight: 2, wins: 0, eliminated: false },
      { id: 'y3', label: 'ถามเพื่อนอีกคน', weight: 1, wins: 0, eliminated: false },
      { id: 'y4', label: 'สุ่มใหม่อีกรอบ', weight: 1, wins: 0, eliminated: false }
    ]
  }
];

/**
 * Explanations for the 3 Probability Modes in clear, everyday Thai.
 */
export const MODE_DESCRIPTIONS = {
  independent: {
    title: 'ไม่สนสถิติรอบก่อน (Independent / อิสระทุกรอบ)',
    badge: 'แฟร์แบบโยนลูกเต๋าใหม่ทุกรอบ',
    summary: 'รอบที่แล้วออกอะไร ไม่มีผลกับรอบถัดไป โอกาสออกของแต่ละข้อคำนวณจาก Weight ตั้งต้นล้วนๆ 100%',
    formulaText: 'W_eff = Weight ตั้งต้น'
  },
  balance: {
    title: 'ใช้สถิติรอบก่อน: เกลี่ยให้ทั่วถึง (ลดโอกาสซ้ำ)',
    badge: 'อันไหนออกแล้ว รอบหน้าช่องจะเล็กลง',
    summary: 'ข้อที่เพิ่งชนะไปจะถูกลดโอกาสออกลงอัตโนมัติตามจำนวนครั้งที่ชนะ เพื่อให้ข้ออื่นที่ยังไม่ออกมีโอกาสถูกสุ่มมากขึ้น',
    formulaText: 'W_eff = Weight ÷ (1 + จำนวนครั้งที่ชนะ)'
  },
  momentum: {
    title: 'ใช้สถิติรอบก่อน: ยิ่งออกยิ่งมาแรง (เพิ่มโอกาสซ้ำ)',
    badge: 'อันไหนชนะบ่อย ช่องยิ่งขยายใหญ่ขึ้น (Pólya Urn)',
    summary: 'ทุกครั้งที่ข้อไหนชนะ น้ำหนักของข้อนั้นจะเพิ่มขึ้นในรอบถัดไปเหมือนก้อนหิมะที่กลิ้งใหญ่ขึ้นเรื่อยๆ',
    formulaText: 'W_eff = Weight × (1 + จำนวนครั้งที่ชนะ)'
  }
};

export function createStore() {
  let storageAvailable = true;
  let presets = structuredClone(STARTER_PRESETS);
  let activePresetId = presets[0].id;
  let currentPreset = structuredClone(presets[0]);
  let history = [];
  let soundEnabled = true;
  const listeners = new Set();

  function loadFromStorage() {
    try {
      if (typeof localStorage === 'undefined') {
        storageAvailable = false;
        return;
      }
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;

      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed.presets) && parsed.presets.length > 0) {
        const validPresets = [];
        for (const p of parsed.presets.slice(0, 50)) {
          try {
            validPresets.push(sanitizePreset(p));
          } catch {
            // Skip corrupted preset entry
          }
        }
        if (validPresets.length > 0) {
          presets = validPresets;
        }
      }

      if (parsed.currentPreset) {
        try {
          currentPreset = sanitizePreset(parsed.currentPreset);
          activePresetId = currentPreset.id;
        } catch {
          currentPreset = structuredClone(presets[0]);
          activePresetId = currentPreset.id;
        }
      } else {
        currentPreset = structuredClone(presets[0]);
        activePresetId = currentPreset.id;
      }

      if (typeof parsed.soundEnabled === 'boolean') {
        soundEnabled = parsed.soundEnabled;
      }

      if (Array.isArray(parsed.history)) {
        history = parsed.history.slice(0, 100).filter((h) => h && typeof h.label === 'string');
      }
    } catch {
      storageAvailable = false;
    }
  }

  function saveToStorage() {
    try {
      if (typeof localStorage === 'undefined') return;
      const idx = presets.findIndex((p) => p.id === currentPreset.id);
      if (idx >= 0) {
        presets[idx] = structuredClone(currentPreset);
      }
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          presets,
          currentPreset,
          soundEnabled,
          history: history.slice(0, 100)
        })
      );
      storageAvailable = true;
    } catch {
      storageAvailable = false;
    }
  }

  function notify() {
    saveToStorage();
    for (const fn of listeners) {
      fn(getState());
    }
  }

  function getState() {
    return {
      presets,
      activePresetId,
      currentPreset,
      history,
      soundEnabled,
      storageAvailable
    };
  }

  loadFromStorage();

  return {
    getState,
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },

    setMode(mode) {
      if (mode === 'independent' || mode === 'balance' || mode === 'momentum') {
        currentPreset.mode = mode;
        notify();
      }
    },

    setEliminateWinner(enabled) {
      currentPreset.eliminateWinner = Boolean(enabled);
      notify();
    },

    setSoundEnabled(enabled) {
      soundEnabled = Boolean(enabled);
      notify();
    },

    addItem(label, weight = 1) {
      if (currentPreset.items.length >= MAX_ITEMS) return false;
      const item = sanitizeItem({ label, weight, wins: 0, eliminated: false }, currentPreset.items.length);
      if (!item) return false;
      currentPreset.items.push(item);
      notify();
      return true;
    },

    updateItem(id, patch) {
      const item = currentPreset.items.find((entry) => entry.id === id);
      if (!item) return;

      if (patch.label !== undefined) {
        const cleanLabel = truncateGraphemes(patch.label, 120);
        if (cleanLabel) {
          item.label = cleanLabel;
        }
      }
      if (patch.weight !== undefined) {
        const w = Number(patch.weight);
        if (Number.isFinite(w) && w > 0) {
          item.weight = Math.round(Math.min(Math.max(w, 0.01), 10000) * 100) / 100;
        }
      }
      if (patch.eliminated !== undefined) {
        item.eliminated = Boolean(patch.eliminated);
      }
      if (patch.wins !== undefined) {
        const wins = Number(patch.wins);
        if (Number.isFinite(wins) && wins >= 0) {
          item.wins = Math.floor(wins);
        }
      }
      notify();
    },

    removeItem(id) {
      if (currentPreset.items.length <= 1) {
        currentPreset.items = [];
      } else {
        currentPreset.items = currentPreset.items.filter((entry) => entry.id !== id);
      }
      notify();
    },

    replaceItemsFromBulkText(text) {
      const lines = String(text ?? '')
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .slice(0, MAX_ITEMS);

      const newItems = [];
      for (let i = 0; i < lines.length; i++) {
        // Optional syntax: "คำตอบ | 3" or "คำตอบ : 3" to set weight in bulk mode
        const match = lines[i].match(/^(.*?)\s*[|:]\s*(\d+(?:\.\d+)?)$/);
        const rawLabel = match ? match[1] : lines[i];
        const rawWeight = match ? Number(match[2]) : 1;
        const clean = sanitizeItem({ label: rawLabel, weight: rawWeight }, i);
        if (clean) newItems.push(clean);
      }
      if (newItems.length > 0) {
        currentPreset.items = newItems;
        notify();
      }
    },

    recordWin(itemId, probabilityAtSpin) {
      const item = currentPreset.items.find((entry) => entry.id === itemId);
      if (!item) return;

      item.wins = (item.wins || 0) + 1;
      if (currentPreset.eliminateWinner) {
        item.eliminated = true;
      }

      history.unshift({
        id: generateSafeId(),
        itemId: item.id,
        label: item.label,
        mode: currentPreset.mode,
        probabilityPct: Math.round(probabilityAtSpin * 10000) / 100,
        winsAfter: item.wins,
        timestamp: new Date().toISOString()
      });

      if (history.length > 100) {
        history.length = 100;
      }
      notify();
    },

    resetSessionStats() {
      for (const item of currentPreset.items) {
        item.wins = 0;
        item.eliminated = false;
      }
      history = [];
      notify();
    },

    restoreEliminatedItems() {
      for (const item of currentPreset.items) {
        item.eliminated = false;
      }
      notify();
    },

    selectPreset(presetId) {
      const found = presets.find((p) => p.id === presetId);
      if (!found) return false;
      activePresetId = found.id;
      currentPreset = structuredClone(found);
      notify();
      return true;
    },

    saveCurrentPresetAs(name) {
      const cleanName = truncateGraphemes(name || currentPreset.name, MAX_PRESET_NAME_GRAPHEMES) || 'Preset ใหม่';
      currentPreset.name = cleanName;
      const existingIdx = presets.findIndex((p) => p.id === currentPreset.id);
      if (existingIdx >= 0) {
        presets[existingIdx] = structuredClone(currentPreset);
      } else {
        presets.push(structuredClone(currentPreset));
      }
      activePresetId = currentPreset.id;
      notify();
    },

    createNewPreset(name) {
      const cleanName = truncateGraphemes(name || `ชุดคำตอบ #${presets.length + 1}`, MAX_PRESET_NAME_GRAPHEMES);
      const newPreset = sanitizePreset({
        id: generateSafeId(),
        name: cleanName,
        mode: currentPreset.mode,
        eliminateWinner: currentPreset.eliminateWinner,
        items: currentPreset.items.map((item) => ({
          ...item,
          id: generateSafeId(),
          wins: 0,
          eliminated: false
        }))
      });
      presets.push(newPreset);
      activePresetId = newPreset.id;
      currentPreset = structuredClone(newPreset);
      notify();
      return newPreset;
    },

    deletePreset(presetId) {
      if (presets.length <= 1) return false;
      presets = presets.filter((p) => p.id !== presetId);
      if (activePresetId === presetId) {
        currentPreset = structuredClone(presets[0]);
        activePresetId = currentPreset.id;
      }
      notify();
      return true;
    },

    importValidatedPreset(rawPresetObject) {
      const clean = sanitizePreset(rawPresetObject);
      clean.id = generateSafeId();
      presets.push(clean);
      activePresetId = clean.id;
      currentPreset = structuredClone(clean);
      notify();
      return clean;
    }
  };
}
