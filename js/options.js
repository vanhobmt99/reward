import {get, atomicUpdate} from '/js/utils.js';
import {createDefaultConfig, applyConfigDefaults} from '/js/config-defaults.js';
import {ACTIONS, sendMessageWithTimeout} from '/js/messages.js';
import {devices} from '/js/devices.js';
import {exportCrashLogText} from '/js/crash-logger.js';

const SEARCH_LIMITS = {
  searchDesk: {min: 0, max: 300},
  searchMob: {min: 0, max: 300},
  searchMin: {min: 5, max: 600},
  searchMax: {min: 8, max: 900},
};

const SCHEDULE_LIMITS = {
  scheduleDesk: {min: 0, max: 300},
  scheduleMob: {min: 0, max: 300},
  scheduleMin: {min: 5, max: 600},
  scheduleMax: {min: 8, max: 900},
};

const SEARCH_PRESETS = {
  m1: {desk: 11, mob: 0},
  m2: {desk: 21, mob: 11},
  m3: {desk: 31, mob: 21},
  m4: {desk: 51, mob: 31},
};

let config = createDefaultConfig();
let statusTimer = null;

/**
 * Clamps one search-settings field to its input limits.
 * @param {string|number} raw Form value.
 * @param {string} key searchDesk, searchMob, searchMin, or searchMax.
 * @return {number} Finite value inside that field's min and max.
 */
function clampNumber(raw, key) {
  const {min, max} = SEARCH_LIMITS[key];
  const number = Number(raw);
  if (!Number.isFinite(number)) {
    return min;
  }
  return Math.max(min, Math.min(max, number));
}

/**
 * Shows the save banner, replacing any banner still on its timer.
 * @param {string} message Status text.
 * @param {boolean=} error Whether the banner is an error. Defaults to false.
 */
function showSaveStatus(message, error = false) {
  const status = document.querySelector('#saveStatus');
  if (!status) {
    return;
  }
  status.textContent = message;
  status.dataset.error = String(error);
  status.classList.add('show');
  if (statusTimer) {
    clearTimeout(statusTimer);
  }
  statusTimer = setTimeout(() => status.classList.remove('show'), 1500);
}

/**
 * Applies a mutation to a defaulted copy of the stored config and saves it.
 * @param {function(!ExtensionConfig): void} mutator Edit applied before the
 *     write. It may replace fields on the supplied config.
 */
async function saveConfigMutation(mutator) {
  const updated = await atomicUpdate((stored) => {
    const next = createDefaultConfig();
    applyConfigDefaults(next, stored);
    mutator(next);
    return next;
  });
  config = updated || config;
  showSaveStatus('Đã lưu cài đặt');
}

function renderSearchSettings() {
  document.querySelector('#searchDesk').value = config.search.desk;
  document.querySelector('#searchMob').value = config.search.mob;
  document.querySelector('#searchMin').value = config.search.min;
  document.querySelector('#searchMax').value = config.search.max;
  document.querySelector('#niche').value = config.control.niche || 'random';
  if (!document.querySelector(
          `#niche option[value="${
              CSS.escape(config.control.niche || 'random')}"]`,
          )) {
    document.querySelector('#niche').value = 'random';
  }
  document.querySelector('#act').checked = Boolean(config.control.act);
  document.querySelector('#clear').checked = Boolean(config.control.clear);
  document.querySelector('#preserveRewards').checked = Boolean(
      config.control.preserveRewards,
  );
  document.querySelector('#log').checked = Boolean(config.control.log);
  document.querySelector('#deviceName').textContent =
      config.device.name || 'Chưa chọn';
  document.querySelector('#scheduleDesk').value = config.schedule.desk;
  document.querySelector('#scheduleMob').value = config.schedule.mob;
  document.querySelector('#scheduleMin').value = config.schedule.min;
  document.querySelector('#scheduleMax').value = config.schedule.max;
  document.querySelector('#scheduleMode').value = config.schedule.mode;
  document.querySelector('#scheduleTime').value =
      config.schedule.time || '08:00';
  renderScheduleMode();
  renderRuntimeState();
  document.querySelector('#version').textContent =
      `Phiên bản ${chrome.runtime.getManifest().version}`;
}

