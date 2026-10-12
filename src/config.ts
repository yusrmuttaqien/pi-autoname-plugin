// config.ts — schema, defaults, load/merge.
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { Type, type Static, type TObject } from "typebox";
import { CONFIG_DIR_NAME } from "@earendil-works/pi-coding-agent";
import {
  loadJsonConfig,
  validateConfig as rpivValidateConfig,
} from "@juicesharp/rpiv-config";
import { debug } from "./debug.js";
import {
  DEFAULT_MAX_WINDOW_NAME_CHARS,
  DEFAULT_MAX_SESSION_NAME_CHARS,
} from "./constants.js";

export const ConfigSchema = Type.Object({
  enabled: Type.Boolean({ default: true }),
  surfaces: Type.Object({
    renamePiSession: Type.Boolean({ default: true }),
    renameHerdrPane: Type.Boolean({ default: true }),
    renameHerdrTab: Type.Boolean({ default: true }),
    renameTmuxWindow: Type.Boolean({ default: true }),
    renameZellijPane: Type.Boolean({ default: true }),
    renameZellijTab: Type.Boolean({ default: true }),
  }),
  initialRenameTrigger: Type.Union(
    [Type.Literal("first-input"), Type.Literal("first-agent-settled")],
    {
      default: "first-input",
    },
  ),
  reRenameEveryNTurns: Type.Integer({ minimum: 0, default: 0 }),
  replaceExistingName: Type.Union([Type.Literal("always"), Type.Literal("never")], {
    default: "always",
  }),
  respectExternalRenames: Type.Boolean({ default: true }),
  namingStyle: Type.Union(
    [Type.Literal("natural"), Type.Literal("slug"), Type.Literal("topic-project")],
    { default: "natural" },
  ),
  // How many user messages to include from the START and END of the
  // conversation. The naming context is the first `contextStart` + last
  // `contextEnd` user messages (deduplicated, in order). If BOTH are 0 there
  // is no naming context and the plugin does not auto-rename.
  contextStart: Type.Integer({ minimum: 0, default: 1 }),
  contextEnd: Type.Integer({ minimum: 0, default: 3 }),
  skipSessionNameDedup: Type.Boolean({ default: false }),
  namingModel: Type.String({ default: "" }),
  // Raw string appended verbatim to the naming LLM's system prompt (empty = off).
  customInstructions: Type.String({ default: "" }),
  // BCP-47 language tag only ("en", "zh-CN", "pt-BR")
  language: Type.String({ default: "en" }),
  // Per-name limits, override semantics: when set, windowNameMaxLength applies
  // to every window surface (herdr pane/tab, tmux window, zellij pane/tab) and
  // sessionNameMaxLength to the Pi session name and session list. Each replaces
  // a single fixed default (DEFAULT_MAX_WINDOW_NAME_CHARS / DEFAULT_MAX_SESSION_NAME_CHARS
  // in naming.ts) — tightening OR relaxing it, identically for every style.
  // These are the only two length knobs.
  windowNameMaxLength: Type.Optional(Type.Integer({ minimum: 1 })),
  sessionNameMaxLength: Type.Optional(Type.Integer({ minimum: 1 })),
});

export type Config = Static<typeof ConfigSchema>;

/**
 * rpiv-config's `validateConfig` (verbatim behavior: non-object guard,
 * Value.Clean strips unknown keys, Value.Create applies defaults, defaults
 * merged under the cleaned value). The cast papers over an upstream generic
 * bug: typebox 1.x's bare `TObject` defaults `required` to `[string]`, so
 * rpiv-config's `T extends TObject` constraint rejects any object schema with
 * more than one required key. Runtime behavior is unchanged.
 */
export function validateConfig<T extends TObject>(schema: T, value: unknown): Static<T> {
  return rpivValidateConfig(schema as TObject, value) as Static<T>;
}

/**
 * User-owned config location: ~/.pi/agent/extensions/pi-autoname-plugin/config.json.
 * A stable, user-facing path that survives pi updates and re-clones of the git
 * install — the same convention other extensions use (e.g. pi-extendedread).
 * Derived from the home directory, not import.meta.url, so it does not move
 * when the extension is re-installed to a different git-clone directory.
 */
export const USER_CONFIG_PATH = join(
  homedir(),
  ".pi",
  "agent",
  "extensions",
  "pi-autoname-plugin",
  "config.json",
);

/**
 * Auto-generate the co-located config with the full effective defaults when
 * it doesn't exist. Best-effort: a write failure (e.g. read-only FS) is
 * non-fatal — loadConfig falls back to in-memory defaults.
 */
export function ensureDefaultConfig(path: string = USER_CONFIG_PATH): void {
  if (existsSync(path)) return;
  const base = validateConfig(ConfigSchema, {});
  const defaults = {
    ...base,
    windowNameMaxLength: DEFAULT_MAX_WINDOW_NAME_CHARS,
    sessionNameMaxLength: DEFAULT_MAX_SESSION_NAME_CHARS,
  };
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(defaults, null, 2) + "\n", "utf-8");
  } catch (err) {
    debug("ensureDefaultConfig: failed to write defaults", { path, err: String(err) });
  }
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Deep merge; `over` wins per field. Arrays and scalars are replaced, not merged. */
function deepMerge(
  base: Record<string, unknown>,
  over: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(over)) {
    if (isPlainObject(value) && isPlainObject(out[key])) {
      out[key] = deepMerge(out[key] as Record<string, unknown>, value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

/**
 * Load: user-global base ← project override (per-field, project wins).
 * Configuration comes ONLY from the two JSON files read via rpiv-config;
 * there are no env-var overrides.
 */
export function loadConfig(cwd: string): Config {
  ensureDefaultConfig();
  const userPath = USER_CONFIG_PATH;
  const projectPath = join(cwd, CONFIG_DIR_NAME, "pi-autoname-plugin.json");
  const user = loadJsonConfig<Record<string, unknown>>(userPath);
  const project = loadJsonConfig<Record<string, unknown>>(projectPath);
  const merged = deepMerge(user, project);
  const validated = validateConfig(ConfigSchema, merged);
  // rpiv-config's merge is shallow (`{...defaults, ...cleaned}`) and TypeBox
  // Value.Create honors an object's own default over nested property defaults.
  // Deep-merge the full schema defaults so a partial `surfaces`
  // override keeps every untouched field (spec §3.2 intent).
  const fullDefaults = validateConfig(ConfigSchema, {});
  const cfg = deepMerge(fullDefaults, validated) as Config;
  debug("loadConfig", {
    userPath,
    projectPath,
    enabled: cfg.enabled,
    namingStyle: cfg.namingStyle,
    initialRenameTrigger: cfg.initialRenameTrigger,
    reRenameEveryNTurns: cfg.reRenameEveryNTurns,
    replaceExistingName: cfg.replaceExistingName,
    respectExternalRenames: cfg.respectExternalRenames,
    language: cfg.language,
    surfaces: cfg.surfaces,
  });
  return cfg;
}
