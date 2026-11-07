import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
const proxy = () => ({
  target: "http://127.0.0.1:13082",
  changeOrigin: true,
  configure(server) {
    server.on("proxyReq", (request) => {
      request.setHeader("Origin", "http://127.0.0.1:13082");
    });
  },
});
export default defineConfig(({ command }) => ({
  plugins: [react()],
  base: command === "serve" ? "/" : "/console/",
  build: { outDir: "dist" },
  server: {
    host: "127.0.0.1",
    proxy: {
      "/auth/": proxy(),
      "/api/": proxy(),
      "^/account/": proxy(),
      "^/admin/": proxy(),
    },
  },
}));
