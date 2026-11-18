import { Option, Schema } from "effect";

export type OpenMode = "auto" | "system";

export type OpenResult =
  | {
      readonly status: "opened";
      readonly via: "browse";
      readonly tab: string;
    }
  | {
      readonly status: "opened";
      readonly via: "system";
      readonly fallbackReason?: string | undefined;
    }
  | {
      readonly status: "failed";
      readonly problem: string;
    };

export type CommandResult =
  | {
      readonly ran: true;
      readonly code: number;
      readonly stdout: string;
      readonly stderr: string;
    }
  | {
      readonly ran: false;
      readonly stderr: string;
    };

export type RunCommandOptions = {
  readonly ignoreOutput?: boolean | undefined;
  readonly timeoutMs?: number | undefined;
};

export type OpenerDeps = {
  readonly which?: (binary: string) => string | null;
  readonly run?: (
    argv: ReadonlyArray<string>,
    options?: RunCommandOptions,
  ) => Promise<CommandResult>;
  readonly platform?: NodeJS.Platform;
};

export type BrowserOpener = {
  readonly open: (url: string, mode?: OpenMode) => Promise<OpenResult>;
};

const COMMAND_TIMEOUT_MS = 10_000;

const BrowseStatusSchema = Schema.Struct({
  connected: Schema.Boolean,
});

const BrowseNavigateSchema = Schema.Struct({
  tab: Schema.Union([Schema.String, Schema.Number]),
});

const decodeStatus = Schema.decodeUnknownOption(BrowseStatusSchema);
const decodeNavigate = Schema.decodeUnknownOption(BrowseNavigateSchema);

const parseJsonOption = <Value>(
  raw: string,
  decode: (input: unknown) => Option.Option<Value>,
): Value | undefined => {
  try {
    return Option.getOrUndefined(decode(JSON.parse(raw)));
  } catch {
    return undefined;
  }
};

const firstLine = (stderr: string, fallback: string): string =>
  stderr
    .split("\n")
    .map((entry) => entry.trim())
    .find((entry) => entry.length > 0) ?? fallback;

export const systemBrowserCommand = (
  platform: NodeJS.Platform,
  url: string,
): ReadonlyArray<string> => {
  if (platform === "darwin") return ["open", url];
  if (platform === "win32") return ["rundll32", "url.dll,FileProtocolHandler", url];
  return ["xdg-open", url];
};

const raceTimeout = async <Value>(
  work: Promise<Value>,
  timeoutMs: number,
  onTimeout: () => void,
): Promise<{ readonly timedOut: false; readonly value: Value } | { readonly timedOut: true }> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    work.then((value) => ({ timedOut: false as const, value })),
    new Promise<{ readonly timedOut: true }>((resolve) => {
      timer = setTimeout(() => {
        onTimeout();
        resolve({ timedOut: true });
      }, timeoutMs);
      timer.unref?.();
    }),
  ]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
};

const timeoutFailure = (argv: ReadonlyArray<string>, timeoutMs: number): CommandResult => ({
  ran: true,
  code: 124,
  stdout: "",
  stderr: `${argv[0] ?? "command"} timed out after ${timeoutMs}ms`,
});

