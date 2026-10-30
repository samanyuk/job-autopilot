// Workday adapter: fills the "My Experience" page (work experience, education,
// websites, skills) by Workday's own data-automation-ids, adding one entry per
// item in the profile. Exposes window.AutopilotWorkday; content.js calls it
// with a small toolkit of helpers so both share one set of DOM utilities.

(function () {
  const AID = (id) => `[data-automation-id="${id}"]`;

  function install(T) {
    const { sleep, norm, textOf, isVisible, typeInto, setNativeValue, addLog, highlight, setStatus, fmtMonthYear, markSeen, setStatusQuiet } = T;

    // ---- keystroke typing for Workday's masked date inputs ----
    async function typeKeys(el, text) {
      el.focus();
      el.click();
      await sleep(60);
      // Clear whatever is there first.
      el.select?.();
      setNativeValue(el, "");
      el.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Backspace", code: "Backspace" }));
      let cur = "";
      for (const ch of text) {
        const kd = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: ch, code: /\d/.test(ch) ? `Digit${ch}` : `Key${ch.toUpperCase()}` });
        el.dispatchEvent(kd);
        el.dispatchEvent(new KeyboardEvent("keypress", { bubbles: true, cancelable: true, key: ch, charCode: ch.charCodeAt(0) }));
        if (!kd.defaultPrevented || el.value === cur) {
          cur += ch;
          setNativeValue(el, cur);
        } else {
          cur = el.value;
        }
        el.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key: ch }));
        await sleep(30);
      }
      el.dispatchEvent(new Event("change", { bubbles: true }));
      el.dispatchEvent(new FocusEvent("blur", { bubbles: true }));
      await sleep(80);
      return norm(el.value).replace(/\D/g, "") === text.replace(/\D/g, "") || el.value.length > 0;
    }

    async function setDateParts(panel, fieldPrefix, raw) {
      const d = fmtMonthYear(raw);
      if (!d) return false;
      const month = panel.querySelector(`${AID(`${fieldPrefix}-dateSectionMonth-input`)}, ${AID(`formField-${fieldPrefix}`)} ${AID("dateSectionMonth-input")}`);
      const year = panel.querySelector(`${AID(`${fieldPrefix}-dateSectionYear-input`)}, ${AID(`formField-${fieldPrefix}`)} ${AID("dateSectionYear-input")}`);
      const day = panel.querySelector(`${AID(`${fieldPrefix}-dateSectionDay-input`)}, ${AID(`formField-${fieldPrefix}`)} ${AID("dateSectionDay-input")}`);
      let ok = false;
      if (month && isVisible(month)) { ok = await typeKeys(month, d.month); markSeen(month); }
      if (day && isVisible(day)) { await typeKeys(day, d.day || "01"); markSeen(day); }
      if (year && isVisible(year)) { ok = (await typeKeys(year, d.year)) || ok; markSeen(year); }
      return ok;
    }

    // ---- listbox / prompt helpers ----
    function promptOptions() {
      return Array.from(document.querySelectorAll(`${AID("promptOption")}, [role=option], ul[role=listbox] li`)).filter((o) => isVisible(o) && textOf(o));
    }

    async function pickListbox(button, wanted, alt) {
      if (!button) return false;
      button.click();
      await sleep(400);
      const opts = promptOptions();
      const w = norm(wanted), a = norm(alt);
      const texts = opts.map(textOf);
      let i = texts.findIndex((t) => t === w);
      if (i < 0 && a) i = texts.findIndex((t) => t === a);
      if (i < 0) i = texts.findIndex((t) => w && (t.startsWith(w) || t.includes(w)));
      if (i < 0 && a) i = texts.findIndex((t) => t.includes(a));
      if (i < 0) { document.body.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape" })); return false; }
      opts[i].click();
      await sleep(250);
      return true;
    }

    // Searchable multi-select prompt (school, field of study, skills, "how did you hear").
    async function pickSearch(input, text, { enterIfNone = true } = {}) {
      if (!input || !text) return false;
      input.focus();
      setNativeValue(input, text);
      input.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter", code: "Enter" }));
      await sleep(900);
      let opts = promptOptions();
      if (opts.length === 0) { await sleep(700); opts = promptOptions(); }
      const w = norm(text);
      const best = opts.find((o) => textOf(o) === w) || opts.find((o) => textOf(o).includes(w)) || opts[0];
      if (best) { best.click(); await sleep(300); return true; }
      if (enterIfNone) {
        input.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter", code: "Enter" }));
        await sleep(300);
        return input.value.length > 0 || !!input.closest(AID("formField-school"));
      }
      return false;
    }

    // ---- sections ----
    function section(id) {
      return document.querySelector(AID(id)) || null;
    }

    function panelsIn(sec) {
      // Each entry is a panel whose automation id ends in "-<n>" (workExperience-1, education-2…).
      const all = Array.from(sec.querySelectorAll("[data-automation-id]")).filter((n) => /-(\d+)$/.test(n.getAttribute("data-automation-id")) && n.querySelector("input, textarea, button"));
      // Keep outermost ones only.
      return all.filter((n) => !all.some((m) => m !== n && m.contains(n)));
    }

    function addButton(sec) {
      return Array.from(sec.querySelectorAll(`${AID("Add")}, ${AID("Add Another")}, button`)).find((b) => isVisible(b) && /^add( another)?$/i.test(textOf(b))) || null;
    }

    async function addEntry(sec) {
      const before = new Set(panelsIn(sec));
      const btn = addButton(sec);
      if (!btn) return null;
      btn.click();
      for (let i = 0; i < 12; i++) {
        await sleep(250);
        const now = panelsIn(sec).filter((p) => !before.has(p));
        if (now.length) return now[now.length - 1];
      }
      return null;
    }

    const field = (panel, id) => panel.querySelector(`${AID(id)}, ${AID(`formField-${id}`)} input, ${AID(`formField-${id}`)} textarea, ${AID(`formField-${id}`)} button[aria-haspopup="listbox"]`);
    const filled = (el) => !!el && ((el.tagName === "BUTTON" && !/select one|^$/.test(textOf(el))) || (typeof el.value === "string" && el.value.trim().length > 0));

    async function text(panel, id, value, label) {
      const el = field(panel, id);
      if (!el || !isVisible(el) || el.tagName === "BUTTON") return false;
      markSeen(el);
      if (filled(el) || !value) return filled(el);
      highlight(el);
      const ok = await typeInto(el, value);
      addLog(ok ? "filled" : "left", el, label, ok ? value : `Couldn't set “${value}”`, "profile");
      return ok;
    }

    // ---- Work experience ----
    async function fillExperience(profile) {
      const sec = section("workExperienceSection");
      if (!sec) return false;
      const items = (profile.experience || []).filter((e) => e.title).slice(0, 8);
      if (items.length === 0) return false;
      const existing = panelsIn(sec);
      const existingTitles = existing.map((p) => norm(field(p, "jobTitle")?.value || ""));
      let changed = false;
      for (let i = 0; i < items.length; i++) {
        const e = items[i];
        let panel = existing.find((p, idx) => existingTitles[idx] && existingTitles[idx] === norm(e.title));
        if (!panel) {
          // Reuse a blank existing panel, else add one.
          panel = existing.find((p, idx) => !existingTitles[idx] && !p.__autopilotUsed);
          if (!panel) {
            setStatus(`Adding experience ${i + 1} of ${items.length}: ${e.title}…`);
            panel = await addEntry(sec);
          }
          if (!panel) { addLog("left", sec, "Work experience", `Couldn't add an entry for “${e.title}”`); break; }
        }
        panel.__autopilotUsed = true;
        panel.scrollIntoView({ block: "center" });
        await text(panel, "jobTitle", e.title, "Job title");
        await text(panel, "company", e.company || "Self", "Company");
        await text(panel, "location", e.location || [profile.city, profile.state].filter(Boolean).join(", "), "Location");
        const cur = field(panel, "currentlyWorkHere");
        if (cur && isVisible(cur)) {
          markSeen(cur);
          if (!!e.current !== cur.checked) { (cur.closest("label") || cur).click(); await sleep(250); }
          if (e.current) addLog("filled", cur, "I currently work here", "Checked", "profile");
        }
        if (e.startDate) {
          const ok = await setDateParts(panel, "startDate", e.startDate);
          addLog(ok ? "filled" : "left", field(panel, "startDate-dateSectionMonth-input") || panel, "Start date", ok ? e.startDate : `Couldn't type “${e.startDate}”`, "profile");
        }
        if (!e.current && e.endDate) {
          const ok = await setDateParts(panel, "endDate", e.endDate);
          addLog(ok ? "filled" : "left", field(panel, "endDate-dateSectionMonth-input") || panel, "End date", ok ? e.endDate : `Couldn't type “${e.endDate}”`, "profile");
        }
        await text(panel, "description", e.description, "Role description");
        changed = true;
        await sleep(200);
      }
      return changed;
    }

    // ---- Education ----
    const DEGREE_ALT = { "Bachelor of Science": "Bachelor's", "Bachelor of Arts": "Bachelor's", "Master of Science": "Master's", "Master of Arts": "Master's", PhD: "Doctorate", Associate: "Associate's" };

    async function fillEducation(profile) {
      const sec = section("educationSection");
      if (!sec) return false;
      const items = (profile.education || []).filter((e) => e.school).slice(0, 4);
      if (items.length === 0) return false;
      const existing = panelsIn(sec);
      let changed = false;
      for (let i = 0; i < items.length; i++) {
        const e = items[i];
        let panel = existing.find((p) => norm(field(p, "school")?.value || "").includes(norm(e.school).split(",")[0]));
        if (!panel) {
          panel = existing.find((p) => !filled(field(p, "school")) && !p.__autopilotUsed);
          if (!panel) {
            setStatus(`Adding education ${i + 1} of ${items.length}: ${e.school}…`);
            panel = await addEntry(sec);
          }
          if (!panel) { addLog("left", sec, "Education", `Couldn't add an entry for “${e.school}”`); break; }
        }
        panel.__autopilotUsed = true;
        panel.scrollIntoView({ block: "center" });

        const school = field(panel, "school") || panel.querySelector(`${AID("formField-schoolItem")} input, input[data-automation-id*="school"]`);
        if (school && isVisible(school)) {
          markSeen(school);
          if (!filled(school)) {
            highlight(school);
            const ok = school.getAttribute("role") === "combobox" || school.getAttribute("data-uxi-widget-type") === "selectinput"
              ? await pickSearch(school, e.school)
              : await typeInto(school, e.school);
            addLog(ok ? "filled" : "left", school, "School", ok ? e.school : `Couldn't set “${e.school}”`, "profile");
          }
        }
        const degree = field(panel, "degree");
        if (degree && isVisible(degree)) {
          markSeen(degree);
          if (!filled(degree)) {
            const want = e.degree || profile.degreeLevel;
            const ok = await pickListbox(degree, want, DEGREE_ALT[want] || profile.degreeLevel);
            addLog(ok ? "filled" : "left", degree, "Degree", ok ? want : `Couldn't pick “${want}”`, "profile");
          }
        }
        const fos = field(panel, "fieldOfStudy") || panel.querySelector(`${AID("formField-fieldOfStudy")} input`);
        if (fos && isVisible(fos) && e.field) {
          markSeen(fos);
          if (!filled(fos)) {
            const ok = await pickSearch(fos, e.field);
            addLog(ok ? "filled" : "left", fos, "Field of study", ok ? e.field : `Couldn't pick “${e.field}”`, "profile");
          }
        }
        await text(panel, "gpa", e.gpa, "GPA");
        if (e.startDate) await setDateParts(panel, "firstYearAttended", e.startDate);
        if (e.endDate) {
          const ok = await setDateParts(panel, "lastYearAttended", e.endDate);
          addLog(ok ? "filled" : "left", panel, "Graduation year", ok ? e.endDate : "Couldn't type the year", "profile");
        }
        changed = true;
        await sleep(200);
      }
      return changed;
    }

    // ---- Websites ----
    async function fillWebsites(profile) {
      const sec = section("websiteSection");
      if (!sec) return false;
      const urls = [profile.linkedin, profile.github, profile.website].filter(Boolean);
      if (urls.length === 0) return false;
      const existingVals = panelsIn(sec).map((p) => norm(field(p, "website")?.value || ""));
      let changed = false;
      for (const url of urls) {
        if (existingVals.some((v) => v && norm(url).includes(v.replace(/\/$/, "")))) continue;
        let panel = panelsIn(sec).find((p) => !filled(field(p, "website")) && !p.__autopilotUsed);
        if (!panel) panel = await addEntry(sec);
        if (!panel) break;
        panel.__autopilotUsed = true;
        await text(panel, "website", url, "Website");
        changed = true;
      }
      return changed;
    }

    // ---- Skills ----
    async function fillSkills(profile) {
      const sec = section("skillsSection");
      if (!sec) return false;
      const input = sec.querySelector(`${AID("skillsPrompt")}, input[data-uxi-widget-type="selectinput"], input[type=text]`);
      if (!input || !isVisible(input)) return false;
      markSeen(input);
      const already = sec.querySelectorAll(`${AID("selectedItem")}, [data-automation-id*="pill"], [role=listitem]`).length;
      if (already > 0) return false;
      const skills = (profile.skills || []).slice(0, 15);
      let n = 0;
      for (const s of skills) {
        setStatus(`Adding skill: ${s}…`);
        const ok = await pickSearch(input, s, { enterIfNone: false });
        if (ok) n++;
        await sleep(150);
      }
      addLog(n ? "filled" : "skipped", input, "Skills", n ? `Added ${n} skills` : "Couldn't add skills here", "profile");
      return n > 0;
    }

    // ---- Resume on the experience page ----
    async function fillResume(T2) {
      const sec = section("resumeSection") || document.querySelector(AID("file-upload-drop-zone"))?.parentElement;
      if (!sec) return false;
      if (sec.querySelector(`${AID("file-upload-item")}, [data-automation-id*="uploadedFile"], [data-automation-id="deleteFile"]`)) return false;
      const input = sec.querySelector("input[type=file]") || document.querySelector(`${AID("file-upload-input-ref")}`);
      if (!input) return false;
      markSeen(input);
      const ok = await T2.setFile(input);
      addLog(ok ? "filled" : "left", input, "Resume", ok ? T2.resumeName() : "No resume stored", "profile");
      return ok;
    }

    function isExperiencePage() {
      return !!(section("workExperienceSection") || section("educationSection") || section("skillsSection") || section("websiteSection"));
    }

    async function run(profile, T2) {
      if (!isExperiencePage()) return false;
      setStatusQuiet("Workday experience page — adding your history…");
      let any = false;
      any = (await fillResume(T2)) || any;
      any = (await fillExperience(profile)) || any;
      any = (await fillEducation(profile)) || any;
      any = (await fillWebsites(profile)) || any;
      any = (await fillSkills(profile)) || any;
      return any;
    }

    return { run, isExperiencePage, typeKeys, promptOptions };
  }

  window.AutopilotWorkday = { install };
})();
