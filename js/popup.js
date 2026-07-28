import "/js/jquery.js";
import { log, get, atomicUpdate, applyConfigDefaults } from "/js/utils.js";
import { devices } from "/js/devices.js";
import { createDefaultConfig } from "/js/config-defaults.js";
import { ACTIONS, MESSAGE_TIMEOUT_MS } from "/js/messages.js";
import { exportCrashLogText, clearCrashLog } from "/js/crash-logger.js";

/**
 * Send a message to the service worker but never hang forever if the worker is
 * asleep or drops the response. Rejects after MESSAGE_TIMEOUT_MS so callers'
 * catch blocks can flash a failure instead of leaving a button stuck.
 */
function sendMessageWithTimeout(message, timeoutMs = MESSAGE_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error(`No response from service worker after ${timeoutMs}ms`));
    }, timeoutMs);
    chrome.runtime.sendMessage(message).then(
      (response) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(response);
      },
      (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}
let config = createDefaultConfig();
let _uiUpdateTimer = null;
let _uiLocked = false;
let _toastTimer = null;
// Tracks whether we've already auto-revealed the Schedule panel for the current
// run, so progress-driven re-renders don't fight a user who manually collapsed
// it. Reset once the run ends.
let _scheduleAutoRevealed = false;

// How long a destructive button stays "armed" after the first click before it
// reverts to its idle label. A second click within this window performs the
// irreversible action.
const CONFIRM_WINDOW_MS = 3500;
const TOAST_MS = 2600;

/**
 * Show a single, centralized toast message. Replaces the old pattern of
 * flashing a reason only into a button's `title` (which required hovering the
 * right button within a 1s window to read). `type` is "info" | "success" |
 * "error".
 */
function showToast(message, type = "info") {
  if (!message) return;
  const $t = $("#toast");
  if (!$t.length) return;
  $t.removeClass("toast-error toast-success toast-info show")
    .addClass(`toast-${type}`)
    .text(message);
  // Force reflow so re-adding `.show` re-triggers the transition even when the
  // toast was already visible.
  void $t[0].offsetWidth;
  $t.addClass("show");
  if (_toastTimer) clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => $t.removeClass("show"), TOAST_MS);
}

/**
 * Wrap a click handler so the first click only ARMS the button (turns it red
 * and shows a confirm label); the real handler runs on a second click within
 * CONFIRM_WINDOW_MS. Guards irreversible actions (reset, delete, wipe) against
 * a single misclick. `runHandler` is invoked with the original `this`/args.
 */
function withConfirm(runHandler, confirmText = "Chắc chắn?") {
  return function (...args) {
    const $btn = $(this);
    if ($btn.prop("disabled")) return undefined;
    if ($btn.data("armed")) {
      clearTimeout($btn.data("armTimer"));
      $btn
        .removeData(["armed", "armTimer"])
        .removeClass("confirming")
        .text($btn.data("armText"));
      return runHandler.apply(this, args);
    }
    const orig = $btn.text();
    $btn
      .data("armText", orig)
      .data("armed", true)
      .addClass("confirming")
      .text(confirmText);
    const timer = setTimeout(() => {
      $btn
        .removeData(["armed", "armTimer"])
        .removeClass("confirming")
        .text(orig);
    }, CONFIRM_WINDOW_MS);
    $btn.data("armTimer", timer);
    return undefined;
  };
}

// Vietnamese labels for runtime.currentPhase (see service.js/search-phases.js).
// Unknown/empty phases fall back to the bare progress count in updateUI().
const PHASE_LABELS = {
  search: "Đang tìm trên máy tính…",
  mobile_pre_clear: "Đang dọn dữ liệu cho điện thoại…",
  mobile_simulation: "Đang giả lập điện thoại…",
  mobile_search: "Đang tìm trên điện thoại…",
  post_mobile: "Đang khôi phục đăng nhập…",
  post_search: "Đang dọn dẹp sau tìm kiếm…",
  activities: "Đang làm nhiệm vụ…",
};

// ── Tunables (were magic numbers scattered through the file) ──
const UI_UPDATE_DEBOUNCE_MS = 80;
const STATUS_FLASH_MS = 1000;
const STOP_WAIT_TIMEOUT_MS = 15000;
const STOP_WAIT_POLL_MS = 100;
// Desktop/Mobile count presets shared by the "mode" buttons and compare().
const SEARCH_MODE_PRESETS = {
  m1: { desk: 11, mob: 0 },
  m2: { desk: 21, mob: 11 },
  m3: { desk: 31, mob: 21 },
  m4: { desk: 51, mob: 31 },
};

