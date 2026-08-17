import { Notice, setIcon } from "obsidian";
import type { QuizNowApi } from "../plugin-api";
import type { ExamRecord, ExamSession, Question, QuestionType } from "../types";
import { checkAnswer, answerText, userAnswerText, newId, displayContent, shuffleOptions } from "../question";
import { el, clear, btn, badge, field, progressBar, emptyState } from "../ui";
import { t } from "../i18n";

const TYPE_KEYS: QuestionType[] = ["single", "multiple", "fill", "judge"];

/** 当前考试页注册的快捷键监听（每次渲染替换，视图切换时移除） */
let examKeyHandler: ((e: KeyboardEvent) => void) | null = null;

/** 移除考试快捷键监听（由视图层在每次渲染前调用） */
export function cleanupExamKeys(): void {
	if (examKeyHandler) {
		document.removeEventListener("keydown", examKeyHandler);
		examKeyHandler = null;
	}
}

export function renderExam(container: HTMLElement, plugin: QuizNowApi): void {
	clear(container);
	cleanupExamKeys();
	const session = plugin.currentSession;
	if (session && session.index < session.questions.length) {
		renderAnswering(container, plugin, session);
	} else if (plugin.showSummary && plugin.lastExamSession && !session) {
		renderSummary(container, plugin, null, plugin.lastExamRecord);
	} else {
		renderConfig(container, plugin);
	}
}

/* ================= 配置 ================= */

function renderConfig(container: HTMLElement, plugin: QuizNowApi): void {
	const title = el("div", "qn-title");
	setIcon(title, "list-checks");
	title.appendChild(el("span", "", t("exam.title")));
	container.appendChild(title);

	const card = el("div", "qn-card qn-fade");
	card.appendChild(el("div", "qn-subtitle", t("exam.subtitle")));

	// 出题范围
	const originSel = el("select", "qn-select") as HTMLSelectElement;
	const optBank = document.createElement("option");
	optBank.value = "bank";
	optBank.textContent = t("exam.origin.bank");
	const optWeak = document.createElement("option");
	optWeak.value = "weak";
	optWeak.textContent = t("exam.origin.weak");
	originSel.appendChild(optBank);
	originSel.appendChild(optWeak);
	card.appendChild(field(t("exam.origin"), originSel));

	// 数量
	const countInput = el("input", "qn-input") as HTMLInputElement;
	countInput.type = "number";
	countInput.min = "1";
	countInput.max = "100";
	countInput.value = String(plugin.store.settings.defaultCount || 10);
	card.appendChild(field(t("exam.count"), countInput));

	// 试卷名
	const nameInput = el("input", "qn-input") as HTMLInputElement;
	nameInput.type = "text";
	nameInput.placeholder = t("exam.namePlaceholder");
	card.appendChild(field(t("exam.name"), nameInput));

	// 题型
	const chipsWrap = el("div", "qn-chips");
	const chosen: Record<QuestionType, boolean> = {
		...plugin.store.settings.includeTypes,
	};
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
	card.appendChild(field(t("exam.types"), chipsWrap));

	const startBtn = btn("qn-btn-primary qn-btn-block", t("exam.generate"), () => {
		const origin = (originSel as HTMLSelectElement).value as "bank" | "weak";
		const count = Math.max(1, parseInt(countInput.value, 10) || 10);
		const activeTypes = TYPE_KEYS.filter((type) => chosen[type]);
		if (activeTypes.length === 0) {
			new Notice(t("exam.noType"));
			return;
		}
		const pool =
			origin === "weak"
				? plugin.store.data.weakIds
						.map((id) => plugin.store.data.questions.find((q) => q.id === id))
						.filter(
							(q): q is Question => !!q && activeTypes.includes(q.type)
						)
				: plugin.store.data.questions.filter((q) =>
						activeTypes.includes(q.type)
				  );
		if (pool.length === 0) {
			new Notice(
				origin === "weak" ? t("exam.noWeakMatch") : t("exam.noBankMatch")
			);
			return;
		}
		const picked = shuffle(pool)
			.slice(0, Math.min(count, pool.length))
			.map((q) => (origin === "bank" ? shuffleOptions(q) : q));
		const name =
			nameInput.value.trim() ||
			`${origin === "weak" ? t("exam.name.weak") : t("exam.name.bank")} · ${nowStamp()}`;
		plugin.startSession({
			id: newId(),
			name,
			questions: picked,
			index: 0,
			answers: {},
			origin,
			createdAt: Date.now(),
		});
	});
	card.appendChild(startBtn);

	card.appendChild(el("div", "qn-divider"));

	// 从当前笔记生成
	const noteBtn = btn("qn-btn qn-btn-block", t("exam.fromNote"), () => {
		void plugin.generateFromCurrentNote();
	});
	card.appendChild(noteBtn);
	card.appendChild(el("div", "qn-note", t("exam.fromNoteHint")));

	container.appendChild(card);
}

