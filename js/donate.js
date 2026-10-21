import {sendTelemetryOnce, isTelemetryConfigured, TELEMETRY_ENDPOINT} from '/js/telemetry.js';

document.getElementById('closeDonate')?.addEventListener('click', () => {
  window.close();
});

const sendButton = document.getElementById('sendDeviceReport');
const status = document.getElementById('deviceReportStatus');
const receiver = document.getElementById('deviceReportReceiver');
const configured = isTelemetryConfigured();
sendButton.disabled = !configured;
receiver.textContent =
    configured ? TELEMETRY_ENDPOINT : 'Chưa cấu hình nơi nhận';

const statusMessages = {
  'sent': 'Đã gửi báo cáo. Cảm ơn bạn!',
  'already-sent': 'Profile này đã gửi báo cáo thành công trước đó.',
  'busy': 'Một trang khác đang gửi báo cáo. Vui lòng thử lại sau.',
  'unsupported':
      'Trình duyệt này chưa hỗ trợ gửi báo cáo an toàn giữa các trang.',
  'failed': 'Không gửi được báo cáo. Bạn có thể bấm gửi lại khi muốn.',
};
sendButton.addEventListener('click', async () => {
  sendButton.disabled = true;
  status.textContent = 'Đang đọc và gửi báo cáo thiết bị…';
  try {
    const result = await sendTelemetryOnce(TELEMETRY_ENDPOINT, {consent: true});
    status.textContent = statusMessages[result.status] || 'Chưa gửi báo cáo.';
    sendButton.disabled = ['sent', 'already-sent'].includes(result.status);
  } catch {
    status.textContent = statusMessages.failed;
    sendButton.disabled = false;
  }
});
