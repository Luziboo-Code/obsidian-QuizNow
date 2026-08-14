import type { SMCard } from "./types";

export const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 经典 SM-2 间隔复习算法。
 * @param card 现有卡片（无则新建）
 * @param grade 记忆质量 0-5（0=完全忘记，3=勉强想起，4=答对但费力，5=轻松答对）
 * @param initialEF 初始难度系数
 * @param minInterval 最小间隔天数
 */
export function sm2Update(
	card: SMCard | undefined,
	grade: number,
	initialEF = 2.5,
	minInterval = 1
): SMCard {
	const now = Date.now();
	const base: SMCard = card ?? {
		ef: initialEF,
		interval: 0,
		reps: 0,
		due: now,
	};
	let { ef, interval, reps } = base;

	if (grade >= 3) {
		// 答对：按 SM-2 节奏推进
		if (reps === 0) {
			interval = 1;
		} else if (reps === 1) {
			interval = 6;
		} else {
			interval = Math.max(1, Math.round(interval * ef));
		}
		reps += 1;
	} else {
		// 答错：重置连续答对次数，尽快再次出现
		reps = 0;
		interval = Math.max(minInterval, 0);
	}

	// 更新难度系数：答得好 EF 增大，答得差 EF 减小
	ef = Math.max(
		1.3,
		ef + (0.1 - (5 - grade) * (0.08 + (5 - grade) * 0.02))
	);

	return {
		ef,
		interval,
		reps,
		due: now + Math.max(0, interval) * DAY_MS,
	};
}

/** 是否到期（今天或更早应复习） */
export function isDue(card: SMCard | undefined): boolean {
	if (!card) return true;
	return card.due <= Date.now();
}
