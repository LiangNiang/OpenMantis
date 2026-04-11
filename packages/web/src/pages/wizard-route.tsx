import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { RestartBanner } from "@/components/restart-banner";
import { api } from "@/lib/api";
import { Wizard } from "@/pages/wizard";

export function WizardRoute() {
	const navigate = useNavigate();
	const [hasExistingConfig, setHasExistingConfig] = useState<boolean | null>(null);

	useEffect(() => {
		api
			.hasConfig()
			.then(({ hasConfig }) => setHasExistingConfig(hasConfig))
			.catch(() => setHasExistingConfig(false));
	}, []);

	if (hasExistingConfig === null) return null;

	return (
		<div className="min-h-screen flex flex-col">
			<RestartBanner />
			<div className="flex-1 min-h-0">
				<Wizard
					onComplete={() => navigate("/provider", { replace: true })}
					onCancel={hasExistingConfig ? () => navigate("/provider") : undefined}
				/>
			</div>
		</div>
	);
}
