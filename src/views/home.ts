import { setIcon } from "obsidian";
import type { QuizNowApi } from "../plugin-api";
import { el, clear, btn, emptyState } from "../ui";
import { t } from "../i18n";

/** 首页：统计 + 各试卷最高分卡片 */
export function renderHome(container: HTMLElement, plugin: QuizNowApi): void {
	clear(container);
	const s = plugin.store.stats();

	const stats = [
		{ label: t("home.stat.questions"), value: s.questionCount, icon: "library" },
		{ label: t("home.stat.wrong"), value: s.wrongCount, icon: "alert-triangle" },
		{ label: t("home.stat.review"), value: s.dueReviewCount, icon: "refresh-cw" },
		{ label: t("home.stat.papers"), value: s.paperCount, icon: "file-text" },
	];

	const statRow = el("div", "qn-stats");
	for (const item of stats) {
		const card = el("div", "qn-stat");
		const icon = el("div", "qn-stat-icon");
		setIcon(icon, item.icon);
		card.appendChild(icon);
		card.appendChild(el("div", "qn-stat-value", String(item.value)));
		card.appendChild(el("div", "qn-stat-label", item.label));
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
			const card = el("div", "qn-paper-card");
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
