# FAIR WHEEL — Provably Fair Cryptographic Decision Wheel

เว็บแอปพลิเคชันวงล้อสุ่มคำตอบตามหลักคณิตศาสตร์และวิทยาการเข้ารหัสลับ (Cryptographically Fair) สำหรับโฮสต์บน **GitHub Pages** ออกแบบในสไตล์ **Neo-Brutalist Swiss Editorial (Orthographic 3D Wheel & Mobile-First)** ปราศจากอคติทางสถิติ (Zero Modulo Bias & Zero Frame-Rate Coupling Bias)

---

## จุดเด่นทางคณิตศาสตร์และวิศวกรรม

1. **Cryptographically Fair Randomness ($\text{TVD} = 0$)**:
   - ใช้ `crypto.getRandomValues()` (W3C Web Crypto API / OS CSPRNG ตามมาตรฐาน NIST SP 800-90A)
   - ใช้ **Exact Rejection Sampling (Lemire 2019)** ร่วมกับ **Prefix-Sum Binary Search** บนจำนวนเต็มสเกลละเอียด 10,000 เท่า ป้องกันทั้ง Modulo Bias และความคลาดเคลื่อนทศนิยม IEEE-754
   - **Outcome-First Decoupled Animation**: ตัดสินผู้ชนะด้วย CSPRNG ก่อนเริ่มหมุน แล้วคำนวณสมการเคลื่อนที่ด้วยฟังก์ชันเวลาจริง `performance.now()` แบบ $C^2$ Quartic Ease-Out ($E(\tau) = 1 - (1-\tau)^4$) ไม่ว่าจอจะ 30Hz, 60Hz, 144Hz หรือสลับแท็บ ผลลัพธ์จะไม่เพี้ยนแม้แต่บิตเดียว

2. **3 โหมดคณิตศาสตร์การสุ่ม (พร้อมคำอธิบายเข้าใจง่ายบนหน้าเว็บ)**:
   - **🎲 ไม่สนสถิติรอบก่อน (Independent / อิสระทุกรอบ)**: เหมือนโยนลูกเต๋าใหม่ทุกรอบ $W_i^{\text{eff}} = W_i$
   - **⚖️ ใช้สถิติรอบก่อน — A. เกลี่ยให้ทั่วถึง (ลดโอกาสซ้ำ / Balance Mode)**: ข้อที่เพิ่งออกไปแล้ว โอกาสรอบหน้าจะลดลงตามสูตร $W_i^{\text{eff}} \propto \frac{W_i}{1 + c_i}$ เพื่อเปิดทางให้ข้อที่ยังไม่ออก
   - **🔥 ใช้สถิติรอบก่อน — B. ยิ่งออกยิ่งมาแรง (เพิ่มโอกาสซ้ำ / Momentum Mode)**: ตามทฤษฎี **Pólya Urn** ข้อที่เคยชนะจะได้แต้มต่อน้ำหนักเพิ่มขึ้น $W_i^{\text{eff}} = W_i \cdot (1 + c_i)$

3. **Performance & Security**:
   - **OffscreenCanvas $O(1)$ Frame Blit**: วาดแผ่นวงล้อและตัวอักษรลงแคชครั้งเดียวตอนข้อมูลเปลี่ยน ในลูป `requestAnimationFrame` ใช้การหมุนภาพระดับ GPU พร้อมจำลองฟิสิกส์สปริงที่เข็มชี้และเสียงกลไกผ่าน **Web Audio API Synthesizer** (ไม่ต้องโหลดไฟล์เสียงภายนอก)
   - **Cycle-Graph ($C_N$) Coloring**: สีช่องวงล้อที่อยู่ติดกันจะไม่ชนกันแม้จำนวนตัวเลือกเป็นเลขคี่ ($N=3, 5, 7\dots$)
   - **Grapheme-Safe Thai & Emoji**: ตัดคำภาษาไทยด้วย `Intl.Segmenter` ไม่ให้สระลอยหรือวรรณยุกต์ขาด
   - **Strict XSS & Prototype Pollution Guard**: ไม่ใช้ `innerHTML` เลยแม้แต่จุดเดียว และตรวจสอบ JSON Schema ทุกครั้งที่โหลด Preset หรือเปิดจาก URL

---

## วิธีรันทดสอบและใช้งานในเครื่อง (Local Development)

1. **รันชุดทดสอบความแฟร์ทางสถิติ ($\chi^2$ 100,000 ครั้ง) และความปลอดภัย**:
   ```bash
   node --test tests/*.test.js
   ```

2. **เปิดใช้งานเว็บในเครื่อง**:
   เนื่องจากใช้ ES Modules (`<script type="module">`) ให้รันผ่าน Static Server ตัวใดก็ได้ เช่น:
   ```bash
   npx serve .
   # หรือใช้ Python:
   python -m http.server 8080
   ```
   จากนั้นเปิดเบราว์เซอร์ไปที่ `http://localhost:8080` (หรือพอร์ตที่แสดง)

---

## วิธีนำขึ้น GitHub Pages

1. สร้าง Repository บน GitHub แล้ว Push โค้ดทั้งหมดขึ้นกิ่ง `main`:
   ```bash
   git init
   git add .
   git commit -m "feat: initial release of provably fair web wheel"
   git branch -M main
   git remote add origin https://github.com/<your-username>/<your-repo>.git
   git push -u origin main
   ```
2. ไปที่หน้า GitHub Repository -> **Settings** -> **Pages** -> หัวข้อ **Build and deployment (Source)** เลือกเป็น **GitHub Actions**
3. ไฟล์ [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) จะรัน `node --test` เพื่อพิสูจน์ความแฟร์ทางคณิตศาสตร์ก่อนทุกครั้ง แล้ว Deploy ขึ้น GitHub Pages ให้อัตโนมัติ

---

## โครงสร้างเอกสาร (Docs Map)
- [`AGENTS.md`](AGENTS.md) — กฎเหล็กและโครงสร้างสำหรับ AI Agent / นักพัฒนา
- [`docs/research/mathematical-fairness.md`](docs/research/mathematical-fairness.md) — งานวิจัยและสมการคณิตศาสตร์ฉบับเต็ม
- [`docs/architecture/system-spec.md`](docs/architecture/system-spec.md) — สถาปัตยกรรมระบบ, Security, Memory, และตาราง Edge Cases
