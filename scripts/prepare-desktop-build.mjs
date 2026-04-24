import { cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const standaloneDir = path.join(root, ".next", "standalone");
const standaloneNextDir = path.join(standaloneDir, ".next");
const sourceStaticDir = path.join(root, ".next", "static");
const targetStaticDir = path.join(standaloneNextDir, "static");
const sourcePublicDir = path.join(root, "public");
const targetPublicDir = path.join(standaloneDir, "public");

async function main() {
  await mkdir(standaloneNextDir, { recursive: true });
  await rm(targetStaticDir, { recursive: true, force: true });
  await rm(targetPublicDir, { recursive: true, force: true });
  await cp(sourceStaticDir, targetStaticDir, { recursive: true });
  await cp(sourcePublicDir, targetPublicDir, { recursive: true });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