/* ================= 答题 ================= */

interface AnswerState {
	userAnswer: string[];
	submitted: boolean;
	correct: boolean;
}

function renderAnswering(
	container: HTMLElement,
	plugin: QuizNowApi,
	session: ExamSession
): void {
	const q = session.questions[session.index];
	const state: AnswerState = { userAnswer: [], submitted: false, correct: false };

	// 顶栏
	const top = el("div", "qn-card");
	const topRow = el("div", "");
	topRow.style.display = "flex";
	topRow.style.alignItems = "center";
	topRow.style.gap = "8px";
	topRow.style.justifyContent = "space-between";
	const nameEl = el("div", "qn-paper-name", session.name);
	topRow.appendChild(nameEl);
	const exitBtn = el("button", "qn-btn qn-btn-sm", t("exam.end"));
	exitBtn.addEventListener("click", () => {
		void finish(container, plugin, session);
	});
	topRow.appendChild(exitBtn);
	top.appendChild(topRow);
	top.appendChild(
		el(
			"div",
			"qn-note",
			t("exam.progress", {
				current: session.index + 1,
				total: session.questions.length,
			})
		)
	);
	top.appendChild(
		progressBar((session.index / Math.max(1, session.questions.length)) * 100)
	);
	container.appendChild(top);

	// 题目卡片
	const card = el("div", "qn-question-card qn-fade");
	const head = el("div", "qn-question-head");
	head.appendChild(badge(q.type));
	head.appendChild(
		el("span", "qn-note", t("exam.qNo", { n: session.index + 1 }))
	);
	// 题目来源（灰色小字）
	if (q.source) {
		const src = el("span", "qn-source", q.source);
		src.setAttribute("title", q.source);
		head.appendChild(src);
	}
	card.appendChild(head);
	card.appendChild(el("div", "qn-question-content", displayContent(q.content)));

	// 作答控件
	const control = el("div", "");
	card.appendChild(control);

	// 提交（单选/判断点击即自动提交；多选需选完点提交；填空可回车或点提交）
	const actionRow = el("div", "qn-btn-row");
	card.appendChild(actionRow);
	const doSubmit = () => {
		if (state.submitted) return;
		validateAndSubmit(plugin, session, q, state, (ok) => {
			state.submitted = true;
			state.correct = ok;
			showResult(card, q, state);
			const isLast = session.index >= session.questions.length - 1;
			actionRow.empty();
			actionRow.appendChild(
				btn("qn-btn-primary", isLast ? t("exam.viewScore") : t("exam.next"), () => {
					if (isLast) {
						// 最后一题：记录成绩并进入分数页
						void finish(container, plugin, session);
					} else {
						session.index += 1;
						plugin.refresh();
					}
				})
			);
			// 快捷键提示
			actionRow.appendChild(
				el("span", "qn-key-hint", t("exam.keyHint"))
			);
		});
	};
	buildAnswerControl(control, q, state, doSubmit);

	if (q.type === "multiple" || q.type === "fill") {
		actionRow.appendChild(btn("qn-btn-primary", t("exam.submit"), doSubmit));
	} else {
		actionRow.appendChild(el("div", "qn-note", t("exam.autoSubmitHint")));
	}

	container.appendChild(card);

	// 快捷键：提交后按 空格 / 回车 进入下一题（输入框内不拦截，避免影响打字）
	const keyHandler = (e: KeyboardEvent) => {
		if (e.key !== " " && e.key !== "Enter" && e.key !== "Spacebar") return;
		if (!state.submitted) return;
		const target = e.target as HTMLElement | null;
		const inField =
			!!target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA");
		if (inField && e.key === " ") return; // 输入框内空格用于输入
		e.preventDefault();
		const isLast = session.index >= session.questions.length - 1;
		if (isLast) {
			void finish(container, plugin, session);
		} else {
			session.index += 1;
			plugin.refresh();
		}
	};
	cleanupExamKeys();
	examKeyHandler = keyHandler;
	document.addEventListener("keydown", keyHandler);
}

