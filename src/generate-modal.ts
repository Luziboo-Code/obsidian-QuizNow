import { Modal, Notice, type App } from "obsidian";
import type { QuizNowApi } from "./plugin-api";
import type { Question, QuestionType } from "./types";
import { answerText, newId, displayContent, cleanOption } from "./question";
import { el, btn, badge } from "./ui";
import { t } from "./i18n";

const TYPE_KEYS: QuestionType[] = ["single", "multiple", "fill", "judge"];

export interface GenerationConfig {
	count: number;
	includeTypes: QuestionType[];
	useAi: boolean;
}

/**
 * 生成前配置弹窗：在「设置 → 生成方式 = 弹出配置弹窗」时，
 * 点击生成按钮后先在这里调整题目数量 / 题型 / 是否使用 AI。
 */
export class GenerationConfigModal extends Modal {
	private plugin: QuizNowApi;
	private onConfirm: (config: GenerationConfig) => void;

	constructor(
		app: App,
		plugin: QuizNowApi,
		onConfirm: (config: GenerationConfig) => void
	) {
		super(app);
		this.plugin = plugin;
		this.onConfirm = onConfirm;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.addClass("qn-view");
		contentEl.empty();

		const wrap = el("div", "qn-content");
		wrap.style.padding = "14px";
		contentEl.appendChild(wrap);

		const title = el("div", "qn-title", t("genConfig.title"));
		wrap.appendChild(title);

		const s = this.plugin.store.settings;
		const aiAvailable = s.aiEnabled && !!s.aiApiKey;

		// 题目数量
		const countInput = el("input", "qn-input") as HTMLInputElement;
		countInput.type = "number";
		countInput.min = "1";
		countInput.max = "50";
		countInput.value = String(s.aiCount || s.defaultCount || 5);
		const countField = el("div", "qn-field");
		countField.appendChild(el("label", "", t("genConfig.count")));
		countField.appendChild(countInput);
		wrap.appendChild(countField);

		// 题型
		const chipsWrap = el("div", "qn-chips");
		const chosen: Record<QuestionType, boolean> = { ...s.includeTypes };
		for (const type of TYPE_KEYS) {
			const chip = el(
				"button",
				"qn-chip" + (chosen[type] ? " active" : ""),
				t(`type.${type}`)
			);
			chip.addEventListener("click", () => {
				chosen[type] = !chosen[type];
				chip.classList.toggle("active", chosen[type]);
			});
			chipsWrap.appendChild(chip);
		}
		const typeField = el("div", "qn-field");
		typeField.appendChild(el("label", "", t("genConfig.types")));
		typeField.appendChild(chipsWrap);
		wrap.appendChild(typeField);

		// 是否使用 AI
		const useAiToggle = el("input", "") as HTMLInputElement;
		useAiToggle.type = "checkbox";
		useAiToggle.checked = aiAvailable;
		useAiToggle.disabled = !aiAvailable;
		const aiRow = el("label", "qn-check-row");
		aiRow.appendChild(useAiToggle);
		aiRow.appendChild(
			el("span", "", aiAvailable ? t("genConfig.useAi") : t("genConfig.noAi"))
		);
		wrap.appendChild(aiRow);

		// 操作
		const row = el("div", "qn-btn-row");
		row.appendChild(
			btn("qn-btn-primary", t("genConfig.start"), () => {
				const count = Math.max(1, parseInt(countInput.value, 10) || 5);
				const includeTypes = TYPE_KEYS.filter((type) => chosen[type]);
				if (includeTypes.length === 0) {
					new Notice(t("exam.noType"));
					return;
				}
				this.close();
				this.onConfirm({ count, includeTypes, useAi: useAiToggle.checked });
			})
		);
		row.appendChild(btn("", t("gen.cancel"), () => this.close()));
		wrap.appendChild(row);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

/**
 * 生成结果弹窗：预览题目，并提供「立即答题」/「加入题库」两个去向。
 */
export class GenerationModal extends Modal {
	private plugin: QuizNowApi;
	private questions: Question[];
	private sourceName: string;

	constructor(
		app: App,
		plugin: QuizNowApi,
		questions: Question[],
		sourceName: string
	) {
		super(app);
		this.plugin = plugin;
		this.questions = questions;
		this.sourceName = sourceName;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.addClass("qn-view");
		contentEl.empty();

		const wrap = el("div", "qn-content");
		wrap.style.padding = "14px";
		contentEl.appendChild(wrap);

		const title = el("div", "qn-title", t("gen.title", { n: this.questions.length }));
		wrap.appendChild(title);
		wrap.appendChild(
			el("div", "qn-subtitle", t("gen.subtitle", { name: this.sourceName }))
		);

		// 预览列表
		const list = el("div", "qn-scroll-list");
		this.questions.forEach((q, i) => {
			const item = el("div", "qn-gen-item");
			const head = el("div", "qn-question-head");
			head.appendChild(badge(q.type));
			head.appendChild(el("span", "qn-note", t("gen.qNo", { n: i + 1 })));
			item.appendChild(head);
			item.appendChild(el("div", "qn-question-content", displayContent(q.content)));
			if (q.options && q.options.length > 0) {
				const opts = el("div", "qn-gen-answer");
				opts.textContent = q.options
					.map((o, j) => `${String.fromCharCode(65 + j)}. ${cleanOption(o)}`)
					.join("　");
				item.appendChild(opts);
			}
			const ans = el("div", "qn-gen-answer");
			ans.appendChild(el("span", "", t("gen.answer")));
			ans.appendChild(el("b", "", answerText(q)));
			item.appendChild(ans);
			list.appendChild(item);
		});
		wrap.appendChild(list);

		// 操作
		const row = el("div", "qn-btn-row");
		row.appendChild(
			btn("qn-btn-primary", t("gen.start"), () => {
				this.close();
				this.plugin.startSession({
					id: newId(),
					name: `${this.sourceName} · ${nowStamp()}`,
					questions: this.questions,
					index: 0,
					answers: {},
					origin: "note",
					createdAt: Date.now(),
				});
			})
		);
		row.appendChild(
			btn("", t("gen.addBank"), () => {
				void (async () => {
					const added = await this.plugin.store.addManyToBank(this.questions);
					new Notice(
						t("gen.added", { n: added, folder: this.plugin.store.bankPath() })
					);
					this.close();
					this.plugin.refresh();
				})();
			})
		);
		row.appendChild(btn("", t("gen.cancel"), () => this.close()));
		wrap.appendChild(row);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

function nowStamp(): string {
	const d = new Date();
	return `${String(d.getMonth() + 1).padStart(2, "0")}-${String(
		d.getDate()
	).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(
		d.getMinutes()
	).padStart(2, "0")}`;
}
