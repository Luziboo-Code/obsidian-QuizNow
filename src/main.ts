import {
	MarkdownView,
	Notice,
	Plugin,
	setIcon,
	type TAbstractFile,
} from "obsidian";
import type { QuizNowApi, TabName } from "./plugin-api";
import type { ExamRecord, ExamSession, Question, QuestionType, Settings } from "./types";
import { newId, shuffleOptions } from "./question";
import { generateFromNote } from "./generator";
import { aiGenerateQuestions, defaultGeneratePrompt } from "./ai";
import { QuizStore } from "./store";
import { GenerationModal } from "./generate-modal";
import { QuizNowView, VIEW_TYPE } from "./views/main";
import { t, getLang } from "./i18n";

export default class QuizNowPlugin extends Plugin implements QuizNowApi {
	store!: QuizStore;
	view: QuizNowView | null = null;
	currentSession: ExamSession | null = null;
	showSummary = false;
	lastExamRecord: ExamRecord | null = null;
	lastExamSession: ExamSession | null = null;

	private syncTimer: number | null = null;

	async onload(): Promise<void> {
		this.store = new QuizStore(this);
		await this.store.load();

		this.registerView(VIEW_TYPE, (leaf) => {
			this.view = new QuizNowView(leaf, this);
			return this.view;
		});

		this.addRibbonIcon("graduation-cap", t("ribbon.main"), () => {
			this.openTab("home");
		});

		this.addCommand({
			id: "quiznow-open",
			name: t("cmd.open"),
			callback: () => this.openTab("home"),
		});

		this.addCommand({
			id: "quiznow-quick-exam",
			name: t("cmd.quickExam"),
			callback: () => this.startQuickExam(),
		});

		this.addCommand({
			id: "quiznow-generate-from-note",
			name: t("cmd.genNote"),
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveFile();
				if (!file) return false;
				if (!checking) void this.generateFromCurrentNote();
				return true;
			},
		});

		// 题库数据库文件变化时自动重新同步
		const handler = (file: TAbstractFile) => {
			if (file.path === this.store.bankPath()) {
				this.scheduleResync();
			}
		};
		this.registerEvent(this.app.vault.on("create", handler));
		this.registerEvent(this.app.vault.on("delete", handler));
		this.registerEvent(this.app.vault.on("rename", handler));
		this.registerEvent(this.app.vault.on("modify", handler));

