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

1. **Profile tab** → upload your resume (PDF or DOCX). Check the parsed fields, especially phone, address, graduation date, and the yes/no screening answers.
2. Fill in **Voluntary self-identification** (gender, Hispanic/Latino, race, veteran, disability). These get submitted on every application; leave one blank and Autopilot asks you on the page instead.
3. **Autopilot settings** (same tab):
   - **Claude API key** — lets Autopilot write answers to open-ended questions ("Why do you want to work here?") and pick options it can't map from your profile. Get one at console.anthropic.com (needs a few dollars of credit; roughly 1–3¢ per application). Without it, those questions pop up as a card for you to answer.
   - **Application account password** — Workday makes you create an account per company. With this set, Autopilot signs up or signs in with your email + this password without asking.
4. **Jobs tab** → filter by posting age, category, location, ATS. Sort by **Best match** once your resume is loaded.
5. Click a card → read the qualifications and score → **Yes, apply & autofill** or **Skip**.
6. The application opens in a new tab, the page dims, and Autopilot takes over: accepts the cookie banner, clicks Apply, creates/signs into the account, uploads your resume, fills every page, clicks Next, and at the end shows a **Submit?** card. You click Submit; it presses the site's button and tells the dashboard.
   - When it can't answer something, a card appears with the form's options, a text box, and "I'll do it on the page". Answers you type can be remembered for later applications.
   - **Pause** (or Esc) hands you the page; **Resume** gives it back. **edit** on any row changes what was typed. **Stop** ends the takeover.
7. It still can't do: CAPTCHAs, email verification codes, or anything behind a login it doesn't have — it pauses and asks when it hits one.

You can also click the extension's toolbar icon on *any* application page to run it there, even if you didn't open it from the dashboard.

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
  rules.js             label → profile-field rules, EEO/skip lists
  content.js           filler engine + live panel
```

## Privacy

Your resume, profile, demographic answers, API key and account password live in your browser (localStorage) and in the extension's local storage on this computer. The dashboard server only ever sees job URLs (to fetch descriptions). The API key is sent only to api.anthropic.com, directly from the extension.
