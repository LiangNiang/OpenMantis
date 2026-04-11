export function deepMerge<T extends Record<string, any>>(base: T, overlay: Record<string, any>): T {
	const result = { ...base };
	for (const key of Object.keys(overlay)) {
		const baseVal = (base as any)[key];
		const overVal = overlay[key];
		if (overVal === null) {
			delete (result as any)[key];
		} else if (
			typeof overVal === "object" &&
			!Array.isArray(overVal) &&
			baseVal !== null &&
			typeof baseVal === "object" &&
			!Array.isArray(baseVal)
		) {
			(result as any)[key] = deepMerge(baseVal, overVal);
		} else {
			(result as any)[key] = overVal;
		}
	}
	return result;
}
