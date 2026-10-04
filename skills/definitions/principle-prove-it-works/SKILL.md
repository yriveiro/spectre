# Principle: Prove It Works

"It compiles" is not "it works." A green build proves the types align. A
passing unit test proves a function behaves in isolation. A tool's own report
proves the tool ran. None of them proves the person on the other end can do the
thing, and the distance between the stand-in and the artifact is where the
bugs live: the page that renders and shows the wrong data, the binary that
builds and fails on launch, the migration that applies cleanly to an empty
database and destroys a full one.

So the test is short: check the real thing, not something standing in for it.
Before saying done, touch the surface the person will touch. Open the rendered
page and read what it says. Run the binary you built. Exercise the path a
stranger takes, with the data they will bring. If the check you ran could pass
while the artifact is broken, it was a rehearsal.

Without this the work ships confidence instead of software. Each proxy feels
like evidence, and stacked together they feel conclusive, so the one check that
would have caught the failure never runs. The failure is then found by whoever
is least equipped to diagnose it, usually a customer, and the report describes
a symptom rather than a cause.

`principle-verification` owns the rule about what you are entitled to claim, and
`principle-evidence` owns obtaining the proof at all. This leaf owns the
narrowest of the three questions: which surface did you check, and was it the
one that ships.

## The moves

**Ask whether the check could pass while the artifact is broken.** If yes, it
was a rehearsal, and the number of green proxies in front of you is not
evidence. It is cover.

**Open the rendered thing and read what it says.** A page, a CLI invocation, a
notification, a generated file. Read the words on it, not the fact that it
loaded.

**Read the bytes the artifact emits, not the exit code.** A command can exit 0
having written the wrong thing to stdout while its log line reads correctly, and
a page can return the right status with an empty body. Whichever stream the
person reads is the one you check, and the other one is a place the two halves
can disagree.

**Run the binary you built.** Not the script, not the source, not `tsc` over it.
The packaged artifact, the way the person installs it.

**Check from a clean state, not from yours.** A warm dev server, a populated
database, an uncommitted `.env.local`, a branch with two local commits: each
one removes a condition the artifact will meet without. A fresh install and an
empty store are where the missing case shows up, and they cost one command.

**Cross the seam where two systems meet.** A test per side is two proxies, and
the failure lives in the agreement between them: the field one writes and the
other ignores, the status both define, the timestamp one truncates. The check
has to run the whole way through, or it is measuring each half of the thing
that is broken.

**Exercise the path a stranger takes, with the data they will bring.** The
empty state, the long name, the second locale, the record from last year, the
slow network. Your fixtures were chosen because they work.

**A stub proves the call, not the answer.** A handler that returns a
hand-written body passes against a service nobody ever reached. Where the
dependency can be reached, reach it. Where it cannot, say in the report that
the check ran against a double and what that leaves unverified.

**Read the log line and check that it names the value you expect.** "Server
started on port 3000" proves a process is listening. The line has to carry the
thing you are claiming, or you checked the port and not the behaviour.

**Do not use the typecheck as a behaviour check.** `tsc` proves assignability. A
handler that returns the right type and the wrong value is a passing build, and
only reading that value catches it.

**Take the screenshot after the change, from a fresh load.** A stale dev
server, a cached render, a story fixture, a service worker: the image is a
picture of the previous build. Restart the server, hard reload, clear the cache,
then look.

**Read the file the person will open, not the one you wrote.** The README, the
error message, the config sample, the migration, the manifest. A document that
contradicts the code passes every check in the repository.

**Check on the platform it ships to.** The pinned runtime, the architecture,
the container, the browser, the version floor. A check on your machine is a
check of your machine, and the bug report will say so.

**Exercise the failure path against the real thing.** A happy path against a
live dependency is the easy half. The 500, the timeout, the empty result, the
partial write, the retry after a crash: those are the paths nobody runs and the
ones that page you.

**Replay the original input against the fix.** A test written after the change
passes by construction, because it was written from the same model of the
behaviour that produced the bug. The reproduction is the one piece of evidence
that predates your theory.

**Name the stand-in in the report when the artifact cannot be reached.** "Verified
against a local fixture, not against staging" is a complete sentence. An
unnamed stand-in reported as a check is the failure this leaf is about.

## What this principle is not

- **Not an instruction to check everything at full cost.** The cost scales with
  the blast radius. A rename nobody can reach through a surface does not need a
  deployed run. The question is only whether a proxy could be green while this
  change is broken.
- **Not a check on a copy of the artifact.** A `dist` rebuilt but never served,
  a fixture copied from real data, a schema validated against a hand-written
  twin: each is the artifact's copy, and a copy drifts without failing.
- **Not evidence about a path nobody walked.** A module that loads is not a
  function that works. Loading the entry point proves the entry point, and the
  report should say which path was actually taken.
