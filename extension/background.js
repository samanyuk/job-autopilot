// Autopilot background service worker.
// Holds the profile / resume / settings (chrome.storage.local), remembers which
// tabs are application tabs (chrome.storage.session), calls the Claude API for
// open-ended questions, and relays outcomes back to the dashboard.

const VERSION = chrome.runtime.getManifest().version;
const DASHBOARD_URLS = ["https://*.vercel.app/*", "http://localhost/*", "http://127.0.0.1/*"];

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

async function takeResults() {
  const { results } = await chrome.storage.local.get("results");
  if (results && results.length) await chrome.storage.local.set({ results: [] });
  return results || [];
}

async function broadcastResult(result) {
  const tabs = await chrome.tabs.query({ url: DASHBOARD_URLS });
  let delivered = false;
  for (const t of tabs) {
    try {
      await chrome.tabs.sendMessage(t.id, { type: "RESULT", ...result });
      delivered = true;
    } catch {
      // dashboard tab without bridge loaded
    }
  }
  if (!delivered) {
    const { results } = await chrome.storage.local.get("results");
    await chrome.storage.local.set({ results: [...(results || []), result].slice(-50) });
  }
}

// ------------------------------------------------------------------ Claude API
function hashKey(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return String(h >>> 0);
}

function profileSummary(p) {
  if (!p) return "";
  const edu = (p.education || []).map((e) => `${e.degree || ""} ${e.field || ""} at ${e.school || ""}${e.gpa ? `, GPA ${e.gpa}` : ""}${e.endDate ? `, graduating ${e.endDate}` : ""}`.trim()).join("; ");
  const exp = (p.experience || []).slice(0, 6).map((e) => `${e.title}${e.company ? ` @ ${e.company}` : ""} (${e.startDate || "?"}–${e.current ? "present" : e.endDate || "?"}): ${(e.description || "").slice(0, 300)}`).join("\n");
  return [
    `Name: ${p.firstName} ${p.lastName}`,
    `Location: ${[p.city, p.state, p.country].filter(Boolean).join(", ")}`,
    `Degree level: ${p.degreeLevel}; expected graduation ${p.gradMonthYear || "n/a"}`,
    `Education: ${edu}`,
    `Skills: ${(p.skills || []).join(", ")}`,
    `Work authorized in US: ${p.workAuthorized}; needs visa sponsorship: ${p.needsSponsorship}; 18+: ${p.over18}; willing to relocate: ${p.relocate}`,
    p.summary ? `Summary: ${p.summary}` : "",
    `Experience:\n${exp}`,
    p.rawText ? `Resume text (excerpt):\n${p.rawText.slice(0, 2500)}` : "",
  ].filter(Boolean).join("\n");
}

async function aiAnswer({ question, options, kind, job }) {
  const { settings, profile, aiCache } = await chrome.storage.local.get(["settings", "profile", "aiCache"]);
  const apiKey = settings?.apiKey;
  if (!apiKey) return { error: "no_key" };
  const isChoice = Array.isArray(options) && options.length > 0;
  const cacheId = hashKey([isChoice ? "choice" : "text", question, (options || []).join("|"), isChoice ? "" : job?.company || ""].join("\u0001"));
  const cache = aiCache || {};
  if (cache[cacheId]) return cache[cacheId];

  const system = [
    "You fill out job applications on behalf of a candidate. Use ONLY the candidate profile; never invent experience, credentials, or personal facts.",
    isChoice
      ? "The question has fixed options. Reply with exactly one option, copied verbatim from the list, and nothing else. Pick the option a truthful candidate with this profile would pick. For questions you cannot answer truthfully from the profile (demographics, salary, references, availability dates, anything personal that is not in the profile), reply exactly UNKNOWN."
      : "Write the answer the candidate would give, in first person, plain text, no markdown, no greeting or sign-off. Be specific to the company and role, grounded in the profile. 60–140 words unless the question clearly wants a shorter answer (a URL, a number, a one-line fact). If the profile does not contain what is needed to answer truthfully, reply exactly UNKNOWN.",
  ].join(" ");
  const user = [
    `CANDIDATE PROFILE:\n${profileSummary(profile)}`,
    job ? `\nJOB: ${job.title || ""} at ${job.company || ""}` : "",
    `\nQUESTION: ${question}`,
    isChoice ? `\nOPTIONS:\n${options.map((o) => `- ${o}`).join("\n")}` : "",
  ].join("\n");

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: settings.model || "claude-haiku-5-5",
      max_tokens: isChoice ? 60 : 400,
      system,
      messages: [{ role: "user", content: user }],
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return { error: `API ${res.status}: ${text.slice(0, 200)}` };
  }
  const data = await res.json();
  const text = (data.content || []).map((c) => c.text || "").join("").trim();
  let result;
  if (!text || /^unknown\b/i.test(text)) result = { unknown: true };
  else if (isChoice) {
    const norm = (s) => s.toLowerCase().replace(/\s+/g, " ").trim();
    const match = options.find((o) => norm(o) === norm(text)) || options.find((o) => norm(o).includes(norm(text)) || norm(text).includes(norm(o)));
    result = match ? { answer: match } : { unknown: true };
  } else result = { answer: text };

  if (!result.unknown && !result.error) {
    cache[cacheId] = result;
    const keys = Object.keys(cache);
    if (keys.length > 200) for (const k of keys.slice(0, keys.length - 200)) delete cache[k];
    await chrome.storage.local.set({ aiCache: cache });
  }
  return result;
}

