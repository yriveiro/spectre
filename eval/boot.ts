import { Opencode } from "./opencode";

const PASSWORD = /server password (\S+)/;

export type Booted = {
  readonly client: Opencode;
  /** Ids OpenCode says it registered, from its own log. Undefined until it says. */
  registered(): ReadonlyArray<string> | undefined;
  stop(): void;
};

const REGISTERED = /message="Registered skills" skills="\[(.*?)\]"/;

/**
 * The ids arrive inside a Go-quoted list, so each one is `\"like-this\"` and the
 * separators are escaped too. Splitting the raw capture on a comma yields
 * fragments with a leading backslash and no closing quote, which compares unequal
 * to every real id and makes a correct plugin look entirely unregistered.
 */
export const parseRegistered = (line: string): ReadonlyArray<string> => {
  const array = line.match(REGISTERED)?.[1];
  if (array === undefined) return [];
  return [...array.matchAll(/\\"([^"\\]+)\\"/g)].map((m) => m[1]!);
};

/**
 * The eval asks the model the question OpenCode asks it, so it runs inside
 * OpenCode: the plugin has to load for the real `<available_skills>` block to
 * reach the prompt. A direct provider call would be faster and would measure our
 * reconstruction of that block instead of the block itself.
 *
 * Two things are load-bearing and both were measured the hard way. The project
 * has to exist and hold its config before the spawn, because the directory
 * becomes the child's cwd and the plugin is loaded from there. And
 * `OPENCODE_CONFIG_DIR` is deliberately not set: it replaces the whole config
 * directory, which is also where the provider credentials live.
 */
export const boot = async (options: {
  plugin: string;
  directory: string;
  port: number;
  timeoutMs?: number;
}): Promise<Booted> => {
  // A plugin path that resolves to the wrong directory is silent: OpenCode logs
  // nothing useful and the session simply has none of our skills. Assert the
  // entrypoint is where we said before spawning, so the failure names the path.
  if (!(await Bun.file(`${options.plugin}index.ts`).exists()))
    throw new Error(
      `no index.ts at the plugin path "${options.plugin}", so nothing would load. ` +
        `The caller resolved the repository root wrongly.`,
    );

  await Bun.$`mkdir -p ${options.directory}`.quiet();
  await Bun.write(
    `${options.directory}/opencode.json`,
    `${JSON.stringify({ $schema: "https://opencode.ai/config.json", plugins: [options.plugin] }, null, 2)}\n`,
  );

  // `--log-level info` is load-bearing, not noise. `Registered skills` is an
  // info line, so at the default level the verification below has nothing to
  // read and the eval refuses to run. That is the check working, not a bug in it.
  const proc = Bun.spawn(
    ["opencode", "serve", "--port", String(options.port), "--log-level", "info", "--print-logs"],
    {
      cwd: options.directory,
      stdout: "pipe",
      stderr: "pipe",
    },
  );

  const reader = proc.stdout.getReader();
  const stderr = proc.stderr.getReader();
  const decoder = new TextDecoder();
  const deadline = Date.now() + (options.timeoutMs ?? 60_000);
  let password: string | undefined;
  let seen = "";

  while (password === undefined) {
    if (Date.now() > deadline) {
      proc.kill();
      throw new Error(
        `opencode serve printed no password in ${options.timeoutMs ?? 60_000}ms. Saw: ${seen}`,
      );
    }
    const chunk = await reader.read();
    if (chunk.done) break;
    seen += decoder.decode(chunk.value);
    password = seen.match(PASSWORD)?.[1];
  }
  if (password === undefined) {
    proc.kill();
    throw new Error(`opencode serve exited before printing a password. Saw: ${seen}`);
  }

  // The log is drained on second readers and the registration line lands after
  // the password, so both pumps have to keep going rather than stop at the first
  // match. `Registered skills` is the only statement of what the plugin
  // contributed that is not our own code saying so. With `--print-logs` the
  // server's log can arrive on either stream depending on the version.
  const drain = async (source: { read(): Promise<{ done?: boolean; value?: Uint8Array }> }) => {
    for (;;) {
      const chunk = await source.read();
      if (chunk.done) return;
      seen += decoder.decode(chunk.value);
    }
  };
  const pump = Promise.all([drain(reader), drain(stderr)]);

  // `String.match` answers null, not undefined, when there is no line yet. The
  // first poll happens before the plugin has finished registering, so treating
  // that as a present-but-empty result throws instead of letting the caller
  // retry, and the run dies on a race.
  const registered = (): ReadonlyArray<string> | undefined => {
    if (!REGISTERED.test(seen)) return undefined;
    return parseRegistered(seen);
  };

  return {
    client: new Opencode(options.directory, `http://127.0.0.1:${options.port}`, password),
    registered,
    stop: () => {
      void pump;
      proc.kill();
    },
  };
};
