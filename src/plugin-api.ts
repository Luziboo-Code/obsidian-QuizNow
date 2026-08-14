import type { App } from "obsidian";
import type { QuizStore } from "./store";
import type { ExamRecord, ExamSession } from "./types";

export type TabName = "home" | "exam" | "review" | "weak" | "settings";

/** 视图与插件之间的最小接口（避免循环依赖） */
export interface QuizNowApi {
	app: App;
	store: QuizStore;
	currentSession: ExamSession | null;
	/** 是否展示最近一次考试的成绩页（避免重进标签一直显示旧成绩） */
	showSummary: boolean;
	lastExamRecord: ExamRecord | null;
	lastExamSession: ExamSession | null;
	refresh(): void;
	openTab(tab: TabName): void;
	startSession(session: ExamSession): void;
	generateFromCurrentNote(): Promise<void>;
	getNoteContentFor(source?: string): Promise<string | undefined>;
}
