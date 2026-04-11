import { createLogger } from "@openmantis/common/logger";
import { tool } from "ai";
import { XMLParser } from "fast-xml-parser";
import { z } from "zod";

const logger = createLogger("core/tools");

const FETCH_TIMEOUT = 10_000;
const DEFAULT_LIMIT = 20;
const USER_AGENT = "OpenMantis/1.0 (RSS Reader)";

const xmlParser = new XMLParser({
	ignoreAttributes: false,
	attributeNamePrefix: "@_",
});

interface FeedItem {
	title: string;
	link: string;
	pubDate: string;
	description: string;
}

interface FeedResult {
	url: string;
	title: string;
	items: FeedItem[];
	error?: string;
}

interface DiscoveredFeed {
	url: string;
	title?: string;
	type: "rss" | "atom";
}

function normalizeDate(raw: string): string {
	const parsed = new Date(raw);
	if (Number.isNaN(parsed.getTime())) {
		return raw;
	}
	return parsed.toISOString();
}

function extractText(value: unknown): string {
	if (typeof value === "string") return value;
	if (value && typeof value === "object" && "#text" in value) {
		return String((value as Record<string, unknown>)["#text"]);
	}
	return String(value ?? "");
}

function parseAtomLink(link: unknown): string {
	if (typeof link === "string") return link;
	if (Array.isArray(link)) {
		const alternate = link.find((l) => l?.["@_rel"] === "alternate" || !l?.["@_rel"]);
		return alternate?.["@_href"] ?? link[0]?.["@_href"] ?? "";
	}
	if (link && typeof link === "object") {
		return (link as Record<string, string>)["@_href"] ?? "";
	}
	return "";
}

function parseRss2Items(channel: any, limit: number): FeedItem[] {
	const rawItems = channel?.item;
	if (!rawItems) return [];
	const items = Array.isArray(rawItems) ? rawItems : [rawItems];
	return items.slice(0, limit).map((item: any) => ({
		title: extractText(item.title),
		link: extractText(item.link),
		pubDate: normalizeDate(extractText(item.pubDate ?? "")),
		description: extractText(item.description ?? ""),
	}));
}

function parseAtomEntries(feed: any, limit: number): FeedItem[] {
	const rawEntries = feed?.entry;
	if (!rawEntries) return [];
	const entries = Array.isArray(rawEntries) ? rawEntries : [rawEntries];
	return entries.slice(0, limit).map((entry: any) => ({
		title: extractText(entry.title),
		link: parseAtomLink(entry.link),
		pubDate: normalizeDate(extractText(entry.published ?? entry.updated ?? "")),
		description: extractText(entry.summary ?? entry.content ?? ""),
	}));
}

export function parseFeed(xml: string, limit: number): { title: string; items: FeedItem[] } {
	const parsed = xmlParser.parse(xml);

	// RSS 2.0
	if (parsed.rss?.channel) {
		const channel = parsed.rss.channel;
		return {
			title: extractText(channel.title ?? ""),
			items: parseRss2Items(channel, limit),
		};
	}

	// Atom
	if (parsed.feed) {
		const feed = parsed.feed;
		return {
			title: extractText(feed.title ?? ""),
			items: parseAtomEntries(feed, limit),
		};
	}

	throw new Error("Unrecognized feed format: not RSS 2.0 or Atom");
}

function sortByDate(items: FeedItem[]): FeedItem[] {
	return items.sort((a, b) => {
		const da = new Date(a.pubDate).getTime();
		const db = new Date(b.pubDate).getTime();
		if (Number.isNaN(da) && Number.isNaN(db)) return 0;
		if (Number.isNaN(da)) return 1;
		if (Number.isNaN(db)) return -1;
		return db - da;
	});
}

export async function fetchFeed(url: string, limit: number): Promise<FeedResult> {
	try {
		const response = await fetch(url, {
			signal: AbortSignal.timeout(FETCH_TIMEOUT),
			headers: { "User-Agent": USER_AGENT },
		});
		if (!response.ok) {
			return { url, title: "", items: [], error: `HTTP ${response.status}` };
		}
		const xml = await response.text();
		const { title, items } = parseFeed(xml, limit);
		return { url, title, items: sortByDate(items) };
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return { url, title: "", items: [], error: message };
	}
}