export const runCommand = async (
  argv: ReadonlyArray<string>,
  options: RunCommandOptions = {},
): Promise<CommandResult> => {
  const timeoutMs = options.timeoutMs ?? COMMAND_TIMEOUT_MS;
  if (options.ignoreOutput === true) {
    let proc: Bun.Subprocess<"ignore", "ignore", "ignore">;
    try {
      proc = Bun.spawn([...argv], { stdin: "ignore", stdout: "ignore", stderr: "ignore" });
    } catch (cause) {
      return { ran: false, stderr: cause instanceof Error ? cause.message : String(cause) };
    }
    const race = await raceTimeout(proc.exited, timeoutMs, () => proc.kill("SIGKILL"));
    return race.timedOut
      ? timeoutFailure(argv, timeoutMs)
      : { ran: true, code: race.value, stdout: "", stderr: "" };
  }

  let proc: Bun.Subprocess<"ignore", "pipe", "pipe">;
  try {
    proc = Bun.spawn([...argv], { stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  } catch (cause) {
    return { ran: false, stderr: cause instanceof Error ? cause.message : String(cause) };
  }

  const completed = Promise.all([
    new Response(proc.stdout).text().catch(() => ""),
    new Response(proc.stderr).text().catch(() => ""),
    proc.exited,
  ]);
  const race = await raceTimeout(completed, timeoutMs, () => {
    proc.kill("SIGKILL");
    void proc.stdout.cancel().catch(() => undefined);
    void proc.stderr.cancel().catch(() => undefined);
  });

  if (race.timedOut) return timeoutFailure(argv, timeoutMs);
  const [stdout, stderr, code] = race.value;
  return { ran: true, code, stdout: stdout.trim(), stderr: stderr.trim() };
};

type BrowseTabState = {
  tab: string | number | undefined;
  origin: string | undefined;
};

type BrowseAttempt =
  | { readonly ok: true; readonly tab: string }
  | { readonly ok: false; readonly reason: string };

const attemptBrowse = async (
  url: string,
  origin: string,
  state: BrowseTabState,
  which: (binary: string) => string | null,
  run: (argv: ReadonlyArray<string>, options?: RunCommandOptions) => Promise<CommandResult>,
): Promise<BrowseAttempt> => {
  if (which("browse") === null) return { ok: false, reason: "browse CLI not found" };

  const statusOut = await run(["browse", "status", "--json"]);
  if (!statusOut.ran || statusOut.code !== 0)
    return { ok: false, reason: "browse relay unavailable" };

  const status = parseJsonOption(statusOut.stdout, decodeStatus);
  if (status === undefined) return { ok: false, reason: "browse status unreadable" };
  if (!status.connected) return { ok: false, reason: "browse extension offline" };

  if (state.tab !== undefined && state.origin === origin) {
    const reused = await run([
      "browse",
      "navigate",
      "--json",
      JSON.stringify({ url, tab: state.tab }),
    ]);
    const parsed =
      reused.ran && reused.code === 0 ? parseJsonOption(reused.stdout, decodeNavigate) : undefined;
    if (parsed !== undefined) {
      state.tab = parsed.tab;
      return { ok: true, tab: String(parsed.tab) };
    }
    state.tab = undefined;
    state.origin = undefined;
  }

  const created = await run([
    "browse",
    "navigate",
    "--json",
    JSON.stringify({ url, group: "Spectre", keepVisible: true, allowedOrigins: [origin] }),
  ]);
  if (!created.ran || created.code !== 0) {
    return { ok: false, reason: firstLine(created.stderr, "browse navigate failed") };
  }

  const parsed = parseJsonOption(created.stdout, decodeNavigate);
  if (parsed === undefined)
    return { ok: false, reason: "browse navigate returned unexpected output" };

  state.tab = parsed.tab;
  state.origin = origin;
  return { ok: true, tab: String(parsed.tab) };
};

export const createBrowserOpener = (deps: OpenerDeps = {}): BrowserOpener => {
  const which = deps.which ?? ((binary: string) => Bun.which(binary));
  const run = deps.run ?? runCommand;
  const platform = deps.platform ?? process.platform;
  const state: BrowseTabState = { tab: undefined, origin: undefined };
  let queue: Promise<void> = Promise.resolve();

  const openSystem = async (url: string, fallbackReason?: string): Promise<OpenResult> => {
    const argv = systemBrowserCommand(platform, url);
    const result = await run(argv, { ignoreOutput: true });
    if (!result.ran) return { status: "failed", problem: result.stderr };
    if (result.code !== 0) {
      return {
        status: "failed",
        problem: firstLine(
          result.stderr,
          `${argv[0] ?? "browser"} exited with code ${result.code}`,
        ),
      };
    }
    return { status: "opened", via: "system", fallbackReason };
  };

  const openOnce = async (url: string, mode: OpenMode): Promise<OpenResult> => {
    const parsed = URL.canParse(url) ? new URL(url) : undefined;
    if (parsed === undefined || (parsed.protocol !== "http:" && parsed.protocol !== "https:")) {
      return { status: "failed", problem: `Only http and https URLs are allowed: ${url}` };
    }

    if (mode === "system") return openSystem(parsed.href);

    const browsed = await attemptBrowse(parsed.href, parsed.origin, state, which, run);
    return browsed.ok
      ? { status: "opened", via: "browse", tab: browsed.tab }
      : openSystem(parsed.href, browsed.reason);
  };

  return {
    open: (url, mode = "auto") => {
      const next = queue.then(() => openOnce(url, mode));
      queue = next.then(
        () => undefined,
        () => undefined,
      );
      return next;
    },
  };
};
