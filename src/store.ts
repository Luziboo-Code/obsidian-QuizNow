import { Notice, normalizePath, type Plugin } from "obsidian";
import type {
	ExamRecord,
	ExamSession,
	PluginData,
	Question,
	Settings,
	Stats,
} from "./types";
import { DEFAULT_SETTINGS, emptyData } from "./types";
import { parseQuestion, newId } from "./question";
import { sm2Update, isDue } from "./sm2";
import { setLang, t } from "./i18n";

/**
 * 数据与题库数据库的管理层。
 *
 * 题库使用单一 JSON 文件存储（默认 QuizNow/题库.json），所有题目集中在一个
 * 数据库文件中，不再产生大量细碎的 Markdown 文件；考试记录 / SM-2 卡片 /
 * 复习与薄弱点队列保存在插件 data.json 中。两者均可通过「数据备份」导出。
 */
export class QuizStore {
	private plugin: Plugin;
	data: PluginData = emptyData();
	settings: Settings = { ...DEFAULT_SETTINGS };

	constructor(plugin: Plugin) {
		this.plugin = plugin;
	}

	// ---------- 加载 / 保存 ----------

	async load(): Promise<void> {
		const raw = (await this.plugin.loadData()) as Partial<PluginData> | null;
		const base = emptyData();
		this.data = raw
			? {
					...base,
					...raw,
					questionFiles: {},
					sm: raw.sm || {},
					examRecords: raw.examRecords || [],
					paperBest: raw.paperBest || {},
					reviewIds: raw.reviewIds || [],
					weakIds: raw.weakIds || [],
					questions: raw.questions || [],
			  }
			: base;
		const rawSettings = (raw && raw.settings) as Partial<Settings> | undefined;
		this.settings = {
			...DEFAULT_SETTINGS,
			...(rawSettings || {}),
			includeTypes: {
				...DEFAULT_SETTINGS.includeTypes,
				...(rawSettings?.includeTypes || {}),
			},
		};
		setLang(this.settings.language);

		// 旧版默认路径（中文文件名 .obsidian/quiznow/题库.json）自动切换到英文新默认
		if (this.settings.bankFile === ".obsidian/quiznow/题库.json") {
			this.settings.bankFile = DEFAULT_SETTINGS.bankFile;
		}

		// 旧版数据迁移：优先迁移可见目录下的 JSON 数据库，再迁移更早的 .md 文件夹版
		await this.migrateVisibleBankIfNeeded();
		await this.migrateLegacyBankIfNeeded();
		await this.loadBank();
		// 兜底：数据库为空但旧版 data.json 中残留题目快照时，写回数据库
		if (
			this.data.questions.length === 0 &&
			Array.isArray(raw?.questions) &&
			raw.questions.length > 0
		) {
			this.data.questions = raw.questions.filter(isValidQuestion);
			await this.persistBank();
			await this.save();
		}
		if (!this.data.seeded && this.data.questions.length === 0) {
			await this.seedSample();
			this.data.seeded = true;
			await this.save();
		} else if (!this.data.seeded && this.data.questions.length > 0) {
			this.data.seeded = true;
			await this.save();
		}
	}

	save(): Promise<void> {
		this.data.settings = this.settings;
		return this.plugin.saveData(this.data);
	}

	// ---------- 题库数据库（单文件 JSON） ----------

	/** 题库数据库文件路径 */
	bankPath(): string {
		return normalizePath(this.settings.bankFile || "QuizNow/题库.json");
	}

	/** 确保目录存在（递归创建） */
	private async ensureDir(dir: string): Promise<void> {
		const adapter = this.plugin.app.vault.adapter;
		let cur = "";
		for (const p of dir.split("/").filter(Boolean)) {
			cur = cur ? `${cur}/${p}` : p;
			if (!(await adapter.exists(cur))) {
				await adapter.mkdir(cur);
			}
		}
	}

	/** 确保数据库文件所在目录存在 */
	async ensureBankFile(): Promise<string> {
		const path = this.bankPath();
		const dir = path.split("/").slice(0, -1).join("/");
		if (dir) await this.ensureDir(dir);
		return path;
	}