function buildAnswerControl(
	parent: HTMLElement,
	q: Question,
	state: AnswerState,
	doSubmit: () => void
): void {
	switch (q.type) {
		case "single":
		case "multiple": {
			const wrap = el("div", "");
			(q.options || []).forEach((opt, i) => {
				const letter = String.fromCharCode(65 + i);
				const row = el("div", "qn-option");
				row.appendChild(el("span", "qn-opt-letter", `${letter}.`));
				row.appendChild(el("span", "", opt));
				row.addEventListener("click", () => {
					if (state.submitted) return;
					if (q.type === "single") {
						state.userAnswer = [letter];
						wrap.querySelectorAll(".qn-option").forEach((n) =>
							n.classList.remove("selected")
						);
						row.classList.add("selected");
						doSubmit(); // 单选：点击即自动提交
					} else {
						const idx = state.userAnswer.indexOf(letter);
						if (idx >= 0) {
							state.userAnswer.splice(idx, 1);
							row.classList.remove("selected");
						} else {
							state.userAnswer.push(letter);
							state.userAnswer.sort();
							row.classList.add("selected");
						}
					}
				});
				wrap.appendChild(row);
			});
			parent.appendChild(wrap);
			break;
		}
		case "fill": {
			const input = el("input", "qn-input") as HTMLInputElement;
			input.type = "text";
			input.placeholder = t("exam.fillPlaceholder");
			input.addEventListener("input", () => {
				state.userAnswer = [input.value];
			});
			input.addEventListener("keydown", (e) => {
				if (e.key === "Enter") doSubmit();
			});
			parent.appendChild(input);
			break;
		}
		case "judge": {
			const wrap = el("div", "qn-judge-row");
			const make = (label: string, val: "T" | "F", cls: string) => {
				const b = el("button", `qn-judge-btn ${cls}`, label);
				b.addEventListener("click", () => {
					if (state.submitted) return;
					state.userAnswer = [val];
					wrap.querySelectorAll(".qn-judge-btn").forEach((n) =>
						n.classList.remove("selected-true", "selected-false")
					);
					b.classList.add(cls === "selected-true" ? "selected-true" : "selected-false");
					doSubmit(); // 判断：点击即自动提交
				});
				return b;
			};
			wrap.appendChild(make(t("exam.true"), "T", "selected-true"));
			wrap.appendChild(make(t("exam.false"), "F", "selected-false"));
			parent.appendChild(wrap);
			break;
		}
	}
}

function validateAndSubmit(
	plugin: QuizNowApi,
	session: ExamSession,
	q: Question,
	state: AnswerState,
	done: (ok: boolean) => void
): void {
	if (state.userAnswer.length === 0) {
		new Notice(t("exam.answerFirst"));
		return;
	}
	if (q.type === "fill" && !(state.userAnswer[0] || "").trim()) {
		new Notice(t("exam.fillAnswer"));
		return;
	}
	const ok = checkAnswer(q, state.userAnswer);
	session.answers[q.id] = {
		questionId: q.id,
		type: q.type,
		userAnswer: state.userAnswer,
		correct: ok,
	};
	done(ok);
}

