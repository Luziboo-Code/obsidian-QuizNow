import { Notice, Platform, normalizePath, type Plugin } from "obsidian";
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
 * QuizNow 数据目录（库根目录下的可见文件夹）。
 *
 * 所有数据都集中在这一个文件夹里，方便整体迁移 / 同步 / 备份：
 *   QuizNow/questions.json       题库数据库（所有题目）
 *   QuizNow/data.json            全局设置 + 复习进度 + 薄弱点 + 错题笔记
 *   QuizNow/papers/*.json        每次考试的试卷快照（含逐题作答结果）
 *   QuizNow/backups/*.json       一键备份
 *
 * 插件不再使用 .obsidian 下的 data.json 保存配置（首次启动会自动迁移并清理）。
 */
export const QUIZ_FOLDER = "QuizNow";
const BANK_FILE_NAME = "questions.json";
const DATA_FILE_NAME = "data.json";
const PAPERS_DIR = "papers";
const BACKUPS_DIR = "backups";
/** 备份/数据文件标识（兼容旧版小写标识） */
const BACKUP_MARKER = "obsidian-QuizNow";
const BACKUP_MARKERS = ["obsidian-QuizNow", "obsidian-quiznow"];
const BACKUP_FILE_RE = /^quiznow-backup-(\d{8}-\d{6})\.json$/i;

/** 桌面端 Node fs 的最小接口（仅用于清理隐藏配置目录中的旧文件） */
interface FsLike {
	existsSync(p: string): boolean;
	readFileSync(p: string, encoding: string): string;
	rmSync(p: string, opts?: { force?: boolean; recursive?: boolean }): void;
	rmdirSync(p: string): void;
}

export class QuizStore {
	private plugin: Plugin;
	data: PluginData = emptyData();
	settings: Settings = { ...DEFAULT_SETTINGS };
	/** 数据文件写入队列（保证并发保存按顺序落盘） */
	private writeQueue: Promise<void> = Promise.resolve();

	constructor(plugin: Plugin) {
		this.plugin = plugin;
	}

	// ---------- 加载 / 保存 ----------

	async load(): Promise<void> {
		// 1. 读取 QuizNow/data.json；不存在则由 .obsidian 下的旧数据迁移而来
		const raw = await this.readJson<Record<string, unknown>>(this.dataPath());
		/** 旧版 data.json 中残留的题目快照（题库文件缺失时兜底写回） */
		let pendingQuestions: Question[] = [];
		/** 旧版 data.json 内嵌的考试记录（迁移为 QuizNow/papers 下的独立文件） */
		let pendingRecords: ExamRecord[] = [];
		if (raw) {
			this.applyData(raw);
			pendingRecords = collectRecords(raw);
		} else {
			const legacy = (await this.plugin.loadData()) as Record<string, unknown> | null;
			if (legacy && hasLegacyContent(legacy)) {
				this.applyData(legacy);
				pendingQuestions = Array.isArray(legacy.questions)
					? (legacy.questions as Question[]).filter(isValidQuestion)
					: [];
				pendingRecords = collectRecords(legacy);
				// 先把数据落到 QuizNow/data.json，再清理 .obsidian 中的旧配置
				this.data.legacyCleaned = false;
				await this.save();
				new Notice(t("notice.dataMoved", { path: this.dataPath() }));
			}
		}

		// 2. 修正历史遗留的小写目录名 quiznow → QuizNow（仅大小写差异时）
		if (!this.data.folderCaseFixed) {
			if (await this.fixFolderCase()) {
				this.data.folderCaseFixed = true;
				await this.save();
			}
		}

		// 旧版默认路径（configDir 隐藏目录下的 questions.json / 中文文件名 题库.json）自动切换到新默认
		const cfgDir = this.plugin.app.vault.configDir;
		if (
			this.settings.bankFile === normalizePath(`${cfgDir}/quiznow/questions.json`) ||
			this.settings.bankFile === normalizePath(`${cfgDir}/quiznow/题库.json`)
		) {
			this.settings.bankFile = "";
		}

		// 3. 载入题库（必要时从旧位置迁移）
		await this.migrateLegacyBankIfNeeded();
		await this.migrateLegacyBankFolder();
		await this.loadBank();
		if (this.data.questions.length === 0 && pendingQuestions.length > 0) {
			this.data.questions = pendingQuestions;
			await this.persistBank();
			await this.save();
		}

		// 4. 合并 .obsidian 下残留的旧题库，并清理旧配置目录
		await this.importLegacyHiddenBank();
		await this.cleanupLegacyStorage();

		// 5. 载入试卷快照，并把旧数据中的考试记录落盘为独立试卷文件
		await this.loadPapers();
		await this.importLegacyRecords(pendingRecords);

		if (!this.data.seeded && this.data.questions.length === 0) {
			await this.seedSample();
			this.data.seeded = true;
			await this.save();
		} else if (!this.data.seeded && this.data.questions.length > 0) {
			this.data.seeded = true;
			await this.save();
		}
	}

