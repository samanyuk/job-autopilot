"use client";

import ScoreBar from "./ScoreBar";
import { ATS_LABEL, ageLabel } from "@/lib/jobs";
import type { Job, JobStatus } from "@/lib/types";

interface Props {
  job: Job;
  score: number | null;
  status?: JobStatus;
  onOpen: (job: Job) => void;
}

export default function JobCard({ job, score, status, onOpen }: Props) {
  const initials = job.company
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
  return (
    <button
      onClick={() => onOpen(job)}
      className={`card card-hover text-left p-4 flex flex-col gap-3 w-full ${status ? "opacity-60" : ""}`}
    >
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl bg-ink text-accent-ink grid place-items-center text-xs font-semibold shrink-0">
          {initials}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium truncate">{job.company}</p>
            {status && <span className="tag capitalize">{status}</span>}
          </div>
          <p className="text-[15px] leading-snug font-semibold mt-0.5 line-clamp-2">{job.title}</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5 text-xs text-ink-2">
        <span className="tag">{job.locations.slice(0, 2).join(" · ") || "Location n/a"}{job.locations.length > 2 ? ` +${job.locations.length - 2}` : ""}</span>
        <span className="tag">{ATS_LABEL[job.ats]}</span>
        <span className="tag">{job.category}</span>
      </div>

      <div className="mt-auto flex items-end gap-4">
        <div className="flex-1">
          <ScoreBar score={score ?? 0} muted={score === null} />
        </div>
        <span className="text-xs text-muted whitespace-nowrap pb-0.5">{ageLabel(job)}</span>
      </div>
    </button>
  );
}
