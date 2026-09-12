import { Notice, setIcon } from "obsidian";
import type { QuizNowApi } from "../plugin-api";
import type { Question } from "../types";
import { answerText, cleanOption, displayContent } from "../question";
import { isDue } from "../sm2";
import { el, clear, btn, badge, emptyState, progressBar } from "../ui";
import { t } from "../i18n";

const RATES = [
	{ grade: 0, labelKey: "review.rate.forgot", subKey: "review.rate.forgotSub", cls: "forgot" },
	{ grade: 3, labelKey: "review.rate.hard", subKey: "review.rate.hardSub", cls: "hard" },
	{ grade: 4, labelKey: "review.rate.good", subKey: "review.rate.goodSub", cls: "good" },
	{ grade: 5, labelKey: "review.rate.easy", subKey: "review.rate.easySub", cls: "easy" },
];

/** 是否为带选项的选择题（题干之外还有可展示/标红的选项） */
function hasChoices(q: Question): boolean {
	return (
		(q.type === "single" || q.type === "multiple") &&
		!!q.options &&
		q.options.length > 0
	);
}

/** 规范化选择题答案字母（兼容旧数据：小写、逗号/空格拼接的字符串等） */
function optionLetters(q: Question): string[] {
	const list = Array.isArray(q.answer) ? q.answer : [String(q.answer ?? "")];
	return list
		.flatMap((a) => String(a).split(/[,，\s|]+/))
		.map((s) => s.trim().toUpperCase())
		.filter((l) => /^[A-H]$/.test(l));
}

/** 复习展示用的答案文本：选择题按规范化字母渲染（选项内容缺失时退回纯字母） */
function reviewAnswerText(q: Question): string {
	if (q.type !== "single" && q.type !== "multiple") return answerText(q);
	const letters = optionLetters(q);
	if (letters.length === 0) {
		return Array.isArray(q.answer) ? q.answer.join("、") : String(q.answer ?? "");
	}
	return letters
		.map((l) => {
			const idx = l.charCodeAt(0) - 65;
			const opt = q.options && q.options[idx] ? cleanOption(q.options[idx]) : "";
			return opt ? `${l}. ${opt}` : l;
		})
		.join("、");
}

/**
 * 构建选项行列表：
 * - highlight 为 null → 正面展示（不标红）；
 * - highlight 给出字母集合 → 背面展示，正确选项标红。
 */
function buildOptionRows(q: Question, highlight: string[] | null): HTMLDivElement {
	const wrap = el("div", "");
	const opts = q.options ?? [];
	for (let i = 0; i < opts.length; i++) {
		const letter = String.fromCharCode(65 + i);
		const isCorrect = !!highlight && highlight.includes(letter);
		const row = el("div", `qn-option${isCorrect ? " qn-opt-answer" : ""}`);
		row.appendChild(el("span", "qn-opt-letter", `${letter}.`));
		row.appendChild(el("span", "", cleanOption(opts[i])));
		wrap.appendChild(row);
	}
	return wrap;
}

/** 当前闪卡的尺寸观察者（每次渲染替换） */
let flashSizer: ResizeObserver | null = null;

export function stopFlashSizing(): void {
	if (flashSizer) {
		flashSizer.disconnect();
		flashSizer = null;
	}
}

/** 元素外边距高度（offsetHeight 不含上下 margin，需单独计入） */
function outerHeight(node: HTMLElement): number {
	const cs = window.getComputedStyle(node);
	return (
		node.offsetHeight +
		(parseFloat(cs.marginTop) || 0) +
		(parseFloat(cs.marginBottom) || 0)
	);
}

/**
 * 按内容自适应卡片高度（不裁剪任何内容）：
 * - 读取背面滚动区的内容真实自然高（含其内部全部 margin/gap），
 *   再加底部固定元素（分隔线/提示/评级行，含上下外边距）与面内 padding；
 * - 卡片恰好等于内容总高 → 能放进视口时无需任何滚动、无裁剪；
 * - 超过视口时由外层内容区整体滚动（与普通笔记一致），不再出现面内局部裁切。
 */
