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
