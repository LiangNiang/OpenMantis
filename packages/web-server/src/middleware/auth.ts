import { timingSafeEqual } from "node:crypto";
import type { Context, Next } from "hono";

function safeEqual(a: string, b: string): boolean {
	if (a.length !== b.length) return false;
	return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

export function authMiddleware(authToken?: string) {
	return async (c: Context, next: Next) => {
		if (!authToken) {
			return next();
		}

		// Support query token for backward compatibility (e.g. first-time setup URL)
		const queryToken = c.req.query("token");
		if (queryToken && safeEqual(queryToken, authToken)) {
			return next();
		}

		const authHeader = c.req.header("Authorization");
		if (authHeader && safeEqual(authHeader, `Bearer ${authToken}`)) {
			return next();
		}

		return c.json({ success: false, error: "Unauthorized" }, 401);
	};
}
