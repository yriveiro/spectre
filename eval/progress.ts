export type Clock = () => number;

export type Options = {
  readonly label: string;
  readonly total: number;
  readonly tty?: boolean;
  /** Rows between lines when stdout is not a terminal. */
  readonly every?: number;
  readonly now?: Clock;
};

export type Progress = {
  advance(note?: string): void;
  fail(note?: string): void;
  finish(note?: string): string;
};

export const seconds = (ms: number) => {
  const total = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(total / 60);
  return `${minutes}m${String(total % 60).padStart(2, "0")}s`;
};

/**
 * One line, rewritten in place on a terminal. When stdout is a pipe a carriage
 * return is invisible and the buffer does not flush, so a run that takes ten
 * minutes looks like a hang. In that case the line is written newline
 * terminated every `every` rows instead, which flushes and leaves a readable
 * trail in a log.
 */
export const progress = (options: Options): Progress => {
  const now = options.now ?? Date.now;
  const tty = options.tty ?? Boolean(process.stdout.isTTY);
  const every = options.every ?? 5;
  const width = options.label.length + 40;
  const start = now();
  let done = 0;
  let failed = 0;

  const render = () => {
    const elapsed = now() - start;
    const rate = done === 0 ? 0 : (done * 1000) / Math.max(1, elapsed);
    const eta = rate === 0 ? seconds(0) : seconds(((options.total - done) * 1000) / rate);
    return (
      `  ${options.label} ${String(done).padStart(3)}/${options.total}` +
      `  ${seconds(elapsed).padStart(7)}  ${rate.toFixed(1).padStart(4)}/s  eta ${eta.padStart(7)}` +
      (failed > 0 ? `  ${failed} failed` : "")
    );
  };

  const emit = (line: string) => {
    if (tty) process.stdout.write(`${line}\r${" ".repeat(width)}`);
    else process.stdout.write(`${line}\n`);
  };

  const finish = (note = "") => {
    const line = `${render()}${note === "" ? "" : `  ${note}`}`;
    // The final write returns to column 0 so a shorter summary cannot leave the
    // tail of the in-place line showing, then terminates the line itself.
    process.stdout.write(tty ? `\r${line}\n` : `${line}\n`);
    return line;
  };

  return {
    advance: () => {
      done += 1;
      if (tty || done % every === 0 || done === options.total) emit(render());
    },
    fail: (note) => {
      failed += 1;
      if (tty && note !== undefined) process.stdout.write(` [${note}]`);
    },
    finish,
  };
};

export type Plan = { readonly models: number; readonly rows: number; readonly concurrency: number };

/**
 * The scale, before the first request. A run of nine models over a corpus is
 * minutes of waiting, and a reader who cannot see the plan has no way to tell a
 * slow run from a stuck one.
 */
export const plan = (p: Plan) => {
  const requests = p.models * p.rows;
  return (
    `  ${requests} requests: ${p.models} model${p.models === 1 ? "" : "s"} x ${p.rows} rows` +
    `, concurrency ${p.concurrency}`
  );
};
