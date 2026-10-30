"use client";

import { scoreColor, scoreTint } from "@/lib/match";

interface Props {
  score: number;
  size?: "sm" | "lg";
  label?: string;
  muted?: boolean;
}

export default function ScoreBar({ score, size = "sm", label, muted }: Props) {
  const color = muted ? "var(--line-strong)" : scoreColor(score);
  const tint = muted ? "var(--surface-2)" : scoreTint(score);
  const height = size === "lg" ? 10 : 6;
  return (
    <div className="w-full">
      <div className="flex items-center justify-between mb-1.5">
        <span className={`${size === "lg" ? "text-sm" : "text-xs"} text-muted`}>{label ?? "Resume match"}</span>
        <span
          className={`${size === "lg" ? "text-lg" : "text-sm"} font-semibold tabular-nums`}
          style={{ color: muted ? "var(--muted)" : color }}
        >
          {muted ? "—" : `${score}%`}
        </span>
      </div>
      <div className="w-full rounded-full overflow-hidden" style={{ height, background: tint }}>
        <div
          className="h-full rounded-full transition-[width] duration-500 ease-out"
          style={{ width: `${muted ? 0 : score}%`, background: color }}
        />
      </div>
    </div>
  );
}