function fitCard(wrap: HTMLElement, back: HTMLElement): void {
	const scrollEl = back.querySelector<HTMLElement>(".qn-flash-scroll");
	if (!scrollEl) return;

	// 1. 临时让滚动区按内容自身高度布局，读出真实自然高（含内部全部 margin/间距）
	scrollEl.classList.add("qn-measuring");
	let required = scrollEl.scrollHeight;
	for (const c of Array.from(back.children)) {
		if (c !== scrollEl) required += outerHeight(c as HTMLElement);
	}
	const csBack = window.getComputedStyle(back);
	required +=
		Math.ceil(
			(parseFloat(csBack.paddingTop) || 0) +
				(parseFloat(csBack.paddingBottom) || 0) +
				(back.children.length - 1) * (parseFloat(csBack.rowGap) || 0)
		) +
		2; // 面内 padding、子项间距与取整余量
	scrollEl.classList.remove("qn-measuring");

	// 2. 定高：卡片恰好容纳背面全部内容（正面内容必然 ≤ 背面，同样不会被裁）
	wrap.classList.add("qn-flash-fitted");
	wrap.style.height = `${required}px`;
}

export function renderReview(container: HTMLElement, plugin: QuizNowApi): void {
	stopFlashSizing();
	clear(container);
	const due = plugin.store.dueReviewQuestions();

	const title = el("div", "qn-title");
	setIcon(title, "refresh-cw");
	title.appendChild(el("span", "", t("review.title")));
	container.appendChild(title);

	if (due.length === 0) {
		const card = el("div", "qn-card qn-fade");
		card.appendChild(emptyState(t("review.none"), "🌤"));
		container.appendChild(card);

		// 全部错题回顾列表
		const all = plugin.store.data.reviewIds
			.map((id) => plugin.store.data.questions.find((q) => q.id === id))
			.filter((q): q is Question => !!q);
		if (all.length > 0) {
			const listCard = el("div", "qn-card qn-fade");
			listCard.appendChild(
				el("div", "qn-subtitle", t("review.allWrong", { n: all.length }))
			);
			const list = el("div", "qn-scroll-list");
			for (const q of all) {
				const item = el("div", "qn-item");
				const head = el("div", "qn-item-head");
				head.appendChild(badge(q.type));
				item.appendChild(head);
				item.appendChild(el("div", "qn-item-content", displayContent(q.content)));
				const dueCard = plugin.store.data.sm[q.id];
				item.appendChild(
					el(
						"div",
						"qn-item-meta",
						isDue(dueCard)
							? t("review.dueNow")
							: t("review.dueIn", {
									n: Math.ceil(((dueCard?.due ?? 0) - Date.now()) / 86400000),
							  })
					)
				);
				list.appendChild(item);
			}
			listCard.appendChild(list);
			container.appendChild(listCard);
		}
		return;
	}

	// 开始复习
	const intro = el("div", "qn-card qn-fade");
	intro.appendChild(
		el("div", "", t("review.dueCount", { n: due.length }))
	);
	intro.appendChild(el("div", "qn-note", t("review.rule")));
	intro.appendChild(
		btn("qn-btn-primary qn-btn-block", t("review.start"), () => {
			renderFlash(container, plugin, due, 0);
		})
	);
	container.appendChild(intro);
}

