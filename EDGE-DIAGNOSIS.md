# Edge Rewards investigation — 2026-09-05

Confirmed on the installed Microsoft Edge 152.0.4191.62, using Playwright
MCP and Playwright Extension 0.4.0 in the user's existing Edge profile.

## Reproduction

After each page reached `status: complete`, call
`chrome.debugger.attach({ tabId }, "1.3")` through the connected extension:

| Page | Result |
| --- | --- |
| https://example.com/ | Attach succeeds |
| https://www.bing.com/ | Attach succeeds |
| https://rewards.bing.com/dashboard | `The extensions gallery cannot be scripted.` |

The Rewards tab exists and loads successfully. The error is raised for that
actual tab, not just for the Playwright connection page. The earlier hypothesis
that Playwright merely selected the wrong tab did not explain this result.

## Effect on Search Auto

The activity engine uses the debugger to inspect Daily set / Keep earning
cards and dispatch pointer input. Edge denies that access before any card can
be scanned or clicked. The previous flow first retried content-script login
checks, then retried attaching, which looked like repeated reloads without work.

## Changes

- Check debugger access before content-script login recovery.
- Treat the observed browser restriction as terminal; no futile retry/reload.
- Persist the reason and show it in the popup even when advanced logs are off.
- Keep failed activity tabs open and do not count failure as completion.
- Verify that an existing debugger is usable by this extension; an attachment
  owned by another client is not proof that Search Auto can send input.

The new access check was run against the live Edge Rewards tab. It returned
`browser_access_blocked` after exactly one attempt.

## Remaining limitation

These changes fix failure handling and expose the actual cause. They do not
remove Edge's site access restriction or demonstrate successful automated
clicks on Rewards in this Edge build. No security settings were disabled.
Manual interaction remains an option. A different browser is a separate
workflow and has not been substituted for the user's Edge account.

Reload Search Auto in `edge://extensions` to load the updated worker. The
running installed worker has not been reloaded by this investigation.
