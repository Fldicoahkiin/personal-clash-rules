import react from "@vitejs/plugin-react";
import { execFileSync } from "node:child_process";
import { defineConfig } from "vite";
import type { BuildInfo } from "./src/config/build-info.js";

export default defineConfig(({ command }) => {
  let commit = process.env.WORKERS_CI_COMMIT_SHA || null;
  let dirty = false;
  if (!commit) {
    try {
      const options = { cwd: import.meta.dirname, encoding: "utf8", timeout: 5000 } as const;
      commit = execFileSync("git", ["rev-parse", "HEAD"], options).trim();
      dirty = execFileSync("git", ["status", "--porcelain"], options).trim().length > 0;
    } catch {
      console.warn("Git metadata unavailable; the footer will show an unknown commit.");
    }
  }
  const build: BuildInfo = {
    builtAt: command === "build" ? new Date().toISOString() : null,
    commit: commit && /^[a-f0-9]{40}$/u.test(commit) ? commit : null,
    dirty,
  };
  return {
    define: { __BUILD_INFO__: JSON.stringify(build) },
    plugins: [react(), {
      name: "build-info",
      generateBundle() {
        this.emitFile({ type: "asset", fileName: "build-info.json", source: JSON.stringify(build) });
      },
      configureServer(server) {
        server.middlewares.use("/api/version", (_request, response) => {
          response.setHeader("Content-Type", "application/json");
          response.setHeader("Cache-Control", "no-store");
          response.end(JSON.stringify({ build, deployment: null }));
        });
      },
    }],
    build: { sourcemap: true },
  };
});
