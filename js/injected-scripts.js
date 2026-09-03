/**
 * Injected activity scripts. Each function returns a self-contained JavaScript
 * source string that the service worker runs in the Rewards page via
 * chrome.debugger Runtime.evaluate. Kept out of service.js so the ~700 lines of
 * page-side DOM logic live in one focused, lint-visible module.
 *
 * They take a list of already-visited card keys (embedded as JSON) and a
 * safety limit on clicks per pass, and return {clicked, skipped, openedKeys,...}.
 */

/**
 * Probe run by waitForRewardsSection. The new dashboard streams a heading +
 * pulse skeletons into the visible <section>, and parks the real cards in a
 * hidden Next.js placeholder (`<div hidden id="S:5">`). Matching any heading
 * that merely lacks animate-pulse treated that hidden copy as "ready" and the
 * first Daily set pass then scanned the empty visible shell.
 */
export function createRewardsSectionReadyProbe(patternSource) {
  return `(() => {
    try {
      const re = new RegExp(${JSON.stringify(patternSource)}, "i");
      const nodes = document.querySelectorAll('h1, h2, h3, h4, [role="heading"]');
      for (const el of nodes) {
        if (!re.test(el.textContent || "")) continue;
        if (el.closest("[hidden], template")) continue;
        const rect = el.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) continue;
        const section = el.closest("section");
        if (!section) return true;
        if (section.querySelector('[class*="animate-pulse"]')) continue;
        return true;
      }
      return false;
    } catch (e) { return false; }
  })()`;
}

/**
 * DOM helpers shared byte-for-byte by the Dashboard and Keep-earning scripts.
 * Emitted once at the top of each IIFE (before any script-specific code) so a
 * fix to normalize/textOf/isVisible/card-targeting/clicking/click bookkeeping
 * lives in a single place.
 *
 * `clickLikeUser` used to be duplicated in both scripts; the two copies had
 * drifted only in comment wording, so a fix to one silently missed the other.
 * `nearestCard` differed in exactly two values, which are now parameters:
 * `cardKeyword` joins the class/testid "looks like a card" probe, and
 * `maxCardTextLength` caps how much text a card may hold.
 *
 * These are all side-effect-free declarations invoked only later in the loop, so
 * the names they reference (`visited`/`seen`/`clicked`/`openedKeys`/
 * `safetyLimit`/`deferToCdp`/`pressPoint`) only need to exist by call time —
 * every caller declares them above this block.
 */