// ------------------------------------------------------------------ messages
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    switch (msg?.type) {
      case "PING":
        sendResponse({ ok: true, version: VERSION, results: await takeResults() });
        break;

      case "SYNC_PROFILE": {
        const patch = {};
        if (msg.profile !== undefined) patch.profile = msg.profile;
        if (msg.resume !== undefined) patch.resume = msg.resume;
        if (msg.settings !== undefined) patch.settings = msg.settings;
        await chrome.storage.local.set(patch);
        sendResponse({ ok: true });
        break;
      }

      case "APPLY": {
        await chrome.storage.local.set({ profile: msg.profile, resume: msg.resume, settings: msg.settings || {} });
        const tab = await chrome.tabs.create({ url: msg.job.url, active: true });
        await setJobTab(tab.id, { ...msg.job, startedAt: Date.now() });
        sendResponse({ ok: true, tabId: tab.id });
        break;
      }

      case "WHO_AM_I": {
        const tabId = sender.tab?.id;
        const jobTabs = await getJobTabs();
        const data = await chrome.storage.local.get(["profile", "resume", "settings", "creds", "answers"]);
        sendResponse({
          job: tabId != null ? jobTabs[tabId] || null : null,
          profile: data.profile || null,
          resume: data.resume || null,
          settings: data.settings || {},
          creds: data.creds || null,
          answers: data.answers || {},
        });
        break;
      }

      case "STOP":
        if (sender.tab?.id != null) await setJobTab(sender.tab.id, null);
        sendResponse({ ok: true });
        break;

      case "SAVE_SETTINGS": {
        const { settings } = await chrome.storage.local.get("settings");
        await chrome.storage.local.set({ settings: { ...(settings || {}), ...msg.settings } });
        sendResponse({ ok: true });
        break;
      }

      case "SAVE_CREDS":
        await chrome.storage.local.set({ creds: msg.creds || null });
        sendResponse({ ok: true });
        break;

      case "SAVE_ANSWER": {
        const { answers } = await chrome.storage.local.get("answers");
        const next = { ...(answers || {}), [msg.key]: msg.answer };
        await chrome.storage.local.set({ answers: next });
        sendResponse({ ok: true });
        break;
      }

      case "AI_ANSWER":
        sendResponse(await aiAnswer(msg));
        break;

      case "RESULT":
        await broadcastResult({ jobId: msg.jobId, status: msg.status, note: msg.note || "" });
        sendResponse({ ok: true });
        break;

      default:
        sendResponse({ ok: false, error: "unknown message" });
    }
  })().catch((err) => sendResponse({ ok: false, error: String(err) }));
  return true; // keep the channel open for the async response
});

// Clicking the toolbar icon on any page starts Autopilot there.
chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id || !tab.url || tab.url.startsWith("chrome://")) return;
  await setJobTab(tab.id, { id: "manual-" + tab.id, title: tab.title || "Application", company: "", url: tab.url, startedAt: Date.now(), manual: true });
  try {
    await chrome.tabs.sendMessage(tab.id, { type: "START" });
  } catch {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["rules.js", "content.js"] });
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  setJobTab(tabId, null).catch(() => {});
});
