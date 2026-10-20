/**
 * The bar the blind slice is held to. A row that quotes the description of the
 * leaf it names is not a held-out row: the leaf wins it by carrying the words,
 * not by routing the moment. Four rows of the legacy held-out slice drifted
 * inside a description that way, which is why the number it reads is no longer
 * the honest one.
 */
export const MAX_SHARED_RUN = 3;

export const words = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 0);

/** The longest run of consecutive words two texts share. */
export const longestRun = (a: ReadonlyArray<string>, b: ReadonlyArray<string>) => {
  let longest = 0;
  for (let i = 0; i < a.length; i++)
    for (let j = 0; j < b.length; j++) {
      let run = 0;
      while (i + run < a.length && j + run < b.length && a[i + run] === b[j + run]) run++;
      if (run > longest) longest = run;
    }
  return longest;
};

/** Whether a prompt carries a run of the description it should not carry. */
export const overBar = (
  prompt: string,
  description: string,
  limit: number = MAX_SHARED_RUN,
): number => longestRun(words(prompt), words(description));

/** The id or ids a row may be scored against. */
export const permitted = (label: string) =>
  label === "none" ? ["none"] : label.split(",").map((one) => one.trim());

export type Offence = { readonly prompt: string; readonly id: string; readonly shared: number };

/** Every (row, label) pair whose prompt shares more than the limit with the description. */
export const offences = (
  rows: ReadonlyArray<{ prompt: string; label: string }>,
  descriptions: ReadonlyMap<string, string>,
  limit: number = MAX_SHARED_RUN,
): ReadonlyArray<Offence> =>
  rows
    .filter((row) => row.label !== "none")
    .flatMap((row) => {
      return permitted(row.label).flatMap((id) => {
        const shared = overBar(row.prompt, descriptions.get(id) ?? "", limit);
        return shared > limit ? [{ prompt: row.prompt, id, shared }] : [];
      });
    });
