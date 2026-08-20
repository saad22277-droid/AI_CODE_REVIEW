import * as fs from "fs";
import * as yaml from "js-yaml";
import { AppConfig, DEFAULT_CONFIG } from "../types";

/**
 * Loads `.aicodereview.yml` if present and merges it over DEFAULT_CONFIG.
 * Missing file or missing fields are not errors — every field has a
 * sensible default, so the tool works with zero configuration.
 */
export function loadConfig(configPath = ".aicodereview.yml"): AppConfig {
  if (!fs.existsSync(configPath)) {
    return { ...DEFAULT_CONFIG };
  }

  const raw = fs.readFileSync(configPath, "utf-8");
  const parsed = (yaml.load(raw) as Partial<AppConfig>) ?? {};

  return {
    ...DEFAULT_CONFIG,
    ...parsed,
    categories: {
      ...DEFAULT_CONFIG.categories,
      ...(parsed.categories ?? {}),
    },
    ignorePaths: parsed.ignorePaths ?? DEFAULT_CONFIG.ignorePaths,
  };
}
