import { Notice, PluginSettingTab, Setting, type App } from "obsidian";
import type QuizNowPlugin from "./main";
import { AI_PROVIDER_IDS, AI_PROVIDER_PRESETS } from "./types";
import type {
	AiProfile,
	AiProvider,
	CustomPrompt,
	Lang,
	QuestionType,
	Settings,
} from "./types";
import { aiTestConnection } from "./ai";
import { newId } from "./question";
import { el, clear, btn, confirmDialog } from "./ui";
import { LANG_IDS, LANG_LABELS, t } from "./i18n";

const TYPE_KEYS: QuestionType[] = ["single", "multiple", "fill", "judge"];

/**
 * QuizNow 设置面板（位于「设置 → 第三方插件 → QuizNow」）。
 *
 * 所有修改即时自动保存：下拉框/开关立即写入，文本与数字输入防抖写入。
 * 注：这里沿用命令式 display() API，以兼容 minAppVersion 1.7.2 起的全部 Obsidian 版本。
 */
export class QuizNowSettingTab extends PluginSettingTab {
	private plugin: QuizNowPlugin;
	private statusEl: HTMLElement | null = null;
	private statusTimer: number | null = null;
	private debounceTimer: number | null = null;
	private pendingSave: (() => void) | null = null;

	constructor(app: App, plugin: QuizNowPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	hide(): void {
		if (this.statusTimer) window.clearTimeout(this.statusTimer);
		if (this.debounceTimer) window.clearTimeout(this.debounceTimer);
		this.pendingSave = null;
		super.hide();
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		containerEl.addClass("qn-settings");

		// ---- 顶部：状态 + 打开主面板 ----
		const head = new Setting(containerEl)
			.setName(t("settings.panelTitle"))
			.setDesc(t("settings.panelDesc"));
		head.addButton((b) =>
			b.setButtonText(t("settings.openPanel")).onClick(() => {
				this.plugin.openTab("home");
			})
		);
		this.statusEl = el("div", "qn-autosave-status", t("settings.autoSaveHint"));
		containerEl.appendChild(this.statusEl);

		this.renderGeneral(containerEl);
		this.renderExam(containerEl);
		this.renderReview(containerEl);
		this.renderTypes(containerEl);
		this.renderAi(containerEl);
		this.renderPrompts(containerEl);
		this.renderBackup(containerEl);
		this.renderDanger(containerEl);
	}

	// ---------- 自动保存 ----------

	/** 保存设置（immediate = 立即保存；否则防抖 400ms） */
	private save(patch: Partial<Settings>, immediate = false): void {
		const apply = (): void => {
			const langChanged =
				patch.language !== undefined &&
				patch.language !== this.plugin.store.settings.language;
			void this.plugin.store
				.updateSettings(patch)
				.then(() => {
					this.flashStatus();
					if (langChanged) {
						// 语言变化：立即刷新界面并重注册命令
						this.plugin.refreshCommands?.(true);
						this.plugin.refresh();
						this.display();
					}
				})
				.catch((e) =>
					new Notice(t("settings.saveFail", { msg: String(e) }))
				);
		};
		if (immediate) {
			// 先冲刷尚未保存的防抖输入，避免丢失或让过期值覆盖本次写入
			if (this.debounceTimer !== null && this.pendingSave) {
				window.clearTimeout(this.debounceTimer);
				this.debounceTimer = null;
				const flush = this.pendingSave;
				this.pendingSave = null;
				flush();
			}
			apply();
		} else {
			if (this.debounceTimer !== null) window.clearTimeout(this.debounceTimer);
			this.pendingSave = apply;
			this.debounceTimer = window.setTimeout(() => {
				this.debounceTimer = null;
				this.pendingSave = null;
				apply();
			}, 400);
		}
	}

	private flashStatus(): void {
		if (!this.statusEl) return;
		this.statusEl.textContent = t("settings.autoSaved");
		if (this.statusTimer) window.clearTimeout(this.statusTimer);
		this.statusTimer = window.setTimeout(() => {
			if (this.statusEl) this.statusEl.textContent = t("settings.autoSaveHint");
		}, 1600);
	}

	/** 文本 / 数字输入行 */
	private addText(
		parentEl: HTMLElement,
		name: string,
		desc: string | undefined,
		value: string,
		onChange: (v: string) => void,
		opts?: { type?: "text" | "number" | "password"; min?: string; step?: string; placeholder?: string }
	): Setting {
		const setting = new Setting(parentEl).setName(name);
		if (desc) setting.setDesc(desc);
		setting.addText((text) => {
			const type = opts?.type ?? "text";
			text.inputEl.type = type;
			if (opts?.min) text.inputEl.min = opts.min;
			if (opts?.step) text.inputEl.step = opts.step;
			if (opts?.placeholder) text.setPlaceholder(opts.placeholder);
			text.setValue(value).onChange((v) => onChange(v));
		});
		return setting;
	}

	// ---------- 通用 ----------

	private renderGeneral(containerEl: HTMLElement): void {
		new Setting(containerEl).setName(t("settings.section.general")).setHeading();

		new Setting(containerEl)
			.setName(t("settings.language"))
			.setDesc(t("settings.langHint"))
			.addDropdown((drop) => {
				for (const id of LANG_IDS) drop.addOption(id, LANG_LABELS[id]);
				drop.setValue(this.plugin.store.settings.language);
				drop.onChange((v) => this.save({ language: v as Lang }, true));
			});
	}

	// ---------- 考试 ----------

	private renderExam(containerEl: HTMLElement): void {
		const s = this.plugin.store.settings;
		new Setting(containerEl).setName(t("settings.exam")).setHeading();

		this.addText(
			containerEl,
			t("settings.bankFolder"),
			t("settings.bankFolderHint", { folder: this.plugin.store.folderPath() }),
			s.bankFile || this.plugin.store.bankPath(),
			(v) => this.save({ bankFile: v.trim() })
		);

		new Setting(containerEl)
			.setName(t("settings.dataFolder"))
			.setDesc(t("settings.dataFolderHint", { folder: this.plugin.store.folderPath() }))
			.addExtraButton((b) =>
				b
					.setIcon("folder-open")
					.setTooltip(t("settings.openFolder"))
					.onClick(() => this.plugin.openDataFolder())
			);

		this.addText(
			containerEl,
			t("settings.defaultCount"),
			undefined,
			String(s.defaultCount),
			(v) => this.save({ defaultCount: Math.max(1, parseInt(v, 10) || 10) }),
			{ type: "number", min: "1" }
		);

		new Setting(containerEl)
			.setName(t("settings.scoreMode"))
			.addDropdown((drop) => {
				drop.addOption("percent", t("settings.percent"));
				drop.addOption("points", t("settings.points"));
				drop.setValue(s.scoreMode);
				drop.onChange((v) =>
					this.save({ scoreMode: v as Settings["scoreMode"] }, true)
				);
			});

		this.addText(
			containerEl,
			t("settings.pointsPer"),
			undefined,
			String(s.pointsPerQuestion),
			(v) => this.save({ pointsPerQuestion: Math.max(1, parseInt(v, 10) || 10) }),
			{ type: "number", min: "1" }
		);

		this.addText(
			containerEl,
			t("settings.homeLimit"),
			t("settings.homeLimitHelp"),
			String(s.homePaperLimit || 0),
			(v) => this.save({ homePaperLimit: Math.max(0, parseInt(v, 10) || 0) }),
			{ type: "number", min: "0" }
		);

		new Setting(containerEl)
			.setName(t("settings.genMode"))
			.setDesc(t("settings.genModeHint"))
			.addDropdown((drop) => {
				drop.addOption("direct", t("settings.genMode.direct"));
				drop.addOption("dialog", t("settings.genMode.dialog"));
				drop.setValue(s.genMode || "dialog");
				drop.onChange((v) =>
					this.save({ genMode: v as Settings["genMode"] }, true)
				);
			});
	}

	// ---------- 复习 ----------

	private renderReview(containerEl: HTMLElement): void {
		const s = this.plugin.store.settings;
		new Setting(containerEl).setName(t("settings.review")).setHeading();

		this.addText(
			containerEl,
			t("settings.ef"),
			t("settings.efHelp"),
			String(s.sm2InitialEF),
			(v) => this.save({ sm2InitialEF: Math.max(1.3, parseFloat(v) || 2.5) }),
			{ type: "number", min: "1.3", step: "0.1" }
		);

		this.addText(
			containerEl,
			t("settings.minInterval"),
			undefined,
			String(s.sm2MinInterval),
			(v) => this.save({ sm2MinInterval: Math.max(0, parseInt(v, 10) || 1) }),
			{ type: "number", min: "0" }
		);

		this.addText(
			containerEl,
			t("settings.masteryReps"),
			undefined,
			String(s.weakMasteryReps),
			(v) => this.save({ weakMasteryReps: Math.max(1, parseInt(v, 10) || 2) }),
			{ type: "number", min: "1" }
		);
	}

	// ---------- 题型 ----------

	private renderTypes(containerEl: HTMLElement): void {
		new Setting(containerEl).setName(t("settings.types")).setHeading();
		const chosen: Record<QuestionType, boolean> = {
			...this.plugin.store.settings.includeTypes,
		};
		for (const type of TYPE_KEYS) {
			new Setting(containerEl)
				.setName(t(`type.${type}`))
				.addToggle((toggle) =>
					toggle.setValue(chosen[type]).onChange((v) => {
						chosen[type] = v;
						this.save({ includeTypes: { ...chosen } }, true);
					})
				);
		}
	}

	// ---------- AI ----------

	private renderAi(containerEl: HTMLElement): void {
		const s = this.plugin.store.settings;
		new Setting(containerEl).setName(t("settings.ai")).setHeading();

		new Setting(containerEl)
			.setName(t("settings.aiEnable"))
			.addToggle((toggle) =>
				toggle.setValue(s.aiEnabled).onChange((v) => {
					this.save({ aiEnabled: v }, true);
				})
			);

		// 服务商切换（切换时预填默认地址与模型，并记忆上一个服务商的配置）
		const preset = AI_PROVIDER_PRESETS[s.aiProvider || "openai"];
		const urlSetting = this.addText(
			containerEl,
			t("settings.apiUrl"),
			t("settings.apiUrlHelp"),
			s.aiBaseUrl,
			(v) => this.save({ aiBaseUrl: v.trim() }),
			{ placeholder: preset.baseUrl }
		);
		const keySetting = this.addText(
			containerEl,
			t("settings.apiKey"),
			preset.needsKey ? t("settings.apiKeyHint") : t("ai.noKey"),
			s.aiApiKey,
			(v) => this.save({ aiApiKey: v.trim() }),
			{ type: "password", placeholder: t("settings.apiKeyPlaceholder") }
		);
		const modelSetting = this.addText(
			containerEl,
			t("settings.model"),
			undefined,
			s.aiModel,
			(v) => this.save({ aiModel: v.trim() })
		);
		/** 按服务商同步 Key 输入框状态（本地服务商无需 Key） */
		const syncProviderUi = (provider: AiProvider): void => {
			const p = AI_PROVIDER_PRESETS[provider];
			const input = keySetting.settingEl.querySelector("input");
			if (input) input.disabled = !p.needsKey;
			keySetting.setDesc(p.needsKey ? t("settings.apiKeyHint") : t("ai.noKey"));
		};
		syncProviderUi(s.aiProvider || "openai");

		const providerSetting = new Setting(containerEl)
			.setName(t("settings.aiProvider"))
			.setDesc(t("settings.aiProviderHelp"));
		providerSetting.addDropdown((drop) => {
			for (const p of AI_PROVIDER_IDS) drop.addOption(p, t(`ai.provider.${p}`));
			drop.setValue(s.aiProvider || "openai");
			drop.onChange((next) => {
				const cur = this.plugin.store.settings;
				const prev = cur.aiProvider || "openai";
				const provider = next as AiProvider;
				if (provider === prev) return;
				// 1. 归档当前地址/Key/模型到「上一个服务商」的记忆
				const profiles: Partial<Record<AiProvider, AiProfile>> = {
					...(cur.aiProfiles || {}),
				};
				profiles[prev] = {
					baseUrl: this.inputValue(urlSetting),
					apiKey: this.inputValue(keySetting),
					model: this.inputValue(modelSetting),
				};
				// 2. 载入下一个服务商已保存的配置；从未配置过则用预设默认值填充
				const incoming = profiles[provider];
				const preset = AI_PROVIDER_PRESETS[provider];
				const url = incoming?.baseUrl ?? (preset.baseUrl || "");
				const key = incoming?.apiKey ?? "";
				const model = incoming?.model ?? preset.model;
				this.save(
					{
						aiProvider: provider,
						aiBaseUrl: url,
						aiApiKey: key,
						aiModel: model,
						aiProfiles: profiles,
					},
					true
				);
				this.setInputValue(urlSetting, url);
				this.setInputValue(keySetting, key);
				this.setInputValue(modelSetting, model);
				syncProviderUi(provider);
			});
		});
		// 服务商下拉置于其它 AI 字段之前
		containerEl.insertBefore(providerSetting.settingEl, urlSetting.settingEl);

		// 测试连接（用当前面板中的地址 / Key / 模型发一条超短提示词）
		const testSetting = new Setting(containerEl).setName(t("settings.aiTest"));
		const testStatus = el("div", "qn-note qn-ai-test", "");
		testSetting.addButton((b) => {
			b.setButtonText(t("settings.aiTest")).onClick(() => {
				void (async () => {
					const url = this.inputValue(urlSetting);
					const model = this.inputValue(modelSetting);
					if (!url || !model) {
						testStatus.className = "qn-note qn-ai-test fail";
						testStatus.textContent = t("ai.testInvalid");
						return;
					}
					b.setDisabled(true);
					b.setButtonText(t("ai.testTesting"));
					try {
						const reply = await aiTestConnection(
							url,
							this.inputValue(keySetting),
							model
						);
						testStatus.className = "qn-note qn-ai-test ok";
						testStatus.textContent = t("ai.testOk", { reply: reply.slice(0, 60) });
					} catch (e) {
						testStatus.className = "qn-note qn-ai-test fail";
						testStatus.textContent = String((e as Error).message);
					} finally {
						b.setDisabled(false);
						b.setButtonText(t("settings.aiTest"));
					}
				})();
			});
		});
		containerEl.appendChild(testStatus);

		this.addText(
			containerEl,
			t("settings.aiCount"),
			undefined,
			String(s.aiCount),
			(v) => this.save({ aiCount: Math.min(50, Math.max(1, parseInt(v, 10) || 5)) }),
			{ type: "number", min: "1" }
		);

		new Setting(containerEl)
			.setName(t("settings.aiExplain"))
			.addToggle((toggle) =>
				toggle.setValue(s.aiExplanation).onChange((v) => {
					this.save({ aiExplanation: v }, true);
				})
			);
	}

	private inputValue(setting: Setting): string {
		const input = setting.settingEl.querySelector("input");
		return input ? input.value.trim() : "";
	}

	private setInputValue(setting: Setting, value: string): void {
		const input = setting.settingEl.querySelector("input");
		if (input) input.value = value;
	}

	// ---------- 自定义生成指令 ----------

	private renderPrompts(containerEl: HTMLElement): void {
		const s = this.plugin.store.settings;
		new Setting(containerEl)
			.setName(t("settings.prompts"))
			.setDesc(t("settings.promptsHelp"))
			.setHeading();

		const prompts: CustomPrompt[] = s.customPrompts.map((p) => ({ ...p }));
		let activePromptId = s.activePromptId;

		const box = el("div", "qn-settings-block");
		containerEl.appendChild(box);

		const renderList = (): void => {
			clear(box);

			// 当前使用的指令
			const activeSetting = new Setting(box).setName(t("settings.promptActive"));
			activeSetting.addDropdown((drop) => {
				drop.addOption("", t("settings.promptDefault"));
				for (const p of prompts) drop.addOption(p.id, p.name);
				drop.setValue(activePromptId);
				drop.onChange((v) => {
					activePromptId = v;
					this.save({ activePromptId }, true);
				});
			});

			// 指令列表
			if (prompts.length === 0) {
				box.appendChild(el("div", "qn-note", t("settings.promptEmpty")));
			} else {
				const list = el("div", "qn-settings-list");
				for (const p of prompts) {
					const row = el("div", "qn-item");
					const headRow = el("div", "qn-flex-between");
					headRow.appendChild(el("div", "qn-paper-name", p.name));
					headRow.appendChild(
						btn("qn-btn-danger qn-btn-sm", t("settings.promptDelete"), () => {
							const idx = prompts.indexOf(p);
							if (idx >= 0) prompts.splice(idx, 1);
							if (activePromptId === p.id) activePromptId = "";
							this.save({ customPrompts: prompts, activePromptId }, true);
							renderList();
						})
					);
					row.appendChild(headRow);
					row.appendChild(el("div", "qn-gen-answer", p.content.slice(0, 120)));
					list.appendChild(row);
				}
				box.appendChild(list);
			}

			// 新增指令
			const addBox = el("div", "qn-settings-add");
			const nameInput = el("input", "qn-input");
			nameInput.type = "text";
			nameInput.placeholder = t("settings.promptName");
			const contentInput = el("textarea", "qn-textarea");
			contentInput.placeholder = t("settings.promptContent");
			addBox.appendChild(el("label", "", t("settings.promptName")));
			addBox.appendChild(nameInput);
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
					this.save({ customPrompts: prompts, activePromptId }, true);
					renderList();
				})
			);
			box.appendChild(addBox);
		};
		renderList();
	}

	// ---------- 数据备份 ----------

	private renderBackup(containerEl: HTMLElement): void {
		new Setting(containerEl)
			.setName(t("settings.backup"))
			.setDesc(t("settings.backupHint"))
			.setHeading();

		const info = el(
			"div",
			"qn-note",
			t("settings.backupDir", { dir: this.plugin.store.backupFolder() })
		);
		containerEl.appendChild(info);

		new Setting(containerEl).addButton((b) =>
			b
				.setButtonText(t("settings.backupNow"))
				.setCta()
				.onClick(() => {
					void (async () => {
						try {
							const path = await this.plugin.store.createBackup();
							new Notice(t("settings.backupDone", { path }));
							await renderBackups();
						} catch (e) {
							new Notice(t("settings.restoreFail", { msg: (e as Error).message }));
						}
					})();
				})
		);

		const listLabel = el("div", "qn-subtitle", t("settings.backupList"));
		containerEl.appendChild(listLabel);
		const listWrap = el("div", "qn-settings-list");
		containerEl.appendChild(listWrap);

		const renderBackups = async (): Promise<void> => {
			clear(listWrap);
			const backups = await this.plugin.store.listBackups();
			if (backups.length === 0) {
				listWrap.appendChild(el("div", "qn-note", t("settings.noBackups")));
				return;
			}
			for (const b of backups) {
				const row = el("div", "qn-item");
				const headRow = el("div", "qn-flex-between");
				headRow.appendChild(el("div", "qn-paper-name", b.name));
				const actions = el("div", "qn-flex");
				actions.appendChild(
					btn("qn-btn-sm", t("settings.restore"), () => {
						confirmDialog(this.app, t("settings.restoreConfirm"), () => {
							void (async () => {
								try {
									await this.plugin.store.restoreBackup(b.path);
									new Notice(t("settings.restored", { name: b.name }));
									this.plugin.refresh();
								} catch (e) {
									new Notice(
										t("settings.restoreFail", { msg: (e as Error).message })
									);
								}
							})();
						});
					})
				);
				actions.appendChild(
					btn("qn-btn-sm qn-btn-danger", t("settings.deleteBackup"), () => {
						confirmDialog(this.app, t("settings.deleteBackupConfirm"), () => {
							void (async () => {
								try {
									await this.plugin.store.deleteBackup(b.path);
									new Notice(t("settings.backupDeleted"));
									await renderBackups();
								} catch (e) {
									new Notice(
										t("settings.restoreFail", { msg: (e as Error).message })
									);
								}
							})();
						});
					})
				);
				headRow.appendChild(actions);
				row.appendChild(headRow);
				row.appendChild(
					el("div", "qn-item-meta", new Date(b.date).toLocaleString())
				);
				listWrap.appendChild(row);
			}
		};
		void renderBackups();
	}

	// ---------- 危险区 ----------

	private renderDanger(containerEl: HTMLElement): void {
		new Setting(containerEl).setName(t("settings.data")).setHeading();
		const row = el("div", "qn-btn-row qn-settings-block");
		row.appendChild(
			btn("qn-btn-danger qn-btn-sm", t("settings.clearExams"), () => {
				confirmDialog(this.app, t("settings.clearExamsConfirm"), () => {
					void (async () => {
						for (const r of [...this.plugin.store.data.examRecords]) {
							await this.plugin.store.removeExamRecord(r.id);
						}
						this.plugin.store.data.paperBest = {};
						await this.plugin.store.save();
						new Notice(t("settings.examsCleared"));
						this.plugin.refresh();
					})();
				});
			})
		);
		row.appendChild(
			btn("qn-btn-danger qn-btn-sm", t("settings.clearProgress"), () => {
				confirmDialog(this.app, t("settings.clearProgressConfirm"), () => {
					this.plugin.store.data.reviewIds = [];
					this.plugin.store.data.weakIds = [];
					this.plugin.store.data.sm = {};
					void this.plugin.store.save().then(() => {
						new Notice(t("settings.progressCleared"));
						this.plugin.refresh();
					});
				});
			})
		);
		containerEl.appendChild(row);
	}
}