	/** 从数据库文件读取题目 */
	async loadBank(): Promise<void> {
		try {
			const path = this.bankPath();
			const adapter = this.plugin.app.vault.adapter;
			if (!(await adapter.exists(path))) {
				this.data.questions = [];
				await this.save();
				return;
			}
			const text = await adapter.read(path);
			const parsed = JSON.parse(text) as {
				version?: number;
				questions?: Question[];
			};
			this.data.questions = Array.isArray(parsed?.questions)
				? parsed.questions.filter(isValidQuestion)
				: [];
			await this.save();
		} catch (e) {
			console.error("[QuizNow] 读取题库数据库失败", e);
			new Notice(t("notice.bankReadFail"));
		}
	}

	/** 把内存中的题目整体写回数据库文件（原子、幂等） */
	async persistBank(): Promise<void> {
		const path = await this.ensureBankFile();
		const payload = {
			version: 1,
			questions: this.data.questions,
		};
		await this.plugin.app.vault.adapter.write(
			path,
			JSON.stringify(payload, null, 2)
		);
	}

	/**
	 * 旧版本数据位于库内可见目录（QuizNow/），会显示在文件树中；
	 * 现在默认迁移到 .obsidian 隐藏目录，避免占用文件树。
	 */
	private async migrateVisibleBankIfNeeded(): Promise<void> {
		const adapter = this.plugin.app.vault.adapter;
		const target = this.bankPath();
		// 旧位置候选：早期可见目录版本、以及旧默认中文文件名的隐藏版本
		const candidates = [
			normalizePath("QuizNow/题库.json"),
			normalizePath(".obsidian/quiznow/题库.json"),
		].filter((p) => p !== target);
		let oldPath: string | null = null;
		for (const c of candidates) {
			if (await adapter.exists(c)) {
				oldPath = c;
				break;
			}
		}
		if (await adapter.exists(target)) return; // 新位置已有数据
		try {
			if (!oldPath) return; // 无旧数据
			// 1. 迁移题库数据库
			await this.ensureBankFile();
			const text = await adapter.read(oldPath);
			await adapter.write(target, text);
			await adapter.remove(oldPath);
			// 2. 迁移备份文件
			const oldBackup = normalizePath("QuizNow/backups");
			if (await adapter.exists(oldBackup)) {
				const newBackupDir = this.backupFolder();
				await this.ensureDir(newBackupDir);
				const list = await adapter.list(oldBackup);
				for (const f of list.files) {
					const name = f.split("/").pop() || f;
					await adapter.write(
						normalizePath(`${newBackupDir}/${name}`),
						await adapter.read(f)
					);
					await adapter.remove(f);
				}
				try {
					await adapter.rmdir(oldBackup, false);
				} catch {
					// 忽略删除失败
				}
			}
			// 3. 删除空的旧 QuizNow 目录（非空则保留，避免误删用户文件）
			try {
				await adapter.rmdir(normalizePath("QuizNow"), false);
			} catch {
				// 非空或不存在，忽略
			}
			new Notice(t("notice.movedHidden", { path: target }));
		} catch (e) {
			console.error("[QuizNow] 隐藏目录迁移失败", e);
		}
	}

	/** 旧版题库文件夹（每题目一个 .md）一次性迁移为数据库文件 */
	private async migrateLegacyBankIfNeeded(): Promise<void> {
		const adapter = this.plugin.app.vault.adapter;
		const target = this.bankPath();
		if (await adapter.exists(target)) return;
		const legacy = normalizePath(this.settings.bankFolder || "QuizNow/题库");
		try {
			if (!(await adapter.exists(legacy))) return;
			const list = await adapter.list(legacy);
			const mdFiles = list.files.filter((f) =>
				f.toLowerCase().endsWith(".md")
			);
			if (mdFiles.length === 0) return;
			const questions: Question[] = [];
			for (const f of mdFiles) {
				try {
					const q = parseQuestion(await adapter.read(f), f);
					if (q) questions.push(q);
				} catch {
					// 跳过无法解析的文件
				}
			}
			if (questions.length === 0) return;
			await this.ensureBankFile();
			await adapter.write(
				target,
				JSON.stringify({ version: 1, questions }, null, 2)
			);
			this.data.questions = questions;
			await this.save();
			new Notice(t("notice.migrated", { path: target }));
		} catch {
			// 迁移失败时静默，后续可手动处理
		}
	}

