import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";
import { defineConfig } from "vite";

const notFoundPage = readFileSync(new URL("./public/404.html", import.meta.url));

export default defineConfig({
  appType: "mpa",
  plugins: [
    react(),
    {
      name: "wheeljack-preview-404",
      configurePreviewServer(server) {
        return () => server.middlewares.use((request, response, next) => {
          if (request.method !== "GET" || !request.headers.accept?.includes("text/html")) return next();
          if (request.url?.split("?", 1)[0] === "/index.html") return next();
          response.statusCode = 404;
          response.setHeader("Content-Type", "text/html; charset=utf-8");
          response.end(notFoundPage);
        });
      },
    },
  ],
  clearScreen: false,
  server: {
    strictPort: true,
    host: "127.0.0.1",
  },
});
