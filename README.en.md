<div align="center">

# 🎓 QuizNow — Exam & Review Plugin for Obsidian

![UI](user_interface_imgs/interface_05.png)

**Generate exam questions from your notes in one click · Single / Multiple / Fill-in-the-blank / True-False · SM-2 spaced repetition**

[简体中文](README.md) | [English](README.en.md)

</div>

---

> **QuizNow** is a clean, modern, lightweight Obsidian plugin that completes the full
> **"Learn → Exam → Review → Master"** loop right inside your vault:
> generate questions from the note you're reading → take exams → wrong answers flow into
> SM-2 spaced repetition → knowledge points you keep missing land in **Weak Spots** for focused practice.

- ⚡ Built with vanilla DOM — no runtime frameworks, extremely low resource usage
- 🌍 UI in **简体中文 / English / 日本語 / 한국어** (switchable in Settings)
- 🗄️ Question bank stored in a **single-file JSON database** — no more scattered files, with one-click **backup/restore**

---

## 📑 Table of Contents

- [Features](#-features)
- [Quick Start](#-quick-start)
- [Usage Guide](#-usage-guide)
- [Commands](#-commands)
- [Question Types & Answering](#-question-types--answering)
- [Question Bank (Single-File Database)](#-question-bank-single-file-database)
- [Backup & Restore](#-backup--restore)
- [AI Generation (Optional)](#-ai-generation-optional)
- [Language Support](#-language-support)
- [FAQ](#-faq)
- [Development](#-development)
- [Data & Privacy](#-data--privacy)
- [License](#-license)

---

## ✨ Features

| Section | Description |
| --- | --- |
| 🏠 **Home** | Row 1: stat cards for question count / wrong answers / due reviews / exam papers; Row 2: **best score** card for each exam paper (number shown configurable) |
| 📝 **Exam** | Flashcard-style answering; single-choice & true-false **submit on click**, multiple-choice & fill-in-the-blank submit manually; configurable question count and types; after generation choose **"Answer Now"** or **"Add to Bank"**; wrong answers are auto-saved to the bank and review queue |
| 🔄 **Review** | Wrong answers from exams collected automatically; re-answer with the **SM-2 spaced repetition** algorithm (self-rate: Again / Hard / Good / Easy); **answering wrong again moves the question to Weak Spots** |
| 🎯 **Weak Spots** | Knowledge points you keep missing, managed in one place; one-click **explanation generation** (AI or extracted from your note) to help memorization; SM-2-based re-exams; consecutive correct answers graduate the point automatically |
| ⚙️ **Settings** | Bank database path, default question count, scoring mode, question types, papers shown on home, SM-2 parameters, weak-spot mastery threshold, AI endpoint, **custom generation prompts**, **UI language**, **backup/restore** and more |

**Highlights**

- 📄 **One-click generation from the document header** — open any note and click the 📋 button in the top-right corner of its title bar
- 🗄️ **Single-file database** — all questions live in `QuizNow/题库.json` (configurable), synced with your vault and easy to back up
- 💾 **One-click backup/restore** — export everything (bank + records + memory progress + settings) to a single JSON file
- 🤖 **Optional AI enhancement** — plug in any OpenAI-compatible API for AI question generation and explanations; built-in zero-cost generation when not configured
- 🔧 **Custom generation prompts** — manage multiple AI prompts and switch between them anytime
- 🧠 **SM-2 science-backed review** — the classic spaced-repetition algorithm schedules each question's next review

---

## 🚀 Quick Start

1. **Install**: copy `main.js`, `manifest.json`, `styles.css` into
   `<your-vault>/.obsidian/plugins/obsidian-quiznow/` (create it if missing);
2. **Enable**: Obsidian "Settings → Community plugins" → enable **QuizNow**;
3. **Open**: click the 🎓 icon in the left ribbon, or run the command
   `QuizNow: Open QuizNow panel` (opens in a **new tab in the main content area**, not the sidebar).

> On first launch a sample bank database is created at `QuizNow/题库.json`
> with 3 example questions — inspect, edit or delete them freely.

---

## 📖 Usage Guide

### 1. Generate Questions from a Note

1. Open a note — mark key terms in **bold** or use `key: value` lines to
   significantly improve built-in generation quality;
2. Click the **📋 button in the note's title bar (top-right)**, or run
   `QuizNow: Generate questions from current note`;
3. A "Generating exam questions…" notice appears; when done, a preview dialog shows:
   - **Answer Now** → start the exam immediately;
   - **Add to Bank** → all questions are written to the bank database `QuizNow/题库.json`.

### 2. Take an Exam

- In the **Exam** tab, set the **question count**, **types**
  (single / multiple / fill / true-false) and **source** (random from bank / weak spots);
- Single-choice and true-false questions **submit the moment you click**;
  multiple-choice requires clicking "Submit"; fill-in-the-blank supports **Enter to submit**;
- After the last question you see your score and a review of mistakes —
  **wrong answers are automatically added to the bank and the review queue**.

### 3. Review (SM-2 spaced repetition)

- The **Review** tab lists **due** wrong answers as flashcards: recall first,
  click the card to flip and reveal the answer;
- Self-rate your recall (Again / Hard / Good / Easy); the plugin schedules the
  next review with the SM-2 algorithm;
- **Answering wrong again moves the question to Weak Spots**.

### 4. Master Your Weak Spots

- Open the **Weak Spots** tab and click **✨ Generate Explanation** on any point to
  aid understanding and memorization;
- Click **🎯 Weak Spot Exam** to re-answer; consecutive correct answers
  (default 2, configurable) graduate the point out of Weak Spots.

---

## ⌨️ Commands

| Command | Description |
| --- | --- |
| `QuizNow: Open QuizNow panel` | Open the main panel (new tab) |
| `QuizNow: Quick exam (random from bank)` | Start a random exam in one click |
| `QuizNow: Generate questions from current note` | Generate questions from the active note |
| 📋 Title-bar button | Same as above (top-right of the note) |

---

## 🧩 Question Types & Answering

| Type | How to answer | Grading |
| --- | --- | --- |
| Single choice `single` | Click an option — auto-submit | Exactly one correct option |
| Multiple choice `multiple` | Select, then click "Submit" | Must match the key **exactly** |
| Fill-in-the-blank `fill` | Type and press Enter | Case/space-insensitive; multiple accepted answers |
| True / False `judge` | Click ✓ True / ✗ False — auto-submit | True or False |

---

## 🗄️ Question Bank (Single-File Database)

The bank is stored in **one JSON database file** (default `QuizNow/题库.json`,
path configurable in Settings). All questions live in a single file — no more
scattered Markdown files — and the file syncs with your vault and backs up easily.

Database structure:

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

> **Upgrading**: when upgrading from an older version, Markdown question files in the
> legacy `QuizNow/题库/` folder are automatically migrated into the database file
> (the old folder is kept — you can delete it manually).

---

## 💾 Backup & Restore

In "Settings → Data Backup":

- **Back Up Now**: export the question bank, exam records, SM-2 memory progress and
  all settings into a single `quiznow-backup-<timestamp>.json` file
  (stored in `QuizNow/backups/` by default);
- **Restore**: pick any backup from the list (**a backup of current data is created
  automatically before restoring**, so nothing is lost accidentally);
- Backup files can be copied to other devices and fully restore the plugin state.

---

## 🤖 AI Generation (Optional)

Fill in an OpenAI-compatible endpoint in Settings (OpenAI, DeepSeek, Qwen, local Ollama, etc.):

- **API URL**: `https://api.openai.com/v1` (or any compatible endpoint)
- **API Key**, **Model**, **Questions per AI run**
- With "Enable AI question & explanation generation" checked:
  - "Generate questions from current note" uses AI (falls back to built-in on failure);
  - "Generate Explanation" in Weak Spots uses AI for plain-language explanations.

**Custom generation prompts**: in "Settings → Custom Generation Prompts" you can
add / delete multiple custom AI prompts and pick the active one; when none is
selected, the built-in multilingual default prompt is used. Prompts support two
placeholders: `{count}` (number of questions) and `{types}` (enabled question types).

> Without AI configured, the plugin uses the **zero-cost built-in heuristic generator**:
> bold terms → fill-in-the-blank / single-choice, `key: value` lines → fill-in-the-blank.

---

## 🌍 Language Support

Choose **简体中文 / English / 日本語 / 한국어** in "Settings → Language".
After saving, the entire UI — including command names, notices and AI default
prompts — switches language.

---

## ❓ FAQ

**Q: Why is the bank a single JSON file instead of many Markdown files?**
A: A single-file database avoids cluttering your vault with tiny files every time
you generate questions, and is simpler to sync, back up and migrate. Functionally
it is identical to the old folder-based bank.

**Q: Will I lose my old questions after upgrading?**
A: No. Questions in the legacy `QuizNow/题库/` folder are migrated automatically to
`QuizNow/题库.json`; you can delete the old folder afterwards.

**Q: Can I use the plugin without an AI key?**
A: Yes. Without AI, the built-in heuristic generator is used (bold terms → fill /
single-choice, key-value lines → fill), and explanations are extracted from your notes.

**Q: How do I move my data to another device?**
A: On the old device: Settings → Data Backup → Back Up Now. Copy the backup JSON to
the new device, install the plugin there, then Settings → Data Backup → Restore.

**Q: Where is the data stored? Will uninstalling the plugin delete it?**
A: Data lives in the plugin's `data.json` and the bank database file
(`QuizNow/题库.json`). **Uninstalling the plugin does not delete these files** —
they are re-read automatically after reinstallation.

---

## 🛠 Development

```bash
npm install
npm run dev        # watch mode, outputs main.js
npm run build      # type-check + production build
```

| Module | Description |
| --- | --- |
| `src/main.ts` | Plugin entry: commands, ribbon, title-bar button, view registration |
| `src/store.ts` | Persistence, single-file JSON bank database, backup/restore |
| `src/types.ts` | Data models & settings |
| `src/question.ts` | Question parsing / serialization / answer grading |
| `src/generator.ts` | Built-in heuristic generation & explanation extraction |
| `src/ai.ts` | OpenAI-compatible AI client |
| `src/sm2.ts` | SM-2 spaced-repetition algorithm |
| `src/i18n.ts` | Internationalization (zh / en / ja / ko) |
| `src/views/` | Home / Exam / Review / Weak Spots / Settings views |

---

## 🔒 Data & Privacy

- All data stays **local to your vault** (plugin `data.json` + bank database file);
  nothing is uploaded anywhere;
- AI features only send the current note's content to your configured API endpoint
  **when you explicitly click generate**;
- Please review the data policies of whichever third-party AI service you configure.

---

## 📄 License

[MIT](LICENSE) © QuizNow

---

<div align="center">

**QuizNow** — turn Obsidian into your personal exam room 📝

</div>
