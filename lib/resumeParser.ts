import { extractSkills } from "./skills";
import type { Education, Experience, Profile } from "./types";

export function emptyProfile(): Profile {
  return {
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    phoneCountryCode: "+1",
    address1: "",
    address2: "",
    city: "",
    state: "",
    zip: "",
    country: "United States",
    linkedin: "",
    github: "",
    website: "",
    summary: "",
    skills: [],
    education: [],
    experience: [],
    workAuthorized: "yes",
    needsSponsorship: "no",
    over18: "yes",
    previouslyEmployed: "no",
    relocate: "yes",
    gradMonthYear: "",
    degreeLevel: "Bachelor's",
    howHeard: "Job board",
    rawText: "",
  };
}

const SECTION_HEADERS: Record<string, RegExp> = {
  education: /^(education|academics|academic background)\b/i,
  experience: /^(experience|work experience|professional experience|employment|work history|research experience|internships?)\b/i,
  projects: /^(projects|personal projects|selected projects|technical projects)\b/i,
  skills: /^(skills|technical skills|technologies|tools|core competencies|languages?( & | and )?(frameworks|tools)?)\b/i,
  summary: /^(summary|objective|profile|about)\b/i,
  other: /^(awards|honors|leadership|activities|certifications|publications|volunteer|extracurricular|involvement|coursework|relevant coursework)\b/i,
};

function classifyHeader(line: string): string | null {
  const clean = line.replace(/[:\-–—_|•]/g, " ").trim();
  if (clean.length > 40 || clean.split(/\s+/).length > 5) return null;
  for (const [key, re] of Object.entries(SECTION_HEADERS)) {
    if (re.test(clean)) return key;
  }
  return null;
}

function splitSections(lines: string[]): Record<string, string[]> {
  const sections: Record<string, string[]> = { header: [] };
  let current = "header";
  for (const line of lines) {
    const key = classifyHeader(line);
    if (key) {
      current = key;
      if (!sections[current]) sections[current] = [];
      continue;
    }
    sections[current].push(line);
  }
  return sections;
}

const MONTH = "(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?";
const DATE_RE = new RegExp(`(${MONTH}\\s+\\d{4}|\\d{1,2}/\\d{4}|\\d{4})`, "i");
const DATE_RANGE_RE = new RegExp(
  `(${MONTH}\\s+\\d{4}|\\d{1,2}/\\d{4}|\\d{4})\\s*(?:-|–|—|to)\\s*(${MONTH}\\s+\\d{4}|\\d{1,2}/\\d{4}|\\d{4}|present|current|now)`,
  "i",
);

