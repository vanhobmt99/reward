export const ACTIVITY_ISSUE_KEY = '_activityIssue';

/**
 * @typedef {{code: ('browser_access_blocked'|'activity_connection_failed'),
 *     retryable: boolean, detail: string, message: string}} ActivityAccessIssue
 */
/**
 * @typedef {{ok: boolean, error: (!Error|string|undefined)}}
 * ActivityAttachResult
 */
/**
 * @typedef {{tryAttach: function(): !Promise<!ActivityAttachResult>,
 *     active: function(): boolean, pause: function(): (void|!Promise<void>),
 *     userAgent: (string|undefined)}} ActivityAccessProbe
 */
/**
 * @typedef {{ok: boolean, stopped: (boolean|undefined),
 *     issue: (!ActivityAccessIssue|undefined)}} ActivityAccessDecision
 */

/**
 * Turns an attach or scripting failure into a stable code and user text.
 * @param {!Error|string|null|undefined} error Thrown value or message.
 * @param {string=} userAgent Browser UA; an Edge token names Edge in the text.
 * @return {!ActivityAccessIssue} Terminal browser block or a retryable failure.
 */
export function classifyActivityAccessError(error, userAgent = '') {
  const detail =
      String(
          error?.message || error || 'Không kết nối được trình duyệt.',
          )
          .slice(0, 400);
  if (/extensions gallery cannot be scripted|cannot access (?:a )?(?:chrome|edge):\/\/|cannot attach to this target|blocked by (?:the )?(?:administrator|policy)/i
          .test(
              detail,
              )) {
    const browser = /Edg\//.test(userAgent) ? 'Edge' : 'Trình duyệt';
    return {
      code: 'browser_access_blocked',
      retryable: false,
      detail,
      message: `${
          browser} đang chặn extension điều khiển trang Rewards. Không thể tự bấm Daily set, Keep earning hoặc Claim trên trang này. Tab được giữ mở để bạn làm thủ công; tải lại trang không gỡ được chặn.`,
    };
  }
  return {
    code: 'activity_connection_failed',
    retryable: true,
    detail,
    message:
        'Chưa kết nối được với trang Rewards. Tab được giữ mở; kiểm tra trình duyệt rồi thử lại.',
  };
}

/**
 * A browser access restriction is terminal; a transient attach failure gets
 * one retry. Probe before content-script login checks to avoid false reloads.
 * @param {!ActivityAccessProbe} probe Attach attempt, cancellation and pause.
 * @return {!Promise<!ActivityAccessDecision>} Ok, stopped, or a stored issue.
 */
export async function checkActivityAccess({
  tryAttach,
  active,
  pause,
  userAgent,
}) {
  let issue;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (!active()) {
      return {ok: false, stopped: true};
    }
    const result = await tryAttach();
    if (!active()) {
      return {ok: false, stopped: true};
    }
    if (result.ok) {
      return {ok: true};
    }
    issue = classifyActivityAccessError(result.error, userAgent);
    if (!issue.retryable) {
      break;
    }
    if (attempt === 0) {
      await pause();
    }
  }
  return {ok: false, issue};
}
