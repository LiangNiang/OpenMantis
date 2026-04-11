import { createBrowserRouter, Navigate } from "react-router-dom";
import { DashboardLayout } from "@/layouts/dashboard-layout";
import { AdvancedPage } from "@/pages/advanced";
import { ChannelsPage } from "@/pages/channels";
import { LogsPage } from "@/pages/logs";
import { ProviderPage } from "@/pages/provider";
import { ToolsPage } from "@/pages/tools";
import { WizardRoute } from "@/pages/wizard-route";

export function createAppRouter() {
	return createBrowserRouter([
		{
			path: "/wizard",
			element: <WizardRoute />,
		},
		{
			path: "/",
			element: <DashboardLayout />,
			children: [
				{ index: true, element: <Navigate to="/provider" replace /> },
				{ path: "provider", element: <ProviderPage /> },
				{ path: "channels", element: <ChannelsPage /> },
				{ path: "tools", element: <ToolsPage /> },
				{ path: "advanced", element: <AdvancedPage /> },
				{ path: "logs", element: <LogsPage /> },
			],
		},
		{
			path: "*",
			element: <Navigate to="/provider" replace />,
		},
	]);
}
