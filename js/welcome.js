export const DONATE_PAGE = "/donate.html";

// First install on this browser profile only. Updates must not open the page
// again, or every version bump interrupts someone who is already using it.
export function shouldShowDonateOnInstall(reason) {
  return reason === "install";
}