function renderRuntimeState() {
  const running = Boolean(config?.runtime?.running);
  document
      .querySelectorAll(
          '#search-settings input, #search-settings select, #schedule-settings input, #schedule-settings select, #other-settings input',
          )
      .forEach((control) => {
        control.disabled = running;
      });
  document.querySelector('#activity').disabled = running;
  document.querySelector('#simulate').disabled = running;
}

async function loadConfig() {
  const stored = await get();
  config = createDefaultConfig();
  applyConfigDefaults(config, stored);
  renderSearchSettings();
}

/**
 * Applies a storage update without resetting form edits on progress-only
 * writes.
 * @param {!Object|undefined} stored Latest stored configuration.
 * @return {void}
 */
function applyStoredConfigChange(stored) {
  const previous = config;
  config = createDefaultConfig();
  applyConfigDefaults(config, stored);
  const settingsChanged = ['search', 'schedule', 'control', 'device'].some(
      (key) => JSON.stringify(previous[key]) !== JSON.stringify(config[key]));
  const runningChanged =
      Boolean(previous.runtime?.running) !== Boolean(config.runtime?.running);
  if (settingsChanged) {
    renderSearchSettings();
  } else if (runningChanged) {
    renderRuntimeState();
  }
  if (settingsChanged || runningChanged) {
    void refreshScheduleStatus();
  }
}

/**
 * Saves one manual-search field and keeps min/max at least 1.5 apart.
 * @param {string} key searchDesk, searchMob, searchMin, or searchMax.
 * @param {string|number} raw Form value.
 */
async function saveSearchValue(key, raw) {
  const value = clampNumber(raw, key);
  const patch = {};
  if (key === 'searchDesk') {
    patch.desk = value;
  }
  if (key === 'searchMob') {
    patch.mob = value;
  }
  if (key === 'searchMin') {
    patch.min = value;
    const max = Number(document.querySelector('#searchMax').value);
    if (max < value * 1.5) {
      patch.max = clampNumber(Math.ceil(value * 1.5), 'searchMax');
      document.querySelector('#searchMax').value = patch.max;
    }
  }
  if (key === 'searchMax') {
    patch.max = value;
    const min = Number(document.querySelector('#searchMin').value);
    if (value < min * 1.5) {
      patch.min = clampNumber(Math.floor(value / 1.5), 'searchMin');
      document.querySelector('#searchMin').value = patch.min;
    }
  }
  document.querySelector(`#${key}`).value = value;
  await saveConfigMutation((next) => {
    Object.assign(next.search, patch);
  });
}

function renderScheduleMode() {
  const daily = config?.schedule?.mode === 'm5';
  document.querySelector('#scheduleTimeRow').hidden = !daily;
  const button = document.querySelector('#scheduleTrigger');
  button.textContent = config?.runtime?.running ? 'Dừng' :
      config?.schedule?.mode === 'm1'           ? 'Chạy một lần' :
                                                  'Đặt lịch';
}

/**
 * Saves one schedule field and keeps min/max at least 1.5 apart.
 * @param {string} key scheduleDesk, scheduleMob, scheduleMin, or scheduleMax.
 * @param {string|number} raw Form value.
 */
async function saveScheduleValue(key, raw) {
  const {min, max} = SCHEDULE_LIMITS[key];
  const number = Number(raw);
  const value =
      Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : min;
  const patch = {};
  document.querySelector(`#${key}`).value = value;
  if (key === 'scheduleDesk') {
    patch.desk = value;
  }
  if (key === 'scheduleMob') {
    patch.mob = value;
  }
  if (key === 'scheduleMin') {
    patch.min = value;
    const max = Number(document.querySelector('#scheduleMax').value);
    if (max < value * 1.5) {
      patch.max = Math.max(
          SCHEDULE_LIMITS.scheduleMax.min,
          Math.min(SCHEDULE_LIMITS.scheduleMax.max, Math.ceil(value * 1.5)),
      );
      document.querySelector('#scheduleMax').value = patch.max;
    }
  }
  if (key === 'scheduleMax') {
    patch.max = value;
    const min = Number(document.querySelector('#scheduleMin').value);
    if (value < min * 1.5) {
      patch.min = Math.max(
          SCHEDULE_LIMITS.scheduleMin.min,
          Math.min(SCHEDULE_LIMITS.scheduleMin.max, Math.floor(value / 1.5)),
      );
      document.querySelector('#scheduleMin').value = patch.min;
    }
  }
  await saveConfigMutation((next) => {
    Object.assign(next.schedule, patch);
  });
}



