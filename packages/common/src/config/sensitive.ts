const SENSITIVE_KEYS = new Set([
	"apiKey",
	"appSecret",
	"secret",
	"clientSecret",
	"accessToken",
	"authToken",
	"encodingAESKey",
	"encryptKey",
	"arkApiKey",
]);
const UNCHANGED_PLACEHOLDER = "__UNCHANGED__";

export function maskSensitiveFields(obj: Record<string, any>): Record<string, any> {
	const result: Record<string, any> = {};
	for (const [key, value] of Object.entries(obj)) {
		if (value === undefined) continue;
		if (SENSITIVE_KEYS.has(key) && typeof value === "string" && value.length > 0) {
			const visible = Math.min(4, Math.floor(value.length / 4));
			result[key] = `${"*".repeat(value.length - visible)}${value.slice(-visible)}`;
		} else if (value !== null && typeof value === "object" && !Array.isArray(value)) {
			result[key] = maskSensitiveFields(value);
		} else {
			result[key] = value;
		}
	}
	return result;
}

export function stripUnchangedPlaceholders(
	partial: Record<string, any>,
	current: Record<string, any>,
): Record<string, any> {
	const result: Record<string, any> = {};
	for (const [key, value] of Object.entries(partial)) {
		if (value === UNCHANGED_PLACEHOLDER) {
			continue;
		}
		if (value !== null && typeof value === "object" && !Array.isArray(value)) {
			const nested = stripUnchangedPlaceholders(value, current[key] ?? {});
			if (Object.keys(nested).length > 0) {
				result[key] = nested;
			}
		} else {
			result[key] = value;
		}
	}
	return result;
}
