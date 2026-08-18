import {
	MarkdownView,
	Notice,
	Plugin,
	setIcon,
	type TAbstractFile,
} from "obsidian";
import type { QuizNowApi, TabName } from "./plugin-api";
import type { ExamRecord, ExamSession, Lang, Question, QuestionType, Settings } from "./types";
import { newId, shuffleOptions } from "./question";
import { generateFromNote } from "./generator";
import { aiGenerateQuestions, defaultGeneratePrompt } from "./ai";
import { QuizStore } from "./store";
import { GenerationModal, GenerationConfigModal } from "./generate-modal";
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
	/** 上次注册命令时的语言，用于语言切换后重注册 */
	private cmdLang: Lang | null = null;

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

		this.registerCommands();
		this.refreshCommands(true);

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

	/** 注册插件命令（语言切换后重新调用以更新命令名） */
	private registerCommands(): void {
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
				if (!checking) this.startGenerateFlow();
				return true;
			},
		});
	}

	/** 语言变化（或强制）时移除旧命令并用新语言重注册（命令 id 不变，快捷键绑定保留） */
	refreshCommands(force = false): void {
		const lang = getLang();
		if (!force && this.cmdLang === lang) return;
		this.cmdLang = lang;
		for (const id of [
			"quiznow-open",
			"quiznow-quick-exam",
			"quiznow-generate-from-note",
		]) {
			try {
				this.removeCommand(id);
			} catch {
				// 忽略未注册的 id
			}
		}
		this.registerCommands();
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
				this.startGenerateFlow();
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
		// 语言切换后同步更新命令名
		this.refreshCommands();
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

	/**
	 * 从笔记生成试题的统一入口：
	 * 设置「生成方式」为弹窗时，先弹出配置弹窗，否则直接按已保存配置生成。
	 */
	startGenerateFlow(): void {
		if (this.store.settings.genMode === "dialog") {
			new GenerationConfigModal(this.app, this, (config) => {
				void this.generateFromCurrentNote(config);
			}).open();
		} else {
			void this.generateFromCurrentNote();
		}
	}

	/** 基于当前打开的笔记生成试题（AI 优先，失败回退启发式；可传覆盖配置） */
	async generateFromCurrentNote(opts?: {
		count?: number;
		includeTypes?: QuestionType[];
		useAi?: boolean;
	}): Promise<void> {
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
			const useAi = opts?.useAi ?? (s.aiEnabled && !!s.aiApiKey);
			const count = opts?.count ?? (s.aiCount || 5);
			const includeTypes =
				opts?.includeTypes ?? TYPE_KEYS.filter((tt) => s.includeTypes[tt]);
			let questions: Question[] = [];

			if (useAi) {
				try {
					questions = await aiGenerateQuestions({
						baseUrl: s.aiBaseUrl,
						apiKey: s.aiApiKey,
						model: s.aiModel,
						noteContent: text,
						sourceName: file.basename,
						count,
						includeTypes,
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
