import { defineConfig } from "vite";
export default defineConfig({
  server: { proxy: { "/api": "http://127.0.0.1:8000" } },
  build: { rollupOptions: { input: { main: "index.html", render: "render.html" } } },
});
