export type Catalogue = {
  readonly ours: ReadonlyArray<string>;
  readonly registered?: ReadonlyArray<string>;
};

const GLOBAL = "~/.config/opencode/opencode.jsonc";

/**
 * The check exists because a stale copy is invisible from the inside. Measured:
 * with `github:yriveiro/spectre` still in the global config, the first copy in
 * boot order wins the plugin id and this working tree never runs, so the eval
 * grades the published plugin while appearing to grade this one. Three leaves
 * added here were simply absent from the session.
 *
 * `Registered skills` is the only statement of what the plugin contributed that
 * is not our own code saying so, and it is an info line, so the server is booted
 * with `--log-level info`. It also only appears once a session exists, so the
 * caller must create one before reading it.
 *
 * `GET /api/skill` agrees with the log, so it is the cheaper of the two to poll,
 * but it answers 200 with the global catalogue on a fresh server, so an empty
 * first read is not evidence of anything.
 */
export type Source = "log" | "route" | "none";

/**
 * The check exists because a stale copy is invisible from the inside. Measured:
 * with `github:yriveiro/spectre` still in the global config, the first copy in
 * boot order wins the plugin id and this working tree never runs, so the eval
 * grades the published plugin while appearing to grade this one. Three leaves
 * added here were simply absent from the session.
 *
 * `Registered skills` is the only statement of what the plugin contributed that
 * is not our own code saying so, and it is an info line, so the server is booted
 * with `--log-level info`. It also only appears once a session exists. The
 * `route` source is the weaker fallback: `/api/skill` answers with the global
 * catalogue on a fresh project, so it is only trusted once it carries one of our
 * ids, and the result says which source was used.
 */
export const verify = (
  registered: ReadonlyArray<string> | undefined,
  ours: ReadonlyArray<string>,
  source: Source = "log",
) => {
  if (registered === undefined || registered.length === 0)
    return [
      "OpenCode never reported which skills it registered, so there is no proof the plugin loaded. " +
        "Refusing to score: the model would be graded against a catalogue nobody confirmed it was given.",
    ];

  const missing = ours.filter((id) => !registered.includes(id));
  if (missing.length === 0) return [];

  const extra = registered.filter((id) => !ours.includes(id));
  if (extra.length === 0)
    return [
      `OpenCode registered ${registered.length} of our ${ours.length} skills (source: the ${source}), ` +
        `missing ${missing.join(", ")}.`,
      "That is the shape of a second copy of the plugin winning the id, which means this working tree",
      `never ran. Delete the "plugins": ["github:yriveiro/spectre"] line from ${GLOBAL} while developing.`,
    ];

  return [
    `OpenCode registered without these, so they were never offered: ${missing.join(", ")}`,
    `and offered these we do not define: ${extra.join(", ")}`,
    `The offered set looks like the global catalogue, so the plugin has not loaded in this project yet. ` +
      `Source used: the ${source}.`,
  ];
};