function titleCase(s: string) {
  return s.replace(/\w\S*/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
}

function parseName(headerLines: string[], allText: string): { first: string; last: string } {
  const candidates = headerLines.slice(0, 5);
  for (const raw of candidates) {
    const line = raw.replace(/[|•·,].*$/, "").trim();
    if (!line || /@|\d|http|linkedin|github|resume|curriculum/i.test(line)) continue;
    const words = line.split(/\s+/).filter((w) => /^[A-Za-z'.-]+$/.test(w));
    if (words.length >= 2 && words.length <= 4 && words.join(" ").length === line.length) {
      const named = words.map((w) => (w === w.toUpperCase() ? titleCase(w) : w));
      return { first: named[0], last: named.slice(1).join(" ") };
    }
  }
  // Fallback: derive from email local part (e.g. jane.doe@ → Jane Doe)
  const email = allText.match(/[\w.+-]+@[\w-]+\.[\w.]+/)?.[0] ?? "";
  const local = email.split("@")[0];
  const parts = local.split(/[._-]/).filter((p) => /^[a-z]+$/i.test(p));
  if (parts.length >= 2) return { first: titleCase(parts[0]), last: titleCase(parts[1]) };
  return { first: "", last: "" };
}

function parseEducation(lines: string[]): Education[] {
  const entries: Education[] = [];
  let cur: Education | null = null;
  const schoolRe = /(university|college|institute|school|academy|polytechnic)/i;
  const degreeRe =
    /\b(bachelor(?:'s)?(?: of)?(?: science| arts| engineering)?|master(?:'s)?(?: of)?(?: science| arts| engineering)?|b\.?s\.?c?\.?|b\.?a\.?|m\.?s\.?c?\.?|m\.?a\.?|ph\.?d\.?|doctorate|associate(?:'s)?|a\.?a\.?|a\.?s\.?|high school diploma)\b/i;
  const fieldRe =
    /\b(computer science|computer engineering|electrical engineering|software engineering|data science|mathematics|statistics|information systems|mechanical engineering|business|economics|physics|cognitive science|applied math(?:ematics)?|artificial intelligence|machine learning)\b/i;

  for (const line of lines) {
    if (schoolRe.test(line) && !/relevant coursework/i.test(line)) {
      if (cur) entries.push(cur);
      cur = { school: line.split(/\s*[|•·]\s*|\s+[—–-]\s+|\s{2,}/)[0].replace(DATE_RANGE_RE, "").replace(DATE_RE, "").trim(), degree: "", field: "", gpa: "", startDate: "", endDate: "" };
    }
    if (!cur) {
      cur = { school: "", degree: "", field: "", gpa: "", startDate: "", endDate: "" };
    }
    const deg = line.match(degreeRe);
    if (deg && !cur.degree) cur.degree = normalizeDegree(deg[1]);
    const field = line.match(fieldRe);
    if (field && !cur.field) cur.field = titleCase(field[1]);
    const gpa = line.match(/gpa[:\s]*([0-4]\.\d{1,2})/i);
    if (gpa && !cur.gpa) cur.gpa = gpa[1];
    const range = line.match(DATE_RANGE_RE);
    if (range) {
      cur.startDate = cur.startDate || range[1];
      cur.endDate = cur.endDate || range[2];
    } else {
      const single = line.match(new RegExp(`(?:expected|anticipated|graduating|graduation|class of)?\\s*${DATE_RE.source}`, "i"));
      if (single && !cur.endDate) cur.endDate = single[1];
    }
  }
  if (cur && (cur.school || cur.degree)) entries.push(cur);
  return entries;
}

function normalizeDegree(raw: string): string {
  const r = raw.toLowerCase().replace(/\./g, "");
  if (/^phd|doctorate/.test(r)) return "PhD";
  if (/^(ms|msc|master)/.test(r)) return r.includes("arts") ? "Master of Arts" : "Master of Science";
  if (/^ma$/.test(r)) return "Master of Arts";
  if (/^(bs|bsc|bachelor)/.test(r)) return r.includes("arts") ? "Bachelor of Arts" : "Bachelor of Science";
  if (/^ba$/.test(r)) return "Bachelor of Arts";
  if (/^(aa|as|associate)/.test(r)) return "Associate";
  if (/high school/.test(r)) return "High School Diploma";
  return titleCase(raw);
}

function parseExperience(lines: string[], isProject = false): Experience[] {
  const entries: Experience[] = [];
  let cur: Experience | null = null;
  for (const line of lines) {
    const isBullet = /^[•\-–*▪●◦]/.test(line);
    const range = line.match(DATE_RANGE_RE);
    if (!isBullet && range) {
      // A header line of a new entry: "Software Intern | Acme Corp | Jun 2025 – Sep 2025"
      if (cur) entries.push(cur);
      const head = line.replace(DATE_RANGE_RE, "").replace(/[|•·]\s*$/, "").trim();
      const parts = head.split(/\s*[|•·]\s*|\s{2,}|\s+[-–—]\s+/).map((p) => p.trim()).filter(Boolean);
      const end = range[2];
      cur = {
        title: parts[0] ?? head,
        company: isProject ? "Personal project" : (parts[1] ?? ""),
        location: isProject ? "" : (parts[2] ?? ""),
        startDate: range[1],
        endDate: /present|current|now/i.test(end) ? "" : end,
        current: /present|current|now/i.test(end),
        description: isProject && parts[1] ? `Built with ${parts.slice(1).join(", ")}` : "",
      };
      continue;
    }
    if (!cur) {
      // Entry header without a date on the same line.
      if (!isBullet && line.length < 90) {
        cur = { title: line, company: "", location: "", startDate: "", endDate: "", current: false, description: "" };
      }
      continue;
    }
    if (isBullet) {
      cur.description += (cur.description ? "\n" : "") + line.replace(/^[•\-–*▪●◦]\s*/, "");
    } else if (!cur.company && line.length < 80) {
      // Second header line, usually the company.
      cur.company = line.split(/\s*[|•·,]\s*/)[0];
    } else {
      cur.description += (cur.description ? "\n" : "") + line;
    }
  }
  if (cur) entries.push(cur);
  return entries.filter((e) => e.title);
}

function parseSkillsSection(lines: string[]): string[] {
  const out: string[] = [];
  for (const line of lines) {
    const body = line.replace(/^[^:]{0,30}:\s*/, ""); // strip "Languages:" prefix
    for (const token of body.split(/[,|•·;/]|\s{2,}/)) {
      const t = token.trim().replace(/^and\s+/i, "");
      if (t && t.length <= 30 && !/^\d+$/.test(t)) out.push(t);
    }
  }
  return out;
}

export function parseProfile(text: string): Profile {
  const profile = emptyProfile();
  profile.rawText = text;
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const sections = splitSections(lines);

  const name = parseName(sections.header, text);
  profile.firstName = name.first;
  profile.lastName = name.last;

  profile.email = text.match(/[\w.+-]+@[\w-]+\.[\w.]+/)?.[0] ?? "";
  const phone = text.match(/(\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/)?.[0] ?? "";
  profile.phone = phone.replace(/^\+?1[\s.-]?/, "").replace(/\D/g, "");
  profile.linkedin = text.match(/(?:https?:\/\/)?(?:www\.)?linkedin\.com\/in\/[\w-]+\/?/i)?.[0] ?? "";
  profile.github = text.match(/(?:https?:\/\/)?(?:www\.)?github\.com\/[\w-]+\/?/i)?.[0] ?? "";
  const site = text.match(/(?:https?:\/\/)?(?:www\.)?[\w-]+\.(?:dev|io|me|com|app|xyz|tech)(?:\/[\w-]*)?/gi) ?? [];
  profile.website = site.find((s) => !/linkedin|github|gmail|yahoo|outlook|icloud|edu|greenhouse/i.test(s)) ?? "";
  if (profile.linkedin && !profile.linkedin.startsWith("http")) profile.linkedin = "https://" + profile.linkedin;
  if (profile.github && !profile.github.startsWith("http")) profile.github = "https://" + profile.github;

  // Location: "City, ST" or "City, ST 12345" in the header.
  const headerText = sections.header.join(" | ");
  const loc = headerText.match(/([A-Z][a-zA-Z.\s]+),\s*([A-Z]{2})(?:\s+(\d{5}))?/);
  if (loc) {
    profile.city = loc[1].trim();
    profile.state = loc[2];
    profile.zip = loc[3] ?? "";
  }

  profile.summary = (sections.summary ?? []).join(" ").slice(0, 600);
  profile.education = parseEducation(sections.education ?? []);
  profile.experience = [
    ...parseExperience(sections.experience ?? []),
    ...parseExperience(sections.projects ?? [], true),
  ].slice(0, 8);

  const listed = parseSkillsSection(sections.skills ?? []);
  const detected = extractSkills(text);
  profile.skills = Array.from(new Set([...detected, ...listed])).slice(0, 60);

  const edu = profile.education[0];
  if (edu) {
    if (/phd/i.test(edu.degree)) profile.degreeLevel = "PhD";
    else if (/master/i.test(edu.degree)) profile.degreeLevel = "Master's";
    else if (/associate/i.test(edu.degree)) profile.degreeLevel = "Associate";
    else if (/high school/i.test(edu.degree)) profile.degreeLevel = "High School";
    else profile.degreeLevel = "Bachelor's";
    profile.gradMonthYear = toMonthYear(edu.endDate);
  }
  return profile;
}

const MONTHS: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};

export function toMonthYear(s: string): string {
  if (!s) return "";
  const m = s.match(new RegExp(`(${MONTH})\\s+(\\d{4})`, "i"));
  if (m) return `${MONTHS[m[1].slice(0, 3).toLowerCase()] ?? "06"}/${m[2]}`;
  const slash = s.match(/(\d{1,2})\/(\d{4})/);
  if (slash) return `${slash[1].padStart(2, "0")}/${slash[2]}`;
  const year = s.match(/\d{4}/);
  if (year) return `06/${year[0]}`;
  return "";
}
