import { NextRequest, NextResponse } from "next/server";
import { detectAts } from "@/lib/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)));
}

function htmlToText(html: string): string {
  const noScripts = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ");
  const withBreaks = noScripts
    .replace(/<\/(p|div|li|h[1-6]|tr|br|section|ul|ol)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ");
  const stripped = withBreaks.replace(/<[^>]+>/g, " ");
  return decodeEntities(stripped)
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" }, cache: "no-store" });
  if (!res.ok) throw new Error(`${res.status} from ${url}`);
  return res.json();
}

async function getHtml(url: string): Promise<string> {
  const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "text/html" }, cache: "no-store" });
  if (!res.ok) throw new Error(`${res.status} from ${url}`);
  return res.text();
}

async function workday(url: URL): Promise<string> {
  // https://{tenant}.wd5.myworkdayjobs.com/[locale/]{site}/job/{location}/{slug}
  const tenant = url.hostname.split(".")[0];
  const parts = url.pathname.split("/").filter(Boolean);
  const jobIdx = parts.indexOf("job");
  if (jobIdx < 1) throw new Error("Unrecognised Workday URL");
  const site = parts[jobIdx - 1];
  const rest = parts.slice(jobIdx + 1).join("/");
  const api = `${url.origin}/wday/cxs/${tenant}/${site}/job/${rest}`;
  const data = (await getJson(api)) as { jobPostingInfo?: { jobDescription?: string; title?: string } };
  const html = data.jobPostingInfo?.jobDescription;
  if (!html) throw new Error("No description in Workday response");
  return htmlToText(html);
}

async function greenhouse(url: URL): Promise<string> {
  const parts = url.pathname.split("/").filter(Boolean);
  const board = parts[0];
  const id = parts[parts.indexOf("jobs") + 1];
  if (!board || !id) throw new Error("Unrecognised Greenhouse URL");
  const data = (await getJson(`https://boards-api.greenhouse.io/v1/boards/${board}/jobs/${id}`)) as { content?: string };
  if (!data.content) throw new Error("No content in Greenhouse response");
  return htmlToText(decodeEntities(data.content));
}

async function lever(url: URL): Promise<string> {
  const [company, id] = url.pathname.split("/").filter(Boolean);
  const data = (await getJson(`https://api.lever.co/v0/postings/${company}/${id}`)) as {
    descriptionPlain?: string;
    lists?: { text: string; content: string }[];
    additionalPlain?: string;
  };
  const lists = (data.lists ?? []).map((l) => `${l.text}\n${htmlToText(l.content)}`).join("\n");
  return [data.descriptionPlain, lists, data.additionalPlain].filter(Boolean).join("\n\n");
}

async function ashby(url: URL): Promise<string> {
  const [org, id] = url.pathname.split("/").filter(Boolean);
  try {
    const data = (await getJson(`https://api.ashbyhq.com/posting-api/job-board/${org}`)) as {
      jobs?: { id: string; descriptionPlain?: string; descriptionHtml?: string }[];
    };
    const job = data.jobs?.find((j) => j.id === id);
    if (job) return job.descriptionPlain ?? htmlToText(job.descriptionHtml ?? "");
  } catch {
    // Fall through to HTML scrape.
  }
  const html = await getHtml(`https://jobs.ashbyhq.com/${org}/${id}`);
  const m = html.match(/window\.__appData\s*=\s*(\{[\s\S]*?\});\s*<\/script>/);
  if (m) {
    try {
      const appData = JSON.parse(m[1]) as { posting?: { descriptionHtml?: string } };
      if (appData.posting?.descriptionHtml) return htmlToText(appData.posting.descriptionHtml);
    } catch {
      // ignore
    }
  }
  return htmlToText(html);
}

async function generic(url: URL): Promise<string> {
  const html = await getHtml(url.toString());
  // Prefer JSON-LD JobPosting if the page has one.
  const ld = html.match(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi) ?? [];
  for (const block of ld) {
    try {
      const json = JSON.parse(block.replace(/<[^>]+>/g, "")) as { "@type"?: string; description?: string } | unknown[];
      const items = Array.isArray(json) ? json : [json];
      for (const item of items as { "@type"?: string; description?: string }[]) {
        if (item["@type"] === "JobPosting" && item.description) return htmlToText(item.description);
      }
    } catch {
      // ignore malformed JSON-LD
    }
  }
  const body = html.match(/<body[\s\S]*<\/body>/i)?.[0] ?? html;
  return htmlToText(body);
}

export async function GET(req: NextRequest) {
  const target = req.nextUrl.searchParams.get("url");
  if (!target) return NextResponse.json({ error: "url required" }, { status: 400 });
  let url: URL;
  try {
    url = new URL(target);
  } catch {
    return NextResponse.json({ error: "bad url" }, { status: 400 });
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return NextResponse.json({ error: "bad url" }, { status: 400 });
  }

  const ats = detectAts(target);
  const strategies: (() => Promise<string>)[] = [];
  if (ats === "workday") strategies.push(() => workday(url));
  if (ats === "greenhouse") strategies.push(() => greenhouse(url));
  if (ats === "lever") strategies.push(() => lever(url));
  if (ats === "ashby") strategies.push(() => ashby(url));
  strategies.push(() => generic(url));

  const errors: string[] = [];
  for (const run of strategies) {
    try {
      const text = (await run()).slice(0, 12000);
      if (text.length > 200) {
        return NextResponse.json(
          { url: target, text, source: ats, fetchedAt: Date.now() },
          { headers: { "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=86400" } },
        );
      }
      errors.push("Description too short");
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }
  return NextResponse.json({ url: target, text: "", source: ats, errors }, { status: 200 });
}
