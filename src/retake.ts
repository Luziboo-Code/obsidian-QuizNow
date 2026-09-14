import { Notice } from "obsidian";
import type { QuizNowApi } from "./plugin-api";
import type { ExamRecord, ExamSession } from "./types";
import { newId, shuffleOptions } from "./question";
import { t } from "./i18n";

/**
 * 由历史试卷生成「重考」会话：
 * 题目与顺序与原卷完全一致，选择题选项顺序重新打乱（避免背答案）。
 * 试卷名沿用原名，因此成绩会累加到同一份试卷的最高分里。
 */
export function buildRetakeSession(
	plugin: QuizNowApi,
	record: ExamRecord
): ExamSession | null {
	const snapshot = record.snapshot;
	if (!snapshot || snapshot.length === 0) {
		new Notice(t("exam.retakeNoSnapshot"));
		return null;
	}
	const questions = snapshot.map((s) => shuffleOptions(s.question));
	return {
		id: newId(),
		name: record.name,
		questions,
		index: 0,
		answers: {},
		origin: "paper",
		createdAt: Date.now(),
	};
}

/** 开始重考（生成会话并切换到考试标签）；无可重考内容时返回 false */
export function startRetake(plugin: QuizNowApi, record: ExamRecord): boolean {
	const session = buildRetakeSession(plugin, record);
	if (!session) return false;
	plugin.startSession(session);
	return true;
}

/** 该记录是否包含可重考的题目快照 */
export function canRetake(record: ExamRecord): boolean {
	return Array.isArray(record.snapshot) && record.snapshot.length > 0;
}
