import { Opencode } from "../opencode";

/** The repo root, from `eval/resume/`. The URL resolution drops the `..`. */
export const REPO = new URL("../../", import.meta.url).pathname;

export const IMAGE = Bun.env.SPECTRE_EVAL_IMAGE ?? "spectre-eval:2.2.7";

export const ensureImage = async (build: boolean): Promise<void> => {
  if (!(await Bun.file(`${REPO}/node_modules/effect/package.json`).exists()))
    throw new Error(`${REPO}: run bun install first, the plugin's dependencies are not there`);

  const found = await Bun.$`docker image inspect ${IMAGE}`.nothrow().quiet();
  if (!build && found.exitCode === 0) return;

  const built =
    await Bun.$`docker build -t ${IMAGE} -f ${REPO}/docker/Dockerfile ${REPO}/docker`.nothrow().quiet();
  if (built.exitCode !== 0)
    throw new Error(`docker build ${IMAGE} failed:\n${built.stderr.toString()}${built.stdout.toString()}`);
};

export type Running = {
  readonly client: Opencode;
  readonly name: string;
  readonly hostPort: number;
  readonly logs: () => Promise<string>;
  readonly stop: () => Promise<void>;
};

const portOf = async (name: string): Promise<number | undefined> => {
  const out = await Bun.$`docker port ${name} 14096/tcp`.nothrow().quiet();
  if (out.exitCode !== 0) return undefined;
  const match = out.stdout.toString().match(/:(\d+)\s*$/m);
  const port = match?.[1] === undefined ? undefined : Number(match[1]);
  return port === undefined || Number.isNaN(port) ? undefined : port;
};

const config = (baseURL: string): string =>
  `${JSON.stringify(
    {
      $schema: "https://opencode.ai/config.json",
      update: "disable",
      plugins: ["/plugin"],
      provider: {
        mock: {
          name: "Mock",
          npm: "@ai-sdk/openai-compatible",
          options: {
            baseURL: `${baseURL}/v1`,
            apiKey: "mock",
          },
          models: {
            resume: { name: "Resume", tool_call: true },
          },
        },
      },
      experimental: {},
    },
    null,
    2,
  )}\n`;

/**
 * Start the provided server image with three mounts: the checkout at `/plugin`,
 * the run's workspace at `/workspace`, and a generated global config at
 * `/root/.config/opencode/opencode.json`. The config points the custom provider
 * at the mock on the host, so no credential enters the container.
 *
 * The image's own `opencode.json` pointed at the published plugin. The mount
 * replaces it with this checkout, which is the whole point of the run.
 */
export const start = async (input: {
  readonly workspace: string;
  readonly configDir: string;
  readonly mockBaseURL: string;
}): Promise<Running> => {
  const name = `spectre-eval-${crypto.randomUUID().slice(0, 8)}`;
  await Bun.write(`${input.configDir}/opencode.json`, config(input.mockBaseURL));

  const run =
    await Bun.$`docker run -d --rm --name ${name} --add-host=host.docker.internal:host-gateway -p 127.0.0.1::14096 -v ${REPO}:/plugin:ro -v ${input.workspace}:/workspace -v ${input.configDir}/opencode.json:/root/.config/opencode/opencode.json:ro -e OPENCODE_SERVER_PASSWORD=opencode-test ${IMAGE} serve --hostname 0.0.0.0 --port 14096 --log-level info --print-logs`
      .nothrow()
      .quiet();
  if (run.exitCode !== 0)
    throw new Error(`docker run failed:\n${run.stderr.toString()}${run.stdout.toString()}`);

  let hostPort: number | undefined;
  for (let attempt = 0; attempt < 20; attempt++) {
    hostPort = await portOf(name);
    if (hostPort !== undefined) break;
    await Bun.sleep(250);
  }
  if (hostPort === undefined) {
    await Bun.$`docker rm -f ${name}`.nothrow().quiet();
    throw new Error(`${name}: no host port was published for 14096`);
  }

  const client = new Opencode("/workspace", `http://127.0.0.1:${hostPort}`, "opencode-test");

  // The port is published before the server binds, and the first request can be
  // reset by the proxy. Retry the whole read, not only the empty answer.
  let models: Awaited<ReturnType<Opencode["models"]>> | undefined;
  let failure: unknown;
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      models = await client.models();
      break;
    } catch (cause) {
      failure = cause;
      await Bun.sleep(300);
    }
  }
  if (models === undefined) {
    const logs = await Bun.$`docker logs ${name}`.nothrow().quiet();
    await Bun.$`docker rm -f ${name}`.nothrow().quiet();
    throw new Error(
      `${name}: the server did not answer: ${failure instanceof Error ? failure.message : String(failure)}\n${logs.stdout.toString()}${logs.stderr.toString()}`,
    );
  }
  if (!models.some((model) => model.providerID === "mock" && model.id === "resume")) {
    await Bun.$`docker rm -f ${name}`.nothrow().quiet();
    throw new Error(
      `${name}: the mock model is not in the catalogue. Providers: ${[...new Set(models.map((model) => model.providerID))].join(", ")}`,
    );
  }

  return {
    client,
    name,
    hostPort,
    logs: async () => {
      const out = await Bun.$`docker logs ${name}`.nothrow().quiet();
      return `${out.stdout.toString()}${out.stderr.toString()}`;
    },
    stop: async () => {
      await Bun.$`docker rm -f ${name}`.nothrow().quiet();
    },
  };
};
