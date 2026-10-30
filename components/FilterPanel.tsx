"use client";

import { AGE_OPTIONS, ATS_LABEL } from "@/lib/jobs";
import type { Ats } from "@/lib/types";

export interface Filters {
  maxAgeDays: number | null;
  query: string;
  categories: string[];
  ats: Ats[];
  location: string;
  remoteOnly: boolean;
  hideDone: boolean;
  minScore: number;
  sort: "newest" | "match";
}

export const DEFAULT_FILTERS: Filters = {
  maxAgeDays: 7,
  query: "",
  categories: [],
  ats: [],
  location: "",
  remoteOnly: false,
  hideDone: true,
  minScore: 0,
  sort: "newest",
};

interface Props {
  filters: Filters;
  onChange: (f: Filters) => void;
  categories: string[];
  atsCounts: Partial<Record<Ats, number>>;
  hasProfile: boolean;
}

export default function FilterPanel({ filters, onChange, categories, atsCounts, hasProfile }: Props) {
  const set = <K extends keyof Filters>(k: K, v: Filters[K]) => onChange({ ...filters, [k]: v });
  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  return (
    <aside className="flex flex-col gap-6">
      <div>
        <span className="label">Search</span>
        <input
          className="input"
          placeholder="Company or role…"
          value={filters.query}
          onChange={(e) => set("query", e.target.value)}
        />
      </div>

      <div>
        <span className="label">Posted within</span>
        <div className="flex flex-wrap gap-1.5">
          {AGE_OPTIONS.map((o) => (
            <button
              key={o.label}
              className={`chip ${filters.maxAgeDays === o.days ? "chip-on" : ""}`}
              onClick={() => set("maxAgeDays", o.days)}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <span className="label">Sort</span>
        <div className="flex gap-1.5">
          <button className={`chip ${filters.sort === "newest" ? "chip-on" : ""}`} onClick={() => set("sort", "newest")}>
            Newest
          </button>
          <button
            className={`chip ${filters.sort === "match" ? "chip-on" : ""}`}
            onClick={() => set("sort", "match")}
            disabled={!hasProfile}
            title={hasProfile ? "" : "Upload a resume first"}
          >
            Best match
          </button>
        </div>
      </div>

      {hasProfile && (
        <div>
          <span className="label">Min match · {filters.minScore}%</span>
          <input
            type="range"
            min={0}
            max={90}
            step={5}
            value={filters.minScore}
            onChange={(e) => set("minScore", Number(e.target.value))}
            className="w-full accent-black"
          />
        </div>
      )}

      <div>
        <span className="label">Category</span>
        <div className="flex flex-wrap gap-1.5">
          {categories.map((c) => (
            <button
              key={c}
              className={`chip ${filters.categories.includes(c) ? "chip-on" : ""}`}
              onClick={() => set("categories", toggle(filters.categories, c))}
            >
              {c}
            </button>
          ))}
        </div>
      </div>

      <div>
        <span className="label">Location</span>
        <input
          className="input"
          placeholder="e.g. CA, Seattle, NYC"
          value={filters.location}
          onChange={(e) => set("location", e.target.value)}
        />
        <label className="flex items-center gap-2 mt-2 text-sm text-ink-2 cursor-pointer">
          <input type="checkbox" checked={filters.remoteOnly} onChange={(e) => set("remoteOnly", e.target.checked)} className="accent-black" />
          Remote only
        </label>
      </div>

      <div>
        <span className="label">Application system</span>
        <div className="flex flex-wrap gap-1.5">
          {(Object.keys(ATS_LABEL) as Ats[])
            .filter((a) => (atsCounts[a] ?? 0) > 0)
            .map((a) => (
              <button
                key={a}
                className={`chip ${filters.ats.includes(a) ? "chip-on" : ""}`}
                onClick={() => set("ats", toggle(filters.ats, a))}
              >
                {ATS_LABEL[a]} <span className="opacity-60 ml-1">{atsCounts[a]}</span>
              </button>
            ))}
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm text-ink-2 cursor-pointer">
        <input type="checkbox" checked={filters.hideDone} onChange={(e) => set("hideDone", e.target.checked)} className="accent-black" />
        Hide applied &amp; skipped
      </label>

      <button className="btn btn-ghost self-start" onClick={() => onChange(DEFAULT_FILTERS)}>
        Reset filters
      </button>
    </aside>
  );
}