function activityDomHelpers(cardKeyword, maxCardTextLength) {
  return `
			// Set by openTarget whenever it declines a card, so a pass can report why
			// it came back empty instead of returning an unexplained zero.
			let lastOpenSkip = '';
			const normalize = (value) => (value || '').normalize('NFC').replace(/\\s+/g, ' ').trim();
			const mainRoot = document.querySelector('main') || document.body;
			const isPageChrome = (el) => Boolean(
				el?.closest?.('header, footer, nav, [role="banner"], [role="contentinfo"], [role="navigation"], [role="tablist"]')
			);
			const textOf = (el) => {
				const visible = normalize(el?.innerText || el?.textContent || '');
				const accessible = normalize([
					el?.getAttribute?.('aria-label'),
					el?.getAttribute?.('title')
				].filter(Boolean).join(' '));
				if (!visible) return accessible;
				if (!accessible) return visible;
				return visible.toLowerCase().includes(accessible.toLowerCase()) ?
					visible :
					normalize(visible + ' ' + accessible);
			};
			const isVisible = (el) => {
				if (!el) return false;
				const rect = el.getBoundingClientRect();
				const style = getComputedStyle(el);
				return rect.width > 0 && rect.height > 0 &&
					style.display !== 'none' &&
					style.visibility !== 'hidden' &&
					style.opacity !== '0' &&
					el.getAttribute('aria-hidden') !== 'true' &&
					el.getAttribute('aria-disabled') !== 'true' &&
					!el.disabled &&
					rect.top < window.innerHeight && rect.bottom > 0 &&
					rect.left < window.innerWidth && rect.right > 0;
			};
			// Rendered, but NOT required to be inside the viewport. A section keeps
			// its geometry when its heading scrolls off the top; demanding
			// visibility there made a pass "lose" its section the moment it
			// scrolled past the heading, after which it only scrolled further away
			// looking for it ("daily set / keep earning heading not found").
			const hasLayout = (el) => {
				if (!el) return false;
				const rect = el.getBoundingClientRect();
				const style = getComputedStyle(el);
				return rect.width > 0 && rect.height > 0 &&
					style.display !== 'none' &&
					style.visibility !== 'hidden' &&
					style.opacity !== '0' &&
					el.getAttribute('aria-hidden') !== 'true';
			};
			const interactiveSelector = 'a[href], button, [role="button"], [role="link"], [tabindex]:not([tabindex="-1"])';
			// Rewards cards are responsive.  On a narrow window, at non-100% zoom,
			// or in a two-column layout, a perfectly valid card can span almost the
			// whole viewport.  Do not use a fixed desktop-width ceiling to decide
			// whether an ancestor is a card: that made the same card disappear on a
			// second machine with a different viewport.  Page-level containers are
			// rejected separately below.
			const isCardSized = (rect) => {
				const viewportWidth = Math.max(window.innerWidth || 0, 1);
				const viewportHeight = Math.max(window.innerHeight || 0, 1);
				return rect.width >= 96 && rect.height >= 40 &&
					rect.width <= viewportWidth + 2 &&
					rect.height <= Math.max(viewportHeight * 1.5, 720);
			};
			const actionTargetFor = (node) => {
				const card = nearestCard(node);
				const candidates = [
					node.matches?.(interactiveSelector) ? node : null,
					node.closest?.(interactiveSelector),
					...Array.from(card.querySelectorAll?.(interactiveSelector) || [])
				].filter(Boolean);
				const scored = candidates
					.filter((target, index, list) => list.indexOf(target) === index)
					.filter((target) => isVisible(target))
					.map((target) => {
						const rect = target.getBoundingClientRect();
						const text = textOf(target);
						const href = String(target.href || target.closest?.('a[href]')?.href || '');
						let score = Math.min(rect.width * rect.height / 1000, 25);
						if (href) score += 20;
						if (/quiz|poll|punch|quest|activity|explore|dset|offer|reward|msrewards|rewards|trắc nghiệm|thăm dò|câu hỏi|khám phá|hoạt động|nhận|kiếm/i.test(href + ' ' + text)) score += 12;
						if (/completed|learn more|earn more|info|progress|privacy|terms|đã hoàn thành|tìm hiểu thêm|kiếm thêm|thông tin|tiến trình|bảo mật|điều khoản/i.test(text)) score -= 25;
						return { target, score };
					})
					.sort((a, b) => b.score - a.score);
				return scored[0]?.target || card;
			};
			// The Rewards UI renders a card's reward as a bare number in a pill
			// badge ("10", "+5") with no "points"/"pts" word next to it, so the
			// text patterns below never see it and every card reads as worthless.
			// Read the badge out of the DOM instead; null means "no badge here"
			// so callers can still fall back to the text patterns.
			const pointsBadgeValue = (card) => {
				if (!card?.querySelectorAll) return null;
				const pills = card.querySelectorAll(
					'[class*="rewardsbg" i], [class*="cornercircular" i], [class*="badge" i], [class*="pill" i]'
				);
				for (const pill of pills) {
					const match = normalize(pill.textContent || '').match(/^\\+?\\s*(\\d{1,5})$/);
					if (match) return Number(match[1]);
				}
				return null;
			};
			const nearestCard = (node) => {
				const candidates = [];
				let current = node;
				for (let i = 0; current && current !== document.body && i < 12; i++) {
					if (isVisible(current)) {
						const rect = current.getBoundingClientRect();
						const text = textOf(current);
						const className = String(current.className || '');
						const testId = String(current.getAttribute?.('data-testid') || '');
						const looksLikeCard = /card|tile|offer|activity|${cardKeyword}|mee|ctrl|pointer|group/i.test(className + ' ' + testId);
						const tagName = String(current.tagName || '').toLowerCase();
						const broadContainer = /^(main|section|footer|header|nav)$/i.test(tagName) ||
							(rect.width >= Math.max((window.innerWidth || 0) - 2, 1) && rect.height > Math.max((window.innerHeight || 0) * 0.72, 420));
						if (isCardSized(rect) && !broadContainer && text.length >= 8 && text.length <= ${maxCardTextLength} && (looksLikeCard || current.querySelector?.(interactiveSelector))) {
							candidates.push(current);
						}
					}
					current = current.parentElement;
				}
				candidates.sort((a, b) => {
					const ar = a.getBoundingClientRect();
					const br = b.getBoundingClientRect();
					return (ar.width * ar.height) - (br.width * br.height);
				});
				return candidates[0] ||
					node.closest?.('article, li, [class*="card"], [class*="Card"], [class*="tile"], [class*="Tile"], [class*="group/ctrl"], [class*="cursor-pointer"]') ||
					node;
			};
			const clickLikeUser = (target) => {
				const rect = target.getBoundingClientRect();
				const visibleLeft = Math.max(rect.left, 1);
				const visibleRight = Math.min(rect.right, window.innerWidth - 2);
				const visibleTop = Math.max(rect.top, 1);
				const visibleBottom = Math.min(rect.bottom, window.innerHeight - 2);
				// Fully offscreen: elementFromPoint is useless there, but synthetic
				// events + target.click() still work, so probe nothing and fall through.
				const onscreen = visibleRight > visibleLeft && visibleBottom > visibleTop;
				const centerX = onscreen ? (visibleLeft + visibleRight) / 2 : (rect.left + rect.right) / 2;
				const centerY = onscreen ? (visibleTop + visibleBottom) / 2 : (rect.top + rect.bottom) / 2;
				// A card's centre is frequently occupied by a badge, image, or a
				// transient React layer.  Re-evaluate a small grid on every click,
				// rather than assuming one centre coordinate works at every window
				// size and display scale.  All values come from getBoundingClientRect(),
				// so they remain CSS-viewport coordinates for CDP's Input domain.
				const points = onscreen ? [
					[centerX, centerY],
					[visibleLeft + (visibleRight - visibleLeft) * 0.2, visibleTop + (visibleBottom - visibleTop) * 0.2],
					[visibleLeft + (visibleRight - visibleLeft) * 0.8, visibleTop + (visibleBottom - visibleTop) * 0.2],
					[visibleLeft + (visibleRight - visibleLeft) * 0.2, visibleTop + (visibleBottom - visibleTop) * 0.8],
					[visibleLeft + (visibleRight - visibleLeft) * 0.8, visibleTop + (visibleBottom - visibleTop) * 0.8],
					[visibleLeft + Math.min(12, (visibleRight - visibleLeft) / 2), centerY],
					[visibleRight - Math.min(12, (visibleRight - visibleLeft) / 2), centerY],
					[centerX, visibleTop + Math.min(12, (visibleBottom - visibleTop) / 2)],
					[centerX, visibleBottom - Math.min(12, (visibleBottom - visibleTop) / 2)]
				] : [];
				const hit = points
					.map(([x, y]) => ({ x, y, element: document.elementFromPoint(x, y) }))
					.find((point) => point.element && (target.contains(point.element) || target === point.element));
				// No hit means an overlay/toast covers every probe point, or the layout
				// shifted after measuring. Instead of dropping the card (a silent click
				// miss), fall back to dispatching directly on the target: synthetic
				// events + target.click() work regardless of what elementFromPoint sees.
				const x = hit ? hit.x : centerX;
				const y = hit ? hit.y : centerY;
				const eventTarget = hit ? hit.element : target;
				if (deferToCdp) {
					if (hit) {
						pressPoint = { x, y };
						return true;
					}
					// Covered/stale coordinates must fail closed. A synthetic click is
					// ignored by React Aria often enough to poison click bookkeeping, and
					// a trusted press here would hit the overlay instead. Leaving the card
					// unvisited lets popup dismissal / a later pass retry it.
					pressPoint = null;
					return false;
				}
				try {
					target.focus?.({ preventScroll: true });
				} catch (error) {}
				for (const type of ['pointerover', 'mouseover', 'pointerdown', 'mousedown', 'pointerup', 'mouseup']) {
					try {
						const EventCtor = type.startsWith('pointer') && typeof PointerEvent === 'function' ? PointerEvent : MouseEvent;
						eventTarget.dispatchEvent(new EventCtor(type, {
							bubbles: true,
							cancelable: true,
							view: window,
							clientX: x,
							clientY: y,
							screenX: window.screenX + x,
							screenY: window.screenY + y,
							button: 0,
							buttons: type.endsWith('down') ? 1 : 0,
							pointerId: 1,
							pointerType: 'mouse',
							isPrimary: true
						}));
					} catch (error) {}
				}
				if (typeof target.click === 'function') {
					target.click();
				} else {
					eventTarget.dispatchEvent(new MouseEvent('click', {
						bubbles: true,
						cancelable: true,
						view: window,
						clientX: x,
						clientY: y,
						screenX: window.screenX + x,
						screenY: window.screenY + y,
						button: 0
					}));
				}
				return true;
			};
			const keyFor = (target, type, text) => {
				const href = target.href || target.closest?.('a[href]')?.href || '';
				if (href) return href;
				// Viewport coordinates are not an identity. Rewards scrolls/lazy-renders
				// between passes, so coordinate-based keys made the same button look like
				// a different activity and could move a later trusted click onto a
				// neighbour. Prefer DOM identity, then the full card text.
				const semantic = normalize([
					target.id,
					target.getAttribute?.('data-testid'),
					target.getAttribute?.('aria-label'),
					target.getAttribute?.('title')
				].filter(Boolean).join('|')).toLowerCase();
				return type + '|' + (semantic || normalize(text).toLowerCase());
			};
			const openTarget = (target, type, text) => {
				lastOpenSkip = '';
				if (clicked.length >= safetyLimit) return false;
				if (!target || !isVisible(target)) {
					lastOpenSkip = 'target not visible';
					return false;
				}
				const key = keyFor(target, type, text);
				// Already-handled cards are the normal steady state, not a failure:
				// leave lastOpenSkip empty so they stay out of the pass diagnostics.
				if (visited.has(key) || seen.has(key)) return false;
				seen.add(key);
				const htmlStyle = document.documentElement.style.scrollBehavior;
				const bodyStyle = document.body.style.scrollBehavior;
				try {
					document.documentElement.style.scrollBehavior = 'auto';
					document.body.style.scrollBehavior = 'auto';
				} catch (_) {}
				target.scrollIntoView({ behavior: 'instant', block: 'center', inline: 'center' });
				try {
					document.documentElement.style.scrollBehavior = htmlStyle;
					document.body.style.scrollBehavior = bodyStyle;
				} catch (_) {}
				const anchor = target.matches?.('a[href]') ? target : target.closest?.('a[href]');
				let clickedOk = false;
				if (anchor) {
					anchor.target = '_blank';
					anchor.rel = 'noopener noreferrer';
					clickedOk = clickLikeUser(anchor);
				} else {
					clickedOk = clickLikeUser(target);
				}
				if (!clickedOk) {
					lastOpenSkip = 'click point covered';
					return false;
				}
				openedKeys.push(key);
				clicked.push({ type, text: text.slice(0, 90), key });
				return true;
			};`;
}

