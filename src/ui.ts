import { Modal, setIcon, type App } from "obsidian";
import type { QuestionType } from "./types";
import { t } from "./i18n";

/** 创建元素（使用 Obsidian 的 createEl 助手） */
export function el<K extends keyof HTMLElementTagNameMap>(
	tag: K,
	cls = "",
	text = ""
): HTMLElementTagNameMap[K] {
	return document.body.createEl(tag, {
		cls: cls || undefined,
		text: text || undefined,
	});
}

/** 确认弹窗（替代 window.confirm，样式与 Obsidian 一致） */
export function confirmDialog(
	app: App,
	message: string,
	onConfirm: () => void,
	title?: string
): void {
	const modal = new Modal(app);
	modal.titleEl.setText(title ?? t("modal.confirmTitle"));
	modal.contentEl.createEl("p", { text: message });
	const row = modal.contentEl.createDiv({ cls: "qn-btn-row" });
	const ok = row.createEl("button", {
		text: t("modal.confirmOk"),
		cls: "mod-cta",
	});
	ok.addEventListener("click", () => {
		modal.close();
		onConfirm();
	});
	const cancel = row.createEl("button", {
		text: t("gen.cancel"),
		cls: "mod-cta",
	});
	cancel.addEventListener("click", () => modal.close());
	modal.open();
}

/** 清空容器 */
export function clear(node: HTMLElement): void {
	node.empty();
}

/** 文本按钮 */
export function btn(
	cls: string,
	label: string,
	onClick: () => void
): HTMLButtonElement {
	const b = el("button", `qn-btn ${cls}`, label);
	b.addEventListener("click", onClick);
	return b;
}

/** 图标按钮 */
export function iconBtn(
	icon: string,
	label: string,
	onClick: () => void,
	cls = ""
): HTMLButtonElement {
	const b = el("button", `qn-btn qn-icon-btn ${cls}`, "");
	setIcon(b, icon);
	b.setAttribute("aria-label", label);
	b.addEventListener("click", onClick);
	return b;
}

/** 题型徽章 */
export function badge(type: QuestionType): HTMLSpanElement {
	return el("span", `qn-badge qn-badge-${type}`, t(`type.${type}`));
}

/** 空状态 */
export function emptyState(text: string, icon = "📝"): HTMLDivElement {
	const wrap = el("div", "qn-empty");
	const ic = el("div", "qn-empty-icon", icon);
	wrap.appendChild(ic);
	wrap.appendChild(el("div", "", text));
	return wrap;
}

/** 加载中 */
export function loading(text?: string): HTMLDivElement {
	const wrap = el("div", "qn-loading");
	wrap.appendChild(el("div", "qn-spinner"));
	wrap.appendChild(el("div", "", text ?? t("ui.loading")));
	return wrap;
}

/** 带图标和描述的字段容器 */
export function field(
	label: string,
	control: HTMLElement,
	help?: string
): HTMLDivElement {
	const f = el("div", "qn-field");
	f.appendChild(el("label", "", label));
	f.appendChild(control);
	if (help) f.appendChild(el("div", "qn-note", help));
	return f;
}

/** 进度条 */
export function progressBar(percent: number): HTMLDivElement {
	const wrap = el("div", "qn-progress");
	const fill = el("div", "qn-progress-fill");
	fill.style.width = `${Math.min(100, Math.max(0, percent))}%`;
	wrap.appendChild(fill);
	return wrap;
}

/** 复制文本到剪贴板（Obsidian 环境） */
export function copyText(text: string): void {
	navigator.clipboard?.writeText(text).catch(() => {
		/* 忽略 */
	});
}
