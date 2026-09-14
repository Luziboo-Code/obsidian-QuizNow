import type { App, PluginManifest } from "obsidian";
import type { QuizStore } from "./store";
import type { ExamRecord, ExamSession } from "./types";

export type TabName = "home" | "exam" | "review" | "weak";

/** 视图与插件之间的最小接口（避免循环依赖） */
export interface QuizNowApi {
	app: App;
	/** 插件 manifest（视图标题等复用，避免硬编码插件名） */
	manifest: PluginManifest;
	store: QuizStore;
	currentSession: ExamSession | null;
	/** 是否展示最近一次考试的成绩页（避免重进标签一直显示旧成绩） */
	showSummary: boolean;
	lastExamRecord: ExamRecord | null;
	lastExamSession: ExamSession | null;
	refresh(): void;
	/** 按当前语言重注册命令（force 时忽略语言检测强制重注册） */
	refreshCommands?(force?: boolean): void;
	openTab(tab: TabName): void;
	/** 打开 Obsidian 设置面板中的 QuizNow 设置页 */
	openSettings(): void;
	startSession(session: ExamSession): void;
	/** 从笔记生成试题的统一入口（按设置决定直接生成或弹配置窗） */
	startGenerateFlow(): void;
	generateFromCurrentNote(opts?: {
		count?: number;
		includeTypes?: import("./types").QuestionType[];
		useAi?: boolean;
	}): Promise<void>;
	getNoteContentFor(source?: string): Promise<string | undefined>;
}
