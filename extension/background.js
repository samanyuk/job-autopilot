// Autopilot background service worker.
// Holds the profile/resume (chrome.storage.local) and remembers which tabs are
// application tabs we opened (chrome.storage.session so it survives SW restarts).

const VERSION = chrome.runtime.getManifest().version;

async function getJobTabs() {
  const { jobTabs } = await chrome.storage.session.get("jobTabs");
  return jobTabs || {};
}

async function setJobTab(tabId, job) {
  const jobTabs = await getJobTabs();
  if (job) jobTabs[tabId] = job;
  else delete jobTabs[tabId];
  await chrome.storage.session.set({ jobTabs });
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    switch (msg?.type) {
      case "PING":
        sendResponse({ ok: true, version: VERSION });
        break;

      case "SYNC_PROFILE": {
        const patch = {};
        if (msg.profile !== undefined) patch.profile = msg.profile;
        if (msg.resume !== undefined) patch.resume = msg.resume;
        await chrome.storage.local.set(patch);
        sendResponse({ ok: true });
        break;
      }

      case "APPLY": {
        await chrome.storage.local.set({ profile: msg.profile, resume: msg.resume });
        const tab = await chrome.tabs.create({ url: msg.job.url, active: true });
        await setJobTab(tab.id, { ...msg.job, startedAt: Date.now() });
        sendResponse({ ok: true, tabId: tab.id });
        break;
      }

      case "WHO_AM_I": {
        const tabId = sender.tab?.id;
        const jobTabs = await getJobTabs();
        const { profile, resume, settings } = await chrome.storage.local.get(["profile", "resume", "settings"]);
        sendResponse({ job: tabId != null ? jobTabs[tabId] || null : null, profile: profile || null, resume: resume || null, settings: settings || {} });
        break;
      }

      case "STOP": {
        if (sender.tab?.id != null) await setJobTab(sender.tab.id, null);
        sendResponse({ ok: true });
        break;
      }

      case "SAVE_SETTINGS": {
        await chrome.storage.local.set({ settings: msg.settings });
        sendResponse({ ok: true });
        break;
      }

      default:
        sendResponse({ ok: false, error: "unknown message" });
    }
  })().catch((err) => sendResponse({ ok: false, error: String(err) }));
  return true; // keep the channel open for the async response
});

// Clicking the toolbar icon on any page starts Autopilot there, so you can use
// it on applications you didn't open from the dashboard.
chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id || !tab.url || tab.url.startsWith("chrome://")) return;
  await setJobTab(tab.id, { id: "manual-" + tab.id, title: tab.title || "Application", company: "", url: tab.url, startedAt: Date.now(), manual: true });
  try {
    await chrome.tabs.sendMessage(tab.id, { type: "START" });
  } catch {
    // Content script may not be injected yet (page loaded before install). Inject it.
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["rules.js", "content.js"] });
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  setJobTab(tabId, null).catch(() => {});
});