	/** 把持久化数据应用到内存（设置 + 进度；题目与试卷分别由各自文件载入） */
	private applyData(raw: Record<string, unknown>): void {
		const base = emptyData();
		const d = raw as Partial<PluginData>;
		this.data = {
			...base,
			...d,
			questionFiles: {},
			sm: d.sm || {},
			// 试卷由 papers 目录载入，这里不信任 data.json 中的旧副本
			examRecords: [],
			paperBest: d.paperBest || {},
			reviewIds: d.reviewIds || [],
			weakIds: d.weakIds || [],
			notes: d.notes || {},
			questions: [],
		};
		const rawSettings = (raw.settings || {}) as Partial<Settings>;
		this.settings = {
			...DEFAULT_SETTINGS,
			...rawSettings,
			includeTypes: {
				...DEFAULT_SETTINGS.includeTypes,
				...(rawSettings.includeTypes || {}),
			},
		};
		setLang(this.settings.language);
	}

	save(): Promise<void> {
		// 串行化写入：并发的自动保存不会相互覆盖，且每次写入都取写入时刻的最新状态
		const next = this.writeQueue.then(() => this.writeDataFile());
		this.writeQueue = next.catch(() => undefined);
		return next;
	}

	/** 写入 QuizNow/data.json（设置 + 复习进度；题目与试卷各存各的文件） */
	private async writeDataFile(): Promise<void> {
		this.data.settings = this.settings;
		const payload = {
			version: 2,
			settings: this.settings,
			questionFiles: {},
			paperBest: this.data.paperBest,
			sm: this.data.sm,
			reviewIds: this.data.reviewIds,
			weakIds: this.data.weakIds,
			notes: this.data.notes,
			seeded: this.data.seeded,
			legacyCleaned: this.data.legacyCleaned,
			folderCaseFixed: this.data.folderCaseFixed,
		};
		await this.writeJson(this.dataPath(), payload);
	}

	// ---------- 路径 ----------

	/** QuizNow 数据目录（库根目录，整体可迁移） */
	folderPath(): string {
		return normalizePath(QUIZ_FOLDER);
	}

	/** 全局数据文件（设置 + 进度） */
	dataPath(): string {
		return normalizePath(`${QUIZ_FOLDER}/${DATA_FILE_NAME}`);
	}

	/** 题库数据库文件路径（默认：QuizNow/questions.json） */
	bankPath(): string {
		if (this.settings.bankFile && this.settings.bankFile.trim()) {
			return normalizePath(this.settings.bankFile);
		}
		return normalizePath(`${QUIZ_FOLDER}/${BANK_FILE_NAME}`);
	}

	/** 试卷快照目录（每次考试一个 JSON 文件） */
	papersFolder(): string {
		return normalizePath(`${QUIZ_FOLDER}/${PAPERS_DIR}`);
	}

	/** 备份目录 */
	backupFolder(): string {
		return normalizePath(`${QUIZ_FOLDER}/${BACKUPS_DIR}`);
	}

	// ---------- 基础文件操作 ----------

	private get adapter() {
		return this.plugin.app.vault.adapter;
	}

	/** 确保目录存在（递归创建） */
	private async ensureDir(dir: string): Promise<void> {
		let cur = "";
		for (const p of dir.split("/").filter(Boolean)) {
			cur = cur ? `${cur}/${p}` : p;
			if (!(await this.adapter.exists(cur))) {
				await this.adapter.mkdir(cur);
			}
		}
	}

