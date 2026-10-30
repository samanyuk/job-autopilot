// Field-matching rules shared by every ATS adapter. Each rule is tested
// against a normalized label string ("first name | legalname_firstname | …").
// First match wins, so order from most specific to least.

(function () {
  const yesNo = (v) => (v === "yes" ? "Yes" : v === "no" ? "No" : "");

  const fmtMonthYear = (s) => {
    if (!s) return null;
    const months = { jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06", jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12" };
    let m = s.match(/([a-z]{3})[a-z]*\.?\s+(\d{4})/i);
    if (m) return { month: months[m[1].toLowerCase()] || "06", day: "01", year: m[2], text: `${months[m[1].toLowerCase()] || "06"}/${m[2]}` };
    m = s.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (m) return { month: m[1].padStart(2, "0"), day: m[2].padStart(2, "0"), year: m[3], text: `${m[1].padStart(2, "0")}/${m[2].padStart(2, "0")}/${m[3]}` };
    m = s.match(/(\d{1,2})\/(\d{4})/);
    if (m) return { month: m[1].padStart(2, "0"), day: "01", year: m[2], text: `${m[1].padStart(2, "0")}/${m[2]}` };
    m = s.match(/(\d{4})/);
    if (m) return { month: "06", day: "01", year: m[1], text: `06/${m[1]}` };
    return null;
  };

  const today = () => {
    const d = new Date();
    return `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}/${d.getFullYear()}`;
  };

  // Demographic questions. Answered only from profile.eeo (set on the dashboard).
  const EEO_RE = /\b(gender|race\b|racial|ethnic|hispanic|latin[ox]|veteran|disabilit|disabled|sexual orientation|pronoun|transgender|non-?binary|self[- ]?identif|military status|eeo\b|equal employment|demographic)/i;

  // Things we leave blank on purpose (unless an AI key can answer them).
  const SKIP_RE = /\b(password|cover letter|salary|compensation|desired pay|expected pay|ssn|social security|date of birth|birth ?date|passport|credit card|security question|captcha|preferred name|middle name|suffix|address line 2|apt|unit number|extension|ext\.?$|referred by|referral name|employee name|recruiter name|search)\b/i;

  // Buttons we must never click on our own.
  const SUBMIT_RE = /\b(submit|apply now|send application|send my application|finish|complete application|sign application|i'?m interested)\b/i;
  // Buttons that advance a multi-page form.
  const NEXT_RE = /^(next|continue|save and continue|save & continue|next step|next page|proceed|save|review)\b/i;
  // Buttons that start an application from a posting page.
  const APPLY_RE = /^(apply|apply now|apply for this (job|position|role)|apply to (this )?(job|position)|start (your )?application|begin application|apply manually|autofill with resume|i'?m interested)$/i;
  const APPLY_AVOID_RE = /linkedin|indeed|seek|google|facebook|last application|previous application/i;
  // Cookie banner buttons.
  const COOKIE_RE = /^(accept( all)?( cookies)?|allow all( cookies)?|i accept|agree|i agree|got it|ok|okay|understood|accept and continue|accept & close|yes, i agree)$/i;

  const RULES = [
    // --- Identity ---
    { key: "firstName", kind: "text", test: /first\s*name|given\s*name|\bfname\b|legalname_firstname|^first$/, value: (p) => p.firstName },
    { key: "lastName", kind: "text", test: /last\s*name|family\s*name|surname|\blname\b|legalname_lastname|^last$/, value: (p) => p.lastName },
    { key: "fullName", kind: "text", test: /^(your\s*)?(full\s*)?(legal\s*)?name\*?$|^name\s*\*|full name|^candidate name|^print(ed)? name|^signature\*?$|type your name|^name of applicant/, value: (p) => `${p.firstName} ${p.lastName}`.trim() },
    { key: "email", kind: "text", test: /e-?mail|username/, value: (p) => p.email },
    { key: "phoneType", kind: "select", test: /phone\s*(device\s*)?type|device type/, value: () => "Mobile" },
    { key: "phoneCountry", kind: "select", test: /country\s*phone\s*code|phone\s*code|country code|dial code|calling code/, value: (p) => p.country === "United States" ? "United States of America (+1)" : p.country, alt: () => "+1" },
    { key: "phone", kind: "text", test: /phone|mobile|telephone|\bcell\b/, value: (p) => p.phone },

    // --- Address ---
    { key: "address1", kind: "text", test: /address\s*line\s*1|street\s*address|^address\*?$|addressline1|^street$|home address|mailing address|^address 1/, value: (p) => p.address1 },
    { key: "city", kind: "text", test: /\bcity\b|\btown\b|locality/, value: (p) => p.city },
    { key: "state", kind: "select", test: /\bstate\b|province|region|county/, value: (p) => p.state, alt: (p) => STATE_NAMES[p.state] || p.state },
    { key: "zip", kind: "text", test: /\bzip\b|postal/, value: (p) => p.zip },
    { key: "country", kind: "select", test: /\bcountry\b|nation(ality)?/, value: (p) => p.country, alt: (p) => (p.country === "United States" ? "United States of America" : p.country) },
    { key: "location", kind: "text", test: /^(current\s*)?location|where are you (located|based)|city, state|city\/state/, value: (p) => [p.city, p.state].filter(Boolean).join(", ") },

    // --- Links ---
    { key: "linkedin", kind: "text", test: /linkedin/, value: (p) => p.linkedin },
    { key: "github", kind: "text", test: /github/, value: (p) => p.github },
    { key: "website", kind: "text", test: /website|portfolio|personal site|\burl\b|homepage|other link/, value: (p) => p.website || p.github || p.linkedin },

    // --- Education ---
    { key: "school", kind: "text", test: /school|university|college|institution|alma mater/, value: (p, i) => p.education[i]?.school ?? "" },
    { key: "degree", kind: "select", test: /\bdegree\b|education level|highest level|level of education/, value: (p, i) => p.education[i]?.degree || p.degreeLevel, alt: (p) => p.degreeLevel },
    { key: "field", kind: "text", test: /major|field of study|discipline|concentration|area of study|program of study/, value: (p, i) => p.education[i]?.field ?? "" },
    { key: "gpa", kind: "text", test: /\bgpa\b|grade point|cumulative/, value: (p, i) => p.education[i]?.gpa ?? "" },
    { key: "gradDate", kind: "date", test: /graduat|grad date|expected (completion|end)|completion date|end date.*(school|education)|anticipated/, value: (p, i) => p.education[i]?.endDate || p.gradMonthYear },
    { key: "eduStart", kind: "date", test: /start date|from date|date started|attended from|^from$/, value: (p, i) => p.education[i]?.startDate ?? "", scope: "education" },
    { key: "eduEnd", kind: "date", test: /end date|to date|date ended|attended to|until|^to$/, value: (p, i) => p.education[i]?.endDate ?? "", scope: "education" },

    // --- Experience ---
    { key: "currentCompany", kind: "text", test: /current (company|employer)|most recent (company|employer)|^company$|^organization$|^org$/, value: (p) => p.experience[0]?.company ?? "" },
    { key: "currentTitle", kind: "text", test: /current (title|role|position)|most recent (title|role|position)/, value: (p) => p.experience[0]?.title ?? "" },
    { key: "jobTitle", kind: "text", test: /job title|position title|^title\*?$|role title|your (current )?title/, value: (p, i) => p.experience[i]?.title ?? "", scope: "experience" },
    { key: "company", kind: "text", test: /company|employer|organization|organisation/, value: (p, i) => p.experience[i]?.company ?? "", scope: "experience" },
    { key: "expLocation", kind: "text", test: /location/, value: (p, i) => p.experience[i]?.location ?? "", scope: "experience" },
    { key: "expStart", kind: "date", test: /start date|from date|date started|^from$/, value: (p, i) => p.experience[i]?.startDate ?? "", scope: "experience" },
    { key: "expEnd", kind: "date", test: /end date|to date|date ended|^to$/, value: (p, i) => p.experience[i]?.endDate ?? "", scope: "experience" },
    { key: "expCurrent", kind: "check", test: /currently work|current(ly)? employed here|i currently work|present/, value: (p, i) => !!p.experience[i]?.current, scope: "experience" },
    { key: "expDesc", kind: "text", test: /role description|description|responsibilities|duties/, value: (p, i) => p.experience[i]?.description ?? "", scope: "experience" },

    // --- Screening ---
    { key: "workAuthorized", kind: "bool", test: /authori[sz]ed to work|legally (able|eligible|permitted) to work|work authori[sz]ation|eligible to work|right to work|lawfully/, value: (p) => yesNo(p.workAuthorized) },
    { key: "needsSponsorship", kind: "bool", test: /sponsorship|visa|require.*immigration|immigration (support|status)|h-?1b/, value: (p) => yesNo(p.needsSponsorship) },
    { key: "over18", kind: "bool", test: /18 years|over 18|at least 18|age of 18|legal age|minimum age/, value: (p) => yesNo(p.over18) },
    { key: "previouslyEmployed", kind: "bool", test: /previously (worked|employed|been employed|applied)|former employee|ever (worked|been employed)|currently (an )?employee|worked (at|for|with) (this|our|us|the company)|current or former/, value: (p) => yesNo(p.previouslyEmployed) },
    { key: "relocate", kind: "bool", test: /relocat/, value: (p) => yesNo(p.relocate) },
    { key: "remoteOk", kind: "bool", test: /willing to work (remote|on-?site|in[- ]?office|hybrid)|able to work (on-?site|in person)|commute/, value: () => "Yes" },
    { key: "backgroundCheck", kind: "bool", test: /background check|drug (test|screen)/, value: () => "Yes" },
    { key: "gradLevelSelect", kind: "select", test: /(current|highest).*(degree|education)|degree (level|type)|what degree/, value: (p) => p.degreeLevel },
    { key: "gradYearSelect", kind: "select", test: /graduation year|grad year|year of graduation|expected graduation/, value: (p) => (p.gradMonthYear || "").split("/")[1] || "" },
    { key: "howHeard", kind: "select", test: /how did you (hear|find|learn)|hear about|^source|referral source/, value: (p) => p.howHeard || "Job board", alt: () => "Other" },
    { key: "summary", kind: "textarea", test: /summary|about you|about yourself|tell us|why (do you want|are you interested)|why .* (company|role)|additional information|anything else|comments|cover letter/, value: (p) => p.summary, ai: true },
    { key: "today", kind: "date", test: /today'?s date|^date\*?$|date signed|signature date|^date:?$/, value: () => today() },

    // --- Consent boxes (ticked because you told Autopilot to take over the page) ---
    { key: "consent", kind: "check", test: /i (have )?(read|agree|acknowledge|certify|consent|accept|understand|confirm|attest)|terms|privacy|acknowledg|agree to|consent to|i affirm|accurate and complete/, value: () => true },

    // --- Files ---
    { key: "resume", kind: "file", test: /resume|résumé|\bcv\b|curriculum|upload|attach|file/, value: () => "RESUME" },
  ];

  // Map a canonical EEO answer onto the wording a given form uses.
  const EEO_MATCHERS = {
    gender: {
      Male: [/^male\b/, /^man\b/],
      Female: [/^female\b/, /^woman\b/],
      "Non-binary": [/non-?binary/, /gender[- ]?(nonconforming|fluid|queer)/, /^other/],
      Decline: [/decline|prefer not|do not wish|don'?t wish|choose not|not to (answer|say|disclose)|not disclose|rather not/],
    },
    hispanic: {
      Yes: [/^yes\b/, /^hispanic or latin[ox]\b/, /^i am hispanic/],
      No: [/^no\b/, /^not hispanic/, /^i am not hispanic/],
      Decline: [/decline|prefer not|do not wish|don'?t wish|choose not|not to (answer|say|disclose)|not disclose|rather not/],
    },
    race: {
      "American Indian or Alaska Native": [/american indian|alaska|native american|indigenous/],
      Asian: [/^asian\b|asian \(not hispanic/],
      "Black or African American": [/black|african american/],
      "Native Hawaiian or Other Pacific Islander": [/hawaiian|pacific islander/],
      White: [/^white\b|caucasian/],
      "Two or More Races": [/two or more|multiracial|multi-racial|mixed/],
      Decline: [/decline|prefer not|do not wish|don'?t wish|choose not|not to (answer|say|disclose)|not disclose|rather not/],
    },
    veteran: {
      "Not a veteran": [/not a (protected )?veteran|i am not a veteran|^no\b|not applicable|none of the above/],
      Veteran: [/identify as one or more|i am a (protected )?veteran|^yes\b|protected veteran$/],
      Decline: [/decline|prefer not|do not wish|don'?t wish|choose not|not to (answer|say|disclose)|not disclose|rather not/],
    },
    disability: {
      Yes: [/^yes\b/, /i have a disability/],
      No: [/^no\b/, /i do not have a disability|don'?t have a disability/],
      Decline: [/decline|prefer not|do not wish|don'?t wish|do not want|don'?t want|choose not|not to (answer|say|disclose)|not disclose|rather not/],
    },
  };

  function eeoKeyFor(text) {
    const t = text.toLowerCase();
    if (/disabilit|disabled/.test(t)) return "disability";
    if (/veteran|military/.test(t)) return "veteran";
    if (/hispanic|latin[ox]|ethnic/.test(t)) return "hispanic";
    if (/\brace\b|racial/.test(t)) return "race";
    if (/gender|\bsex\b/.test(t)) return "gender";
    return null;
  }

  // Pick the option text that corresponds to the stored EEO answer.
  function eeoPick(key, eeo, optionTexts) {
    if (!eeo) return null;
    const norm = (s) => (s || "").toLowerCase().replace(/\s+/g, " ").trim();
    const opts = optionTexts.map(norm);
    const find = (patterns) => {
      for (const re of patterns) {
        const i = opts.findIndex((o) => re.test(o));
        if (i >= 0) return optionTexts[i];
      }
      return null;
    };
    // Combined "Race / Ethnicity" questions list Hispanic as one of the races.
    if (key === "hispanic" || key === "race") {
      const combined = opts.some((o) => /hispanic|latin/.test(o)) && opts.some((o) => /asian|white|black|hawaiian|indian/.test(o));
      if (combined) {
        if (eeo.hispanic === "Yes") return find([/hispanic|latin/]);
        if (eeo.race) return find(EEO_MATCHERS.race[eeo.race] || []);
        if (eeo.hispanic === "Decline") return find(EEO_MATCHERS.race.Decline);
        return null;
      }
    }
    const answer = eeo[key];
    if (!answer) return null;
    return find(EEO_MATCHERS[key]?.[answer] || []);
  }

  const STATE_NAMES = {
    AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado", CT: "Connecticut", DE: "Delaware",
    FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky",
    LA: "Louisiana", ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri",
    MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York", NC: "North Carolina",
    ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota",
    TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming", DC: "District of Columbia",
  };

  window.AutopilotRules = { RULES, EEO_RE, SKIP_RE, SUBMIT_RE, NEXT_RE, APPLY_RE, APPLY_AVOID_RE, COOKIE_RE, STATE_NAMES, fmtMonthYear, today, eeoKeyFor, eeoPick };
})();