	/** 判断题目是否已在题库 */
	inBank(id: string): boolean {
		return this.data.questions.some((q) => q.id === id);
	}

	/** 把题目加入题库（写入数据库文件） */
	async addToBank(q: Question): Promise<void> {
		if (this.inBank(q.id)) return;
		this.data.questions.push(q);
		await this.persistBank();
		await this.save();
	}

	/** 批量加入题库（只写一次数据库文件） */
	async addManyToBank(qs: Question[]): Promise<number> {
		let added = 0;
		for (const q of qs) {
			if (this.inBank(q.id)) continue;
			this.data.questions.push(q);
			added++;
		}
		if (added > 0) {
			await this.persistBank();
			await this.save();
		}
		return added;
	}

	/** 更新题库中某题的内容 */
	async updateQuestion(q: Question): Promise<void> {
		const idx = this.data.questions.findIndex((x) => x.id === q.id);
		if (idx < 0) return;
		this.data.questions[idx] = q;
		await this.persistBank();
		await this.save();
	}

	/** 从题库删除（数据库 + 内存 + 复习/薄弱队列） */
	async removeFromBank(id: string): Promise<void> {
		this.data.questions = this.data.questions.filter((q) => q.id !== id);
		this.data.reviewIds = this.data.reviewIds.filter((x) => x !== id);
		this.data.weakIds = this.data.weakIds.filter((x) => x !== id);
		delete this.data.sm[id];
		await this.persistBank();
		await this.save();
	}

	/** 删除一条考试记录（同时重算各试卷最高分） */
	async removeExamRecord(id: string): Promise<void> {
		this.data.examRecords = this.data.examRecords.filter((r) => r.id !== id);
		const best: Record<string, number> = {};
		for (const r of this.data.examRecords) {
			best[r.name] = Math.max(best[r.name] ?? 0, r.score);
		}
		this.data.paperBest = best;
		await this.save();
	}

	// ---------- 考试 ----------

	/** 记录一次考试：答错的题自动入库并进入复习队列（薄弱点模式则不重复入队，走薄弱点 SM-2） */
	async recordExam(
		session: ExamSession,
		name: string,
		opts?: { weakMode?: boolean }
	): Promise<ExamRecord> {
		const answers = Object.values(session.answers);
		const total = session.questions.length;
		const correct = answers.filter((a) => a.correct).length;
		const score =
			this.settings.scoreMode === "points"
				? correct * this.settings.pointsPerQuestion
				: Math.round((correct / Math.max(1, total)) * 100);

		const wrongIds = answers.filter((a) => !a.correct).map((a) => a.questionId);
		const record: ExamRecord = {
			id: newId(),
			name: name || `${new Date().toLocaleString()} ${t("exam.name.auto")}`,
			date: Date.now(),
			total,
			correct,
			score,
			wrongIds,
		};
		this.data.examRecords.push(record);
		this.data.paperBest[record.name] = Math.max(
			this.data.paperBest[record.name] ?? 0,
			score
		);

		// 答错的题自动加入题库（保证可复习）
		const toSave = session.questions.filter(
			(q) => wrongIds.includes(q.id) && !this.inBank(q.id)
		);
		if (toSave.length > 0) {
			for (const q of toSave) this.data.questions.push(q);
			await this.persistBank();
		}

		if (opts?.weakMode) {
			// 薄弱点模式：按 SM-2 更新每个薄弱点题目的记忆状态
			for (const q of session.questions) {
				const a = session.answers[q.id];
				await this.markWeakResult(q, !!a?.correct, a?.correct ? 4 : 0);
			}
		} else {
			for (const id of wrongIds) {
				if (!this.data.reviewIds.includes(id) && !this.data.weakIds.includes(id)) {
					this.data.reviewIds.push(id);
				}
			}
		}
		await this.save();
		return record;
	}

	// ---------- 复习 / 薄弱点 ----------

	/** 到期待复习的题目（按 SM-2 卡片筛选） */
	dueReviewQuestions(): Question[] {
		return this.data.reviewIds
			.map((id) => this.data.questions.find((q) => q.id === id))
			.filter((q): q is Question => !!q && isDue(this.data.sm[q.id]));
	}

