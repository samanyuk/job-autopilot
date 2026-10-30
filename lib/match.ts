import { isRemote, stateOf } from "./jobs";
import { extractSkills } from "./skills";
import type { Job, Profile, ScoreBreakdown } from "./types";

// Title keywords → skills a job like that usually wants. Used when we have no
// description (the list view) and as a floor when we do.
const TITLE_HINTS: [RegExp, string[]][] = [
  [/machine learning|\bml\b|\bai\b|deep learning/i, ["Python", "PyTorch", "TensorFlow", "Machine Learning", "Deep Learning"]],
  [/data scien|analytics|data analyst/i, ["Python", "SQL", "Pandas", "Statistics", "Data Science"]],
  [/data engineer/i, ["Python", "SQL", "Spark", "Data Engineering", "AWS"]],
  [/front[- ]?end|\bui\b|web developer/i, ["JavaScript", "TypeScript", "React", "HTML/CSS"]],
  [/back[- ]?end|platform|infrastructure|cloud|devops|site reliability|\bsre\b/i, ["Python", "Java", "Go", "AWS", "Docker", "Kubernetes", "Linux"]],
  [/full[- ]?stack/i, ["JavaScript", "TypeScript", "React", "Node.js", "SQL"]],
  [/mobile|ios|android/i, ["Swift", "Kotlin", "React Native", "Mobile Development"]],
  [/embedded|firmware/i, ["C", "C++", "Embedded Systems", "Linux"]],
  [/hardware|electrical|fpga|asic|rtl|verification|silicon|circuit|analog|\bpcb\b|chip|semiconductor|\bvlsi\b|mechanical/i, ["Verilog", "C", "C++", "Circuit Design"]],
  [/robot|autonom|perception|vehicle/i, ["C++", "Python", "Robotics", "Computer Vision", "Autonomous Vehicles"]],
  [/security|cyber/i, ["Python", "Linux", "Cybersecurity", "Networking"]],
  [/product manag|\bpm\b/i, ["Product Management", "SQL", "Figma", "Agile"]],
  [/quant|trading|research/i, ["Python", "C++", "Statistics", "Quantitative"]],
  [/game/i, ["C++", "C#", "Game Development"]],
  [/software|swe|developer|engineer/i, ["Python", "Java", "C++", "Data Structures & Algorithms", "Git"]],
];

// Resume signals for each job category in the listings feed.
const CATEGORY_SIGNALS: Record<string, RegExp> = {
  Software: /software|developer|engineer|programming|react|python|java|web|app/i,
  "AI/ML/Data": /machine learning|\bml\b|\bai\b|data|pytorch|tensorflow|model|neural|research|statistics/i,
  Hardware: /hardware|circuit|verilog|fpga|embedded|electrical|pcb|firmware|robot/i,
  Product: /product|roadmap|user research|figma|stakeholder|design/i,
  Quant: /quant|trading|finance|statistics|probability|stochastic|math/i,
};

function clamp(n: number, lo = 0, hi = 100) {
  return Math.max(lo, Math.min(hi, n));
}

export function scoreJob(job: Job, profile: Profile | null, description?: string | null): ScoreBreakdown {
  if (!profile) {
    return { total: 0, skills: 0, role: 0, education: 0, location: 0, matchedSkills: [], missingSkills: [], hasDescription: false };
  }
  const resumeSkills = new Set(profile.skills.map((s) => s.toLowerCase()));
  const resumeText = `${profile.rawText}\n${profile.skills.join(" ")}`;

  // --- Required skills ---
  let wanted: string[] = [];
  const hasDescription = !!description && description.length > 100;
  if (hasDescription) {
    wanted = extractSkills(description as string);
  }
  if (wanted.length < 3) {
    for (const [re, hints] of TITLE_HINTS) {
      if (re.test(job.title)) {
        wanted = Array.from(new Set([...wanted, ...hints]));
        break;
      }
    }
  }
  const matched = wanted.filter((w) => resumeSkills.has(w.toLowerCase()));
  const missing = wanted.filter((w) => !resumeSkills.has(w.toLowerCase()));
  let skills: number;
  if (wanted.length === 0) {
    skills = 15; // nothing to compare against — stay neutral
  } else {
    // Diminishing returns: a description listing 25 skills shouldn't tank you.
    const ratio = matched.length / Math.min(wanted.length, 12);
    skills = clamp(Math.round(Math.sqrt(Math.min(ratio, 1)) * 45));
  }

  // --- Role fit ---
  let role = 10;
  const signal = CATEGORY_SIGNALS[job.category];
  if (signal) {
    const hits = (resumeText.match(new RegExp(signal.source, "gi")) ?? []).length;
    role = clamp(Math.round(Math.min(hits, 12) / 12 * 20), 0, 20);
  }
  const titleWords = job.title.toLowerCase().match(/[a-z]{4,}/g) ?? [];
  const titleHits = titleWords.filter((w) => !["intern", "internship", "summer", "engineer", "engineering"].includes(w) && resumeText.toLowerCase().includes(w)).length;
  role = clamp(role + Math.min(titleHits, 3) * 2, 0, 25);
  if (/senior|staff|principal|lead|manager|director/i.test(job.title) && !/intern/i.test(job.title)) role = Math.round(role * 0.3);

  // --- Education ---
  let education = 10;
  const rank: Record<string, number> = { "High School": 0, Associate: 1, "Bachelor's": 2, "Master's": 3, PhD: 4 };
  const mine = rank[profile.degreeLevel] ?? 2;
  if (job.degrees.length) {
    const accepted = job.degrees.map((d) => rank[d] ?? 2);
    if (accepted.includes(mine)) education = 15;
    else if (accepted.some((a) => a > mine)) education = 6;
    else education = 12;
  }

  // --- Location ---
  let location = 9;
  const myState = profile.state.toUpperCase();
  if (isRemote(job)) location = 15;
  else if (myState) {
    const states = job.locations.map(stateOf).filter(Boolean);
    if (states.includes(myState)) location = 15;
    else if (states.length && profile.relocate === "yes") location = 11;
    else if (states.length) location = 6;
  }

  const total = clamp(Math.round(skills + role + education + location));
  return { total, skills, role, education, location, matchedSkills: matched, missingSkills: missing, hasDescription };
}

/** Red → amber → green, as an HSL hue. */
export function scoreColor(score: number): string {
  const hue = Math.round((clamp(score) / 100) * 120); // 0 = red, 120 = green
  return `hsl(${hue} 70% 42%)`;
}

export function scoreTint(score: number): string {
  const hue = Math.round((clamp(score) / 100) * 120);
  return `hsl(${hue} 70% 94%)`;
}

/** Pull the lines of a description that read like requirements. */
export function qualificationsFrom(description: string, max = 8): string[] {
  const lines = description
    .split(/\n|(?<=\.)\s+(?=[A-Z•])/)
    .map((l) => l.replace(/^•\s*/, "").trim())
    .filter((l) => l.length > 25 && l.length < 260);
  const keyed = lines.filter((l) =>
    /\b(pursuing|enrolled|currently|degree|bachelor|master|phd|experience with|experience in|proficien|familiar|knowledge of|strong|ability to|must|required|require|minimum|qualif|skills? in|understanding of|coursework|graduat|gpa|years?)\b/i.test(l),
  );
  const chosen = keyed.length >= 3 ? keyed : lines;
  return chosen.slice(0, max);
}
