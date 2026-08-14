import { ItemView, WorkspaceLeaf, setIcon } from "obsidian";
import type { QuizNowApi, TabName } from "../plugin-api";
import { renderHome } from "./home";
import { renderExam } from "./exam";
import { renderReview } from "./review";
import { renderWeak } from "./weak";
import { renderSettings } from "./settings";
import { el, clear } from "../ui";
import { t } from "../i18n";

export const VIEW_TYPE = "quiznow-view";

const TABS: { id: TabName; icon: string; labelKey: string }[] = [
	{ id: "home", icon: "home", labelKey: "nav.home" },
	{ id: "exam", icon: "list-checks", labelKey: "nav.exam" },
	{ id: "review", icon: "refresh-cw", labelKey: "nav.review" },
	{ id: "weak", icon: "alert-triangle", labelKey: "nav.weak" },
	{ id: "settings", icon: "settings", labelKey: "nav.settings" },
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
		return "QuizNow";
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
	}

	/** 重新渲染当前标签（数据变化后调用） */
	render(): void {
		if (!this.bodyEl) return;
		clear(this.bodyEl);
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
			case "settings":
				renderSettings(this.bodyEl, this.plugin);
				break;
		}
	}
}
