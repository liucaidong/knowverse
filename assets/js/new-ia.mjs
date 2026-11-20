// Apply the new IA at runtime based on flags (T1.3). Loaded only on the home page,
// alongside the prerendered workbench fragment. Reversible: turning the flag off
// restores the legacy home exactly (elements are hidden, never removed).
import { resolveSiteFlags } from "./flags.mjs";

const flags = resolveSiteFlags();
const enabled = flags.NEW_IA_ENABLED;

function apply() {
  const workbench = document.querySelector("[data-kv-workbench]");
  const legacyHome = document.querySelector(".kv-home-portal");
  // Five-state resilience: the workbench is prerendered, so a missing/failed runtime
  // never removes the entry points. Flag off = legacy home; flag on = workbench.
  let profileState = "empty"; // empty | ready | error — from local profile in P2
  try {
    profileState = globalThis.localStorage?.getItem("kv-profile-state") === "ready" ? "ready" : "empty";
  } catch { profileState = "error"; }
  document.documentElement.setAttribute("data-kv-profile-state", profileState);

  if (enabled) {
    if (workbench) workbench.hidden = false;
    // Hide only the primary hero to avoid two competing "start here" blocks.
    if (legacyHome) legacyHome.hidden = true;
    document.documentElement.setAttribute("data-kv-ia", "new");
  } else {
    if (workbench) workbench.hidden = true;
    if (legacyHome) legacyHome.hidden = false;
    document.documentElement.setAttribute("data-kv-ia", "legacy");
  }
}

try { apply(); }
catch (error) {
  // Last-resort: never leave the page with both heroes hidden.
  document.querySelector("[data-kv-workbench]")?.setAttribute("hidden", "");
  const legacy = document.querySelector(".kv-home-portal");
  if (legacy) legacy.hidden = false;
  document.documentElement.setAttribute("data-kv-ia", "legacy");
}
