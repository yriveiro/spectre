import type { TokenUsageInfo } from "@opencode/client";

/**
 * A token-usage block for a message fixture. Two suites each rolled this,
 * and `ripwire --quality-delta` grouped them as a clone: the cost of the
 * second copy. Defaults keep a one-number call ("input only") honest for
 * the suites that do not care about the rest.
 */
export const tokenUsage = (
  input: number,
  output = 0,
  reasoning = 0,
  read = 0,
  write = 0,
): TokenUsageInfo => ({ input, output, reasoning, cache: { read, write } });
