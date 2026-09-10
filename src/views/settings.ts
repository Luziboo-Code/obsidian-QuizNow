import { Notice, setIcon } from "obsidian";
import type { QuizNowApi } from "../plugin-api";
import { AI_PROVIDER_IDS, AI_PROVIDER_PRESETS } from "../types";
import type { AiProfile, AiProvider, CustomPrompt, Lang, QuestionType, Settings } from "../types";
import { aiTestConnection } from "../ai";
import { newId } from "../question";
import { el, clear, btn, field, confirmDialog } from "../ui";
import { LANG_IDS, LANG_LABELS, t } from "../i18n";

const TYPE_KEYS: QuestionType[] = ["single", "multiple", "fill", "judge"];

/**
 * 设置界面：所有配置修改后自动保存并即时生效，无需点击保存按钮。
 * 文本/数字输入防抖保存（不打断打字），下拉框/复选框/题型等即时保存。
 */
export function renderSettings(container: HTMLElement, plugin: QuizNowApi): void {
	clear(container);
	const s = plugin.store.settings;

	// 本地状态（保存时才写回）
	const prompts: CustomPrompt[] = s.customPrompts.map((p) => ({ ...p }));
	let activePromptId = s.activePromptId;

	// 底部自动保存状态条（sticky，始终可见）
	const saveBar = el("div", "qn-save-bar");
	const statusEl = el("span", "qn-autosave-status", t("settings.autoSaveHint"));
	saveBar.appendChild(statusEl);

	let statusTimer: number | null = null;
	const flashStatus = (): void => {
		statusEl.textContent = t("settings.autoSaved");
		if (statusTimer) window.clearTimeout(statusTimer);
		statusTimer = window.setTimeout(() => {
			statusEl.textContent = t("settings.autoSaveHint");
		}, 1600);
	};

	/** 自动保存（immediate = 即时保存；否则防抖） */
	const saveSettings = (patch: Partial<Settings>, immediate = false): void => {
		const apply = (): void => {
			const langChanged =
				patch.language !== undefined &&
				patch.language !== plugin.store.settings.language;
			void plugin.store.updateSettings(patch).then(() => {
				flashStatus();
				if (langChanged) {
					// 语言变化：立即刷新界面并重注册命令
					plugin.refreshCommands?.(true);
					plugin.refresh();
				}
			}).catch((e) => new Notice(t("settings.saveFail", { msg: String(e) })));
		};
		if (immediate) {
			// 先冲刷尚未保存的防抖输入，避免丢失或让过期值覆盖本次写入
			if (debounceTimer !== null && pendingSave) {
				window.clearTimeout(debounceTimer);
				debounceTimer = null;
				const flush = pendingSave;
				pendingSave = null;
				flush();
			}
			apply();
		} else {
			if (debounceTimer !== null) window.clearTimeout(debounceTimer);
			const deferred = apply;
			pendingSave = deferred;
			debounceTimer = window.setTimeout(() => {
				debounceTimer = null;
				pendingSave = null;
				deferred();
			}, 400);
		}
	};
	let debounceTimer: number | null = null;
	let pendingSave: (() => void) | null = null;

	const title = el("div", "qn-title");
	setIcon(title, "settings");
	title.appendChild(el("span", "", t("settings.title")));
	container.appendChild(title);

	const card = el("div", "qn-card qn-fade");

	// ---- 界面语言 ----
	card.appendChild(el("div", "qn-subtitle", t("settings.language")));
	const langSel = el("select", "qn-select");
	for (const id of LANG_IDS) {
		const o = el("option", "", LANG_LABELS[id]);
		o.value = id;
		langSel.appendChild(o);
	}
	langSel.value = s.language;
	langSel.addEventListener("change", () => {
		saveSettings({ language: langSel.value as Lang }, true);
	});
	card.appendChild(field(t("settings.language"), langSel, "💡 " + t("settings.langHint")));

	// ---- 考试 ----
	card.appendChild(el("div", "qn-divider"));
	card.appendChild(el("div", "qn-subtitle", t("settings.exam")));
	const bankInput = el("input", "qn-input");
	bankInput.value = plugin.store.bankPath();
	bankInput.addEventListener("input", () => {
		saveSettings({ bankFile: bankInput.value.trim() });
	});
	card.appendChild(
		field(t("settings.bankFolder"), bankInput, t("settings.bankFolderHint"))
	);

	const countInput = el("input", "qn-input");
	countInput.type = "number";
	countInput.min = "1";
	countInput.value = String(s.defaultCount);
	countInput.addEventListener("input", () => {
		saveSettings({ defaultCount: Math.max(1, parseInt(countInput.value, 10) || 10) });
	});
	card.appendChild(field(t("settings.defaultCount"), countInput));

	const scoreSel = el("select", "qn-select");
	for (const [v, label] of [
		["percent", t("settings.percent")],
		["points", t("settings.points")],
	] as const) {
		const o = el("option", "", label);
		o.value = v;
		scoreSel.appendChild(o);
	}
	scoreSel.value = s.scoreMode;
	scoreSel.addEventListener("change", () => {
		saveSettings({ scoreMode: scoreSel.value as Settings["scoreMode"] }, true);
	});
	card.appendChild(field(t("settings.scoreMode"), scoreSel));

	const pointsInput = el("input", "qn-input");
	pointsInput.type = "number";
	pointsInput.min = "1";
	pointsInput.value = String(s.pointsPerQuestion);
	pointsInput.addEventListener("input", () => {
		saveSettings({
			pointsPerQuestion: Math.max(1, parseInt(pointsInput.value, 10) || 10),
		});
	});
	card.appendChild(field(t("settings.pointsPer"), pointsInput));

	const homeLimitInput = el("input", "qn-input");
	homeLimitInput.type = "number";
	homeLimitInput.min = "0";
	homeLimitInput.value = String(s.homePaperLimit || 0);
	homeLimitInput.addEventListener("input", () => {
		saveSettings({ homePaperLimit: Math.max(0, parseInt(homeLimitInput.value, 10) || 0) });
	});
	card.appendChild(field(t("settings.homeLimit"), homeLimitInput, t("settings.homeLimitHelp")));

	// 生成方式：直接生成 / 弹出配置弹窗
	const genModeWrap = el("div", "qn-chips");
	let genMode: "direct" | "dialog" = s.genMode || "dialog";
	const mkGenChip = (value: "direct" | "dialog", label: string) => {
		const chip = el(
			"button",
			"qn-chip" + (genMode === value ? " active" : ""),
			label
		);
		chip.addEventListener("click", () => {
			genMode = value;
			genModeWrap
				.querySelectorAll(".qn-chip")
				.forEach((n) => n.classList.remove("active"));
			chip.classList.add("active");
			saveSettings({ genMode: value }, true);
		});
		return chip;
	};
	genModeWrap.appendChild(mkGenChip("direct", t("settings.genMode.direct")));
	genModeWrap.appendChild(mkGenChip("dialog", t("settings.genMode.dialog")));
	card.appendChild(
		field(t("settings.genMode"), genModeWrap, t("settings.genModeHint"))
	);

	// ---- 复习 ----
	card.appendChild(el("div", "qn-divider"));
	card.appendChild(el("div", "qn-subtitle", t("settings.review")));
	const efInput = el("input", "qn-input");
	efInput.type = "number";
	efInput.step = "0.1";
	efInput.min = "1.3";
	efInput.value = String(s.sm2InitialEF);
	efInput.addEventListener("input", () => {
		saveSettings({ sm2InitialEF: Math.max(1.3, parseFloat(efInput.value) || 2.5) });
	});
	card.appendChild(field(t("settings.ef"), efInput, t("settings.efHelp")));

	const minIntervalInput = el("input", "qn-input");
	minIntervalInput.type = "number";
	minIntervalInput.min = "0";
	minIntervalInput.value = String(s.sm2MinInterval);
	minIntervalInput.addEventListener("input", () => {
		saveSettings({
			sm2MinInterval: Math.max(0, parseInt(minIntervalInput.value, 10) || 1),
		});
	});
	card.appendChild(field(t("settings.minInterval"), minIntervalInput));

	const masteryInput = el("input", "qn-input");
	masteryInput.type = "number";
	masteryInput.min = "1";
	masteryInput.value = String(s.weakMasteryReps);
	masteryInput.addEventListener("input", () => {
		saveSettings({
			weakMasteryReps: Math.max(1, parseInt(masteryInput.value, 10) || 2),
		});
	});
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
			saveSettings({ includeTypes: { ...chosen } }, true);
		});
		chipsWrap.appendChild(chip);
	}
	card.appendChild(field(t("settings.typesDefault"), chipsWrap));

	// ---- AI ----
	card.appendChild(el("div", "qn-divider"));
	card.appendChild(el("div", "qn-subtitle", t("settings.ai")));
	const aiToggle = el("input");
	aiToggle.type = "checkbox";
	aiToggle.checked = s.aiEnabled;
	aiToggle.addEventListener("change", () => {
		saveSettings({ aiEnabled: aiToggle.checked }, true);
	});
	const aiCheckRow = el("label", "qn-check-row");
	aiCheckRow.appendChild(aiToggle);
	aiCheckRow.appendChild(el("span", "", t("settings.aiEnable")));
	card.appendChild(aiCheckRow);

	// 服务商切换（OpenAI / DeepSeek / Ollama 本地 / 自定义）：切换时预填默认地址与模型
	const provSel = el("select", "qn-select");
	for (const p of AI_PROVIDER_IDS) {
		const o = el("option", "", t(`ai.provider.${p}`));
		o.value = p;
		provSel.appendChild(o);
	}
	provSel.value = s.aiProvider || "openai";

	const urlInput = el("input", "qn-input");
	urlInput.value = s.aiBaseUrl;
	urlInput.addEventListener("input", () => {
		saveSettings({ aiBaseUrl: urlInput.value.trim() });
	});

	const keyInput = el("input", "qn-input");
	keyInput.type = "password";
	keyInput.value = s.aiApiKey;
	keyInput.placeholder = "sk-...";
	keyInput.addEventListener("input", () => {
		saveSettings({ aiApiKey: keyInput.value.trim() });
	});

	const modelInput = el("input", "qn-input");
	modelInput.value = s.aiModel;
	modelInput.addEventListener("input", () => {
		saveSettings({ aiModel: modelInput.value.trim() });
	});

	// Key 字段（含动态提示：本地服务商如 Ollama 无需 API Key）
	const keyField = el("div", "qn-field");
	keyField.appendChild(el("label", "", t("settings.apiKey")));
	keyField.appendChild(keyInput);
	const keyHintEl = el("div", "qn-note", "");
	keyField.appendChild(keyHintEl);

	/** 按服务商同步 Key 输入框状态（不写设置） */
	const syncProviderUi = (p: AiProvider): void => {
		const preset = AI_PROVIDER_PRESETS[p];
		if (!preset) return;
		keyInput.disabled = !preset.needsKey;
		keyHintEl.textContent = preset.needsKey ? "" : t("ai.noKey");
	};
	syncProviderUi(s.aiProvider || "openai");

	provSel.addEventListener("change", () => {
		const cur = plugin.store.settings;
		const prev = cur.aiProvider || "openai";
		const next = provSel.value as AiProvider;
		if (next === prev) return;

		// 1. 归档当前地址/Key/模型到「上一个服务商」的配置记忆（切换不丢失已配置的值）
		const profiles: Partial<Record<AiProvider, AiProfile>> = {
			...(cur.aiProfiles || {}),
		};
		profiles[prev] = {
			baseUrl: urlInput.value.trim(),
			apiKey: keyInput.value.trim(),
			model: modelInput.value.trim(),
		};

		// 2. 载入下一个服务商已保存的配置；从未配置过则用预设默认值填充
		const incoming = profiles[next];
		const preset = AI_PROVIDER_PRESETS[next];
		const url = incoming?.baseUrl ?? (preset.baseUrl || ""); // 自定义服务商无预设地址，留空待填
		const key = incoming?.apiKey ?? "";
		const model = incoming?.model ?? preset.model;

		urlInput.value = url;
		keyInput.value = key;
		modelInput.value = model;
		syncProviderUi(next);

		saveSettings(
			{
				aiProvider: next,
				aiBaseUrl: url,
				aiApiKey: key,
				aiModel: model,
				aiProfiles: profiles,
			},
			true
		);
	});

	card.appendChild(field(t("settings.aiProvider"), provSel, t("settings.aiProviderHelp")));
	card.appendChild(field(t("settings.apiUrl"), urlInput, t("settings.apiUrlHelp")));
	card.appendChild(keyField);
	card.appendChild(field(t("settings.model"), modelInput));

	// 测试 AI 连接：用当前界面中的地址/Key/模型发送一条超短提示词，结果就地显示
	const testBtn = btn("", t("settings.aiTest"), () => {
		void runAiTest();
	});
	const testStatus = el("div", "qn-note qn-ai-test", "");
	const runAiTest = async (): Promise<void> => {
		const url = urlInput.value.trim();
		const model = modelInput.value.trim();
		if (!url || !model) {
			testStatus.className = "qn-note qn-ai-test fail";
			testStatus.textContent = t("ai.testInvalid");
			return;
		}
		testBtn.disabled = true;
		testBtn.textContent = t("ai.testTesting");
		try {
			const reply = await aiTestConnection(url, keyInput.value.trim(), model);
			testStatus.className = "qn-note qn-ai-test ok";
			testStatus.textContent = t("ai.testOk", { reply: reply.slice(0, 60) });
		} catch (e) {
			testStatus.className = "qn-note qn-ai-test fail";
			testStatus.textContent = String((e as Error).message);
		} finally {
			testBtn.disabled = false;
			testBtn.textContent = t("settings.aiTest");
		}
	};
	card.appendChild(testBtn);
	card.appendChild(testStatus);

	const aiCountInput = el("input", "qn-input");
	aiCountInput.type = "number";
	aiCountInput.min = "1";
	aiCountInput.max = "20";
	aiCountInput.value = String(s.aiCount);
	aiCountInput.addEventListener("input", () => {
		saveSettings({
			aiCount: Math.min(20, Math.max(1, parseInt(aiCountInput.value, 10) || 5)),
		});
	});
	card.appendChild(field(t("settings.aiCount"), aiCountInput));

	const aiExpToggle = el("input");
	aiExpToggle.type = "checkbox";
	aiExpToggle.checked = s.aiExplanation;
	aiExpToggle.addEventListener("change", () => {
		saveSettings({ aiExplanation: aiExpToggle.checked }, true);
	});
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
		const activeSel = el("select", "qn-select");
		const optDefault = el("option", "", t("settings.promptDefault"));
		optDefault.value = "";
		activeSel.appendChild(optDefault);
		for (const p of prompts) {
			const o = el("option", "", p.name);
			o.value = p.id;
			activeSel.appendChild(o);
		}
		activeSel.value = activePromptId;
		activeSel.addEventListener("change", () => {
			activePromptId = activeSel.value;
			saveSettings({ activePromptId }, true);
		});
		promptsBox.appendChild(field(t("settings.promptActive"), activeSel));

		// 指令列表
		if (prompts.length === 0) {
			promptsBox.appendChild(el("div", "qn-note", t("settings.promptEmpty")));
		} else {
			const list = el("div", "qn-scroll-list");
			for (const p of prompts) {
				const row = el("div", "qn-item");
				const headRow = el("div", "qn-flex-between");
				headRow.appendChild(el("div", "qn-paper-name", p.name));
				const del = btn("qn-btn-danger qn-btn-sm", t("settings.promptDelete"), () => {
					const idx = prompts.indexOf(p);
					if (idx >= 0) prompts.splice(idx, 1);
					if (activePromptId === p.id) activePromptId = "";
					saveSettings({ customPrompts: prompts, activePromptId }, true);
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
		const nameInput = el("input", "qn-input");
		nameInput.type = "text";
		nameInput.placeholder = t("settings.promptName");
		addBox.appendChild(el("label", "", t("settings.promptName")));
		addBox.appendChild(nameInput);
		const contentInput = el("textarea", "qn-textarea");
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
				saveSettings({ customPrompts: prompts, activePromptId }, true);
				renderPromptsBox();
			})
		);
		promptsBox.appendChild(addBox);
	};
	renderPromptsBox();

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
		confirmDialog(
			plugin.app,
			t("settings.restoreConfirm"),
			() => {
				void (async () => {
					try {
						await plugin.store.restoreBackup(b.path);
						new Notice(t("settings.restored", { name: b.name }));
						plugin.refresh();
					} catch (e) {
						new Notice(t("settings.restoreFail", { msg: (e as Error).message }));
					}
				})();
			}
		);
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
			const headRow = el("div", "qn-flex-between");
			headRow.appendChild(el("div", "qn-paper-name", b.name));
			const actionsRow = el("div", "qn-flex");
			const restoreBtn = btn("qn-btn-sm", t("settings.restore"), () => {
				void restoreFrom(b);
			});
			actionsRow.appendChild(restoreBtn);
			const delBtn = btn("qn-btn-sm qn-btn-danger", t("settings.deleteBackup"), () => {
				confirmDialog(plugin.app, t("settings.deleteBackupConfirm"), () => {
					void (async () => {
						try {
							await plugin.store.deleteBackup(b.path);
							new Notice(t("settings.backupDeleted"));
							await renderBackups();
						} catch (e) {
							new Notice(t("settings.restoreFail", { msg: (e as Error).message }));
						}
					})();
				});
			});
			actionsRow.appendChild(delBtn);
			headRow.appendChild(actionsRow);
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
			confirmDialog(plugin.app, t("settings.clearExamsConfirm"), () => {
				plugin.store.data.examRecords = [];
				plugin.store.data.paperBest = {};
				void plugin.store.save().then(() => {
					new Notice(t("settings.examsCleared"));
					plugin.refresh();
				});
			});
		})
	);
	row.appendChild(
		btn("qn-btn-danger qn-btn-sm", t("settings.clearProgress"), () => {
			confirmDialog(plugin.app, t("settings.clearProgressConfirm"), () => {
				plugin.store.data.reviewIds = [];
				plugin.store.data.weakIds = [];
				plugin.store.data.sm = {};
				void plugin.store.save().then(() => {
					new Notice(t("settings.progressCleared"));
					plugin.refresh();
				});
			});
		})
	);
	danger.appendChild(row);
	container.appendChild(danger);

	// 自动保存状态条（放在最后，sticky 吸附底部）
	container.appendChild(saveBar);
}