export async function discoverFeeds(url: string): Promise<DiscoveredFeed[]> {
	const response = await fetch(url, {
		signal: AbortSignal.timeout(FETCH_TIMEOUT),
		headers: { "User-Agent": USER_AGENT },
	});
	if (!response.ok) {
		throw new Error(`HTTP ${response.status}`);
	}
	const html = await response.text();

	const feeds: DiscoveredFeed[] = [];
	const linkRegex = /<link\s+[^>]*type\s*=\s*["'](application\/(?:rss|atom)\+xml)["'][^>]*>/gi;

	for (let match = linkRegex.exec(html); match !== null; match = linkRegex.exec(html)) {
		const tag = match[0]!;
		const type = match[1]!;

		const hrefMatch = tag.match(/href\s*=\s*["']([^"']+)["']/);
		if (!hrefMatch) continue;

		let feedUrl = hrefMatch[1]!;
		if (feedUrl.startsWith("/")) {
			const base = new URL(url);
			feedUrl = `${base.origin}${feedUrl}`;
		}

		const titleMatch = tag.match(/title\s*=\s*["']([^"']+)["']/);

		feeds.push({
			url: feedUrl,
			title: titleMatch?.[1],
			type: type.includes("atom") ? "atom" : "rss",
		});
	}

	return feeds;
}

export function createRssTools() {
	return {
		rssFetch: tool({
			description:
				"解析 RSS/Atom feed 获取最新条目列表。适用于：(1) 监控固定新闻来源的最新发布；(2) 从已知 feed 地址批量获取结构化新闻数据（标题、链接、摘要、日期）；(3) 配合 tavilyExtract 使用——先用本工具获取条目列表，再对感兴趣的条目用 tavilyExtract 抓取全文。如不知道 feed 地址，先用 rssDiscover 自动发现。",
			inputSchema: z.object({
				urls: z.array(z.string().url()).min(1).describe("RSS/Atom feed URL 列表"),
				limit: z
					.number()
					.int()
					.positive()
					.default(DEFAULT_LIMIT)
					.describe("每个 feed 返回的最大条目数，默认 20"),
			}),
			execute: async ({ urls, limit }) => {
				logger.debug(`[tool:rss] fetching ${urls.length} feed(s), limit=${limit}`);
				const results = await Promise.allSettled(urls.map((url) => fetchFeed(url, limit)));
				const feeds = results.map((result, i) => {
					if (result.status === "fulfilled") return result.value;
					return {
						url: urls[i]!,
						title: "",
						items: [],
						error: result.reason instanceof Error ? result.reason.message : String(result.reason),
					};
				});
				logger.debug(
					`[tool:rss] fetched ${feeds.length} feed(s), total items: ${feeds.reduce((sum, f) => sum + f.items.length, 0)}`,
				);
				return { feeds };
			},
		}),

		rssDiscover: tool({
			description:
				"给定网站 URL，自动发现其 RSS/Atom feed 地址。适用于：(1) 不知道某网站的 RSS feed 地址时自动查找；(2) 在使用 rssFetch 前先发现可用的 feed 来源。返回该网站声明的所有 feed 地址和类型。",
			inputSchema: z.object({
				url: z.string().url().describe("网站 URL"),
			}),
			execute: async ({ url }) => {
				logger.debug(`[tool:rss] discovering feeds at ${url}`);
				try {
					const feeds = await discoverFeeds(url);
					logger.debug(`[tool:rss] discovered ${feeds.length} feed(s) at ${url}`);
					return { feeds };
				} catch (err) {
					const message = err instanceof Error ? err.message : String(err);
					logger.warn(`[tool:rss] discover failed for ${url}: ${message}`);
					return { feeds: [], error: message };
				}
			},
		}),
	};
}
