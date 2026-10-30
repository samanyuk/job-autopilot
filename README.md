# Autopilot — internship applier

Two pieces:

1. **Dashboard** (this Next.js app, deploys to Vercel): pulls every active Summer 2027 listing from the SimplifyJobs repo, parses your resume in the browser, scores each job 0–100 against it, and shows a confirm card per job.
2. **Chrome extension** (`extension/` folder): when you click **Apply** on the dashboard it opens the application in a new tab and fills it from your profile, with a live panel to pause, edit or stop. It never answers demographic (EEO / disability / veteran) questions and never clicks Submit.

## Deploy the dashboard to Vercel (≈5 min)

1. Create a new **empty** GitHub repo (e.g. `job-autopilot`). Don't add a README.
2. Put this folder in it and push:
   ```bash
   cd job-autopilot
   git init
   git add .
   git commit -m "Autopilot v0.1"
   git branch -M main
   git remote add origin https://github.com/<you>/job-autopilot.git
   git push -u origin main
   ```
3. Go to <https://vercel.com/new>, pick that repo, leave every setting on its default (framework: Next.js), click **Deploy**.
4. Open your new `https://job-autopilot-….vercel.app`. That's the dashboard.

Vercel redeploys automatically every time you push to `main`.

## Load the extension (≈1 min)

1. In Chrome open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and choose the `extension/` folder from this repo.
4. Reload the dashboard tab — the header should now say **Extension connected**.

When I send you an updated zip later, replace the `extension/` folder and hit the ↻ reload button on the extension card.

## Use it

1. **Profile tab** → upload your resume (PDF or DOCX). Check the parsed fields, especially phone, address, graduation date, and that every experience has a start date (Workday requires one).
2. Fill in **Voluntary self-identification** (gender, Hispanic/Latino, race, veteran, disability). These get submitted on every application; leave one blank and Autopilot asks you on the page instead.
3. **Autopilot settings** (same tab):
   - **Claude API key** — lets Autopilot write answers to open-ended questions ("Why do you want to work here?"). Get one at console.anthropic.com. Without it those questions come to you in one card per page.
   - **Application account password** — used for Workday-style per-company accounts. Leave it blank and Autopilot generates a strong one the first time it needs it and saves it here. Each company's account is remembered, so the next application at that company signs in instead of creating another.
4. **Questions seen in applications** (same tab) — every question Autopilot couldn't answer from your profile, most frequent first. Set an answer and it's used automatically from then on (also matches slightly different wordings of the same question).
5. **Jobs tab** → filter, sort by **Best match**, click a card → **Yes, apply & autofill**.
6. The application opens in a new tab, the page dims, and Autopilot takes over: cookie banner, Apply, account, resume, every page, Next, and a final **Submit?** card. Things it fills on Workday specifically: My Information (source, previous-employee, country, name, address, state, phone type/code/number), My Experience (one entry per job incl. month/year dates and "I currently work here", education with school/degree/field/GPA/years, languages with proficiency, skills, websites, resume), Application Questions (dropdowns, dates, yes/no), Voluntary Disclosures, Self Identify (disability + name + date).
   - Yes/No and common dropdown questions get a sensible default marked `guess` in the log (work authorization → Yes, sponsorship → No, year in school from your grad date, office nearest your city, …). Criminal-history / termination / clearance questions are never guessed.
   - When it can't answer something required, one card per page lists the open questions with the form's options; blank = skip. Optional unknowns are left blank silently.
   - **Pause** (or Esc) hands you the page; **Resume** gives it back. **edit** on any row changes what was typed. **Stop** ends the takeover.
   - If a site's date boxes reject synthetic input, Autopilot types them with real keystrokes through Chrome's debugger API; Chrome shows an "Autopilot Applier started debugging this browser" bar while it does. That's expected.
7. It still can't do: CAPTCHAs, email verification codes, or anything behind a login it doesn't have — it pauses and asks when it hits one.

You can also click the extension's toolbar icon on *any* application page to run it there.

## Try the extension safely

`/test-application.html` on your deployed dashboard is a fake posting + application form, and `/test-workday.html` is a mock of Workday's "My Experience" page (same data-automation-ids). Open either, click the extension icon, and watch it fill.

## Run locally

```bash
npm install
npm run dev
# http://localhost:3000
```

## Layout

```
app/
  page.tsx             dashboard (jobs / profile / applied views)
  api/jobs/route.ts    fetches + filters the SimplifyJobs listings.json
  api/describe/route.ts fetches a posting's description (Workday/Greenhouse/Lever/Ashby APIs, generic fallback)
components/            FilterPanel, JobCard, JobDetail, ProfilePanel, ScoreBar
lib/
  resumeText.ts        PDF/DOCX → text in the browser
  resumeParser.ts      text → profile (name, contact, education, experience, skills)
  match.ts             0–100 score + red→green color
  skills.ts            skill vocabulary used by parser and scorer
  extensionBridge.ts   postMessage protocol to the extension
extension/
  manifest.json, background.js (opens tabs, stores profile)
  bridge.js            runs on the dashboard, relays messages
  rules.js             label → profile-field rules, EEO/skip lists, default-answer heuristics
  workday.js           Workday adapter: auth, My Information, My Experience, disclosures, self-identify, date typing
  content.js           filler engine, takeover overlay, cards, question bank, Submit confirmation
```

## Privacy

Your resume, profile, demographic answers, API key and account password live in your browser (localStorage) and in the extension's local storage on this computer. The dashboard server only ever sees job URLs (to fetch descriptions). The API key is sent only to api.anthropic.com, directly from the extension.
