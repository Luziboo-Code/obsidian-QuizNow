<div align="center">

#  QuizNow — Exam & Review Plugin for Obsidian

![UI](user_interface_imgs/interface_05.png)

**Generate exam questions from your notes in one click · Single / Multiple / Fill-in-the-blank / True-False · SM-2 spaced repetition**

[English](README.md) | [简体中文](README.zh.md)

</div>

---

> **QuizNow** is a clean, modern, lightweight Obsidian plugin that completes the full
> **"Learn → Exam → Review → Master"** loop right inside your vault:
> generate questions from the note you're reading → take exams → wrong answers flow into
> SM-2 spaced repetition → knowledge points you keep missing land in **Weak Spots** for focused practice.

-  Built with vanilla DOM — no runtime frameworks, extremely low resource usage
-  UI in **简体中文 / English / 日本語 / 한국어** (switchable in Settings)
-  All data (bank, papers, scores, backups) lives in one visible **`QuizNow/` folder** at your vault root — nothing is written to `.obsidian` anymore, so the folder can be moved as a whole, with one-click **backup/restore**

---

##  Table of Contents

- [Features](#-features)
- [Quick Start](#-quick-start)
- [Usage Guide](#-usage-guide)
- [Commands](#-commands)
- [Question Types & Answering](#-question-types--answering)
- [Data Storage (the QuizNow folder)](#-data-storage-the-quiznow-folder)
- [Backup & Restore](#-backup--restore)
- [AI Generation (Optional)](#-ai-generation-optional)
- [Language Support](#-language-support)
- [FAQ](#-faq)
- [Development](#-development)
- [Data & Privacy](#-data--privacy)
- [License](#-license)

---

##  Features

| Section | Description |
| --- | --- |
|  **Home** | Row 1: stat cards for question count / wrong answers / due reviews / exam papers; Row 2: **best score** card for each exam paper (number shown configurable) — click a card to inspect every question and answer, or **retake the paper in one click** |
|  **Exam** | Flashcard-style answering; single-choice & true-false **submit on click**, multiple-choice & fill-in-the-blank submit manually; configurable question count and types; after generation choose **"Answer Now"** or **"Add to Bank"**; wrong answers are auto-saved to the bank and review queue |
|  **Review** | Wrong answers from exams collected automatically; re-answer with the **SM-2 spaced repetition** algorithm (self-rate: Again / Hard / Good / Easy); **answering wrong again moves the question to Weak Spots** |
|  **Weak Spots** | Knowledge points you keep missing, managed in one place; one-click **explanation generation** (AI or extracted from your note) to help memorization; SM-2-based re-exams; consecutive correct answers graduate the point automatically |
|  **Settings** | Now part of **Obsidian's own settings panel** (`Settings → Community plugins → QuizNow`): bank database path, data folder, default question count, scoring mode, question types, papers shown on home, SM-2 parameters, weak-spot mastery threshold, AI endpoint, **custom generation prompts**, **UI language**, **backup/restore** and more |

**Highlights**

-  **One-click generation from the document header** — open any note and click the 📋 button in the top-right corner of its title bar
-  **One data folder** — bank, papers, scores, progress and backups all live in `QuizNow/`, easy to sync and to migrate as a whole
-  **Retake any paper** — reuse the exact same questions (same order, reshuffled options); scores add to that paper's best result
-  **One-click backup/restore** — export everything (bank + records + memory progress + settings) to a single JSON file
-  **Optional AI enhancement** — plug in any OpenAI-compatible API for AI question generation and explanations; built-in zero-cost generation when not configured
-  **Custom generation prompts** — manage multiple AI prompts and switch between them anytime
-  **SM-2 science-backed review** — the classic spaced-repetition algorithm schedules each question's next review

---

##  Quick Start

1. **Install**: copy `main.js`, `manifest.json`, `styles.css` into
   `<your-vault>/.obsidian/plugins/obsidian-QuizNow/` (create it if missing);
2. **Enable**: Obsidian "Settings → Community plugins" → enable **QuizNow**;
3. **Open**: click the 🎓 icon in the left ribbon, or run the command
   `QuizNow: Open QuizNow panel` (opens in a **new tab in the main content area**, not the sidebar);
4. **Configure**: plugin settings now live in Obsidian's settings panel
   (`Settings → Community plugins → QuizNow`); the ⚙ button on the right of the main
   panel's nav bar jumps straight there.

> On first launch a sample bank database is created (`QuizNow/questions.json` at
> your vault root by default). Browse questions via the Home stat cards.

---

##  Usage Guide

### 1. Generate Questions from a Note

1. Open a note — mark key terms in **bold** or use `key: value` lines to
   significantly improve built-in generation quality;
2. Click the ** button in the note's title bar (top-right)**, or run
   `QuizNow: Generate questions from current note`;
3. A "Generating exam questions…" notice appears; when done, a preview dialog shows:
   - **Answer Now** → start the exam immediately;
   - **Add to Bank** → all questions are written to the bank database `QuizNow/questions.json` (vault root by default).

### 2. Take an Exam

- In the **Exam** tab, set the **question count**, **types**
  (single / multiple / fill / true-false) and **source** (random from bank / weak spots);
- Single-choice and true-false questions **submit the moment you click**;
  multiple-choice requires clicking "Submit"; fill-in-the-blank supports **Enter to submit**;
- After the last question you see your score and a review of mistakes —
  **wrong answers are automatically added to the bank and the review queue**.

### 3. Retake a Paper

- Clicking a **best-score card** on the Home tab opens that paper's exam records, where you
  can inspect **every question, your answer and whether it was right**;
- Click the **🔁 Retake** button on the card (or on any record) to take the same paper again:
  **identical questions in the same order, with the options reshuffled** so you can't memorize positions;
- The new attempt is stored as its own record and counts towards that paper's **best score**
  (a better score is never overwritten);
- The score page shown right after finishing an exam also offers a **🔁 Retake This Paper** button.

### 4. Review (SM-2 spaced repetition)

- The **Review** tab lists **due** wrong answers as flashcards: recall first,
  click the card to flip and reveal the answer;
- Self-rate your recall (Again / Hard / Good / Easy); the plugin schedules the
  next review with the SM-2 algorithm;
- **Answering wrong again moves the question to Weak Spots**.

### 5. Master Your Weak Spots

- Open the **Weak Spots** tab and click **✨ Generate Explanation** on any point to
  aid understanding and memorization;
- Click ** Weak Spot Exam** to re-answer; consecutive correct answers
  (default 2, configurable) graduate the point out of Weak Spots.

---

##  Commands

| Command | Description |
| --- | --- |
| `QuizNow: Open QuizNow panel` | Open the main panel (new tab) |
| `QuizNow: Quick exam (random from bank)` | Start a random exam in one click |
| `QuizNow: Generate questions from current note` | Generate questions from the active note |
|  Title-bar button | Same as above (top-right of the note) |

---

##  Question Types & Answering

| Type | How to answer | Grading |
| --- | --- | --- |
| Single choice `single` | Click an option — auto-submit | Exactly one correct option |
| Multiple choice `multiple` | Select, then click "Submit" | Must match the key **exactly** |
| Fill-in-the-blank `fill` | Type and press Enter | Case/space-insensitive; multiple accepted answers |
| True / False `judge` | Click ✓ True / ✗ False — auto-submit | True or False |

---

##  Data Storage (the QuizNow folder)

**All** data lives in one visible folder at your vault root, which makes migration,
syncing and backup trivial. The plugin **no longer writes any configuration to `.obsidian`**:

```
QuizNow/
├── questions.json     question bank database (all questions, single JSON file)
├── data.json          global settings + SM-2 memory progress + review/weak-spot queues + mistake notes
├── papers/            one snapshot per exam attempt (questions, your answers, correctness, score)
│   └── 20260910-121751 题库 · 09-10 13_04 <id>.json
└── backups/           one-click backup files (QuizNow-backup-<timestamp>.json)
```

> The "Data folder" row in the settings panel shows the current path; the button next to it
> opens the folder in your system file manager.

Bank database structure (`QuizNow/questions.json`):

```json
{
  "version": 1,
  "questions": [
    {
      "id": "unique-id",
      "type": "single | multiple | fill | judge",
      "content": "What is the capital of France?",
      "options": ["London", "Paris", "Berlin", "Rome"],
      "answer": ["B"],
      "explanation": "Paris is the capital of France",
      "source": "My note",
      "createdAt": 1720000000000
    }
  ]
}
```

> **Upgrading**: older versions kept data under `.obsidian/quiznow/` (and the plugin's own
> `data.json` in the hidden config folder). On first launch after the upgrade the bank,
> exam records, review progress, mistake notes and all settings are **migrated into the
> `QuizNow/` folder**: legacy questions found in the hidden folder are **merged** into the
> new bank (deduplicated by question id) before those files are removed, and a lowercase
> `quiznow/` folder at the vault root is renamed to `QuizNow/`.

---

##  Backup & Restore

In **Obsidian settings → Community plugins → QuizNow → Data Backup**:

- **Back Up Now**: export the question bank, exam records, SM-2 memory progress and
  all settings into a single `QuizNow-backup-<timestamp>.json` file
  (stored in `QuizNow/backups/` by default);
- **Restore**: pick any backup from the list (**a backup of current data is created
  automatically before restoring**, so nothing is lost accidentally);
- Backup files can be copied to other devices and fully restore the plugin state.

> Since everything lives in `QuizNow/`, copying that one folder to another vault or device
> also migrates the plugin completely.

---

##  AI Generation (Optional)

Fill in an OpenAI-compatible endpoint in `Settings → Community plugins → QuizNow → AI Generation`
(OpenAI, DeepSeek, Qwen, local Ollama, etc.):

- **API URL**: `https://api.openai.com/v1` (or any compatible endpoint)
- **API Key**, **Model**, **Questions per AI run**
- With "Enable AI question & explanation generation" checked:
  - "Generate questions from current note" uses AI (falls back to built-in on failure);
  - "Generate Explanation" in Weak Spots uses AI for plain-language explanations.

**Custom generation prompts**: in `Settings → Community plugins → QuizNow → Custom Generation Prompts`
you can add / delete multiple custom AI prompts and pick the active one; when none is
selected, the built-in multilingual default prompt is used. Prompts support two
placeholders: `{count}` (number of questions) and `{types}` (enabled question types).

> Without AI configured, the plugin uses the **zero-cost built-in heuristic generator**:
> bold terms → fill-in-the-blank / single-choice, `key: value` lines → fill-in-the-blank.

---

##  Language Support

Choose **简体中文 / English / 日本語 / 한국어** in
`Settings → Community plugins → QuizNow → General → Language`.
The entire UI — including command names, notices and AI default prompts — switches immediately.

---

## ❓ FAQ

**Q: Why is the bank a single JSON file instead of many Markdown files?**
A: A single-file database avoids cluttering your vault with tiny files every time
you generate questions, and is simpler to sync, back up and migrate. Functionally
it is identical to the old folder-based bank.

**Q: Will I lose my old questions after upgrading?**
A: No. The old bank database (both the hidden `.obsidian/quiznow/` copy and any visible
folder), exam records, review progress, mistake notes and every setting are **migrated
automatically into the `QuizNow/` folder** at your vault root. Legacy questions in the
hidden folder are merged into the new bank (deduplicated by id) before the old files are removed.

**Q: Where did the Settings tab go?**
A: It moved into Obsidian's own settings panel: `Settings → Community plugins → QuizNow`.
The ⚙ button at the right of the main panel's nav bar takes you there. All changes are
saved automatically and apply immediately.

**Q: How do I retake a paper I already took?**
A: Home → best-score card → open the exam records → click **🔁 Retake** (or use
"Retake This Paper" on the score page). The retake uses the original questions in the
original order with reshuffled options, and the score counts towards that paper's best result.

**Q: Can I use the plugin without an AI key?**
A: Yes. Without AI, the built-in heuristic generator is used (bold terms → fill /
single-choice, key-value lines → fill), and explanations are extracted from your notes.

**Q: How do I move my data to another device?**
A: Either copy the whole `QuizNow/` folder from the vault root, or use
`Settings → Community plugins → QuizNow → Data Backup → Back Up Now`, copy the backup
JSON to the new device and restore it there.

**Q: Where is the data stored? Will uninstalling the plugin delete it?**
A: Everything lives in the vault-root `QuizNow/` folder (`questions.json` + `data.json` +
`papers/` + `backups/`); nothing is written to `.obsidian`. **Uninstalling the plugin does
not delete these files** — they are re-read automatically after reinstallation.

---

## 🛠 Development

```bash
npm install
npm run dev        # watch mode, outputs main.js
npm run build      # type-check + production build
npm run lint       # runs Obsidian's official community-plugin review ruleset
```

### Releasing

Obsidian requires the **GitHub release tag to be identical to `version` in
`manifest.json`**, with `main.js`, `manifest.json` and `styles.css` attached as
release assets. This repo ships a GitHub Actions workflow that does this on tag push:

```bash
npm version minor      # syncs manifest.json + versions.json, commits and tags
git push --follow-tags # triggers .github/workflows/release.yml
```

> `versions.json` records the `minAppVersion` required by each plugin version, so
> Obsidian can fall back to a compatible older release on older app versions.

| Module | Description |
| --- | --- |
| `src/main.ts` | Plugin entry: commands, ribbon, title-bar button, view & settings-tab registration |
| `src/store.ts` | Persistence: the `QuizNow/` data folder, bank database, paper snapshots, backup/restore and legacy migration |
| `src/settings-tab.ts` | QuizNow settings page inside Obsidian's settings panel |
| `src/types.ts` | Data models & settings |
| `src/question.ts` | Question parsing / serialization / answer grading / option shuffling |
| `src/retake.ts` | Retaking a past paper (reuses its questions, reshuffles options) |
| `src/generator.ts` | Built-in heuristic generation & explanation extraction |
| `src/ai.ts` | OpenAI-compatible AI client |
| `src/sm2.ts` | SM-2 spaced-repetition algorithm |
| `src/i18n.ts` | Internationalization (zh / en / ja / ko) |
| `src/views/` | Home / Exam / Review / Weak Spots views (Settings moved to Obsidian's settings panel) |

---

##  Data & Privacy

- All data stays **local to your vault** (the `QuizNow/` folder: `questions.json`,
  `data.json`, `papers/`, `backups/`); nothing is uploaded anywhere, and nothing is
  written to `.obsidian`;
- **File access transparency**: the plugin lists the **filenames** of all Markdown
  files in the vault (to link weak-spot explanations back to their source notes).
  **File contents** are only read when you explicitly run actions such as
  "Generate questions from current note" or "Generate Explanation";
- AI features only send the current note's content to your configured API endpoint
  **when you explicitly click generate**;
- Please review the data policies of whichever third-party AI service you configure.

---

##  License

[MIT](LICENSE) © Luziboo

---

<div align="center">

**QuizNow** — turn Obsidian into your personal exam room 📝

</div>
