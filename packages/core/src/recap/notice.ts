/**
 * Render a one-line "recap archived" notice for chat push, picking the
 * right markdown wrapping per channel.
 *
 * - feishu*  → <font color='grey'>...</font>  (interactive card markdown)
 * - wecom*   → <font color="comment">...</font>  (only 3 named colors supported)
 * - qq / others → plain text (QQ Bot markdown does not render <font>)
 */
export function formatRecapNotice(channelType: string, heading: string): string {
	const body = `📋 上次对话已归档：${heading}（/list 可查看）`;
	if (channelType.startsWith("feishu")) return `<font color='grey'>${body}</font>`;
	if (channelType.startsWith("wecom")) return `<font color="comment">${body}</font>`;
	return body;
}
