import { requestUrl } from "obsidian";
import type { Question, QuestionType } from "./types";
import { newId } from "./question";
import type { Lang } from "./types";
import { t, getLang } from "./i18n";

/** 系统内置的默认生成指令（按语言） */
export function defaultGeneratePrompt(lang: Lang): string {
	switch (lang) {
		case "en":
			return `You are a professional exam question generator. Generate ${"${count}"} exam questions strictly based on the note content provided by the user.
Allowed question types: ${"${types}"}.
Rules:
- Questions must be strictly based on the note; do not make things up;
- Single choice has 4 options; multiple choice has 4 options with at least 2 correct;
- True/False answer is ["T"] or ["F"];
- Fill-in-the-blank uses ____ in the stem and the answer is a list of acceptable answers;
- Each question includes a concise explanation (parse / source).
Output strictly as JSON:
{"questions":[{"type":"single|multiple|fill|judge","content":"stem","options":["A","B","C","D"],"answer":["A"]or["A","C"]or["answer"]or["T"],"explanation":"..."}]}`;
		case "ja":
			return `あなたはプロの試験問題作成者です。ユーザーが提供するノート内容に厳密に基づいて ${"${count}"} 問の試験問題を生成してください。
使用する問題形式：${"${types}"}。
ルール：
- 問題はノート内容に厳密に基づくこと。勝手に作り上げないこと；
- 単一選択は選択肢 4 つ、複数選択は選択肢 4 つで正解は 2 つ以上；
- 正誤問題の answer は ["T"] または ["F"]；
- 穴埋め問題は文面に ____ を使い、answer は受け入れ可能な答えのリスト；
- 各問題に簡潔な explanation（解説・出典）を付けること。
JSON で厳密に出力：
{"questions":[{"type":"single|multiple|fill|judge","content":"問題文","options":["A","B","C","D"],"answer":["A"]または["A","C"]または["答え"]または["T"],"explanation":"解説"}]}`;
		case "ko":
			return `당신은 전문 시험 출제자입니다. 사용자가 제공한 노트 내용에 엄격히 기반하여 ${"${count}"}개의 시험 문제를 생성하세요.
사용할 문제 유형: ${"${types}"}.
규칙:
- 문제는 노트 내용에 엄격히 기반해야 하며 지어내지 마세요;
- 단일 선택은 4개 보기, 다중 선택은 4개 보기 중 정답 2개 이상;
- 참/거짓 문제의 answer는 ["T"] 또는 ["F"];
- 빈칸 문제는 지문에 ____을 사용하고 answer는 허용 가능한 답 목록;
- 각 문제에 간결한 explanation(해설/출처)을 포함하세요.
JSON으로 엄격히 출력:
{"questions":[{"type":"single|multiple|fill|judge","content":"지문","options":["A","B","C","D"],"answer":["A"]또는["A","C"]또는["답"]또는["T"],"explanation":"해설"}]}`;
		default:
			return `你是专业的考试出题助手。请根据用户提供的笔记内容，生成 ${"${count}"} 道考试题目。
题型要求（仅使用这些题型）：${"${types}"}。
出题规则：
- 题目必须严格基于笔记内容，不能凭空编造；
- 单选题有 4 个选项，多选有 4 个选项且至少 2 个正确；
- 判断题 answer 为 ["T"] 或 ["F"]；
- 填空题在题干中用 ____ 表示空，answer 为可接受答案列表；
- 每题附带简洁的中文 explanation（解析/出处）。
请严格以 JSON 输出，格式为：
{"questions":[{"type":"single|multiple|fill|judge","content":"题干","options":["A选项","B选项","C选项","D选项"],"answer":["A"]或["A","C"]或["答案"]或["T"],"explanation":"解析"}]}`;
	}
}

export interface AiOptions {
	baseUrl: string;
	apiKey: string;
	model: string;
	noteContent: string;
	sourceName: string;
	count: number;
	includeTypes: QuestionType[];
	/** 自定义系统指令；缺省使用系统内置默认指令 */
	systemPrompt?: string;
}

function buildChatUrl(baseUrl: string): string {
	let url = baseUrl.trim().replace(/\/+$/, "");
	if (!/\/chat\/completions$/.test(url)) url += "/chat/completions";
	return url;
}

