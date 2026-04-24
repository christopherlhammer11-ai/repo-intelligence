import os from "node:os";
import path from "node:path";

const APP_FOLDER_NAME = "Repo Intelligence";

export function getAppDataRoot() {
  const override = process.env.REPO_INTELLIGENCE_DATA_ROOT?.trim();

  if (override) {
    return override;
  }

  if (process.platform === "darwin") {
    return path.join(
      os.homedir(),
      "Library",
      "Application Support",
      APP_FOLDER_NAME,
    );
  }

  if (process.platform === "win32") {
    return path.join(
      process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming"),
      APP_FOLDER_NAME,
    );
  }

  return path.join(
    process.env.XDG_DATA_HOME ?? path.join(os.homedir(), ".local", "share"),
    "repo-intelligence",
  );
}

export function getVectorDbDir() {
  return path.join(getAppDataRoot(), "lancedb");
}

export function getUploadsDir() {
  return path.join(getAppDataRoot(), "uploads");
}