async function refreshScheduleStatus() {
  const status = document.querySelector('#scheduleStatus');
  const mode = config?.schedule?.mode;
  if (mode === 'm5') {
    try {
      const alarm = await chrome.alarms.get('schedule_daily');
      if (alarm?.scheduledTime) {
        const next = new Date(alarm.scheduledTime);
        /**
         * @param {number} value Hour, minute, day, or month.
         * @return {string} Two-digit decimal text.
         */
        const pad = (value) => String(value).padStart(2, '0');
        status.textContent = `Đã đặt lịch — lần tới: ${pad(next.getHours())}:${
            pad(next.getMinutes())} ngày ${pad(next.getDate())}/${
            pad(next.getMonth() + 1)}`;
      } else {
        status.textContent = 'Chưa đặt lịch hằng ngày.';
      }
      return;
    } catch {
      status.textContent = 'Không đọc được trạng thái lịch.';
      return;
    }
  }
  if (mode === 'm3' || mode === 'm4') {
    try {
      const alarm = await chrome.alarms.get('schedule');
      status.textContent = alarm?.scheduledTime ? 'Lịch chạy lặp đang bật.' :
                                                  'Chưa đặt lịch chạy lặp.';
      return;
    } catch {
      status.textContent = 'Không đọc được trạng thái lịch.';
      return;
    }
  }
  status.textContent = mode === 'm2' ?
      'Chế độ này bắt đầu chạy khi mở trình duyệt.' :
      'Chế độ thủ công không tự chạy.';
}

async function runScheduleAction() {
  const button = document.querySelector('#scheduleTrigger');
  const status = document.querySelector('#scheduleStatus');
  button.disabled = true;
  status.textContent = 'Đang xử lý…';
  status.dataset.error = 'false';
  try {
    const response = config?.runtime?.running ?
        await sendMessageWithTimeout({action: ACTIONS.STOP}) :
        await sendMessageWithTimeout({
          action: ACTIONS.SCHEDULE,
          searches: {...config.schedule},
        });
    status.textContent = response?.message || 'Đã gửi yêu cầu.';
    status.dataset.error = String(!response?.success);
    await loadConfig();
    await refreshScheduleStatus();
  } catch (error) {
    status.dataset.error = 'true';
    status.textContent = `Không thực hiện được: ${error?.message || error}`;
  } finally {
    button.disabled = false;
    renderScheduleMode();
  }
}

function bindScheduleSettings() {
  for (const key
           of ['scheduleDesk',
               'scheduleMob',
               'scheduleMin',
               'scheduleMax',
  ]) {
    const {min, max} = SCHEDULE_LIMITS[key];
    const input = document.querySelector(`#${key}`);
    input.min = min;
    input.max = max;
    input.addEventListener('change', (event) => {
      saveScheduleValue(key, event.currentTarget.value).catch((error) => {
        showSaveStatus(
            `Không lưu được cài đặt: ${error?.message || error}`,
            true,
        );
      });
    });
  }

  document.querySelector('#scheduleMode')
      .addEventListener('change', (event) => {
        const mode = event.currentTarget.value;
        saveConfigMutation((next) => {
          next.schedule.mode = mode;
        })
            .then(() => {
              renderScheduleMode();
              refreshScheduleStatus();
            })
            .catch((error) => {
              showSaveStatus(
                  `Không lưu được cài đặt: ${error?.message || error}`,
                  true,
              );
            });
      });

  document.querySelector('#scheduleTime')
      .addEventListener('change', (event) => {
        const time = event.currentTarget.value || '08:00';
        saveConfigMutation((next) => {
          next.schedule.time = time;
        })
            .then(async () => {
              if (config?.schedule?.mode === 'm5') {
                const alarm = await chrome.alarms.get('schedule_daily');
                if (alarm) {
                  await sendMessageWithTimeout({
                    action: ACTIONS.SCHEDULE,
                    searches: {...config.schedule},
                  });
                }
              }
              await refreshScheduleStatus();
            })
            .catch((error) => {
              showSaveStatus(
                  `Không lưu được cài đặt: ${error?.message || error}`,
                  true,
              );
            });
      });

  document.querySelector('#scheduleTrigger')
      .addEventListener('click', runScheduleAction);
}

