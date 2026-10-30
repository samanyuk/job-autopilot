// Autopilot content script: watches an application page, fills what it can
// from the stored profile, and shows a live panel with pause / edit / stop.
// Never clicks Submit. Never answers demographic (EEO) questions.

(function () {
  if (window.__autopilotContent) return;
  window.__autopilotContent = true;

  const R = window.AutopilotRules;
  const IS_TOP = window === window.top;
  const HOST = location.hostname;

  // ---------------------------------------------------------------- state
  const state = {
    job: null,
    profile: null,
    resume: null,
    settings: { autoAdvance: false, delayMs: 160 },
    running: false,
    paused: false,
    stopped: false,
    filled: new WeakSet(), // elements we've touched
    seen: new WeakSet(), // elements we've evaluated (filled, skipped, or left)
    counters: {}, // key@scope -> occurrence index for repeating sections
    log: [], // { id, kind, label, value, el, rule }
    stats: { filled: 0, skipped: 0, left: 0 },
    ats: detectAts(),
    scanning: false,
    rescanQueued: false,
  };

  function detectAts() {
    const h = HOST;
    if (/myworkday/.test(h)) return "workday";
    if (/greenhouse/.test(h)) return "greenhouse";
    if (/lever\.co/.test(h)) return "lever";
    if (/ashbyhq/.test(h)) return "ashby";
    if (/smartrecruiters/.test(h)) return "smartrecruiters";
    if (/icims/.test(h)) return "icims";
    if (/oraclecloud/.test(h)) return "oracle";
    if (/amazon\.jobs/.test(h)) return "amazon";
    return "generic";
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const norm = (s) => (s || "").replace(/\s+/g, " ").replace(/\*/g, "").trim().toLowerCase();

  function send(msg) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(msg, (res) => resolve(chrome.runtime.lastError ? null : res));
      } catch {
        resolve(null);
      }
    });
  }

  // ---------------------------------------------------------------- labels
  function textOf(el) {
    return el ? norm(el.innerText || el.textContent) : "";
  }

  function isVisible(el) {
    if (!el || !el.isConnected) return false;
    const style = getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") return false;
    const r = el.getBoundingClientRect();
    // File inputs are often visually hidden behind a styled button; allow them.
    if (el.type === "file") return true;
    return r.width > 0 && r.height > 0;
  }

  const CONTROL_SEL = "input:not([type=hidden]), textarea, select, button[aria-haspopup='listbox'], [role=combobox]";

  // The smallest ancestor that wraps just this control (and its label).
  function fieldContainer(el) {
    const explicit = el.closest('[data-automation-id^="formField"], .field, .form-field, .application-question, .ashby-application-form-field-entry, .form-group');
    if (explicit && explicit.querySelectorAll(CONTROL_SEL).length <= 2) return explicit;
    let node = el.parentElement;
    for (let depth = 0; node && depth < 6; depth++) {
      const controls = node.querySelectorAll(CONTROL_SEL).length;
      if (controls > 1 && !(el.type === "radio" || el.type === "checkbox")) return node === el.parentElement ? node : null;
      if (node.tagName === "FORM" || node.tagName === "BODY") return null;
      const parent = node.parentElement;
      if (!parent || parent.querySelectorAll(CONTROL_SEL).length > 1) return node;
      node = parent;
    }
    return node;
  }

  function labelFor(el) {
    const parts = [];
    const push = (s) => { const n = norm(s); if (n && !parts.includes(n)) parts.push(n); };
    if (el.id) {
      try { document.querySelectorAll(`label[for="${CSS.escape(el.id)}"]`).forEach((l) => push(textOf(l))); } catch { /* ignore */ }
    }
    const by = el.getAttribute("aria-labelledby");
    if (by) by.split(/\s+/).forEach((id) => push(textOf(document.getElementById(id))));
    push(el.getAttribute("aria-label"));
    const wrap = el.closest("label");
    if (wrap) push(textOf(wrap));
    if (parts.length === 0) {
      const container = fieldContainer(el);
      if (container && container !== el) {
        const lab = container.querySelector("label, legend, [class*='label'], [data-automation-id*='label'], h3, h4");
        if (lab && !lab.contains(el)) push(textOf(lab).slice(0, 160));
      }
      // Nearest preceding label in document order (classic <label>…<input> layouts).
      if (parts.length === 0) {
        let p = el.previousElementSibling;
        while (p && !/^(label|legend|p|span|div|h[1-6])$/i.test(p.tagName)) p = p.previousElementSibling;
        if (!p) p = el.parentElement?.previousElementSibling;
        if (p && !p.querySelector(CONTROL_SEL)) push(textOf(p).slice(0, 120));
      }
    }
    push(el.getAttribute("placeholder"));
    push(el.getAttribute("name"));
    push(el.getAttribute("data-automation-id"));
    push(el.id);
    return parts.join(" | ");
  }

  function scopeOf(el) {
    let node = el;
    for (let depth = 0; node && depth < 10; depth++, node = node.parentElement) {
      const aid = (node.getAttribute && node.getAttribute("data-automation-id")) || "";
      const text = aid + " " + (node.id || "") + " " + (node.className?.toString?.() || "");
      if (/workexperience|work-?experience|employment|experience/i.test(text)) return "experience";
      if (/education|school/i.test(text)) return "education";
      const heading = node.querySelector?.(":scope > h2, :scope > h3, :scope > h4, :scope > legend");
      if (heading) {
        const t = textOf(heading);
        if (/experience|employment|work history/.test(t)) return "experience";
        if (/education/.test(t)) return "education";
      }
    }
    return "";
  }

  function questionTextFor(radio) {
    const group = radio.closest("fieldset, [role=radiogroup], [role=group], [data-automation-id^='formField'], .application-question, .field, .form-group") || radio.parentElement?.parentElement;
    if (!group) return labelFor(radio);
    const legend = group.querySelector("legend, [id*='label'], label:not(:has(input)), [class*='label'], p, span");
    const own = radio.closest("label");
    const t = textOf(legend && !legend.contains(radio) ? legend : group).replace(textOf(own), "");
    return t.slice(0, 200) + " | " + (radio.name || "");
  }

  // ---------------------------------------------------------------- matching
  function pickRule(label, scope, kind) {
    const candidates = R.RULES.filter((r) => {
      if (r.scope && r.scope !== scope) return false;
      if (kind === "file") return r.kind === "file";
      if (r.kind === "file") return false;
      if (kind === "bool") return r.kind === "bool";
      if (kind === "check") return r.kind === "check";
      if (r.kind === "bool" || r.kind === "check") return false;
      if (r.kind === "textarea" && kind !== "textarea") return false;
      return true;
    });
    // Scoped rules first when we are inside that section.
    candidates.sort((a, b) => (b.scope ? 1 : 0) - (a.scope ? 1 : 0));
    // Earlier parts are more trustworthy (explicit labels before name/id attrs),
    // so find the first part that any rule matches before falling back to the
    // whole string.
    for (const part of label.split(" | ")) {
      const hit = candidates.find((r) => r.test.test(part));
      if (hit) return hit;
    }
    return candidates.find((r) => r.test.test(label)) || null;
  }

  function nextIndex(key, scope) {
    const k = `${key}@${scope}`;
    const i = state.counters[k] || 0;
    state.counters[k] = i + 1;
    return i;
  }

  // ---------------------------------------------------------------- setters
  function setNativeValue(el, value) {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, "value");
    if (desc && desc.set) desc.set.call(el, value);
    else el.value = value;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  async function typeInto(el, value) {
    el.focus();
    el.dispatchEvent(new FocusEvent("focus", { bubbles: true }));
    setNativeValue(el, value);
    await sleep(40);
    el.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key: "a" }));
    el.dispatchEvent(new FocusEvent("blur", { bubbles: true }));
    return el.value === value || el.value.length > 0;
  }

  function bestOption(options, wanted, alt) {
    const w = norm(wanted);
    const a = norm(alt);
    const texts = options.map((o) => norm(o.text ?? o.textContent));
    const tryMatch = (fn) => {
      const i = texts.findIndex(fn);
      return i >= 0 ? options[i] : null;
    };
    return (
      (w && tryMatch((t) => t === w)) ||
      (a && tryMatch((t) => t === a)) ||
      (w && tryMatch((t) => t.startsWith(w + " ") || t.startsWith(w + ","))) ||
      (w && w.length > 2 && tryMatch((t) => t.includes(w))) ||
      (a && a.length > 2 && tryMatch((t) => t.includes(a))) ||
      null
    );
  }

  async function setSelect(el, value, alt) {
    const options = Array.from(el.options).filter((o) => o.value !== "" || o.text);
    const opt = bestOption(options, value, alt);
    if (!opt) return false;
    const desc = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value");
    desc.set.call(el, opt.value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }

  function visibleOptions() {
    return Array.from(document.querySelectorAll("[role=option], [role=listbox] li, ul[data-automation-id*='Options'] li, .select__option, [class*='option']"))
      .filter((o) => isVisible(o) && textOf(o).length > 0 && textOf(o).length < 120);
  }

  // Workday-style <button aria-haspopup="listbox"> or React-Select comboboxes.
  async function setCustomSelect(el, value, alt) {
    el.scrollIntoView({ block: "center" });
    const isInput = el.tagName === "INPUT";
    if (isInput) {
      el.focus();
      setNativeValue(el, value);
      await sleep(450);
    } else {
      el.click();
      await sleep(350);
      // Some Workday listboxes have a search box; type into it if present.
      const search = document.querySelector("[role=listbox] input, [data-automation-id*='search'] input:not([type=hidden])");
      if (search && isVisible(search)) {
        setNativeValue(search, value);
        await sleep(400);
      }
    }
    let opts = visibleOptions();
    let opt = bestOption(opts, value, alt);
    if (!opt && isInput && alt) {
      setNativeValue(el, alt);
      await sleep(450);
      opts = visibleOptions();
      opt = bestOption(opts, alt, value);
    }
    if (opt) {
      opt.scrollIntoView({ block: "nearest" });
      opt.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      opt.click();
      await sleep(150);
      return true;
    }
    if (isInput && opts.length > 0) {
      // Fall back to keyboard: first suggestion.
      el.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowDown", code: "ArrowDown" }));
      el.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter", code: "Enter" }));
      await sleep(150);
      return true;
    }
    // Close whatever we opened.
    document.body.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }));
    return false;
  }

  async function setRadio(radios, yesNoText) {
    if (!yesNoText) return false;
    const want = norm(yesNoText);
    for (const r of radios) {
      const t = norm(textOf(r.closest("label")) || labelFor(r).split("|")[0]);
      if (t === want || t.startsWith(want + " ") || t.startsWith(want + ",")) {
        r.click();
        await sleep(60);
        if (!r.checked) { r.checked = true; r.dispatchEvent(new Event("change", { bubbles: true })); }
        return true;
      }
    }
    return false;
  }

  async function setFile(input) {
    if (!state.resume?.b64) return false;
    const bin = atob(state.resume.b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const file = new File([bytes], state.resume.name, { type: state.resume.type || "application/pdf" });
    const dt = new DataTransfer();
    dt.items.add(file);
    input.files = dt.files;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }

  async function setDate(el, raw) {
    const d = R.fmtMonthYear(raw);
    if (!d) return false;
    const aid = el.getAttribute("data-automation-id") || "";
    if (/dateSectionMonth/i.test(aid)) return typeInto(el, d.month);
    if (/dateSectionYear/i.test(aid)) return typeInto(el, d.year);
    if (/dateSectionDay/i.test(aid)) return typeInto(el, "01");
    if (el.type === "month") return typeInto(el, `${d.year}-${d.month}`);
    if (el.type === "date") return typeInto(el, `${d.year}-${d.month}-01`);
    if (el.tagName === "SELECT") {
      const isYear = Array.from(el.options).some((o) => /^\d{4}$/.test(o.text.trim()));
      return setSelect(el, isYear ? d.year : monthName(d.month), isYear ? d.year : d.month);
    }
    const ph = norm(el.getAttribute("placeholder"));
    const lab = labelFor(el);
    if (/^yyyy$/.test(ph) || /\byear\b/.test(lab) && !/month/.test(lab)) return typeInto(el, d.year);
    if (/^mm$/.test(ph) || /\bmonth\b/.test(lab) && !/year/.test(lab)) return typeInto(el, d.month);
    if (/yyyy$/.test(ph) && /^(mm|m)/.test(ph)) return typeInto(el, d.text);
    return typeInto(el, d.text);
  }

  function monthName(mm) {
    return ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"][Number(mm) - 1] || "";
  }

  // ---------------------------------------------------------------- scan
  function candidates() {
    const sel = "input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=reset]):not([type=image]), textarea, select, button[aria-haspopup='listbox'], [role=combobox]";
    return Array.from(document.querySelectorAll(sel)).filter((el) => {
      if (state.seen.has(el)) return false;
      if (el.closest("#autopilot-host")) return false;
      if (el.disabled || el.readOnly) return false;
      if (el.getAttribute("aria-hidden") === "true") return false;
      // A combobox wrapper around a real input: handle the input instead.
      if (el.tagName !== "INPUT" && el.tagName !== "BUTTON" && el.tagName !== "SELECT" && el.tagName !== "TEXTAREA" && el.querySelector("input")) return false;
      return isVisible(el);
    });
  }

  function hasValue(el) {
    if (el.tagName === "SELECT") return el.selectedIndex > 0 && el.value !== "";
    if (el.tagName === "BUTTON") return !/select one|select|choose|^$/.test(norm(el.textContent));
    if (el.type === "file") return el.files && el.files.length > 0;
    if (el.type === "checkbox" || el.type === "radio") return false;
    return typeof el.value === "string" && el.value.trim().length > 0;
  }

  function pageIsDemographic() {
    const t = norm(document.title) + " " + textOf(document.querySelector("h1, h2, [data-automation-id='pageHeaderTitle'], [data-automation-id='progressBarActiveStep']"));
    return /self[- ]?identif|voluntary|disclosure|eeo|demographic/.test(t);
  }

  async function processElement(el) {
    state.seen.add(el);
    const type = (el.getAttribute("type") || (el.tagName === "TEXTAREA" ? "textarea" : el.tagName === "SELECT" ? "select" : "text")).toLowerCase();
    if (type === "search" && !el.closest("form")) return;
    if (type === "checkbox") return processCheckbox(el);
    if (type === "radio") return processRadio(el);

    const label = labelFor(el);
    const scope = scopeOf(el);
    const containerText = textOf(fieldContainer(el)).slice(0, 300);

    if (R.EEO_RE.test(label) || R.EEO_RE.test(containerText)) return addLog("left", el, label, "Demographic question — your call");
    if (R.SKIP_RE.test(label)) return addLog("skipped", el, label, "Left blank on purpose");
    if (hasValue(el)) return; // don't overwrite anything already there

    const isCustom = el.tagName === "BUTTON" || el.getAttribute("role") === "combobox" || el.getAttribute("aria-autocomplete") === "list";
    const kind = type === "file" ? "file" : type === "textarea" ? "textarea" : isCustom || type === "select" ? "select" : "text";
    const rule = pickRule(label, scope, kind);
    if (!rule) return addLog("skipped", el, label, "No matching profile field");

    const idx = nextIndex(rule.key, scope);
    const value = rule.value(state.profile, idx);
    const alt = rule.alt ? rule.alt(state.profile, idx) : "";
    if (rule.kind === "file") {
      if (/cover|transcript|photo|headshot|writing sample|portfolio|other document|additional/.test(label)) return addLog("skipped", el, label, "Not a resume slot — left for you");
      const ok = await setFile(el);
      return addLog(ok ? "filled" : "left", el, label, ok ? state.resume.name : "No resume stored — upload manually");
    }
    if (value === "" || value == null) return addLog("skipped", el, label, "Nothing in your profile for this");

    highlight(el);
    let ok = false;
    if (rule.kind === "date") ok = await setDate(el, value);
    else if (el.tagName === "SELECT") ok = await setSelect(el, value, alt);
    else if (isCustom) ok = await setCustomSelect(el, value, alt);
    else ok = await typeInto(el, String(value));
    if (ok) state.filled.add(el);
    addLog(ok ? "filled" : "left", el, label, ok ? String(value) : `Couldn't set "${value}" — please pick it`, rule);
  }

  async function processCheckbox(el) {
    const label = labelFor(el);
    const scope = scopeOf(el);
    const rule = pickRule(label, scope, "check");
    if (!rule) return; // consent / acknowledgement boxes are yours to tick
    const idx = state.counters[`${rule.key}@${scope}`] || 0;
    const want = rule.value(state.profile, Math.max(0, idx - 1));
    if (want && !el.checked) {
      highlight(el);
      el.click();
      state.filled.add(el);
      addLog("filled", el, label, "Checked");
    }
  }

  const radioGroupsDone = new Set();
  async function processRadio(el) {
    const name = el.name || labelFor(el);
    if (radioGroupsDone.has(name)) return;
    const radios = Array.from(document.querySelectorAll(`input[type=radio][name="${CSS.escape(el.name || "")}"]`)).filter(isVisible);
    const group = el.name ? radios : [el];
    group.forEach((r) => state.seen.add(r));
    radioGroupsDone.add(name);
    const question = questionTextFor(el);
    const containerText = textOf(el.closest("fieldset, [role=radiogroup], [data-automation-id^='formField']") || el.parentElement).slice(0, 300);
    if (R.EEO_RE.test(question) || R.EEO_RE.test(containerText)) return addLog("left", el, question, "Demographic question — your call");
    if (group.some((r) => r.checked)) return;
    const rule = pickRule(question, "", "bool");
    if (!rule) return addLog("skipped", el, question, "Question not in your profile");
    const want = rule.value(state.profile, 0);
    if (!want) return addLog("skipped", el, question, "No answer saved in your profile");
    highlight(group[0]);
    const ok = await setRadio(group, want);
    addLog(ok ? "filled" : "left", el, question, ok ? want : `Wanted "${want}" — pick it manually`, rule);
  }

  async function scan() {
    if (!state.running || state.paused || state.stopped) return;
    if (state.scanning) { state.rescanQueued = true; return; }
    state.scanning = true;
    setStatus("Scanning page…");
    try {
      const els = candidates();
      for (const el of els) {
        if (state.paused || state.stopped) break;
        try {
          await processElement(el);
        } catch (err) {
          addLog("left", el, labelFor(el), "Error: " + (err?.message || err));
        }
        await sleep(state.settings.delayMs);
      }
    } finally {
      state.scanning = false;
    }
    if (state.rescanQueued) { state.rescanQueued = false; return scan(); }
    if (state.paused) setStatus("Paused");
    else if (pageIsDemographic()) setStatus("Demographic page — fill this one yourself, then continue.");
    else if (state.stats.left > 0) setStatus("Done with this page — a few fields need you (marked ✋).");
    else setStatus("Done with this page — review, then continue.");
    if (state.settings.autoAdvance && !pageIsDemographic() && state.stats.left === 0) maybeAdvance();
  }

  // ---------------------------------------------------------------- navigation
  function findNextButton() {
    const explicit = document.querySelector("[data-automation-id='bottom-navigation-next-button'], button[data-automation-id*='next'], [data-ui='next']");
    if (explicit && isVisible(explicit)) return explicit;
    const buttons = Array.from(document.querySelectorAll("button, input[type=submit], a[role=button]")).filter(isVisible);
    return buttons.find((b) => {
      const t = norm(b.textContent || b.value);
      return R.NEXT_RE.test(t) && !R.SUBMIT_RE.test(t);
    }) || null;
  }

  function maybeAdvance() {
    const btn = findNextButton();
    if (!btn) return false;
    const t = norm(btn.textContent || btn.value);
    if (R.SUBMIT_RE.test(t)) return false; // belt and braces
    setStatus(`Clicking "${btn.textContent.trim()}"…`);
    btn.click();
    // Counters reset per page so repeating sections start at index 0 again.
    state.counters = {};
    return true;
  }

  // ---------------------------------------------------------------- overlay
  let ui = null;

  function addLog(kind, el, label, value, rule) {
    state.stats[kind] = (state.stats[kind] || 0) + 1;
    const entry = { id: state.log.length + 1, kind, label: (label || "").split("|")[0].trim() || label, value, el, rule };
    state.log.push(entry);
    if (!IS_TOP) {
      try { window.top.postMessage({ type: "AUTOPILOT_FRAME_LOG", kind, label: entry.label, value }, "*"); } catch { /* ignore */ }
      return;
    }
    renderLog();
  }

  function highlight(el) {
    try {
      el.scrollIntoView({ block: "center", behavior: "smooth" });
      const prev = el.style.boxShadow;
      el.style.transition = "box-shadow 200ms";
      el.style.boxShadow = "0 0 0 3px rgba(20,20,20,0.35)";
      setTimeout(() => { el.style.boxShadow = prev; }, 900);
    } catch { /* ignore */ }
  }

  function setStatus(text) {
    if (ui) ui.status.textContent = text;
  }

  function buildOverlay() {
    if (!IS_TOP || ui) return;
    const host = document.createElement("div");
    host.id = "autopilot-host";
    host.style.cssText = "all:initial;position:fixed;z-index:2147483647;bottom:16px;right:16px;";
    const root = host.attachShadow({ mode: "open" });
    root.innerHTML = `
      <style>
        :host { all: initial; }
        * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, Helvetica, Arial, sans-serif; }
        .panel { width: 360px; max-height: 70vh; display: flex; flex-direction: column; background: #fff; color: #141414; border: 1px solid #e5e3dd; border-radius: 16px; box-shadow: 0 12px 40px rgba(0,0,0,.18); overflow: hidden; font-size: 13px; }
        .panel.min { max-height: none; }
        .panel.min .body, .panel.min .foot { display: none; }
        .head { display: flex; align-items: center; gap: 8px; padding: 10px 12px; border-bottom: 1px solid #efede8; background: #f6f6f3; }
        .dot { width: 8px; height: 8px; border-radius: 50%; background: #2fb55a; flex-shrink: 0; }
        .dot.paused { background: #e0a400; }
        .dot.stopped { background: #bbb; }
        .title { font-weight: 600; flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .title small { font-weight: 400; color: #8a8985; margin-left: 6px; }
        .icon { background: transparent; border: 0; cursor: pointer; color: #8a8985; font-size: 14px; padding: 2px 6px; border-radius: 6px; }
        .icon:hover { background: #e9e7e1; color: #141414; }
        .status { padding: 8px 12px; color: #4a4a48; border-bottom: 1px solid #efede8; min-height: 32px; }
        .stats { display: flex; gap: 10px; padding: 6px 12px; color: #8a8985; font-size: 12px; border-bottom: 1px solid #efede8; }
        .stats b { color: #141414; }
        .body { overflow-y: auto; flex: 1; }
        .row { display: flex; align-items: flex-start; gap: 8px; padding: 7px 12px; border-bottom: 1px solid #f3f2ee; cursor: pointer; }
        .row:hover { background: #faf9f6; }
        .k { width: 16px; flex-shrink: 0; text-align: center; }
        .lab { color: #8a8985; font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .val { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .val.left { color: #b45309; }
        .txt { flex: 1; min-width: 0; }
        .edit { background: transparent; border: 1px solid #e5e3dd; border-radius: 999px; padding: 2px 8px; font-size: 11px; cursor: pointer; color: #4a4a48; flex-shrink: 0; }
        .edit:hover { border-color: #141414; color: #141414; }
        .foot { display: flex; gap: 6px; padding: 10px 12px; border-top: 1px solid #efede8; background: #fff; flex-wrap: wrap; align-items: center; }
        .btn { border: 1px solid #cfcdc6; background: #fff; color: #141414; border-radius: 999px; padding: 6px 12px; font-size: 12px; font-weight: 500; cursor: pointer; }
        .btn:hover { background: #f0efeb; }
        .btn.primary { background: #141414; color: #fff; border-color: #141414; }
        .btn.primary:hover { background: #2b2b2b; }
        label.tog { display: flex; align-items: center; gap: 5px; font-size: 11px; color: #4a4a48; margin-left: auto; cursor: pointer; }
        .empty { padding: 18px 12px; color: #8a8985; text-align: center; }
      </style>
      <div class="panel">
        <div class="head">
          <span class="dot"></span>
          <span class="title">Autopilot <small></small></span>
          <button class="icon" data-act="min" title="Minimize">—</button>
        </div>
        <div class="status">Starting…</div>
        <div class="stats"><span>✓ <b class="s-filled">0</b> filled</span><span>⏭ <b class="s-skipped">0</b> skipped</span><span>✋ <b class="s-left">0</b> for you</span></div>
        <div class="body"><div class="empty">Looking for fields…</div></div>
        <div class="foot">
          <button class="btn primary" data-act="pause">Pause</button>
          <button class="btn" data-act="fill">Fill again</button>
          <button class="btn" data-act="next">Next page →</button>
          <button class="btn" data-act="stop">Stop</button>
          <label class="tog"><input type="checkbox" data-act="auto"> auto-advance</label>
        </div>
      </div>`;
    document.documentElement.appendChild(host);
    ui = {
      host,
      panel: root.querySelector(".panel"),
      dot: root.querySelector(".dot"),
      title: root.querySelector(".title small"),
      status: root.querySelector(".status"),
      body: root.querySelector(".body"),
      pause: root.querySelector("[data-act=pause]"),
      auto: root.querySelector("[data-act=auto]"),
      sFilled: root.querySelector(".s-filled"),
      sSkipped: root.querySelector(".s-skipped"),
      sLeft: root.querySelector(".s-left"),
    };
    ui.title.textContent = state.job?.company ? `· ${state.job.company}` : `· ${state.ats}`;
    ui.auto.checked = !!state.settings.autoAdvance;
    root.addEventListener("click", onOverlayClick);
    ui.auto.addEventListener("change", () => {
      state.settings.autoAdvance = ui.auto.checked;
      send({ type: "SAVE_SETTINGS", settings: state.settings });
    });
  }

  function onOverlayClick(e) {
    const act = e.target.closest("[data-act]")?.dataset.act;
    if (!act) {
      const row = e.target.closest(".row");
      if (row) {
        const entry = state.log.find((l) => String(l.id) === row.dataset.id);
        if (entry?.el?.isConnected) highlight(entry.el);
      }
      return;
    }
    e.stopPropagation();
    switch (act) {
      case "min":
        ui.panel.classList.toggle("min");
        e.target.textContent = ui.panel.classList.contains("min") ? "+" : "—";
        break;
      case "pause":
        state.paused = !state.paused;
        ui.pause.textContent = state.paused ? "Resume" : "Pause";
        ui.dot.classList.toggle("paused", state.paused);
        setStatus(state.paused ? "Paused — nothing will be filled until you resume." : "Resuming…");
        if (!state.paused) scan();
        break;
      case "fill":
        state.counters = {};
        scan();
        break;
      case "next":
        if (!maybeAdvance()) setStatus("Couldn't find a Next / Continue button on this page.");
        break;
      case "stop":
        state.stopped = true;
        state.running = false;
        ui.dot.classList.add("stopped");
        ui.pause.disabled = true;
        setStatus("Stopped. Finish the application yourself — nothing more will be touched.");
        send({ type: "STOP" });
        break;
      case "edit": {
        const row = e.target.closest(".row");
        const entry = state.log.find((l) => String(l.id) === row.dataset.id);
        if (entry) editEntry(entry);
        break;
      }
    }
  }

  async function editEntry(entry) {
    const el = entry.el;
    if (!el?.isConnected) return setStatus("That field is no longer on the page.");
    highlight(el);
    const current = el.tagName === "SELECT" ? el.options[el.selectedIndex]?.text : el.value ?? "";
    const next = window.prompt(`New value for "${entry.label}":`, entry.kind === "filled" ? entry.value : current || "");
    if (next == null) return;
    let ok = false;
    if (el.tagName === "SELECT") ok = await setSelect(el, next, next);
    else if (el.tagName === "BUTTON" || el.getAttribute("role") === "combobox") ok = await setCustomSelect(el, next, next);
    else if (el.type === "radio") ok = await setRadio(Array.from(document.querySelectorAll(`input[type=radio][name="${CSS.escape(el.name || "")}"]`)), next);
    else ok = await typeInto(el, next);
    entry.kind = ok ? "filled" : "left";
    entry.value = ok ? next : `Couldn't set "${next}"`;
    renderLog();
  }

  function renderLog() {
    if (!ui) return;
    ui.sFilled.textContent = state.stats.filled || 0;
    ui.sSkipped.textContent = state.stats.skipped || 0;
    ui.sLeft.textContent = state.stats.left || 0;
    const icons = { filled: "✓", skipped: "⏭", left: "✋" };
    const shown = state.log.filter((l) => l.kind !== "skipped" || !/No matching|Nothing in your profile/.test(l.value)).slice(-80);
    if (shown.length === 0) {
      ui.body.innerHTML = `<div class="empty">No fillable fields on this page yet.</div>`;
      return;
    }
    ui.body.innerHTML = shown
      .map(
        (l) => `<div class="row" data-id="${l.id}">
          <span class="k">${icons[l.kind] || "•"}</span>
          <div class="txt"><div class="lab">${esc(l.label)}</div><div class="val ${l.kind}">${esc(String(l.value ?? ""))}</div></div>
          ${l.el && l.kind !== "skipped" && l.el.type !== "file" ? `<button class="edit" data-act="edit">edit</button>` : ""}
        </div>`,
      )
      .join("");
    ui.body.scrollTop = ui.body.scrollHeight;
  }

  function esc(s) {
    return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  }

  // ---------------------------------------------------------------- lifecycle
  let observer = null;
  let debounce = null;

  function watch() {
    if (observer) return;
    observer = new MutationObserver(() => {
      if (!state.running || state.paused || state.stopped) return;
      clearTimeout(debounce);
      debounce = setTimeout(scan, 700);
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    let lastUrl = location.href;
    setInterval(() => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        state.counters = {};
        radioGroupsDone.clear();
        clearTimeout(debounce);
        debounce = setTimeout(scan, 900);
      }
    }, 500);
  }

  async function start(info) {
    state.job = info.job;
    state.profile = info.profile;
    state.resume = info.resume;
    state.settings = { ...state.settings, ...(info.settings || {}) };
    if (!state.profile) {
      buildOverlay();
      setStatus("No profile found. Open your Autopilot dashboard, upload your resume, then click the extension icon here again.");
      return;
    }
    state.running = true;
    buildOverlay();
    if (IS_TOP) {
      window.addEventListener("message", (e) => {
        if (e.data?.type === "AUTOPILOT_FRAME_LOG") {
          state.stats[e.data.kind] = (state.stats[e.data.kind] || 0) + 1;
          state.log.push({ id: state.log.length + 1, kind: e.data.kind, label: e.data.label, value: e.data.value, el: null });
          renderLog();
        }
      });
    }
    watch();
    await sleep(600);
    scan();
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === "START") {
      send({ type: "WHO_AM_I" }).then((info) => info && start(info));
      sendResponse({ ok: true });
    }
  });

  send({ type: "WHO_AM_I" }).then((info) => {
    if (info?.job) start(info);
  });
})();
