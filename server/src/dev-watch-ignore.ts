import fs from "node:fs";
import path from "node:path";

function toGlobstarPath(candidate: string): string {
  return `${candidate.replaceAll(path.sep, "/")}/**`;
}

function addIgnorePath(target: Set<string>, candidate: string): void {
  target.add(candidate);
  target.add(toGlobstarPath(candidate));
  try {
    const realPath = fs.realpathSync(candidate);
    target.add(realPath);
    target.add(toGlobstarPath(realPath));
  } catch {
    // Ignore paths that do not exist in the current checkout.
  }
}

export function resolveServerDevWatchIgnorePaths(serverRoot: string): string[] {
  const ignorePaths = new Set<string>([
    "**/{node_modules,bower_components,vendor}/**",
    "**/.vite-temp/**",
    "**/cli/dist/**",
    "**/packages/**/dist/**",
  ]);

  const repoRoot = path.resolve(serverRoot, "..");
  for (const relativePath of [
    "../ui/node_modules",
    "../ui/node_modules/.vite-temp",
    "../ui/.vite",
    "../ui/dist",
    // npm install during reinstall would trigger a restart mid-request
    // if tsx watch sees the new files. Exclude the managed plugins dir.
    process.env.HOME + "/.paperclip/adapter-plugins",
  ]) {
    addIgnorePath(ignorePaths, path.resolve(serverRoot, relativePath));
  }

  for (const relativePath of [
    "cli/dist",
    "packages/adapter-utils/dist",
    "packages/adapters/claude-local/dist",
    "packages/adapters/codex-local/dist",
    "packages/adapters/cursor-local/dist",
    "packages/adapters/gemini-local/dist",
    "packages/adapters/openclaw-gateway/dist",
    "packages/adapters/opencode-local/dist",
    "packages/adapters/pi-local/dist",
    "packages/db/dist",
    "packages/mcp-server/dist",
    "packages/plugins/create-paperclip-plugin/dist",
    "packages/plugins/sdk/dist",
    "packages/shared/dist",
  ]) {
    addIgnorePath(ignorePaths, path.join(repoRoot, relativePath));
  }

  return [...ignorePaths];
}
