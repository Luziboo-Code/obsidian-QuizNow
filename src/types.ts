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

/** 一次考试中的单题快照（用于历史记录完整还原试卷内容） */
export interface ExamQuestionSnapshot {
	question: Question;
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
	/** 本次试卷的完整题目快照（含每题作答结果），旧记录可能缺失 */
	snapshot?: ExamQuestionSnapshot[];
	/** 该记录对应的试卷文件（QuizNow/papers/xxx.json，相对库根目录） */
	file?: string;
}

/** 一次进行中的考试会话（内存态，不持久化） */
export interface ExamSession {
	id: string;
	name: string;
	questions: Question[];
	index: number;
	answers: Record<string, ExamAnswer>;
	/** 来源标记（paper = 历史试卷重考） */
	origin: "bank" | "note" | "weak" | "review" | "paper";
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

/** AI 服务商（OpenAI 兼容协议） */
export type AiProvider =
	| "openai"
	| "deepseek"
	| "ollama"
	| "lmstudio"
	| "custom";

export const AI_PROVIDER_IDS: AiProvider[] = [
	"openai",
	"deepseek",
	"ollama",
	"lmstudio",
	"custom",
];

/** 各服务商默认配置（首次启用该服务商时预填，用户仍可手动修改） */
export const AI_PROVIDER_PRESETS: Record<
	AiProvider,
	{ baseUrl: string; model: string; needsKey: boolean }
> = {
	openai: {
		baseUrl: "https://api.openai.com/v1",
		model: "gpt-4o-mini",
		needsKey: true,
	},
	deepseek: {
		baseUrl: "https://api.deepseek.com",
		model: "deepseek-v4-flash", // 也可改用 deepseek-v4-pro
		needsKey: true,
	},
	ollama: {
		baseUrl: "http://localhost:11434/v1",
		model: "llama3.1:8b",
		needsKey: false,
	},
	lmstudio: {
		baseUrl: "http://localhost:1234/v1",
		model: "qwen3.8-27b",
		needsKey: false,
	},
	custom: { baseUrl: "", model: "", needsKey: true },
};

/** 单个服务商已保存的配置（切换服务商时按此记忆，避免覆盖用户自定义值） */
export interface AiProfile {
	baseUrl: string;
	apiKey: string;
	model: string;
}

/** 根据设置判断 AI 是否可用（本地服务商如 Ollama 无需 API Key） */
export function isAiConfigured(
	s: Pick<Settings, "aiEnabled" | "aiProvider" | "aiApiKey">
): boolean {
	if (!s.aiEnabled) return false;
	const preset = AI_PROVIDER_PRESETS[s.aiProvider];
	if (preset && !preset.needsKey) return true;
	return !!s.aiApiKey;
}

/** 全局设置 */
export interface Settings {
	/** 界面语言 */
	language: Lang;
	/** 题库数据库文件（JSON，相对库根目录，默认 QuizNow/questions.json） */
	bankFile: string;
	/** 旧版题库文件夹（仅用于一次性迁移旧数据，不再使用） */
	bankFolder?: string;
	/** 从笔记生成试题的方式：direct = 直接按已保存配置生成；dialog = 弹出配置弹窗 */
	genMode: "direct" | "dialog";
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
	/** AI 服务商（决定默认地址/模型与是否需要 API Key） */
	aiProvider: AiProvider;
	/** 当前生效的 AI 配置（= aiProfiles[aiProvider]，切换时同步） */
	aiBaseUrl: string;
	aiApiKey: string;
	aiModel: string;
	/** 各服务商已保存的配置（key = 服务商 id；未配置过的服务商缺省用预设值） */
	aiProfiles?: Partial<Record<AiProvider, AiProfile>>;
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
	// 空 = 使用运行时默认（库根目录下的 QuizNow/questions.json）
	bankFile: "",
	bankFolder: "QuizNow/题库",
	genMode: "dialog",
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
	aiProvider: "openai",
	aiBaseUrl: "https://api.openai.com/v1",
	aiApiKey: "",
	aiModel: "gpt-4o-mini",
	aiProfiles: {},
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
	/** 题库（由题库数据库文件载入，运行时镜像） */
	questions: Question[];
	/** 题目 id -> 题库文件路径（相对库根，历史字段，已不再使用） */
	questionFiles: Record<string, string>;
	/** 考试记录（由 QuizNow/papers/*.json 载入，运行时镜像） */
	examRecords: ExamRecord[];
	/** 各试卷的最高分 name -> score */
	paperBest: Record<string, number>;
	/** 题目 id -> SM-2 卡片 */
	sm: Record<string, SMCard>;
	/** 待复习队列（考试答错的题） */
	reviewIds: string[];
	/** 薄弱点题目 id（必须理解透彻的知识点） */
	weakIds: string[];
	/** 错题笔记：题目 id -> 用户作答错误时写的笔记（复习时同步展示） */
	notes: Record<string, string>;
	/** 是否已初始化过示例题库 */
	seeded?: boolean;
	/** 是否已清理 .obsidian 下的旧数据（避免重复迁移） */
	legacyCleaned?: boolean;
	/** 是否已修正 QuizNow 目录名大小写 */
	folderCaseFixed?: boolean;
}

export function emptyData(): PluginData {
	return {
		version: 2,
		settings: { ...DEFAULT_SETTINGS },
		questions: [],
		questionFiles: {},
		examRecords: [],
		paperBest: {},
		sm: {},
		reviewIds: [],
		weakIds: [],
		notes: {},
	};
}

/** 统计（首页展示） */
export interface Stats {
	questionCount: number;
	wrongCount: number;
	dueReviewCount: number;
	paperCount: number;
}
