import { progress, type Progress } from "./progress";

export type ModelStatus = {
  ref: string;
  done: number;
  total: number;
  failed: number;
  hitRate?: number;
  finished: boolean;
};

export type Status = {
  startedAt: string;
  updatedAt: string;
  running: boolean;
  rows: number;
  models: ReadonlyArray<ModelStatus>;
};

export type Reporter = {
  say(line: string): void;
  bar(label: string, total: number): Progress;
  setResult(ref: string, hitRate: number): void;
  status(): Status;
  close(running: boolean): void;
  logPath: string;
  statusPath: string;
};

const LOG = Bun.env.SPECTRE_EVAL_LOG ?? "eval/last-run.log";
const STATUS = Bun.env.SPECTRE_EVAL_STATUS ?? "eval/last-run.json";

/**
 * A background run is only observable if it writes somewhere the reader can look
 * without asking the process. Two files, both synchronous: `last-run.log` for the
 * transcript and `last-run.json` for where it got to. Synchronous on purpose,
 * because a buffered async writer loses exactly the tail you want when the run
 * is killed, and the tail is where a failure reason lives.
 */
export const reporter = (options?: { logPath?: string; statusPath?: string }): Reporter => {
  const logPath = options?.logPath ?? LOG;
  const statusPath = options?.statusPath ?? STATUS;
  // The writer opens eagerly and fails on a missing parent, so a log path in a
  // directory that does not exist yet is a crash before any work is reported.
  for (const dir of new Set([logPath, statusPath].map((p) => p.split("/").slice(0, -1).join("/"))))
    if (dir !== "") Bun.spawnSync(["mkdir", "-p", dir]);
  const sink = Bun.file(logPath).writer();
  const tty = Boolean(process.stdout.isTTY);
  const models: Array<ModelStatus> = [];
  const startedAt = new Date().toISOString();

  const write = (line: string) => {
    sink.write(`${line}\n`);
    sink.flush();
    process.stdout.write(tty ? line : `${line}\n`);
  };

  const snapshot = (running: boolean): Status => ({
    startedAt,
    updatedAt: new Date().toISOString(),
    running,
    rows: models[0]?.total ?? 0,
    models: models.map((m) => ({ ...m })),
  });

  const publish = (running: boolean) => {
    Bun.write(statusPath, `${JSON.stringify(snapshot(running), null, 2)}\n`);
  };

  return {
    logPath,
    statusPath,
    say: write,
    bar: (label: string, total: number) => {
      const entry: ModelStatus = { ref: label, done: 0, total, failed: 0, finished: false };
      models.push(entry);
      const reasons = new Set<string>();
      const bar = progress({ label, total, tty });
      return {
        advance: (note?: string) => {
          bar.advance();
          entry.done += 1;
          // A run that fails every row should say why within seconds, not after
          // the final table, so the first few distinct reasons are announced as
          // they happen and the count alone never has to be interpreted.
          if (note !== undefined && reasons.size < 4 && !reasons.has(note)) {
            reasons.add(note);
            write(`    ! ${label}: ${note}`);
          }
          publish(true);
        },
        fail: (note?: string) => {
          bar.fail(note);
          entry.failed += 1;
        },
        finish: (note?: string) => {
          entry.finished = true;
          publish(true);
          return bar.finish(note);
        },
      };
    },
    setResult: (ref, hitRate) => {
      const entry = models.find((m) => m.ref === ref);
      if (entry === undefined) return;
      entry.hitRate = hitRate;
      publish(true);
    },
    status: () => snapshot(true),
    close: (running: boolean) => {
      sink.end();
      publish(running);
    },
  };
};
