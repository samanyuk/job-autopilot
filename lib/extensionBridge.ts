import type { Job, JobStatus, Profile, QuestionBank, ResumeFile, SavedAnswers, Settings } from "./types";

// Messages are exchanged with the Chrome extension's bridge content script via
// window.postMessage on this page. The extension answers PING with READY and
// reports application outcomes with RESULT.

export const BRIDGE = {
  PING: "AUTOPILOT_PING",
  READY: "AUTOPILOT_EXT_READY",
  APPLY: "AUTOPILOT_APPLY",
  SYNC: "AUTOPILOT_SYNC_PROFILE",
  ACK: "AUTOPILOT_ACK",
  RESULT: "AUTOPILOT_RESULT",
  QBANK: "AUTOPILOT_QBANK",
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

export function syncProfileToExtension(profile: Profile | null, resume: ResumeFile | null, settings: Settings, answers: SavedAnswers) {
  if (typeof window === "undefined") return;
  window.postMessage({ type: BRIDGE.SYNC, profile, resume, settings, answers }, "*");
}

/**
 * Ask the extension to open the job and start filling. Resolves true when the
 * extension acknowledged; false when no extension responded (caller should
 * fall back to window.open).
 */
export function applyViaExtension(job: Job, profile: Profile, resume: ResumeFile | null, settings: Settings, answers: SavedAnswers, timeoutMs = 1200): Promise<boolean> {
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
    window.postMessage({ type: BRIDGE.APPLY, job, profile, resume, settings, answers }, "*");
  });
}

/** Subscribe to outcome reports from the extension (e.g. "submitted"). Returns an unsubscribe fn. */
export function onExtensionResult(handler: (jobId: string, status: JobStatus, note?: string) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const onMsg = (e: MessageEvent) => {
    if (e.source !== window || e.data?.type !== BRIDGE.RESULT) return;
    handler(String(e.data.jobId), e.data.status as JobStatus, e.data.note);
  };
  window.addEventListener("message", onMsg);
  return () => window.removeEventListener("message", onMsg);
}

/** The extension's question bank + any settings it generated (e.g. an account password). */
export function onExtensionQbank(handler: (qbank: QuestionBank, answers: SavedAnswers, settingsPatch: Partial<Settings>) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const onMsg = (e: MessageEvent) => {
    if (e.source !== window || e.data?.type !== BRIDGE.QBANK) return;
    handler((e.data.qbank ?? {}) as QuestionBank, (e.data.answers ?? {}) as SavedAnswers, (e.data.settingsPatch ?? {}) as Partial<Settings>);
  };
  window.addEventListener("message", onMsg);
  return () => window.removeEventListener("message", onMsg);
}