function scheduleUIUpdate() {
  if (_uiLocked) return;
  if (_uiUpdateTimer) clearTimeout(_uiUpdateTimer);
  _uiUpdateTimer = setTimeout(async () => {
    _uiUpdateTimer = null;
    if (!_uiLocked) await updateUI();
  }, UI_UPDATE_DEBOUNCE_MS);
}
const limitsMap = {
  searchDesk: { min: 0, max: [100, 300] },
  searchMob: { min: 0, max: [100, 300] },
  searchMin: { min: 5, max: [45, 600] },
  searchMax: { min: 8, max: [90, 900] },
  scheduleDesk: { min: 0, max: [100, 300] },
  scheduleMob: { min: 0, max: [100, 300] },
  scheduleMin: { min: 5, max: [45, 600] },
  scheduleMax: { min: 8, max: [90, 900] },
};
const $searchDesk = $("#searchDesk");
const $searchMob = $("#searchMob");
const $searchMin = $("#searchMin");
const $searchMax = $("#searchMax");
const $searchMode = $("#searchMode");
const $searchModeA = $("#searchMode a");
const $searchTrigger = $("#searchTrigger");
const $scheduleDesk = $("#scheduleDesk");
const $scheduleMob = $("#scheduleMob");
const $scheduleMin = $("#scheduleMin");
const $scheduleMax = $("#scheduleMax");
const $scheduleMode = $("#scheduleMode");
const $scheduleModeA = $("#scheduleMode a");
const $scheduleTrigger = $("#scheduleTrigger");
const $scheduleTime = $("#scheduleTime");
const $scheduleTimeRow = $("#scheduleTimeRow");
const $scheduleTimeHint = $("#scheduleTimeHint");
const $version = $("#version");
const $userManual = $("#userManual");
const $deviceName = $("#deviceName");
const $resetDevice = $("#resetDevice");
const $clear = $("#clear");
const $preserveRewards = $("#preserveRewards");
const $log = $("#log");
const $niche = $("#niche");
const $activity = $("#activity");
const $act = $("#act");
const $clearBrowsingData = $("#clearBrowsingData");
const $simulate = $("#simulate");
const $download = $("#download");
const $delete = $("#delete");
const $downloadCrashLog = $("#downloadCrashLog");
const $clearCrashLog = $("#clearCrashLog");
const $runtime = $("#runtime");
const $reset = $("#reset");
const $progressBar = $(".progressBar");
const $progress = $(".progress:not(.act)");
const $failed = $(".failed");
function compare() {
  const logs = config?.control?.log;
  const desk = Number($searchDesk.val());
  const mob = Number($searchMob.val());
  $searchModeA.removeClass("active");
  let matchedMode = null;
  for (const [id, val] of Object.entries(SEARCH_MODE_PRESETS)) {
    if (desk === val.desk && mob === val.mob) {
      $searchMode.find(`a.${id}`).addClass("active");
      logs && log(`[COMPARE] - Search mode set to: ${id}`, "update");
      config.search.mode = id;
      matchedMode = id;
      break;
    }
  }
  if (!matchedMode) {
    config.search.mode = "custom";
    logs && log(`[COMPARE] - Search mode set to custom values.`, "update");
  }
}
async function saveConfigMutation(mutator) {
  const updated = await atomicUpdate((stored) => {
    const next = createDefaultConfig();
    applyConfigDefaults(next, stored);
    mutator(next);
    return next;
  });
  config = updated || config;
  return config;
}
async function resetDevice() {
  const logs = config?.control?.log;
  try {
    const randomDevice = devices[Math.floor(Math.random() * devices.length)];
    await saveConfigMutation((next) => {
      next.device.name = randomDevice.name;
      next.device.ua = randomDevice.userAgent;
      next.device.h = randomDevice.height;
      next.device.w = randomDevice.width;
      next.device.scale = randomDevice.deviceScaleFactor;
    });
    logs &&
      log(
        `[RESET] - Device reset to: ${JSON.stringify(config.device.name)}`,
        "success",
      );
    return true;
  } catch (error) {
    logs && log(`[RESET] - Error resetting device: ${error?.message}`, "error");
    return false;
  }
}
async function updateUI() {
  const storedConfig = await get();
  applyConfigDefaults(config, storedConfig);
  const logs = config?.control?.log;
  for (const [key, limits] of Object.entries(limitsMap)) {
    const $el = $(`#${key}`);
    $el.attr("min", limits.min);
    $el.attr("max", limits.max[1]);
  }
  $searchDesk.val(config.search.desk);
  $searchMob.val(config.search.mob);
  $searchMin.val(config.search.min);
  $searchMax.val(config.search.max);
  compare();
  $scheduleDesk.val(config.schedule.desk);
  $scheduleMob.val(config.schedule.mob);
  $scheduleMin.val(config.schedule.min);
  $scheduleMax.val(config.schedule.max);
  $scheduleModeA.removeClass("active");
  $scheduleMode.find(`.${config.schedule.mode}`).addClass("active");
  // The daily-time row only matters in m5 mode.
  const isDailyMode = config?.schedule?.mode === "m5";
  $scheduleTimeRow.prop("hidden", !isDailyMode);
  $scheduleTimeHint.prop("hidden", !isDailyMode);
  // Don't clobber the picker while the user is actively editing it.
  if (!$scheduleTime.is(":focus")) {
    $scheduleTime.val(config?.schedule?.time || "08:00");
  }
  if (isDailyMode) {
    // Show whether the daily alarm is actually armed and when it fires next —
    // otherwise "Đặt lịch" gives no lasting sign the schedule is on.
    try {
      const alarm = await chrome.alarms.get("schedule_daily");
      if (alarm?.scheduledTime) {
        const next = new Date(alarm.scheduledTime);
        const pad = (n) => String(n).padStart(2, "0");
        $scheduleTimeHint.text(
          `Đã đặt lịch — lần tới: ${pad(next.getHours())}:${pad(next.getMinutes())} ngày ${pad(next.getDate())}/${pad(next.getMonth() + 1)}`,
        );
      } else {
        $scheduleTimeHint.text(
          "Chưa đặt — bấm “Đặt lịch” để bật chạy hằng ngày",
        );
      }
    } catch {
      // chrome.alarms unavailable (e.g. test env) — keep the static hint.
    }
  }
  if (config?.runtime?.running) {
    $searchTrigger.text("Dừng").addClass("stopping");
    $scheduleTrigger.text("Dừng").addClass("stopping");
  } else {
    $searchTrigger.text("Làm nhiệm vụ").removeClass("stopping");
    $scheduleTrigger.text("Đặt lịch").removeClass("stopping");
  }
  const { total, done, failed } = config.runtime;
  const totalCount = Number(total) || 0;
  const doneCount = Number(done) || 0;
  const failedCount = Number(failed) || 0;
  const success = doneCount;
  // Guard division explicitly instead of relying on isFinite() to catch 0/0.
  const percent = (part) =>
    totalCount > 0 ? ((part / totalCount) * 100).toFixed(2) : "0.00";
  const performedPercent = percent(doneCount);
  const successPercent = percent(success);
  const failedPercent = percent(failedCount);
  const progressPercent = percent(success + failedCount);
  $progressBar
    .parent()
    .attr(
      "title",
      `Tổng: ${totalCount}, Đã làm: ${doneCount} (${performedPercent}%), Thành công: ${success} (${successPercent}%), Lỗi: ${failedCount} (${failedPercent}%) — Tiến độ: ${progressPercent}%`,
    );
  $progress.width(totalCount ? (success / totalCount) * 100 + "%" : "0%");
  $failed.width(totalCount ? (failedCount / totalCount) * 100 + "%" : "0%");
  // Display only — never write storage during a render pass. Picking an initial
  // device happens once at startup (see $(document).ready).
  $deviceName.text(config?.device?.name || "");
  $clear.prop("checked", config?.control?.clear);
  $preserveRewards.prop("checked", config?.control?.preserveRewards !== 0);
  $log.prop("checked", config?.control?.log);
  const storedNiche = config?.control?.niche || "random";
  const validNiches = $niche
    .find("option")
    .map((_, el) => $(el).val())
    .get();
  const resolvedNiche = validNiches.includes(storedNiche)
    ? storedNiche
    : "random";
  // Render is read-only — do NOT persist here. An unknown niche is harmless
  // (the service worker already falls back to a random category), so we just
  // display the fallback without writing storage during a render pass.
  if (resolvedNiche !== storedNiche) {
    logs &&
      log(
        `[CONTROL] - Unknown niche "${storedNiche}"; showing random as fallback.`,
        "warning",
      );
  }
  $niche.val(resolvedNiche);
  $act.prop("checked", config?.control?.act ? true : false);
  if (config.runtime.act) {
    $("#activity ~ .progressBar > .progress").addClass("running");
  } else {
    $("#activity ~ .progressBar > .progress").removeClass("running");
  }

  const isRunning = !!config?.runtime?.running;

  // Visible progress line — the same numbers that used to hide inside the
  // progress-bar tooltip (only readable on hover of a 4px strip).
  const $runStatus = $("#runStatus");
  // Human-readable label for the current runtime phase so the status line says
  // WHAT the run is doing ("Đang giả lập điện thoại…"), not just a bare count —
  // this is what makes a long mobile/activity phase not feel frozen.
  const phaseLabel = PHASE_LABELS[config?.runtime?.currentPhase] || "";
  if (totalCount > 0) {
    const performed = success + failedCount;
    const failText = failedCount
      ? ` · <span class="err">${failedCount} lỗi</span>`
      : "";
    const phaseText = phaseLabel ? `${phaseLabel} · ` : "";
    $runStatus.html(`${phaseText}Đã làm ${performed}/${totalCount}${failText}`);
  } else if (isRunning) {
    $runStatus.text(phaseLabel || "Đang khởi động…");
  } else {
    $runStatus.text("");
  }

  $("#searchTrigger, #scheduleTrigger").prop("disabled", false);
  const configInputIds = [
    "#searchDesk",
    "#searchMob",
    "#searchMin",
    "#searchMax",
    "#scheduleDesk",
    "#scheduleMob",
    "#scheduleMin",
    "#scheduleMax",
    "#scheduleTime",
  ];

  configInputIds.forEach((id) => {
    $(id).prop("disabled", isRunning);
  });

  $("#searchMode a, #scheduleMode a").toggleClass("disabled", isRunning);

  // Disable maintenance actions that would corrupt or collide with an active
  // run (start another activity/simulation, or wipe cookies mid-run).
  $("#activity, #simulate, #clearBrowsingData").prop("disabled", isRunning);

  logs && log(`[UPDATE] - UI updated`, "update");

  const $badge = $("#runningBadge");
  if (isRunning) {
    if ($badge.length === 0) {
      $(
        "<span id='runningBadge' class='running-badge'>● Running</span>",
      ).appendTo("header");
    } else {
      $badge.show();
    }
  } else {
    $badge.hide();
  }

  // Schedule is its own collapsible section now; when a schedule run becomes
  // active, reveal it ONCE so its trigger ("Dừng") and progress are visible.
  // Guarded by a flag so progress-driven re-renders don't re-open a panel the
  // user deliberately collapsed mid-run. The flag resets when the run ends.
  if (isRunning && config?.runtime?.mode === "schedule") {
    if (!_scheduleAutoRevealed) {
      $("#schedule").prop("hidden", false);
      $("#schedToggle").attr("aria-expanded", "true");
      _scheduleAutoRevealed = true;
      logs && log(`[NAV] - Schedule running; Schedule panel opened.`);
    }
  } else {
    _scheduleAutoRevealed = false;
  }
}
async function flashStatus($btn, originalText, result, successMsg) {
  // Remember the button's original tooltip so we can restore it after the flash
  // (rather than wiping the useful HTML title on success, or leaving a stale
  // error title stuck forever on failure).
  const originalTitle = $btn.attr("title");
  $btn.removeClass("flash-success flash-failed");
  if (result?.success || result === true) {
    $btn.addClass("flash-success").text(successMsg || "Thành công!");
  } else {
    $btn.addClass("flash-failed").text("Thất bại!");
    // Surface the reason from the service worker instead of swallowing it: show
    // it in a centralized toast (much more visible than a hover-only tooltip),
    // keep it on the button title, and always echo it to the console
    // (independent of the "Advanced logs" toggle, which is off by default).
    const reason = result?.message;
    if (reason) {
      $btn.attr("title", reason);
      showToast(reason, "error");
      console.warn(`[STATUS] ${originalText} failed: ${reason}`);
    } else {
      showToast("Thao tác thất bại", "error");
    }
  }
  await new Promise((r) => setTimeout(r, STATUS_FLASH_MS));
  $btn.removeClass("flash-success flash-failed").text(originalText);
  if (originalTitle == null) $btn.removeAttr("title");
  else $btn.attr("title", originalTitle);
}
async function stopActiveRunIfNeeded() {
  const stored = await get();
  if (!stored?.runtime?.running) return true;
  // The worker may be asleep; if the stop message is lost we still poll storage
  // below, so swallow send errors rather than aborting the reset flow.
  try {
    await sendMessageWithTimeout({ action: ACTIONS.STOP });
  } catch (err) {
    config?.control?.log &&
      log(`[STOP] - Stop message failed: ${err?.message || err}`, "warning");
  }
  const deadline = Date.now() + STOP_WAIT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const current = await get();
    if (!current?.runtime?.running) return true;
    await new Promise((resolve) => setTimeout(resolve, STOP_WAIT_POLL_MS));
  }
  return false;
}

