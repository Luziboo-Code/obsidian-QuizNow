import { Notice, setIcon } from "obsidian";
import type { QuizNowApi } from "../plugin-api";
import type { Question } from "../types";
import { newId } from "../question";
import { isDue } from "../sm2";
import { heuristicExplanation } from "../generator";
import { aiExplainQuestion } from "../ai";
import { el, clear, btn, badge, emptyState, loading } from "../ui";
import { t } from "../i18n";

export function renderWeak(container: HTMLElement, plugin: QuizNowApi): void {
	clear(container);
	const weakQs = plugin.store.data.weakIds
		.map((id) => plugin.store.data.questions.find((q) => q.id === id))
		.filter((q): q is Question => !!q);

	const title = el("div", "qn-title");
	setIcon(title, "alert-triangle");
	title.appendChild(el("span", "", t("weak.title")));
	container.appendChild(title);

	// 顶部操作
	const headCard = el("div", "qn-card qn-fade");
	headCard.appendChild(
		el("div", "qn-card-desc", t("weak.desc", { n: weakQs.length }))
	);
	headCard.appendChild(
		btn("qn-btn-primary qn-btn-block", t("weak.test"), () => {
			if (weakQs.length === 0) {
				new Notice(t("weak.emptyNotice"));
				return;
			}
			const count = Math.min(
				plugin.store.settings.defaultCount || 10,
				weakQs.length
			);
			const picked = shuffle(weakQs).slice(0, count);
			plugin.startSession({
				id: newId(),
				name: `${t("weak.sessionName")} · ${nowStamp()}`,
				questions: picked,
				index: 0,
				answers: {},
				origin: "weak",
				createdAt: Date.now(),
			});
		})
	);
	container.appendChild(headCard);

	if (weakQs.length === 0) {
		const card = el("div", "qn-card qn-fade");
		card.appendChild(emptyState(t("weak.empty"), "💡"));
		container.appendChild(card);
		return;
	}

	const list = el("div", "qn-scroll-list qn-fade");
	for (const q of weakQs) {
		list.appendChild(renderWeakItem(plugin, q));
	}
	container.appendChild(list);
}

function renderWeakItem(plugin: QuizNowApi, q: Question): HTMLElement {
	const item = el("div", "qn-item");

	const head = el("div", "qn-item-head");
	head.appendChild(badge(q.type));
	item.appendChild(head);
	item.appendChild(el("div", "qn-item-content", q.content));

	// 元信息
	const meta = el("div", "qn-item-meta");
	if (q.source) meta.appendChild(el("span", "", t("weak.source", { source: q.source })));
	const card = plugin.store.data.sm[q.id];
	const reps = card?.reps ?? 0;
	meta.appendChild(
		el(
			"span",
			"",
			t("weak.mastery", {
				current: reps,
				need: plugin.store.settings.weakMasteryReps,
			})
		)
	);
	meta.appendChild(
		el(
			"span",
			"",
			isDue(card)
				? t("weak.dueNow")
				: t("weak.dueIn", {
						n: Math.ceil(((card?.due ?? 0) - Date.now()) / 86400000),
				  })
		)
	);
	item.appendChild(meta);

	// 解释
	const explainWrap = el("div", "");
	if (q.explanation) {
		explainWrap.appendChild(el("div", "qn-explain", q.explanation));
	}
	item.appendChild(explainWrap);

	// 操作
	const actions = el("div", "qn-item-actions");
	actions.appendChild(
		btn("qn-btn-sm", q.explanation ? t("weak.regenExplain") : t("weak.genExplain"), () => {
			void genExplanation(plugin, q, explainWrap, actions);
		})
	);
	actions.appendChild(
		btn("qn-btn-sm", t("weak.reviewThis"), () => {
			plugin.startSession({
				id: newId(),
				name: `${t("weak.sessionName")} · ${nowStamp()}`,
				questions: [q],
				index: 0,
				answers: {},
				origin: "weak",
				createdAt: Date.now(),
			});
		})
	);
	actions.appendChild(
		btn("qn-btn-sm", t("weak.mastered"), () => {
			void plugin.store.removeFromWeak(q.id).then(() => plugin.refresh());
		})
	);
	item.appendChild(actions);

	return item;
}

/** 生成解释：优先 AI，失败或未配置则用启发式从源笔记提取上下文 */
async function genExplanation(
	plugin: QuizNowApi,
	q: Question,
	explainWrap: HTMLElement,
	actions: HTMLElement
): Promise<void> {
	// 防止重复点击
	actions.querySelectorAll("button").forEach((b) => {
		(b as HTMLButtonElement).disabled = true;
	});
	explainWrap.empty();
	explainWrap.appendChild(loading(t("weak.generating")));

	const noteContent = await plugin.getNoteContentFor(q.source);
	let text: string | null = null;

	const s = plugin.store.settings;
	if (s.aiEnabled && s.aiApiKey) {
		try {
			text = await aiExplainQuestion({
				baseUrl: s.aiBaseUrl,
				apiKey: s.aiApiKey,
				model: s.aiModel,
				question: q,
				noteContext: noteContent,
			});
		} catch (e) {
			new Notice(t("weak.aiExplainFail", { msg: (e as Error).message }));
		}
	}
	if (!text) {
		text = heuristicExplanation(q, noteContent, q.source || "note");
	}

	q.explanation = text;
	await plugin.store.updateQuestion(q);
	explainWrap.empty();
	explainWrap.appendChild(el("div", "qn-explain", text));
	actions.querySelectorAll("button").forEach((b) => {
		(b as HTMLButtonElement).disabled = false;
	});
}

function shuffle<T>(arr: T[]): T[] {
	const a = [...arr];
	for (let i = a.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[a[i], a[j]] = [a[j], a[i]];
	}
	return a;
}

function nowStamp(): string {
	const d = new Date();
	return `${String(d.getMonth() + 1).padStart(2, "0")}-${String(
		d.getDate()
	).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(
		d.getMinutes()
	).padStart(2, "0")}`;
}
