import type { Job, Profile, ResumeFile } from "./types";

// Messages are exchanged with the Chrome extension's bridge content script via
// window.postMessage on this page. The extension answers PING with READY.

export const BRIDGE = {
  PING: "AUTOPILOT_PING",
  READY: "AUTOPILOT_EXT_READY",
  APPLY: "AUTOPILOT_APPLY",
  SYNC: "AUTOPILOT_SYNC_PROFILE",
  ACK: "AUTOPILOT_ACK",
};

export function pingExtension(timeoutMs = 800): Promise<string | null> {
  if (typeof window === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      window.removeEventListener("message", onMsg);
      resolve(null);
    }, timeoutMs);
    function onMsg(e: MessageEvent) {
      if (e.source !== window || e.data?.type !== BRIDGE.READY) return;
      clearTimeout(timer);
      window.removeEventListener("message", onMsg);
      resolve(String(e.data.version ?? "?"));
    }
    window.addEventListener("message", onMsg);
    window.postMessage({ type: BRIDGE.PING }, "*");
  });
}

export function syncProfileToExtension(profile: Profile | null, resume: ResumeFile | null) {
  if (typeof window === "undefined") return;
  window.postMessage({ type: BRIDGE.SYNC, profile, resume }, "*");
}

/**
 * Ask the extension to open the job and start filling. Resolves true when the
 * extension acknowledged; false when no extension responded (caller should
 * fall back to window.open).
 */
export function applyViaExtension(job: Job, profile: Profile, resume: ResumeFile | null, timeoutMs = 1200): Promise<boolean> {
  if (typeof window === "undefined") return Promise.resolve(false);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      window.removeEventListener("message", onMsg);
      resolve(false);
    }, timeoutMs);
    function onMsg(e: MessageEvent) {
      if (e.source !== window || e.data?.type !== BRIDGE.ACK || e.data.jobId !== job.id) return;
      clearTimeout(timer);
      window.removeEventListener("message", onMsg);
      resolve(true);
    }
    window.addEventListener("message", onMsg);
    window.postMessage({ type: BRIDGE.APPLY, job, profile, resume }, "*");
  });
}
