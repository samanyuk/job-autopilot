import { DEFAULT_SETTINGS, type JobDescription, type JobStatusEntry, type Profile, type ResumeFile, type Settings } from "./types";

const KEYS = {
  profile: "autopilot.profile",
  resume: "autopilot.resume",
  statuses: "autopilot.statuses",
  descriptions: "autopilot.descriptions",
  filters: "autopilot.filters",
  settings: "autopilot.settings",
};

function read<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch (err) {
    console.warn("localStorage write failed", err);
  }
}

export const storage = {
  getProfile: () => {
    const p = read<Profile | null>(KEYS.profile, null);
    if (p && !p.eeo) p.eeo = { gender: "", hispanic: "", race: "", veteran: "", disability: "" };
    return p;
  },
  getSettings: () => ({ ...DEFAULT_SETTINGS, ...read<Partial<Settings>>(KEYS.settings, {}) }),
  setSettings: (s: Settings) => write(KEYS.settings, s),
  setProfile: (p: Profile | null) => write(KEYS.profile, p),
  getResume: () => read<ResumeFile | null>(KEYS.resume, null),
  setResume: (r: ResumeFile | null) => write(KEYS.resume, r),
  getStatuses: () => read<Record<string, JobStatusEntry>>(KEYS.statuses, {}),
  setStatuses: (s: Record<string, JobStatusEntry>) => write(KEYS.statuses, s),
  getDescriptions: () => read<Record<string, JobDescription>>(KEYS.descriptions, {}),
  setDescriptions: (d: Record<string, JobDescription>) => {
    // Keep the cache bounded so localStorage doesn't fill up.
    const entries = Object.entries(d).sort((a, b) => b[1].fetchedAt - a[1].fetchedAt).slice(0, 150);
    write(KEYS.descriptions, Object.fromEntries(entries));
  },
  getFilters: <T>(fallback: T) => read<T>(KEYS.filters, fallback),
  setFilters: (f: unknown) => write(KEYS.filters, f),
};
