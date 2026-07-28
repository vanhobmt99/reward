// ── Bing DOM selectors, in one place so a Bing markup change is a one-line fix.
// (MV3 content scripts are classic scripts and cannot `import`; action names
// mirror js/messages.js CONTENT_ACTIONS and must stay in sync.)
const SELECTORS = {
  mobileHamburger: "#mHamburger",
  mobileMenu: "#HBContent",
  mobileSignInLink:
    "#HBSignIn a[role='menuitem']:not([style*='display: none'])",
  desktopSignIn: ".b_clickarea",
  desktopMenu: "#rewid-f",
  searchInput: "#sb_form_q",
  searchSubmitById: "#sb_form_go",
  searchSubmitByClass: ".b_searchboxSubmit",
  dashboardPopupClose: ".dashboardPopUpPopUpCloseButton",
};
const LOGGED_IN_HREF = "account.microsoft.com";
const SIGN_IN_HREF = "/fd/auth/signin";

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  (async () => {
    try {
      switch (request.action) {
        case "ping": {
          sendResponse({
            success: true,
            message: "pong",
          });
          console.log("Tab is active:", request.tabId);

          break;
        }
        case "login": {
          const mobile = request.mobile;
          if (mobile) {
            const mclick = document.querySelector(SELECTORS.mobileHamburger);
            const mobileMenu = document.querySelector(SELECTORS.mobileMenu);
            if (mclick && !mobileMenu) {
              safeClick(mclick);
              // The hamburger menu (#HBContent / #HBSignIn) renders
              // asynchronously; reading the sign-in link immediately after the
              // click usually returns null and misreports login state. Give the
              // menu a moment to appear.
              await delay(600);
            }
            const menuLink = document.querySelector(SELECTORS.mobileSignInLink);
            const isLoggedIn =
              menuLink && menuLink.href.includes(LOGGED_IN_HREF);

            if (
              !isLoggedIn &&
              menuLink &&
              menuLink.href.includes(SIGN_IN_HREF)
            ) {
              await delay(1000);
              menuLink.click();
              console.log("Clicked sign in link");
              sendResponse({
                success: true,
                signInInitiated: true,
                loggedIn: false,
              });
            } else {
              console.log("User already logged in or no login link");
              sendResponse({ success: true, loggedIn: Boolean(isLoggedIn) });
            }
          } else {
            const click = document.querySelector(SELECTORS.desktopSignIn);
            const desktopMenu = document.querySelector(SELECTORS.desktopMenu);
            if (click && !desktopMenu) {
              click.click();
            }
            sendResponse({ success: true });
          }
          break;
        }

        case "query": {
          const input = document.querySelector(SELECTORS.searchInput);
          if (!input) {
            sendResponse({
              success: false,
              message: "Input not found",
            });
            return;
          }
          const queryText =
            typeof request.query === "string"
              ? request.query.slice(0, 500)
              : "";
          if (input) {
            input.click();
            await delay(100);
            input.focus();
          }
          if (input && input.value !== queryText) {
            input.value = "";
            for (const char of queryText) {
              input.value += char;
              await delay(50 + Math.floor(Math.random() * 50));
            }
          }
          input.dispatchEvent(
            new Event("input", {
              bubbles: true,
            }),
          );
          sendResponse({ success: true });
          break;
        }

        case "perform": {
          const input = document.querySelector(SELECTORS.searchInput);

          if (!input) {
            sendResponse({
              success: false,
              message: "Input not found",
            });
            return;
          }

          const performQuery =
            typeof request.query === "string"
              ? request.query.slice(0, 500)
              : "";
          input.value = performQuery;
          input.focus();
          input.dispatchEvent(
            new Event("input", {
              bubbles: true,
            }),
          );

          const form = input.closest("form");
          const submitBtn =
            document.querySelector(SELECTORS.searchSubmitById) ||
            document.querySelector(SELECTORS.searchSubmitByClass) ||
            form?.querySelector('input[type="submit"]') ||
            form?.querySelector('button[type="submit"]');
          if (submitBtn || form) {
            await delay(50);
            try {
              if (submitBtn) {
                submitBtn.click();
                console.log("Clicked search submit button");
              } else {
                const enterEvent = new KeyboardEvent("keydown", {
                  bubbles: true,
                  cancelable: true,
                  key: "Enter",
                  code: "Enter",
                  keyCode: 13,
                  which: 13,
                });
                input.dispatchEvent(enterEvent);
                if (typeof form.requestSubmit === "function") {
                  form.requestSubmit();
                } else {
                  form.submit();
                }
              }
              sendResponse({ success: true });
            } catch (e) {
              sendResponse({ success: false, message: e.message });
            }
          } else {
            sendResponse({
              success: false,
              message: "Form not found",
            });
          }
          break;
        }

        case "checkRewardsSession": {
          const href = (location.href || "").toLowerCase();
          const text = (document.body?.innerText || "")
            .slice(0, 12000)
            .toLowerCase();
          const onLoginPage =
            /login\.live\.com|login\.microsoftonline\.com|\/signin|sign in|đăng nhập/.test(
              `${href} ${text.slice(0, 1200)}`,
            );
          const hasRewardsUi =
            /daily set|bộ hàng ngày|keep earning|kiếm thêm|microsoft rewards|điểm thưởng|rewards dashboard/.test(
              text,
            );
          const onRewardsHost = /rewards\.bing\.com/.test(href);
          sendResponse({
            success: true,
            active: hasRewardsUi || (onRewardsHost && !onLoginPage),
          });
          break;
        }

        case "closePopups": {
          const close = document.querySelector(SELECTORS.dashboardPopupClose);
          if (close) {
            close.click();
          }
          sendResponse({ success: true });
          break;
        }

        default:
          console.warn("Unknown content script action:", request.action);
          sendResponse({
            success: false,
            message: "Unknown action.",
          });
          return;
      }
    } catch (err) {
      console.error("Content script action failed:", err);
      sendResponse({ success: false, message: err.message });
    }
  })();
  return true;
});

// Bing renders some clickable elements as <a href="javascript:void(0)">.
// Calling .click() on those makes the browser attempt a javascript: URL
// navigation, which the page's CSP blocks and logs a console error. The
// element's own JS click handlers still need to run, so only the default
// navigation is suppressed.
function safeClick(el) {
  el.addEventListener("click", (e) => e.preventDefault(), { once: true });
  el.click();
}

async function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
