// Autopilot content script v2: takes over an application page, fills every
// page from the stored profile, pops a card for anything it can't answer, and
// stops before Submit until you confirm.

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
    settings: { acceptCookies: true, fillEeo: true, autoAdvance: true, apiKey: "" },
    creds: null,
    answers: {},
    mode: "idle", // idle | running | paused | prompt | manual | done | stopped
    seen: new WeakSet(),
    filled: new WeakSet(),
    manual: new WeakSet(),
    counters: {},
    log: [],
    stats: { filled: 0, skipped: 0, left: 0 },
    ats: detectAts(),
    busy: false,
    queued: false,
    pageKey: "",
    nextAttempts: 0,
    applyAttempts: 0,
    authAttempts: 0,
    submitted: false,
    pending: [], // unknown questions collected for one batched card per page
    wd: null,
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
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  function send(msg) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(msg, (res) => resolve(chrome.runtime.lastError ? null : res));
      } catch {
        resolve(null);
      }
    });
  }

  // ---------------------------------------------------------------- dom helpers
  function textOf(el) {
    return el ? norm(el.innerText || el.textContent) : "";
  }

  function isVisible(el) {
    if (!el || !el.isConnected) return false;
    if (el.closest("#autopilot-host")) return false;
    if (el.type === "file") {
      // Usually display:none behind a styled "Attach" button, so judge by the
      // nearest ancestor that has layout instead of the input itself.
      if (el.disabled) return false;
      let a = el.parentElement;
      for (let i = 0; a && i < 4; i++, a = a.parentElement) {
        const r = a.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) return true;
        if (getComputedStyle(a).display === "none") return false;
      }
      return !!a;
    }
    const style = getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  const CONTROL_SEL = "input:not([type=hidden]), textarea, select, button[aria-haspopup='listbox'], [role=combobox]";

  function fieldContainer(el) {
    const explicit = el.closest('[data-automation-id^="formField"], .field, .form-field, .application-question, .ashby-application-form-field-entry, .form-group');
    if (explicit && explicit.querySelectorAll(CONTROL_SEL).length <= 2) return explicit;
    let node = el.parentElement;
    for (let depth = 0; node && depth < 6; depth++) {
      const controls = node.querySelectorAll(CONTROL_SEL).length;
      if (controls > 1 && !(el.type === "radio" || el.type === "checkbox")) return null;
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

  function humanLabel(label) {
    return (label || "").split(" | ")[0].trim() || label || "field";
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

  function groupContainer(el) {
    return el.closest("fieldset, [role=radiogroup], [role=group], [data-automation-id^='formField'], .application-question, .field, .form-group") || el.parentElement?.parentElement || el.parentElement;
  }

  function questionTextFor(el) {
    const group = groupContainer(el);
    if (!group) return labelFor(el);
    const legend = group.querySelector("legend, [id*='label'], [class*='label'], p, span");
    const own = el.closest("label");
    const base = legend && !legend.contains(el) ? textOf(legend) : textOf(group);
    const t = base.replace(textOf(own), "");
    return t.slice(0, 220) + " | " + (el.name || "");
  }

  function isRequired(el) {
    if (el.required || el.getAttribute("aria-required") === "true") return true;
    let lab = null;
    if (el.id) {
      try { lab = document.querySelector(`label[for="${CSS.escape(el.id)}"]`); } catch { /* ignore */ }
    }
    if (!lab) {
      const c = el.type === "radio" || el.type === "checkbox" ? groupContainer(el) : fieldContainer(el);
      lab = c && c.tagName !== "FORM" && c.tagName !== "BODY" ? c.querySelector("label, legend, [class*='label']") : null;
    }
    return !!(lab && /\*|required/i.test(lab.textContent || ""));
  }

  function highlight(el) {
    try {
      el.scrollIntoView({ block: "center", behavior: "smooth" });
      const prev = el.style.boxShadow;
      el.style.transition = "box-shadow 200ms";
      el.style.boxShadow = "0 0 0 3px rgba(20,20,20,0.5)";
      setTimeout(() => { el.style.boxShadow = prev; }, 1200);
    } catch { /* ignore */ }
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
    return Array.from(document.querySelectorAll("[data-automation-id='promptOption'], [role=option], [role=listbox] li, ul[data-automation-id*='Options'] li, .select__option, [class*='option']"))
      .filter((o) => isVisible(o) && textOf(o).length > 0 && textOf(o).length < 120);
  }

  async function openCustom(el) {
    if (el.tagName === "INPUT") {
      el.focus();
      el.click();
    } else {
      el.click();
    }
    await sleep(350);
  }

  function closeCustom() {
    document.body.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape", code: "Escape" }));
    document.activeElement?.blur?.();
  }

  // Read the options of a custom dropdown without choosing one.
  async function readCustomOptions(el) {
    await openCustom(el);
    const opts = visibleOptions().map((o) => textOf(o)).filter((t, i, a) => a.indexOf(t) === i);
    closeCustom();
    await sleep(120);
    return opts.slice(0, 60);
  }

  async function setCustomSelect(el, value, alt) {
    el.scrollIntoView({ block: "center" });
    const isInput = el.tagName === "INPUT";
    if (isInput) {
      el.focus();
      setNativeValue(el, value);
      await sleep(500);
    } else {
      el.click();
      await sleep(350);
      const search = document.querySelector("[role=listbox] input, [data-automation-id*='search'] input:not([type=hidden]), [data-automation-id='searchBox']");
      if (search && isVisible(search)) {
        setNativeValue(search, value);
        await sleep(450);
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
      await sleep(200);
      return true;
    }
    if (isInput && opts.length > 0 && value) {
      el.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowDown", code: "ArrowDown" }));
      el.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter", code: "Enter" }));
      await sleep(200);
      return true;
    }
    closeCustom();
    return false;
  }

  function radioText(r) {
    const own = r.closest("label");
    const t = own ? (own.innerText || own.textContent) : "";
    return (t || labelFor(r).split(" | ")[0] || "").replace(/\s+/g, " ").trim();
  }

  function radioLabel(r) {
    return norm(radioText(r));
  }

  async function setRadio(radios, wantedText) {
    if (!wantedText) return false;
    const want = norm(wantedText);
    const target = radios.find((r) => radioLabel(r) === want) || radios.find((r) => radioLabel(r).startsWith(want + " ") || radioLabel(r).startsWith(want + ",")) || radios.find((r) => radioLabel(r).includes(want));
    if (!target) return false;
    (target.closest("label") || target).click();
    await sleep(80);
    if (!target.checked) {
      target.checked = true;
      target.dispatchEvent(new Event("change", { bubbles: true }));
    }
    return true;
  }

  async function setFile(input) {
    if (!state.resume?.b64) return false;
    const bin = atob(state.resume.b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const file = new File([bytes], state.resume.name, { type: state.resume.type || "application/pdf" });
    const dt = new DataTransfer();
    dt.items.add(file);
    try {
      input.files = dt.files;
    } catch {
      return false;
    }
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    // Some uploaders listen for drop events on a wrapper instead.
    const zone = input.closest("[class*='drop'], [data-automation-id*='file'], label") || input.parentElement;
    if (zone) {
      try {
        zone.dispatchEvent(new DragEvent("drop", { bubbles: true, dataTransfer: dt }));
      } catch { /* ignore */ }
    }
    return true;
  }

  function monthName(mm) {
    return ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"][Number(mm) - 1] || "";
  }

  async function setDate(el, raw) {
    const d = R.fmtMonthYear(raw);
    if (!d) return false;
    const aid = el.getAttribute("data-automation-id") || "";
    const keys = state.wd ? state.wd.typeKeys : typeInto;
    if (/dateSectionMonth/i.test(aid)) return keys(el, d.month);
    if (/dateSectionYear/i.test(aid)) return keys(el, d.year);
    if (/dateSectionDay/i.test(aid)) return keys(el, d.day || "01");
    if (el.type === "month") return typeInto(el, `${d.year}-${d.month}`);
    if (el.type === "date") return typeInto(el, `${d.year}-${d.month}-${d.day || "01"}`);
    if (el.tagName === "SELECT") {
      const isYear = Array.from(el.options).some((o) => /^\d{4}$/.test(o.text.trim()));
      return setSelect(el, isYear ? d.year : monthName(d.month), isYear ? d.year : d.month);
    }
    const ph = norm(el.getAttribute("placeholder"));
    const lab = labelFor(el);
    if (/^yyyy$/.test(ph) || (/\byear\b/.test(lab) && !/month/.test(lab))) return typeInto(el, d.year);
    if (/^mm$/.test(ph) || (/\bmonth\b/.test(lab) && !/year/.test(lab))) return typeInto(el, d.month);
    if (/dd/.test(ph)) return typeInto(el, d.text.includes("/") && d.day ? `${d.month}/${d.day}/${d.year}` : d.text);
    return typeInto(el, d.text);
  }

  // ---------------------------------------------------------------- field scan
  function candidates() {
    const sel = "input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=reset]):not([type=image]):not([type=password]), textarea, select, button[aria-haspopup='listbox'], [role=combobox]";
    return Array.from(document.querySelectorAll(sel)).filter((el) => {
      if (state.seen.has(el)) return false;
      if (el.closest("#autopilot-host")) return false;
      if (el.disabled || el.readOnly) return false;
      if (el.getAttribute("aria-hidden") === "true") return false;
      if (el.tagName !== "INPUT" && el.tagName !== "BUTTON" && el.tagName !== "SELECT" && el.tagName !== "TEXTAREA" && el.querySelector("input")) return false;
      return isVisible(el);
    });
  }

  function hasValue(el) {
    if (el.tagName === "SELECT") return el.selectedIndex > 0 && el.value !== "";
    if (el.tagName === "BUTTON") return !/select one|^select$|choose|^$/.test(norm(el.textContent));
    if (el.type === "file") return el.files && el.files.length > 0;
    if (el.type === "checkbox" || el.type === "radio") return false;
    return typeof el.value === "string" && el.value.trim().length > 0;
  }

  function pickRule(label, scope, kind) {
    const cands = R.RULES.filter((r) => {
      if (r.scope && r.scope !== scope) return false;
      if (kind === "file") return r.kind === "file";
      if (r.kind === "file") return false;
      if (kind === "bool") return r.kind === "bool";
      if (kind === "check") return r.kind === "check";
      if (r.kind === "bool" || r.kind === "check") return false;
      if (r.kind === "textarea" && kind !== "textarea") return false;
      return true;
    });
    cands.sort((a, b) => (b.scope ? 1 : 0) - (a.scope ? 1 : 0));
    for (const part of label.split(" | ")) {
      const hit = cands.find((r) => r.test.test(part));
      if (hit) return hit;
    }
    return cands.find((r) => r.test.test(label)) || null;
  }

  function nextIndex(key, scope) {
    const k = `${key}@${scope}`;
    const i = state.counters[k] || 0;
    state.counters[k] = i + 1;
    return i;
  }

  // ---------------------------------------------------------------- answer resolution
  function answerKey(question) {
    return norm(question).replace(/[^a-z0-9 ]/g, "").slice(0, 120);
  }

  async function applyAnswer(el, answer, kindInfo) {
    const { isCustom, radios, checks } = kindInfo;
    if (radios) return setRadio(radios, answer);
    if (checks) {
      const target = checks.find((c) => norm(textOf(c.closest("label")) || labelFor(c)).includes(norm(answer)));
      if (!target) return false;
      if (!target.checked) (target.closest("label") || target).click();
      return true;
    }
    if (el.tagName === "SELECT") return setSelect(el, answer, answer);
    if (isCustom) return setCustomSelect(el, answer, answer);
    if (el.type === "file") return false;
    return typeInto(el, String(answer));
  }

  /**
   * Resolve a question we have no rule for: saved answers → AI → ask the user.
   * Returns { answer } | { skip: true } | { manual: true }.
   */
  async function resolveUnknown({ question, options, kind, required, el }) {
    const key = answerKey(question);
    if (state.answers[key] && (!options || options.some((o) => norm(o) === norm(state.answers[key])))) {
      return { answer: state.answers[key], source: "saved" };
    }
    const isEeo = R.EEO_RE.test(question);
    if (!isEeo && state.settings.apiKey) {
      setStatus(`Thinking about “${question.slice(0, 60)}”…`);
      const res = await send({ type: "AI_ANSWER", question, options: options || null, kind, job: state.job });
      if (res?.answer) return { answer: res.answer, source: "ai" };
      if (res?.error && res.error !== "no_key") addLog("left", el, question, `AI error: ${res.error}`);
    }
    // Obvious yes/no screening questions get a sensible default, marked "guess".
    if (!isEeo && options && options.length >= 2 && options.length <= 3) {
      const yn = options.filter((o) => /^(yes|no)\b/i.test(o));
      if (yn.length >= 2) {
        const g = R.guessYesNo(question);
        if (g) {
          const match = options.find((o) => new RegExp(`^${g}\\b`, "i").test(o));
          if (match) return { answer: match, source: "guess" };
        }
      }
    }
    if (!isEeo && options && options.length) {
      const g = R.guessChoice(question, options, state.profile);
      if (g) return { answer: g, source: "guess" };
    }
    // Optional and unknown → leave it blank rather than interrupt.
    if (!required) return { skip: true };
    if (state.deferring) return { defer: true };
    const resp = await prompt({
      type: options && options.length ? "choice" : "text",
      title: isEeo ? "Demographic question" : required ? "Required question" : "I'm not sure about this one",
      question,
      options,
      el,
      allowRemember: !isEeo,
    });
    if (resp.remember && resp.answer) {
      state.answers[key] = resp.answer;
      send({ type: "SAVE_ANSWER", key, answer: resp.answer });
    }
    return resp;
  }

  // ---------------------------------------------------------------- per-field processing
  async function processElement(el) {
    state.seen.add(el);
    const type = (el.getAttribute("type") || (el.tagName === "TEXTAREA" ? "textarea" : el.tagName === "SELECT" ? "select" : "text")).toLowerCase();
    if (type === "checkbox") return processCheckbox(el);
    if (type === "radio") return processRadio(el);
    if (type === "search" && !el.closest("form")) return;

    const label = labelFor(el);
    const scope = scopeOf(el);
    const containerText = textOf(fieldContainer(el)).slice(0, 300);
    const required = isRequired(el);
    const isCustom = el.tagName === "BUTTON" || el.getAttribute("role") === "combobox" || el.getAttribute("aria-autocomplete") === "list";
    const kind = type === "file" ? "file" : type === "textarea" ? "textarea" : isCustom || type === "select" ? "select" : "text";

    if (hasValue(el)) return;

    // Demographics: answered only from profile.eeo.
    if (R.EEO_RE.test(label) || R.EEO_RE.test(containerText)) {
      if (kind === "file" || kind === "text") return;
      return processEeoChoice(el, label, { isCustom });
    }

    if (/search/.test(label)) return;
    if (R.SKIP_RE.test(label) && !/cover letter/.test(label)) return addLog("skipped", el, label, "Left blank on purpose");

    const rule = pickRule(label, scope, kind);

    if (kind === "file") {
      if (!rule) return;
      if (/cover|transcript|photo|headshot|writing sample|portfolio|other document|additional/.test(label)) return addLog("skipped", el, label, "Not a resume slot");
      const ok = await setFile(el);
      if (ok) state.filled.add(el);
      return addLog(ok ? "filled" : "left", el, label, ok ? state.resume.name : "No resume stored — upload it in the dashboard Profile tab");
    }

    let value = "";
    let alt = "";
    let source = "profile";
    if (rule) {
      const idx = nextIndex(rule.key, scope);
      value = rule.value(state.profile, idx) ?? "";
      alt = rule.alt ? rule.alt(state.profile, idx) ?? "" : "";
      if (rule.ai && state.settings.apiKey) {
        const res = await send({ type: "AI_ANSWER", question: humanLabel(label), options: null, kind: "text", job: state.job });
        if (res?.answer) { value = res.answer; source = "ai"; }
      }
    }

    if (!value) {
      // No rule or empty profile field → unknown-question path.
      let options = null;
      if (el.tagName === "SELECT") options = Array.from(el.options).map((o) => o.text.trim()).filter((t) => t && !/^(select|choose|please select|--)/i.test(t));
      else if (isCustom && el.tagName !== "INPUT") options = await readCustomOptions(el);
      const question = humanLabel(label) + (containerText && containerText !== norm(humanLabel(label)) ? ` — ${containerText.slice(0, 160)}` : "");
      const q = humanLabel(label).length > 12 ? humanLabel(label) : question;
      const resp = await resolveUnknown({ question: q, options, kind: kind === "textarea" ? "text" : kind, required, el });
      if (resp.defer) { state.pending.push({ el, question: q, options, kind: kind === "textarea" ? "text" : kind, isCustom, label }); return; }
      if (resp.skip) return addLog("skipped", el, label, required ? "Skipped (required — the form may complain)" : "Nothing to put here");
      if (resp.manual) { state.manual.add(el); return addLog("left", el, label, "You're filling this one"); }
      value = resp.answer;
      source = resp.source || "you";
    }

    highlight(el);
    let ok = false;
    if (rule?.kind === "date") ok = await setDate(el, value);
    else if (el.tagName === "SELECT") ok = await setSelect(el, value, alt);
    else if (isCustom) ok = await setCustomSelect(el, value, alt);
    else ok = await typeInto(el, String(value));
    if (ok) state.filled.add(el);
    addLog(ok ? "filled" : "left", el, label, ok ? String(value) : `Couldn't set “${value}”`, source);
    if (!ok && (required || isCustom || el.tagName === "SELECT")) {
      const options = el.tagName === "SELECT" ? Array.from(el.options).map((o) => o.text.trim()).filter(Boolean) : isCustom ? await readCustomOptions(el) : null;
      const resp = await prompt({ type: options && options.length ? "choice" : "text", title: "Couldn't fill this", question: `${humanLabel(label)} — I wanted “${value}” but the form didn't accept it.`, options, el });
      if (resp.answer) {
        const ok2 = await applyAnswer(el, resp.answer, { isCustom });
        addLog(ok2 ? "filled" : "left", el, label, ok2 ? resp.answer : "Still couldn't set it", "you");
      }
    }
  }

  async function processEeoChoice(el, label, { isCustom }) {
    if (!state.settings.fillEeo) return addLog("left", el, label, "Demographic question — auto-fill turned off");
    const key = R.eeoKeyFor(label) || R.eeoKeyFor(textOf(fieldContainer(el)).slice(0, 300));
    let options = [];
    if (el.tagName === "SELECT") options = Array.from(el.options).map((o) => o.text.trim()).filter((t) => t && !/^(select|choose|please select|--)/i.test(t));
    else if (isCustom) options = await readCustomOptions(el);
    const pick = key ? R.eeoPick(key, state.profile.eeo, options) : null;
    if (pick) {
      highlight(el);
      const ok = el.tagName === "SELECT" ? await setSelect(el, pick, pick) : await setCustomSelect(el, pick, pick);
      if (ok) state.filled.add(el);
      return addLog(ok ? "filled" : "left", el, label, ok ? pick : `Couldn't pick “${pick}”`, "profile");
    }
    const resp = await prompt({ type: "choice", title: "Demographic question", question: humanLabel(label), options, el, hint: "Set these once in the dashboard Profile tab to skip this card next time." });
    if (resp.answer) {
      const ok = await applyAnswer(el, resp.answer, { isCustom });
      addLog(ok ? "filled" : "left", el, label, ok ? resp.answer : "Couldn't set it", "you");
    } else addLog(resp.manual ? "left" : "skipped", el, label, resp.manual ? "You're filling this one" : "Skipped");
  }

  const checkboxGroupsDone = new Set();
  async function processCheckbox(el) {
    const label = labelFor(el);
    const scope = scopeOf(el);
    const group = groupContainer(el);
    const groupText = textOf(group).slice(0, 300);
    // A set of checkboxes acting as single-choice demographics (Workday's disability form).
    if (R.EEO_RE.test(groupText) || R.EEO_RE.test(label)) {
      const checks = Array.from(group.querySelectorAll("input[type=checkbox]")).filter(isVisible);
      const gkey = checks.map((c) => c.id || c.name).join(",");
      if (checkboxGroupsDone.has(gkey)) return;
      checkboxGroupsDone.add(gkey);
      checks.forEach((c) => state.seen.add(c));
      if (checks.some((c) => c.checked)) return;
      if (!state.settings.fillEeo) return addLog("left", el, groupText, "Demographic question — auto-fill turned off");
      const texts = checks.map((c) => textOf(c.closest("label")) || labelFor(c).split(" | ")[0]);
      const key = R.eeoKeyFor(groupText + " " + texts.join(" "));
      const pick = key ? R.eeoPick(key, state.profile.eeo, texts) : null;
      const question = humanLabel(questionTextFor(el));
      if (pick) {
        const ok = await applyAnswer(el, pick, { checks });
        return addLog(ok ? "filled" : "left", el, question, ok ? pick : "Couldn't tick it", "profile");
      }
      const resp = await prompt({ type: "choice", title: "Demographic question", question, options: texts, el, hint: "Set these once in the dashboard Profile tab to skip this card next time." });
      if (resp.answer) {
        const ok = await applyAnswer(el, resp.answer, { checks });
        addLog(ok ? "filled" : "left", el, question, ok ? resp.answer : "Couldn't tick it", "you");
      }
      return;
    }
    const rule = pickRule(label, scope, "check");
    if (!rule) return;
    if (rule.key === "expCurrent") {
      const idx = state.counters[`jobTitle@${scope}`] || 0;
      const want = rule.value(state.profile, Math.max(0, idx - 1));
      if (want && !el.checked) { highlight(el); (el.closest("label") || el).click(); state.filled.add(el); addLog("filled", el, label, "Checked"); }
      return;
    }
    if (!el.checked) {
      highlight(el);
      (el.closest("label") || el).click();
      await sleep(60);
      if (!el.checked) { el.checked = true; el.dispatchEvent(new Event("change", { bubbles: true })); }
      state.filled.add(el);
      addLog("filled", el, label, "Ticked");
    }
  }

  const radioGroupsDone = new Set();
  async function processRadio(el) {
    const name = el.name || labelFor(el);
    if (radioGroupsDone.has(name)) return;
    const radios = el.name ? Array.from(document.querySelectorAll(`input[type=radio][name="${CSS.escape(el.name)}"]`)).filter(isVisible) : [el];
    radios.forEach((r) => state.seen.add(r));
    radioGroupsDone.add(name);
    if (radios.some((r) => r.checked)) return;
    const question = humanLabel(questionTextFor(el));
    const groupText = textOf(groupContainer(el)).slice(0, 300);
    const texts = radios.map(radioText);

    if (R.EEO_RE.test(question) || R.EEO_RE.test(groupText)) {
      if (!state.settings.fillEeo) return addLog("left", el, question, "Demographic question — auto-fill turned off");
      const key = R.eeoKeyFor(groupText + " " + question);
      const pick = key ? R.eeoPick(key, state.profile.eeo, texts) : null;
      if (pick) {
        highlight(radios[0]);
        const ok = await setRadio(radios, pick);
        return addLog(ok ? "filled" : "left", el, question, ok ? pick : "Couldn't select it", "profile");
      }
      const resp = await prompt({ type: "choice", title: "Demographic question", question, options: texts, el, hint: "Set these once in the dashboard Profile tab to skip this card next time." });
      if (resp.answer) {
        const ok = await setRadio(radios, resp.answer);
        addLog(ok ? "filled" : "left", el, question, ok ? resp.answer : "Couldn't select it", "you");
      }
      return;
    }

    const rule = pickRule(question, "", "bool");
    let want = rule ? rule.value(state.profile, 0) : "";
    let source = "profile";
    if (want && !texts.some((t) => norm(t) === norm(want) || norm(t).startsWith(norm(want) + " ") || norm(t).startsWith(norm(want) + ","))) want = ""; // e.g. options aren't Yes/No
    if (!want) {
      const resp = await resolveUnknown({ question, options: texts, kind: "choice", required: isRequired(el), el });
      if (resp.defer) { state.pending.push({ el, question, options: texts, kind: "choice", radios, label: question }); return; }
      if (resp.skip) return addLog("skipped", el, question, "Skipped");
      if (resp.manual) { state.manual.add(el); return addLog("left", el, question, "You're choosing this one"); }
      want = resp.answer;
      source = resp.source || "you";
    }
    highlight(radios[0]);
    const ok = await setRadio(radios, want);
    addLog(ok ? "filled" : "left", el, question, ok ? want : `Wanted “${want}” — couldn't select it`, source);
  }

  async function flushPending() {
    const items = state.pending.splice(0);
    if (items.length === 0) return;
    if (!IS_TOP) return;
    const answers = await prompt({ type: "batch", title: `${items.length} question${items.length > 1 ? "s" : ""} I couldn't answer`, items });
    if (answers.manual) { items.forEach((it) => state.manual.add(it.el)); return; }
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const a = answers.values?.[i];
      if (!a || !a.answer) { addLog("skipped", it.el, it.label, "Skipped"); continue; }
      const ok = await applyAnswer(it.el, a.answer, { isCustom: it.isCustom, radios: it.radios });
      if (ok) state.filled.add(it.el);
      addLog(ok ? "filled" : "left", it.el, it.label, ok ? a.answer : `Couldn't set “${a.answer}”`, "you");
      if (a.remember) { const key = answerKey(it.question); state.answers[key] = a.answer; send({ type: "SAVE_ANSWER", key, answer: a.answer }); }
    }
  }

  function looksLikeWorkday() {
    return state.ats === "workday" || !!document.querySelector('[data-automation-id="workExperienceSection"], [data-automation-id="educationSection"], [data-automation-id="bottom-navigation-next-button"], [data-automation-id="legalNoticeAcceptButton"], [data-automation-id="autofillWithResume"]');
  }

  function ensureWorkday() {
    if (state.wd || !window.AutopilotWorkday || !looksLikeWorkday()) return;
    state.wd = window.AutopilotWorkday.install({ sleep, norm, textOf, isVisible, typeInto, setNativeValue, addLog, highlight, setStatus, setStatusQuiet: setStatus, fmtMonthYear: R.fmtMonthYear, markSeen: (el) => state.seen.add(el) });
  }

  async function fillPage() {
    ensureWorkday();
    if (state.wd && state.wd.isExperiencePage()) {
      try {
        await state.wd.run(state.profile, { setFile, resumeName: () => state.resume?.name || "resume" });
      } catch (err) {
        addLog("left", document.body, "Workday experience page", "Error: " + (err?.message || err));
      }
      if (state.mode !== "running") return false;
    }
    state.deferring = true;
    const els = candidates();
    for (const el of els) {
      if (state.mode !== "running") return false;
      try {
        await processElement(el);
      } catch (err) {
        addLog("left", el, labelFor(el), "Error: " + (err?.message || err));
      }
      await sleep(150);
    }
    state.deferring = false;
    await flushPending();
    return els.length > 0;
  }

  // ---------------------------------------------------------------- page-level actions
  function clickable(el) {
    return el && isVisible(el) && !el.disabled && !el.closest("#autopilot-host");
  }

  function buttonsOnPage() {
    return Array.from(document.querySelectorAll("button, input[type=submit], input[type=button], a[role=button], a.btn, a[class*='button'], [role=button]")).filter(clickable);
  }

  function btnText(b) {
    return norm(b.innerText || b.value || b.getAttribute("aria-label") || b.textContent);
  }

  function dismissCookies() {
    if (!state.settings.acceptCookies) return false;
    const known = document.querySelector("#onetrust-accept-btn-handler, #CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll, #truste-consent-button, .cc-btn.cc-allow, button[data-automation-id='legalNoticeAcceptButton'], #cookie-accept, .cookie-accept, button[aria-label='Accept cookies'], button[id*='accept-cookies'], button[class*='accept-cookies']");
    if (clickable(known)) { known.click(); addLog("filled", known, "Cookie banner", "Accepted", "auto"); return true; }
    for (const b of buttonsOnPage()) {
      const t = btnText(b);
      if (!R.COOKIE_RE.test(t)) continue;
      const scopeEl = b.closest("[id*='cookie'], [class*='cookie'], [id*='consent'], [class*='consent'], [aria-label*='cookie'], [role=dialog], [role=alertdialog], [class*='banner'], [id*='banner'], [class*='gdpr'], [id*='gdpr']");
      if (!scopeEl || !/cookie|consent|privacy|gdpr/i.test(scopeEl.textContent || "")) continue;
      b.click();
      addLog("filled", b, "Cookie banner", `Clicked “${b.innerText.trim()}”`, "auto");
      return true;
    }
    return false;
  }

  function findApplyButton() {
    const explicit = document.querySelector("[data-automation-id='autofillWithResume'], [data-automation-id='applyManually'], a[data-automation-id='adventureButton'], [data-automation-id='adventureButton'], a[href$='/application'][class*='ashby'], a.postings-btn[href*='/apply'], a[href*='/apply'].btn-apply");
    if (clickable(explicit)) return explicit;
    const all = buttonsOnPage().concat(Array.from(document.querySelectorAll("a")).filter(clickable));
    const matches = all.filter((b) => R.APPLY_RE.test(btnText(b)) && !R.APPLY_AVOID_RE.test(btnText(b) + " " + (b.getAttribute("href") || "")));
    matches.sort((a, b) => rank(btnText(b)) - rank(btnText(a)));
    return matches[0] || null;
    function rank(t) {
      if (/autofill with resume/.test(t)) return 4;
      if (/apply manually/.test(t)) return 3;
      if (/^apply( now)?$/.test(t)) return 2;
      return 1;
    }
  }

  function findNextButton() {
    const explicit = document.querySelector("[data-automation-id='bottom-navigation-next-button'], button[data-automation-id*='next'], [data-ui='next']");
    if (clickable(explicit) && !R.SUBMIT_RE.test(btnText(explicit))) return explicit;
    return buttonsOnPage().find((b) => R.NEXT_RE.test(btnText(b)) && !R.SUBMIT_RE.test(btnText(b))) || null;
  }

  function findSubmitButton() {
    const explicit = document.querySelector("[data-automation-id='bottom-navigation-next-button'], button[type=submit], input[type=submit], #submit_app, button[data-qa='btn-submit'], button[class*='submit']");
    const list = [explicit, ...buttonsOnPage()].filter(clickable);
    return list.find((b) => R.SUBMIT_RE.test(btnText(b)) && !/apply with|resubmit|submit a (new|another)/.test(btnText(b))) || null;
  }

  function validationErrors() {
    const nodes = Array.from(document.querySelectorAll("[data-automation-id='errorMessage'], [role=alert], .error-message, .field-error, .invalid-feedback, [class*='error']:not(script):not(style), [aria-invalid='true']"))
      .filter(isVisible);
    const msgs = [];
    for (const n of nodes) {
      const t = n.getAttribute("aria-invalid") === "true" ? `${humanLabel(labelFor(n))}: invalid or missing` : textOf(n);
      if (t && t.length > 3 && t.length < 200 && !msgs.includes(t)) msgs.push(t);
    }
    return msgs.slice(0, 6);
  }

  function invalidFields() {
    return Array.from(document.querySelectorAll("[aria-invalid='true'], .error input, .has-error input, .field_with_errors input, [data-automation-id='errorMessage'] ~ * input"))
      .filter((el) => isVisible(el) && !el.closest("#autopilot-host"));
  }

  function formFieldCount() {
    return Array.from(document.querySelectorAll("input[type=text], input[type=email], input[type=tel], input:not([type]), textarea, select, button[aria-haspopup='listbox'], input[type=file], input[type=radio]"))
      .filter((el) => isVisible(el) && !el.disabled && !el.closest("#autopilot-host, header, nav") && !/search/i.test(labelFor(el))).length;
  }

  function emptyRequiredFields() {
    return candidatesAll().filter((el) => isRequired(el) && !hasValue(el) && !(el.type === "radio" || el.type === "checkbox" || el.type === "file"));
    function candidatesAll() {
      return Array.from(document.querySelectorAll("input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=password]), textarea, select, button[aria-haspopup='listbox']")).filter((el) => isVisible(el) && !el.disabled && !el.closest("#autopilot-host"));
    }
  }

  function confirmationSeen() {
    const t = norm(document.body.innerText).slice(0, 4000);
    return /thank you for (applying|your application|submitting)|application (has been |was )?(submitted|received|complete)|successfully (submitted|applied)|we'?ve received your application|you have applied|your application was sent|application sent/.test(t)
      || /thank|confirmation|success|submitted/.test(location.pathname.toLowerCase());
  }

  // ---------------------------------------------------------------- auth (Workday & friends)
  function passwordFields() {
    return Array.from(document.querySelectorAll("input[type=password]")).filter(isVisible);
  }

  async function handleAuth() {
    const pws = passwordFields();
    if (pws.length === 0) return false;
    if (state.authGaveUp) return false;
    if (state.authAttempts >= 4) {
      state.authGaveUp = true;
      await prompt({ type: "info", title: "Sign-in isn't working", question: "I tried a few times and this page is still asking for a password. Sign in yourself; I'll continue once the form appears.", el: pws[0] });
      return true;
    }
    const createMode = pws.length >= 2 || /create account|create an account|sign up|register|verify (new )?password/.test(norm(document.body.innerText).slice(0, 3000));
    const emailEl = Array.from(document.querySelectorAll("input[type=email], input[name*='email' i], input[id*='email' i], input[data-automation-id='email'], input[type=text][autocomplete='username']")).find(isVisible);
    const saved = state.settings.accountPassword || state.creds?.password || "";
    let resp;
    if (saved && state.authAttempts === 0) {
      // A password is saved on the dashboard: go straight in, no card.
      resp = { email: state.profile.email, password: saved, remember: !!state.creds?.remember };
      setStatus(createMode ? "Creating an account with your saved password…" : "Signing in with your saved password…");
    } else {
      resp = await prompt({
        type: "creds",
        title: createMode ? "This site wants an account" : "Sign in to continue",
        question: createMode
          ? `${HOST} needs its own account before the application. I'll enter these for you (and tick its terms box).`
          : `${HOST} is asking you to sign in. I'll enter these for you.`,
        email: state.profile.email,
        password: saved,
        remember: !!state.creds?.remember,
        switchLabel: createMode ? "I already have an account" : "I need to create an account",
      });
    }
    if (resp.manual) return true;
    if (resp.switch) {
      const link = document.querySelector("[data-automation-id='signInLink'], [data-automation-id='createAccountLink']") || buttonsOnPage().concat(Array.from(document.querySelectorAll("a"))).find((b) => /^(sign in|log in|create account|create an account|sign up|register)$/i.test(btnText(b)));
      if (link) { link.click(); await sleep(1200); }
      return true;
    }
    state.authAttempts++;
    if (resp.remember) {
      state.creds = { password: resp.password, remember: true };
      send({ type: "SAVE_CREDS", creds: state.creds });
    } else if (state.creds?.remember) {
      state.creds = null;
      send({ type: "SAVE_CREDS", creds: null });
    }
    setStatus("Signing in…");
    if (emailEl) await typeInto(emailEl, resp.email || state.profile.email);
    for (const pw of passwordFields()) await typeInto(pw, resp.password);
    for (const cb of Array.from(document.querySelectorAll("input[type=checkbox]")).filter(isVisible)) {
      if (!cb.checked && /agree|terms|privacy|acknowledg|consent/i.test(textOf(groupContainer(cb)))) (cb.closest("label") || cb).click();
    }
    await sleep(200);
    const submit = document.querySelector("[data-automation-id='createAccountSubmitButton'], [data-automation-id='signInSubmitButton'], button[type=submit]") || buttonsOnPage().find((b) => /create account|sign in|log in|continue|register|next/i.test(btnText(b)));
    if (clickable(submit)) submit.click();
    addLog("filled", emailEl || pws[0], createMode ? "Account" : "Sign in", resp.email || state.profile.email, "you");
    await sleep(2500);
    const errs = validationErrors().filter((e) => /already|exist|incorrect|invalid|not match|does not|unable|error|weak|must contain|at least/i.test(e));
    if (errs.length) {
      const already = errs.some((e) => /already|exist/i.test(e));
      const wrongPw = !createMode && errs.some((e) => /incorrect|invalid|does not|unable|not match/i.test(e));
      const signInLink = () => document.querySelector("[data-automation-id='signInLink']") || Array.from(document.querySelectorAll("a, button")).find((b) => /^sign in$/i.test(btnText(b)));
      const createLink = () => document.querySelector("[data-automation-id='createAccountLink']") || Array.from(document.querySelectorAll("a, button")).find((b) => /^(create account|create an account|sign up)$/i.test(btnText(b)));
      if (saved && !state.authFlipped && (already || wrongPw)) {
        // Saved password, first failure: flip between sign-in and create-account once, silently.
        const link = already ? signInLink() : createLink();
        if (link) {
          setStatus(already ? "Account exists — signing in instead…" : "No account yet — creating one…");
          state.authFlipped = true;
          state.authAttempts = 0; // allow one more automatic try on the other form
          link.click();
          await sleep(1200);
          return true;
        }
      }
      const r2 = await prompt({ type: "info", title: already ? "Account already exists" : "Sign-in problem", question: errs.join(" · "), okLabel: already ? "Switch to Sign in" : "Try again", el: pws[0] });
      if (already && !r2.manual) {
        const link = signInLink();
        if (link) { link.click(); await sleep(1200); }
      }
    }
    return true;
  }

  // ---------------------------------------------------------------- orchestration
  function pageKey() {
    return location.href.split("#")[0];
  }

  async function step() {
    if (state.mode !== "running") return;
    if (state.busy) { state.queued = true; return; }
    state.busy = true;
    try {
      if (pageKey() !== state.pageKey) {
        state.pageKey = pageKey();
        state.counters = {};
        state.nextAttempts = 0;
        radioGroupsDone.clear();
        checkboxGroupsDone.clear();
      }

      if (state.submitted) {
        if (confirmationSeen()) return finish("Submitted ✓", true);
        return;
      }

      if (dismissCookies()) { await sleep(600); }

      if (await handleAuth()) { await sleep(1500); state.queued = true; return; }

      setStatus("Filling this page…");
      const hadFields = await fillPage();
      if (state.mode !== "running") return;

      // No real form here: are we on a posting page with an Apply button?
      if (formFieldCount() === 0) {
        const apply = findApplyButton();
        if (apply && state.applyAttempts < 4) {
          state.applyAttempts++;
          setStatus(`Clicking “${(apply.innerText || apply.value || "Apply").trim()}”…`);
          highlight(apply);
          apply.click();
          addLog("filled", apply, "Button", `Clicked “${(apply.innerText || "Apply").trim()}”`, "auto");
          await sleep(1800);
          state.queued = true;
          return;
        }
      }

      // Required fields still empty → ask, one at a time.
      state.deferring = true;
      for (const el of emptyRequiredFields()) {
        if (state.mode !== "running") return;
        if (state.filled.has(el) || state.manual.has(el)) continue;
        state.seen.delete(el);
        await processElement(el);
      }
      state.deferring = false;
      await flushPending();

      if (state.mode !== "running") return;
      const submit = findSubmitButton();
      const next = findNextButton();

      if (submit && (!next || submit === next)) {
        const errs = validationErrors();
        if (errs.length) {
          await reportErrors(errs);
          return;
        }
        const r = await prompt({ type: "submit", title: "Ready to submit", question: `Everything I could fill is in. Look the page over, then click Submit here and I'll press the site's button.`, el: submit });
        if (r.submit) {
          submit.click();
          state.submitted = true;
          setStatus("Submitting…");
          addLog("filled", submit, "Submit", "Clicked", "you");
          await sleep(3000);
          if (confirmationSeen()) return finish("Submitted ✓", true);
          const e2 = validationErrors();
          if (e2.length) { state.submitted = false; await reportErrors(e2); return; }
          // Give the site a few seconds to show a confirmation.
          await sleep(5000);
          if (state.mode !== "running") return;
          return finish(confirmationSeen() ? "Submitted ✓" : "Submitted — I couldn't see a confirmation page, so double-check.", true);
        }
        return;
      }

      if (next) {
        if (!state.settings.autoAdvance) { setStatus("Page filled. Click “Next page” when you're ready."); return; }
        if (state.nextAttempts >= 3) {
          await prompt({ type: "info", title: "Stuck on this page", question: "I clicked Next a few times but the page didn't move on. Something probably needs your eye — fix it, then press Continue.", el: next });
          state.nextAttempts = 0;
          return;
        }
        state.nextAttempts++;
        setStatus(`Clicking “${next.innerText.trim() || "Next"}”…`);
        next.click();
        addLog("filled", next, "Button", `Clicked “${next.innerText.trim() || "Next"}”`, "auto");
        await sleep(2000);
        const errs = validationErrors();
        if (errs.length && pageKey() === state.pageKey) {
          for (const el of invalidFields()) { state.seen.delete(el); state.filled.delete(el); }
          await reportErrors(errs);
        }
        state.queued = true;
        return;
      }

      setStatus(hadFields ? "Page filled. Waiting for the site…" : "Nothing to fill here yet. Watching the page…");
    } catch (err) {
      setStatus("Hit a snag: " + (err?.message || err));
    } finally {
      state.busy = false;
      if (state.queued) { state.queued = false; setTimeout(step, 400); }
    }
  }

  async function reportErrors(errs) {
    const r = await prompt({ type: "info", title: "The form flagged something", question: errs.join(" · "), okLabel: "I fixed it — continue", el: invalidFields()[0] || null });
    if (!r.manual) state.queued = true;
  }

  function finish(message, submitted) {
    setMode("done");
    if (submitted && state.job?.id) send({ type: "RESULT", jobId: state.job.id, status: "submitted" });
    showCard("done", { title: message, question: submitted ? "This tab is yours again. The dashboard has been told." : "" });
    setDim(false);
    send({ type: "STOP" });
  }

  // ---------------------------------------------------------------- overlay
  let ui = null;
  let promptResolve = null;

  function addLog(kind, el, label, value, source) {
    state.stats[kind] = (state.stats[kind] || 0) + 1;
    const entry = { id: state.log.length + 1, kind, label: humanLabel(label), value, el, source };
    state.log.push(entry);
    if (!IS_TOP) {
      try { window.top.postMessage({ type: "AUTOPILOT_FRAME_LOG", kind, label: entry.label, value }, "*"); } catch { /* ignore */ }
      return;
    }
    renderLog();
  }

  function setStatus(text) {
    if (ui) ui.status.textContent = text;
  }

  function setDim(on) {
    if (!ui) return;
    ui.dim.classList.toggle("off", !on);
    ui.root.querySelector(".panel").classList.toggle("corner", !on);
  }

  function buildOverlay() {
    if (!IS_TOP || ui) return;
    const host = document.createElement("div");
    host.id = "autopilot-host";
    host.style.cssText = "all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none;";
    const root = host.attachShadow({ mode: "open" });
    root.innerHTML = `
      <style>
        :host { all: initial; }
        * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, Helvetica, Arial, sans-serif; }
        .dim { position: fixed; inset: 0; background: rgba(246,246,243,.72); backdrop-filter: blur(1.5px); pointer-events: auto; transition: opacity .25s; }
        .dim.off { opacity: 0; pointer-events: none; }
        .panel { position: fixed; left: 50%; top: 50%; transform: translate(-50%,-50%); width: 460px; max-width: calc(100vw - 32px); max-height: 86vh; display: flex; flex-direction: column; background: #fff; color: #141414; border: 1px solid #e5e3dd; border-radius: 18px; box-shadow: 0 20px 60px rgba(0,0,0,.18); overflow: hidden; font-size: 13px; pointer-events: auto; transition: all .25s; }
        .panel.corner { left: auto; top: auto; right: 16px; bottom: 16px; transform: none; width: 380px; max-height: 70vh; }
        .panel.min .status, .panel.min .stats, .panel.min .body, .panel.min .log, .panel.min .foot { display: none; }
        .head { display: flex; align-items: center; gap: 8px; padding: 12px 14px; border-bottom: 1px solid #efede8; background: #f6f6f3; }
        .dot { width: 9px; height: 9px; border-radius: 50%; background: #2fb55a; flex-shrink: 0; }
        .dot.paused { background: #e0a400; } .dot.stopped, .dot.done { background: #bbb; } .dot.prompt { background: #141414; }
        .spin { width: 14px; height: 14px; border: 2px solid #ddd; border-top-color: #141414; border-radius: 50%; animation: spin .8s linear infinite; flex-shrink: 0; }
        @keyframes spin { to { transform: rotate(360deg); } }
        .title { font-weight: 600; flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: 14px; }
        .title small { font-weight: 400; color: #8a8985; margin-left: 6px; }
        .icon { background: transparent; border: 0; cursor: pointer; color: #8a8985; font-size: 14px; padding: 2px 7px; border-radius: 6px; }
        .icon:hover { background: #e9e7e1; color: #141414; }
        .status { padding: 10px 14px; color: #4a4a48; border-bottom: 1px solid #efede8; min-height: 36px; }
        .stats { display: flex; gap: 12px; padding: 7px 14px; color: #8a8985; font-size: 12px; border-bottom: 1px solid #efede8; }
        .stats b { color: #141414; }
        .body { padding: 14px; display: none; border-bottom: 1px solid #efede8; max-height: 52vh; overflow-y: auto; }
        .body.show { display: block; }
        .body h3 { margin: 0 0 6px; font-size: 15px; letter-spacing: -.01em; }
        .body p { margin: 0 0 10px; color: #4a4a48; line-height: 1.45; }
        .body .q { color: #141414; font-weight: 500; background: #f6f6f3; border-radius: 10px; padding: 10px 12px; margin-bottom: 12px; line-height: 1.4; }
        .opts { display: flex; flex-direction: column; gap: 6px; margin-bottom: 10px; max-height: 240px; overflow-y: auto; }
        .opt { text-align: left; background: #fff; border: 1px solid #e5e3dd; border-radius: 10px; padding: 9px 12px; cursor: pointer; font-size: 13px; color: #141414; }
        .opt:hover { border-color: #141414; background: #faf9f6; }
        .inp { width: 100%; border: 1px solid #e5e3dd; border-radius: 10px; padding: 9px 11px; font-size: 13px; outline: none; margin-bottom: 8px; background: #fff; color: #141414; }
        .inp:focus { border-color: #141414; }
        textarea.inp { min-height: 90px; resize: vertical; }
        .row { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
        .btn { border: 1px solid #cfcdc6; background: #fff; color: #141414; border-radius: 999px; padding: 7px 13px; font-size: 12.5px; font-weight: 500; cursor: pointer; }
        .btn:hover { background: #f0efeb; }
        .btn.primary { background: #141414; color: #fff; border-color: #141414; } .btn.primary:hover { background: #2b2b2b; }
        .btn.link { border: 0; color: #8a8985; padding-left: 4px; padding-right: 4px; } .btn.link:hover { background: transparent; color: #141414; }
        .btn:disabled { opacity: .45; cursor: not-allowed; }
        label.chk { display: flex; align-items: center; gap: 6px; font-size: 12px; color: #4a4a48; cursor: pointer; margin: 4px 0 10px; }
        .hint { font-size: 11.5px; color: #8a8985; margin-top: 8px; }
        .bq-list { max-height: 44vh; overflow-y: auto; display: flex; flex-direction: column; gap: 10px; margin-bottom: 10px; }
        .bq-q { font-weight: 500; margin-bottom: 4px; line-height: 1.35; }
        .bq .inp { margin-bottom: 0; }
        .log { overflow-y: auto; max-height: 180px; }
        .lrow { display: flex; align-items: flex-start; gap: 8px; padding: 6px 14px; border-bottom: 1px solid #f3f2ee; cursor: pointer; }
        .lrow:hover { background: #faf9f6; }
        .k { width: 16px; flex-shrink: 0; text-align: center; }
        .lab { color: #8a8985; font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .val { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .val.left { color: #b45309; }
        .src { font-size: 10px; color: #8a8985; border: 1px solid #e5e3dd; border-radius: 4px; padding: 0 4px; margin-left: 4px; }
        .txt { flex: 1; min-width: 0; }
        .edit { background: transparent; border: 1px solid #e5e3dd; border-radius: 999px; padding: 2px 8px; font-size: 11px; cursor: pointer; color: #4a4a48; flex-shrink: 0; }
        .edit:hover { border-color: #141414; color: #141414; }
        .foot { display: flex; gap: 6px; padding: 10px 14px; border-top: 1px solid #efede8; background: #fff; flex-wrap: wrap; align-items: center; }
        .empty { padding: 14px; color: #8a8985; text-align: center; font-size: 12px; }
      </style>
      <div class="dim"></div>
      <div class="panel">
        <div class="head">
          <span class="dot"></span><span class="spin"></span>
          <span class="title">Autopilot is running <small></small></span>
          <button class="icon" data-act="min" title="Minimize">—</button>
        </div>
        <div class="status">Starting…</div>
        <div class="stats"><span>✓ <b class="s-filled">0</b> filled</span><span>⏭ <b class="s-skipped">0</b> skipped</span><span>✋ <b class="s-left">0</b> for you</span></div>
        <div class="body"></div>
        <div class="log"><div class="empty">Looking for fields…</div></div>
        <div class="foot">
          <button class="btn primary" data-act="pause">Pause</button>
          <button class="btn" data-act="fill">Fill again</button>
          <button class="btn" data-act="next">Next page →</button>
          <button class="btn" data-act="stop">Stop</button>
        </div>
      </div>`;
    document.documentElement.appendChild(host);
    ui = {
      host, root,
      dim: root.querySelector(".dim"),
      panel: root.querySelector(".panel"),
      dot: root.querySelector(".dot"),
      spin: root.querySelector(".spin"),
      titleEl: root.querySelector(".title"),
      title: root.querySelector(".title small"),
      status: root.querySelector(".status"),
      body: root.querySelector(".body"),
      log: root.querySelector(".log"),
      pause: root.querySelector("[data-act=pause]"),
      sFilled: root.querySelector(".s-filled"),
      sSkipped: root.querySelector(".s-skipped"),
      sLeft: root.querySelector(".s-left"),
    };
    ui.title.textContent = state.job?.company ? `· ${state.job.company}` : `· ${state.ats}`;
    root.addEventListener("click", onOverlayClick);
    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && state.mode === "running") togglePause();
    }, true);
  }

  function setMode(mode) {
    state.mode = mode;
    if (!ui) return;
    ui.dot.className = "dot " + (mode === "paused" || mode === "manual" ? "paused" : mode === "prompt" ? "prompt" : mode === "done" ? "done" : mode === "stopped" ? "stopped" : "");
    ui.spin.style.display = mode === "running" ? "" : "none";
    ui.titleEl.firstChild.textContent = { running: "Autopilot is running ", paused: "Paused ", manual: "Your turn ", prompt: "Autopilot needs you ", done: "Done ", stopped: "Stopped " }[mode] || "Autopilot ";
    ui.pause.textContent = mode === "paused" || mode === "manual" ? "Resume" : "Pause";
    ui.pause.disabled = mode === "done" || mode === "stopped";
    setDim(mode === "running" || mode === "prompt");
  }

  function togglePause() {
    if (state.mode === "running") { setMode("paused"); setStatus("Paused — the page is yours. Press Resume when you want me back."); }
    else if (state.mode === "paused" || state.mode === "manual") { if (promptResolve) resolvePrompt({ manualDone: true }); setMode("running"); setStatus("Resuming…"); step(); }
  }

  function showCard(type, spec) {
    if (!ui) return;
    const b = ui.body;
    b.classList.add("show");
    const q = spec.question ? `<div class="q">${esc(spec.question)}</div>` : "";
    let inner = "";
    switch (type) {
      case "choice": {
        const opts = (spec.options || []).slice(0, 40).map((o) => `<button class="opt" data-pick="${esc(o)}">${esc(o)}</button>`).join("");
        inner = `<h3>${esc(spec.title)}</h3>${q}<div class="opts">${opts}</div>
          <input class="inp" data-field="custom" placeholder="Or type something else…" />
          ${spec.allowRemember ? `<label class="chk"><input type="checkbox" data-field="remember" checked> Remember this answer for other applications</label>` : ""}
          <div class="row"><button class="btn primary" data-act="use">Use typed answer</button><button class="btn" data-act="manual">I'll do it on the page</button><button class="btn link" data-act="skip">Skip</button></div>
          ${spec.hint ? `<div class="hint">${esc(spec.hint)}</div>` : ""}`;
        break;
      }
      case "text":
        inner = `<h3>${esc(spec.title)}</h3>${q}<textarea class="inp" data-field="custom" placeholder="Type the answer…"></textarea>
          ${spec.allowRemember ? `<label class="chk"><input type="checkbox" data-field="remember" checked> Remember this answer for other applications</label>` : ""}
          <div class="row"><button class="btn primary" data-act="use">Use this</button><button class="btn" data-act="manual">I'll do it on the page</button><button class="btn link" data-act="skip">Skip</button></div>`;
        break;
      case "creds":
        inner = `<h3>${esc(spec.title)}</h3><p>${esc(spec.question)}</p>
          <input class="inp" data-field="email" placeholder="Email" value="${esc(spec.email || "")}" />
          <input class="inp" data-field="password" type="password" placeholder="Password" value="${esc(spec.password || "")}" />
          <label class="chk"><input type="checkbox" data-field="remember" ${spec.remember ? "checked" : ""}> Remember this password on this computer (stored unencrypted in the extension)</label>
          <div class="row"><button class="btn primary" data-act="creds">Continue</button><button class="btn" data-act="switch">${esc(spec.switchLabel || "Switch")}</button><button class="btn link" data-act="manual">I'll sign in myself</button></div>
          <div class="hint">Many Workday sites make you pick a new password per company. If you reuse one, tick Remember and I'll stop asking.</div>`;
        break;
      case "submit":
        inner = `<h3>${esc(spec.title)}</h3><p>${esc(spec.question)}</p>
          <div class="row"><button class="btn primary" data-act="submit">Submit application</button><button class="btn" data-act="review">Let me review first</button></div>`;
        break;
      case "batch": {
        const rows = spec.items.map((it, i) => {
          const control = it.options && it.options.length
            ? `<select class="inp" data-i="${i}"><option value="">— skip —</option>${it.options.slice(0, 60).map((o) => `<option>${esc(o)}</option>`).join("")}</select>`
            : `<textarea class="inp" data-i="${i}" rows="2" placeholder="Leave blank to skip"></textarea>`;
          return `<div class="bq"><div class="bq-q">${i + 1}. ${esc(it.question)}</div>${control}</div>`;
        }).join("");
        inner = `<h3>${esc(spec.title)}</h3><p>Answer what you can, then Apply. Anything left blank is skipped.</p><div class="bq-list">${rows}</div>
          <label class="chk"><input type="checkbox" data-field="remember" checked> Remember these answers for other applications</label>
          <div class="row"><button class="btn primary" data-act="batch">Apply answers</button><button class="btn" data-act="manual">I'll do them on the page</button></div>`;
        break;
      }
      case "info":
        inner = `<h3>${esc(spec.title)}</h3><p>${esc(spec.question)}</p>
          <div class="row"><button class="btn primary" data-act="ok">${esc(spec.okLabel || "Continue")}</button><button class="btn" data-act="manual">I'll handle it</button></div>`;
        break;
      case "done":
        inner = `<h3>${esc(spec.title)}</h3><p>${esc(spec.question || "")}</p><div class="row"><button class="btn" data-act="close">Close</button></div>`;
        break;
    }
    b.innerHTML = inner;
    const first = b.querySelector("input:not([type=checkbox]), textarea");
    if (first && type !== "creds") first.focus();
    if (type === "creds") b.querySelector("[data-field=password]")?.focus();
  }

  function hideCard() {
    if (!ui) return;
    ui.body.classList.remove("show");
    ui.body.innerHTML = "";
  }

  function prompt(spec) {
    if (!IS_TOP) return Promise.resolve({ skip: true });
    return new Promise((resolve) => {
      promptResolve = resolve;
      setMode("prompt");
      if (spec.el) highlight(spec.el);
      setStatus(spec.title);
      showCard(spec.type, spec);
      state.currentPrompt = spec;
    });
  }

  function resolvePrompt(result) {
    const r = promptResolve;
    promptResolve = null;
    hideCard();
    if (state.mode === "prompt") setMode("running");
    if (r) r(result);
  }

  function onOverlayClick(e) {
    const pick = e.target.closest("[data-pick]");
    if (pick && promptResolve) {
      e.stopPropagation();
      const remember = ui.body.querySelector("[data-field=remember]")?.checked;
      return resolvePrompt({ answer: pick.dataset.pick, remember });
    }
    const actEl = e.target.closest("[data-act]");
    if (!actEl) {
      const row = e.target.closest(".lrow");
      if (row) {
        const entry = state.log.find((l) => String(l.id) === row.dataset.id);
        if (entry?.el?.isConnected) highlight(entry.el);
      }
      return;
    }
    e.stopPropagation();
    const act = actEl.dataset.act;
    const field = (n) => ui.body.querySelector(`[data-field=${n}]`);
    switch (act) {
      case "min":
        ui.panel.classList.toggle("min");
        actEl.textContent = ui.panel.classList.contains("min") ? "+" : "—";
        break;
      case "pause":
        togglePause();
        break;
      case "fill":
        if (state.mode === "paused" || state.mode === "manual") { if (promptResolve) resolvePrompt({ manualDone: true }); setMode("running"); }
        state.counters = {};
        step();
        break;
      case "next": {
        const n = findNextButton();
        if (n) { n.click(); setStatus("Clicked next."); setTimeout(step, 1500); } else setStatus("Couldn't find a Next / Continue button on this page.");
        break;
      }
      case "stop":
        if (promptResolve) resolvePrompt({ skip: true });
        setMode("stopped");
        setStatus("Stopped. The page is yours — nothing more will be touched.");
        send({ type: "STOP" });
        break;
      case "use": {
        const v = field("custom")?.value?.trim();
        if (!v) { field("custom")?.focus(); return; }
        resolvePrompt({ answer: v, remember: field("remember")?.checked });
        break;
      }
      case "skip":
        resolvePrompt({ skip: true });
        break;
      case "manual": {
        // Hand the page over; resume via Resume / Fill again.
        const spec = state.currentPrompt;
        const r = promptResolve;
        promptResolve = null;
        hideCard();
        setMode("manual");
        setStatus("Your turn — fill it on the page, then press Resume.");
        if (spec?.el) highlight(spec.el);
        if (r) r({ manual: true });
        break;
      }
      case "creds":
        resolvePrompt({ email: field("email")?.value?.trim(), password: field("password")?.value || "", remember: field("remember")?.checked });
        break;
      case "switch":
        resolvePrompt({ switch: true });
        break;
      case "submit":
        resolvePrompt({ submit: true });
        break;
      case "batch": {
        const remember = field("remember")?.checked;
        const values = Array.from(ui.body.querySelectorAll("[data-i]")).map((c) => ({ answer: (c.value || "").trim(), remember }));
        resolvePrompt({ values });
        break;
      }
      case "review":
        resolvePrompt({ submit: false });
        setMode("manual");
        setStatus("Review away. Press Resume and I'll ask about Submit again.");
        break;
      case "ok":
        resolvePrompt({ ok: true });
        break;
      case "close":
        ui.host.remove();
        ui = null;
        break;
      case "edit": {
        const row = e.target.closest(".lrow");
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
    const isCustom = el.tagName === "BUTTON" || el.getAttribute("role") === "combobox";
    const options = el.tagName === "SELECT" ? Array.from(el.options).map((o) => o.text.trim()).filter(Boolean) : el.type === "radio" ? Array.from(document.querySelectorAll(`input[type=radio][name="${CSS.escape(el.name || "")}"]`)).map(radioText) : isCustom ? await readCustomOptions(el) : null;
    const wasRunning = state.mode === "running";
    const resp = await prompt({ type: options ? "choice" : "text", title: `Change “${entry.label}”`, question: entry.kind === "filled" ? `Currently: ${entry.value}` : "", options, el, allowRemember: true });
    if (resp.answer) {
      const radios = el.type === "radio" ? Array.from(document.querySelectorAll(`input[type=radio][name="${CSS.escape(el.name || "")}"]`)) : null;
      if (!radios && el.tagName !== "SELECT" && !isCustom) setNativeValue(el, "");
      const ok = await applyAnswer(el, resp.answer, { isCustom, radios });
      entry.kind = ok ? "filled" : "left";
      entry.value = ok ? resp.answer : `Couldn't set “${resp.answer}”`;
      entry.source = "you";
      if (resp.remember) { const key = answerKey(entry.label); state.answers[key] = resp.answer; send({ type: "SAVE_ANSWER", key, answer: resp.answer }); }
      renderLog();
    }
    if (!wasRunning && !resp.manual) setMode("paused");
  }

  function renderLog() {
    if (!ui) return;
    ui.sFilled.textContent = state.stats.filled || 0;
    ui.sSkipped.textContent = state.stats.skipped || 0;
    ui.sLeft.textContent = state.stats.left || 0;
    const icons = { filled: "✓", skipped: "⏭", left: "✋" };
    const shown = state.log.filter((l) => l.kind !== "skipped" || !/Nothing to put here/.test(l.value)).slice(-100);
    if (shown.length === 0) { ui.log.innerHTML = `<div class="empty">No fillable fields on this page yet.</div>`; return; }
    ui.log.innerHTML = shown.map((l) => `<div class="lrow" data-id="${l.id}">
        <span class="k">${icons[l.kind] || "•"}</span>
        <div class="txt"><div class="lab">${esc(l.label)}${l.source && l.source !== "profile" && l.source !== "auto" ? `<span class="src">${esc(l.source)}</span>` : ""}</div><div class="val ${l.kind}">${esc(String(l.value ?? ""))}</div></div>
        ${l.el && l.kind !== "skipped" && l.el.type !== "file" && l.el.tagName !== "BUTTON" && l.el.tagName !== "A" ? `<button class="edit" data-act="edit">edit</button>` : ""}
      </div>`).join("");
    ui.log.scrollTop = ui.log.scrollHeight;
  }

  // ---------------------------------------------------------------- lifecycle
  let observer = null;
  let debounce = null;

  function watch() {
    if (observer) return;
    observer = new MutationObserver((muts) => {
      if (state.mode !== "running") return;
      if (muts.every((m) => m.target.closest?.("#autopilot-host"))) return;
      clearTimeout(debounce);
      debounce = setTimeout(step, 900);
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    let lastUrl = location.href;
    setInterval(() => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        if (state.mode === "running") { clearTimeout(debounce); debounce = setTimeout(step, 1000); }
      }
    }, 500);
  }

  async function start(info) {
    state.job = info.job;
    state.profile = info.profile;
    state.resume = info.resume;
    state.settings = { ...state.settings, ...(info.settings || {}) };
    state.creds = info.creds || null;
    state.answers = info.answers || {};
    buildOverlay();
    if (!state.profile) {
      setMode("stopped");
      setStatus("No profile found. Open your Autopilot dashboard, upload your resume, then click the extension icon here again.");
      return;
    }
    if (state.profile && !state.profile.eeo) state.profile.eeo = {};
    ensureWorkday();
    setMode("running");
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
    await sleep(700);
    step();
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