	private async readJson<T>(path: string): Promise<T | null> {
		try {
			const text = await this.readText(path);
			if (!text || !text.trim()) return null;
			const parsed = JSON.parse(text) as T | null;
			return parsed ?? null;
		} catch (e) {
			console.error(`[QuizNow] 读取 ${path} 失败`, e);
			return null;
		}
	}

	private async writeJson(path: string, value: unknown): Promise<void> {
		const dir = path.split("/").slice(0, -1).join("/");
		if (dir) await this.ensureDir(dir);
		await this.adapter.write(path, JSON.stringify(value, null, 2));
	}

	/**
	 * 判断文件/目录是否存在。
	 * 隐藏配置目录（.obsidian）在部分环境下无法通过 vault 适配器访问，此时退回桌面端 Node fs。
	 */
	private async fileExists(path: string): Promise<boolean> {
		const target = normalizePath(path);
		try {
			return await this.adapter.exists(target);
		} catch {
			// 退回 Node fs
		}
		const fs = await desktopFs();
		const full = this.absolutePath(target);
		if (fs && full) {
			try {
				return fs.existsSync(full);
			} catch {
				return false;
			}
		}
		return false;
	}

	/** 读取文本文件（适配器优先，失败时退回 Node fs，用于隐藏配置目录） */
	private async readText(path: string): Promise<string | null> {
		const target = normalizePath(path);
		try {
			if (await this.adapter.exists(target)) {
				return await this.adapter.read(target);
			}
			return null;
		} catch {
			// 退回 Node fs
		}
		const fs = await desktopFs();
		const full = this.absolutePath(target);
		if (fs && full) {
			try {
				if (fs.existsSync(full)) return fs.readFileSync(full, "utf8");
			} catch {
				return null;
			}
		}
		return null;
	}

	/** 删除一个文件（先走 vault 适配器，失败再退回桌面端 Node fs） */
	private async removeFileQuietly(path: string): Promise<boolean> {
		const target = normalizePath(path);
		try {
			if (await this.adapter.exists(target)) {
				await this.adapter.remove(target);
			}
			return true;
		} catch {
			// 继续尝试其它方式
		}
		const fs = await desktopFs();
		const full = this.absolutePath(target);
		if (fs && full) {
			try {
				if (fs.existsSync(full)) fs.rmSync(full, { force: true });
				return true;
			} catch {
				// 忽略
			}
		}
		return false;
	}

	/** 把库内相对路径转为磁盘绝对路径（桌面端；移动端返回 null） */
	private absolutePath(path: string): string | null {
		const adapter = this.adapter as unknown as {
			getFullPath?: (p: string) => string;
			getBasePath?: () => string;
		};
		try {
			if (typeof adapter.getFullPath === "function") {
				return adapter.getFullPath(path);
			}
			if (typeof adapter.getBasePath === "function") {
				const base = adapter.getBasePath().replace(/[\\/]+$/, "");
				return `${base}/${path}`;
			}
		} catch {
			// 忽略
		}
		return null;
	}

	private async removeDirQuietly(dir: string): Promise<void> {
		const target = normalizePath(dir);
		try {
			if (await this.adapter.exists(target)) {
				await this.adapter.rmdir(target, false);
			}
			return;
		} catch {
			// 退回 Node fs
		}
		const fs = await desktopFs();
		const full = this.absolutePath(target);
		if (fs && full) {
			try {
				if (fs.existsSync(full)) fs.rmdirSync(full);
			} catch {
				// 非空或不存在，忽略
			}
		}
	}

