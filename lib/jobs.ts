import type { Ats, Job } from "./types";

export const ATS_LABEL: Record<Ats, string> = {
  workday: "Workday",
  greenhouse: "Greenhouse",
  lever: "Lever",
  ashby: "Ashby",
  smartrecruiters: "SmartRecruiters",
  icims: "iCIMS",
  oracle: "Oracle",
  amazon: "Amazon",
  other: "Other",
};

export function detectAts(url: string): Ats {
  const u = url.toLowerCase();
  if (u.includes("myworkdayjobs.com") || u.includes("myworkdaysite.com") || u.includes("workday")) return "workday";
  if (u.includes("greenhouse.io")) return "greenhouse";
  if (u.includes("lever.co")) return "lever";
  if (u.includes("ashbyhq.com")) return "ashby";
  if (u.includes("smartrecruiters.com")) return "smartrecruiters";
  if (u.includes("icims.com")) return "icims";
  if (u.includes("oraclecloud.com")) return "oracle";
  if (u.includes("amazon.jobs")) return "amazon";
  return "other";
}

export const AGE_OPTIONS: { label: string; days: number | null }[] = [
  { label: "24h", days: 1 },
  { label: "3d", days: 3 },
  { label: "1w", days: 7 },
  { label: "2w", days: 14 },
  { label: "30d", days: 30 },
  { label: "Any", days: null },
];

export function ageDays(job: Job, now = Date.now()): number {
  return (now / 1000 - job.postedAt) / 86400;
}

export function ageLabel(job: Job, now = Date.now()): string {
  const d = ageDays(job, now);
  if (d < 1 / 24) return "just now";
  if (d < 1) return `${Math.max(1, Math.round(d * 24))}h ago`;
  if (d < 30) return `${Math.round(d)}d ago`;
  if (d < 365) return `${Math.round(d / 30)}mo ago`;
  return `${Math.round(d / 365)}y ago`;
}

export function isRemote(job: Job): boolean {
  return job.locations.some((l) => /remote/i.test(l));
}

/** Extract a two-letter US state code from a location string, if any. */
export function stateOf(loc: string): string | null {
  const m = loc.match(/\b([A-Z]{2})\b\s*$/) || loc.match(/,\s*([A-Z]{2})\b/);
  if (m && US_STATES.has(m[1])) return m[1];
  const lower = loc.toLowerCase();
  for (const [name, code] of Object.entries(STATE_NAMES)) {
    if (lower.includes(name)) return code;
  }
  if (/\b(nyc|new york)\b/i.test(loc)) return "NY";
  if (/\b(sf|san francisco|bay area|silicon valley)\b/i.test(loc)) return "CA";
  return null;
}

const STATE_NAMES: Record<string, string> = {
  california: "CA", washington: "WA", "new york": "NY", texas: "TX", massachusetts: "MA",
  illinois: "IL", colorado: "CO", georgia: "GA", florida: "FL", virginia: "VA", arizona: "AZ",
  oregon: "OR", pennsylvania: "PA", "north carolina": "NC", michigan: "MI", ohio: "OH",
  minnesota: "MN", utah: "UT", nevada: "NV", maryland: "MD", "new jersey": "NJ", wisconsin: "WI",
  missouri: "MO", tennessee: "TN", indiana: "IN", connecticut: "CT",
};

const US_STATES = new Set([
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD",
  "MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC",
  "SD","TN","TX","UT","VT","VA","WA","WV","WI","WY","DC",
]);
