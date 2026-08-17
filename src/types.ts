/** 题型 */
export type QuestionType = "single" | "multiple" | "fill" | "judge";

export const QUESTION_TYPE_LABELS: Record<QuestionType, string> = {
	single: "单选题",
	multiple: "多选题",
	fill: "填空题",
	judge: "判断题",
};

/** 一道题目（题库中持久化的统一结构） */
export interface Question {
	id: string;
	type: QuestionType;
	/** 题干（内联 markdown） */
	content: string;
	/** 选项（single / multiple） */
	options?: string[];
	/** 正确答案：single/multiple 为大写字母，fill 为可接受的答案列表，judge 为 ["T"] 或 ["F"] */
	answer: string[];
	/** 解析 / 解释 */
	explanation?: string;
	/** 来源（笔记名 / 标签 / 手工添加） */
	source?: string;
	createdAt: number;
}

/** SM-2 记忆卡片 */
export interface SMCard {
	ef: number;
	interval: number; // 天数
	reps: number;
	due: number; // 下次复习时间戳 ms
}

/** 一道题的作答记录 */
export interface ExamAnswer {
	questionId: string;
	type: QuestionType;
	userAnswer: string[];
	correct: boolean;
}

/** 一次考试的记录 */
export interface ExamRecord {
	id: string;
	name: string; // 试卷名
	date: number;
	total: number;
	correct: number;
	score: number; // 0-100
	wrongIds: string[];
}

/** 一次进行中的考试会话（内存态，不持久化） */
export interface ExamSession {
	id: string;
	name: string;
	questions: Question[];
	index: number;
	answers: Record<string, ExamAnswer>;
	/** 来源标记 */
	origin: "bank" | "note" | "weak" | "review";
	createdAt: number;
}

/** 一条自定义 AI 生成指令 */
export interface CustomPrompt {
	id: string;
	name: string;
	content: string;
}

/** 界面语言 */
export type Lang = "zh" | "en" | "ja" | "ko";

/** 全局设置 */
export interface Settings {
	/** 界面语言 */
	language: Lang;
	/** 题库数据库文件（JSON，相对库根目录） */
	bankFile: string;
	/** 旧版题库文件夹（仅用于一次性迁移旧数据，不再使用） */
	bankFolder?: string;
	/** 默认出题数量 */
	defaultCount: number;
	/** 参与抽题的题型 */
	includeTypes: Record<QuestionType, boolean>;
	/** 评分方式 */
	scoreMode: "percent" | "points";
	/** 每题分值（points 模式） */
	pointsPerQuestion: number;
	/** 首页展示试卷最高分数量（0 = 全部） */
	homePaperLimit: number;
	/** SM-2 初始难度系数 */
	sm2InitialEF: number;
	/** SM-2 最小间隔（天） */
	sm2MinInterval: number;
	/** 薄弱点连续答对几次视为掌握 */
	weakMasteryReps: number;
	/** AI 生成开关 */
	aiEnabled: boolean;
	aiBaseUrl: string;
	aiApiKey: string;
	aiModel: string;
	/** AI 一次生成数量 */
	aiCount: number;
	/** 薄弱点用 AI 生成解释 */
	aiExplanation: boolean;
	/** 自定义生成指令列表 */
	customPrompts: CustomPrompt[];
	/** 当前使用的自定义指令 id（空 = 系统默认指令） */
	activePromptId: string;
}

export const DEFAULT_SETTINGS: Settings = {
	language: "zh",
	// 默认存于 .obsidian 隐藏目录，不会显示在文件树中
	bankFile: ".obsidian/quiznow/题库.json",
	bankFolder: "QuizNow/题库",
	defaultCount: 10,
	includeTypes: {
		single: true,
		multiple: true,
		fill: true,
		judge: true,
	},
	scoreMode: "percent",
	pointsPerQuestion: 10,
	homePaperLimit: 0,
	sm2InitialEF: 2.5,
	sm2MinInterval: 1,
	weakMasteryReps: 2,
	aiEnabled: false,
	aiBaseUrl: "https://api.openai.com/v1",
	aiApiKey: "",
	aiModel: "gpt-4o-mini",
	aiCount: 5,
	aiExplanation: true,
	customPrompts: [],
	activePromptId: "",
};

/** 持久化数据 */
export interface PluginData {
	version: number;
	/** 全局设置 */
	settings: Settings;
	/** 题库（由题库文件夹同步而来，运行时镜像） */
	questions: Question[];
	/** 题目 id -> 题库文件路径（相对库根） */
	questionFiles: Record<string, string>;
	/** 考试记录 */
	examRecords: ExamRecord[];
	/** 各试卷的最高分 name -> score */
	paperBest: Record<string, number>;
	/** 题目 id -> SM-2 卡片 */
	sm: Record<string, SMCard>;
	/** 待复习队列（考试答错的题） */
	reviewIds: string[];
	/** 薄弱点题目 id（必须理解透彻的知识点） */
	weakIds: string[];
	/** 是否已初始化过示例题库 */
	seeded?: boolean;
}

export function emptyData(): PluginData {
	return {
		version: 1,
		settings: { ...DEFAULT_SETTINGS },
		questions: [],
		questionFiles: {},
		examRecords: [],
		paperBest: {},
		sm: {},
		reviewIds: [],
		weakIds: [],
	};
}

/** 统计（首页展示） */
export interface Stats {
	questionCount: number;
	wrongCount: number;
	dueReviewCount: number;
	paperCount: number;
}
