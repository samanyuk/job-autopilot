// Workday adapter. Handles every page of a Workday application by Workday's
// own data-automation-ids: account creation / sign-in, My Information,
// My Experience (work, education, languages, skills, websites, resume),
// Application Questions (dates), Voluntary Disclosures, Self Identify.
// content.js installs it with a toolkit of shared DOM helpers and calls
// handleAuth() then run() on every step; whatever this adapter doesn't fill,
// the generic engine in content.js picks up afterwards.

(function () {
  const AID = (id) => `[data-automation-id="${id}"]`;
  const HOST = location.hostname;

  function install(T) {
    const { sleep, norm, textOf, isVisible, setNativeValue, addLog, highlight, setStatus, fmtMonthYear, markSeen, today, eeoPick, stateNames, send, prompt, validationErrors } = T;

    // ------------------------------------------------------------ typing
    // Workday's inputs are React-controlled and its date boxes only accept real
    // keystrokes, so type through execCommand (fires beforeinput/input like a
    // keyboard does) and fall back to the native setter.
    async function typeReal(el, text) {
      text = String(text ?? "");
      el.scrollIntoView?.({ block: "center" });
      el.focus();
      el.click?.();
      await sleep(40);
      try { el.select?.(); } catch { /* ignore */ }
      if (el.value) {
        try { el.setSelectionRange?.(0, el.value.length); } catch { /* ignore */ }
        document.execCommand("delete");
      }
      let ok = false;
      try { ok = document.execCommand("insertText", false, text); } catch { ok = false; }
      await sleep(30);
      if (!ok || norm(el.value) !== norm(text)) {
        setNativeValue(el, text);
        await sleep(30);
      }
      el.dispatchEvent(new Event("change", { bubbles: true }));
      el.dispatchEvent(new FocusEvent("blur", { bubbles: true }));
      await sleep(60);
      return norm(el.value) === norm(text) || el.value.length > 0;
    }

    const digitsMatch = (el, digits) => {
      const v = (el.value || "").replace(/\D/g, "");
      return v === digits || v === digits.replace(/^0+/, "") || (digits.length === 4 && v.endsWith(digits));
    };

    async function typeDigits(el, digits) {
      // Spinbutton date parts: type digit by digit; verify after blur, and if the
      // widget threw the value away, fall back to real keystrokes via the debugger.
      el.scrollIntoView?.({ block: "center" });
      el.focus();
      el.click?.();
      await sleep(40);
      if (el.value) {
        try { el.setSelectionRange?.(0, el.value.length); } catch { /* ignore */ }
        document.execCommand("delete");
        for (let i = 0; i < 4 && el.value; i++) document.execCommand("delete");
        if (el.value) setNativeValue(el, "");
      }
      for (const ch of digits) {
        let ok = false;
        try { ok = document.execCommand("insertText", false, ch); } catch { ok = false; }
        if (!ok) setNativeValue(el, (el.value || "") + ch);
        await sleep(25);
      }
      el.dispatchEvent(new Event("change", { bubbles: true }));
      el.blur();
      el.dispatchEvent(new FocusEvent("blur", { bubbles: true }));
      await sleep(120);
      if (digitsMatch(el, digits)) return true;
      // Real keystrokes.
      el.focus();
      el.click?.();
      await sleep(40);
      const res = await send({ type: "TYPE_KEYS", text: digits, backspaces: (el.value || "").length });
      await sleep(120);
      el.blur();
      await sleep(80);
      if (!res?.ok) addLog("left", el, "Typing", `Keyboard fallback unavailable: ${res?.error || "no response"}`, "auto");
      return digitsMatch(el, digits) || (el.value || "").length > 0;
    }

    // Fill a date group (month / day / year spinbuttons) inside a container.
    async function setDateGroup(container, raw) {
      const d = fmtMonthYear(raw);
      if (!d || !container) return false;
      const month = container.querySelector(`${AID("dateSectionMonth-input")}, [data-automation-id$="dateSectionMonth-input"], input[aria-label*="Month" i]`);
      const day = container.querySelector(`${AID("dateSectionDay-input")}, [data-automation-id$="dateSectionDay-input"], input[aria-label*="Day" i]`);
      const year = container.querySelector(`${AID("dateSectionYear-input")}, [data-automation-id$="dateSectionYear-input"], input[aria-label*="Year" i]`);
      let ok = false;
      if (month && isVisible(month)) { markSeen(month); ok = (await typeDigits(month, d.month)) || ok; }
      if (day && isVisible(day)) { markSeen(day); await typeDigits(day, d.day || "01"); }
      if (year && isVisible(year)) { markSeen(year); ok = (await typeDigits(year, d.year)) || ok; }
      return ok;
    }

    function dateGroupIn(panel, fieldPrefix) {
      return panel.querySelector(`${AID(`formField-${fieldPrefix}`)}, [data-automation-id*="${fieldPrefix}"]`);
    }

    // ------------------------------------------------------------ prompts / listboxes
    function openOptions() {
      return Array.from(document.querySelectorAll(`${AID("promptOption")}, ${AID("promptLeafNode")}, [role=option], ul[role=listbox] li, [data-automation-id="menuItem"]`)).filter((o) => isVisible(o) && textOf(o));
    }

    function closeOptions() {
      document.body.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape", code: "Escape" }));
    }

    function best(opts, wanted, alt) {
      const w = norm(wanted), a = norm(alt);
      const texts = opts.map(textOf);
      let i = w ? texts.findIndex((t) => t === w) : -1;
      if (i < 0 && a) i = texts.findIndex((t) => t === a);
      if (i < 0 && w) i = texts.findIndex((t) => t.startsWith(w + " ") || t.startsWith(w + ",") || t.startsWith(w + "("));
      if (i < 0 && w && w.length > 2) i = texts.findIndex((t) => t.includes(w));
      if (i < 0 && a && a.length > 2) i = texts.findIndex((t) => t.includes(a));
      return i >= 0 ? opts[i] : null;
    }

    function listboxValue(btn) {
      const t = textOf(btn);
      return /select one|^select$|^$/.test(t) ? "" : t;
    }

    async function pickListbox(btn, wanted, alt, { last = false, first = false } = {}) {
      if (!btn || !isVisible(btn)) return false;
      markSeen(btn);
      if (listboxValue(btn) && norm(listboxValue(btn)) === norm(wanted)) return true;
      btn.scrollIntoView({ block: "center" });
      btn.click();
      await sleep(350);
      let opts = openOptions();
      if (opts.length === 0) { await sleep(400); opts = openOptions(); }
      if (opts.length === 0) return false;
      let opt = best(opts, wanted, alt);
      if (!opt && last) opt = opts[opts.length - 1];
      if (!opt && first) opt = opts[0];
      if (!opt) { closeOptions(); return false; }
      opt.scrollIntoView({ block: "nearest" });
      opt.click();
      await sleep(250);
      return true;
    }

    async function listboxOptions(btn) {
      btn.click();
      await sleep(350);
      const opts = openOptions().map(textOf);
      closeOptions();
      await sleep(120);
      return opts;
    }

    // Searchable prompt (school, field of study, skills, source). Types, presses
    // Enter, picks the best suggestion; walks one level of categories if needed.
    async function pickSearch(input, text, { fallbacks = [], categoryHint = null, acceptTyped = true } = {}) {
      if (!input || !isVisible(input)) return false;
      markSeen(input);
      const tries = [text, ...fallbacks].filter(Boolean);
      for (const t of tries) {
        input.scrollIntoView({ block: "center" });
        await typeReal(input, t);
        input.focus();
        input.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Enter", code: "Enter", keyCode: 13, which: 13 }));
        input.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key: "Enter", code: "Enter", keyCode: 13, which: 13 }));
        await sleep(900);
        let opts = openOptions();
        if (opts.length === 0) { await sleep(800); opts = openOptions(); }
        if (opts.length > 0) {
          const leaf = opts.filter((o) => o.getAttribute("data-automation-id") !== "promptOption" || !/›|>$/.test(textOf(o)));
          const pool = leaf.length ? leaf : opts;
          const w = norm(t);
          const pick = pool.find((o) => textOf(o) === w) || pool.find((o) => textOf(o).includes(w)) || pool.find((o) => w.includes(textOf(o)) && textOf(o).length > 3) || (pool.length === 1 ? pool[0] : null);
          if (pick) { pick.click(); await sleep(350); return true; }
        }
      }
      // Nothing matched by search: browse the tree.
      await typeReal(input, "");
      input.focus();
      input.click();
      await sleep(600);
      let opts = openOptions();
      if (opts.length) {
        const cats = opts.filter((o) => o.getAttribute("data-automation-id") === "promptOption" || /›|>$/.test(textOf(o)));
        const cat = (categoryHint && best(cats, categoryHint)) || best(cats, "Job Board", "Online") || best(cats, "Other") || cats[0];
        if (cat && cats.length === opts.length) {
          cat.click();
          await sleep(700);
          opts = openOptions();
        }
        const leafPick = tries.map((t) => best(opts, t)).find(Boolean) || best(opts, "Other") || best(opts, "Job Board", "LinkedIn") || opts[0];
        if (leafPick) { leafPick.click(); await sleep(350); return true; }
      }
      closeOptions();
      if (acceptTyped) {
        // Free-text fallback: leave the first choice typed in.
        await typeReal(input, tries[0]);
        return input.value.length > 0;
      }
      return false;
    }

    function hasSelected(container) {
      return !!container?.querySelector(`${AID("selectedItem")}, [data-automation-id*="selectedItem"], [data-automation-id="pill"], .pill, [role=listitem]`);
    }

    // ------------------------------------------------------------ page detection
    const section = (id) => Array.from(document.querySelectorAll(AID(id))).find(isVisible) || null;
    const q = (sel) => Array.from(document.querySelectorAll(sel)).filter(isVisible);
    const first = (sel) => q(sel)[0] || null;

    function activeStep() {
      return textOf(first(`${AID("progressBarActiveStep")}, [data-automation-id="progressBar"] [aria-current="step"], [data-automation-id="progressBar"] [aria-current="true"], h2[data-automation-id="pageHeaderTitle"], h1`));
    }

    function pageType() {
      if (first(`${AID("createAccountSubmitButton")}, ${AID("verifyPassword")}`)) return "createAccount";
      if (first(AID("signInSubmitButton")) || (first(AID("password")) && !first(AID("verifyPassword")))) return "signIn";
      if (first(`${AID("autofillWithResume")}, ${AID("applyManually")}`)) return "applyOptions";
      if (section("workExperienceSection") || section("educationSection") || section("skillsSection") || section("languageSection")) return "experience";
      if (first(`${AID("legalNameSection_firstName")}, ${AID("addressSection_addressLine1")}, ${AID("phone-number")}`)) return "information";
      if (first(`${AID("disabilityYes")}, ${AID("disabilityNo")}, ${AID("disabilityDecline")}`)) return "selfIdentify";
      if (first(`${AID("gender")}, ${AID("ethnicityDropdown")}, ${AID("veteranStatus")}`)) return "disclosures";
      const step = activeStep();
      if (/review/.test(step)) return "review";
      if (/question/.test(step)) return "questions";
      if (/self[- ]?identif/.test(step)) return "selfIdentify";
      if (/disclos/.test(step)) return "disclosures";
      if (/information/.test(step)) return "information";
      if (/experience/.test(step)) return "experience";
      if (first(AID("bottom-navigation-next-button"))) return "generic";
      return null;
    }

    // ------------------------------------------------------------ auth
    let accounts = null;
    async function loadAccounts() {
      if (accounts) return accounts;
      const res = await send({ type: "GET_ACCOUNTS" });
      accounts = res?.accounts || {};
      return accounts;
    }

    function generatePassword() {
      const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ", lower = "abcdefghijkmnopqrstuvwxyz", digits = "23456789", sym = "!@#$%&*";
      const pick = (s) => s[Math.floor(Math.random() * s.length)];
      let p = pick(upper) + pick(sym) + pick(digits) + pick(digits);
      for (let i = 0; i < 8; i++) p += pick(i % 3 === 0 ? upper : lower);
      return p + pick(digits) + pick(sym);
    }

    let authState = { attempts: 0, flipped: false, gaveUp: false, lastPage: "" };

    async function handleAuth(ctx) {
      const type = pageType();
      if (type !== "createAccount" && type !== "signIn") { authState.lastPage = type; return false; }
      if (authState.gaveUp) return false;
      if (authState.attempts >= 3) {
        authState.gaveUp = true;
        await prompt({ type: "info", title: "Sign-in isn't working", question: "I tried a few times and Workday is still asking for a password. Sign in yourself and I'll continue once the form appears.", el: first(AID("password")) });
        return true;
      }
      const email = ctx.profile.email;
      const saved = await loadAccounts();
      const acct = saved[HOST];
      let password = acct?.password || ctx.settings.accountPassword || "";
      if (!password) {
        password = generatePassword();
        ctx.settings.accountPassword = password;
        await send({ type: "SAVE_SETTINGS", settings: { accountPassword: password } });
        addLog("filled", null, "Account password", "Generated and saved one for job sites (see Profile → Autopilot settings)", "auto");
      }

      // Prefer the sign-in form once this host has an account on record.
      if (type === "createAccount" && acct && !authState.flipped) {
        const link = first(AID("signInLink")) || q("a, button").find((b) => /^sign in$/i.test(textOf(b)));
        if (link) { authState.flipped = true; link.click(); await sleep(1200); return true; }
      }

      authState.attempts++;
      setStatus(type === "createAccount" ? "Creating your Workday account for this company…" : "Signing in to Workday…");
      const emailEl = first(`${AID("email")}, input[type=email], input[name*="email" i], input[id*="email" i], input[autocomplete="username"]`);
      const pwEl = first(`${AID("password")}, input[type=password]`);
      const verifyEl = first(AID("verifyPassword"));
      if (emailEl) await typeReal(emailEl, email);
      if (pwEl) await typeReal(pwEl, password);
      if (verifyEl) await typeReal(verifyEl, password);
      for (const cb of q("input[type=checkbox]")) {
        if (!cb.checked && (cb.matches(AID("createAccountCheckbox")) || /agree|terms|privacy|acknowledg|consent/i.test(textOf(cb.closest("label") || cb.parentElement)))) { (cb.closest("label") || cb).click(); await sleep(150); }
      }
      await sleep(200);
      const submit = first(`${AID("createAccountSubmitButton")}, ${AID("signInSubmitButton")}, ${AID("click_filter")} button, button[type=submit]`) || q("button").find((b) => /create account|sign in|log in|continue|next/i.test(textOf(b)));
      if (submit) submit.click();
      addLog("filled", emailEl || pwEl, type === "createAccount" ? "Workday account" : "Workday sign in", email, "auto");
      await sleep(2500);

      const errs = (validationErrors() || []).filter((e) => /already|exist|incorrect|invalid|not match|does not|unable|error|must|at least|required|weak/i.test(e));
      if (errs.length === 0) {
        // Left the auth page → remember the account for this tenant.
        if (pageType() !== "createAccount" && pageType() !== "signIn") {
          saved[HOST] = { email, password, at: Date.now() };
          await send({ type: "SAVE_ACCOUNT", host: HOST, account: saved[HOST] });
        }
        return true;
      }
      const already = errs.some((e) => /already|exist/i.test(e));
      const wrong = errs.some((e) => /incorrect|invalid|not match|does not/i.test(e));
      const weak = errs.some((e) => /must|at least|weak|character|uppercase|lowercase|special|number/i.test(e)) && type === "createAccount";
      if (weak && !acct) {
        // Site rejected the password policy: generate a stronger one once.
        const np = generatePassword() + "Aa1!";
        ctx.settings.accountPassword = np;
        await send({ type: "SAVE_SETTINGS", settings: { accountPassword: np } });
        addLog("left", pwEl, "Password", "Site rejected the saved password — generated a stronger one", "auto");
        return true;
      }
      if (already && !authState.flipped) {
        authState.flipped = true;
        const link = first(AID("signInLink")) || q("a, button").find((b) => /^sign in$/i.test(textOf(b)));
        if (link) { setStatus("Account exists — signing in instead…"); link.click(); await sleep(1200); authState.attempts = Math.max(0, authState.attempts - 1); return true; }
      }
      if (wrong && type === "signIn") {
        const r = await prompt({ type: "creds", title: "Workday password for this company", question: `${HOST} says the password is wrong. If you created this account before with a different password, enter it; otherwise use “Forgot password” on the page and I'll wait.`, email, password: "", remember: true, switchLabel: "Create a new account instead" });
        if (r.manual) { authState.gaveUp = true; return true; }
        if (r.switch) { const link = first(AID("createAccountLink")); if (link) { link.click(); await sleep(1200); } return true; }
        if (r.password) { saved[HOST] = { email: r.email || email, password: r.password, at: Date.now() }; accounts = saved; await send({ type: "SAVE_ACCOUNT", host: HOST, account: saved[HOST] }); authState.attempts = Math.max(0, authState.attempts - 1); }
        return true;
      }
      await prompt({ type: "info", title: "Workday sign-in problem", question: errs.join(" · "), okLabel: "Try again", el: pwEl });
      return true;
    }

    // ------------------------------------------------------------ My Information
    async function fillInformation(profile) {
      let any = false;
      const text = async (id, value, label) => {
        const el = first(AID(id));
        if (!el || !value) return false;
        markSeen(el);
        if (el.value && norm(el.value) === norm(value)) return true;
        if (el.value) return true;
        highlight(el);
        const ok = await typeReal(el, value);
        addLog(ok ? "filled" : "left", el, label, ok ? value : `Couldn't type “${value}”`, "profile");
        any = any || ok;
        return ok;
      };
      const lb = async (id, value, alt, label, opts) => {
        const el = first(AID(id));
        if (!el) return false;
        if (listboxValue(el)) { markSeen(el); return true; }
        highlight(el);
        const ok = await pickListbox(el, value, alt, opts);
        addLog(ok ? "filled" : "left", el, label, ok ? (listboxValue(el) || value) : `Couldn't pick “${value}”`, "profile");
        any = any || ok;
        return ok;
      };

      // Source / how did you hear
      const srcWrap = first(`${AID("formField-sourceSection")}, ${AID("sourceSection")}, [data-automation-id*="source" i]`);
      if (srcWrap && !hasSelected(srcWrap)) {
        const input = srcWrap.querySelector("input:not([type=hidden])");
        if (input && isVisible(input)) {
          highlight(input);
          const ok = await pickSearch(input, profile.howHeard || "Job Board", { fallbacks: ["LinkedIn", "Indeed", "Handshake", "Job Board", "Company Website", "Other"], categoryHint: "Job Board", acceptTyped: false });
          addLog(ok ? "filled" : "left", input, "How did you hear about us", ok ? (textOf(srcWrap.querySelector(`${AID("selectedItem")}, .pill`)) || profile.howHeard || "Job Board") : "Couldn't pick a source", "profile");
          any = any || ok;
        }
      }

      // Previous worker
      const prevWrap = first(`${AID("formField-candidateIsPreviousWorker")}, ${AID("candidateIsPreviousWorker")}, [data-automation-id*="previousWorker" i]`);
      if (prevWrap) {
        const radios = Array.from(prevWrap.querySelectorAll("input[type=radio]")).filter(isVisible);
        radios.forEach(markSeen);
        if (radios.length && !radios.some((r) => r.checked)) {
          const want = profile.previouslyEmployed === "yes" ? "yes" : "no";
          const target = radios.find((r) => norm(textOf(r.closest("label")) || r.id || r.value).startsWith(want)) || radios.find((r) => new RegExp(want, "i").test(r.id + " " + r.value + " " + (r.getAttribute("aria-label") || "")));
          if (target) { (target.closest("label") || target).click(); await sleep(150); addLog("filled", target, "Previously employed here", want === "yes" ? "Yes" : "No", "profile"); any = true; }
        }
      }

      await lb("countryDropdown", profile.country, profile.country === "United States" ? "United States of America" : profile.country, "Country");
      await text("legalNameSection_firstName", profile.firstName, "First name");
      await text("legalNameSection_lastName", profile.lastName, "Last name");
      await text("addressSection_addressLine1", profile.address1, "Address");
      await text("addressSection_city", profile.city, "City");
      if (profile.state) await lb("addressSection_countryRegion", stateNames[profile.state] || profile.state, profile.state, "State");
      await text("addressSection_postalCode", profile.zip, "Postal code");
      await lb("phone-device-type", "Mobile", "Cell", "Phone type", { first: true });
      await lb("country-phone-code", profile.country === "United States" ? "United States of America (+1)" : profile.country, "+1", "Country phone code");
      await text("phone-number", profile.phone, "Phone");
      await text("email", profile.email, "Email");
      return any;
    }

    // ------------------------------------------------------------ My Experience
    function panelsIn(sec) {
      const all = Array.from(sec.querySelectorAll("[data-automation-id]")).filter((n) => /-(\d+)$/.test(n.getAttribute("data-automation-id")) && !/dateSection|Proficiency|button/i.test(n.getAttribute("data-automation-id")) && n.querySelector("input, textarea, button"));
      return all.filter((n) => !all.some((m) => m !== n && m.contains(n)));
    }

    function addButton(sec) {
      return Array.from(sec.querySelectorAll(`${AID("Add")}, ${AID("Add Another")}, ${AID("add-button")}, button`)).find((b) => isVisible(b) && /^add( another)?$/i.test(textOf(b))) || null;
    }

    async function addEntry(sec) {
      const before = new Set(panelsIn(sec));
      const btn = addButton(sec);
      if (!btn) return null;
      btn.scrollIntoView({ block: "center" });
      btn.click();
      for (let i = 0; i < 16; i++) {
        await sleep(250);
        const now = panelsIn(sec).filter((p) => !before.has(p));
        if (now.length) return now[now.length - 1];
      }
      return null;
    }

    const field = (panel, id) => panel.querySelector(`${AID(id)}, ${AID(`formField-${id}`)} input:not([type=hidden]), ${AID(`formField-${id}`)} textarea, ${AID(`formField-${id}`)} button[aria-haspopup="listbox"]`);
    const filled = (el) => !!el && ((el.tagName === "BUTTON" && !!listboxValue(el)) || (typeof el.value === "string" && el.value.trim().length > 0));

    async function ptext(panel, id, value, label) {
      const el = field(panel, id);
      if (!el || !isVisible(el) || el.tagName === "BUTTON") return false;
      markSeen(el);
      if (filled(el) || !value) return filled(el);
      highlight(el);
      const ok = await typeReal(el, value);
      addLog(ok ? "filled" : "left", el, label, ok ? value : `Couldn't type “${value}”`, "profile");
      return ok;
    }

    async function fillExperience(profile) {
      const sec = section("workExperienceSection");
      if (!sec) return false;
      const items = (profile.experience || []).filter((e) => e.title).slice(0, 8);
      if (items.length === 0) return false;
      let changed = false;
      const used = new Set();
      for (let i = 0; i < items.length; i++) {
        const e = items[i];
        const existing = panelsIn(sec);
        let panel = existing.find((p) => !used.has(p) && norm(field(p, "jobTitle")?.value || "") === norm(e.title));
        if (!panel) panel = existing.find((p) => !used.has(p) && !filled(field(p, "jobTitle")));
        if (!panel) {
          setStatus(`Adding experience ${i + 1} of ${items.length}: ${e.title}…`);
          panel = await addEntry(sec);
        }
        if (!panel) { addLog("left", sec, "Work experience", `Couldn't add an entry for “${e.title}”`); break; }
        used.add(panel);
        panel.scrollIntoView({ block: "center" });
        await ptext(panel, "jobTitle", e.title, "Job title");
        await ptext(panel, "company", e.company || "Independent", "Company");
        await ptext(panel, "location", e.location || [profile.city, profile.state].filter(Boolean).join(", "), "Location");
        const cur = field(panel, "currentlyWorkHere");
        if (cur && isVisible(cur)) {
          markSeen(cur);
          if (!!e.current !== cur.checked) { (cur.closest("label") || cur).click(); await sleep(300); }
          if (e.current) addLog("filled", cur, "I currently work here", "Checked", "profile");
        }
        const start = e.startDate || e.endDate || "";
        const sg = dateGroupIn(panel, "startDate");
        if (sg && !Array.from(sg.querySelectorAll("input")).every((inp) => inp.value)) {
          const ok = await setDateGroup(sg, start);
          addLog(ok ? "filled" : "left", sg.querySelector("input") || panel, "Start date", ok ? start : `Couldn't type “${start}” — add a start date in your profile`, "profile");
        }
        const eg = dateGroupIn(panel, "endDate");
        if (!e.current && e.endDate && eg && isVisible(eg) && !Array.from(eg.querySelectorAll("input")).every((inp) => inp.value)) {
          const ok = await setDateGroup(eg, e.endDate);
          addLog(ok ? "filled" : "left", eg.querySelector("input") || panel, "End date", ok ? e.endDate : `Couldn't type “${e.endDate}”`, "profile");
        }
        await ptext(panel, "description", e.description, "Role description");
        changed = true;
        await sleep(150);
      }
      return changed;
    }

    const DEGREE_ALT = { "Bachelor of Science": "Bachelor's", "Bachelor of Arts": "Bachelor's", "Master of Science": "Master's", "Master of Arts": "Master's", PhD: "Doctorate", Associate: "Associate's", "High School Diploma": "High School" };

    async function fillEducation(profile) {
      const sec = section("educationSection");
      if (!sec) return false;
      const items = (profile.education || []).filter((e) => e.school).slice(0, 4);
      if (items.length === 0) return false;
      let changed = false;
      const used = new Set();
      for (let i = 0; i < items.length; i++) {
        const e = items[i];
        const existing = panelsIn(sec);
        let panel = existing.find((p) => !used.has(p) && textOf(p).includes(norm(e.school).split(",")[0].slice(0, 20)));
        if (!panel) panel = existing.find((p) => !used.has(p) && !hasSelected(p.querySelector(`${AID("formField-schoolItem")}, ${AID("formField-school")}`) || p) && !filled(field(p, "school")));
        if (!panel) { setStatus(`Adding education ${i + 1} of ${items.length}: ${e.school}…`); panel = await addEntry(sec); }
        if (!panel) { addLog("left", sec, "Education", `Couldn't add an entry for “${e.school}”`); break; }
        used.add(panel);
        panel.scrollIntoView({ block: "center" });

        const schoolWrap = panel.querySelector(`${AID("formField-schoolItem")}, ${AID("formField-school")}`) || panel;
        const school = field(panel, "school") || schoolWrap.querySelector("input:not([type=hidden])");
        if (school && isVisible(school) && !hasSelected(schoolWrap) && !filled(school)) {
          highlight(school);
          const isSearch = school.getAttribute("data-uxi-widget-type") === "selectinput" || school.getAttribute("role") === "combobox" || /search/i.test(school.placeholder || "");
          const ok = isSearch ? await pickSearch(school, e.school, { fallbacks: [e.school.replace(/^university of california[,\s-]*/i, "UC "), e.school.split(",")[0], "Other"], acceptTyped: true }) : await typeReal(school, e.school);
          addLog(ok ? "filled" : "left", school, "School", ok ? e.school : `Couldn't set “${e.school}”`, "profile");
        } else if (school) markSeen(school);

        const degree = field(panel, "degree");
        if (degree && isVisible(degree) && degree.tagName === "BUTTON" && !filled(degree)) {
          const want = e.degree || profile.degreeLevel;
          const ok = await pickListbox(degree, want, DEGREE_ALT[want] || profile.degreeLevel);
          addLog(ok ? "filled" : "left", degree, "Degree", ok ? listboxValue(degree) : `Couldn't pick “${want}”`, "profile");
        } else if (degree) markSeen(degree);

        const fosWrap = panel.querySelector(AID("formField-fieldOfStudy")) || panel;
        const fos = field(panel, "fieldOfStudy");
        if (fos && isVisible(fos) && e.field && !hasSelected(fosWrap) && !filled(fos)) {
          const ok = await pickSearch(fos, e.field, { fallbacks: [e.field.split(" ")[0], "Computer Science"], acceptTyped: false });
          addLog(ok ? "filled" : "left", fos, "Field of study", ok ? e.field : `Couldn't pick “${e.field}”`, "profile");
        } else if (fos) markSeen(fos);

        await ptext(panel, "gpa", e.gpa, "GPA");
        const fy = dateGroupIn(panel, "firstYearAttended");
        if (fy && e.startDate && !fy.querySelector("input")?.value) await setDateGroup(fy, e.startDate);
        const ly = dateGroupIn(panel, "lastYearAttended");
        if (ly && !ly.querySelector("input")?.value) {
          const end = e.endDate || profile.gradMonthYear;
          const ok = await setDateGroup(ly, end);
          addLog(ok ? "filled" : "left", ly.querySelector("input") || panel, "Graduation year", ok ? end : "Couldn't type the year", "profile");
        }
        changed = true;
        await sleep(150);
      }
      return changed;
    }

    async function fillLanguages(profile) {
      const sec = section("languageSection");
      if (!sec) return false;
      const langs = (profile.languages && profile.languages.length ? profile.languages : [{ name: "English", fluent: true }]).slice(0, 4);
      let changed = false;
      const used = new Set();
      for (let i = 0; i < langs.length; i++) {
        const l = langs[i];
        const existing = panelsIn(sec);
        let panel = existing.find((p) => !used.has(p) && norm(listboxValue(field(p, "language"))) === norm(l.name));
        if (!panel) panel = existing.find((p) => !used.has(p) && !filled(field(p, "language")));
        if (!panel) { setStatus(`Adding language: ${l.name}…`); panel = await addEntry(sec); }
        if (!panel) break;
        used.add(panel);
        const langBtn = field(panel, "language");
        if (langBtn && langBtn.tagName === "BUTTON" && !filled(langBtn)) {
          const ok = await pickListbox(langBtn, l.name, l.name.slice(0, 4));
          addLog(ok ? "filled" : "left", langBtn, "Language", ok ? l.name : `Couldn't pick “${l.name}”`, "profile");
        }
        const native = field(panel, "nativeLanguage");
        if (native && isVisible(native)) { markSeen(native); if (l.fluent !== false && !native.checked) { (native.closest("label") || native).click(); await sleep(150); } }
        const profs = Array.from(panel.querySelectorAll('button[aria-haspopup="listbox"][data-automation-id^="languageProficiency"], [data-automation-id^="formField-languageProficiency"] button'));
        for (const b of profs) {
          if (filled(b)) { markSeen(b); continue; }
          const level = l.fluent === false ? (l.level || "Intermediate") : "Fluent";
          await pickListbox(b, level, level === "Fluent" ? "Native" : level, { last: level === "Fluent" });
        }
        if (profs.length) addLog("filled", profs[0], `${l.name} proficiency`, l.fluent === false ? (l.level || "Intermediate") : "Fluent", "profile");
        changed = true;
      }
      return changed;
    }

    async function fillWebsites(profile) {
      const sec = section("websiteSection");
      if (!sec) return false;
      const urls = [profile.linkedin, profile.github, profile.website].filter(Boolean);
      if (urls.length === 0) return false;
      let changed = false;
      for (const url of urls) {
        const existingVals = panelsIn(sec).map((p) => norm(field(p, "website")?.value || ""));
        if (existingVals.some((v) => v && norm(url).replace(/\/$/, "").includes(v.replace(/\/$/, "")))) continue;
        let panel = panelsIn(sec).find((p) => !filled(field(p, "website")));
        if (!panel) panel = await addEntry(sec);
        if (!panel) break;
        await ptext(panel, "website", url, "Website");
        changed = true;
      }
      return changed;
    }

    async function fillSkills(profile) {
      const sec = section("skillsSection");
      if (!sec) return false;
      const input = sec.querySelector(`${AID("skillsPrompt")}, input[data-uxi-widget-type="selectinput"], input[type=text]`);
      if (!input || !isVisible(input)) return false;
      markSeen(input);
      if (hasSelected(sec)) return false;
      const skills = (profile.skills || []).slice(0, 15);
      let n = 0;
      for (const s of skills) {
        setStatus(`Adding skill: ${s}…`);
        const ok = await pickSearch(input, s, { acceptTyped: false });
        if (ok) n++;
        await sleep(120);
      }
      addLog(n ? "filled" : "skipped", input, "Skills", n ? `Added ${n} skills` : "Couldn't add skills here", "profile");
      return n > 0;
    }

    async function fillResume(ctx) {
      const sec = section("resumeSection") || document.querySelector(AID("file-upload-drop-zone"))?.parentElement;
      if (!sec) return false;
      if (sec.querySelector(`${AID("file-upload-item")}, [data-automation-id*="uploadedFile"], ${AID("deleteFile")}, [data-automation-id*="file-upload-successful"]`)) return false;
      const input = sec.querySelector("input[type=file]") || document.querySelector(`${AID("file-upload-input-ref")}, input[type=file]`);
      if (!input) return false;
      markSeen(input);
      const ok = await ctx.setFile(input);
      addLog(ok ? "filled" : "left", input, "Resume", ok ? ctx.resumeName() : "No resume stored — upload it on the dashboard Profile tab", "profile");
      return ok;
    }

    // ------------------------------------------------------------ Disclosures / Self Identify
    async function fillDisclosures(profile) {
      const eeo = profile.eeo || {};
      let any = false;
      const doLb = async (id, key, label) => {
        const btn = first(AID(id));
        if (!btn || filled(btn)) { if (btn) markSeen(btn); return; }
        const opts = await listboxOptions(btn);
        const pick = eeoPick(key, eeo, opts);
        if (pick) {
          const ok = await pickListbox(btn, pick, pick);
          addLog(ok ? "filled" : "left", btn, label, ok ? pick : `Couldn't pick “${pick}”`, "profile");
          any = any || ok;
        } else {
          // Leave it for the generic EEO handler (which asks you).
        }
      };
      await doLb("gender", "gender", "Gender");
      await doLb("ethnicityDropdown", "race", "Race / ethnicity");
      await doLb("hispanicOrLatino", "hispanic", "Hispanic or Latino");
      await doLb("veteranStatus", "veteran", "Veteran status");
      for (const cb of q(`${AID("agreementCheckbox")}, ${AID("termsAndConditions")}, input[type=checkbox]`)) {
        const lbl = textOf(cb.closest("label") || cb.parentElement);
        if (!cb.checked && (cb.matches(AID("agreementCheckbox")) || /terms|consent|agree|acknowledg|read/i.test(lbl))) { markSeen(cb); (cb.closest("label") || cb).click(); await sleep(150); addLog("filled", cb, "Terms", "Agreed", "auto"); any = true; }
      }
      return any;
    }

    async function fillSelfIdentify(profile) {
      const eeo = profile.eeo || {};
      let any = false;
      const boxes = { Yes: first(AID("disabilityYes")), No: first(AID("disabilityNo")), Decline: first(AID("disabilityDecline")) };
      Object.values(boxes).forEach((b) => b && markSeen(b));
      if (!Object.values(boxes).some((b) => b?.checked)) {
        const want = eeo.disability;
        if (want && boxes[want]) { (boxes[want].closest("label") || boxes[want]).click(); await sleep(150); addLog("filled", boxes[want], "Disability status", want, "profile"); any = true; }
      }
      const name = first(`${AID("name")}, input[data-automation-id*="name" i]:not([data-automation-id*="legalName"])`);
      if (name && !name.value) { markSeen(name); await typeReal(name, `${profile.firstName} ${profile.lastName}`.trim()); addLog("filled", name, "Your name", `${profile.firstName} ${profile.lastName}`, "profile"); any = true; }
      const dateWrap = first(`${AID("formField-dateSignedOn")}, [data-automation-id*="dateSigned" i], [data-automation-id*="todaysDate" i]`) || Array.from(document.querySelectorAll(AID("dateSectionMonth-input"))).map((i) => i.closest('[data-automation-id^="formField-"]')).find(Boolean);
      if (dateWrap && !Array.from(dateWrap.querySelectorAll("input")).every((inp) => inp.value)) {
        const ok = await setDateGroup(dateWrap, today());
        addLog(ok ? "filled" : "left", dateWrap.querySelector("input"), "Date", ok ? today() : "Couldn't type the date", "auto");
        any = any || ok;
      }
      return any;
    }

    // Any remaining date groups on a page (e.g. "expected graduation date" in
    // Application Questions): resolve by their label.
    async function fillDateGroups(profile) {
      let any = false;
      const groups = Array.from(document.querySelectorAll(`${AID("dateSectionMonth-input")}, ${AID("dateSectionYear-input")}`)).filter(isVisible).map((i) => i.closest('[data-automation-id^="formField-"]') || i.parentElement).filter((g, i, a) => g && a.indexOf(g) === i);
      for (const g of groups) {
        const inputs = Array.from(g.querySelectorAll("input")).filter(isVisible);
        if (inputs.every((inp) => inp.value)) { inputs.forEach(markSeen); continue; }
        const labelEl = g.closest('[data-automation-id^="formField-"]')?.parentElement?.querySelector("label, legend") || g.previousElementSibling;
        const label = norm(textOf(labelEl) || g.getAttribute("data-automation-id") || "");
        let value = "";
        if (/graduat|completion|expected (end|finish)|degree date|anticipated/.test(label)) value = profile.gradMonthYear || profile.education?.[0]?.endDate || "";
        else if (/today|date signed|signature|^date$|date:/.test(label)) value = today();
        else if (/start|available|availab|earliest|begin/.test(label)) value = profile.availableFrom || `05/${new Date().getFullYear() + 1}`;
        else if (/birth|dob/.test(label)) continue;
        if (!value) continue;
        const ok = await setDateGroup(g, value);
        addLog(ok ? "filled" : "left", inputs[0], labelEl ? textOf(labelEl) : "Date", ok ? value : `Couldn't type “${value}”`, /today/.test(label) ? "auto" : "profile");
        any = any || ok;
      }
      return any;
    }

    // ------------------------------------------------------------ run
    async function run(profile, ctx) {
      const type = pageType();
      if (!type || type === "createAccount" || type === "signIn") return { type, handled: false };
      let any = false;
      switch (type) {
        case "information":
          setStatus("Workday — My Information…");
          any = await fillInformation(profile);
          break;
        case "experience":
          setStatus("Workday — My Experience: adding your history…");
          any = (await fillResume(ctx)) || any;
          any = (await fillExperience(profile)) || any;
          any = (await fillEducation(profile)) || any;
          any = (await fillLanguages(profile)) || any;
          any = (await fillWebsites(profile)) || any;
          any = (await fillSkills(profile)) || any;
          break;
        case "disclosures":
          setStatus("Workday — Voluntary disclosures…");
          any = await fillDisclosures(profile);
          break;
        case "selfIdentify":
          setStatus("Workday — Self identification…");
          any = await fillSelfIdentify(profile);
          break;
        default:
          break;
      }
      any = (await fillDateGroups(profile)) || any;
      return { type, handled: any };
    }

    return { run, handleAuth, pageType, typeReal, typeDigits, setDateGroup, pickListbox, listboxOptions, openOptions, isExperiencePage: () => pageType() === "experience" };
  }

  window.AutopilotWorkday = { install };
})();
