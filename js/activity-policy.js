export function classifyAutomaticTask({
  title,
  url,
  type,
  promotionType,
  visitCompletes,
} = {}) {
const UNSUPPORTED_TASK_PATTERN =
  /quiz|trivia|punch|game|play|purchase|buy|shop|order|download|install|app\b|sweepstake|contest|trắc nghiệm|câu hỏi|đố vui|trò chơi|chơi|mua|đặt hàng|tải|cài đặt/i;

const SIMPLE_TASK_PATTERN =
  /poll|survey|check.?in|claim|collect|view|visit|open|read|watch|explore|search|thăm dò|điểm danh|nhận|xem|đọc|khám phá|tìm kiếm/i;

  const evidence = [title, url, type, promotionType].filter(Boolean).join(" ");
  if (UNSUPPORTED_TASK_PATTERN.test(evidence)) {
    return { safe: false, reason: "unsupported_task" };
  }
  if (visitCompletes || SIMPLE_TASK_PATTERN.test(evidence)) {
    return { safe: true, reason: "simple_task" };
  }
  return { safe: false, reason: "unclear_task" };
}
