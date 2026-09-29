Hand work does not rerun. When the job is non-trivial, build the thing that does the job: a codemod, a script, a generator, or a delegated skill. Then run it, and keep it in the diff.

Editing by hand across many sites feels fast at the start. It drifts by site five. Site seven differs from site two in a way nobody intended, and review cannot separate intent from accident because every site was a separate decision. Then the pass must run again: a new case, a renamed API, a second wave, and the whole cost is charged a second time. The hand edit is write-only work. It is cheap to produce, expensive to repeat, and impossible to verify as a set.

**Build the rerunnable thing first.** Name the transformation, encode it, run it everywhere at once. The diff then shows the tool and its output, and intent is reviewable in one place instead of scattered across forty.

**Keep the lever in the diff.** A script run from memory and deleted after is hand work with extra steps. The codemod, the generator, the delegated skill: each must survive in the change so the next pass costs nothing.

That is the test. If you cited a file and the diff holds no codemod, script, generator, or delegate skill, you did not apply this. The question to ask is: could a stranger rerun this pass tomorrow without me?

Reach for this when the work touches more than a couple of sites, or when you will run the same pass twice. A touch-up to code you are already editing is principle-hygiene: clean it and move on, no tooling required. A lesson that must survive beyond one run, stated as prose, belongs to principle-encode-lessons-in-structure, which puts it where prose cannot decay. This skill owns the batch: repeated mechanical work that a machine should carry.

Hand work is a loan against the next pass. Build the lever and pay once.

Adapted from pstack (MIT, Lauren Tan).
