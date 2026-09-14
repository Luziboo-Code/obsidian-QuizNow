import { setIcon } from "obsidian";
import type { QuizNowApi } from "../plugin-api";
import { el, clear, btn, iconBtn, emptyState } from "../ui";
import { t } from "../i18n";
import {
	ExamHistoryModal,
	QuestionListModal,
	questionStatus,
	type QuestionListItem,
} from "../list-modal";
import { canRetake, startRetake } from "../retake";
import type { ExamRecord, Question } from "../types";

/** 组装考试记录视图数据（可按试卷名过滤，按时间倒序） */
function buildRecords(plugin: QuizNowApi, nameFilter?: string): ExamRecord[] {
	return plugin.store.data.examRecords
		.filter((r) => !nameFilter || r.name === nameFilter)
		.sort((a, b) => b.date - a.date);
}

/** 某份试卷最近一次考试记录（用于首页卡片的「重考」） */
function latestRecord(plugin: QuizNowApi, name: string): ExamRecord | undefined {
	return buildRecords(plugin, name)[0];
}

/** 首页：统计 + 各试卷最高分卡片 */
export function renderHome(container: HTMLElement, plugin: QuizNowApi): void {
	clear(container);
	const s = plugin.store.stats();

	const statRow = el("div", "qn-stats");

	const questions = plugin.store.data.questions;
	const wrongIds = [...new Set([...plugin.store.data.reviewIds, ...plugin.store.data.weakIds])];
	const wrongQs = wrongIds
		.map((id) => questions.find((q) => q.id === id))
		.filter((q): q is Question => !!q);
	const reviewQs = plugin.store.data.reviewIds
		.map((id) => questions.find((q) => q.id === id))
		.filter((q): q is Question => !!q);

	const stats = [
		{
			label: t("home.stat.questions"),
			value: s.questionCount,
			icon: "library",
			onClick: () => {
				const items: QuestionListItem[] = questions.map((q) => ({
					question: q,
					status: questionStatus(q, plugin.store.data.sm, plugin.store.data.weakIds, plugin.store.data.reviewIds),
				}));
				new QuestionListModal(plugin.app, plugin, t("home.stat.questions"), items).open();
			},
		},
		{
			label: t("home.stat.wrong"),
			value: s.wrongCount,
			icon: "alert-triangle",
			onClick: () => {
				const items: QuestionListItem[] = wrongQs.map((q) => ({
					question: q,
					status: questionStatus(q, plugin.store.data.sm, plugin.store.data.weakIds, plugin.store.data.reviewIds),
				}));
				new QuestionListModal(plugin.app, plugin, t("home.stat.wrong"), items).open();
			},
		},
		{
			label: t("home.stat.review"),
			value: s.dueReviewCount,
			icon: "refresh-cw",
			onClick: () => {
				const items: QuestionListItem[] = reviewQs.map((q) => ({
					question: q,
					status: questionStatus(q, plugin.store.data.sm, plugin.store.data.weakIds, plugin.store.data.reviewIds),
				}));
				new QuestionListModal(plugin.app, plugin, t("home.stat.review"), items).open();
			},
		},
		{
			label: t("home.stat.papers"),
			value: s.paperCount,
			icon: "file-text",
			onClick: () => {
				new ExamHistoryModal(plugin.app, plugin, buildRecords(plugin)).open();
			},
		},	];

	for (const item of stats) {
		const card = el("div", "qn-stat clickable");
		const icon = el("div", "qn-stat-icon");
		setIcon(icon, item.icon);
		card.appendChild(icon);
		card.appendChild(el("div", "qn-stat-value", String(item.value)));
		card.appendChild(el("div", "qn-stat-label", item.label));
		card.setAttribute("aria-label", `${item.label}：${item.value}`);
		card.addEventListener("click", item.onClick);
		statRow.appendChild(card);
	}
	container.appendChild(statRow);

	// 试卷成绩
	const section = el("div", "qn-card qn-fade");
	const title = el("div", "qn-title");
	setIcon(title, "trophy");
	title.appendChild(el("span", "", t("home.paperTitle")));
	section.appendChild(title);
	section.appendChild(el("div", "qn-note", t("home.paperNote")));
	section.appendChild(el("div", "qn-note", t("home.paperClickHint")));

	const allPapers = plugin.store.paperCards();
	const limit = plugin.store.settings.homePaperLimit || 0;
	const papers = limit > 0 ? allPapers.slice(0, limit) : allPapers;

	if (papers.length === 0) {
		const empty = el("div", "");
		empty.appendChild(
			emptyState(t("home.empty"), "🎯")
		);
		const go = btn("qn-btn-primary qn-btn-block", t("home.goExam"), () =>
			plugin.openTab("exam")
		);
		empty.appendChild(go);
		section.appendChild(empty);
	} else {
		const list = el("div", "qn-scroll-list");
		for (const p of papers) {
			const card = el("div", "qn-paper-card clickable");
			const score = el("div", "qn-paper-score", `${p.best}`);
			score.appendChild(el("small", "", t("common.points")));
			card.appendChild(score);
			const info = el("div", "qn-paper-info");
			info.appendChild(el("div", "qn-paper-name", p.name));
			info.appendChild(
				el(
					"div",
					"qn-paper-meta",
					t("home.paperMeta", { count: p.count, date: fmtDate(p.lastDate) })
				)
			);
			card.appendChild(info);
			// 重考：直接以最近一次同卷的题目重新开考（选项重新打乱）
			const last = latestRecord(plugin, p.name);
			if (last && canRetake(last)) {
				const again = iconBtn(
					"rotate-ccw",
					t("exam.retake"),
					(e?: MouseEvent) => {
						// 阻止冒泡，避免同时触发卡片的「查看记录」点击
						e?.stopPropagation();
						startRetake(plugin, last);
					},
					"qn-btn-sm qn-retake-btn"
				);
				card.appendChild(again);
			}
			// 点击分数卡：查看该试卷的考试记录（含完整题目与逐题作答）
			card.addEventListener("click", () => {
				new ExamHistoryModal(plugin.app, plugin, buildRecords(plugin, p.name)).open();
			});
			list.appendChild(card);
		}
		section.appendChild(list);
		if (limit > 0 && allPapers.length > limit) {
			section.appendChild(
				el(
					"div",
					"qn-note",
					t("home.showMore", { shown: papers.length, total: allPapers.length })
				)
			);
		}
	}
	container.appendChild(section);
}

function fmtDate(ts: number): string {
	const d = new Date(ts);
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
		d.getDate()
	).padStart(2, "0")}`;
}
