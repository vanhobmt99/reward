# Kế Hoạch Review & Cải Tiến — Search Auto (bingreward)

> Ngày review: 2026-07-10 · Phạm vi: toàn bộ `js/`, `tests/`, cấu trúc repo
> Kết luận nhanh: **Logic chạy đúng, kiến trúc đã module hóa tốt. Điểm nghẽn là `service.js` 4150 dòng + lưới test chưa bảo vệ được phần lõi.**

---

## 0. Trạng thái thực hiện (đã làm — cập nhật 2026-07-10)

Test: **245 → 325 pass** (18 suite, ~4s). `service.js`: **4150 → 3083 dòng (−26%)**. `check_syntax` chạy tự động trước mỗi `npm test`.

| Việc                                  | Trạng thái  | Kết quả                                                                                                                                                                          |
| ------------------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **GĐ1** — Trích hàm thuần + test thật | ✅ Xong     | 4 module mới: `rewards-metrics.js`, `activity-memory.js`, `search-plan.js`, `daily-counters.js` + `check_syntax` vào `pretest`                                                   |
| **GĐ4** — Dọn popup, bug nhỏ, repo    | ✅ Xong     | Gộp handler trùng, `SEARCH_MODE_PRESETS`/hằng số 1 chỗ, sửa `loggedIn`/log-object/`resetDevice`-trong-render/guard nút download-delete/`percent()`, `.gitignore` zip+thư mục rác |
| **GĐ3** — Ổn định message             | ✅ Xong     | `messages.js` (enum ACTIONS), `sendMessageWithTimeout`, hiện `message` khi lỗi, `SELECTORS` gom trong `content.js`                                                               |
| **GĐ2** — Tách `service.js`           | 🟡 Một phần | ✅ `injected-scripts.js` (−786 dòng), ✅ `cookies.js` factory. ⏸️ **CDP layer hoãn có chủ đích** (xem dưới)                                                                      |
| **GĐ5** — Chốt chất lượng             | 🟡 Một phần | ✅ test `devices.js`, ✅ test `utils.set/get/resetRuntime`+write-lock. ⏸️ Ngưỡng coverage **không khả thi** (xem dưới)                                                           |

**Hai việc hoãn — có lý do, không phải bỏ sót:**

- **Tách CDP/debugger (`attach/detach/simulate/click/ensureEmulation`) sang `js/cdp.js`:** nhóm hàm này bám chặt `chrome.debugger` + state runtime, **chưa có test hành vi**, và là phần khiến mobile points chạy. Tách lúc này chỉ để giảm dòng = đánh đổi rủi ro hồi quy thật lấy lợi ích hình thức, đi ngược nguyên tắc "test trước, refactor sau" của chính plan. **Chỉ nên làm sau khi có harness test cho CDP**, hoặc làm khi test tay với extension đã load.
- **Ngưỡng coverage số (5.1):** kiến trúc test cố ý dùng `vm` + đọc source (vì `import "/js/x.js"` path kiểu extension không resolve trong Node), nên jest báo 0% — không instrument được. Đặt ngưỡng >0 sẽ vỡ CI. Muốn coverage thật phải thêm Babel/ESM transform = task hạ tầng riêng.

**Module & test mới thêm:** `js/rewards-metrics.js`, `js/activity-memory.js`, `js/search-plan.js`, `js/daily-counters.js`, `js/messages.js`, `js/injected-scripts.js`, `js/cookies.js` · test: `rewardsMetrics`, `activityMemory`, `searchPlan`, `dailyCounters`, `messages`, `injectedScripts`, `devices`, `utilsStorage` + helper `tests/esm-loader.js`.

> ⚠️ Chưa test tay trên trình duyệt. Trước khi dùng nhiều acc: reload extension trong `chrome://extensions` rồi chạy thử **1 acc** để xác nhận search + mobile + activity vẫn chạy (các thay đổi message/selector/popup cần mắt người xác nhận, test tự động không phủ được phần UI/CDP).

Phần bên dưới là kế hoạch gốc để tham chiếu.

---

## 1. Đánh giá tổng quan — code chạy logic OK chưa?

**OK, về cơ bản logic đúng và an toàn hơn nhiều so với script tự động thông thường.** Cụ thể:

