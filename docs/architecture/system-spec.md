# System Architecture & Scoped Specification

## 1. Scope & Product Decisions (Locked from Grill Rounds 1 & 2)
- **Definition Mode**: Scoped Spec Before Build (committed to GitHub repository).
- **Visual Aesthetic (Design 3 — Orthographic Neo-Brutalist Swiss Editorial)**:
  - Warm gallery paper surface (`#FAF7F2`), crisp ink structural borders (`#141413`), tactile 3D architectural offset shadows (`4px–8px`), and high-contrast Bauhaus/Swiss OKLCH color palette.
  - **Orthographic Straight-On Wheel**: Front-facing circular wheel with a 3D extruded cylindrical shadow rim, perimeter metallic pegs, spring-loaded geometric clapper at 12 o'clock, and subtle interactive 3D tilt/drag-to-spin.
  - **Mobile-First Ergonomics**: Responsive split layout on desktop (Wheel left, Workbench right) that adapts on mobile into a single-screen-friendly vertical stack with touch-friendly controls (`>= 44px` tap targets) and swipe/drag-to-spin directly on the wheel.
- **Spin & Fairness Suite**:
  - **Per-Choice Weight & Probability Display**: Every active choice row displays its editable Base Weight ($w_i$), session win count ($c_i$), and live calculated Probability ($P(i)\%$), with wheel sector angles scaled proportionally ($\Delta\theta_i = 2\pi \cdot P(i)$).
  - **Probability Mode Toggle**:
    1. **Independent Mode (`ไม่สนสถิติรอบก่อน`)**: Memoryless I.I.D. sampling ($W_i^{\text{eff}} = W_i$).
    2. **History-Aware Mode (`คำนวณสถิติรอบก่อน`)**: Inverse-frequency adaptive balancing ($W_i^{\text{eff}} \propto \frac{W_i}{1 + c_i}$) that reduces the probability and sector width of previously won options.
  - **Eliminate Winner** toggle (temporarily disables winning slice by stable `id` without deleting it from the preset).
  - **Mid-Spin Skip-to-Result**: Pressing Spin again while spinning immediately settles at the predetermined CSPRNG target angle $\theta_{\text{target}}$.
  - **Spin History Log** with timestamps, winning slice, mode used, and exact probability $P(k^*)$ at the time of spin.
  - **100,000-Spin Monte Carlo Fairness Proof ($\chi^2$ Goodness-of-Fit)** executable directly in the UI.
- **Preset & Portability**:
  - `localStorage` persistence with automatic corruption recovery.
  - Shareable URL (`#preset=...` base64url-encoded compact JSON payload).
  - JSON File Import / Export with strict schema validation.
- **Tech Stack**:
  - **Vanilla HTML5 + CSS3 + Modern ES Modules (Zero runtime dependencies)**.
  - Native 2D Canvas + `OffscreenCanvas` with 3D extruded rim, specular highlights, and spring-physics clapper pointer.
  - Procedural Web Audio API mechanical peg-tick & winner sound synthesizer (with Mute toggle).
  - GitHub Pages static deployment + Node.js native test runner (`node --test`).

---

## 2. Module Architecture

```text
d:\Kukkik\Wheel\
├── index.html                  # Semantic HTML5 shell, strict CSP meta header, ARIA live regions
├── css/
│   └── styles.css              # Design tokens, tactile 3D surfaces, responsive layout, reduced-motion
├── js/
│   ├── main.js                 # App bootstrap, event wiring, keyboard shortcuts, state orchestration
│   ├── math/
│   │   ├── csprng.js           # Web Crypto API wrapper, Lemire/Rejection uniform & weighted sampler
│   │   └── chi-square.js       # 100,000-spin Monte Carlo simulator, χ² statistic, incomplete gamma p-value
│   ├── wheel/
│   │   ├── renderer.js         # High-DPI OffscreenCanvas 3D wheel cache, OKLCH graph coloring, peg physics
│   │   └── animator.js         # Time-parametric C² easing, boundary crossing detector, tab-switch resilience
│   ├── audio/
│   │   └── sound-engine.js     # Web Audio API synthesized mechanical peg tick & celebratory chord
│   └── state/
│       ├── store.js            # Immutable-style state, Preset CRUD, History log, Eliminate Winner
│       └── serializer.js       # Strict JSON schema validator, URL base64url codec, XSS/pollution guard
├── tests/
│   ├── math-fairness.test.js   # Statistical χ² test, modulo bias boundary test, weighted accuracy test
│   └── serializer.test.js      # Malformed JSON, prototype pollution, Unicode/Thai grapheme & URL codec tests
├── docs/
│   ├── research/
│   │   └── mathematical-fairness.md
│   └── architecture/
│       └── system-spec.md
├── AGENTS.md
└── README.md
```

---

## 3. Security Architecture

