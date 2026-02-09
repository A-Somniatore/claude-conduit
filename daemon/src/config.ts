import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { randomBytes } from "node:crypto";

export interface RelayConfig {
  port: number;
  host: string;
  debug: boolean;
  auth: {
    psk: string;
  };
  tmux: {
    defaultCols: number;
    defaultRows: number;
    scrollbackLines: number;
  };
  claude: {
    binary: string;
    sessionDir: string;
    maxSessions: number;
  };
  rateLimit: {
    attachPerSession: string;
    wsHeartbeat: number;
    wsMaxMissedPongs: number;
  };
  projectDirs: string[];
}

const CONFIG_DIR = join(homedir(), ".config", "claude-relay");
const CONFIG_PATH = join(CONFIG_DIR, "config.yaml");

function defaults(): RelayConfig {
  return {
    port: 7860,
    host: "0.0.0.0",
    debug: false,
    auth: {
      psk: "",
    },
    tmux: {
      defaultCols: 120,
      defaultRows: 40,
      scrollbackLines: 10000,
    },
    claude: {
      binary: "claude",
      sessionDir: join(homedir(), ".claude", "projects"),
      maxSessions: 5,
    },
    rateLimit: {
      attachPerSession: "1/5s",
      wsHeartbeat: 30,
      wsMaxMissedPongs: 3,
    },
    projectDirs: [
      join(homedir(), "projects"),
      join(homedir(), "projects", "Startups"),
    ],
  };
}

export function loadConfig(): RelayConfig {
  const config = defaults();

  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  }

  if (!existsSync(CONFIG_PATH)) {
    // Generate a random PSK and write example config
    const psk = randomBytes(32).toString("base64url");
    config.auth.psk = psk;
    const exampleYaml = `# Claude Relay Daemon Configuration
port: ${config.port}
host: "${config.host}"
auth:
  psk: "${psk}"
tmux:
  defaultCols: ${config.tmux.defaultCols}
  defaultRows: ${config.tmux.defaultRows}
  scrollbackLines: ${config.tmux.scrollbackLines}
claude:
  binary: "${config.claude.binary}"
  maxSessions: ${config.claude.maxSessions}
rateLimit:
  wsHeartbeat: ${config.rateLimit.wsHeartbeat}
  wsMaxMissedPongs: ${config.rateLimit.wsMaxMissedPongs}
`;
    writeFileSync(CONFIG_PATH, exampleYaml, { mode: 0o600 });
    return config;
  }

  try {
    const raw = readFileSync(CONFIG_PATH, "utf-8");
    const parsed = parseYaml(raw) as Record<string, unknown>;
    return mergeConfig(config, parsed);
  } catch (err) {
    throw new Error(`Failed to parse config at ${CONFIG_PATH}: ${err}`);
  }
}

function mergeConfig(
  base: RelayConfig,
  overrides: Record<string, unknown>,
): RelayConfig {
  const result = { ...base };

  if (typeof overrides.port === "number") result.port = overrides.port;
  if (typeof overrides.host === "string") result.host = overrides.host;
  if (typeof overrides.debug === "boolean") result.debug = overrides.debug;

  const auth = overrides.auth as Record<string, unknown> | undefined;
  if (auth?.psk && typeof auth.psk === "string") {
    result.auth = { ...result.auth, psk: auth.psk };
  }

  const tmux = overrides.tmux as Record<string, unknown> | undefined;
  if (tmux) {
    if (typeof tmux.defaultCols === "number")
      result.tmux.defaultCols = tmux.defaultCols;
    if (typeof tmux.defaultRows === "number")
      result.tmux.defaultRows = tmux.defaultRows;
    if (typeof tmux.scrollbackLines === "number")
      result.tmux.scrollbackLines = tmux.scrollbackLines;
  }

  const claude = overrides.claude as Record<string, unknown> | undefined;
  if (claude) {
    if (typeof claude.binary === "string")
      result.claude.binary = claude.binary;
    if (typeof claude.maxSessions === "number")
      result.claude.maxSessions = claude.maxSessions;
  }

  const rateLimit = overrides.rateLimit as Record<string, unknown> | undefined;
  if (rateLimit) {
    if (typeof rateLimit.attachPerSession === "string")
      result.rateLimit.attachPerSession = rateLimit.attachPerSession;
    if (typeof rateLimit.wsHeartbeat === "number")
      result.rateLimit.wsHeartbeat = rateLimit.wsHeartbeat;
    if (typeof rateLimit.wsMaxMissedPongs === "number")
      result.rateLimit.wsMaxMissedPongs = rateLimit.wsMaxMissedPongs;
  }

  if (Array.isArray(overrides.projectDirs)) {
    const dirs = (overrides.projectDirs as unknown[]).filter(
      (d): d is string => typeof d === "string",
    );
    if (dirs.length > 0) {
      // Resolve ~ in paths
      result.projectDirs = dirs.map((d) =>
        d.startsWith("~/") ? join(homedir(), d.slice(2)) : d,
      );
    }
  }

  return result;
}

export { CONFIG_DIR, CONFIG_PATH };
