// Runs on the Autopilot dashboard. Relays window.postMessage traffic from the
// page to the extension's background worker and back.

(function () {
  if (window.__autopilotBridge) return;
  window.__autopilotBridge = true;

  const T = {
    PING: "AUTOPILOT_PING",
    READY: "AUTOPILOT_EXT_READY",
    APPLY: "AUTOPILOT_APPLY",
    SYNC: "AUTOPILOT_SYNC_PROFILE",
    ACK: "AUTOPILOT_ACK",
  };

  function send(msg) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(msg, (res) => {
          if (chrome.runtime.lastError) resolve({ ok: false, error: chrome.runtime.lastError.message });
          else resolve(res || { ok: false });
        });
      } catch (err) {
        resolve({ ok: false, error: String(err) });
      }
    });
  }

  window.addEventListener("message", async (e) => {
    if (e.source !== window || !e.data || typeof e.data.type !== "string") return;
    switch (e.data.type) {
      case T.PING: {
        const res = await send({ type: "PING" });
        if (res.ok) window.postMessage({ type: T.READY, version: res.version }, "*");
        break;
      }
      case T.SYNC:
        await send({ type: "SYNC_PROFILE", profile: e.data.profile, resume: e.data.resume });
        break;
      case T.APPLY: {
        const res = await send({ type: "APPLY", job: e.data.job, profile: e.data.profile, resume: e.data.resume });
        if (res.ok) window.postMessage({ type: T.ACK, jobId: e.data.job.id }, "*");
        break;
      }
    }
  });

  // Announce ourselves once so the dashboard flips to "connected" immediately.
  send({ type: "PING" }).then((res) => {
    if (res.ok) window.postMessage({ type: T.READY, version: res.version }, "*");
  });
})();
