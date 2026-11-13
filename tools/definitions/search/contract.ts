export interface Contract {
  readonly rule: string;
  readonly search: string;
  readonly ripgrep: string;
  readonly sentinel: string;
}

export const CONTRACT: Contract = {
  rule: `# Code search
A search for code is \`spectre_search\`, not \`ripgrep\`. It answers a question or a
literal with the enclosing symbol, and it ranks what to read first. \`ripgrep\` is
for plain text: logs, docs prose, fixture data, lock files. A code-shaped
\`ripgrep\` call is answered by \`spectre_search\` once, and the answer says so.`,
  search: `Find code: the symbol, the definition, the call sites, or the rank of
what to read first. One call, and it answers with the enclosing symbol and its
call graph, which a line match cannot. \`status\` says what the answer is worth:
answered, empty, partial, absent, refused. Use \`ripgrep\` for plain text.`,
  ripgrep: `Search PLAIN TEXT — logs, docs prose, fixture data, lock files, and
any file the code index does not hold. It takes ripgrep's regular expression
syntax or literal text matching. For a symbol, a definition, a call site, or
"where is this implemented", call \`spectre_search\` first.`,
  sentinel: `[spectre_search] this ripgrep was a code search, so spectre_search answered it.`,
};

/** The nudge the context part carries once the tree holds an unmeasured edit. */
export const END_OF_WORK = `This session holds edits and no measurement since the last one. Before the change lands, run \`ripwire . --quality-delta\` and \`ripwire . --affected=\` with the paths you edited. The landing gate refuses the first commit, push or PR until both ran after the last mutation.`;

/** The install line the absent answer carries, quoted from the ripwire README. */
export const INSTALL = `RIPWIRE_REPO=redhat-et/ripwire bash -c "$(curl -fsSL https://raw.githubusercontent.com/redhat-et/ripwire/main/scripts/install.sh)"`;

/** The read gate's one refusal: name the instrument, then let the second call through. */
export const readRefusal = (path: string): string => `\`${path}\` is a code file, and this session has not searched the code index yet. Ask \`spectre_search\` first: a \`query\` for a question, a \`pattern\` for a symbol. Re-issue the read if the symbol's body is still what you need, because this gate refuses once.`;

/** The landing gate's one refusal: the two commands it watched for, and the paths it watched. */
export const landRefusal = (paths: ReadonlyArray<string>): string => {
  const affected = paths.length === 0 ? "." : [...paths].sort().join(",");
  return `This change cannot land yet: the tree holds edits and neither measurement ran against them. Run \`ripwire . --quality-delta\` and \`ripwire . --affected=${affected}\`, then re-issue the command. The gate checks that both commands ran after the last mutation, and it refuses once.`;
};
