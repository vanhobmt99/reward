import {get, atomicUpdate} from '/js/utils.js';
import {createDefaultConfig, applyConfigDefaults} from '/js/config-defaults.js';
import {ACTIONS, sendMessageWithTimeout} from '/js/messages.js';
import {devices} from '/js/devices.js';

const phaseLabels = {
  search: 'Đang tìm kiếm trên máy tính…',
  mobile_pre_clear: 'Đang chuẩn bị tìm kiếm trên điện thoại…',
  mobile_simulation: 'Đang mô phỏng điện thoại…',
  mobile_search: 'Đang tìm kiếm trên điện thoại…',
  post_mobile: 'Đang khôi phục đăng nhập…',
  post_search: 'Đang hoàn tất sau tìm kiếm…',
  activities: 'Đang làm nhiệm vụ Rewards…',
};

let config = createDefaultConfig();
const startButton = document.querySelector('#searchTrigger');
const runStatus = document.querySelector('#runStatus');
const progressText = document.querySelector('#progressText');
const progressFill = document.querySelector('#progressFill');
const progressTrack = document.querySelector('.progressTrack');



async function loadConfig() {
  const stored = await get();
  config = createDefaultConfig();
  applyConfigDefaults(config, stored);
  render();
}

function render() {
  const runtime = config.runtime || {};
  const running = Boolean(runtime.running);
  const done = Math.max(0, Number(runtime.done) || 0);
  const total = Math.max(0, Number(runtime.total) || 0);
  const failed = Math.max(0, Number(runtime.failed) || 0);
  const percent = total ? Math.min(100, Math.round((done / total) * 100)) : 0;

  document.querySelector('#desktopCount').textContent = config.search.desk;
  document.querySelector('#mobileCount').textContent = config.search.mob;
  startButton.textContent = running ? 'Dừng' : 'Start';
  startButton.classList.toggle('stopping', running);
  startButton.disabled = false;
  progressFill.style.width = `${percent}%`;
  progressTrack.setAttribute('aria-valuenow', String(percent));

  if (running) {
    runStatus.textContent = phaseLabels[runtime.currentPhase] || 'Đang chạy…';
    progressText.textContent =
        `${done} / ${total} lượt${failed ? ` · lỗi ${failed}` : ''}`;
  } else if (total > 0 && done >= total) {
    runStatus.textContent =
        failed ? 'Đã hoàn tất, có lượt tìm gặp lỗi.' : 'Đã hoàn tất.';
    progressText.textContent =
        `${done} / ${total} lượt${failed ? ` · lỗi ${failed}` : ''}`;
  } else {
    runStatus.textContent = 'Sẵn sàng chạy theo cấu hình đã lưu.';
    progressText.textContent = '';
  }
}

async function ensureMobileDevice() {
  if (!config.search.mob || config.device?.ua) {
    return;
  }
  const candidates = devices.filter(
      (device) => !/iPhone|iPad|iPod/i.test(device.userAgent || ''),
  );
  const pool = candidates.length ? candidates : devices;
  const device = pool[Math.floor(Math.random() * pool.length)];
  if (!device) {
    return;
  }
  const updated = await atomicUpdate((stored) => {
    const next = createDefaultConfig();
    applyConfigDefaults(next, stored);
    next.device = {
      ...next.device,
      name: device.name,
      ua: device.userAgent,
      h: device.height,
      w: device.width,
      scale: device.deviceScaleFactor,
    };
    return next;
  });
  if (updated) {
    config = updated;
  }
}

async function handleTrigger() {
  startButton.disabled = true;
  try {
    if (config.runtime?.running) {
      runStatus.textContent = 'Đang dừng…';
      const response = await sendMessageWithTimeout({action: ACTIONS.STOP});
      if (response?.success === false) {
        throw new Error(response.message || 'Không dừng được phiên chạy.');
      }
    } else {
      await ensureMobileDevice();
      runStatus.textContent = 'Đang khởi động…';
      const response = await sendMessageWithTimeout({
        action: ACTIONS.START,
        searches: {...config.search},
      });
      if (response?.success === false) {
        throw new Error(response.message || 'Không bắt đầu được.');
      }
    }
    await loadConfig();
  } catch (error) {
    runStatus.textContent = error?.message || 'Không thực hiện được yêu cầu.';
    startButton.disabled = false;
  }
}

startButton.addEventListener('click', handleTrigger);
document.querySelector('#openSettings').addEventListener('click', () => {
  chrome.tabs.create({url: '/options.html'});
});
document.querySelector('#openGuide').addEventListener('click', () => {
  chrome.tabs.create({url: '/manual.html'});
});
document.querySelector('#openDeviceReport').addEventListener('click', () => {
  chrome.tabs.create({url: '/donate.html#deviceReportTitle'});
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes.config) {
    return;
  }
  config = createDefaultConfig();
  applyConfigDefaults(config, changes.config.newValue);
  render();
});

loadConfig().catch((error) => {
  runStatus.textContent = `Không tải được cấu hình: ${error?.message || error}`;
  startButton.disabled = false;
});
