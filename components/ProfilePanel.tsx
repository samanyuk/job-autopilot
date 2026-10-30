"use client";

import { useRef, useState } from "react";
import { parseProfile } from "@/lib/resumeParser";
import { extractResumeText, fileToBase64 } from "@/lib/resumeText";
import type { Education, Eeo, Experience, Profile, ResumeFile, Settings } from "@/lib/types";

interface Props {
  profile: Profile | null;
  resume: ResumeFile | null;
  settings: Settings;
  onChange: (p: Profile | null, r: ResumeFile | null) => void;
  onSettingsChange: (s: Settings) => void;
}

function Choice<T extends string>({ label, value, options, onChange, hint }: {
  label: string; value: T; options: T[]; onChange: (v: T) => void; hint?: string;
}) {
  return (
    <div>
      <span className="label">{label}</span>
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => (
          <button key={o} className={`chip ${value === o ? "chip-on" : ""}`} onClick={() => onChange(o)}>{o}</button>
        ))}
      </div>
      {hint && <p className="text-xs text-muted mt-1.5">{hint}</p>}
    </div>
  );
}

function Field({ label, value, onChange, placeholder, type = "text", wide }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string; wide?: boolean;
}) {
  return (
    <div className={wide ? "sm:col-span-2" : ""}>
      <span className="label">{label}</span>
      <input className="input" type={type} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

function YesNo({ label, value, onChange }: { label: string; value: "yes" | "no" | ""; onChange: (v: "yes" | "no") => void }) {
  return (
    <div>
      <span className="label">{label}</span>
      <div className="flex gap-1.5">
        {(["yes", "no"] as const).map((v) => (
          <button key={v} className={`chip capitalize ${value === v ? "chip-on" : ""}`} onClick={() => onChange(v)}>{v}</button>
        ))}
      </div>
    </div>
  );
}

export default function ProfilePanel({ profile, resume, settings, onChange, onSettingsChange }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    setBusy(true);
    setError(null);
    try {
      if (file.size > 4 * 1024 * 1024) throw new Error("Resume is over 4 MB — please use a smaller file.");
      const text = await extractResumeText(file);
      if (text.trim().length < 80) throw new Error("Couldn't read much text from that file. If it's a scanned PDF, export a text-based one.");
      const parsed = parseProfile(text);
      // Keep screening answers the user already set.
      const merged: Profile = profile
        ? { ...parsed, workAuthorized: profile.workAuthorized, needsSponsorship: profile.needsSponsorship, over18: profile.over18, relocate: profile.relocate, howHeard: profile.howHeard, eeo: profile.eeo }
        : parsed;
      const b64 = await fileToBase64(file);
      onChange(merged, { name: file.name, type: file.type || "application/pdf", b64 });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const p = profile;
  const set = <K extends keyof Profile>(k: K, v: Profile[K]) => {
    if (!p) return;
    onChange({ ...p, [k]: v }, resume);
  };
  const setEdu = (i: number, patch: Partial<Education>) => {
    if (!p) return;
    const education = p.education.map((e, idx) => (idx === i ? { ...e, ...patch } : e));
    onChange({ ...p, education }, resume);
  };
  const setExp = (i: number, patch: Partial<Experience>) => {
    if (!p) return;
    const experience = p.experience.map((e, idx) => (idx === i ? { ...e, ...patch } : e));
    onChange({ ...p, experience }, resume);
  };
  const setEeo = <K extends keyof Eeo>(k: K, v: Eeo[K]) => {
    if (!p) return;
    onChange({ ...p, eeo: { ...p.eeo, [k]: v } }, resume);
  };
  const setSetting = <K extends keyof Settings>(k: K, v: Settings[K]) => onSettingsChange({ ...settings, [k]: v });

  return (
    <div className="flex flex-col gap-6 max-w-3xl">
      <div
        className={`card p-8 text-center border-dashed transition-colors ${drag ? "border-ink bg-surface-2" : ""}`}
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
      >
        <input ref={fileRef} type="file" accept=".pdf,.docx,.txt" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }} />
        <p className="text-lg font-semibold tracking-tight">{resume ? "Replace resume" : "Upload your resume"}</p>
        <p className="text-sm text-muted mt-1">PDF or DOCX. Parsed in your browser — nothing is uploaded to a server.</p>
        <button className="btn btn-primary mt-4" onClick={() => fileRef.current?.click()} disabled={busy}>
          {busy ? "Parsing…" : "Choose file"}
        </button>
        {resume && <p className="text-xs text-muted mt-3">Current: {resume.name}</p>}
        {error && <p className="text-sm mt-3" style={{ color: "hsl(0 60% 40%)" }}>{error}</p>}
      </div>

      {p && (
        <>
          <section className="card p-6">
            <h3 className="font-semibold tracking-tight mb-1">Contact</h3>
            <p className="text-xs text-muted mb-4">Check these — they&apos;re what gets typed into every application.</p>
            <div className="grid sm:grid-cols-2 gap-3">
              <Field label="First name" value={p.firstName} onChange={(v) => set("firstName", v)} />
              <Field label="Last name" value={p.lastName} onChange={(v) => set("lastName", v)} />
              <Field label="Email" value={p.email} onChange={(v) => set("email", v)} type="email" />
              <Field label="Phone (digits only)" value={p.phone} onChange={(v) => set("phone", v.replace(/\D/g, ""))} placeholder="4085551234" />
              <Field label="Address line 1" value={p.address1} onChange={(v) => set("address1", v)} wide />
              <Field label="City" value={p.city} onChange={(v) => set("city", v)} />
              <Field label="State (2 letters)" value={p.state} onChange={(v) => set("state", v.toUpperCase().slice(0, 2))} />
              <Field label="ZIP" value={p.zip} onChange={(v) => set("zip", v)} />
              <Field label="Country" value={p.country} onChange={(v) => set("country", v)} />
              <Field label="LinkedIn URL" value={p.linkedin} onChange={(v) => set("linkedin", v)} />
              <Field label="GitHub URL" value={p.github} onChange={(v) => set("github", v)} />
              <Field label="Website / portfolio" value={p.website} onChange={(v) => set("website", v)} wide />
            </div>
          </section>

          <section className="card p-6">
            <h3 className="font-semibold tracking-tight mb-1">Standard screening answers</h3>
            <p className="text-xs text-muted mb-4">Used for the yes/no questions nearly every application asks. Demographic questions are answered from the self-identification section below.</p>
            <div className="grid sm:grid-cols-2 gap-4">
              <YesNo label="Legally authorized to work in the US?" value={p.workAuthorized} onChange={(v) => set("workAuthorized", v)} />
              <YesNo label="Will you need visa sponsorship?" value={p.needsSponsorship} onChange={(v) => set("needsSponsorship", v)} />
              <YesNo label="Are you 18 or older?" value={p.over18} onChange={(v) => set("over18", v)} />
              <YesNo label="Willing to relocate?" value={p.relocate} onChange={(v) => set("relocate", v)} />
              <div>
                <span className="label">Degree level</span>
                <select className="input" value={p.degreeLevel} onChange={(e) => set("degreeLevel", e.target.value as Profile["degreeLevel"])}>
                  {["High School", "Associate", "Bachelor's", "Master's", "PhD"].map((d) => <option key={d}>{d}</option>)}
                </select>
              </div>
              <Field label="Expected graduation (MM/YYYY)" value={p.gradMonthYear} onChange={(v) => set("gradMonthYear", v)} placeholder="06/2028" />
              <Field label="How did you hear about us?" value={p.howHeard} onChange={(v) => set("howHeard", v)} placeholder="Job board" wide />
            </div>
          </section>

          <section className="card p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold tracking-tight">Education</h3>
              <button className="btn btn-subtle" onClick={() => onChange({ ...p, education: [...p.education, { school: "", degree: "", field: "", gpa: "", startDate: "", endDate: "" }] }, resume)}>+ Add</button>
            </div>
            <div className="flex flex-col gap-4">
              {p.education.map((e, i) => (
                <div key={i} className="grid sm:grid-cols-2 gap-3 pb-4 border-b border-line last:border-0 last:pb-0">
                  <Field label="School" value={e.school} onChange={(v) => setEdu(i, { school: v })} wide />
                  <Field label="Degree" value={e.degree} onChange={(v) => setEdu(i, { degree: v })} placeholder="Bachelor of Science" />
                  <Field label="Field of study" value={e.field} onChange={(v) => setEdu(i, { field: v })} placeholder="Computer Science" />
                  <Field label="GPA" value={e.gpa} onChange={(v) => setEdu(i, { gpa: v })} />
                  <Field label="Start" value={e.startDate} onChange={(v) => setEdu(i, { startDate: v })} placeholder="Sep 2024" />
                  <Field label="End / expected" value={e.endDate} onChange={(v) => setEdu(i, { endDate: v })} placeholder="Jun 2028" />
                  <div className="flex items-end">
                    <button className="text-xs text-muted hover:text-ink" onClick={() => onChange({ ...p, education: p.education.filter((_, idx) => idx !== i) }, resume)}>Remove</button>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="card p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold tracking-tight">Experience &amp; projects</h3>
              <button className="btn btn-subtle" onClick={() => onChange({ ...p, experience: [...p.experience, { title: "", company: "", location: "", startDate: "", endDate: "", current: false, description: "" }] }, resume)}>+ Add</button>
            </div>
            <div className="flex flex-col gap-4">
              {p.experience.map((e, i) => (
                <div key={i} className="grid sm:grid-cols-2 gap-3 pb-4 border-b border-line last:border-0 last:pb-0">
                  <Field label="Title" value={e.title} onChange={(v) => setExp(i, { title: v })} />
                  <Field label="Company / org" value={e.company} onChange={(v) => setExp(i, { company: v })} />
                  <Field label="Location" value={e.location} onChange={(v) => setExp(i, { location: v })} />
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Start" value={e.startDate} onChange={(v) => setExp(i, { startDate: v })} placeholder="Jun 2025" />
                    <Field label="End" value={e.current ? "" : e.endDate} onChange={(v) => setExp(i, { endDate: v, current: false })} placeholder={e.current ? "Present" : "Sep 2025"} />
                  </div>
                  <label className="flex items-center gap-2 text-sm text-ink-2 sm:col-span-2 cursor-pointer">
                    <input type="checkbox" checked={e.current} onChange={(ev) => setExp(i, { current: ev.target.checked })} className="accent-black" /> I currently work here
                  </label>
                  <div className="sm:col-span-2">
                    <span className="label">Description</span>
                    <textarea className="input min-h-[80px]" value={e.description} onChange={(ev) => setExp(i, { description: ev.target.value })} />
                  </div>
                  <div>
                    <button className="text-xs text-muted hover:text-ink" onClick={() => onChange({ ...p, experience: p.experience.filter((_, idx) => idx !== i) }, resume)}>Remove</button>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="card p-6">
            <h3 className="font-semibold tracking-tight mb-1">Skills</h3>
            <p className="text-xs text-muted mb-3">Comma-separated. These drive the match score.</p>
            <textarea
              className="input min-h-[90px]"
              value={p.skills.join(", ")}
              onChange={(e) => set("skills", e.target.value.split(",").map((s) => s.trim()).filter(Boolean))}
            />
          </section>

          <section className="card p-6">
            <h3 className="font-semibold tracking-tight mb-1">Voluntary self-identification</h3>
            <p className="text-xs text-muted mb-4">
              Most US applications end with these. Your answers stay in this browser and are typed in exactly as you set them here — leave one blank and Autopilot will ask you on the page instead.
            </p>
            <div className="grid sm:grid-cols-2 gap-4">
              <Choice label="Gender" value={p.eeo.gender} options={["Male", "Female", "Non-binary", "Decline"]} onChange={(v) => setEeo("gender", v)} />
              <Choice label="Hispanic or Latino?" value={p.eeo.hispanic} options={["Yes", "No", "Decline"]} onChange={(v) => setEeo("hispanic", v)} />
              <div className="sm:col-span-2">
                <Choice
                  label="Race"
                  value={p.eeo.race}
                  options={["American Indian or Alaska Native", "Asian", "Black or African American", "Native Hawaiian or Other Pacific Islander", "White", "Two or More Races", "Decline"]}
                  onChange={(v) => setEeo("race", v)}
                />
              </div>
              <Choice label="Veteran status" value={p.eeo.veteran} options={["Not a veteran", "Veteran", "Decline"]} onChange={(v) => setEeo("veteran", v)} />
              <Choice label="Disability" value={p.eeo.disability} options={["Yes", "No", "Decline"]} onChange={(v) => setEeo("disability", v)} hint="“Decline” picks the form's “I don't wish to answer” option." />
            </div>
          </section>

          <section className="card p-6">
            <h3 className="font-semibold tracking-tight mb-1">Autopilot settings</h3>
            <p className="text-xs text-muted mb-4">How the extension behaves on application pages.</p>
            <div className="flex flex-col gap-4">
              <div>
                <span className="label">Claude API key (for open-ended questions)</span>
                <input
                  className="input font-mono"
                  type="password"
                  placeholder="sk-ant-…"
                  value={settings.apiKey}
                  onChange={(e) => setSetting("apiKey", e.target.value.trim())}
                  autoComplete="off"
                />
                <p className="text-xs text-muted mt-1.5">
                  Used to write answers to questions like “Why do you want to work here?” and to pick options Autopilot can&apos;t map from your profile. Get one at console.anthropic.com. Stored only in this browser and the extension; sent only to api.anthropic.com. Without a key, those questions pop up for you to answer.
                </p>
              </div>
              <div>
                <span className="label">Application account password (Workday and similar)</span>
                <input
                  className="input font-mono"
                  type="password"
                  placeholder="A password you'll use only for job sites"
                  value={settings.accountPassword}
                  onChange={(e) => setSetting("accountPassword", e.target.value)}
                  autoComplete="new-password"
                />
                <p className="text-xs text-muted mt-1.5">
                  Workday makes you create an account per company. With this set, Autopilot signs up or signs in with your email and this password without asking. Use 12+ characters with a capital, a number and a symbol so every site accepts it. Stored only in this browser and the extension.
                </p>
              </div>
              <label className="flex items-center gap-2 text-sm text-ink-2 cursor-pointer">
                <input type="checkbox" className="accent-black" checked={settings.acceptCookies} onChange={(e) => setSetting("acceptCookies", e.target.checked)} />
                Dismiss cookie banners automatically
              </label>
              <label className="flex items-center gap-2 text-sm text-ink-2 cursor-pointer">
                <input type="checkbox" className="accent-black" checked={settings.fillEeo} onChange={(e) => setSetting("fillEeo", e.target.checked)} />
                Fill self-identification questions from the answers above
              </label>
              <label className="flex items-center gap-2 text-sm text-ink-2 cursor-pointer">
                <input type="checkbox" className="accent-black" checked={settings.autoAdvance} onChange={(e) => setSetting("autoAdvance", e.target.checked)} />
                Click Next / Continue automatically once a page is complete
              </label>
              <p className="text-xs text-muted">Submit is always left to you: Autopilot stops at the final page and asks before sending.</p>
            </div>
          </section>

          <section className="card p-6">
            <h3 className="font-semibold tracking-tight mb-1">Summary</h3>
            <p className="text-xs text-muted mb-3">Used when an application asks for a short bio or cover note.</p>
            <textarea className="input min-h-[90px]" value={p.summary} onChange={(e) => set("summary", e.target.value)} />
          </section>

          <button className="text-sm text-muted hover:text-ink self-start" onClick={() => { if (confirm("Clear your profile and resume from this browser?")) onChange(null, null); }}>
            Clear profile
          </button>
        </>
      )}
    </div>
  );
}
