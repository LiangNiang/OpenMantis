import { useMemo } from "react";
import { RouterProvider } from "react-router-dom";
import { ConfigProvider } from "@/hooks/use-config";
import { createAppRouter } from "@/router";

export function App() {
	const router = useMemo(() => createAppRouter(), []);

	return (
		<ConfigProvider>
			<RouterProvider router={router} />
		</ConfigProvider>
	);
}