	// ---------- 题库数据库 ----------

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
			const parsed = await this.readJson<{ questions?: Question[] }>(
				this.bankPath()
			);
			if (!parsed) {
				this.data.questions = [];
				await this.save();
				return;
			}
			this.data.questions = Array.isArray(parsed.questions)
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
		await this.adapter.write(
			path,
			JSON.stringify({ version: 1, questions: this.data.questions }, null, 2)
		);
	}

	/**
	 * 历史版本的数据位置（可见的 QuizNow/ 目录、configDir 隐藏目录下的中文/英文文件名）
	 * 统一迁移到新默认：库根目录下的 QuizNow/questions.json。
	 */
	private async migrateLegacyBankIfNeeded(): Promise<void> {
		const target = this.bankPath();
		if (await this.adapter.exists(target)) return; // 新位置已有数据
		const configDir = this.plugin.app.vault.configDir;
		const candidates = [
			normalizePath(`${configDir}/quiznow/questions.json`),
			normalizePath(`${configDir}/quiznow/题库.json`),
			normalizePath("QuizNow/题库.json"),
			normalizePath("quiznow/questions.json"),
			normalizePath("quiznow/题库.json"),
		].filter((p) => p !== target);
		let oldPath: string | null = null;
		for (const c of candidates) {
			if (await this.adapter.exists(c)) {
				oldPath = c;
				break;
			}
		}
		if (!oldPath) return; // 无旧数据
		try {
			await this.ensureBankFile();
			const text = await this.adapter.read(oldPath);
			await this.adapter.write(target, text);
			await this.removeFileQuietly(oldPath);
			new Notice(t("notice.movedRoot", { path: target }));
		} catch (e) {
			console.error("[QuizNow] 题库数据迁移失败", e);
		}
	}

	/** 旧版题库文件夹（每题目一个 .md）一次性迁移为数据库文件 */
	private async migrateLegacyBankFolder(): Promise<void> {
		const target = this.bankPath();
		if (await this.adapter.exists(target)) return;
		const legacy = normalizePath(this.settings.bankFolder || "QuizNow/题库");
		try {
			if (!(await this.adapter.exists(legacy))) return;
			const list = await this.adapter.list(legacy);
			const mdFiles = list.files.filter((f) => f.toLowerCase().endsWith(".md"));
			if (mdFiles.length === 0) return;
			const questions: Question[] = [];
			for (const f of mdFiles) {
				try {
					const q = parseQuestion(await this.adapter.read(f), f);
					if (q) questions.push(q);
				} catch {
					// 跳过无法解析的文件
				}
			}
			if (questions.length === 0) return;
			await this.ensureBankFile();
			await this.adapter.write(
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

	/**
	 * 合并 .obsidian/quiznow 下残留的旧题库（历史版本写入隐藏目录的题目），
	 * 随后删除该文件，保证所有试题都集中在 QuizNow 文件夹里。
	 */
	private async importLegacyHiddenBank(): Promise<void> {
		const configDir = this.plugin.app.vault.configDir;
		const legacyDir = normalizePath(`${configDir}/quiznow`);
		const candidates = ["questions.json", "题库.json"].map((n) =>
			normalizePath(`${legacyDir}/${n}`)
		);
		let merged = 0;
		let found = false;
		for (const path of candidates) {
			const parsed = await this.readJson<{ questions?: Question[] }>(path);
			if (!parsed) continue;
			found = true;
			const incoming = Array.isArray(parsed.questions)
				? parsed.questions.filter(isValidQuestion)
				: [];
			const known = new Set(this.data.questions.map((q) => q.id));
			for (const q of incoming) {
				if (known.has(q.id)) continue;
				this.data.questions.push(q);
				known.add(q.id);
				merged++;
			}
			await this.removeFileQuietly(path);
		}
		if (merged > 0) {
			await this.persistBank();
			await this.save();
			new Notice(t("notice.legacyMerged", { n: merged }));
		}
		if (found) await this.removeDirQuietly(legacyDir);
	}

	/**
	 * 清理 .obsidian 下的旧数据：插件目录中的 data.json（设置/成绩/进度）
	 * 现已全部迁到 QuizNow/data.json，删除后不再占用隐藏配置。
	 */
	private async cleanupLegacyStorage(): Promise<void> {
		if (this.data.legacyCleaned) return;
		const configDir = this.plugin.app.vault.configDir;
		const pluginDir =
			this.plugin.manifest.dir ||
			normalizePath(`${configDir}/plugins/${this.plugin.manifest.id}`);
		const legacyData = normalizePath(`${pluginDir}/data.json`);
		const hadLegacy = await this.fileExists(legacyData);
		if (!hadLegacy) {
			this.data.legacyCleaned = true;
			await this.save();
			return;
		}
		const removed = await this.removeFileQuietly(legacyData);
		if (!removed) {
			// 桌面端失败时用官方接口清空（不再保留任何配置内容）
			try {
				await this.plugin.saveData(null);
			} catch {
				// 忽略
			}
			console.warn("[QuizNow] 未能删除旧 data.json，已清空其内容");
		}
		this.data.legacyCleaned = true;
		await this.save();
	}

	/** 修正历史遗留的小写目录名 quiznow → QuizNow（仅大小写差异）；成功返回 true */
	private async fixFolderCase(): Promise<boolean> {
		const target = QUIZ_FOLDER;
		try {
			if (!(await this.adapter.exists(target))) return true; // 目录尚未创建，无需修正
			// 目录已存在（Windows/macOS 上大小写不敏感）：两段重命名修正磁盘上的显示名
			const tmp = `${target}__casefix__`;
			await this.adapter.rename(target, tmp);
			await this.adapter.rename(tmp, target);
			return true;
		} catch (e) {
			console.warn(
				`[QuizNow] 目录名大小写修正失败，可手动把 ${target.toLowerCase()}/ 改名为 ${target}/`,
				e
			);
			return false;
		}
	}

	// ---------- 试卷（每次考试一个文件） ----------

	/** 载入 QuizNow/papers 下的所有试卷快照 */
	async loadPapers(): Promise<void> {
		const dir = this.papersFolder();
		const records: ExamRecord[] = [];
		try {
			if (await this.adapter.exists(dir)) {
				const list = await this.adapter.list(dir);
				for (const f of list.files) {
					if (!f.toLowerCase().endsWith(".json")) continue;
					const rec = await this.readJson<ExamRecord>(f);
					if (!isValidRecord(rec)) continue;
					rec.file = f;
					records.push(rec);
				}
			}
		} catch (e) {
			console.error("[QuizNow] 读取试卷记录失败", e);
		}
		records.sort((a, b) => b.date - a.date);
		this.data.examRecords = records;
		this.data.paperBest = computePaperBest(records);
	}

	/** 试卷文件路径：QuizNow/papers/20260910-121751 试卷名 id.json */
	private paperPath(rec: ExamRecord): string {
		const stamp = fileStamp(rec.date);
		const name = safeFileName(rec.name) || "paper";
		return normalizePath(`${this.papersFolder()}/${stamp} ${name} ${rec.id}.json`);
	}

	/**
	 * 把旧数据（data.json 内嵌的 examRecords）中的考试记录迁移为
	 * QuizNow/papers 下的独立试卷文件（按 id 去重，已存在则跳过）。
	 */
	private async importLegacyRecords(records: ExamRecord[]): Promise<void> {
		if (records.length === 0) return;
		const existing = new Set(this.data.examRecords.map((r) => r.id));
		let added = 0;
		for (const rec of records) {
			if (existing.has(rec.id)) continue;
			rec.file = undefined;
			await this.savePaper(rec);
			this.data.examRecords.push(rec);
			existing.add(rec.id);
			added++;
		}
		if (added > 0) {
			this.data.examRecords.sort((a, b) => b.date - a.date);
			this.data.paperBest = computePaperBest(this.data.examRecords);
			await this.save();
		}
	}

	/** 写入一份试卷快照（重考/新考试各留一份文件，便于整体迁移与查阅） */
	private async savePaper(rec: ExamRecord): Promise<void> {
		const path = rec.file || this.paperPath(rec);
		rec.file = path;
		await this.writeJson(path, rec);
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

	/** 删除一条考试记录（同时删除试卷文件并重算各试卷最高分） */
	async removeExamRecord(id: string): Promise<void> {
		const rec = this.data.examRecords.find((r) => r.id === id);
		if (rec?.file) await this.removeFileQuietly(rec.file);
		this.data.examRecords = this.data.examRecords.filter((r) => r.id !== id);
		this.data.paperBest = computePaperBest(this.data.examRecords);
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
		// 保存完整试卷快照（深拷贝，避免引用后续变化），用于历史记录还原试卷内容与重考
		const snapshot = session.questions.map((q) => {
			const a = session.answers[q.id];
			return {
				question: {
					...q,
					options: q.options ? [...q.options] : undefined,
					answer: [...q.answer],
				},
				userAnswer: a ? [...a.userAnswer] : [],
				correct: !!a?.correct,
			};
		});
		const record: ExamRecord = {
			id: newId(),
			name: name || `${new Date().toLocaleString()} ${t("exam.name.auto")}`,
			date: Date.now(),
			total,
			correct,
			score,
			wrongIds,
			snapshot,
		};
		await this.savePaper(record);
		this.data.examRecords.push(record);
		this.data.examRecords.sort((a, b) => b.date - a.date);
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

	// ---------- 错题笔记 ----------

	/** 读取某题的错题笔记（无则空字符串） */
	getNote(questionId: string): string {
		return this.data.notes?.[questionId] ?? "";
	}

	/** 保存错题笔记（空内容 = 删除该题笔记） */
	async saveNote(questionId: string, text: string): Promise<void> {
		const v = (text || "").trim();
		if (!this.data.notes) this.data.notes = {};
		if (v) this.data.notes[questionId] = v;
		else delete this.data.notes[questionId];
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
		const bankChanged =
			patch.bankFile !== undefined &&
			patch.bankFile !== this.settings.bankFile;
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
		// 仅题库数据库路径变化时才重读题库
		if (bankChanged) await this.loadBank();
	}

	// ---------- 备份 / 恢复 ----------

	/** 导出完整数据（题库 + 成绩记录 + 记忆进度 + 设置）为一个备份文件 */
	async createBackup(): Promise<string> {
		const folder = this.backupFolder();
		await this.ensureDir(folder);
		const stamp = backupStamp();
		const path = normalizePath(`${folder}/QuizNow-backup-${stamp}.json`);
		const payload = {
			app: BACKUP_MARKER,
			backupVersion: 3,
			createdAt: Date.now(),
			summary: {
				questions: this.data.questions.length,
				examRecords: this.data.examRecords.length,
				reviewQueue: this.data.reviewIds.length,
				weakSpots: this.data.weakIds.length,
			},
			data: {
				...this.data,
				questions: this.data.questions,
				examRecords: this.data.examRecords,
			},
			settings: this.settings,
		};
		await this.writeJson(path, payload);
		return path;
	}

	/** 删除一个备份文件 */
	async deleteBackup(path: string): Promise<void> {
		await this.removeFileQuietly(path);
	}

	/** 列出所有备份文件（按时间倒序） */
	async listBackups(): Promise<{ path: string; name: string; date: number }[]> {
		const folder = this.backupFolder();
		if (!(await this.adapter.exists(folder))) return [];
		const list = await this.adapter.list(folder);
		const out: { path: string; name: string; date: number }[] = [];
		for (const f of list.files) {
			const base = f.split("/").pop() || f;
			const m = base.match(BACKUP_FILE_RE);
			if (!m) continue;
			out.push({ path: f, name: base, date: parseBackupStamp(m[1]) });
		}
		return out.sort((a, b) => b.date - a.date);
	}

	/** 从备份文件恢复（恢复前自动备份当前数据） */
	async restoreBackup(path: string): Promise<void> {
		const payload = await this.readJson<{
			app?: string;
			data?: Partial<PluginData>;
			settings?: Partial<Settings>;
		}>(path);
		if (!payload?.data || !BACKUP_MARKERS.includes(payload.app ?? "")) {
			throw new Error(t("notice.backupInvalid"));
		}
		// 恢复前自动备份当前数据，避免误操作丢失
		await this.createBackup();

		const d = payload.data;
		const restoredQuestions = Array.isArray(d.questions)
			? d.questions.filter(isValidQuestion)
			: [];
		const restoredRecords = Array.isArray(d.examRecords)
			? d.examRecords.filter(isValidRecord)
			: [];

		this.data = {
			...emptyData(),
			...d,
			questionFiles: {},
			questions: restoredQuestions,
			examRecords: [],
			paperBest: {},
			sm: d.sm || {},
			reviewIds: d.reviewIds || [],
			weakIds: d.weakIds || [],
			notes: d.notes || {},
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
		// 清空旧试卷文件后按备份重建
		await this.clearPapersFolder();
		for (const rec of restoredRecords) {
			rec.file = undefined;
			await this.savePaper(rec);
			this.data.examRecords.push(rec);
		}
		this.data.examRecords.sort((a, b) => b.date - a.date);
		this.data.paperBest = computePaperBest(this.data.examRecords);
		await this.save();
	}

	/** 清空试卷目录（恢复备份前调用） */
	private async clearPapersFolder(): Promise<void> {
		const dir = this.papersFolder();
		try {
			if (!(await this.adapter.exists(dir))) return;
			const list = await this.adapter.list(dir);
			for (const f of list.files) await this.removeFileQuietly(f);
			for (const d of list.folders) await this.removeDirQuietly(d);
		} catch {
			// 忽略
		}
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
		new Notice(t("notice.seeded", { path: this.bankPath() }));
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

function isValidRecord(r: ExamRecord | null | undefined): r is ExamRecord {
	return (
		!!r &&
		typeof r === "object" &&
		typeof r.id === "string" &&
		typeof r.name === "string" &&
		typeof r.date === "number" &&
		typeof r.score === "number"
	);
}

/** 旧版 data.json 是否含有需要迁移的内容 */
function hasLegacyContent(raw: Record<string, unknown>): boolean {
	const hasSettings = !!raw.settings && typeof raw.settings === "object";
	const hasQuestions = Array.isArray(raw.questions) && raw.questions.length > 0;
	const hasRecords = Array.isArray(raw.examRecords) && raw.examRecords.length > 0;
	return hasSettings || hasQuestions || hasRecords;
}

/** 从持久化数据中取出内嵌的考试记录（旧格式） */
function collectRecords(raw: Record<string, unknown>): ExamRecord[] {
	return Array.isArray(raw.examRecords)
		? (raw.examRecords as ExamRecord[]).filter(isValidRecord)
		: [];
}

/** 由试卷记录计算每份试卷的最高分 */
function computePaperBest(records: ExamRecord[]): Record<string, number> {
	const best: Record<string, number> = {};
	for (const r of records) {
		best[r.name] = Math.max(best[r.name] ?? 0, r.score);
	}
	return best;
}

/** 桌面端 fs 模块缓存（用于访问隐藏配置目录；移动端恒为 null） */
let desktopFsPromise: Promise<FsLike | null> | null = null;

/**
 * 取桌面端 Node fs（仅在需要访问隐藏配置目录时才加载；移动端返回 null）。
 * 依次尝试：Electron 渲染进程的 window.require → 模块级 require（Obsidian 以 CJS 加载插件）
 * → 动态 import。
 */
async function desktopFs(): Promise<FsLike | null> {
	if (!Platform.isDesktopApp) return null;
	if (desktopFsPromise) return desktopFsPromise;
	desktopFsPromise = (async (): Promise<FsLike | null> => {
		try {
			const req = (window as unknown as { require?: (id: string) => unknown })
				.require;
			if (typeof req === "function") return req("fs") as FsLike;
		} catch {
			// 尝试下一种方式
		}
		try {
			// eslint-disable-next-line @typescript-eslint/no-require-imports -- Obsidian 桌面端以 CommonJS 加载插件，Node 模块仅在运行时可用
			return require("fs") as FsLike;
		} catch {
			// 尝试下一种方式
		}
		try {
			return (await import("fs")) as unknown as FsLike;
		} catch {
			return null;
		}
	})();
	return desktopFsPromise;
}

/** 文件名安全化（去掉路径分隔符与 Windows 非法字符） */
function safeFileName(name: string): string {
	return String(name || "")
		.replace(/[\\/:*?"<>|#^[\]]/g, "_")
		.replace(/\s+/g, " ")
		.replace(/^[.\s]+/, "")
		.replace(/[.\s]+$/, "")
		.slice(0, 48)
		.trim();
}

function pad(n: number): string {
	return String(n).padStart(2, "0");
}

/** 试卷文件名时间戳：20260910-121751 */
function fileStamp(ts: number): string {
	const d = new Date(ts);
	return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(
		d.getHours()
	)}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function backupStamp(): string {
	const d = new Date();
	return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(
		d.getHours()
	)}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
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
