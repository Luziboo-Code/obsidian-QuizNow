import type { Question, QuestionType } from "./types";
import { t } from "./i18n";

/**
 * 题库中一道题的 Markdown 文件格式：
 *
 * ---
 * type: single | multiple | fill | judge
 * answer: A            (single/multiple: 字母，多个用逗号；fill: 用 | 分隔可接受答案；judge: T/F)
 * explanation: 解析
 * source: 来源
 * created: 毫秒时间戳
 * ---
 *
 * 题干内容...
 *
 * - A. 选项一      (single/multiple 的选项，A-H)
 * - B. 选项二
 */

const OPTION_RE = /^\s*(?:[-*]\s*)?([A-Ha-h])[.、.)）:：]+\s*(.*)$/;

/** 生成题目 id（文件系统安全） */
export function newId(): string {
	return (
		Date.now().toString(36) +
		Math.random().toString(36).slice(2, 10)
	);
}

/** 解析简易 frontmatter（key: value 形式，兼容引号） */
function parseFrontmatter(text: string): Record<string, string> {
	const out: Record<string, string> = {};
	const lines = text.split(/\r?\n/);
	for (const raw of lines) {
		const line = raw.trim();
		if (!line || line.startsWith("---")) continue;
		const m = line.match(/^([\w\u4e00-\u9fa5-]+)\s*[:：]\s*(.*)$/);
		if (!m) continue;
		let value = m[2].trim();
		if (
			(value.startsWith('"') && value.endsWith('"')) ||
			(value.startsWith("'") && value.endsWith("'"))
		) {
			value = value.slice(1, -1);
		}
		out[m[1].toLowerCase()] = value;
	}
	return out;
}

