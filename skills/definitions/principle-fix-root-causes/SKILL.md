Fix the cause. Never the symptom.

A symptom is a report from somewhere else. The crash, the wrong value, the flake that passes on retry: each is the system telling you something upstream is wrong, and a patch at the site of the report leaves the wrongness in place. It will report again, from a different site, on a worse day, and the second report will cite the first patch as the reason nobody looked further.

Without this, code fills with guards. Each guard is reasonable alone: a nil check here, a retry there, a special case for the input that broke last month. Together they are a second system, one that encodes every past failure as a permanent branch, and nobody can remove any branch because nobody remembers which failure it encodes. A workaround that needs a paragraph of comment to justify is the code telling you it is wrong. Listen.

Reproduce first. A failure you have not reproduced is a story, and stories get fixed with stories. Reproduce it somewhere that cannot damage the real thing, then ask why, and keep asking until the answer is a defect you can point at rather than a condition you can guard against. Five whys is a ritual; one genuine why, followed honestly, usually reaches the cause. The cause is the place where the fix removes code instead of adding it: the invariant restored, the caller corrected, the assumption deleted. If your patch adds a branch, you have not arrived yet.

The moment is the candidate patch. You hold a change that would make the symptom stop, and the question is whether it makes the cause stop too. A guard at the crash site, a default for the bad value, a retry around the flake: each silences the report. Apply the patch at the cause and the whole class of reports ends.

Reproducing the failure before diagnosing it is `principle-verification`. Deciding which layer the fix belongs in once the cause is known is `principle-boundary-discipline`.

Adapted from pstack (MIT, Lauren Tan).
