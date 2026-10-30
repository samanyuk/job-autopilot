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
2. **Jobs tab** → filter by posting age, category, location, ATS. Sort by **Best match** once your resume is loaded.
3. Click a card → read the qualifications and the score breakdown → **Yes, apply & autofill** or **Skip**.
4. The application opens in a new tab with the Autopilot panel in the corner:
   - **Pause / Resume** — stops filling instantly.
   - **edit** on any row — change what was typed.
   - **Fill again** — re-scan after you've opened a new section.
   - **Next page →** — clicks the form's own Next/Continue button for you. Tick **auto-advance** to do this automatically on pages where nothing was left for you.
   - **Stop** — hands the page fully back to you.
5. You handle: account creation / sign-in (Workday asks for one per company), demographic questions, anything marked ✋, and the final **Submit**.

You can also click the extension's toolbar icon on *any* application page to fill it, even if you didn't open it from the dashboard.

## Try the extension safely

`/test-application.html` on your deployed dashboard is a fake application form. Open it, click the extension icon, and watch it fill.

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

Your resume and profile live in your browser (localStorage) and in the extension's local storage. The dashboard server only ever sees job URLs (to fetch descriptions); it never receives your resume.