		// 在打开的文档标题栏右上角注入「生成试卷」按钮
		this.registerEvent(
			this.app.workspace.on("active-leaf-change", () =>
				this.updateHeaderButton()
			)
		);
		this.registerEvent(
			this.app.workspace.on("layout-change", () => this.updateHeaderButton())
		);
		this.registerEvent(
			this.app.workspace.on("file-open", () => this.updateHeaderButton())
		);
		setTimeout(() => this.updateHeaderButton(), 500);
	}

	onunload(): void {
		if (this.syncTimer) window.clearTimeout(this.syncTimer);
	}

	/**
	 * 在打开的 Markdown 文档标题栏右上角（.view-actions）注入
	 * 「基于当前文档生成试卷」按钮；文档或布局切换时自动更新。
	 */
	private updateHeaderButton(): void {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		const container = view?.containerEl;
		if (!container) return;
		const actions = container.querySelector<HTMLElement>(".view-actions");
		if (!actions) return;
		let btn = actions.querySelector<HTMLElement>("[data-qn-header-btn]");
		if (!btn) {
			btn = document.createElement("div");
			btn.className = "clickable-icon view-action";
			btn.setAttribute("data-qn-header-btn", "");
			btn.setAttribute("aria-label", t("ribbon.genDoc"));
			setIcon(btn, "list-checks");
			btn.addEventListener("click", (e) => {
				e.stopPropagation();
				void this.generateFromCurrentNote();
			});
			actions.appendChild(btn);
		}
	}

	private scheduleResync(): void {
		if (this.syncTimer) window.clearTimeout(this.syncTimer);
		this.syncTimer = window.setTimeout(() => {
			void this.store.loadBank().then(() => this.refresh());
		}, 600);
	}

	// ---------- QuizNowApi ----------

	refresh(): void {
		this.view?.render();
	}

	openTab(tab: TabName): void {
		void this.activateView(tab);
	}

	startSession(session: ExamSession): void {
		this.currentSession = session;
		this.showSummary = false;
		this.openTab("exam");
	}

	getNoteContentFor(source?: string): Promise<string | undefined> {
		if (!source) return Promise.resolve(undefined);
		const files = this.app.vault.getMarkdownFiles();
		const f = files.find((x) => x.path === source || x.basename === source);
		if (!f) return Promise.resolve(undefined);
		return this.app.vault.read(f);
	}

	// ---------- 动作 ----------

	async activateView(tab: TabName = "home"): Promise<void> {
		const { workspace } = this.app;
		let leaf = workspace.getLeavesOfType(VIEW_TYPE)[0];
		if (!leaf) {
			// 在主内容区的新标签页中打开（不使用侧栏）
			leaf = workspace.getLeaf("tab");
			await leaf.setViewState({ type: VIEW_TYPE, active: true });
		}
		await workspace.revealLeaf(leaf);
		const view = leaf.view as QuizNowView;
		this.view = view;
		view.setTab(tab);
	}

	async startQuickExam(): Promise<void> {
		const types = this.store.settings.includeTypes;
		const pool = this.store.data.questions.filter((q) => types[q.type]);
		if (pool.length === 0) {
			new Notice(t("notice.emptyBank"));
			this.openTab("home");
			return;
		}
		const count = Math.min(this.store.settings.defaultCount || 10, pool.length);
		const picked = shuffle(pool)
			.slice(0, count)
			.map(shuffleOptions);
		this.startSession({
			id: newId(),
			name: `${t("exam.name.quick")} · ${nowStamp()}`,
			questions: picked,
			index: 0,
			answers: {},
			origin: "bank",
			createdAt: Date.now(),
		});
	}

	/** 基于当前打开的笔记生成试题（AI 优先，失败回退启发式） */
	async generateFromCurrentNote(): Promise<void> {
		const file = this.app.workspace.getActiveFile();
		if (!file) {
			new Notice(t("notice.noFile"));
			return;
		}
		// 生成中的常驻提示（0 = 不自动消失，完成后手动隐藏）
		const generating = new Notice(t("notice.generating"), 0);
		try {
			const text = await this.app.vault.read(file);
			const s = this.store.settings;
			let questions: Question[] = [];

			if (s.aiEnabled && s.aiApiKey) {
				try {
					questions = await aiGenerateQuestions({
						baseUrl: s.aiBaseUrl,
						apiKey: s.aiApiKey,
						model: s.aiModel,
						noteContent: text,
						sourceName: file.basename,
						count: s.aiCount || 5,
						includeTypes: TYPE_KEYS.filter((tt) => s.includeTypes[tt]),
						systemPrompt: resolvePrompt(s) ?? defaultGeneratePrompt(getLang()),
					});
				} catch (e) {
					new Notice(t("notice.aiFail", { msg: (e as Error).message }));
				}
			}
			if (questions.length === 0) {
				questions = generateFromNote(text, file.basename);
			}
			if (questions.length === 0) {
				new Notice(t("notice.extractFail"));
				return;
			}
			new GenerationModal(this.app, this, questions, file.basename).open();
		} finally {
			generating.hide();
		}
	}
}

const TYPE_KEYS: QuestionType[] = ["single", "multiple", "fill", "judge"];

/** 解析当前使用的生成指令：自定义指令内容，未选择则返回 undefined（用系统默认） */
function resolvePrompt(s: Settings): string | undefined {
	if (!s.activePromptId) return undefined;
	const p = s.customPrompts.find((x) => x.id === s.activePromptId);
	if (p && p.content.trim()) return p.content;
	return undefined;
}

function shuffle<T>(arr: T[]): T[] {
	const a = [...arr];
	for (let i = a.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[a[i], a[j]] = [a[j], a[i]];
	}
	return a;
}

function nowStamp(): string {
	const d = new Date();
	return `${String(d.getMonth() + 1).padStart(2, "0")}-${String(
		d.getDate()
	).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(
		d.getMinutes()
	).padStart(2, "0")}`;
}
