import { Modal, Notice, setIcon, type App } from "obsidian";
import type { QuizNowApi } from "./plugin-api";
import type { Question } from "./types";
import { answerText, displayContent } from "./question";
import { isDue } from "./sm2";
import { el, btn, badge, iconBtn, confirmDialog } from "./ui";
import { t } from "./i18n";

export interface QuestionListItem {
	question: Question;
	/** 附加状态说明（复习中 / 薄弱点 / 到期时间等） */
	status?: string;
}

/** 题目列表弹窗（首页统计卡点击后查看详情，支持逐题删除） */
export class QuestionListModal extends Modal {
	private plugin: QuizNowApi;
	private title: string;
	private items: QuestionListItem[];

	constructor(
		app: App,
		plugin: QuizNowApi,
		title: string,
		items: QuestionListItem[]
	) {
		super(app);
		this.plugin = plugin;
		this.title = title;
		this.items = items;
	}

	onOpen(): void {
		this.contentEl.addClass("qn-view");
		this.render();
	}

	private render(): void {
		const { contentEl } = this;
		contentEl.empty();

		const wrap = el("div", "qn-content qn-modal-body");
		contentEl.appendChild(wrap);

		const head = el("div", "qn-title");
		setIcon(head, "list");
		head.appendChild(
			el("span", "", `${this.title}（${this.items.length}）`)
		);
		wrap.appendChild(head);

		if (this.items.length === 0) {
			wrap.appendChild(el("div", "qn-note", t("modal.emptyQuestions")));
		} else {
			const list = el("div", "qn-scroll-list");
			for (const item of this.items) {
				const row = el("div", "qn-item");
				const h = el("div", "qn-item-head");
				h.appendChild(badge(item.question.type));
				if (item.status) {
					h.appendChild(el("span", "qn-badge qn-badge-fill", item.status));
				}
				// 删除按钮（右侧）
				const delBtn = iconBtn(
					"trash-2",
					t("modal.delete"),
					() => {
						this.deleteQuestion(item.question);
					},
					"qn-btn-danger qn-btn-sm qn-ml-auto"
				);
				h.appendChild(delBtn);
				row.appendChild(h);
				row.appendChild(
					el("div", "qn-item-content", displayContent(item.question.content))
				);
				const ans = el("div", "qn-gen-answer");
				ans.appendChild(el("span", "", t("gen.answer")));
				ans.appendChild(el("b", "", answerText(item.question)));
				row.appendChild(ans);
				const meta = el("div", "qn-item-meta");
				if (item.question.source) {
					meta.appendChild(
						el("span", "", t("weak.source", { source: item.question.source }))
					);
				}
				row.appendChild(meta);
				list.appendChild(row);
			}
			wrap.appendChild(list);
		}

		wrap.appendChild(
			btn("qn-btn qn-btn-block", t("modal.close"), () => this.close())
		);
	}

