import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useState,
	type ReactNode,
} from "react"
import { ApiError, api } from "@/lib/api"

interface ConfigContextValue {
	config: Record<string, any> | null
	loading: boolean
	error: string | null
	restartRequired: boolean
	refresh: () => Promise<void>
	updateConfig: (partial: Record<string, any>) => Promise<void>
	resetConfig: (keys?: string[]) => Promise<void>
}

const ConfigContext = createContext<ConfigContextValue | null>(null)

export function ConfigProvider({ children }: { children: ReactNode }) {
	const [config, setConfig] = useState<Record<string, any> | null>(null)
	const [loading, setLoading] = useState(true)
	const [error, setError] = useState<string | null>(null)
	const [restartRequired, setRestartRequired] = useState(false)

	const refresh = useCallback(async () => {
		try {
			setLoading(true)
			setError(null)
			const [data, restart, has] = await Promise.all([
				api.getConfigRaw(),
				api.getRestartRequired().catch(() => ({ restartRequired: false })),
				api.hasConfig().catch(() => ({ hasConfig: true })),
			])
			setConfig(has.hasConfig ? data : null)
			if (restart.restartRequired) {
				setRestartRequired(true)
			}
		} catch (err) {
			setError(err instanceof ApiError ? err.message : "Failed to load config")
		} finally {
			setLoading(false)
		}
	}, [])

	useEffect(() => {
		refresh()
	}, [refresh])

	const updateConfig = useCallback(
		async (partial: Record<string, any>) => {
			try {
				setError(null)
				const result = await api.updateConfig(partial)
				if (result.restartRequired) {
					setRestartRequired(true)
				}
				await refresh()
			} catch (err) {
				const message = err instanceof ApiError ? err.message : "Failed to update config"
				setError(message)
				throw err
			}
		},
		[refresh],
	)

	const resetConfig = useCallback(
		async (keys?: string[]) => {
			try {
				setError(null)
				const result = await api.resetConfig(keys)
				if (result.restartRequired) {
					setRestartRequired(true)
				}
				await refresh()
			} catch (err) {
				setError(err instanceof ApiError ? err.message : "Failed to reset config")
				throw err
			}
		},
		[refresh],
	)

	const value = useMemo<ConfigContextValue>(
		() => ({
			config,
			loading,
			error,
			restartRequired,
			refresh,
			updateConfig,
			resetConfig,
		}),
		[config, loading, error, restartRequired, refresh, updateConfig, resetConfig],
	)

	return <ConfigContext.Provider value={value}>{children}</ConfigContext.Provider>
}

export function useConfig(): ConfigContextValue {
	const ctx = useContext(ConfigContext)
	if (!ctx) {
		throw new Error("useConfig must be used within <ConfigProvider>")
	}
	return ctx
}
