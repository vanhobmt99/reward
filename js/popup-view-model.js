import { getRemainingDeadlineMs } from "./run-deadline.js";

export const RUN_PHASE_LABELS = Object.freeze({
  search: "Tìm kiếm trên máy tính",
  mobile_pre_clear: "Chuẩn bị tìm kiếm điện thoại",
  mobile_simulation: "Thiết lập điện thoại",
  mobile_search: "Tìm kiếm trên điện thoại",
  post_mobile: "Khôi phục phiên đăng nhập",
  post_search: "Hoàn tất tìm kiếm",
  activities: "Làm nhiệm vụ",
});

const OUTCOME_LABELS = Object.freeze({
  completed: "Hoàn thành",
  uncertain: "Cần kiểm tra",
  failed: "Thất bại",
  skipped: "Đã bỏ qua",
});

const REASON_LABELS = {
  daily_set_manual_tasks: "Còn nhiệm vụ cần làm thủ công",
  activity_unconfirmed: "Nhiệm vụ chưa được xác nhận",
  keep_earning_not_ready: "Trang nhiệm vụ chưa tải xong",
  quota_unavailable: "Chưa đọc được quota", quota_unconfirmed: "Điểm chưa xác nhận",
  quota_stalled: "Điểm chưa tăng, đã tạm nghỉ", deadline_exceeded: "Đã hết thời gian",
  user_requested: "Bạn đã dừng", run_incomplete: "Còn bước chưa xác nhận",
  session_unavailable: "Cần kiểm tra đăng nhập Rewards",
};

export function formatDuration(milliseconds) {
  const seconds = Math.max(0, Math.floor((Number(milliseconds) || 0) / 1000));
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (minutes === 0) return `${rest} giây`;
  if (rest === 0) return `${minutes} phút`;
  return `${minutes} phút ${rest} giây`;
}

export function createPopupRunViewModel(config, now = Date.now()) {
  const runtime = config?.runtime || {};
  const running = Boolean(runtime.running || runtime.stopping || runtime.currentSession);
  const stopping = Boolean(runtime.stopping);
  const total = Math.max(0, Number(runtime.total) || 0);
  const done = Math.max(0, Number(runtime.done) || 0);
  const failed = Math.max(0, Number(runtime.failed) || 0);
  const performed = Math.min(total || done + failed, done + failed);
  const phase = RUN_PHASE_LABELS[runtime.currentPhase] || "Đang chuẩn bị";
  const startedAt = Number(runtime.startedAt) || now;
  const elapsedMs = Math.max(0, now - startedAt);
  const remainingMs = running ? getRemainingDeadlineMs(runtime, now) : null;
  const retry = Math.max(0, Number(runtime.retry) || 0);

  const report = Array.isArray(config?.runReports) ? config.runReports[0] : null;
  const reportOutcome = report?.result?.outcome || null;
  const reportLabel = OUTCOME_LABELS[reportOutcome] || "Chưa có kết quả";

  return {
    running,
    stopping,
    title: stopping ? "Đang dừng an toàn…" : phase,
    detail:
      total > 0
        ? `${performed}/${total} bước${failed ? ` · ${failed} lỗi` : ""}`
        : String(runtime.lastAction || phase),
    meta: running
      ? [
          `Đã chạy ${formatDuration(elapsedMs)}`,
          remainingMs === null
            ? null
            : `còn tối đa ${formatDuration(remainingMs)}`,
          retry > 0 ? `thử lại ${retry}/2` : null,
        ]
          .filter(Boolean)
          .join(" · ")
      : "",
    report: report
      ? {
          outcome: reportOutcome,
          title: reportLabel,
          detail: [
            Number(report.total) > 0 ? `${Number(report.done) || 0}/${Number(report.total)} lượt tìm` : null,
            report.tasks ? `${report.tasks.completed || 0} nhiệm vụ xong · ${report.tasks.uncertain || 0} cần kiểm tra` : null,
            REASON_LABELS[report.result?.reason] || (report.result?.reason ? "Cần kiểm tra kết quả" : null),
            formatDuration(report.durationMs),
          ].filter(Boolean).join(" · "),
        }
      : null,
  };
}