async function chatCompletion(
	baseUrl: string,
	apiKey: string,
	model: string,
	messages: { role: string; content: string }[],
	jsonMode: boolean
): Promise<string> {
	const body: Record<string, unknown> = {
		model,
		messages,
		temperature: 0.7,
	};
	if (jsonMode) body.response_format = { type: "json_object" };
	const res = await requestUrl({
		url: buildChatUrl(baseUrl),
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${apiKey}`,
		},
		body: JSON.stringify(body),
	});
	if (res.status < 200 || res.status >= 300) {
		const detail =
			(res.json && res.json.error && res.json.error.message) || res.text || "";
		throw new Error(t("ai.httpFail", { status: res.status, detail }));
	}
	const data = res.json;
	const content: string | undefined =
		data?.choices?.[0]?.message?.content;
	if (!content) throw new Error(t("ai.empty"));
	return content;
}

function parseJsonLoose(text: string): unknown {
	const t = text.trim();
	// 去掉可能的 ```json ... ``` 包裹
	const m = t.match(/```(?:json)?\s*([\s\S]*?)```/);
	const raw = m ? m[1] : t;
	const start = raw.indexOf("{");
	const end = raw.lastIndexOf("}");
	if (start === -1 || end === -1 || end <= start) {
		return JSON.parse(raw);
	}
	return JSON.parse(raw.slice(start, end + 1));
}

/** 使用 AI 根据笔记内容生成试题 */
export async function aiGenerateQuestions(
	opts: AiOptions
): Promise<Question[]> {
	const typeDesc =
		opts.includeTypes.length === 0
			? "single,multiple,fill,judge"
			: opts.includeTypes.join(",");
	const system = opts.systemPrompt
		? opts.systemPrompt
				.split("{count}").join(String(opts.count))
				.split("{types}").join(typeDesc)
		: defaultGeneratePrompt(getLang())
				.split("{count}").join(String(opts.count))
				.split("{types}").join(typeDesc);

	const messages = [
		{ role: "system" as const, content: system },
		{
			role: "user" as const,
			content: `笔记名称：${opts.sourceName}\n\n笔记内容：\n${opts.noteContent.slice(0, 12000)}`,
		},
	];

	let text: string;
	try {
		text = await chatCompletion(
			opts.baseUrl,
			opts.apiKey,
			opts.model,
			messages,
			true
		);
	} catch (e) {
		// 部分兼容端点不支持 response_format，重试一次
		const msg = String((e as Error).message);
		if (/response_format|json_object|400|422/i.test(msg)) {
			text = await chatCompletion(
				opts.baseUrl,
				opts.apiKey,
				opts.model,
				messages,
				false
			);
		} else {
			throw e;
		}
	}

	const parsed = parseJsonLoose(text) as {
		questions?: {
			type?: string;
			content?: string;
			options?: string[];
			answer?: string[];
			explanation?: string;
		}[];
	};
	const raw = Array.isArray(parsed?.questions) ? parsed.questions : [];
	const now = Date.now();
	const out: Question[] = [];
	for (const r of raw) {
		if (!r || typeof r !== "object") continue;
		const type: QuestionType | null =
			r.type === "single" ||
			r.type === "multiple" ||
			r.type === "fill" ||
			r.type === "judge"
				? r.type
				: null;
		const content = (r.content || "").trim();
		if (!type || !content) continue;
		let answer = (r.answer || []).map((s) => String(s).trim()).filter(Boolean);
		if (answer.length === 0) continue;
		if (type === "single" && answer.length > 1) answer = [answer[0]];
		const options =
			type === "single" || type === "multiple"
				? (r.options || []).slice(0, 8)
				: undefined;
		if ((type === "single" || type === "multiple") && (!options || options.length < 2)) continue;
		if (type === "judge") {
			const v = answer[0].toUpperCase();
			if (v === "T" || v === "对" || v === "正确" || v === "TRUE" || v === "√") answer = ["T"];
			else if (v === "F" || v === "错" || v === "错误" || v === "FALSE" || v === "×") answer = ["F"];
			else continue;
		}
		out.push({
			id: newId(),
			type,
			content,
			options,
			answer,
			explanation: r.explanation?.trim() || undefined,
			source: opts.sourceName,
			createdAt: now,
		});
	}
	if (out.length === 0) {
		throw new Error(t("ai.parseFail"));
	}
	return out;
}

/** 薄弱点讲解的系统提示词（按语言） */
function explainSystemPrompt(): string {
	switch (getLang()) {
		case "en":
			return `You are a patient, professional tutor. The user gives a concept (possibly an exam question) they failed to understand. Explain it in plain, easy English to aid memorization. Requirements:
- First state the core conclusion in one sentence;
- Then explain "why" in 2-4 bullet points;
- End with a memory tip or analogy;
- Keep it 100-250 words; do not include irrelevant content.`;
		case "ja":
			return `あなたは忍耐強く専門的な講師です。ユーザーが理解できていない概念（問題の場合もあります）を、分かりやすい日本語で説明して記憶を助けてください。要件：
- 最初に核心の結論を一文で述べる；
- 「なぜ」を 2〜4 点で解説する；
- 最後に記憶のコツまたは類比を示す；
- 全体を 100〜250 字に収め、無関係な内容は含めない。`;
		case "ko":
			return `당신은 인내심 있고 전문적인 선생님입니다. 사용자가 이해하지 못한 개념(문제일 수도 있음)을 쉬운 한국어로 설명해 기억을 돕세요. 요구사항:
- 먼저 핵심 결론을 한 문장으로 제시할 것;
- '왜'를 2~4가지로 설명할 것;
- 마지막에 기억 팁이나 비유를 제시할 것;
- 총 100~250자로 유지하고 무관한 내용은 넣지 말 것.`;
		default:
			return `你是耐心、专业的讲解老师。用户会给出一个没学明白的知识点（可能是题目），请你用通俗易懂的中文解释它，帮助记忆。要求：
- 先一句话给出核心结论；
- 再分 2-4 点解释"为什么"；
- 最后给出一个记忆技巧或类比；
- 总字数 100-250 字，不要罗列与知识点无关的内容。`;
	}
}

/** 使用 AI 为薄弱知识点生成通俗解释 */
export async function aiExplainQuestion(
	opts: {
		baseUrl: string;
		apiKey: string;
		model: string;
		question: Question;
		noteContext?: string;
	}
): Promise<string> {
	const { baseUrl, apiKey, model, question, noteContext } = opts;
	const system = explainSystemPrompt();

	const qText = [
		`题目类型：${question.type}`,
		`题干：${question.content}`,
		question.options ? `选项：${question.options.join(" | ")}` : "",
		`正确答案：${question.answer.join("、")}`,
		question.explanation ? `已有解析：${question.explanation}` : "",
	].filter(Boolean).join("\n");

	const messages = [
		{ role: "system" as const, content: system },
		{
			role: "user" as const,
			content: `知识点：\n${qText}${
				noteContext ? `\n\n相关笔记上下文：\n${noteContext.slice(0, 3000)}` : ""
			}`,
		},
	];

	const text = await chatCompletion(baseUrl, apiKey, model, messages, false);
	return text.trim();
}