export function createDashboardActivityScript(
  visitedKeys,
  safetyLimit = 12,
  deferToCdp = false,
) {
  return `
		(function() {
			const clicked = [];
			const skipped = [];
			const openedKeys = [];
			let pressPoint = null;
			const visited = new Set(${JSON.stringify(visitedKeys || [])});
			const seen = new Set();
			const deferToCdp = ${Boolean(deferToCdp)};
			const safetyLimit = ${Number(safetyLimit) || 12};
${activityDomHelpers("daily", 520)}
			const dailySetPattern = /daily set|daily check.?in|today'?s? set|bộ hàng ngày|chuỗi hàng ngày|nhiệm vụ hàng ngày|phần thưởng hàng ngày/i;
			const nextSectionPattern = /your activity|more activities|punch cards?|recommended|quests?|activities|keep earning|hoạt động khác|kiếm thêm/i;
			const doneIconSelector = 'svg[data-icon="checkmark"], svg[class*="check"], [data-icon="completed"], [class*="mee-completed"]';
			const isDone = (el) => {
				const txt = textOf(el).toLowerCase();
				// Status copy on a live card ("In progress", day-check ticks)
				// is not completion. Treat those as open before any icon/class
				// probe, or a multi-day card is marked done on day 1.
				if (/in progress|not started|đang thực hiện|đang diễn ra|chưa bắt đầu/i.test(txt)) return false;
				if (/completed|not eligible|earned last month|already done|claimed|you did it|đã hoàn thành|đã nhận|đã hoàn tất|đã xong|không đủ điều kiện/i.test(txt)) return true;
				// The completion icon is only evidence about THIS card. Probing it on
				// each ancestor searched that ancestor's whole subtree, so a single
				// completed sibling card marked every card in the section as done and
				// the pass skipped the lot. Class names still walk up: a wrapper's
				// "completed" class does describe the card inside it.
				if (el?.querySelector?.(doneIconSelector)) return true;
				let node = el;
				for (let i = 0; node && i < 6; i++) {
					const className = String(node.className || '').toLowerCase();
					if (className.includes('complete') || className.includes('done') || className.includes('is-completed') || className.includes('status-done') || className.includes('checked') || className.includes('finished')) return true;
					node = node.parentElement;
				}
				return false;
			};
			const headingNodes = Array.from(mainRoot.querySelectorAll('h1, h2, h3, h4, [role="heading"], div, span, p'))
				.filter((el) => el.matches?.('h1, h2, h3, h4, [role="heading"]') ? hasLayout(el) : isVisible(el))
				.map((el) => ({
					el,
					text: textOf(el),
					rect: el.getBoundingClientRect(),
					semantic: el.matches?.('h1, h2, h3, h4, [role="heading"]')
				}))
				.filter((item) =>
					item.text.length > 0 &&
					item.text.length < 180 &&
					(item.semantic || item.rect.height <= 96)
				)
				.sort((a, b) => a.rect.top - b.rect.top);
			const semanticHeadings = headingNodes.filter((item) => item.semantic);
			const dailyHeading =
				semanticHeadings.find((item) => dailySetPattern.test(item.text)) ||
				headingNodes
					.filter((item) => item.text.length <= 90 && dailySetPattern.test(item.text))
					.sort((a, b) =>
						(a.rect.width * a.rect.height) - (b.rect.width * b.rect.height)
					)[0];
			if (!dailyHeading) {
				const doc = document.documentElement;
				const maxScroll = Math.max(
					doc.scrollHeight || 0,
					document.body?.scrollHeight || 0
				);
				const canScroll = window.scrollY + window.innerHeight < maxScroll - 20;
				if (canScroll) {
					window.scrollBy({
						top: Math.max(420, Math.floor(window.innerHeight * 0.7)),
						left: 0,
						behavior: 'instant'
					});
					return {
						clicked,
						skipped,
						openedKeys,
						retry: true,
						reason: 'scrolled while looking for Daily set',
						url: location.href
					};
				}
				return {
					clicked,
					skipped,
					openedKeys,
					reason: 'daily set heading not found',
					url: location.href
				};
			}
			// Section boundaries must be real headings. Generic div/span text often
			// contains "activities" inside the first Daily Set card and previously
			// truncated the region before that card, producing a silent click miss.
			const nextHeading = semanticHeadings.find((item) =>
				item.rect.top > dailyHeading.rect.bottom + 4 &&
				nextSectionPattern.test(item.text)
			);
			// The dashboard wraps each block in its own <section> (id="dailyset"), so
			// containment is exact. The geometric fallback below guesses the section
			// ends half a viewport under the heading, which both truncated a tall
			// Daily set (its lower cards were never clicked) and, on a short one,
			// swallowed the following section's cards. Only trust the <section> when
			// it does not also contain the NEXT section's heading.
			const dailySection = dailyHeading.el.closest?.('section');
			const sectionIsExclusive = Boolean(dailySection) && !semanticHeadings.some((item) =>
				item.el !== dailyHeading.el &&
				dailySection.contains(item.el) &&
				nextSectionPattern.test(item.text)
			);
			// A wrapper with display:contents (or an unrendered one) reports a zero
			// box; using it would put the section bounds at 0 and freeze the scroll
			// recovery, so fall back to the heading geometry in that case.
			const rawSectionRect = sectionIsExclusive ? dailySection.getBoundingClientRect() : null;
			const sectionRect = rawSectionRect && rawSectionRect.height > 0 ? rawSectionRect : null;
			const dailyTop = sectionRect ? sectionRect.top : dailyHeading.rect.bottom - 8;
			const dailyBottom = sectionRect ?
				sectionRect.bottom :
				(nextHeading ?
					nextHeading.rect.top - 8 :
					dailyHeading.rect.bottom + Math.max(260, window.innerHeight * 0.5));
			const isInsideDailySet = sectionRect ?
				(el) => dailySection.contains(el) :
				(el) => {
					const rect = el.getBoundingClientRect();
					return rect.bottom >= dailyTop && rect.top < dailyBottom;
				};
			const pointPattern = /\\+\\s*\\d+|\\d+\\s*(points?|pts?|điểm|đ)(?![a-zA-Z0-9_])/i;
			const activityHrefPattern = /quiz|poll|punch|quest|activity|explore|dset|offer|reward|msrewards|rewards/i;
			const activityTextPattern = /quiz|poll|play|watch|explore|search now|complete|claim|check.?in|view|start|earn|trắc nghiệm|thăm dò|câu hỏi|chơi|xem|khám phá|bắt đầu|kiếm|nhận/i;
			// Chrome-only. Never list progress/streak/about/bonus/goal/member/
			// completed — those words sit on real Daily set cards ("In progress",
			// "About this quiz", "Daily Set Streak"). Completion is isDone's job.
			const skipPattern = /learn more|privacy|terms|download app|not eligible|tìm hiểu thêm|giới thiệu|bảo mật|điều khoản|tải ứng dụng|search:\\s*\\d|activity:\\s*\\d|check.?in:\\s*\\d/i;
			const expandPattern = /earn more|show more|see more|view all|load more|more activities|expand|kiếm thêm|xem thêm|hiển thị thêm|mở rộng/i;

			const nodes = Array.from(mainRoot.querySelectorAll(
				'a[href], button, [role="button"], [role="link"], [tabindex]:not([tabindex="-1"]), article, li, [data-testid], [class*="card"], [class*="Card"], [class*="tile"], [class*="Tile"]'
			));
			for (const node of nodes) {
				if (clicked.length >= safetyLimit) break;
				if (!isVisible(node)) continue;

				const card = nearestCard(node);
				const target = actionTargetFor(node);
				if (!target || !isVisible(target)) continue;
				if (isPageChrome(node) || isPageChrome(card) || isPageChrome(target)) continue;
				if (!isInsideDailySet(card)) continue;

				const text = textOf(card) || textOf(target);
				if (!text || text.length < 3) continue;
				if (text.length > 500) continue;

				const anchor = target.matches?.('a[href]') ? target : target.closest?.('a[href]');
				const href = String(target.href || anchor?.href || '').toLowerCase();
				const type = 'daily-set';
				const hasPoints = pointPattern.test(text) || (pointsBadgeValue(card) || 0) > 0;
				// "Earn more" only marks an expander on a card that pays nothing. Real
				// Daily set cards say it inside their description ("Earn more points
				// when your friends search on Bing") and carry their reward in a badge
				// the text patterns cannot see, so testing the text alone dropped
				// point-bearing cards — silently, with no skip reason logged.
				if (!hasPoints && expandPattern.test(text)) continue;

				if (isDone(card) || isDone(target) || (anchor && isDone(anchor))) {
					if (hasPoints || activityHrefPattern.test(href)) {
						skipped.push({ type, text: text.slice(0, 90), reason: 'already done' });
					}
					continue;
				}
				// Point-bearing cards are never chrome. Applying skipPattern to
				// them dropped live Daily set cards whose description mentioned
				// "progress", "streak", or "about".
				if (!hasPoints && skipPattern.test(text)) continue;

				const score =
					(hasPoints ? 4 : 0) +
					(activityHrefPattern.test(href) ? 4 : 0) +
					(activityTextPattern.test(text) ? 2 : 0) +
					2;
				if (score < 3) {
					if (hasPoints) skipped.push({ type, text: text.slice(0, 90), reason: 'low score (' + score + ')' });
					continue;
				}

				if (!openTarget(target, type, text) && hasPoints && lastOpenSkip) {
					skipped.push({ type, text: text.slice(0, 90), reason: lastOpenSkip });
				}
			}

			// Nothing clicked yet: bring the rest of the section into the viewport.
			// isVisible() rejects every off-screen card, so a section that is not
			// fully on screen reports zero and, without a scroll, never gets
			// another look — the Daily set silently never gets clicked.
			if (clicked.length === 0) {
				const loadingRoot = (sectionIsExclusive && dailySection) ?
					dailySection :
					dailyHeading.el.closest?.('section');
				// Visible heading + pulse grid is the Suspense fallback. Without a
				// retry the activity loop treats 3 empty passes as "Daily set idle"
				// and leaves for Keep earning before the cards hydrate.
				if (loadingRoot?.querySelector?.('[class*="animate-pulse"]')) {
					return {
						clicked,
						skipped,
						openedKeys,
						pressPoint,
						retry: true,
						reason: 'daily set cards still loading',
						url: location.href
					};
				}
				const doc = document.documentElement;
				const maxScroll = Math.max(
					doc.scrollHeight || 0,
					document.body?.scrollHeight || 0
				);
				const canScrollDown = window.scrollY + window.innerHeight < maxScroll - 20;
				const below = dailyBottom - (window.innerHeight - 4);
				const scrollStep = Math.max(320, Math.floor(window.innerHeight * 0.6));
				// Section starts below the fold: jump straight to it. Crawling one
				// viewport per pass costs a full score check each time.
				if (dailyTop >= window.innerHeight - 4 && canScrollDown) {
					window.scrollBy({ top: Math.floor(dailyTop) - 40, left: 0, behavior: 'instant' });
					return {
						clicked,
						skipped,
						openedKeys,
						pressPoint,
						retry: true,
						reason: 'scrolled to the Daily set section',
						url: location.href
					};
				}
				// More of the section is below the fold. Never scroll further than
				// its end, so the heading is not pushed off the top for nothing.
				if (below > 40 && canScrollDown) {
					window.scrollBy({
						top: Math.min(scrollStep, Math.ceil(below)),
						left: 0,
						behavior: 'instant'
					});
					return {
						clicked,
						skipped,
						openedKeys,
						pressPoint,
						retry: true,
						reason: 'scrolled for more Daily set cards',
						url: location.href
					};
				}
				// Whole section now sits above the viewport (an earlier scroll
				// overshot it, or the page restored a lower position): come back up
				// instead of reporting an empty section.
				if (dailyBottom < 4 && window.scrollY > 0) {
					window.scrollBy({ top: -scrollStep, left: 0, behavior: 'instant' });
					return {
						clicked,
						skipped,
						openedKeys,
						pressPoint,
						retry: true,
						reason: 'scrolled back up to the Daily set',
						url: location.href
					};
				}
			}

			return {
				clicked,
				skipped,
				openedKeys,
				pressPoint,
				url: location.href
			};
		})()
	`;
}

