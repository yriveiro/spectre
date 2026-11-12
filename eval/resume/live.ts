import { Opencode } from "../opencode";

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
export const startLive = async (input: {
  readonly directory: string;
  readonly configDir: string;
  readonly pluginDir: string;
  readonly model: string;
}): Promise<Live> => {
  await Bun.write(
    `${input.configDir}/opencode.json`,
    `${JSON.stringify({ update: "disable", plugins: [input.pluginDir], experimental: {} }, null, 2)}\n`,
  );

  const password = crypto.randomUUID();
  const port = Bun.env.SPECTRE_EVAL_LIVE_PORT ?? "0";
  const proc = Bun.spawn(["opencode", "serve", "--port", port, "--log-level", "info", "--print-logs"], {
    cwd: input.directory,
    env: {
      ...Bun.env,
      OPENCODE_CONFIG_DIR: input.configDir,
      OPENCODE_CONFIG_PROJECT_DISABLE: "1",
      OPENCODE_SERVER_PASSWORD: password,
    },
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

  const stop = async () => {
    proc.kill();
    await Promise.race([pumps, Bun.sleep(2000)]);
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

  const client = new Opencode(input.directory, `http://127.0.0.1:${assigned}`, password);
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
      (variant === undefined || (model.variants ?? []).some((one) => one.id === variant)),
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