| Hạng mục                     | Trạng thái                       | Ghi chú                                       |
| ---------------------------- | -------------------------------- | --------------------------------------------- |
| Syntax check                 | ✅ Pass 23 files                 | `node tests/check_syntax.js`                  |
| Test suite                   | ✅ 245/245 pass (10 suites, ~3s) | `npm test`                                    |
| Kiến trúc                    | ✅ Tốt                           | Đã tách module + Dependency Injection         |
| Điều phối chạy               | ✅ Chắc                          | `run-coordinator.js` chống chạy trùng session |
| Ghi config đồng thời         | ✅ Có xử lý                      | Write-lock + `atomicUpdate` trong `utils.js`  |
| Luồng search/mobile/activity | ✅ Có test hành vi               | `search-phases.js` test kỹ cả nhánh lỗi       |

**Những chỗ làm rất tốt (giữ nguyên, không đụng):**

- `run-coordinator.js` — quản lý session tập trung, có `canStartNewRun / forceStop / getStatus`.
- `search-phases.js` — tách 3 giai đoạn (search → post-search → cleanup) qua DI, dễ test, có backoff khi lỗi.
- `utils.js` — write-lock chống race giữa popup và service worker (cross-context lock qua `chrome.storage`).
- `config-defaults.js` — một nguồn config duy nhất, chống drift.
- Cơ chế `_runGeneration` trong `delay()`/`wait()` — không giết nhầm delay của run mới.
- Backup/restore cookie Rewards trước/sau khi clear cho mobile points — logic tinh tế, có test thật.

**=> Có thể tiếp tục dùng. Các cải tiến bên dưới là để DỄ QUẢN LÝ & AN TOÀN KHI SỬA, không phải vì code đang hỏng.**

---

## 2. Vấn đề phát hiện (xếp theo mức ưu tiên)

### 🔴 P0 — Ảnh hưởng khả năng bảo trì lâu dài

**P0-1. `service.js` quá lớn (4150 dòng) — điểm nghẽn số một.**

- Chứa mọi thứ: cookie, config, session, debugger/CDP, search, activity, alarm, message router.
- Riêng ~830 dòng là **JavaScript viết dưới dạng chuỗi** để inject (`Runtime.evaluate`):
  - `solveScript` (dòng ~2285–2428)
  - `createDashboardActivityScript()` (dòng 2429–2752)
  - `createEarnActivityScript()` (dòng 2753–3116)
- Hệ quả: không có syntax highlight/lint cho phần quan trọng nhất, dễ sai khi sửa, `tests/helpers.js` phải **chép lại** logic này (xem P0-2).

**P0-2. Lưới test KHÔNG bảo vệ phần lõi `service.js`.**

- 245 test xanh, nhưng phần lớn test cho `service.js` chỉ là `expect(serviceSource).toContain('chuỗi...')` — **so khớp văn bản, không chạy code**. Đổi tên biến/format lại là fail; logic sai vẫn pass miễn chuỗi còn đó.
- `tests/helpers.js` **chép lại** thuật toán solve/scoring rồi test bản chép → code thật có thể phân kỳ mà test vẫn xanh (chính file ghi chú "must stay in sync with service.js").
- Các hàm lõi **hoàn toàn không được thực thi trong test**: `search`, `simulate`, `activity`, `click`, `query`, `perform`, `attach/detach`, `initialise`, `fetchRewardsSnapshot`.
- **=> Refactor `service.js` bây giờ là mạo hiểm vì không có lưới an toàn thật.** Đây là lý do P1 (tách module) phải đi kèm P0 (viết test thật).

### 🟠 P1 — Nên làm để dễ quản lý

**P1-1. Thiếu timeout cho `chrome.runtime.sendMessage` ở popup & content.**

- MV3 service worker hay ngủ; lần gửi đầu có thể fail hoặc treo vô hạn → nút kẹt ở "Starting.../Stopping...".
- Chỉ được cứu nhờ `finally` nếu _throw_, còn _treo_ thì không.

**P1-2. Lỗi âm thầm — `{success:false, message}` không bao giờ hiện `message` cho người dùng.**

- `popup.js` chỉ hiện "Failed!" mà nuốt mất `message` → khó chẩn đoán khi 1 acc lỗi.

**P1-3. Action strings rải rác dạng chuỗi tự do** (`"start"/"stop"/"schedule"/"activity"/"clearBrowsingData"/"simulate"/"query"/"perform"/"login"/"ping"/"closePopups"/"checkRewardsSession"`).