export function createEarnActivityScript(
  visitedKeys,
  safetyLimit = 12,
  deferToCdp = false,
) {
  return `
		(function() {
			const clicked = [];
			const skipped = [];
			const openedKeys = [];
			let pressPoint = null;
			const visited = new Set(${JSON.stringify(visitedKeys || [])});
			const seen = new Set();
			const deferToCdp = ${Boolean(deferToCdp)};
			const safetyLimit = ${Number(safetyLimit) || 12};
${activityDomHelpers("earn", 560)}
			const skipReasonFor = (el) => {
				const txt = textOf(el).toLowerCase();
				if (/silver level required|gold level required|level required|required|not eligible|locked|yêu cầu cấp|yêu cầu trình độ|bị khóa/i.test(txt)) {
					return 'required or locked';
				}
				// Day-check ticks live inside an "In progress" card. The icon
				// probe below would otherwise condemn the whole card as done.
				if (/in progress|not started|đang thực hiện|đang diễn ra|chưa bắt đầu/i.test(txt)) {
					return '';
				}
				if (/completed|earned last month|already done|claimed|you did it|đã hoàn thành|đã nhận|đã hoàn tất|đã xong/i.test(txt)) {
					return 'already completed';
				}
				const lockProbe = Array.from(el.querySelectorAll('[aria-label], [title], [class]'))
					.some((node) => /lock|locked|level required|required|bị khóa|yêu cầu/i.test([
						node.getAttribute('aria-label'),
						node.getAttribute('title'),
						String(node.className || '')
					].filter(Boolean).join(' ')));
				if (lockProbe) return 'required or locked';
				// Same as the Daily set pass: the completion icon only says something
				// about this card, so probe it here and not on every ancestor (which
				// searched their whole subtree and condemned every sibling card).
				if (el?.querySelector?.('svg[data-icon="checkmark"], svg[class*="check"], [data-icon="completed"], [class*="mee-completed"]')) {
					return 'already completed';
				}
				let node = el;
				for (let i = 0; node && i < 6; i++) {
					const className = String(node.className || '').toLowerCase();
					if (className.includes('locked') || className.includes('required')) return 'required or locked';
					if (className.includes('complete') || className.includes('done') || className.includes('is-completed') || className.includes('status-done') || className.includes('checked') || className.includes('finished')) return 'already completed';
					node = node.parentElement;
				}
				return '';
			};
			const markerNodes = Array.from(mainRoot.querySelectorAll('h1, h2, h3, [role="heading"], div, span, p'))
				.filter((el) => el.matches?.('h1, h2, h3, [role="heading"]') ? hasLayout(el) : isVisible(el))
				.map((el) => ({
					el,
					text: textOf(el),
					rect: el.getBoundingClientRect(),
					semantic: el.matches?.('h1, h2, h3, [role="heading"]')
				}))
				.filter((item) => item.text.length > 0 && item.text.length < 160)
				.sort((a, b) => a.rect.top - b.rect.top);
			const keepHeadingPattern = /keep earning|more activities|more points|earn more|kiếm thêm|hoạt động khác|tiếp tục kiếm|kiếm điểm thêm/i;
			// Prefer a real heading so the "Earn more" CTA span on the Daily set
			// page cannot steal the Keep earning anchor.
			const keepHeading =
				markerNodes.find((item) => item.semantic && item.text.length <= 48 && keepHeadingPattern.test(item.text)) ||
				markerNodes.find((item) => item.text.length <= 48 && keepHeadingPattern.test(item.text));
			if (!keepHeading) {
				const doc = document.documentElement;
				const maxScroll = Math.max(
					doc.scrollHeight || 0,
					document.body?.scrollHeight || 0
				);
				const canScroll = window.scrollY + window.innerHeight < maxScroll - 20;
				if (canScroll) {
					window.scrollBy({
						top: Math.max(520, Math.floor(window.innerHeight * 0.85)),
						left: 0,
						behavior: 'instant'
					});
				}
				return {
					clicked,
					skipped,
					openedKeys,
					pressPoint,
					retry: canScroll,
					reason: canScroll ?
						'scrolled while looking for Keep earning' :
						'keep earning heading not found',
					url: location.href
				};
			}
			const nextHeading = markerNodes.find((item) =>
				item.rect.top > keepHeading.rect.bottom + 4 &&
				item.semantic &&
				!keepHeadingPattern.test(item.text)
			);
			// Same exclusive-<section> rule as Daily set. Geometric
			// heading→next-heading bounds truncated a tall Keep earning grid
			// and, on a short one, swallowed the following section.
			const keepSection = keepHeading.el.closest?.('section');
			const sectionIsExclusive = Boolean(keepSection) && !markerNodes.some((item) =>
				item.semantic &&
				item.el !== keepHeading.el &&
				keepSection.contains(item.el) &&
				!keepHeadingPattern.test(item.text)
			);
			const rawSectionRect = sectionIsExclusive ? keepSection.getBoundingClientRect() : null;
			const sectionRect = rawSectionRect && rawSectionRect.height > 0 ? rawSectionRect : null;
			const keepTop = sectionRect ? sectionRect.top : keepHeading.rect.bottom - 8;
			const earnBottom = sectionRect ?
				sectionRect.bottom :
				(nextHeading ? nextHeading.rect.top - 8 : Number.POSITIVE_INFINITY);
			const isInsideEarnArea = sectionRect ?
				(el) => keepSection.contains(el) :
				(el) => {
					const rect = el.getBoundingClientRect();
					return rect.bottom >= keepTop && rect.top < earnBottom;
				};
			const nonCardPattern = /privacy|terms|dashboard only|no points|redeem|donate|gift card|sweepstake|entries|coupon|discount|cashback/i;
			const activityHrefPattern = /quiz|poll|punch|quest|activity|explore|dset|offer|reward|msrewards|rewards/i;
			const activityTextPattern = /quiz|poll|play|watch|explore|search now|complete|claim|check.?in|view|start|earn|tr\\u1eafc nghi\\u1ec7m|th\\u0103m d\\u00f2|c\\u00e2u h\\u1ecfi|ch\\u01a1i|xem|kh\\u00e1m ph\\u00e1|b\\u1eaft \\u0111\\u1ea7u|ki\\u1ebfm|nh\\u1eadn/i;
			const fallbackSkipPattern = /learn more|privacy|terms|download app|redeem|donate|gift card|sweepstake|entries|coupon|discount|cashback|search:\\s*\\d|activity:\\s*\\d|check.?in:\\s*\\d/i;
			const fallbackCandidates = [];
			const rewardPointsPattern = /(?:^|[^\\d])\\+\\s*[1-9]\\d*(?:\\s*(?:points?|pts?|điểm|đ))?(?![a-zA-Z0-9_])|(?:^|[^\\d])(?:[1-9]\\d*)\\s*(?:points?|pts?|điểm|đ)(?![a-zA-Z0-9_])/i;
			const zeroPointsPattern = /(?:^|[^\\d])(?:\\+\\s*)?0\\s*(?:points?|pts?|điểm|đ)(?![a-zA-Z0-9_])/i;
			const nodes = Array.from(mainRoot.querySelectorAll(
				'a[href], button, [role="button"], [role="link"], [tabindex]:not([tabindex="-1"]), article, li, [data-testid], [class*="card"], [class*="Card"], [class*="tile"], [class*="Tile"]'
			));
			for (const node of nodes) {
				if (clicked.length >= safetyLimit) break;
				if (!isVisible(node)) continue;

				const card = nearestCard(node);
				const target = actionTargetFor(node);
				if (!target || !isVisible(target)) continue;
				if (isPageChrome(node) || isPageChrome(card) || isPageChrome(target)) continue;
				if (!isInsideEarnArea(card)) continue;

				const text = textOf(card) || textOf(target);
				if (!text || text.length < 3 || text.length > 520) continue;

				const anchor = target.matches?.('a[href]') ? target : target.closest?.('a[href]');
				const href = String(target.href || anchor?.href || '').toLowerCase();
				const type = 'keep-earning';
				const skipReason = skipReasonFor(card) || skipReasonFor(target) || (anchor ? skipReasonFor(anchor) : '');
				if (skipReason) {
					skipped.push({ type, text: text.slice(0, 90), reason: skipReason });
					continue;
				}
				if (nonCardPattern.test(text)) {
					skipped.push({ type, text: text.slice(0, 90), reason: 'not an earn-points card' });
					continue;
				}
				// Badge wins when the card has one: it is the authoritative reward
				// value. Only cards with no badge at all fall back to reading the
				// point value out of the flattened text.
				const badgePoints = pointsBadgeValue(card);
				const hasPoints =
					badgePoints === null ?
						(rewardPointsPattern.test(text) && !zeroPointsPattern.test(text)) :
						badgePoints > 0;
				if (!hasPoints) {
					const fallbackScore =
						(activityHrefPattern.test(href) ? 4 : 0) +
						(activityTextPattern.test(text) ? 3 : 0) +
						(/start|claim|complete|check.?in|view|play|watch|explore|earn|b\\u1eaft \\u0111\\u1ea7u|nh\\u1eadn|xem|ch\\u01a1i|kh\\u00e1m ph\\u00e1|ki\\u1ebfm/i.test(text) ? 2 : 0);
					if (
						fallbackScore >= 4 &&
						!fallbackSkipPattern.test(text) &&
						(href || target.matches?.('button, [role="button"], [role="link"], [tabindex]:not([tabindex="-1"])')) &&
						!fallbackCandidates.some((item) => item.target === target)
					) {
						fallbackCandidates.push({ target, type, text, score: fallbackScore });
					}
					skipped.push({ type, text: text.slice(0, 90), reason: 'no visible points' });
					continue;
				}
				if (!href && !target.matches?.('button, [role="button"], [role="link"], [tabindex]:not([tabindex="-1"])')) continue;

				if (!openTarget(target, type, text) && lastOpenSkip) {
					skipped.push({ type, text: text.slice(0, 90), reason: lastOpenSkip });
				}
			}

			if (clicked.length === 0) {
				const loadingRoot = (sectionIsExclusive && keepSection) ?
					keepSection :
					keepHeading.el.closest?.('section');
				if (loadingRoot?.querySelector?.('[class*="animate-pulse"]')) {
					return {
						clicked,
						skipped,
						openedKeys,
						pressPoint,
						retry: true,
						reason: 'keep earning cards still loading',
						url: location.href
					};
				}
				const doc = document.documentElement;
				const maxScroll = Math.max(
					doc.scrollHeight || 0,
					document.body?.scrollHeight || 0
				);
				const canScrollDown = window.scrollY + window.innerHeight < maxScroll - 20;
				const below = Number.isFinite(earnBottom) ?
					earnBottom - (window.innerHeight - 4) :
					0;
				const scrollStep = Math.max(320, Math.floor(window.innerHeight * 0.6));
				if (keepTop >= window.innerHeight - 4 && canScrollDown) {
					window.scrollBy({ top: Math.floor(keepTop) - 40, left: 0, behavior: 'instant' });
					return {
						clicked,
						skipped,
						openedKeys,
						pressPoint,
						retry: true,
						reason: 'scrolled to the Keep earning section',
						url: location.href
					};
				}
				if (below > 40 && canScrollDown) {
					window.scrollBy({
						top: Math.min(scrollStep, Math.ceil(below)),
						left: 0,
						behavior: 'instant'
					});
					return {
						clicked,
						skipped,
						openedKeys,
						pressPoint,
						retry: true,
						reason: 'scrolled for more earn cards',
						url: location.href
					};
				}
				if (Number.isFinite(earnBottom) && earnBottom < 4 && window.scrollY > 0) {
					window.scrollBy({ top: -scrollStep, left: 0, behavior: 'instant' });
					return {
						clicked,
						skipped,
						openedKeys,
						pressPoint,
						retry: true,
						reason: 'scrolled back up to Keep earning',
						url: location.href
					};
				}
				if (!Number.isFinite(earnBottom) && canScrollDown) {
					window.scrollBy({
						top: Math.max(520, Math.floor(window.innerHeight * 0.85)),
						left: 0,
						behavior: 'instant'
					});
					return {
						clicked,
						skipped,
						openedKeys,
						pressPoint,
						retry: true,
						reason: 'scrolled for more earn cards',
						url: location.href
					};
				}
				fallbackCandidates.sort((a, b) => b.score - a.score);
				for (const candidate of fallbackCandidates) {
					if (openTarget(candidate.target, candidate.type, candidate.text)) {
						break;
					}
				}
			}

			return {
				clicked,
				skipped,
				openedKeys,
				pressPoint,
				url: location.href
			};
		})()
	`;
}

