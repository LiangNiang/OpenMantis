import path from "path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig, loadEnv } from "vite"

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const rootEnv = loadEnv(mode, path.resolve(__dirname, "../.."), "")
  const port = Number(rootEnv.WEB_DEV_PORT) || 5173
  return {
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    outDir: "../../dist/web",
    emptyOutDir: true,
  },
  server: {
    port,
    strictPort: true,
    hmr: { clientPort: port },
    proxy: {
      "/api": "http://localhost:7777",
    },
  },
  }
})