function renderFlash(
	container: HTMLElement,
	plugin: QuizNowApi,
	list: Question[],
	index: number
): void {
	stopFlashSizing();
	clear(container);
	if (index >= list.length) {
		const card = el("div", "qn-card qn-fade");
		card.appendChild(emptyState(t("review.done"), "🏁"));
		const row = el("div", "qn-btn-row");
		row.appendChild(
			btn("qn-btn-primary", t("review.back"), () => {
				plugin.currentSession = null;
				plugin.refresh();
			})
		);
		row.appendChild(btn("", t("review.goWeak"), () => plugin.openTab("weak")));
		card.appendChild(row);
		container.appendChild(card);
		return;
	}

	const q = list[index];
	const top = el("div", "qn-card");
	top.appendChild(
		el(
			"div",
			"qn-note",
			t("review.progress", { current: index + 1, total: list.length })
		)
	);
	top.appendChild(progressBar((index / Math.max(1, list.length)) * 100));
	container.appendChild(top);

	const wrap = el("div", "qn-flash-wrap qn-fade");
	const card = el("div", "qn-flashcard");
	wrap.appendChild(card);

	// 正面：完整题目（题干 + 选择题选项），提示固定在底部
	const front = el("div", "qn-flash-face");
	const frontScroll = el("div", "qn-flash-scroll");
	const head = el("div", "qn-question-head");
	head.appendChild(badge(q.type));
	frontScroll.appendChild(head);
	frontScroll.appendChild(el("div", "qn-question-content", displayContent(q.content)));
	if (hasChoices(q)) {
		frontScroll.appendChild(buildOptionRows(q, null));
	}
	front.appendChild(frontScroll);
	front.appendChild(el("div", "qn-flash-hint", t("review.flipHint")));
	card.appendChild(front);

	// 背面：题目回顾 + 完整选项（正确答案标红）+ 答案解析，评级按钮固定在底部
	const back = el("div", "qn-flash-face qn-flash-back");
	const backScroll = el("div", "qn-flash-scroll");
	// 1. 原题题干
	backScroll.appendChild(el("div", "qn-subtitle", t("review.questionLabel")));
	backScroll.appendChild(
		el("div", "qn-question-content", displayContent(q.content))
	);
	// 2. 完整选项列表（选择题）：正确选项标红
	if (hasChoices(q)) {
		backScroll.appendChild(el("div", "qn-subtitle", t("review.optionLabel")));
		backScroll.appendChild(buildOptionRows(q, optionLetters(q)));
	}
	// 3. 正确答案（红色强调）
	const ansRow = el("div", "qn-review-answer");
	ansRow.appendChild(
		el("span", "qn-review-answer-label", t("review.answerLabel"))
	);
	ansRow.appendChild(el("b", "", reviewAnswerText(q)));
	backScroll.appendChild(ansRow);
	// 4. 答案解析
	if (q.explanation) {
		backScroll.appendChild(el("div", "qn-subtitle", t("review.explainLabel")));
		backScroll.appendChild(el("div", "qn-explain", q.explanation));
	}
	// 5. 错题笔记（考试答错时用户所写，复习时同步调出）
	const note = plugin.store.getNote(q.id);
	if (note) {
		backScroll.appendChild(el("div", "qn-subtitle", t("note.title")));
		backScroll.appendChild(el("div", "qn-mistake-note", note));
	}
	back.appendChild(backScroll);
	const rateRow = el("div", "qn-rate-row");
	for (const r of RATES) {
		const b = el("button", `qn-rate ${r.cls}`);
		b.appendChild(el("div", "", t(r.labelKey)));
		b.appendChild(el("div", "qn-rate-sub", t(r.subKey)));
		b.addEventListener("click", (e) => {
			// 阻止冒泡，避免触发卡片翻转竞态
			e.stopPropagation();
			void rate(plugin, q, r.grade, () =>
				renderFlash(container, plugin, list, index + 1)
			);
		});
		rateRow.appendChild(b);
	}
	back.appendChild(el("div", "qn-divider"));
	back.appendChild(el("div", "qn-note", t("review.quality")));
	back.appendChild(rateRow);
	card.appendChild(back);

	card.addEventListener("click", (e) => {
		if ((e.target as HTMLElement).closest(".qn-rate")) return;
		card.classList.toggle("flipped");
	});

	container.appendChild(wrap);

	// 按背面内容自适应卡片高度（恰好等高、无裁剪；面板尺寸变化导致换行时重算）
	fitCard(wrap, back);
	if (typeof ResizeObserver !== "undefined") {
		flashSizer = new ResizeObserver(() => fitCard(wrap, back));
		flashSizer.observe(container);
	}
}

async function rate(
	plugin: QuizNowApi,
	q: Question,
	grade: number,
	next: () => void
): Promise<void> {
	try {
		const correct = grade >= 3;
		await plugin.store.markReviewResult(q, correct, grade);
		if (!correct) {
			new Notice(t("review.movedWeak", { title: q.content.slice(0, 18) }));
		}
	} catch (e) {
		new Notice(String((e as Error).message));
	} finally {
		// 无论成功与否都推进到下一张，避免流程卡死
		next();
	}
}