function extractFrontmatter(md: string): {
	fm: Record<string, string>;
	body: string;
} {
	const m = md.match(/^\ufeff?---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
	if (!m) return { fm: {}, body: md };
	return { fm: parseFrontmatter(m[1]), body: m[2] };
}

function normalizeType(t: string | undefined): QuestionType | null {
	if (t === "single" || t === "multiple" || t === "fill" || t === "judge")
		return t;
	return null;
}

/** 规范化选择题答案字母 */
function normLetters(raw: string): string[] {
	return raw
		.toUpperCase()
		.split(/[,，\s|]+/)
		.map((s) => s.trim())
		.filter((s) => /^[A-H]$/.test(s));
}

/** 把一条题目解析成 Question；格式非法返回 null */
export function parseQuestion(md: string, source?: string): Question | null {
	const { fm, body } = extractFrontmatter(md);
	const type = normalizeType(fm["type"]);
	if (!type) return null;

	const lines = body.split(/\r?\n/);
	const optionLines: { letter: string; text: string }[] = [];
	const contentLines: string[] = [];

	for (const line of lines) {
		const m = line.match(OPTION_RE);
		if (m && (type === "single" || type === "multiple")) {
			optionLines.push({
				letter: m[1].toUpperCase(),
				text: cleanOption(m[2]),
			});
		} else {
			contentLines.push(line);
		}
	}

	const content = contentLines.join("\n").trim();
	if (!content) return null;

	let answer: string[] = [];
	if (type === "single" || type === "multiple") {
		answer = normLetters(fm["answer"] ?? "");
		if (answer.length === 0) return null;
		const maxLetter = optionLines.length
			? optionLines[optionLines.length - 1].letter
			: "A";
		// 过滤超出选项范围的字母
		answer = answer.filter((l) => l <= maxLetter);
		if (answer.length === 0) return null;
		// 单选必须只有一个答案
		if (type === "single" && answer.length !== 1) return null;
	} else if (type === "fill") {
		answer = (fm["answer"] ?? "")
			.split("|")
			.map((s) => s.trim())
			.filter(Boolean);
		if (answer.length === 0) return null;
	} else if (type === "judge") {
		const v = (fm["answer"] ?? "").trim().toUpperCase();
		if (v === "T" || v === "对" || v === "正确" || v === "TRUE" || v === "√")
			answer = ["T"];
		else if (v === "F" || v === "错" || v === "错误" || v === "FALSE" || v === "×")
			answer = ["F"];
		else return null;
	}

	const options =
		optionLines.length > 0
			? optionLines.map((o) => o.text)
			: type === "single" || type === "multiple"
			? undefined
			: undefined;

	return {
		id: fm["id"] || newId(),
		type,
		content,
		options,
		answer,
		explanation: fm["explanation"] || undefined,
		source: fm["source"] || source,
		createdAt: fm["created"] ? parseInt(fm["created"], 10) || Date.now() : Date.now(),
	};
}

/** 把 Question 序列化为题库 Markdown 文件内容 */
export function formatQuestion(q: Question): string {
	const lines: string[] = [];
	lines.push("---");
	lines.push(`type: ${q.type}`);
	lines.push(`id: ${q.id}`);
	lines.push(`answer: ${q.answer.join("|")}`);
	if (q.explanation) lines.push(`explanation: ${q.explanation}`);
	if (q.source) lines.push(`source: ${q.source}`);
	lines.push(`created: ${q.createdAt}`);
	lines.push("---");
	lines.push("");
	lines.push(q.content.trim());
	if (
		q.options &&
		q.options.length > 0 &&
		(q.type === "single" || q.type === "multiple")
	) {
		lines.push("");
		q.options.forEach((opt, i) => {
			lines.push(`- ${String.fromCharCode(65 + i)}. ${opt}`);
		});
	}
	return lines.join("\n");
}

/** 归一化用户填写的填空答案 */
function normFill(s: string): string {
	return s.trim().toLowerCase().replace(/\s+/g, "");
}

/** 归一化判断题用户答案 */
function normJudge(s: string): "T" | "F" | null {
	const v = s.trim().toUpperCase();
	if (v === "T" || v === "对" || v === "正确" || v === "TRUE" || v === "√")
		return "T";
	if (v === "F" || v === "错" || v === "错误" || v === "FALSE" || v === "×")
		return "F";
	return null;
}

/** 判定用户答案是否正确 */
export function checkAnswer(q: Question, userAnswer: string[]): boolean {
	switch (q.type) {
		case "single":
			return (
				userAnswer.length === 1 &&
				normLetters(userAnswer.join(""))[0] === q.answer[0]
			);
		case "multiple": {
			const u = new Set(normLetters(userAnswer.join(",")));
			const a = new Set(q.answer);
			if (u.size !== a.size) return false;
			for (const x of a) if (!u.has(x)) return false;
			return true;
		}
		case "fill": {
			const input = userAnswer.map(normFill).filter(Boolean);
			if (input.length === 0) return false;
			const inputStr = input.join("");
			return q.answer.some((a) => normFill(a) === inputStr);
		}
		case "judge": {
			const v = normJudge(userAnswer.join(""));
			return v !== null && v === q.answer[0];
		}
	}
	return false;
}

/** 展示用：正确答案的可读文本（选择题附带选项内容，如 "B. 巴黎"） */
export function answerText(q: Question): string {
	switch (q.type) {
		case "single":
		case "multiple":
			return q.answer.map((a) => letterWithOption(q, a)).join("、");
		case "fill":
			return q.answer.join(" / ");
		case "judge":
			return q.answer[0] === "T" ? t("answer.true") : t("answer.false");
	}
}

/** 把选择题答案字母转换为 "字母. 选项内容"（找不到选项时退回纯字母） */
function letterWithOption(q: Question, letter: string): string {
	const idx = letter.charCodeAt(0) - 65;
	const opt = q.options && q.options[idx] ? cleanOption(q.options[idx]) : "";
	return opt ? `${letter}. ${opt}` : letter;
}

/** 展示用：用户答案的可读文本（选择题附带选项内容） */
export function userAnswerText(q: Question, userAnswer: string[]): string {
	switch (q.type) {
		case "single":
		case "multiple":
			return (
				userAnswer.map((a) => letterWithOption(q, a)).join("、") ||
				t("answer.none")
			);
		case "fill":
			return userAnswer.join("") || t("answer.none");
		case "judge":
			return normJudge(userAnswer.join("")) === "T"
				? t("answer.true")
				: normJudge(userAnswer.join("")) === "F"
				? t("answer.false")
				: t("answer.none");
	}
}

/**
 * 显示用：去掉题干行首残留的 Markdown 标题/列表/引用标记，
 * 避免出现 "##____" 等无法阅读的内容（兼容历史题库中的旧题）。
 */
export function displayContent(content: string): string {
	return content
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
 * 清洗选项文本：去掉开头的字母编号前缀（"A. 苹果" / "B) 巴黎" / "C、北京" 等），
 * 避免渲染时出现 "D. A. 苹果" 这类异常。
 */
export function cleanOption(text: string): string {
	return String(text ?? "")
		.trim()
		.replace(/^[A-Ha-h][.、.)）:：]\s*/, "")
		.trim();
}

/**
 * 打乱选择题选项顺序并重算答案字母（返回新对象，不改动原题）。
 * 用于随机出题时生成选项顺序不同的试卷。
 */
export function shuffleOptions(q: Question): Question {	if (q.type !== "single" && q.type !== "multiple") return q;
	if (!q.options || q.options.length < 2) return q;
	const n = q.options.length;
	const order = Array.from({ length: n }, (_, i) => i);
	for (let i = n - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[order[i], order[j]] = [order[j], order[i]];
	}
	const options = order.map((i) => q.options![i]);
	const answer = q.answer.map((a) => {
		const oldIdx = a.charCodeAt(0) - 65;
		const newIdx = order.indexOf(oldIdx);
		return String.fromCharCode(65 + newIdx);
	});
	return { ...q, options, answer };
}