function dedupeHistoryEntries(entries) {
  const seen = new Set();
  const deduped = [];
  for (const item of entries) {
    const key = `${item.url}|${item.lastVisitTime}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(item);
  }
  return deduped;
}

async function fetchBingHistoryLast24Hours() {
  const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
  const pageSize = 1000;
  const maxEntries = 10000;
  const allResults = [];
  const excludedIds = new Set();
  let lastVisitTime = Date.now();

  while (allResults.length < maxEntries) {
    const page = await new Promise((resolve, reject) => {
      chrome.history.search(
        {
          text: "bing.com",
          startTime: oneDayAgo,
          endTime: lastVisitTime,
          maxResults: pageSize,
        },
        (results) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          resolve(results || []);
        },
      );
    });

    const freshPage = page.filter((item) => !excludedIds.has(item.id));
    if (!freshPage.length) break;
    allResults.push(...freshPage);
    if (page.length < pageSize) break;

    const oldest = freshPage.reduce(
      (min, item) => (item.lastVisitTime < min ? item.lastVisitTime : min),
      freshPage[0].lastVisitTime,
    );
    if (!oldest || oldest <= oneDayAgo) break;

    const sameTimestampCount = freshPage.filter(
      (item) => item.lastVisitTime === oldest,
    ).length;
    if (sameTimestampCount === freshPage.length) {
      freshPage.forEach((item) => excludedIds.add(item.id));
      lastVisitTime = oldest;
      continue;
    }

    lastVisitTime = oldest - 1;
  }

  return dedupeHistoryEntries(allResults);
}

function clampLimitedNumber(raw, limitKey) {
  const entry = limitsMap[limitKey];
  if (!entry) return Number(raw) || 0;
  const { min, max } = entry;
  const maxVal = max[1];
  const num = Number(raw);
  if (isNaN(num)) return min;
  return Math.max(min, Math.min(maxVal, num));
}
function readLimitedNumber($el, limitKey) {
  return clampLimitedNumber($el.val(), limitKey);
}
async function persistSearchForm() {
  try {
    const min = readLimitedNumber($searchMin, "searchMin");
    const max = Math.max(min, readLimitedNumber($searchMax, "searchMax"));
    const search = {
      ...(config.search || {}),
      desk: readLimitedNumber($searchDesk, "searchDesk"),
      mob: readLimitedNumber($searchMob, "searchMob"),
      min,
      max,
    };
    await saveConfigMutation((next) => {
      next.search = {
        ...next.search,
        ...search,
      };
    });
    return { ...config.search };
  } catch (err) {
    config?.control?.log &&
      log(
        `[PERSIST] Failed to persist search form: ${err?.message || err}`,
        "error",
      );
    return { ...(config.search || {}) };
  }
}
async function persistScheduleForm() {
  try {
    const min = readLimitedNumber($scheduleMin, "scheduleMin");
    const max = Math.max(min, readLimitedNumber($scheduleMax, "scheduleMax"));
    const schedule = {
      ...(config.schedule || {}),
      desk: readLimitedNumber($scheduleDesk, "scheduleDesk"),
      mob: readLimitedNumber($scheduleMob, "scheduleMob"),
      min,
      max,
      // "HH:MM" from the <input type=time>; service normalizes invalid values.
      time: $scheduleTime.val() || config?.schedule?.time || "08:00",
    };
    await saveConfigMutation((next) => {
      next.schedule = {
        ...next.schedule,
        ...schedule,
      };
    });
    return { ...config.schedule };
  } catch (err) {
    config?.control?.log &&
      log(
        `[PERSIST] Failed to persist schedule form: ${err?.message || err}`,
        "error",
      );
    return { ...(config.schedule || {}) };
  }
}
$(document).ready(async function () {
  $version.val(chrome.runtime.getManifest().version);
  $userManual.on("click", () => {
    chrome.tabs.create({
      // Was a PDF that never shipped with the extension (dead link); now an
      // in-extension HTML manual.
      url: "/manual.html",
    });
  });

  // Derive a UI scale from the display, but clamp it: an unclamped value blows
  // the popup up to ~2x on 4K screens and shrinks it on small laptops, so the
  // popup size was effectively random per-monitor.
  const rawScale = Math.min(screen.width, screen.height * (16 / 9)) / 1920;
  const scale = Math.max(0.85, Math.min(1.2, rawScale || 1));
  $("body").css("--scale", `${scale}`);
  await updateUI();

  // Pick a random simulated device once if none is stored yet, then re-render.
  if (!config?.device?.name) {
    await resetDevice();
    $deviceName.text(config?.device?.name || "");
  }

  // Advanced panel starts collapsed; toggle it open/closed on click.
  const $advToggle = $("#advToggle");
  const $advanced = $("#advanced");
  $advToggle.on("click", function () {
    const isOpen = !$advanced.prop("hidden");
    $advanced.prop("hidden", isOpen);
    $advToggle.attr("aria-expanded", String(!isOpen));
  });
  // Schedule is its own collapsible section (promoted out of Advanced).
  const $schedToggle = $("#schedToggle");
  const $scheduleSection = $("#schedule");
  $schedToggle.on("click", function () {
    const isOpen = !$scheduleSection.prop("hidden");
    $scheduleSection.prop("hidden", isOpen);
    $schedToggle.attr("aria-expanded", String(!isOpen));
  });
  // The mode presets and reset-device control are <a role="button"> elements
  // (no href), so they aren't keyboard-operable by default. Mirror native
  // button behaviour: Enter/Space activates them.
  $(document).on("keydown", 'a[role="button"]', function (e) {
    if (e.key === "Enter" || e.key === " " || e.key === "Spacebar") {
      e.preventDefault();
      // `.disabled` presets block the mouse via `pointer-events: none`, but a
      // programmatic click() bypasses that — guard here so a keyboard user
      // can't mutate search/schedule counts mid-run.
      if (this.classList.contains("disabled")) return;
      this.click();
    }
  });
  // If a schedule run is already active on load, reveal the Schedule section so
  // its controls and progress are visible.
  if (config?.runtime?.running && config?.runtime?.mode === "schedule") {
    $scheduleSection.prop("hidden", false);
    $schedToggle.attr("aria-expanded", "true");
  }

  const logs = config?.control?.log;
  logs && log("[INIT] - UI initialized with scale: " + scale, "update");
  $searchDesk.on("change", async function () {
    const desk = readLimitedNumber($(this), "searchDesk");
    await saveConfigMutation((next) => {
      next.search.desk = desk;
    });
  });
  $searchMob.on("change", async function () {
    const mob = readLimitedNumber($(this), "searchMob");
    await saveConfigMutation((next) => {
      next.search.mob = mob;
    });
  });
  $searchMin.on("change", async function () {
    let val = readLimitedNumber($(this), "searchMin");
    let range = Number($searchMax.val());
    const patch = { min: val };
    if (range < val * 1.5) {
      range = clampLimitedNumber(Math.ceil(val * 1.5), "searchMax");
      patch.max = range;
    }
    await saveConfigMutation((next) => {
      Object.assign(next.search, patch);
    });
  });
  $searchMax.on("change", async function () {
    let val = readLimitedNumber($(this), "searchMax");
    let range = Number($searchMin.val());
    const patch = { max: val };
    if (val < range * 1.5) {
      range = clampLimitedNumber(Math.floor(val / 1.5), "searchMin");
      patch.min = range;
    }
    await saveConfigMutation((next) => {
      Object.assign(next.search, patch);
    });
  });
  $searchModeA.on("click", async function () {
    const mode = ($(this).attr("class") || "")
      .split(/\s+/)
      .find((c) => /^m\d$/.test(c));
    const preset = SEARCH_MODE_PRESETS[mode];
    if (preset) {
      await saveConfigMutation((next) => {
        next.search.desk = preset.desk;
        next.search.mob = preset.mob;
      });
    }
  });
  $scheduleDesk.on("change", async function () {
    const desk = readLimitedNumber($(this), "scheduleDesk");
    await saveConfigMutation((next) => {
      next.schedule.desk = desk;
    });
  });
  $scheduleMob.on("change", async function () {
    const mob = readLimitedNumber($(this), "scheduleMob");
    await saveConfigMutation((next) => {
      next.schedule.mob = mob;
    });
  });
  $scheduleMin.on("change", async function () {
    let val = readLimitedNumber($(this), "scheduleMin");
    let range = Number($scheduleMax.val());
    const patch = { min: val };
    if (range < val * 1.5) {
      range = clampLimitedNumber(Math.ceil(val * 1.5), "scheduleMax");
      patch.max = range;
    }
    await saveConfigMutation((next) => {
      Object.assign(next.schedule, patch);
    });
  });
  $scheduleMax.on("change", async function () {
    let val = readLimitedNumber($(this), "scheduleMax");
    let range = Number($scheduleMin.val());
    const patch = { max: val };
    if (val < range * 1.5) {
      range = clampLimitedNumber(Math.floor(val / 1.5), "scheduleMin");
      patch.min = range;
    }
    await saveConfigMutation((next) => {
      Object.assign(next.schedule, patch);
    });
  });
  $scheduleTime.on("change", async function () {
    const time = $(this).val() || "08:00";
    await saveConfigMutation((next) => {
      next.schedule.time = time;
    });
    logs && log(`[SCHEDULE] - Daily time set to: ${time}`, "update");
    // If the daily schedule is already armed, re-arm it at the new time —
    // otherwise the alarm keeps firing at the old time while the popup shows
    // the new one.
    try {
      const alarm = await chrome.alarms.get("schedule_daily");
      if (alarm && config?.schedule?.mode === "m5") {
        const response = await sendMessageWithTimeout({
          action: ACTIONS.SCHEDULE,
          searches: { ...config.schedule },
        });
        if (response?.success) {
          showToast(`Đã dời lịch sang ${time}`, "success");
        } else {
          showToast(response?.message || "Không dời được lịch", "error");
        }
        await updateUI();
      }
    } catch (err) {
      showToast("Không dời được lịch — thử bấm Đặt lịch lại", "error");
      logs &&
        log(`[SCHEDULE] - Re-arm failed: ${err?.message || err}`, "warning");
    }
  });
  $scheduleModeA.on("click", async function () {
    const mode = ($(this).attr("class") || "")
      .split(/\s+/)
      .find((c) => /^m\d$/.test(c));
    if (!mode) return;
    // NOTE: These buttons only control run frequency (Manual/Startup/~5min/~15min).
    // They must not silently overwrite the Desktop/Mobile counts the user already set.
    await saveConfigMutation((next) => {
      next.schedule.mode = mode;
    });
    logs && log(`[SCHEDULE] - Schedule mode selected: ${mode}`, "update");
  });
  // One-shot action buttons share this skeleton: ignore re-entrant clicks,
  // disable while running, run `action($btn, $btnText)` (which does its own
  // success flashStatus/log), and always re-enable in `finally`. A thrown error
  // flashes failure and, when `errorLog` is given, logs it. `locked: true`
  // additionally holds the UI lock and re-renders on unlock (for actions that
  // mutate run state), matching makeRunTriggerHandler.
  function makeActionHandler(action, { locked = false, errorLog } = {}) {
    return async function () {
      const $btn = $(this);
      if ($btn.prop("disabled")) return;
      const $btnText = $btn.text();
      $btn.prop("disabled", true);
      if (locked) _uiLocked = true;
      try {
        await action($btn, $btnText);
      } catch (error) {
        await flashStatus($btn, $btnText, false);
        if (errorLog) log(errorLog(error), "error");
      } finally {
        if (locked) _uiLocked = false;
        $btn.prop("disabled", false);
        if (locked) await updateUI();
      }
    };
  }
  // Search and Schedule triggers share identical start/stop plumbing; only the
  // start action, the form to persist, and the log label differ.
  function makeRunTriggerHandler({ startAction, persistForm, logTag, label }) {
    return async function () {
      const $btn = $(this);
      if ($btn.prop("disabled")) return;

      const originalText = $btn.text();
      $btn.prop("disabled", true).addClass("busy");
      _uiLocked = true;

      try {
        if (config?.runtime?.running) {
          $btn.text("Đang dừng...");
          const response = await sendMessageWithTimeout({
            action: ACTIONS.STOP,
          });
          await flashStatus($btn, originalText, response);
          logs &&
            log(`[${logTag}] - ${label} stopped: ${originalText}`, "update");
        } else {
          $btn.text("Đang chạy...");
          const searches = await persistForm();
          const response = await sendMessageWithTimeout({
            action: startAction,
            searches,
          });
          await flashStatus($btn, originalText, response);
          logs &&
            log(`[${logTag}] - ${label} started: ${originalText}`, "update");
        }
      } catch (err) {
        logs &&
          log(
            `[${logTag}] Click handler error: ${err?.message || err}`,
            "error",
          );
        await flashStatus($btn, originalText, false);
      } finally {
        _uiLocked = false;
        $btn.prop("disabled", false).removeClass("busy");
        await updateUI();
      }
    };
  }
  $searchTrigger.on(
    "click",
    makeRunTriggerHandler({
      startAction: ACTIONS.START,
      persistForm: persistSearchForm,
      logTag: "SEARCH",
      label: "Search",
    }),
  );
  $scheduleTrigger.on(
    "click",
    makeRunTriggerHandler({
      startAction: ACTIONS.SCHEDULE,
      persistForm: persistScheduleForm,
      logTag: "SCHEDULE",
      label: "Schedule",
    }),
  );
  $resetDevice.on("click", async function () {
    const ok = await resetDevice();
    if (ok) {
      showToast(`Đã đổi thiết bị: ${config?.device?.name || "?"}`, "success");
    } else {
      showToast("Không đổi được thiết bị", "error");
    }
    logs && log(`[DEVICE] - Device reset`, "update");
  });
  $clear.on("change", async function () {
    const clear = $(this).is(":checked") ? 1 : 0;
    await saveConfigMutation((next) => {
      next.control.clear = clear;
    });
    logs &&
      log(
        `[CONTROL] - Clear browsing data set to: ${config.control.clear}`,
        "update",
      );
  });
  $preserveRewards.on("change", async function () {
    const preserveRewards = $(this).is(":checked") ? 1 : 0;
    await saveConfigMutation((next) => {
      next.control.preserveRewards = preserveRewards;
    });
    logs &&
      log(
        `[CONTROL] - Preserve Rewards login set to: ${config.control.preserveRewards}`,
        "update",
      );
  });
  $log.on("change", async function () {
    const enableLog = $(this).is(":checked") ? 1 : 0;
    await saveConfigMutation((next) => {
      next.control.log = enableLog;
    });
    logs && log(`[CONTROL] - Log enabled: ${config.control.log}`, "update");
  });
  $niche.on("change", async function () {
    const niche = $(this).val().trim() || "random";
    await saveConfigMutation((next) => {
      next.control.niche = niche;
    });
    logs && log(`[CONTROL] - Niche set to: ${config.control.niche}`, "update");
  });
  $activity.on(
    "click",
    makeActionHandler(
      async ($btn, $btnText) => {
        const response = await sendMessageWithTimeout({
          action: ACTIONS.ACTIVITY,
        });
        await flashStatus($btn, $btnText, response);
        logs &&
          log(
            `[ACTIVITY] - Activity started: ${response?.message ?? JSON.stringify(response)}`,
            "update",
          );
      },
      { locked: true },
    ),
  );
  $act.on("change", async function () {
    const act = $(this).is(":checked") ? 1 : 0;
    await saveConfigMutation((next) => {
      next.control.act = act;
    });
    logs && log(`[CONTROL] - Act set to: ${config.control.act}`, "update");
  });
  $clearBrowsingData.on(
    "click",
    withConfirm(
      makeActionHandler(
        async ($btn, $btnText) => {
          const response = await sendMessageWithTimeout({
            action: ACTIONS.CLEAR_BROWSING_DATA,
          });
          await flashStatus($btn, $btnText, response);
          logs &&
            log(
              `[CLEAR BROWSING DATA] - Data cleared: ${response?.message ?? JSON.stringify(response)}`,
              "update",
            );
        },
        { locked: true },
      ),
    ),
  );
  $simulate.on(
    "click",
    makeActionHandler(
      async ($btn, $btnText) => {
        const response = await sendMessageWithTimeout({
          action: ACTIONS.SIMULATE,
        });
        await flashStatus($btn, $btnText, response);
        logs &&
          log(
            `[SIMULATE] - Simulation started: ${response?.message ?? JSON.stringify(response)}`,
            "update",
          );
      },
      { locked: true },
    ),
  );
  $download.on(
    "click",
    makeActionHandler(
      async ($btn, $btnText) => {
        const results = await fetchBingHistoryLast24Hours();
        const blob = new Blob([JSON.stringify(results, null, 2)], {
          type: "application/json",
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `[Rewards_Search_Automator]_bing_search_history_${new Date().toISOString()}.json`;
        a.click();
        URL.revokeObjectURL(url);
        a.remove();
        await flashStatus($btn, $btnText, true);
        showToast(
          results.length
            ? `Đã tải ${results.length} mục lịch sử`
            : "Không tìm thấy mục nào để tải",
          results.length ? "success" : "info",
        );
        logs &&
          log(
            `[DOWNLOAD] - Search history downloaded: ${results.length} entries`,
            "update",
          );
      },
      {
        errorLog: (error) =>
          `[DOWNLOAD] - Error downloading search history: ${error?.message}`,
      },
    ),
  );
  $delete.on(
    "click",
    withConfirm(
      makeActionHandler(
        async ($btn, $btnText) => {
          const results = await fetchBingHistoryLast24Hours();
          const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
          const uniqueUrls = [
            ...new Set(results.map((item) => item.url).filter(Boolean)),
          ];
          for (const url of uniqueUrls) {
            await new Promise((resolve, reject) => {
              chrome.history.deleteUrl({ url }, () => {
                if (chrome.runtime.lastError) {
                  reject(new Error(chrome.runtime.lastError.message));
                  return;
                }
                resolve();
              });
            });
          }
          await flashStatus($btn, $btnText, true);
          showToast(
            uniqueUrls.length
              ? `Đã xoá ${uniqueUrls.length} URL khỏi lịch sử`
              : "Không có URL nào để xoá",
            uniqueUrls.length ? "success" : "info",
          );
          logs &&
            log(
              `[DELETE] - Removed ${uniqueUrls.length} Bing URLs from history (last 24h window: ${oneDayAgo}-${Date.now()}). Older visits for the same URLs may also be removed by Chrome.`,
              "update",
            );
        },
        {
          errorLog: (error) =>
            `[DELETE] - Error deleting search history: ${error?.message}`,
        },
      ),
    ),
  );
  $downloadCrashLog.on(
    "click",
    makeActionHandler(
      async ($btn, $btnText) => {
        const text = await exportCrashLogText();
        const blob = new Blob([text], { type: "text/plain" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `[Rewards_Search_Automator]_crash_log_${new Date().toISOString()}.txt`;
        a.click();
        URL.revokeObjectURL(url);
        a.remove();
        await flashStatus($btn, $btnText, true);
        logs && log(`[CRASH LOG] - Crash log downloaded.`, "update");
      },
      {
        errorLog: (error) =>
          `[CRASH LOG] - Error downloading crash log: ${error?.message}`,
      },
    ),
  );
  $clearCrashLog.on(
    "click",
    withConfirm(
      makeActionHandler(
        async ($btn, $btnText) => {
          await clearCrashLog();
          await flashStatus($btn, $btnText, true);
          showToast("Đã xoá log lỗi", "success");
          logs && log(`[CRASH LOG] - Crash log cleared.`, "update");
        },
        {
          errorLog: (error) =>
            `[CRASH LOG] - Error clearing crash log: ${error?.message}`,
        },
      ),
    ),
  );
  $runtime.on(
    "click",
    withConfirm(async function () {
      const $btn = $(this);
      if ($btn.prop("disabled")) return;
      const $btnText = $btn.text();
      $btn.prop("disabled", true);
      try {
        const stopped = await stopActiveRunIfNeeded();
        if (!stopped) {
          await flashStatus($btn, $btnText, false);
          log(`[RUNTIME] - Stop timed out; runtime not reset.`, "error");
          return;
        }
        await saveConfigMutation((next) => {
          next.runtime.done = 0;
          next.runtime.total = 0;
          next.runtime.failed = 0;
          next.runtime.mobile = 0;
          next.runtime.act = 0;
          next.runtime.running = 0;
          next.runtime.mode = null;
          next.runtime.currentSession = null;
          next.runtime.currentPhase = null;
          next.runtime.rsaTab = null;
        });
        await flashStatus($btn, $btnText, true);
        showToast("Đã đặt lại dữ liệu chạy", "success");
        logs && log(`[RUNTIME] - Runtime reset.`, "update");
      } finally {
        $btn.prop("disabled", false);
      }
    }),
  );
  $reset.on(
    "click",
    withConfirm(async function () {
      const $btn = $(this);
      if ($btn.prop("disabled")) return;
      const $btnText = $btn.text();
      $btn.prop("disabled", true);
      const stopped = await stopActiveRunIfNeeded();
      if (!stopped) {
        await flashStatus($btn, $btnText, false);
        log(`[RESET] - Stop timed out; extension not reset.`, "error");
        $btn.prop("disabled", false);
        return;
      }
      await chrome.storage.local.remove("config");
      await flashStatus($btn, $btnText, true);
      logs && log(`[RESET] - Extension config reset.`, "update");
      location.reload();
    }),
  );
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && (changes.config || changes.activityMemory)) {
    scheduleUIUpdate();
  }
});
