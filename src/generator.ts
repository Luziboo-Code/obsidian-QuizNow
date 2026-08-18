import type { Question } from "./types";
import { newId, cleanOption } from "./question";
import { t } from "./i18n";

/**
 * 基于笔记内容的启发式出题（无需 AI）：
 * - 加粗术语 -> 填空题（把术语挖空）
 * - 加粗术语 -> 单选题（用其它术语做干扰项）
 * - "键: 值" 形式行 -> 填空题
 * 生成质量有限但零成本、可离线使用；配置 AI 后可用 AI 出更高质量的题。
 */
export function generateFromNote(markdown: string, sourceName: string): Question[] {
	const { body } = splitFrontmatter(markdown);
	const lines = body.split(/\r?\n/);
	const now = Date.now();

	// 过滤代码块与引用块
	const visible: string[] = [];
	let fence: string | null = null;
	for (const line of lines) {
		const t = line.trim();
		if (fence) {
			if (t.startsWith(fence)) fence = null;
			continue;
		}
		if (/^```/.test(t)) {
			fence = "```";
			continue;
		}
		if (/^~~~/.test(t)) {
			fence = "~~~";
			continue;
		}
		visible.push(line);
	}

	// 1. 收集加粗术语及其所在句
	const boldTerms: { term: string; sentence: string }[] = [];
	for (const line of visible) {
		const re = /\*\*([^*\n]+)\*\*/g;
		let m: RegExpExecArray | null;
		while ((m = re.exec(line)) !== null) {
			const term = m[1].trim();
			if (term.length < 2 || term.length > 40) continue;
			if (/[*_#|`[\]]/.test(term)) continue;
			boldTerms.push({ term, sentence: line.trim() });
		}
	}

	// 2. 收集 "键: 值" 对（排除 URL / 时间 / 文件名 / 含 markdown 标记等噪音）
	const kvPairs: { key: string; value: string }[] = [];
	for (const line of visible) {
		if (/^\s*[-*>#\d]/.test(line)) continue;
		const m = line.match(/^([^:：\n]{2,40}?)\s*[:：]\s*(.{1,100})$/);
		if (!m) continue;
		const key = m[1].trim();
		const value = m[2].trim();
		if (!key || !value) continue;
		if (/^https?:\/\//i.test(value)) continue;
		if (/^\d{4}[-/]\d{1,2}[-/]\d{1,2}/.test(value)) continue;
		if (/^[\d:]+$/.test(value)) continue;
		if (/^[A-H][.、.)）]/.test(key)) continue; // 选项行
		if (/[*[\]`|]/.test(key) || /[*[\]`]/.test(value)) continue; // markdown 标记
		if (key.length > 30) continue;
		kvPairs.push({ key, value });
	}

	const questions: Question[] = [];
	const usedTerms = new Set<string>();
	const uniqueTerms = boldTerms.filter((b) => {
		if (usedTerms.has(b.term)) return false;
		usedTerms.add(b.term);
		return true;
	});

	// 3. 加粗术语 -> 填空题
	let fillCount = 0;
	for (const { term, sentence } of uniqueTerms) {
		if (fillCount >= 6) break;
		const cleanTerm = cleanOption(term) || term;
		const blanked = cleanStem(sentence)
			.replace(/\*\*/g, "")
			.replace(term, "____")
			.replace(cleanTerm, "____");
		if (blanked.length > 160) continue;
		// 挖空后没有实际题干（如纯标题 "## **术语**"）则跳过
		if (blanked.replace(/[_\-*\s#]/g, "").length < 2) continue;
		questions.push({
			id: newId(),
			type: "fill",
			content: blanked,
			answer: [cleanTerm],
			explanation: t("gen.heur.bold", { source: sourceName }),
			source: sourceName,
			createdAt: now,
		});
		fillCount++;
	}

	// 4. "键: 值" -> 填空题
	let kvCount = 0;
	for (const { key, value } of kvPairs) {
		if (kvCount >= 6) break;
		questions.push({
			id: newId(),
			type: "fill",
			content: `${key}：____`,
			answer: [cleanOption(value) || value],
			source: sourceName,
			createdAt: now,
		});
		kvCount++;
	}

	// 5. 加粗术语 -> 单选题（用其它术语做干扰项）
	const rawPool = uniqueTerms.map((t) => t.term);
	const cleanPool = rawPool.map((t) => cleanOption(t) || t);
	let singleCount = 0;
	for (const { term, sentence } of uniqueTerms) {
		if (singleCount >= 5) break;
		const cleanTerm = cleanOption(term) || term;
		const distractors: string[] = [];
		for (let i = 0; i < rawPool.length && distractors.length < 3; i++) {
			const raw = rawPool[i];
			const clean = cleanPool[i];
			if (clean === cleanTerm) continue;
			if (term.includes(raw) || raw.includes(term)) continue; // 避免答案包含干扰项
			if (distractors.includes(clean)) continue; // 去重（清洗后可能相同）
			distractors.push(clean);
		}
		if (distractors.length < 3) continue;
		const options = [cleanTerm, ...distractors].sort(() => Math.random() - 0.5);
		const answerLetter = String.fromCharCode(65 + options.indexOf(cleanTerm));
		const blanked = cleanStem(sentence)
			.replace(/\*\*/g, "")
			.replace(term, "____")
			.replace(cleanTerm, "____");
		if (blanked.length > 160) continue;
		// 挖空后没有实际题干则跳过
		if (blanked.replace(/[_\-*\s#]/g, "").length < 2) continue;
		questions.push({
			id: newId(),
			type: "single",
			content: blanked,
			options,
			answer: [answerLetter],
			explanation: t("gen.heur.single", { term: cleanTerm, source: sourceName }),
			source: sourceName,
			createdAt: now,
		});
		singleCount++;
	}

	return questions;
}

function splitFrontmatter(md: string): { fm: string; body: string } {
	const m = md.match(/^\ufeff?---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
	if (!m) return { fm: "", body: md };
	return { fm: m[1], body: m[2] };
}

/**
 * 清洗题干行首的 Markdown 标记（标题 #、列表符号、引用 >），
 * 避免生成 "## ____" 这类无法阅读的题目。
 */
function cleanStem(text: string): string {
	return text
		.split("\n")
		.map((l) =>
			l
				.replace(/^\s*#{1,6}\s*/, "")
				.replace(/^\s*[-*+]\s+/, "")
				.replace(/^\s*>\s*/, "")
		)
		.join("\n")
		.trim();
}

/**
 * 启发式解释：在源笔记中找到与答案相关的句子，返回其上下文。
 * 找不到时返回笔记开头一小段。
 */
export function heuristicExplanation(
	question: Question,
	noteText: string | undefined,
	sourceName: string
): string {
	if (!noteText || !noteText.trim()) {
		return t("gen.heur.noContext", { source: sourceName });
	}
	const lines = noteText.split(/\r?\n/);
	const targets: string[] = [...question.answer];
	if (question.options) targets.push(...question.options);
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		for (const t of targets) {
			if (t.length >= 2 && line.includes(t)) {
				const ctx = lines
					.slice(i, Math.min(i + 3, lines.length))
					.join("\n")
					.trim();
				return ctx.length > 400 ? ctx.slice(0, 400) + "…" : ctx;
			}
		}
	}
	const first = lines.find((l) => l.trim().length > 10);
	if (first) return first.trim().slice(0, 200);
	return t("gen.heur.noContext", { source: sourceName });
}
