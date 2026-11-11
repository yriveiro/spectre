import { Opencode } from "../opencode";
import { REPO } from "./docker";

const PASSWORD = "spectre-eval";

export type Live = {
  readonly client: Opencode;
  readonly model: string;
  readonly logs: () => Promise<string>;
  readonly stop: () => Promise<void>;
};

/**
 * The Console-managed providers do not cross into the Docker container, but they
 * work in a host server. This mode starts that server with a temporary config
 * directory that names this checkout and nothing else, so the global config's
 * published plugin cannot win the id. The auth and the data directory stay the
 * host's, which is what makes the model reachable.
 */
export const startLive = async (input: {
  readonly workspace: string;
  readonly configDir: string;
  readonly model: string;
}): Promise<Live> => {
  await Bun.write(
    `${input.configDir}/opencode.json`,
    `${JSON.stringify({ update: "disable", plugins: [REPO], experimental: {} }, null, 2)}\n`,
  );

  const port = Number(Bun.env.SPECTRE_EVAL_LIVE_PORT ?? 14099);
  const proc = Bun.spawn(["opencode", "serve", "--port", String(port), "--log-level", "info", "--print-logs"], {
    cwd: input.workspace,
    env: {
      ...Bun.env,
      OPENCODE_CONFIG_DIR: input.configDir,
      OPENCODE_SERVER_PASSWORD: PASSWORD,
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

  const client = new Opencode(input.workspace, `http://127.0.0.1:${port}`, PASSWORD);
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
  if (models === undefined) {
    proc.kill();
    await pumps;
    throw new Error(
      `the live server did not answer: ${failure instanceof Error ? failure.message : String(failure)}\n${seen}`,
    );
  }

  const [providerID, rest] = input.model.split("/");
  const [id, variant] = (rest ?? "").split("#");
  const known = models.some(
    (model) =>
      model.providerID === providerID &&
      model.id === id &&
      (variant === undefined || (model.variants ?? []).some((one) => one.id === variant)),
  );
  if (!known) {
    proc.kill();
    await pumps;
    throw new Error(
      `the live model "${input.model}" is not in the catalogue. Providers: ${[...new Set(models.map((model) => model.providerID))].join(", ")}`,
    );
  }

  return {
    client,
    model: input.model,
    logs: async () => seen,
    stop: async () => {
      proc.kill();
      await Promise.race([pumps, Bun.sleep(2000)]);
    },
  };
};