function bindSearchSettings() {
  for (const key of Object.keys(SEARCH_LIMITS)) {
    const input = document.querySelector(`#${key}`);
    input.addEventListener('change', () => {
      saveSearchValue(key, input.value).catch((error) => {
        showSaveStatus(
            `Không lưu được cài đặt: ${error?.message || error}`,
            true,
        );
      });
    });
  }

  document.querySelectorAll('[data-search-preset]').forEach((button) => {
    button.addEventListener('click', async () => {
      const preset = SEARCH_PRESETS[button.dataset.searchPreset];
      if (!preset) {
        return;
      }
      document.querySelector('#searchDesk').value = preset.desk;
      document.querySelector('#searchMob').value = preset.mob;
      try {
        await saveConfigMutation((next) => {
          next.search.desk = preset.desk;
          next.search.mob = preset.mob;
        });
      } catch (error) {
        showSaveStatus(
            `Không lưu được cài đặt: ${error?.message || error}`,
            true,
        );
      }
    });
  });

  document.querySelector('#niche').addEventListener('change', (event) => {
    const niche = event.currentTarget.value || 'random';
    saveConfigMutation((next) => {
      next.control.niche = niche;
    }).catch((error) => {
      showSaveStatus(
          `Không lưu được cài đặt: ${error?.message || error}`,
          true,
      );
    });
  });

  document.querySelector('#act').addEventListener('change', (event) => {
    const act = event.currentTarget.checked ? 1 : 0;
    saveConfigMutation((next) => {
      next.control.act = act;
    }).catch((error) => {
      showSaveStatus(
          `Không lưu được cài đặt: ${error?.message || error}`,
          true,
      );
    });
  });
}

/**
 * @param {string|null|undefined} userAgent Device UA. Missing values are not
 *     iOS.
 * @return {boolean} Whether the UA identifies an iPhone, iPad, or iPod.
 */
function isIosUserAgent(userAgent) {
  return /iPhone|iPad|iPod/i.test(String(userAgent || ''));
}

async function selectRandomDevice() {
  const eligible = devices.filter(
      (device) => !isIosUserAgent(device?.userAgent),
  );
  const pool = eligible.length > 0 ? eligible : devices;
  const device = pool[Math.floor(Math.random() * pool.length)];
  await saveConfigMutation((next) => {
    next.device.name = device.name;
    next.device.ua = device.userAgent;
    next.device.h = device.height;
    next.device.w = device.width;
    next.device.scale = device.deviceScaleFactor;
  });
  document.querySelector('#deviceName').textContent = device.name;
}

/**
 * Persists a 0/1 control flag when its checkbox changes.
 * @param {string} id Checkbox element id.
 * @param {string} key control section field, such as "clear" or "log".
 */
function bindControlCheckbox(id, key) {
  document.querySelector(`#${id}`).addEventListener('change', (event) => {
    const value = event.currentTarget.checked ? 1 : 0;
    saveConfigMutation((next) => {
      next.control[key] = value;
    }).catch((error) => {
      showSaveStatus(
          `Không lưu được cài đặt: ${error?.message || error}`,
          true,
      );
    });
  });
}

/**
 * Starts a download of an in-memory file and revokes the object URL.
 * @param {string} contents File body.
 * @param {string} type MIME type passed to the Blob.
 * @param {string} filename Download name.
 */
function downloadFile(contents, type, filename) {
  const url = URL.createObjectURL(new Blob([contents], {type}));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
  link.remove();
}

