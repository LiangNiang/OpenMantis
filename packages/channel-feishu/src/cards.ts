export interface InteractiveAction {
	label: string;
	description?: string;
	value: Record<string, string>;
	disabled?: boolean;
	buttonType?:
		| "default"
		| "primary"
		| "danger"
		| "text"
		| "primary_text"
		| "danger_text"
		| "primary_filled"
		| "danger_filled"
		| "laser";
	disabledTips?: string;
}

export function buildReplyCard(content: string, isError = false): string {
	const card: Record<string, unknown> = {
		elements: [
			{
				tag: "markdown",
				content,
			},
		],
	};

	if (isError) {
		card.header = {
			template: "red",
			title: {
				tag: "plain_text",
				content: "Error",
			},
		};
	}

	return JSON.stringify(card);
}

export function buildStreamingCard(routeId?: string): string {
	const elements: Record<string, unknown>[] = [
		{
			tag: "markdown",
			content: "",
			element_id: "md_1",
		},
	];

	if (routeId) {
		elements.push({
			tag: "button",
			element_id: "stop_btn",
			type: "danger",
			size: "medium",
			width: "default",
			text: { tag: "plain_text", content: "⏹ 停止" },
			behaviors: [{ type: "callback", value: { action: "stop", routeId } }],
		});
	}

	return JSON.stringify({
		schema: "2.0",
		config: {
			streaming_mode: true,
			summary: { content: "" },
			streaming_config: {
				print_frequency_ms: { default: 50 },
				print_step: { default: 2 },
				print_strategy: "fast",
			},
		},
		body: { elements },
	});
}

/**
 * Build a collapsible_panel element for tool execution info.
 * Used to dynamically insert into a streaming card via cardElement.create API.
 */
export function buildToolPanel(expanded = true): Record<string, unknown> {
	return {
		tag: "collapsible_panel",
		expanded,
		element_id: "tool_panel",
		background_color: "grey",
		header: {
			title: { tag: "markdown", content: "**🔧 工具调用**" },
			vertical_align: "center",
			icon: {
				tag: "standard_icon",
				token: "down-small-ccm_outlined",
				size: "16px 16px",
			},
			icon_position: "right",
			icon_expanded_angle: -180,
		},
		border: { color: "grey", corner_radius: "5px" },
		padding: "4px 8px 4px 8px",
		elements: [
			{
				tag: "markdown",
				content: "",
				element_id: "tool_md",
			},
		],
	};
}

export function buildFinalCard(content: string, toolContent?: string): string {
	const elements: Record<string, unknown>[] = [];

	if (toolContent) {
		const panel = buildToolPanel(false);
		(panel.elements as Record<string, unknown>[])[0]!.content = toolContent;
		elements.push(panel);
	}

	elements.push({
		tag: "markdown",
		content,
		element_id: "md_1",
	});

	// Use reply text as summary so chat preview doesn't show "工具调用"
	const summary = content.slice(0, 100).replace(/\n/g, " ");

	return JSON.stringify({
		schema: "2.0",
		config: { summary: { content: summary } },
		body: { elements },
	});
}

export function buildStoppedCard(content: string, toolContent?: string): string {
	const elements: Record<string, unknown>[] = [];

	if (toolContent) {
		const panel = buildToolPanel(false);
		(panel.elements as Record<string, unknown>[])[0]!.content = toolContent;
		elements.push(panel);
	}

	const summary = (content || "已停止").slice(0, 100).replace(/\n/g, " ");

	elements.push(
		{
			tag: "markdown",
			content: `${content}\n\n⏹ 已停止`,
			element_id: "md_1",
		},
		{
			tag: "button",
			element_id: "stop_btn",
			type: "default",
			size: "medium",
			width: "default",
			disabled: true,
			text: { tag: "plain_text", content: "已停止" },
		},
	);

	return JSON.stringify({
		schema: "2.0",
		config: { summary: { content: summary } },
		body: { elements },
	});
}


export function buildInteractiveCard(title: string, actions: InteractiveAction[]): string {
	const elements: Record<string, unknown>[] = [];

	for (const action of actions) {
		const btn: Record<string, unknown> = {
			tag: "button",
			width: "fill",
			type: action.buttonType ?? "default",
			size: "medium",
			text: {
				tag: "plain_text",
				content: action.description ? `${action.label}  ·  ${action.description}` : action.label,
			},
		};
		if (action.disabled) {
			btn.disabled = true;
			if (action.disabledTips) {
				btn.disabled_tips = { tag: "plain_text", content: action.disabledTips };
			}
		} else {
			btn.behaviors = [{ type: "callback", value: action.value }];
		}
		elements.push(btn);
	}

	return JSON.stringify({
		schema: "2.0",
		header: {
			template: "blue",
			title: { tag: "plain_text", content: title },
		},
		body: {
			elements,
			vertical_spacing: "8px",
		},
	});
}
