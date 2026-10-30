"use client";

import { useEffect } from "react";
import ScoreBar from "./ScoreBar";
import { ATS_LABEL, ageLabel } from "@/lib/jobs";
import { qualificationsFrom, scoreColor } from "@/lib/match";
import type { Job, JobDescription, JobStatus, ScoreBreakdown } from "@/lib/types";

interface Props {
  job: Job;
  description: JobDescription | null | undefined; // undefined = loading
  score: ScoreBreakdown | null;
  status?: JobStatus;
  hasProfile: boolean;
  extensionConnected: boolean;
  applying: boolean;
  onClose: () => void;
  onApply: (job: Job) => void;
  onSkip: (job: Job) => void;
  onUnmark: (job: Job) => void;
}

export default function JobDetail({
  job, description, score, status, hasProfile, extensionConnected, applying, onClose, onApply, onSkip, onUnmark,
}: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const quals = description?.text ? qualificationsFrom(description.text) : [];
  const loading = description === undefined;

  return (
    <div className="fixed inset-0 z-40 flex items-end sm:items-center justify-center p-0 sm:p-6" onClick={onClose}>
      <div className="absolute inset-0 bg-black/20 backdrop-blur-[2px]" />
      <div
        className="relative card w-full max-w-2xl max-h-[92vh] overflow-y-auto scrollbar-thin fade-up rounded-b-none sm:rounded-b-[var(--radius)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-6 sm:p-8">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm text-ink-2">{job.company}</p>
              <h2 className="text-2xl font-semibold tracking-tight leading-tight mt-1">{job.title}</h2>
              <div className="flex flex-wrap gap-1.5 mt-3">
                <span className="tag">{job.locations.join(" · ") || "Location n/a"}</span>
                <span className="tag">{ATS_LABEL[job.ats]}</span>
                <span className="tag">{job.category}</span>
                <span className="tag">Posted {ageLabel(job)}</span>
                {job.degrees.length > 0 && <span className="tag">{job.degrees.join(" / ")}</span>}
              </div>
            </div>
            <button className="btn btn-subtle !px-3" onClick={onClose} aria-label="Close">
              ✕
            </button>
          </div>

          <div className="mt-6">
            <ScoreBar score={score?.total ?? 0} muted={!score} size="lg" label={hasProfile ? "Resume match" : "Upload a resume to see your match"} />
            {score && (
              <div className="grid grid-cols-4 gap-2 mt-3">
                {[
                  ["Skills", score.skills, 45],
                  ["Role fit", score.role, 25],
                  ["Education", score.education, 15],
                  ["Location", score.location, 15],
                ].map(([k, v, max]) => (
                  <div key={k as string} className="rounded-xl bg-surface-2 px-3 py-2">
                    <p className="text-[11px] uppercase tracking-wide text-muted">{k}</p>
                    <p className="text-sm font-semibold tabular-nums" style={{ color: scoreColor(((v as number) / (max as number)) * 100) }}>
                      {v}<span className="text-muted font-normal">/{max}</span>
                    </p>
                  </div>
                ))}
              </div>
            )}
            {score && !score.hasDescription && !loading && (
              <p className="text-xs text-muted mt-2">Scored from the title only — this posting&apos;s description couldn&apos;t be fetched.</p>
            )}
          </div>

          {score && (score.matchedSkills.length > 0 || score.missingSkills.length > 0) && (
            <div className="mt-5 grid sm:grid-cols-2 gap-4">
              <div>
                <span className="label">You have</span>
                <div className="flex flex-wrap gap-1.5">
                  {score.matchedSkills.length === 0 && <span className="text-sm text-muted">Nothing matched yet</span>}
                  {score.matchedSkills.map((s) => (
                    <span key={s} className="tag" style={{ background: "hsl(120 45% 93%)", color: "hsl(140 50% 25%)" }}>{s}</span>
                  ))}
                </div>
              </div>
              <div>
                <span className="label">They also want</span>
                <div className="flex flex-wrap gap-1.5">
                  {score.missingSkills.length === 0 && <span className="text-sm text-muted">You cover everything we detected</span>}
                  {score.missingSkills.map((s) => (
                    <span key={s} className="tag" style={{ background: "hsl(0 60% 95%)", color: "hsl(0 55% 35%)" }}>{s}</span>
                  ))}
                </div>
              </div>
            </div>
          )}

          <div className="mt-6">
            <span className="label">Qualifications</span>
            {loading && (
              <div className="flex flex-col gap-2">
                <div className="skeleton h-4 w-full" />
                <div className="skeleton h-4 w-11/12" />
                <div className="skeleton h-4 w-4/5" />
              </div>
            )}
            {!loading && quals.length > 0 && (
              <ul className="text-sm text-ink-2 leading-relaxed list-disc pl-5 space-y-1">
                {quals.map((q, i) => (
                  <li key={i}>{q}</li>
                ))}
              </ul>
            )}
            {!loading && quals.length === 0 && (
              <p className="text-sm text-muted">
                Couldn&apos;t read this posting&apos;s requirements automatically. Open the posting to read them, then come back and apply.
              </p>
            )}
          </div>

          <div className="mt-8 flex flex-wrap items-center gap-3">
            {status ? (
              <>
                <span className="text-sm text-ink-2">
                  Marked as <strong className="capitalize">{status}</strong>.
                </span>
                <button className="btn btn-ghost" onClick={() => onUnmark(job)}>Undo</button>
                <a className="btn btn-subtle" href={job.url} target="_blank" rel="noreferrer">Open posting ↗</a>
              </>
            ) : (
              <>
                <button className="btn btn-primary" onClick={() => onApply(job)} disabled={!hasProfile || applying}>
                  {applying ? "Opening…" : extensionConnected ? "Yes, apply & autofill" : "Yes, open application"}
                </button>
                <button className="btn btn-ghost" onClick={() => onSkip(job)}>Skip</button>
                <a className="text-sm text-link underline underline-offset-4 ml-auto" href={job.url} target="_blank" rel="noreferrer">
                  Open posting without autofill ↗
                </a>
              </>
            )}
          </div>

          <p className="text-xs text-muted mt-4 leading-relaxed">
            {extensionConnected
              ? "Autopilot opens the application in a new tab and fills it from your profile. It stops before any demographic (EEO/disability) questions and never clicks Submit — you review and submit."
              : hasProfile
                ? "The Chrome extension isn't connected, so this will open the application without autofill. Load the extension to enable it."
                : "Upload your resume in the Profile tab to enable applying."}
          </p>
        </div>
      </div>
    </div>
  );
}
