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
    RESULT: "AUTOPILOT_RESULT",
    QBANK: "AUTOPILOT_QBANK",
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

  function announce(res) {
    if (!res.ok) return;
    window.postMessage({ type: T.READY, version: res.version }, "*");
    for (const r of res.results || []) window.postMessage({ type: T.RESULT, ...r }, "*");
    window.postMessage({ type: T.QBANK, qbank: res.qbank || {}, answers: res.answers || {}, settingsPatch: res.settingsPatch || {} }, "*");
  }

  window.addEventListener("message", async (e) => {
    if (e.source !== window || !e.data || typeof e.data.type !== "string") return;
    switch (e.data.type) {
      case T.PING:
        announce(await send({ type: "PING" }));
        break;
      case T.SYNC:
        await send({ type: "SYNC_PROFILE", profile: e.data.profile, resume: e.data.resume, settings: e.data.settings, answers: e.data.answers });
        break;
      case T.APPLY: {
        const res = await send({ type: "APPLY", job: e.data.job, profile: e.data.profile, resume: e.data.resume, settings: e.data.settings, answers: e.data.answers });
        if (res.ok) window.postMessage({ type: T.ACK, jobId: e.data.job.id }, "*");
        break;
      }
    }
  });

  // Outcomes pushed from the background while the dashboard is open.
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === "RESULT") window.postMessage({ type: T.RESULT, jobId: msg.jobId, status: msg.status, note: msg.note }, "*");
  });

  send({ type: "PING" }).then(announce);
})();