	/** 复习作答结果：答错 -> 移入薄弱点；答对 -> 按 SM-2 排期 */
	async markReviewResult(q: Question, correct: boolean, grade: number): Promise<void> {
		if (correct) {
			this.data.sm[q.id] = sm2Update(
				this.data.sm[q.id],
				grade,
				this.settings.sm2InitialEF,
				this.settings.sm2MinInterval
			);
		} else {
			// 再次答错 -> 薄弱点
			this.data.reviewIds = this.data.reviewIds.filter((x) => x !== q.id);
			if (!this.data.weakIds.includes(q.id)) this.data.weakIds.push(q.id);
			this.data.sm[q.id] = sm2Update(
				this.data.sm[q.id],
				0,
				this.settings.sm2InitialEF,
				this.settings.sm2MinInterval
			);
		}
		await this.save();
	}

	/** 薄弱点答题结果：连续答对 weakMasteryReps 次则移出薄弱点 */
	async markWeakResult(q: Question, correct: boolean, grade: number): Promise<"keep" | "mastered"> {
		this.data.sm[q.id] = sm2Update(
			this.data.sm[q.id],
			correct ? grade : 0,
			this.settings.sm2InitialEF,
			this.settings.sm2MinInterval
		);
		let result: "keep" | "mastered" = "keep";
		if (correct) {
			const card = this.data.sm[q.id];
			if (card.reps >= this.settings.weakMasteryReps) {
				this.data.weakIds = this.data.weakIds.filter((x) => x !== q.id);
				result = "mastered";
			}
		}
		await this.save();
		return result;
	}

	/** 从薄弱点手动移出（掌握） */
	async removeFromWeak(id: string): Promise<void> {
		this.data.weakIds = this.data.weakIds.filter((x) => x !== id);
		await this.save();
	}

	// ---------- 统计 ----------

	stats(): Stats {
		const wrongSet = new Set([...this.data.reviewIds, ...this.data.weakIds]);
		const dueCount = this.data.reviewIds.filter((id) =>
			isDue(this.data.sm[id])
		).length;
		return {
			questionCount: this.data.questions.length,
			wrongCount: wrongSet.size,
			dueReviewCount: dueCount,
			paperCount: Object.keys(this.data.paperBest).length,
		};
	}

	/** 各试卷最高分（用于首页卡片） */
	paperCards(): { name: string; best: number; count: number; lastDate: number }[] {
		const map = new Map<
			string,
			{ name: string; best: number; count: number; lastDate: number }
		>();
		for (const r of this.data.examRecords) {
			const cur = map.get(r.name) || {
				name: r.name,
				best: 0,
				count: 0,
				lastDate: 0,
			};
			cur.best = Math.max(cur.best, r.score);
			cur.count += 1;
			cur.lastDate = Math.max(cur.lastDate, r.date);
			map.set(r.name, cur);
		}
		return [...map.values()].sort((a, b) => b.lastDate - a.lastDate);
	}

	// ---------- 设置 ----------

	async updateSettings(patch: Partial<Settings>): Promise<void> {
		this.settings = {
			...this.settings,
			...patch,
			includeTypes: {
				...this.settings.includeTypes,
				...(patch.includeTypes || {}),
			},
		};
		setLang(this.settings.language);
		await this.save();
		await this.loadBank(); // 题库数据库路径可能变化
	}

	// ---------- 备份 / 恢复 ----------

	/** 备份目录（数据库文件同级的 backups 子目录） */
	backupFolder(): string {
		const dir = this.bankPath().split("/").slice(0, -1).join("/");
		return normalizePath(`${dir}/backups`);
	}

	/** 导出完整数据（题库 + 记录 + 记忆 + 设置）为一个备份文件 */
	async createBackup(): Promise<string> {
		const adapter = this.plugin.app.vault.adapter;
		const folder = this.backupFolder();
		await this.ensureDir(folder);
		const stamp = backupStamp();
		const path = normalizePath(`${folder}/quiznow-backup-${stamp}.json`);
		const payload = {
			app: "obsidian-quiznow",
			backupVersion: 1,
			createdAt: Date.now(),
			data: this.data,
			settings: this.settings,
		};
		await adapter.write(path, JSON.stringify(payload, null, 2));
		return path;
	}