1. **DOM & Canvas XSS Prevention**:
   - No `innerHTML`, `outerHTML`, or `document.write` anywhere in the codebase.
   - Wheel labels are drawn exclusively via `CanvasRenderingContext2D.fillText()`.
   - UI lists, modals, and history items use `document.createElement()` and `.textContent`.
2. **Untrusted Data Deserialization (`serializer.js`)**:
   - JSON parsed from `localStorage`, imported `.json` files, or `#preset=` URL hashes passes through a strict allowlist validator:
     - Rejects objects containing `__proto__`, `constructor`, or `prototype` keys.
     - Enforces hard caps: max `500` items per preset, max `120` characters per label, weight clamped to $[1, 10000]$ integer range.
     - Strips control characters (`\u0000-\u001F`).
3. **Content Security Policy (CSP)**:
   - `<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'none'; object-src 'none'; base-uri 'self'; form-action 'none';">`

---

## 4. Performance, Memory & 3D Rendering Pipeline

1. **Two-Layer Rendering (`OffscreenCanvas` + Active Overlay)**:
   - **Static Wheel Bitmap Cache**: Drawn only when entries, weights, theme, or viewport dimensions change. Includes:
     - 3D metallic/wood outer bezel with radial/linear specular gradients.
     - OKLCH perceptually balanced slice wedges with subtle radial inner shadow.
     - Grapheme-safe (`Intl.Segmenter`) radially aligned typography.
     - Perimeter metallic divider pegs at every slice boundary.
   - **Per-Frame `requestAnimationFrame` Blit ($O(1)$)**:
     - Rotates and blits the cached wheel bitmap in a single GPU texture draw call.
     - Renders the dynamic 3D center hub specular highlight (stationary light source while wheel rotates underneath).
     - Simulates the **spring-damped clapper pointer** ($\ddot{\alpha} = -k \alpha - c \dot{\alpha}$) deflecting whenever a perimeter peg passes $12\text{ o'clock}$.
2. **Zero Garbage Collection in Animation Loop**:
   - Pre-allocates `const rngBuf = new Uint32Array(1)` at module load.
   - Frame loop mutates scalar primitives on a single state struct; zero per-frame object/array allocations.

---

## 5. Edge Cases & Mitigations

| # | Edge Case | Mitigation |
|---|---|---|
| 1 | **Odd Slice Count Color Clash ($N=3,5,7\dots$)** | Cycle-graph ($C_N$) greedy coloring ensures slice $N-1$ never shares a color with slice $0$ or $N-2$. |
| 2 | **Thai Combining Marks & Emojis (`ผู้`, `👨‍👩‍👧`)** | Truncate using `Intl.Segmenter('th', { granularity: 'grapheme' })` instead of `.slice()`. |
| 3 | **High Density ($N > 60$ slices)** | Auto-scales font down to $9\text{px}$; if angular span $< 4^\circ$, hides radial text and displays the currently pointed item live in the top **Pointer Telemetry Readout HUD**. |
| 4 | **$N = 0$ or $N = 1$ Active Slices** | $N=0$ disables spin button with clear empty-state prompt; $N=1$ spins smoothly and awards the sole active choice without division-by-zero. |
| 5 | **Duplicate Labels in Elimination Mode** | Each entry receives a unique `id` (`crypto.randomUUID()`). Elimination marks `item.eliminated = true` by `id`. |
| 6 | **Background Tab / Display Refresh Change** | Angle $\theta(t)$ is computed purely from `performance.now() - t_0`; pausing and resuming `rAF` lands on the exact predetermined angle. |
| 7 | **Rapid / Spam Spin Clicks** | Spin button transitions to locked/active state during spin (with optional instant-finish / skip-to-result action). |
| 8 | **Storage Quota / Private Browsing** | Wraps `localStorage` in `try/catch`; falls back to in-memory store with non-intrusive banner and URL/JSON export intact. |
| 9 | **AudioContext Autoplay Policy** | Initializes/resumes `AudioContext` synchronously inside the user's `pointerdown` / `keydown` spin gesture. |
| 10 | **Vestibular Sensitivity (`prefers-reduced-motion`)** | Detects OS reduced-motion setting or UI toggle to shorten high-speed rotation into a gentle 0.6s damped settle. |

---

## 6. Verification & Acceptance Criteria

1. **Automated Unit & Statistical Tests (`node --test`)**:
   - `math-fairness.test.js`: Verifies 100,000 uniform spins across prime/odd $N$ ($N=3, 7, 13, 17$) and weighted spins yield Pearson's $\chi^2$ $p\text{-value} \in (0.005, 0.995)$ and zero out-of-range indices.
   - `serializer.test.js`: Verifies URL round-trip encoding, Thai/Emoji preservation, prototype pollution rejection, and bounds clamping.
2. **Interactive Browser Gate**:
   - Keyboard navigation (`Space` to spin, `Tab` focus rings, `Esc` to close winner modal).
   - 100,000-spin in-app audit completes in $< 100\text{ms}$ and renders the $\chi^2$ distribution chart.