	private deleteQuestion(q: Question): void {
		confirmDialog(this.app, t("modal.deleteQuestionConfirm"), () => {
			void (async () => {
				try {
					await this.plugin.store.removeFromBank(q.id);
					this.items = this.items.filter((x) => x.question.id !== q.id);
					new Notice(t("modal.deletedQuestion"));
					this.plugin.refresh(); // 刷新首页统计
					this.render();
				} catch (e) {
					new Notice(t("settings.restoreFail", { msg: (e as Error).message }));
				}
			})();
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

/** 考试记录详情弹窗（首页「考试试卷」统计卡点击后查看，支持删除单条记录） */
export class ExamHistoryModal extends Modal {
	private plugin: QuizNowApi;
	private records: {
		id: string;
		name: string;
		date: number;
		score: number;
		correct: number;
		total: number;
		wrongQuestions: Question[];
	}[];

	constructor(
		app: App,
		plugin: QuizNowApi,
		records: {
			id: string;
			name: string;
			date: number;
			score: number;
			correct: number;
			total: number;
			wrongQuestions: Question[];
		}[]
	) {
		super(app);
		this.plugin = plugin;
		this.records = records;
	}

	onOpen(): void {
		this.contentEl.addClass("qn-view");
		this.render();
	}

	private render(): void {
		const { contentEl } = this;
		contentEl.empty();

		const wrap = el("div", "qn-content qn-modal-body");
		contentEl.appendChild(wrap);

		const head = el("div", "qn-title");
		setIcon(head, "history");
		head.appendChild(
			el("span", "", `${t("exam.historyTitle")}（${this.records.length}）`)
		);
		wrap.appendChild(head);

		if (this.records.length === 0) {
			wrap.appendChild(el("div", "qn-note", t("modal.emptyRecords")));
		} else {
			const list = el("div", "qn-scroll-list");
			for (const r of this.records) {
				const card = el("div", "qn-item");
				const topRow = el("div", "qn-flex-between");
				const nameWrap = el("div", "qn-flex");
				nameWrap.appendChild(el("div", "qn-paper-name", r.name));
				const delBtn = iconBtn(
					"trash-2",
					t("modal.delete"),
					() => {
						this.deleteRecord(r);
					},
					"qn-btn-danger qn-btn-sm"
				);
				nameWrap.appendChild(delBtn);
				topRow.appendChild(nameWrap);
				const score = el("span", "qn-paper-score qn-score-md", `${r.score}`);
				topRow.appendChild(score);
				card.appendChild(topRow);
				card.appendChild(
					el(
						"div",
						"qn-item-meta",
						t("exam.historyMeta", {
							score: r.score,
							correct: r.correct,
							total: r.total,
							date: new Date(r.date).toLocaleString(),
						})
					)
				);
				if (r.wrongQuestions.length > 0) {
					card.appendChild(
						el("div", "qn-note", t("exam.wrongList", { n: r.wrongQuestions.length }))
					);
					const wrongList = el("div", "");
					for (const q of r.wrongQuestions) {
						const item = el("div", "qn-gen-item");
						const h = el("div", "qn-question-head");
						h.appendChild(badge(q.type));
						item.appendChild(h);
						item.appendChild(el("div", "qn-question-content", displayContent(q.content)));
						const ans = el("div", "qn-gen-answer");
						ans.appendChild(el("span", "", t("gen.answer")));
						ans.appendChild(el("b", "", answerText(q)));
						item.appendChild(ans);
						wrongList.appendChild(item);
					}
					card.appendChild(wrongList);
				} else {
					card.appendChild(el("div", "qn-note", t("exam.allCorrect")));
				}
				list.appendChild(card);
			}
			wrap.appendChild(list);
		}

		wrap.appendChild(
			btn("qn-btn qn-btn-block", t("modal.close"), () => this.close())
		);
	}

	private deleteRecord(r: { id: string; name: string }): void {
		confirmDialog(this.app, t("modal.deleteRecordConfirm"), () => {
			void (async () => {
				try {
					await this.plugin.store.removeExamRecord(r.id);
					this.records = this.records.filter((x) => x.id !== r.id);
					new Notice(t("modal.deletedRecord"));
					this.plugin.refresh(); // 刷新首页统计与成绩卡
					this.render();
				} catch (e) {
					new Notice(t("settings.restoreFail", { msg: (e as Error).message }));
				}
			})();
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

/** 根据题目生成复习状态标注 */
export function questionStatus(
	q: Question,
	sm: Record<string, import("./types").SMCard>,
	weakIds: string[],
	reviewIds: string[]
): string | undefined {
	if (weakIds.includes(q.id)) return t("modal.status.weak");
	if (reviewIds.includes(q.id)) {
		const card = sm[q.id];
		return isDue(card)
			? t("modal.status.dueNow")
			: t("modal.status.dueIn", {
					n: Math.ceil(((card?.due ?? 0) - Date.now()) / 86400000),
			  });
	}
	return undefined;
}
