# Voyage — Italy Admissions Pipeline Manager

Desktop app (Windows + Mac) for managing the Voyage counselling pipeline: intake → profile → shortlist → gap analysis → application prep → scholarships → daily digest, with Claude AI built in (drafting, gap analysis, live deadline verification with source URLs).

## Run it (development)

```
cd voyage-app
npm install
npm start
```

First run: open **Settings** and paste your Anthropic API key (get one at https://platform.claude.com). The key is stored encrypted on this machine only.

## The 7 stages

| Stage | Where | AI uses web search |
|---|---|---|
| 1 Intake — document checklist + status table | Student → Intake tab | no |
| 2 Profile build | Student → Profile tab | no |
| 3 Reach/Match/Safe shortlist (deadlines marked VERIFY + source URL) | Student → Shortlist tab | **yes** |
| 4 Eligibility & gaps, to-dos with DoV/CIMEA/English lead times | Student → Gaps tab | no |
| 5 Application pack (docs, motivation letter, CV, portal fields) — stops at **HUMAN REVIEW** | Student → Application tab | no |
| 6 DSU / MAECI / university scholarships + financial docs + bando deadlines | Student → Scholarships tab | **yes** |
| 7 Pipeline digest, urgency-sorted, risk flags, next action + owner | Dashboard | no |

Plus a standalone **Deadline Verifier** (admission / Universitaly / DSU / visa / TOLC) that always reports the official URL it used.

## Logo / app icon

- In-app branding uses `assets/logomark.svg` (vector recreation of the Voyage logo).
- To use your original logo file instead, save it as `assets/logo.png` (transparent PNG, ≥1024px recommended), then run `npm run icon` — it takes priority automatically.

## Build installers

- **Windows (.exe installer):** `npm run dist:win` → output in `dist/`
- **Mac (.dmg):** run `npm run dist:mac` **on a Mac** (Apple doesn't allow building/signing Mac apps from Windows). Copy this folder to the Mac, `npm install`, then build. The app itself is fully cross-platform.

## Data & backups

All student data is stored locally (Electron `userData` folder), never uploaded except the content sent to the Claude API when you run a stage. Use **Settings → Export data** to back up or move data between your Windows laptop and Mac, and **Import data** on the other machine.
