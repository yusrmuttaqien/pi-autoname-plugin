import { describe, it, expect, vi, beforeEach } from "vitest";
import { dirname } from "node:path";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import {
  ConfigSchema,
  loadConfig,
  validateConfig,
  ensureDefaultConfig,
  USER_CONFIG_PATH,
  type Config,
} from "../src/config.js";

vi.mock("@juicesharp/rpiv-config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@juicesharp/rpiv-config")>();
  return {
    ...actual,
    loadJsonConfig: vi.fn(() => ({})),
  };
});

// ensureDefaultConfig touches node:fs; mock it so loadConfig tests are
// side-effect free (existsSync → true = "file exists" = no-op write).
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    existsSync: vi.fn(() => true),
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
  };
});

import { loadJsonConfig } from "@juicesharp/rpiv-config";

const TOP_LEVEL_DEFAULTS: Partial<Config> = {
  enabled: true,
  initialRenameTrigger: "first-input",
  reRenameEveryNTurns: 0,
  replaceExistingName: "always",
  respectExternalRenames: true,
  namingStyle: "natural",
  contextStart: 1,
  contextEnd: 3,
  skipSessionNameDedup: false,
  namingModel: "",
  language: "en",
  windowNameMaxLength: undefined,
  sessionNameMaxLength: undefined,
};

describe("ConfigSchema top-level defaults (via rpiv-config validateConfig)", () => {
  it("applies every scalar default", () => {
    const cfg = validateConfig(ConfigSchema, {});
    for (const [key, value] of Object.entries(TOP_LEVEL_DEFAULTS)) {
      expect(cfg[key as keyof Config], key).toEqual(value);
    }
  });

  it("accepts valid scalar overrides", () => {
    const cfg = validateConfig(ConfigSchema, {
      namingStyle: "slug",
      language: "zh-CN",
      initialRenameTrigger: "first-agent-settled",
      reRenameEveryNTurns: 3,
      sessionNameMaxLength: 50,
      windowNameMaxLength: 25,
    });
    expect(cfg.namingStyle).toBe("slug");
    expect(cfg.language).toBe("zh-CN");
    expect(cfg.initialRenameTrigger).toBe("first-agent-settled");
    expect(cfg.reRenameEveryNTurns).toBe(3);
    expect(cfg.sessionNameMaxLength).toBe(50);
    expect(cfg.windowNameMaxLength).toBe(25);
  });

  it("strips unknown keys (rpiv-config Value.Clean contract)", () => {
    const cfg = validateConfig(ConfigSchema, { bogusKey: 1 } as any);
    expect((cfg as any).bogusKey).toBeUndefined();
    expect(cfg.namingStyle).toBe("natural");
  });
});

describe("loadConfig (nested defaults deep-merged)", () => {
  beforeEach(() => {
    vi.mocked(loadJsonConfig).mockReset();
    vi.mocked(loadJsonConfig).mockReturnValue({});
  });

  it("returns full defaults including nested surfaces", () => {
    const cfg = loadConfig("/p");
    expect(cfg.surfaces).toEqual({
      renamePiSession: true,
      renameHerdrPane: true,
      renameHerdrTab: true,
      renameTmuxWindow: true,
      renameZellijPane: true,
      renameZellijTab: true,
    });
    for (const [key, value] of Object.entries(TOP_LEVEL_DEFAULTS)) {
      expect(cfg[key as keyof Config], key).toEqual(value);
    }
  });

  it("keeps untouched surfaces when a partial surfaces override is given", () => {
    vi.mocked(loadJsonConfig)
      .mockReturnValueOnce({})
      .mockReturnValueOnce({ surfaces: { renameTmuxWindow: false } });
    const cfg = loadConfig("/p");
    expect(cfg.surfaces.renameTmuxWindow).toBe(false);
    expect(cfg.surfaces.renamePiSession).toBe(true);
    expect(cfg.surfaces.renameZellijTab).toBe(true);
  });

  it("loads the user-global base and the project override, project winning per field", () => {
    vi.mocked(loadJsonConfig)
      .mockReturnValueOnce({ namingStyle: "slug", language: "fr" }) // user base
      .mockReturnValueOnce({ language: "de" }); // project override
    const cfg = loadConfig("/some/project");

    expect(loadJsonConfig).toHaveBeenCalledTimes(2);
    expect(loadJsonConfig).toHaveBeenNthCalledWith(1, USER_CONFIG_PATH);
    const projectPath = vi.mocked(loadJsonConfig).mock.calls[1][0];
    expect(projectPath).toContain("/some/project");
    expect(projectPath.endsWith("pi-autoname-plugin.json")).toBe(true);

    expect(cfg.namingStyle).toBe("slug"); // from user base
    expect(cfg.language).toBe("de"); // project wins
  });

  it("deep-merges nested surface objects across user and project", () => {
    vi.mocked(loadJsonConfig)
      .mockReturnValueOnce({ surfaces: { renameTmuxWindow: false } })
      .mockReturnValueOnce({ surfaces: { renameZellijTab: false } });
    const cfg = loadConfig("/p");
    expect(cfg.surfaces.renameTmuxWindow).toBe(false); // user
    expect(cfg.surfaces.renameZellijTab).toBe(false); // project
    expect(cfg.surfaces.renamePiSession).toBe(true); // default elsewhere
  });
});

describe("ensureDefaultConfig (auto-generate co-located config)", () => {
  const tmpPath = "/tmp/autoname-plugin-test/config.json";

  beforeEach(() => {
    vi.mocked(existsSync).mockReset().mockReturnValue(true);
    vi.mocked(mkdirSync).mockReset();
    vi.mocked(writeFileSync).mockReset();
  });

  it("writes the full effective defaults when the file is missing", () => {
    vi.mocked(existsSync).mockReturnValueOnce(false);
    ensureDefaultConfig(tmpPath);
    expect(mkdirSync).toHaveBeenCalledWith(dirname(tmpPath), { recursive: true });
    expect(writeFileSync).toHaveBeenCalledTimes(1);
    const [path, content] = vi.mocked(writeFileSync).mock.calls[0];
    expect(path).toBe(tmpPath);
    const parsed = JSON.parse(content as string);
    expect(parsed.enabled).toBe(true);
    expect(parsed.windowNameMaxLength).toBe(30);
    expect(parsed.sessionNameMaxLength).toBe(200);
    expect(parsed.surfaces).toEqual({
      renamePiSession: true,
      renameHerdrPane: true,
      renameHerdrTab: true,
      renameTmuxWindow: true,
      renameZellijPane: true,
      renameZellijTab: true,
    });
  });

  it("does not overwrite an existing config file", () => {
    vi.mocked(existsSync).mockReturnValueOnce(true);
    ensureDefaultConfig(tmpPath);
    expect(writeFileSync).not.toHaveBeenCalled();
  });
});