export function createSolveActivityScript(deferToCdp = false) {
  return `
			(function() {
				const deferToCdp = ${Boolean(deferToCdp)};
				const normalize = (value) => (value || '').replace(/\\s+/g, ' ').trim();
				const isVisible = (el) => {
					if (!el) return false;
					const rect = el.getBoundingClientRect();
					const style = getComputedStyle(el);
					return rect.width > 0 && rect.height > 0 &&
						style.display !== 'none' &&
						style.visibility !== 'hidden' &&
						style.opacity !== '0' &&
						!el.disabled &&
						el.getAttribute('aria-disabled') !== 'true' &&
						rect.top < window.innerHeight && rect.bottom > 0 &&
						rect.left < window.innerWidth && rect.right > 0;
				};
				const clickTargetFor = (el) =>
					el.closest('button, a[href], [role="button"], [role="radio"], [tabindex]:not([tabindex="-1"])') ||
					el.closest('label') ||
					el;
				const prioritySelectors = [
					'input[type="radio"]:not(:checked)',
					'a[href*="WQCI" i][href*="WQId" i][href*="BTJQOD" i]',
					'[data-option-index]',
					'[data-testid*="answer" i]',
					'[data-testid*="option" i]',
					'.rqOption', '.rq_button', '.wk_choicesInstLink', '.bt_option', '.quizOption',
					'[role="radio"]',
					'[class*="option"]',
					'[role="button"]',
					'button',
					'[aria-label]',
				];
				const rejectText = /share|see results|feedback|close|back|sign in|skip|settings|privacy|terms|dashboard|rewards home|^search$|images|videos|maps|news|shopping|copilot/i;
				const hardRejectText = /download|install|add to|extension|browser extension|subscribe|subscription|trial|set default|make default|open app|get app|mobile app|redeem|gift card|coupon|discount|cashback|shop now|buy now|donate|sweepstake|entries/i;
				const hardRejectHref = /chrome\\.google|microsoftedge\\.microsoft\\.com|apps\\.microsoft\\.com|\\/rewards\\/redeem|shopping|cashback|coupon|discount|subscribe|download|install/i;
				const preferText = /answer|option|choice|start|play|next|continue|submit|quiz|poll|true|false/i;
				const rewardPage = /quiz|poll|rewards|bing\\.com\\/search/i.test(location.href + ' ' + document.title);
				const isSearchActivity = /bing\\.com\\/search/i.test(location.href);
				if (isSearchActivity && !sessionStorage.getItem('rsaSearchActivityViewed')) {
					sessionStorage.setItem('rsaSearchActivityViewed', '1');
					window.scrollBy({
						top: Math.max(300, Math.floor(window.innerHeight * 0.75)),
						left: 0,
						behavior: 'smooth'
					});
					return {
						// Scrolling is preparation, not a click. The service worker used
						// to treat this as a trusted-click candidate, require a missing
						// targetKey/pressPoint, and abort before the quiz answers rendered.
						clicked: false,
						retry: true,
						text: 'viewed Bing search results',
						url: location.href
					};
				}
				const seen = new Set();
				const scored = [];
				for (let pri = 0; pri < prioritySelectors.length; pri++) {
					for (const candidate of document.querySelectorAll(prioritySelectors[pri])) {
						if (seen.has(candidate)) continue;
						seen.add(candidate);
						const target = clickTargetFor(candidate);
						if (!isVisible(target)) continue;
						if (target.getAttribute('aria-checked') === 'true') continue;
						if (target.getAttribute('aria-pressed') === 'true') continue;
						const text = normalize(target.innerText || target.textContent || target.value || target.getAttribute('aria-label') || candidate.getAttribute('aria-label'));
						const href = String(target.href || target.closest('a[href]')?.href || '');
						const combinedText = normalize([text, target.getAttribute('aria-label'), target.getAttribute('title'), candidate.getAttribute('aria-label'), href].filter(Boolean).join(' '));
						if (hardRejectText.test(combinedText) || hardRejectHref.test(href)) continue;
						const hasRadio = candidate.matches('input[type="radio"]') || target.getAttribute('role') === 'radio';
						const className = String(candidate.className || target.className || '');
						const hasRewardClass = /option|answer|choice|quiz|poll|rq|wk_|bt_/i.test(className);
						const isUsefulText = text.length > 0 && text.length < 160 && !rejectText.test(text);
						const isPlainRewardButton = rewardPage && target.tagName === 'BUTTON' && isUsefulText && preferText.test(text);
						const isDataOption = candidate.hasAttribute('data-option-index') || /answer|option/i.test(candidate.getAttribute('data-testid') || '');
						const isBingQuizAnswer = candidate.matches('a[href*="WQCI" i][href*="WQId" i][href*="BTJQOD" i]');
						if (!hasRadio && !hasRewardClass && !preferText.test(text) && !isPlainRewardButton && !isDataOption && !isBingQuizAnswer) continue;
						if (rejectText.test(text)) continue;
						let score = pri * 10;
						if (preferText.test(text)) score -= 15;
						if (hasRadio || hasRewardClass || isDataOption || isBingQuizAnswer) score -= 10;
						scored.push({ target, text, score });
					}
				}
				scored.sort((a, b) => a.score - b.score);
				if (scored.length > 0) {
					const { target, text } = scored[0];
					const targetKey = normalize([
						target.id,
						target.getAttribute?.('data-testid'),
						target.getAttribute?.('aria-label'),
						target.getAttribute?.('title'),
						target.getAttribute?.('name'),
						target.value,
						target.href,
						text
					].filter(Boolean).join('|')).toLowerCase();
					const htmlStyle = document.documentElement.style.scrollBehavior;
					const bodyStyle = document.body.style.scrollBehavior;
					try {
						document.documentElement.style.scrollBehavior = 'auto';
						document.body.style.scrollBehavior = 'auto';
					} catch (_) {}
					target.scrollIntoView({ behavior: 'instant', block: 'center', inline: 'center' });
					try {
						document.documentElement.style.scrollBehavior = htmlStyle;
						document.body.style.scrollBehavior = bodyStyle;
					} catch (_) {}
					const rect = target.getBoundingClientRect();
					const cx = Math.max(1, Math.min(window.innerWidth - 2, rect.left + rect.width / 2));
					const cy = Math.max(1, Math.min(window.innerHeight - 2, rect.top + rect.height / 2));
					const hit = document.elementFromPoint?.(cx, cy);
					if (deferToCdp) {
						if (!hit || !(target === hit || target.contains(hit))) {
							return { clicked: false, reason: 'target covered or moved', url: location.href };
						}
						return {
							clicked: true,
							text: text.slice(0, 80) || target.tagName,
							targetKey,
							pressPoint: { x: cx, y: cy },
							url: location.href
						};
					}
					target.click();
					return { clicked: true, text: text.slice(0, 80) || target.tagName, url: location.href };
				}
				return { clicked: false, url: location.href };
			})()
`;
}

