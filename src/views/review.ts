import { Notice, setIcon } from "obsidian";
import type { QuizNowApi } from "../plugin-api";
import type { Question } from "../types";
import { answerText, displayContent } from "../question";
import { isDue } from "../sm2";
import { el, clear, btn, badge, emptyState, progressBar } from "../ui";
import { t } from "../i18n";

const RATES = [
	{ grade: 0, labelKey: "review.rate.forgot", subKey: "review.rate.forgotSub", cls: "forgot" },
	{ grade: 3, labelKey: "review.rate.hard", subKey: "review.rate.hardSub", cls: "hard" },
	{ grade: 4, labelKey: "review.rate.good", subKey: "review.rate.goodSub", cls: "good" },
	{ grade: 5, labelKey: "review.rate.easy", subKey: "review.rate.easySub", cls: "easy" },
];

export function renderReview(container: HTMLElement, plugin: QuizNowApi): void {
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

	// 正面：题干在可滚动区，提示固定在底部
	const front = el("div", "qn-flash-face");
	const frontScroll = el("div", "qn-flash-scroll");
	const head = el("div", "qn-question-head");
	head.appendChild(badge(q.type));
	frontScroll.appendChild(head);
	frontScroll.appendChild(el("div", "qn-question-content", displayContent(q.content)));
	front.appendChild(frontScroll);
	front.appendChild(el("div", "qn-flash-hint", t("review.flipHint")));
	card.appendChild(front);

	// 背面：答案与解析在可滚动区，评级按钮固定在底部（始终可见）
	const back = el("div", "qn-flash-face qn-flash-back");
	const backScroll = el("div", "qn-flash-scroll");
	const backTitle = el("div", "qn-result-title", t("review.answer"));
	backScroll.appendChild(backTitle);
	backScroll.appendChild(el("div", "qn-question-content", answerText(q)));
	if (q.explanation) {
		backScroll.appendChild(el("div", "qn-explain", q.explanation));
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
