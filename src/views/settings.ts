import { Notice, setIcon } from "obsidian";
import type { QuizNowApi } from "../plugin-api";
import type { CustomPrompt, Lang, QuestionType, Settings } from "../types";
import { newId } from "../question";
import { el, clear, btn, field } from "../ui";
import { LANG_IDS, LANG_LABELS, t } from "../i18n";

const TYPE_KEYS: QuestionType[] = ["single", "multiple", "fill", "judge"];

export function renderSettings(container: HTMLElement, plugin: QuizNowApi): void {
	clear(container);
	const s = plugin.store.settings;

	// 本地状态（保存时才写回）
	const prompts: CustomPrompt[] = s.customPrompts.map((p) => ({ ...p }));
	let activePromptId = s.activePromptId;

	const title = el("div", "qn-title");
	setIcon(title, "settings");
	title.appendChild(el("span", "", t("settings.title")));
	container.appendChild(title);

	const card = el("div", "qn-card qn-fade");

	// ---- 界面语言 ----
	card.appendChild(el("div", "qn-subtitle", t("settings.language")));
	const langSel = el("select", "qn-select") as HTMLSelectElement;
	for (const id of LANG_IDS) {
		const o = document.createElement("option");
		o.value = id;
		o.textContent = LANG_LABELS[id];
		langSel.appendChild(o);
	}
	langSel.value = s.language;
	card.appendChild(field(t("settings.language"), langSel, "💡 " + t("settings.langHint")));

	// ---- 考试 ----
	card.appendChild(el("div", "qn-divider"));
	card.appendChild(el("div", "qn-subtitle", t("settings.exam")));
	const bankInput = el("input", "qn-input") as HTMLInputElement;
	bankInput.value = s.bankFile;
	card.appendChild(field(t("settings.bankFolder"), bankInput));

	const countInput = el("input", "qn-input") as HTMLInputElement;
	countInput.type = "number";
	countInput.min = "1";
	countInput.value = String(s.defaultCount);
	card.appendChild(field(t("settings.defaultCount"), countInput));

	const scoreSel = el("select", "qn-select") as HTMLSelectElement;
	for (const [v, label] of [
		["percent", t("settings.percent")],
		["points", t("settings.points")],
	] as const) {
		const o = document.createElement("option");
		o.value = v;
		o.textContent = label;
		scoreSel.appendChild(o);
	}
	scoreSel.value = s.scoreMode;
	card.appendChild(field(t("settings.scoreMode"), scoreSel));

	const pointsInput = el("input", "qn-input") as HTMLInputElement;
	pointsInput.type = "number";
	pointsInput.min = "1";
	pointsInput.value = String(s.pointsPerQuestion);
	card.appendChild(field(t("settings.pointsPer"), pointsInput));

	const homeLimitInput = el("input", "qn-input") as HTMLInputElement;
	homeLimitInput.type = "number";
	homeLimitInput.min = "0";
	homeLimitInput.value = String(s.homePaperLimit || 0);
	card.appendChild(field(t("settings.homeLimit"), homeLimitInput, t("settings.homeLimitHelp")));

	// ---- 复习 ----
	card.appendChild(el("div", "qn-divider"));
	card.appendChild(el("div", "qn-subtitle", t("settings.review")));
	const efInput = el("input", "qn-input") as HTMLInputElement;
	efInput.type = "number";
	efInput.step = "0.1";
	efInput.min = "1.3";
	efInput.value = String(s.sm2InitialEF);
	card.appendChild(field(t("settings.ef"), efInput, t("settings.efHelp")));

	const minIntervalInput = el("input", "qn-input") as HTMLInputElement;
	minIntervalInput.type = "number";
	minIntervalInput.min = "0";
	minIntervalInput.value = String(s.sm2MinInterval);
	card.appendChild(field(t("settings.minInterval"), minIntervalInput));

	const masteryInput = el("input", "qn-input") as HTMLInputElement;
	masteryInput.type = "number";
	masteryInput.min = "1";
	masteryInput.value = String(s.weakMasteryReps);
	card.appendChild(field(t("settings.masteryReps"), masteryInput));

	// ---- 题型 ----
	card.appendChild(el("div", "qn-divider"));
	card.appendChild(el("div", "qn-subtitle", t("settings.types")));
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
	card.appendChild(field(t("settings.typesDefault"), chipsWrap));

	// ---- AI ----
	card.appendChild(el("div", "qn-divider"));
	card.appendChild(el("div", "qn-subtitle", t("settings.ai")));
	const aiToggle = el("input", "") as HTMLInputElement;
	aiToggle.type = "checkbox";
	aiToggle.checked = s.aiEnabled;
	const aiCheckRow = el("label", "qn-check-row");
	aiCheckRow.appendChild(aiToggle);
	aiCheckRow.appendChild(el("span", "", t("settings.aiEnable")));
	card.appendChild(aiCheckRow);

	const urlInput = el("input", "qn-input") as HTMLInputElement;
	urlInput.value = s.aiBaseUrl;
	card.appendChild(field(t("settings.apiUrl"), urlInput, t("settings.apiUrlHelp")));

	const keyInput = el("input", "qn-input") as HTMLInputElement;
	keyInput.type = "password";
	keyInput.value = s.aiApiKey;
	keyInput.placeholder = "sk-...";
	card.appendChild(field(t("settings.apiKey"), keyInput));

	const modelInput = el("input", "qn-input") as HTMLInputElement;
	modelInput.value = s.aiModel;
	card.appendChild(field(t("settings.model"), modelInput));

	const aiCountInput = el("input", "qn-input") as HTMLInputElement;
	aiCountInput.type = "number";
	aiCountInput.min = "1";
	aiCountInput.max = "20";
	aiCountInput.value = String(s.aiCount);
	card.appendChild(field(t("settings.aiCount"), aiCountInput));

	const aiExpToggle = el("input", "") as HTMLInputElement;
	aiExpToggle.type = "checkbox";
	aiExpToggle.checked = s.aiExplanation;
	const aiExpRow = el("label", "qn-check-row");
	aiExpRow.appendChild(aiExpToggle);
	aiExpRow.appendChild(el("span", "", t("settings.aiExplain")));
	card.appendChild(aiExpRow);

	// ---- 自定义生成指令 ----
	card.appendChild(el("div", "qn-divider"));
	card.appendChild(el("div", "qn-subtitle", t("settings.prompts")));
	card.appendChild(el("div", "qn-note", t("settings.promptsHelp")));

	const promptsBox = el("div", "");
	card.appendChild(promptsBox);

	const renderPromptsBox = (): void => {
		clear(promptsBox);

		// 当前使用指令
		const activeSel = el("select", "qn-select") as HTMLSelectElement;
		const optDefault = document.createElement("option");
		optDefault.value = "";
		optDefault.textContent = t("settings.promptDefault");
		activeSel.appendChild(optDefault);
		for (const p of prompts) {
			const o = document.createElement("option");
			o.value = p.id;
			o.textContent = p.name;
			activeSel.appendChild(o);
		}
		activeSel.value = activePromptId;
		activeSel.addEventListener("change", () => {
			activePromptId = activeSel.value;
		});
		promptsBox.appendChild(field(t("settings.promptActive"), activeSel));

		// 指令列表
		if (prompts.length === 0) {
			promptsBox.appendChild(el("div", "qn-note", t("settings.promptEmpty")));
		} else {
			const list = el("div", "qn-scroll-list");
			for (const p of prompts) {
				const row = el("div", "qn-item");
				const headRow = el("div", "");
				headRow.style.display = "flex";
				headRow.style.alignItems = "center";
				headRow.style.justifyContent = "space-between";
				headRow.style.gap = "8px";
				headRow.appendChild(el("div", "qn-paper-name", p.name));
				const del = btn("qn-btn-danger qn-btn-sm", t("settings.promptDelete"), () => {
					const idx = prompts.indexOf(p);
					if (idx >= 0) prompts.splice(idx, 1);
					if (activePromptId === p.id) activePromptId = "";
					renderPromptsBox();
				});
				headRow.appendChild(del);
				row.appendChild(headRow);
				row.appendChild(el("div", "qn-gen-answer", p.content.slice(0, 120)));
				list.appendChild(row);
			}
			promptsBox.appendChild(list);
		}

		// 新增指令
		const addBox = el("div", "qn-field");
		const nameInput = el("input", "qn-input") as HTMLInputElement;
		nameInput.type = "text";
		nameInput.placeholder = t("settings.promptName");
		addBox.appendChild(el("label", "", t("settings.promptName")));
		addBox.appendChild(nameInput);
		const contentInput = el("textarea", "qn-textarea") as HTMLTextAreaElement;
		contentInput.placeholder = t("settings.promptContent");
		addBox.appendChild(el("label", "", t("settings.promptContent")));
		addBox.appendChild(contentInput);
		addBox.appendChild(
			btn("qn-btn qn-btn-block", t("settings.promptSave"), () => {
				const name = nameInput.value.trim();
				const content = contentInput.value.trim();
				if (!name || !content) {
					new Notice(t("settings.promptInvalid"));
					return;
				}
				prompts.push({ id: newId(), name, content });
				activePromptId = prompts[prompts.length - 1].id;
				renderPromptsBox();
			})
		);
		promptsBox.appendChild(addBox);
	};
	renderPromptsBox();

	// ---- 保存 ----
	card.appendChild(el("div", "qn-divider"));
	card.appendChild(
		btn("qn-btn-primary qn-btn-block", t("settings.save"), () => {
			const patch: Partial<Settings> = {
				language: langSel.value as Lang,
				bankFile: bankInput.value.trim() || "QuizNow/题库.json",
				defaultCount: Math.max(1, parseInt(countInput.value, 10) || 10),
				scoreMode: scoreSel.value as Settings["scoreMode"],
				pointsPerQuestion: Math.max(1, parseInt(pointsInput.value, 10) || 10),
				homePaperLimit: Math.max(0, parseInt(homeLimitInput.value, 10) || 0),
				sm2InitialEF: Math.max(1.3, parseFloat(efInput.value) || 2.5),
				sm2MinInterval: Math.max(0, parseInt(minIntervalInput.value, 10) || 1),
				weakMasteryReps: Math.max(1, parseInt(masteryInput.value, 10) || 2),
				includeTypes: { ...chosen },
				aiEnabled: aiToggle.checked,
				aiBaseUrl: urlInput.value.trim() || "https://api.openai.com/v1",
				aiApiKey: keyInput.value.trim(),
				aiModel: modelInput.value.trim() || "gpt-4o-mini",
				aiCount: Math.min(20, Math.max(1, parseInt(aiCountInput.value, 10) || 5)),
				aiExplanation: aiExpToggle.checked,
				customPrompts: prompts,
				activePromptId,
			};
			void plugin.store.updateSettings(patch).then(() => {
				new Notice(t("settings.saved"));
				plugin.refresh();
			});
		})
	);
	container.appendChild(card);

	// ---- 数据备份 ----
	const backupCard = el("div", "qn-card qn-fade");
	backupCard.appendChild(el("div", "qn-subtitle", t("settings.backup")));
	backupCard.appendChild(el("div", "qn-note", t("settings.backupHint")));
	backupCard.appendChild(
		el("div", "qn-note", t("settings.backupDir", { dir: plugin.store.backupFolder() }))
	);
	backupCard.appendChild(
		btn("qn-btn-primary qn-btn-block", t("settings.backupNow"), () => {
			void (async () => {
				try {
					const path = await plugin.store.createBackup();
					new Notice(t("settings.backupDone", { path }));
					await renderBackups();
				} catch (e) {
					new Notice(t("settings.restoreFail", { msg: (e as Error).message }));
				}
			})();
		})
	);
	backupCard.appendChild(el("div", "qn-divider"));
	backupCard.appendChild(el("div", "qn-note", t("settings.backupList")));

	const backupListWrap = el("div", "qn-scroll-list");
	backupCard.appendChild(backupListWrap);

	const restoreFrom = async (b: { path: string; name: string }): Promise<void> => {
		if (!confirm(t("settings.restoreConfirm"))) return;
		try {
			await plugin.store.restoreBackup(b.path);
			new Notice(t("settings.restored", { name: b.name }));
			plugin.refresh();
		} catch (e) {
			new Notice(t("settings.restoreFail", { msg: (e as Error).message }));
		}
	};

	const renderBackups = async (): Promise<void> => {
		clear(backupListWrap);
		const backups = await plugin.store.listBackups();
		if (backups.length === 0) {
			backupListWrap.appendChild(el("div", "qn-note", t("settings.noBackups")));
			return;
		}
		for (const b of backups) {
			const row = el("div", "qn-item");
			const headRow = el("div", "");
			headRow.style.display = "flex";
			headRow.style.justifyContent = "space-between";
			headRow.style.alignItems = "center";
			headRow.style.gap = "8px";
			headRow.appendChild(el("div", "qn-paper-name", b.name));
			const restoreBtn = btn("qn-btn-sm", t("settings.restore"), () => {
				void restoreFrom(b);
			});
			headRow.appendChild(restoreBtn);
			row.appendChild(headRow);
			row.appendChild(
				el(
					"div",
					"qn-item-meta",
					new Date(b.date).toLocaleString()
				)
			);
			backupListWrap.appendChild(row);
		}
	};
	void renderBackups();
	container.appendChild(backupCard);

	// ---- 危险区 ----
	const danger = el("div", "qn-card qn-fade");
	danger.appendChild(el("div", "qn-subtitle", t("settings.data")));
	const row = el("div", "qn-btn-row");
	row.appendChild(
		btn("qn-btn-danger qn-btn-sm", t("settings.clearExams"), () => {
			if (confirm(t("settings.clearExamsConfirm"))) {
				plugin.store.data.examRecords = [];
				plugin.store.data.paperBest = {};
				void plugin.store.save().then(() => {
					new Notice(t("settings.examsCleared"));
					plugin.refresh();
				});
			}
		})
	);
	row.appendChild(
		btn("qn-btn-danger qn-btn-sm", t("settings.clearProgress"), () => {
			if (confirm(t("settings.clearProgressConfirm"))) {
				plugin.store.data.reviewIds = [];
				plugin.store.data.weakIds = [];
				plugin.store.data.sm = {};
				void plugin.store.save().then(() => {
					new Notice(t("settings.progressCleared"));
					plugin.refresh();
				});
			}
		})
	);
	danger.appendChild(row);
	container.appendChild(danger);
}
