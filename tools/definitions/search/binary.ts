/**
 * The ripwire binary to call. `SPECTRE_RIPWIRE` wins over `Bun.which`, so a
 * test or a pinned install can hand the plugin its binary without touching
 * PATH.
 */
export const binaryOf = (): string | null => {
  const env = Bun.env.SPECTRE_RIPWIRE;
  if (env !== undefined && env !== "") return env;
  return Bun.which("ripwire");
};