	/** 列出所有备份文件（按时间倒序） */
	async listBackups(): Promise<{ path: string; name: string; date: number }[]> {
		const adapter = this.plugin.app.vault.adapter;
		const folder = this.backupFolder();
		if (!(await adapter.exists(folder))) return [];
		const list = await adapter.list(folder);
		const out: { path: string; name: string; date: number }[] = [];
		for (const f of list.files) {
			const base = f.split("/").pop() || f;
			const m = base.match(/^quiznow-backup-(\d{8}-\d{6})\.json$/);
			if (!m) continue;
			const date = parseBackupStamp(m[1]);
			out.push({ path: f, name: base, date });
		}
		return out.sort((a, b) => b.date - a.date);
	}

	/** 从备份文件恢复（恢复前自动备份当前数据） */
	async restoreBackup(path: string): Promise<void> {
		const adapter = this.plugin.app.vault.adapter;
		const text = await adapter.read(path);
		const payload = JSON.parse(text) as {
			app?: string;
			data?: Partial<PluginData>;
			settings?: Partial<Settings>;
		};
		if (payload?.app !== "obsidian-quiznow" || !payload.data) {
			throw new Error(t("notice.backupInvalid"));
		}
		// 恢复前自动备份当前数据，避免误操作丢失
		await this.createBackup();

		const d = payload.data;
		this.data = {
			...emptyData(),
			...d,
			questionFiles: {},
			questions: Array.isArray(d.questions) ? d.questions : [],
			sm: d.sm || {},
			examRecords: d.examRecords || [],
			paperBest: d.paperBest || {},
			reviewIds: d.reviewIds || [],
			weakIds: d.weakIds || [],
		};
		const s = payload.settings || {};
		this.settings = {
			...DEFAULT_SETTINGS,
			...s,
			includeTypes: {
				...DEFAULT_SETTINGS.includeTypes,
				...(s.includeTypes || {}),
			},
		};
		setLang(this.settings.language);
		await this.persistBank();
		await this.save();
	}

	// ---------- 样例 ----------

	/** 首次使用：写入几条示例题目，展示格式 */
	private async seedSample(): Promise<void> {
		const samples: Question[] = [
			{
				id: "sample-single-001",
				type: "single",
				content: "间隔复习算法 SM-2 中，难度系数 EF 的最小值是多少？",
				options: ["1.0", "1.3", "1.5", "2.0"],
				answer: ["B"],
				explanation: "SM-2 中 EF 下限为 1.3，防止难度系数无限下降。",
				source: "示例题目",
				createdAt: Date.now(),
			},
			{
				id: "sample-fill-001",
				type: "fill",
				content: "SM-2 算法由 ____ 提出，用于优化间隔复习的复习时间。",
				answer: ["SuperMemo", "super memo", "supermemo"],
				explanation: "SM-2 出自 SuperMemo 项目（Piotr Woźniak）。",
				source: "示例题目",
				createdAt: Date.now(),
			},
			{
				id: "sample-judge-001",
				type: "judge",
				content: "判断题：在 SM-2 中，答对后若连续两次正确，复习间隔会显著拉长。",
				answer: ["T"],
				explanation: "SM-2 中第 1 次间隔 1 天、第 2 次 6 天，之后按 EF 指数增长。",
				source: "示例题目",
				createdAt: Date.now(),
			},
		];
		this.data.questions = samples;
		await this.persistBank();
		new Notice(t("notice.seeded"));
	}
}

function isValidQuestion(q: Question | undefined | null): q is Question {
	return (
		!!q &&
		typeof q === "object" &&
		typeof q.id === "string" &&
		typeof q.content === "string" &&
		Array.isArray(q.answer) &&
		(q.type === "single" ||
			q.type === "multiple" ||
			q.type === "fill" ||
			q.type === "judge")
	);
}

function backupStamp(): string {
	const d = new Date();
	const p = (n: number) => String(n).padStart(2, "0");
	return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(
		d.getHours()
	)}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function parseBackupStamp(stamp: string): number {
	const m = stamp.match(/^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})$/);
	if (!m) return 0;
	return new Date(
		+m[1],
		+m[2] - 1,
		+m[3],
		+m[4],
		+m[5],
		+m[6]
	).getTime();
}
