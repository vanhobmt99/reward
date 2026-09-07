// An empty scan is not proof of completion. Keep recovery bounded and report
// an unresolved state instead of silently treating it as success.
export async function runDailySet({
  inspect,
  scan,
  recover,
  active,
  onPass,
  maxPasses = 35,
  maxRecoveries = 2,
}) {
  let idle = 0;
  let recoveries = 0;
  let state = { status: "unknown" };
  for (let pass = 1; pass <= maxPasses; pass++) {
    if (!active()) return { complete: false, reason: "stopped", state };
    state = await inspect();
    if (!active()) return { complete: false, reason: "stopped", state };
    if (state.status === "complete") return { complete: true, state };
    const result = state.status === "pending" ? await scan(pass) : null;
    if (result) await onPass(result);
    // Scrolling is useful progress; loading/unknown states must eventually
    // recover even if a page-side scanner would ask to retry forever.
    idle =
      result?.retry || result?.clicked > 0 || result?.processed > 0
        ? 0
        : idle + 1;
    if (idle >= 3) {
      if (!active()) return { complete: false, reason: "stopped", state };
      if (recoveries >= maxRecoveries) break;
      await recover(++recoveries, state);
      idle = 0;
    }
  }
  if (!active()) return { complete: false, reason: "stopped", state };
  state = await inspect();
  return {
    complete: state.status === "complete",
    reason: "verification exhausted",
    state,
  };
}
