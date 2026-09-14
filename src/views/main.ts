import { ItemView, WorkspaceLeaf, setIcon } from "obsidian";
import type { QuizNowApi, TabName } from "../plugin-api";
import { renderHome } from "./home";
import { renderExam, cleanupExamKeys } from "./exam";
import { renderReview, stopFlashSizing } from "./review";
import { renderWeak } from "./weak";
import { el, clear } from "../ui";
import { t } from "../i18n";

export const VIEW_TYPE = "QuizNow-view";
/** 历史版本的视图类型（旧标签页会被自动清理） */
export const LEGACY_VIEW_TYPES = ["quiznow-view"];

const TABS: { id: TabName; icon: string; labelKey: string }[] = [
	{ id: "home", icon: "home", labelKey: "nav.home" },
	{ id: "exam", icon: "list-checks", labelKey: "nav.exam" },
	{ id: "review", icon: "refresh-cw", labelKey: "nav.review" },
	{ id: "weak", icon: "alert-triangle", labelKey: "nav.weak" },
];

export class QuizNowView extends ItemView {
	private plugin: QuizNowApi;
	private tab: TabName = "home";
	private navEl!: HTMLElement;
	private bodyEl!: HTMLElement;

	constructor(leaf: WorkspaceLeaf, plugin: QuizNowApi) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return VIEW_TYPE;
	}

	getDisplayText(): string {
		// 直接复用 manifest 中的插件名，避免硬编码
		return this.plugin.manifest.name;
	}

	getIcon(): string {
		return "graduation-cap";
	}

	async onOpen(): Promise<void> {
		this.containerEl.addClass("qn-view");
		this.contentEl.empty();
		this.navEl = el("div", "qn-nav");
		this.bodyEl = el("div", "qn-content");
		this.contentEl.appendChild(this.navEl);
		this.contentEl.appendChild(this.bodyEl);
		this.buildNav();
		this.render();
	}

	async onClose(): Promise<void> {
		// 释放视图持有的监听资源（考试快捷键 / 闪卡尺寸观察器），避免关闭后仍引用 DOM
		cleanupExamKeys();
		stopFlashSizing();
		this.contentEl.empty();
	}

	/** 切换标签（外部调用） */
	setTab(tab: TabName): void {
		this.tab = tab;
		if (this.navEl) {
			this.buildNav();
			this.render();
		}
	}

	private buildNav(): void {
		clear(this.navEl);
		for (const tab of TABS) {
			const b = el(
				"button",
				"qn-nav-item" + (tab.id === this.tab ? " active" : ""),
				""
			);
			const ic = el("span", "qn-nav-icon");
			setIcon(ic, tab.icon);
			b.appendChild(ic);
			b.appendChild(el("span", "", t(tab.labelKey)));
			b.addEventListener("click", () => {
				this.tab = tab.id;
				this.buildNav();
				this.render();
			});
			this.navEl.appendChild(b);
		}
		// 设置已移至 Obsidian 设置面板，这里只保留一个入口按钮
		const gear = el("button", "qn-nav-item qn-nav-gear", "");
		gear.setAttribute("aria-label", t("settings.open"));
		gear.setAttribute("title", t("settings.open"));
		const gearIcon = el("span", "qn-nav-icon");
		setIcon(gearIcon, "settings");
		gear.appendChild(gearIcon);
		gear.addEventListener("click", () => this.plugin.openSettings());
		this.navEl.appendChild(gear);
	}

	/** 重新渲染当前标签（数据变化后调用） */
	render(): void {
		if (!this.bodyEl) return;
		clear(this.bodyEl);
		// 每次渲染前清理上一轮注册的考试快捷键监听
		cleanupExamKeys();
		switch (this.tab) {
			case "home":
				renderHome(this.bodyEl, this.plugin);
				break;
			case "exam":
				renderExam(this.bodyEl, this.plugin);
				break;
			case "review":
				renderReview(this.bodyEl, this.plugin);
				break;
			case "weak":
				renderWeak(this.bodyEl, this.plugin);
				break;
		}
	}
}
