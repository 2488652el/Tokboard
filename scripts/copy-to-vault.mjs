import { copyFile, mkdir } from "fs/promises";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

const root = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(root, "..");
const vaultPluginDir = resolve(projectRoot, "..", "..", "..", "..", "..", ".obsidian", "plugins", "tokboard");

await mkdir(vaultPluginDir, { recursive: true });

for (const file of ["main.js", "manifest.json", "styles.css"]) {
  await copyFile(resolve(projectRoot, file), resolve(vaultPluginDir, file));
}

console.log(`Copied plugin files to ${vaultPluginDir}`);