/**
 * Silent "Ready to claim" collector. Runs on the Rewards dashboard AFTER Daily
 * set + Keep earning finish. Finds the pending-points card (label "Ready to
 * claim" with a count) and clicks it to collect; on later passes it also clicks
 * any short "Claim/Collect" confirm control that a previous click revealed.
 * Returns {clicked, count, text, reason}; the service worker confirms real
 * collection via the score delta and stops when nothing changes.
 */
export function createClaimReadyScript(
  deferToCdp = false,
  allowStandaloneConfirm = false,
) {
  return `
			(function() {
				const deferToCdp = ${Boolean(deferToCdp)};
				const allowStandaloneConfirm = ${Boolean(allowStandaloneConfirm)};
				const normalize = (v) => (v || '').replace(/\\s+/g, ' ').trim();
				const isVisible = (el) => {
					if (!el) return false;
					const rect = el.getBoundingClientRect();
					const style = getComputedStyle(el);
					return rect.width > 0 && rect.height > 0 &&
						style.display !== 'none' &&
						style.visibility !== 'hidden' &&
						style.opacity !== '0' &&
						el.getAttribute('aria-hidden') !== 'true' &&
						el.getAttribute('aria-disabled') !== 'true' &&
						!el.disabled;
				};
				const textOf = (el) => normalize(
					(el.innerText || el.textContent || '') + ' ' +
					((el.getAttribute && (el.getAttribute('aria-label') || el.getAttribute('title'))) || '')
				);
				const readyPattern = /ready to claim|to be claimed|claim your|unclaimed|pending points?|points? (are )?ready|sẵn sàng nhận|chờ nhận|điểm chờ|chưa nhận|điểm chưa nhận/i;
				const claimWordPattern = /\\b(claim all|collect all|claim now|claim|collect|nhận tất cả|nhận ngay|nhận điểm|nhận)\\b/i;
				const rejectPattern = /redeem|gift card|donate|sweepstake|history|order|đổi thưởng|đổi quà|đổi điểm/i;
				const clickableSelector = 'button, a[href], [role="button"], [aria-expanded], [data-react-aria-pressable], [data-pressable], [tabindex]:not([tabindex="-1"])';
				const clickables = Array.from(
					document.querySelectorAll(clickableSelector)
				);

				// Locate the ready-to-claim card and its pending count, if present.
				let readyCard = null;
				let pendingCount = null;
				const readyCandidates = Array.from(new Set([
					...clickables,
					...document.querySelectorAll('[data-testid], article, section, [class*="claim" i], [class*="pending" i]')
				]));
				for (const el of readyCandidates) {
					if (!isVisible(el)) continue;
					const t = textOf(el);
					if (t.length <= 500 && readyPattern.test(t) && !rejectPattern.test(t)) {
						// "1,250" splits into [1, 250] under \\b\\d+\\b, so strip thousands
						// separators first, then prefer the number that actually follows
						// the ready-to-claim label over the largest number on the card
						// (a wrapper can also carry the "Available points" balance).
						const compact = t.replace(/(\\d)[,.\\u00a0\\u202f](?=\\d{3}(?!\\d))/g, '$1');
						const labelled = compact.match(
							/(?:ready to claim|to be claimed|claim your|unclaimed|pending points?|sẵn sàng nhận|chờ nhận|điểm chờ|chưa nhận)\\D{0,12}(\\d+)/i
						);
						const numbers = (compact.match(/\\b\\d+\\b/g) || []).map(Number).filter(Number.isFinite);
						const n = labelled ?
							Number(labelled[1]) :
							(numbers.length ? Math.max(...numbers) : null);
						// Explicit "0" on the ready card means nothing is pending:
						// record it so the zero short-circuit below fires instead of
						// falling through to hunt (and possibly mis-click) a confirm.
						if (n === 0) { pendingCount = 0; break; }
						readyCard = el.matches?.(clickableSelector) ?
							el :
							(el.querySelector?.(clickableSelector) || el.closest?.(clickableSelector));
						if (readyCard) { pendingCount = n; break; }
					}
				}

				if (pendingCount === 0) {
					return { clicked: false, count: 0, reason: 'nothing pending' };
				}

				// Two-step flow: clicking the card opens a claim dialog whose own
				// button actually collects the points. So on each pass we PREFER a
				// short "Claim points / Collect" confirm control (the dialog action);
				// only if none exists yet do we click the card to open the dialog.
				let target = null;
				let targetText = '';
				let stage = '';
				const visibleDialogs = Array.from(
					document.querySelectorAll('[role="dialog"], [aria-modal="true"], [data-testid*="dialog" i], [class*="dialog" i], [class*="modal" i]')
				).filter(isVisible);
				const confirmClickables = visibleDialogs.length ?
					visibleDialogs.flatMap((root) => Array.from(root.querySelectorAll(clickableSelector))) :
					(allowStandaloneConfirm ? clickables : []);
				for (const el of confirmClickables) {
					if (!isVisible(el)) continue;
					const t = textOf(el);
					if (t.length > 60) continue; // confirm buttons are short
					if (readyPattern.test(t)) continue; // never the card itself
					if (claimWordPattern.test(t) && !rejectPattern.test(t)) {
						target = el;
						targetText = t;
						stage = 'confirm';
						break;
					}
				}
				const claimFlowActive = allowStandaloneConfirm || visibleDialogs.length > 0;
				if (!target && readyCard && !claimFlowActive) {
					target = readyCard;
					targetText = textOf(readyCard);
					stage = 'open';
				}
				if (!target && claimFlowActive) {
					return {
						clicked: false,
						retry: true,
						count: pendingCount === null ? -1 : pendingCount,
						reason: 'claim confirmation not ready',
					};
				}

				if (!target) {
					const doc = document.documentElement;
					const maxScroll = Math.max(doc.scrollHeight || 0, document.body?.scrollHeight || 0);
					const canScroll = visibleDialogs.length === 0 &&
						window.scrollY + window.innerHeight < maxScroll - 20;
					if (canScroll) {
						window.scrollBy({
							top: Math.max(420, Math.floor(window.innerHeight * 0.75)),
							left: 0,
							behavior: 'instant'
						});
						return {
							clicked: false,
							retry: true,
							count: pendingCount === null ? -1 : pendingCount,
							reason: 'scrolled while looking for claim control',
						};
					}
					return {
						clicked: false,
						count: pendingCount === null ? 0 : pendingCount,
						reason: 'no claim control found',
					};
				}

				const targetIdentity = normalize([
					target.id,
					target.getAttribute?.('data-testid'),
					target.getAttribute?.('aria-label'),
					target.getAttribute?.('title'),
					target.getAttribute?.('name'),
					target.href,
					targetText
				].filter(Boolean).join('|')).toLowerCase();
				const targetKey = stage + '|' + targetIdentity;
				const htmlStyle = document.documentElement.style.scrollBehavior;
				const bodyStyle = document.body.style.scrollBehavior;
				try {
					document.documentElement.style.scrollBehavior = 'auto';
					document.body.style.scrollBehavior = 'auto';
					target.scrollIntoView({ behavior: 'instant', block: 'center', inline: 'center' });
				} catch (_) {}
				try {
					document.documentElement.style.scrollBehavior = htmlStyle;
					document.body.style.scrollBehavior = bodyStyle;
				} catch (_) {}
				// Microsoft Rewards cards/buttons are React Aria pressables
				// (data-react-aria-pressable): usePress listens on pointerdown/up
				// and IGNORES a bare element.click(). Dispatch a full pointer +
				// mouse press sequence so the press actually registers.
				const pressPoint = (function press(el) {
					const rect = el.getBoundingClientRect();
					const visibleLeft = Math.max(rect.left, 1);
					const visibleRight = Math.min(rect.right, window.innerWidth - 2);
					const visibleTop = Math.max(rect.top, 1);
					const visibleBottom = Math.min(rect.bottom, window.innerHeight - 2);
					if (visibleRight <= visibleLeft || visibleBottom <= visibleTop) return null;
					const cx = (visibleLeft + visibleRight) / 2;
					const cy = (visibleTop + visibleBottom) / 2;
					const points = [
						[cx, cy],
						[visibleLeft + Math.min(12, (visibleRight - visibleLeft) / 2), cy],
						[visibleRight - Math.min(12, (visibleRight - visibleLeft) / 2), cy],
						[cx, visibleTop + Math.min(12, (visibleBottom - visibleTop) / 2)],
						[cx, visibleBottom - Math.min(12, (visibleBottom - visibleTop) / 2)]
					];
					const hit = points
						.map(([x, y]) => ({ x, y, element: document.elementFromPoint?.(x, y) }))
						.find((point) => point.element && (el === point.element || el.contains(point.element)));
					if (deferToCdp) return hit ? { x: hit.x, y: hit.y } : null;
					const x = hit?.x ?? cx;
					const y = hit?.y ?? cy;
					const base = { bubbles: true, cancelable: true, composed: true, view: window, clientX: x, clientY: y, button: 0, buttons: 1 };
					const pbase = Object.assign({}, base, { pointerId: 1, pointerType: 'mouse', isPrimary: true, width: 1, height: 1 });
					const up = { buttons: 0 };
					const PE = typeof PointerEvent !== 'undefined' ? PointerEvent : MouseEvent;
					const ME = typeof MouseEvent !== 'undefined' ? MouseEvent : Event;
					const fire = (Ctor, type, opts) => { try { el.dispatchEvent(new Ctor(type, opts)); } catch (_) {} };
					fire(PE, 'pointerover', pbase);
					fire(PE, 'pointerenter', pbase);
					fire(PE, 'pointerdown', pbase);
					fire(ME, 'mousedown', base);
					fire(PE, 'pointerup', Object.assign({}, pbase, up));
					fire(ME, 'mouseup', Object.assign({}, base, up));
					fire(ME, 'click', Object.assign({}, base, up));
					try { el.click(); } catch (_) {}
					return { x, y };
				})(target);
				if (!pressPoint) {
					return {
						clicked: false,
						retry: true,
						stage,
						count: pendingCount === null ? -1 : pendingCount,
						targetKey,
						reason: 'target covered or moved',
					};
				}
				return {
					clicked: true,
					stage: stage,
					count: pendingCount === null ? -1 : pendingCount,
					text: targetText.slice(0, 80),
					targetKey,
					pressPoint,
				};
			})()
`;
}
