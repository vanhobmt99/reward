import { getRemainingSearches } from "./search-credit.js";

export const QUOTA_FRESH_MS = 120_000;
export const QUOTA_COOLDOWN_MS = 30 * 60_000;
export function createQuotaSnapshot(snapshot, updatedAt = Date.now()) {
  const clean = { updatedAt };
  for (const key of ["pcProgress", "pcMax", "mobProgress", "mobMax"]) {
    const value = snapshot?.[key];
    clean[key] = typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
  }
  return clean;
}
export function applyQuotaCooldown(plan, cooldown = {}, now = Date.now()) {
  return { ...plan, ...Object.fromEntries(["desk", "mob"].map((key) =>
    [key, Number(cooldown[key]) > now ? 0 : plan[key]])) };
}
export function createQuotaView(config, now = Date.now()) {
  const quota = config?.searchQuota;
  const age = now - Number(quota?.updatedAt || 0);
  const fresh = !quota?.unavailable && Boolean(quota?.updatedAt) && age >= 0 && age < QUOTA_FRESH_MS;
  const rows = [["desk", "pcProgress", "pcMax"], ["mob", "mobProgress", "mobMax"]].map(([key, progress, max]) => {
    const remaining = getRemainingSearches(quota, progress, max);
    const cooldown = Math.max(0, Number(config?.quotaCooldown?.[key] || 0) - now);
    return { key, points: remaining === null ? "Chưa rõ" : `${quota[progress]} / ${quota[max]} điểm`,
      detail: cooldown ? `Thử lại sau ${Math.ceil(cooldown / 60_000)} phút` :
        remaining === null ? "Cần cập nhật" : remaining === 0 ? "Đã đủ" : `Còn ${Math.max(0, quota[max] - quota[progress])} điểm`,
      estimate: cooldown ? 0 : fresh && remaining !== null ? Math.min(remaining, Number(config?.search?.[key]) || 0) : null,
    };
  });
  const estimate = rows.every((row) => row.estimate !== null) ? rows.reduce((n, row) => n + row.estimate, 0) : null;
  return { rows, fresh, meta: `${quota?.updatedAt ? `Cập nhật ${Math.floor(Math.max(0, age) / 60_000)} phút trước` : "Chưa có dữ liệu"}${fresh ? "" : " · cần làm mới"}`,
    estimate: estimate === null ? "Đọc quota trước khi chạy" : `Dự kiến tối đa ${estimate} lượt · ước tính 3 điểm/lượt` };
}
