/** YYYY-MM-DD */
export function formatDate(d: Date): string {
	const y = d.getFullYear();
	const m = String(d.getMonth() + 1).padStart(2, "0");
	const day = String(d.getDate()).padStart(2, "0");
	return `${y}-${m}-${day}`;
}

function addDays(base: Date, n: number): Date {
	const d = new Date(base);
	d.setDate(d.getDate() + n);
	return d;
}

function addMonths(base: Date, n: number): Date {
	const d = new Date(base);
	d.setMonth(d.getMonth() + n);
	return d;
}

/**
 * 把文本中常见的相对日期表达替换为绝对日期。
 * 不试图处理所有自然语言——只覆盖明显模式，未匹配的原样保留。
 * 模型本身在写入前应该尽量给绝对日期；这层是兜底。
 */
export function normalizeRelativeDates(text: string, now: Date = new Date()): string {
	if (!text) return text;

	const replacements: Array<[RegExp, (match: string, group?: string) => string]> = [
		[/今天/g, () => formatDate(now)],
		[/明天/g, () => formatDate(addDays(now, 1))],
		[/后天/g, () => formatDate(addDays(now, 2))],
		[/大后天/g, () => formatDate(addDays(now, 3))],
		[/昨天/g, () => formatDate(addDays(now, -1))],
		[/前天/g, () => formatDate(addDays(now, -2))],
		[/(\d+)\s*天后/g, (_match, n) => formatDate(addDays(now, Number(n)))],
		[/(\d+)\s*天前/g, (_match, n) => formatDate(addDays(now, -Number(n)))],
		[/下周/g, () => formatDate(addDays(now, 7))],
		[/下个?月/g, () => formatDate(addMonths(now, 1))],
		[/今年/g, () => String(now.getFullYear())],
		[/明年/g, () => String(now.getFullYear() + 1)],
	];

	let result = text;
	for (const [re, fn] of replacements) {
		result = result.replace(re, (match, ...args) => {
			const group = args[0] as string | undefined;
			return fn(match, group);
		});
	}
	return result;
}