- Không có enum/hằng số dùng chung giữa popup ↔ content ↔ service → gõ sai không bị bắt lỗi, khó refactor.

**P1-4. Trùng lặp code lớn ở `popup.js`.**

- `modeMap` định nghĩa 3 lần (dòng 76-81, 463-468, và hardcode trong `compare`).
- Handler `$searchTrigger` vs `$scheduleTrigger` (522-591) gần như copy-paste, chỉ khác `action`.
- `persistSearchForm`/`persistScheduleForm` và 4 cặp handler min/max là copy-paste.

**P1-5. Selector Bing hardcode rải khắp `content.js`** (`#mHamburger`, `#HBSignIn`, `#sb_form_q`, `.b_clickarea`, `.dashboardPopUpPopUpCloseButton`...).

- Bing đổi DOM là hỏng, mà lại nằm rải rác không tập trung 1 nơi.

### 🟡 P2 — Sạch sẽ & tiện dùng

**P2-1. Vệ sinh repo:**

- `bingreward.zip` (9.1 MB) đang nằm trong repo và **không có trong `.gitignore`** → sẽ bị commit, phình repo.
- Thư mục lạ `agent-tools/` (192K) và `terminals/` (12K) trông như rác công cụ, nên xóa hoặc gitignore.

**P2-2. Bug nhỏ logic:**

- `content.js` — field `loggedIn` **luôn `false`** ở mọi nhánh (dòng 25-40), kể cả khi đã đăng nhập → vô nghĩa/gây hiểu nhầm.
- `popup.js` `$activity` log `${response}` với object → in ra `"[object Object]"` (dòng ~643).
- `popup.js` `updateUI()` gọi `resetDevice()` (ghi storage) _trong lúc render_ → side-effect + nguy cơ vòng cập nhật (dòng 183-187).
- `popup.js` nút `$download`/`$delete` không có guard disable → bấm liên tục chạy chồng nhiều lượt quét 10.000 entries.
- `popup.js` nhãn "Delete search history (24h)" nhưng `chrome.history.deleteUrl` xóa **toàn bộ** lịch sử của URL đó, không giới hạn 24h → dễ hiểu nhầm.

**P2-3. Magic numbers rải rác** cả popup lẫn content (debounce 80, deadline 15000, `1.5`, `pageSize=1000`, `maxEntries=10000`, `slice(0,500)`, delay 50/100/1000...). Nên gom thành hằng số đặt tên.

**P2-4. `check_syntax.js` không chạy trong `npm test`** (không khớp `*.test.js`) → dễ quên chạy.

---

## 3. Kế hoạch hành động (theo giai đoạn)

> Nguyên tắc: **viết test thật TRƯỚC khi tách/refactor**, dùng `search-phases.js` làm khuôn mẫu (DI + mock `chrome.*`).

### Giai đoạn 1 — Lưới an toàn (nền tảng cho mọi refactor sau) · ~1–2 buổi

- [ ] **1.1** Trích các hàm THUẦN từ `service.js` sang module mới `js/search-plan.js` và viết test hành vi:
      `normalizeSearchPlan`, `limitSearchPlanForToday`, `chooseSearchTemplate`, `resetSearchQueryHistory`.
- [ ] **1.2** Trích logic điểm/counter sang `js/rewards-metrics.js` + test:
      `getScoreDelta`, `sumCounterProgress`, `getCounterValue`, `findFirstNumberByKey`.
- [ ] **1.3** Trích logic activity-memory sang `js/activity-memory.js` + test:
      `getBlockedActivityKeys`, `recordActivityAttempts`, `confirmActivityKeys`, `markUnconfirmedActivityKeys`.
- [ ] **1.4** Thay dần các test `serviceSource.toContain(...)` bằng test thực thi cho:
      `applyStoredConfig`, `clearActiveRuntimeState`, `resetStaleSearchCounters`, `hasFreshSearchCounters`, `tryStartScheduledRun`.
- [ ] **1.5** Đưa `check_syntax.js` vào pipeline (thêm script `pretest` trong `package.json`).

### Giai đoạn 2 — Tách nhỏ `service.js` · ~2–3 buổi (làm SAU khi có test GĐ1)

