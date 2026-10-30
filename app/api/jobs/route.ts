import { NextResponse } from "next/server";
import { detectAts } from "@/lib/jobs";
import type { Job } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// The SimplifyJobs repo keeps a structured copy of every README row here.
const LISTINGS_URL =
  "https://raw.githubusercontent.com/SimplifyJobs/Summer2027-Internships/dev/.github/scripts/listings.json";

interface RawListing {
  id: string;
  company_name: string;
  title: string;
  url: string;
  company_url?: string;
  locations?: string[];
  category?: string;
  degrees?: string[];
  terms?: string[];
  sponsorship?: string;
  date_posted: number;
  date_updated?: number;
  active: boolean;
  is_visible: boolean;
}

interface CacheEntry {
  at: number;
  jobs: Job[];
}

// Module-level cache survives between invocations on a warm serverless instance.
let cache: CacheEntry | null = null;
const TTL_MS = 30 * 60 * 1000;

function normalizeCategory(c: string): string {
  if (/software/i.test(c)) return "Software";
  if (/data|ai|machine/i.test(c)) return "AI/ML/Data";
  if (/hardware/i.test(c)) return "Hardware";
  if (/product/i.test(c)) return "Product";
  if (/quant/i.test(c)) return "Quant";
  return c || "Other";
}

async function loadJobs(): Promise<Job[]> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.jobs;

  const res = await fetch(LISTINGS_URL, { cache: "no-store" });
  if (!res.ok) {
    if (cache) return cache.jobs;
    throw new Error(`Upstream fetch failed: ${res.status}`);
  }
  const raw = (await res.json()) as RawListing[];

  const jobs: Job[] = raw
    .filter((r) => r.active && r.is_visible && (r.terms ?? []).includes("Summer 2027"))
    .map((r) => ({
      id: r.id,
      company: r.company_name,
      title: r.title,
      url: r.url,
      companyUrl: r.company_url ?? "",
      locations: r.locations ?? [],
      category: normalizeCategory(r.category ?? ""),
      degrees: r.degrees ?? [],
      terms: r.terms ?? [],
      sponsorship: r.sponsorship ?? "",
      postedAt: r.date_posted,
      updatedAt: r.date_updated ?? r.date_posted,
      ats: detectAts(r.url),
    }))
    .sort((a, b) => b.postedAt - a.postedAt);

  cache = { at: Date.now(), jobs };
  return jobs;
}

export async function GET() {
  try {
    const jobs = await loadJobs();
    return NextResponse.json(
      { jobs, fetchedAt: cache?.at ?? Date.now(), count: jobs.length },
      {
        headers: {
          // Let Vercel's edge cache serve this for 30 minutes.
          "Cache-Control": "public, s-maxage=1800, stale-while-revalidate=3600",
        },
      },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
