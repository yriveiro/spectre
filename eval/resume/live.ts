import { connect, type Opencode } from "../opencode";

export type Live = {
  readonly client: Opencode;
  readonly model: string;
  readonly logs: () => Promise<string>;
  readonly stop: () => Promise<void>;
};

const LISTENING = /server listening on http:\/\/127\.0\.0\.1:(\d+)/;

/**
 * The Console-managed providers do not cross into the Docker container, but they
 * work in a host server. This mode starts that server with a temporary config
 * directory that names the plugin's publish set and nothing else, so the global
 * config's published plugin cannot win the id. The auth and the data directory
 * stay the host's, which is what makes the model reachable.
 *
 * Project config discovery is off. A fixture writes into `workspace/`, and the
 * server's working directory is the run directory; even a config there is data
 * the model may read, not project config the server loads. A run directory is
 * created fresh under `.runs/`, so no ancestor carries fixture files.
 *
 * The port is ephemeral unless `SPECTRE_EVAL_LIVE_PORT` names one, and the
 * password is generated per run.
 */
const buildLiveConfig = (input: {
  readonly pluginDir?: string;
  readonly extraConfig?: Readonly<Record<string, unknown>>;
}): string =>
  `${JSON.stringify(
    {
      ...(input.extraConfig ?? {}),
      update: "disable",
      ...(input.pluginDir === undefined ? {} : { plugins: [input.pluginDir] }),
      experimental: {},
    },
    null,
    2,
  )}\n`;

const buildLiveEnv = (input: {
  readonly configDir: string;
  readonly password: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
}): Record<string, string | undefined> => {
  const childEnv: Record<string, string | undefined> = {
    ...Bun.env,
    ...(input.env ?? {}),
    OPENCODE_CONFIG_DIR: input.configDir,
    OPENCODE_CONFIG_PROJECT_DISABLE: "1",
    OPENCODE_SERVER_PASSWORD: input.password,
  };
  for (const [key, value] of Object.entries(childEnv)) {
    if (value === undefined) delete childEnv[key];
  }
  return childEnv;
};

const stopSpawned = async (
  proc: ReturnType<typeof Bun.spawn>,
  pumps: Promise<unknown>,
): Promise<void> => {
  proc.kill();
  const exited = await Promise.race([
    proc.exited.then(() => true),
    Bun.sleep(2000).then(() => false),
  ]);
  if (!exited) {
    proc.kill("SIGKILL");
    await Promise.race([proc.exited, Bun.sleep(1000)]);
  }
  await Promise.race([pumps, Bun.sleep(500)]);
};

export const startLive = async (input: {
  readonly directory: string;
  readonly configDir: string;
  readonly pluginDir?: string;
  readonly model: string;
  readonly extraConfig?: Readonly<Record<string, unknown>>;
  readonly env?: Readonly<Record<string, string | undefined>>;
}): Promise<Live> => {
  await Bun.write(`${input.configDir}/opencode.json`, buildLiveConfig(input));

  const password = crypto.randomUUID();
  const port = Bun.env.SPECTRE_EVAL_LIVE_PORT ?? "0";
  const proc = Bun.spawn(["opencode", "serve", "--port", port, "--log-level", "info", "--print-logs"], {
    cwd: input.directory,
    env: buildLiveEnv({ configDir: input.configDir, password, env: input.env }),
    stdout: "pipe",
    stderr: "pipe",
  });

  let seen = "";
  const decoder = new TextDecoder();
  const pump = async (source: ReadableStream<Uint8Array>) => {
    const reader = source.getReader();
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) return;
      seen += decoder.decode(chunk.value, { stream: true });
    }
  };
  const pumps = Promise.all([pump(proc.stdout), pump(proc.stderr)]);

  let stopped = false;
  const stop = async () => {
    if (stopped) return;
    stopped = true;
    await stopSpawned(proc, pumps);
  };

  const abort = async (why: string): Promise<never> => {
    await stop();
    throw new Error(`${why}\n${seen}`);
  };

  let assigned: number | undefined;
  for (let attempt = 0; attempt < 60; attempt++) {
    const match = seen.match(LISTENING);
    if (match?.[1] !== undefined) {
      assigned = Number(match[1]);
      break;
    }
    await Bun.sleep(100);
  }
  if (assigned === undefined) return abort("the live server did not start");

  const client = connect(input.directory, `http://127.0.0.1:${assigned}`, password);
  let models: Awaited<ReturnType<Opencode["models"]>> | undefined;
  let failure: unknown;
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      models = await client.models();
      break;
    } catch (cause) {
      failure = cause;
      await Bun.sleep(300);
    }
  }
  if (models === undefined)
    return abort(
      `the live server did not answer: ${failure instanceof Error ? failure.message : String(failure)}`,
    );

  const [providerID, rest] = input.model.split("/");
  const [id, variant] = (rest ?? "").split("#");
  const known = models.some(
    (model) =>
      model.providerID === providerID &&
      model.id === id &&
      (variant === undefined || model.variants.some((one) => one.id === variant)),
  );
  if (!known)
    return abort(
      `the live model "${input.model}" is not in the catalogue. Providers: ${[...new Set(models.map((model) => model.providerID))].join(", ")}`,
    );

  return {
    client,
    model: input.model,
    logs: async () => seen,
    stop,
  };
};