function showResult(card: HTMLElement, q: Question, state: AnswerState): void {
	const box = el(
		"div",
		`qn-result ${state.correct ? "ok" : "bad"} qn-fade`
	);
	const title = el(
		"div",
		"qn-result-title",
		state.correct ? t("exam.correct") : t("exam.wrong")
	);
	box.appendChild(title);
	box.appendChild(
		el(
			"div",
			"qn-note",
			t("exam.yourAnswer", {
				user: userAnswerText(q, state.userAnswer),
				correct: answerText(q),
			})
		)
	);
	if (q.explanation) {
		box.appendChild(el("div", "qn-explain", q.explanation));
	}
	card.appendChild(box);
}

/* ================= 结果页 ================= */

async function finish(
	container: HTMLElement,
	plugin: QuizNowApi,
	session: ExamSession
): Promise<void> {
	const weakMode = session.origin === "weak";
	const record = await plugin.store.recordExam(session, session.name, { weakMode });
	plugin.lastExamRecord = record;
	plugin.lastExamSession = session;
	plugin.currentSession = null;
	plugin.showSummary = true;
	renderSummary(container, plugin, null, record);
}

function renderSummary(
	container: HTMLElement,
	plugin: QuizNowApi,
	_session: ExamSession | null,
	record: ExamRecord | null
): void {
	clear(container);
	const rec = record ?? plugin.lastExamRecord;
	const session = _session ?? plugin.lastExamSession;
	if (!rec || !session) {
		container.appendChild(emptyState(t("exam.emptyRecord"), "📭"));
		return;
	}

	const card = el("div", "qn-card qn-fade");
	const title = el("div", "qn-title");
	setIcon(title, "trophy");
	title.appendChild(el("span", "", t("exam.done")));
	card.appendChild(title);

	const scoreWrap = el("div", "");
	scoreWrap.style.textAlign = "center";
	scoreWrap.style.padding = "16px 0";
	const scoreNum = el("div", "qn-paper-score", String(rec.score));
	scoreNum.style.fontSize = "44px";
	scoreNum.appendChild(el("small", "", t("common.points")));
	scoreWrap.appendChild(scoreNum);
	scoreWrap.appendChild(
		el(
			"div",
			"qn-note",
			t("exam.scoreMeta", {
				correct: rec.correct,
				total: rec.total,
				name: rec.name,
			})
		)
	);
	card.appendChild(scoreWrap);

	// 错题回顾
	const wrong = session.questions.filter((q) => rec.wrongIds.includes(q.id));
	if (wrong.length > 0) {
		card.appendChild(el("div", "qn-divider"));
		card.appendChild(
			el("div", "qn-subtitle", t("exam.wrongSaved", { n: wrong.length }))
		);
		const list = el("div", "qn-scroll-list");
		for (const q of wrong) {
			const item = el("div", "qn-item");
			const head = el("div", "qn-item-head");
			head.appendChild(badge(q.type));
			item.appendChild(head);
			item.appendChild(el("div", "qn-item-content", displayContent(q.content)));
			const ans = el("div", "qn-gen-answer");
			ans.appendChild(el("span", "", t("exam.answerLabel")));
			ans.appendChild(el("b", "", answerText(q)));
			item.appendChild(ans);
			list.appendChild(item);
		}
		card.appendChild(list);
	} else {
		card.appendChild(el("div", "qn-note", t("exam.allCorrect")));
	}

	const row = el("div", "qn-btn-row");
	row.appendChild(
		btn("qn-btn-primary", t("exam.again"), () => {
			plugin.currentSession = null;
			plugin.showSummary = false;
			plugin.refresh();
		})
	);
	row.appendChild(
		btn("", t("exam.backConfig"), () => {
			plugin.currentSession = null;
			plugin.showSummary = false;
			plugin.refresh();
		})
	);
	row.appendChild(
		btn("", t("exam.backHome"), () => {
			plugin.currentSession = null;
			plugin.showSummary = false;
			plugin.openTab("home");
		})
	);
	if (wrong.length > 0) {
		row.appendChild(
			btn("", t("exam.reviewWrong"), () => plugin.openTab("review"))
		);
	}
	card.appendChild(row);
	container.appendChild(card);
}

/* ================= 工具 ================= */

export function shuffle<T>(arr: T[]): T[] {
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