- [ ] **2.1** Tách 3 script inject ra file riêng `js/injected/` (dashboard, earn, solve). Mỗi file là 1 hàm sinh chuỗi, có test snapshot đầu ra. Cho `service.js` **và** `tests/helpers.js` import CHUNG một nguồn → xóa nguy cơ phân kỳ (P0-2).
- [ ] **2.2** Tách lớp CDP/debugger (`attach`, `detach`, `simulate`, `ensureEmulation`, `enableDomains`, `click`, `isDebuggerAttached`) sang `js/cdp.js`.
- [ ] **2.3** Tách lớp cookie (`backupAuthCookies`, `restoreAuthCookies`, ...) sang `js/cookies.js` (đã có test, chỉ cần dời).
- [ ] **2.4** `service.js` chỉ còn là **orchestrator + message router** (mục tiêu < 800 dòng).

### Giai đoạn 3 — Ổn định giao tiếp message · ~1 buổi

- [ ] **3.1** Tạo `js/messages.js` — enum hằng số action dùng chung cả 3 phía (P1-3).
- [ ] **3.2** Viết `sendMessageWithTimeout(msg, ms)` bọc `chrome.runtime.sendMessage` (P1-1); áp dụng cho mọi handler popup.
- [ ] **3.3** Hiển thị `message` khi `success:false` trong `flashStatus` (P1-2).
- [ ] **3.4** Gom mọi selector Bing của `content.js` vào 1 object `SELECTORS` ở đầu file (P1-5).

### Giai đoạn 4 — Dọn dẹp popup & repo · ~0.5 buổi

- [ ] **4.1** Gộp `$searchTrigger`/`$scheduleTrigger` và các cặp min/max thành hàm chung có tham số `mode` (P1-4).
- [ ] **4.2** Định nghĩa `modeMap` MỘT lần, export dùng chung (P1-4).
- [ ] **4.3** Sửa các bug nhỏ P2-2 (bỏ field `loggedIn` vô nghĩa, log object bằng `JSON.stringify`, không ghi storage trong render, disable nút download/delete khi đang chạy, sửa nhãn history cho đúng nghĩa).
- [ ] **4.4** Vệ sinh repo: thêm `bingreward.zip`, `agent-tools/`, `terminals/` vào `.gitignore` (hoặc xóa hẳn nếu là rác) (P2-1).
- [ ] **4.5** Gom magic numbers thành hằng số đặt tên (P2-3).

### Giai đoạn 5 — Chốt chất lượng · liên tục

- [ ] **5.1** Bật `coverage threshold` trong Jest cho các module không phải `service.js` (VD statements 55%).
- [ ] **5.2** Thêm test cho `devices.js` (validate cấu trúc UA/profile — rẻ, bắt lỗi dữ liệu).
- [ ] **5.3** Thêm test cho `utils.set/get/resetRuntime` + write-lock với mock `chrome.storage`.

---

## 4. Thứ tự đề xuất bắt tay

1. **Giai đoạn 1 trước tiên** — không tách gì cả, chỉ _bổ sung_ test cho code hiện có (an toàn 100%, không đổi hành vi). Đây là điều kiện tiên quyết.
2. Sau đó **Giai đoạn 3 + 4** (cải thiện rõ rệt trải nghiệm dùng & dễ đọc, rủi ro thấp).
3. Cuối cùng **Giai đoạn 2** (tách `service.js`) khi đã có lưới test đỡ lưng.

> Mỗi hạng mục nên là 1 commit nhỏ, chạy `npm test` + `node tests/check_syntax.js` trước khi reload extension và thử 1 acc.

---

## 5. Ước lượng tác động

| Giai đoạn           | Rủi ro               | Lợi ích                           | Công sức |
| ------------------- | -------------------- | --------------------------------- | -------- |
| 1 — Test thật       | Rất thấp             | Nền tảng an toàn cho mọi việc sau | 1–2 buổi |
| 2 — Tách service.js | Trung bình (cần GĐ1) | Dễ đọc/sửa nhất                   | 2–3 buổi |
| 3 — Message ổn định | Thấp                 | Ít lỗi treo/âm thầm               | 1 buổi   |
| 4 — Dọn popup/repo  | Thấp                 | Dễ đọc, repo gọn                  | 0.5 buổi |
| 5 — Chốt chất lượng | Rất thấp             | CI cảnh báo sớm                   | Liên tục |