/**
 * Pages through chrome.history for Bing visits in the last 24 hours.
 * @return {!Promise<!Array<!chrome.history.HistoryItem>>} Visits with duplicate
 *     url and lastVisitTime pairs removed.
 */
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
            text: 'bing.com',
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
    if (!freshPage.length) {
      break;
    }
    allResults.push(...freshPage);
    if (page.length < pageSize) {
      break;
    }

    const oldest = freshPage.reduce(
        (min, item) => Math.min(min, item.lastVisitTime),
        freshPage[0].lastVisitTime,
    );
    if (!oldest || oldest <= oneDayAgo) {
      break;
    }

    const oldestEntries = freshPage.filter(
        (item) => item.lastVisitTime === oldest,
    );
    if (oldestEntries.length === freshPage.length) {
      oldestEntries.forEach((item) => excludedIds.add(item.id));
      lastVisitTime = oldest;
      continue;
    }
    lastVisitTime = oldest - 1;
  }

  const seen = new Set();
  return allResults.filter((item) => {
    const key = `${item.url}|${item.lastVisitTime}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

/**
 * Disables a button, sends one extension message, and shows the reply.
 * @param {!HTMLButtonElement} button Button that triggered the action.
 * @param {string} action Message action name.
 * @param {string} successText Text used when the reply has no message.
 */
async function performUtilityAction(button, action, successText) {
  button.disabled = true;
  try {
    const response = await sendMessageWithTimeout({action});
    const message = response?.message || successText;
    showSaveStatus(message, !response?.success);
  } catch (error) {
    showSaveStatus(`Không thực hiện được: ${error?.message || error}`, true);
  } finally {
    button.disabled = false;
  }
}

function bindOtherSettings() {
  bindControlCheckbox('clear', 'clear');
  bindControlCheckbox('preserveRewards', 'preserveRewards');
  bindControlCheckbox('log', 'log');

  document.querySelector('#resetDevice').addEventListener('click', () => {
    selectRandomDevice().catch((error) => {
      showSaveStatus(
          `Không đổi được thiết bị: ${error?.message || error}`,
          true,
      );
    });
  });

  document.querySelector('#activity').addEventListener('click', (event) => {
    performUtilityAction(
        event.currentTarget,
        ACTIONS.ACTIVITY,
        'Đã gửi yêu cầu làm nhiệm vụ.',
    );
  });

  document.querySelector('#simulate').addEventListener('click', (event) => {
    performUtilityAction(
        event.currentTarget,
        ACTIONS.SIMULATE,
        'Đã gửi yêu cầu chuyển tab giả lập.',
    );
  });

  document.querySelector('#download')
      .addEventListener('click', async (event) => {
        const button = event.currentTarget;
        button.disabled = true;
        try {
          const results = await fetchBingHistoryLast24Hours();
          downloadFile(
              JSON.stringify(results, null, 2),
              'application/json',
              `[Rewards_Search_Automator]_bing_search_history_${
                  new Date().toISOString()}.json`,
          );
          showSaveStatus(
              results.length ? `Đã tải ${results.length} mục lịch sử` :
                               'Không tìm thấy mục nào để tải',
          );
        } catch (error) {
          showSaveStatus(
              `Không tải được lịch sử: ${error?.message || error}`,
              true,
          );
        } finally {
          button.disabled = false;
        }
      });

  document.querySelector('#downloadCrashLog')
      .addEventListener('click', async (event) => {
        const button = event.currentTarget;
        button.disabled = true;
        try {
          const text = await exportCrashLogText();
          downloadFile(
              text,
              'text/plain',
              `[Rewards_Search_Automator]_crash_log_${
                  new Date().toISOString()}.txt`,
          );
          showSaveStatus('Đã tải log lỗi');
        } catch (error) {
          showSaveStatus(
              `Không tải được log: ${error?.message || error}`, true);
        } finally {
          button.disabled = false;
        }
      });

  document.querySelector('#userManual').addEventListener('click', () => {
    chrome.tabs.create({url: '/manual.html'});
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  for (const [id, limits] of Object.entries({
         ...SEARCH_LIMITS,
         ...SCHEDULE_LIMITS,
       })) {
    const input = document.querySelector(`#${id}`);
    input.min = limits.min;
    input.max = limits.max;
  }
  bindSearchSettings();
  bindScheduleSettings();
  bindOtherSettings();
  try {
    await loadConfig();
    await refreshScheduleStatus();
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || !changes.config) {
        return;
      }
      applyStoredConfigChange(changes.config.newValue);
    });
  } catch (error) {
    const status = document.querySelector('#saveStatus');
    status.textContent = `Không tải được cài đặt: ${error?.message || error}`;
    status.dataset.error = 'true';
    status.classList.add('show');
  }
});
