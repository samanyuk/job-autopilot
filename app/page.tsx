"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import FilterPanel, { DEFAULT_FILTERS, type Filters } from "@/components/FilterPanel";
import JobCard from "@/components/JobCard";
import JobDetail from "@/components/JobDetail";
import ProfilePanel from "@/components/ProfilePanel";
import { applyViaExtension, onExtensionResult, pingExtension, syncProfileToExtension } from "@/lib/extensionBridge";
import { ageDays, ageLabel, isRemote } from "@/lib/jobs";
import { scoreJob } from "@/lib/match";
import { storage } from "@/lib/storage";
import { DEFAULT_SETTINGS, type Ats, type Job, type JobDescription, type JobStatus, type JobStatusEntry, type Profile, type ResumeFile, type Settings } from "@/lib/types";

type View = "jobs" | "profile" | "applied";

export default function Dashboard() {
  const [view, setView] = useState<View>("jobs");
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [fetchedAt, setFetchedAt] = useState<number | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [resume, setResume] = useState<ResumeFile | null>(null);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [statuses, setStatuses] = useState<Record<string, JobStatusEntry>>({});
  const [descriptions, setDescriptions] = useState<Record<string, JobDescription>>({});
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [selected, setSelected] = useState<Job | null>(null);
  const [extVersion, setExtVersion] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [visible, setVisible] = useState(60);
  const inflight = useRef<Set<string>>(new Set());

  // ---- hydrate from localStorage ----
  useEffect(() => {
    setProfile(storage.getProfile());
    setResume(storage.getResume());
    setSettings(storage.getSettings());
    setStatuses(storage.getStatuses());
    setDescriptions(storage.getDescriptions());
    setFilters(storage.getFilters(DEFAULT_FILTERS));
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (hydrated) storage.setFilters(filters);
  }, [filters, hydrated]);

  // ---- detect extension ----
  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      const v = await pingExtension();
      if (!cancelled) setExtVersion(v);
    };
    check();
    const t = setInterval(check, 5000);
    return () => { cancelled = true; clearInterval(t); };
  }, []);

  useEffect(() => {
    if (extVersion && hydrated) syncProfileToExtension(profile, resume, settings);
  }, [extVersion, profile, resume, settings, hydrated]);

  // ---- outcomes reported by the extension (e.g. submitted) ----
  useEffect(() => {
    return onExtensionResult((jobId, status) => {
      setStatuses((prev) => {
        const existing = prev[jobId];
        if (!existing) return prev;
        const next = { ...prev, [jobId]: { ...existing, status, at: Date.now() } };
        storage.setStatuses(next);
        return next;
      });
    });
  }, []);

  // ---- load jobs ----
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/jobs");
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Failed to load jobs");
        if (!cancelled) {
          setJobs(data.jobs);
          setFetchedAt(data.fetchedAt);
        }
      } catch (err) {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // ---- description fetching (lazy, for the open card) ----
  const ensureDescription = useCallback(async (job: Job) => {
    if (descriptions[job.id] || inflight.current.has(job.id)) return;
    inflight.current.add(job.id);
    try {
      const res = await fetch(`/api/describe?url=${encodeURIComponent(job.url)}`);
      const data = (await res.json()) as JobDescription;
      setDescriptions((prev) => {
        const next = { ...prev, [job.id]: { url: job.url, text: data.text ?? "", source: data.source ?? "", fetchedAt: Date.now() } };
        storage.setDescriptions(next);
        return next;
      });
    } catch {
      setDescriptions((prev) => ({ ...prev, [job.id]: { url: job.url, text: "", source: "", fetchedAt: Date.now() } }));
    } finally {
      inflight.current.delete(job.id);
    }
  }, [descriptions]);

  useEffect(() => {
    if (selected) ensureDescription(selected);
  }, [selected, ensureDescription]);

  // ---- scoring ----
  const scores = useMemo(() => {
    const map = new Map<string, number>();
    if (!profile) return map;
    for (const j of jobs) map.set(j.id, scoreJob(j, profile, descriptions[j.id]?.text).total);
    return map;
  }, [jobs, profile, descriptions]);

  const selectedScore = useMemo(
    () => (selected && profile ? scoreJob(selected, profile, descriptions[selected.id]?.text) : null),
    [selected, profile, descriptions],
  );

  // ---- filtering ----
  const categories = useMemo(() => Array.from(new Set(jobs.map((j) => j.category))).sort(), [jobs]);
  const atsCounts = useMemo(() => {
    const c: Partial<Record<Ats, number>> = {};
    for (const j of jobs) c[j.ats] = (c[j.ats] ?? 0) + 1;
    return c;
  }, [jobs]);

  const filtered = useMemo(() => {
    const q = filters.query.trim().toLowerCase();
    const loc = filters.location.trim().toLowerCase();
    const list = jobs.filter((j) => {
      if (filters.maxAgeDays !== null && ageDays(j) > filters.maxAgeDays) return false;
      if (filters.hideDone && statuses[j.id]) return false;
      if (filters.categories.length && !filters.categories.includes(j.category)) return false;
      if (filters.ats.length && !filters.ats.includes(j.ats)) return false;
      if (filters.remoteOnly && !isRemote(j)) return false;
      if (loc && !j.locations.some((l) => l.toLowerCase().includes(loc))) return false;
      if (q && !(j.company.toLowerCase().includes(q) || j.title.toLowerCase().includes(q))) return false;
      if (profile && filters.minScore > 0 && (scores.get(j.id) ?? 0) < filters.minScore) return false;
      return true;
    });
    if (filters.sort === "match" && profile) {
      list.sort((a, b) => (scores.get(b.id) ?? 0) - (scores.get(a.id) ?? 0) || b.postedAt - a.postedAt);
    }
    return list;
  }, [jobs, filters, statuses, profile, scores]);

  useEffect(() => { setVisible(60); }, [filters]);

  // ---- actions ----
  const mark = (job: Job, status: JobStatus) => {
    setStatuses((prev) => {
      const next = { ...prev, [job.id]: { status, at: Date.now(), jobId: job.id, company: job.company, title: job.title, url: job.url } };
      storage.setStatuses(next);
      return next;
    });
  };
  const unmark = (job: Job) => {
    setStatuses((prev) => {
      const next = { ...prev };
      delete next[job.id];
      storage.setStatuses(next);
      return next;
    });
  };

  const onApply = async (job: Job) => {
    if (!profile) return;
    setApplying(true);
    const handled = await applyViaExtension(job, profile, resume, settings);
    if (!handled) window.open(job.url, "_blank", "noopener");
    mark(job, "applied");
    setApplying(false);
    setSelected(null);
  };

  const onProfileChange = (p: Profile | null, r: ResumeFile | null) => {
    setProfile(p);
    setResume(r);
    storage.setProfile(p);
    storage.setResume(r);
  };
  const onSettingsChange = (s: Settings) => {
    setSettings(s);
    storage.setSettings(s);
  };

  const appliedList = Object.values(statuses).sort((a, b) => b.at - a.at);
  const appliedCount = appliedList.filter((s) => s.status === "applied" || s.status === "submitted").length;

  return (
    <div className="min-h-screen">
      {/* ---- top bar ---- */}
      <header className="sticky top-0 z-30 backdrop-blur bg-bg/80 border-b border-line">
        <div className="max-w-7xl mx-auto px-5 h-14 flex items-center gap-6">
          <div className="flex items-center gap-2">
            <span className="w-7 h-7 rounded-lg bg-ink grid place-items-center">
              <span className="w-2.5 h-2.5 rounded-full bg-white" />
            </span>
            <span className="font-semibold tracking-tight">Autopilot</span>
          </div>
          <nav className="flex items-center gap-1 text-sm">
            {([
              ["jobs", "Jobs"],
              ["profile", "Profile"],
              ["applied", `Applied${appliedCount ? ` · ${appliedCount}` : ""}`],
            ] as [View, string][]).map(([v, label]) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={`px-3 py-1.5 rounded-full transition-colors ${view === v ? "bg-ink text-white" : "text-ink-2 hover:bg-surface-2"}`}
              >
                {label}
              </button>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3 text-xs">
            <span className="flex items-center gap-1.5 text-ink-2">
              <span className="w-2 h-2 rounded-full" style={{ background: extVersion ? "hsl(130 60% 45%)" : "var(--line-strong)" }} />
              {extVersion ? "Extension connected" : "Extension not detected"}
            </span>
            <span className="hidden sm:flex items-center gap-1.5 text-ink-2">
              <span className="w-2 h-2 rounded-full" style={{ background: profile ? "hsl(130 60% 45%)" : "var(--line-strong)" }} />
              {profile ? `${profile.firstName || "Profile"} loaded` : "No resume yet"}
            </span>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-5 py-8">
        {view === "jobs" && (
          <div className="grid lg:grid-cols-[250px_1fr] gap-8">
            <div className="lg:sticky lg:top-20 self-start">
              <FilterPanel filters={filters} onChange={setFilters} categories={categories} atsCounts={atsCounts} hasProfile={!!profile} />
            </div>
            <div>
              <div className="flex items-end justify-between mb-5 gap-4 flex-wrap">
                <div>
                  <h1 className="text-2xl font-semibold tracking-tight">Summer 2027 internships</h1>
                  <p className="text-sm text-muted mt-1">
                    {loading ? "Loading listings…" : `${filtered.length.toLocaleString()} of ${jobs.length.toLocaleString()} open roles`}
                    {fetchedAt && !loading && ` · feed refreshed ${ageLabel({ postedAt: Math.floor(fetchedAt / 1000) } as Job)}`}
                  </p>
                </div>
                {!profile && !loading && (
                  <button className="btn btn-primary" onClick={() => setView("profile")}>Upload resume to get match scores →</button>
                )}
              </div>

              {loadError && (
                <div className="card p-6 text-sm" style={{ color: "hsl(0 60% 40%)" }}>
                  Couldn&apos;t load listings: {loadError}. Refresh to try again.
                </div>
              )}

              {loading && (
                <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-4">
                  {Array.from({ length: 9 }).map((_, i) => (
                    <div key={i} className="card p-4 h-44 flex flex-col gap-3">
                      <div className="skeleton h-5 w-1/2" />
                      <div className="skeleton h-5 w-3/4" />
                      <div className="skeleton h-4 w-2/3 mt-auto" />
                    </div>
                  ))}
                </div>
              )}

              {!loading && !loadError && filtered.length === 0 && (
                <div className="card p-10 text-center">
                  <p className="font-medium">No roles match these filters.</p>
                  <p className="text-sm text-muted mt-1">Try widening the posting window or clearing a filter.</p>
                </div>
              )}

              {!loading && filtered.length > 0 && (
                <>
                  <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-4">
                    {filtered.slice(0, visible).map((j) => (
                      <JobCard key={j.id} job={j} score={profile ? (scores.get(j.id) ?? 0) : null} status={statuses[j.id]?.status} onOpen={setSelected} />
                    ))}
                  </div>
                  {visible < filtered.length && (
                    <div className="flex justify-center mt-8">
                      <button className="btn btn-ghost" onClick={() => setVisible((v) => v + 60)}>
                        Show more · {filtered.length - visible} left
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        )}

        {view === "profile" && (
          <div>
            <h1 className="text-2xl font-semibold tracking-tight mb-1">Your profile</h1>
            <p className="text-sm text-muted mb-6">Everything here stays in this browser. The extension reads it to fill applications.</p>
            <ProfilePanel profile={profile} resume={resume} settings={settings} onChange={onProfileChange} onSettingsChange={onSettingsChange} />
          </div>
        )}

        {view === "applied" && (
          <div className="max-w-3xl">
            <h1 className="text-2xl font-semibold tracking-tight mb-1">Applied &amp; skipped</h1>
            <p className="text-sm text-muted mb-6">
              <strong>Applied</strong> = opened with Autopilot; <strong>Submitted</strong> = the extension saw the confirmation page. Undo anything marked by mistake.
            </p>
            {appliedList.length === 0 && <div className="card p-10 text-center text-sm text-muted">Nothing yet — apply to something from the Jobs tab.</div>}
            <div className="flex flex-col gap-2">
              {appliedList.map((s) => (
                <div key={s.jobId} className="card px-4 py-3 flex items-center gap-4">
                  <span className="tag capitalize w-20 justify-center" style={s.status === "submitted" ? { background: "hsl(120 45% 93%)", color: "hsl(140 50% 25%)" } : undefined}>{s.status}</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{s.company} — {s.title}</p>
                    <p className="text-xs text-muted">{new Date(s.at).toLocaleString()}</p>
                  </div>
                  <a className="text-xs text-link underline underline-offset-4" href={s.url} target="_blank" rel="noreferrer">Open ↗</a>
                  <button className="text-xs text-muted hover:text-ink" onClick={() => unmark({ id: s.jobId } as Job)}>Undo</button>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>

      {selected && (
        <JobDetail
          job={selected}
          description={descriptions[selected.id]}
          score={selectedScore}
          status={statuses[selected.id]?.status}
          hasProfile={!!profile}
          extensionConnected={!!extVersion}
          applying={applying}
          onClose={() => setSelected(null)}
          onApply={onApply}
          onSkip={(j) => { mark(j, "skipped"); setSelected(null); }}
          onUnmark={unmark}
        />
      )}
    </div>
  );
}
