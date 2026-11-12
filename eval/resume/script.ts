import type { MockStep, Scenario } from "./scenario";

/** The subset of an OpenAI chat message the mock reads. */
export type Message = {
  readonly role?: string;
  readonly content?: unknown;
  readonly tool_calls?: ReadonlyArray<unknown>;
};

export const textOf = (message: Message): string => {
  if (typeof message.content === "string") return message.content;
  if (Array.isArray(message.content))
    return message.content
      .map((part) =>
        typeof part === "object" && part !== null && "text" in part
          ? String((part as { text?: unknown }).text ?? "")
          : "",
      )
      .join("\n");
  return "";
};

/**
 * The host prefixes a new child's prompt with this line. It is in the user
 * message, not the system prompt, and a resumed child keeps it from the first
 * turn. The parent never carries it.
 */
export const isChild = (messages: ReadonlyArray<Message>): boolean =>
  messages.some((message) =>
    textOf(message).includes("You are a subagent spawned by another session."),
  );

export const lastUser = (messages: ReadonlyArray<Message>): string => {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (message?.role === "user") return textOf(message);
  }
  return "";
};

/**
 * The first child id the parent has seen. The host writes it into the tool
 * result as `<subagent sessionID="ses_...">`, and into `metadata.sessionID` on
 * the part. The mock only sees the wire form, so it reads the text.
 */
export const firstChild = (messages: ReadonlyArray<Message>): string | undefined => {
  for (const message of messages) {
    if (message.role !== "tool") continue;
    const match = textOf(message).match(/sessionID="([^"]+)"/);
    if (match?.[1] !== undefined) return match[1];
  }
  return undefined;
};

/** Replace `$firstChild` in the scripted input, so a step can name the child. */
export const resolveInput = (
  input: Readonly<Record<string, unknown>>,
  child: string | undefined,
): Readonly<Record<string, unknown>> =>
  JSON.parse(JSON.stringify(input).replaceAll("$firstChild", child ?? "")) as Readonly<
    Record<string, unknown>
  >;

/**
 * The first step for this side whose `when` appears in the last user message.
 * A missing step is `undefined`, and the server answers a plain text reply, so a
 * mistake in the fixture is visible in the transcript rather than a hang.
 */
export const pickStep = (
  scenario: Scenario,
  messages: ReadonlyArray<Message>,
): MockStep | undefined => {
  const role = isChild(messages) ? "child" : "parent";
  const user = lastUser(messages);
  return scenario.mock.find((step) => step.role === role && user.includes(step.when));
};
