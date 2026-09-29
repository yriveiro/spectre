# Principle: Migrate Callers Then Delete Legacy APIs

When the new API is the right design, the old one goes away, and no commit in
between leaves a tree where nobody can say which path is live. The migration can
be five commits or fifty. What it cannot be is a commit that leaves half of it
done.

The failure this names is a codebase that grows two ways to do one thing. Each
path looks reasonable on its own, so neither gets deleted, and every later reader
has to work out which one the code should be using and what happens if the answer
is wrong. The two paths then diverge, because every fix lands on the one the
author happened to be reading. That is dual-path complexity, and it is what makes a
codebase feel append-only rather than finished.

The rule has one precondition and it is the whole rule: nobody outside this
repository depends on the old name. Where a caller exists that you cannot see, the
deletion is not hygiene, it is a breaking change, and it needs a version and a
release note.

Laziness still applies, and this principle narrows it rather than overriding it.
`principle-laziness-protocol` asks for the smallest change that solves the
problem, and a migration in fifty commits is fifty small changes, each one
solving a piece, each one reviewable on its own. The thing laziness cannot buy
is a commit that is not finished. "Delete later" is the expensive move, because
later is a commit nobody writes, and the tree stays forked until then.

## The moves

**Split the migration by caller, not by file.** Each commit moves one caller
group and leaves the tree working. The old path stays until the last caller moves,
and that last commit deletes it. This keeps every diff small enough to read while
leaving no commit in a state where neither path is the answer.

**Name the surface before you decide anything.** Internal means every caller is in
this repository. Published means it sits in the package's `exports` map, or in a
released version, or behind a URL somebody fetches. The rule only holds on the
internal side. In this repository `exports["."]` is published and everything under
it is not, so the line is one file to read.

**Write the caller list down before you write the new path.** `ripwire --callers
<symbol>` or `--whereis`. That list is also the commit plan, so it is worth having
before the code rather than after. A migration whose caller list is written after
the new code is a migration that guessed, and the guess shows up as a broken call
in a branch nobody is watching.

**Delete the old path in the commit that empties it.** The last caller moves and
the deletion lands together, because after that commit nothing reaches the old
path and it is dead code, which is `principle-hygiene`. A deletion scheduled for a
later commit is the one that does not happen.

**Delete the adapter, the flag, and the deprecation comment with it.** A
`TODO: remove in v3` on a thing with no external caller is a promise addressed to a
codebase that will not read it. Either the migration ends with the deletion or the
adapter was not needed.

**Name the external caller and the date, or drop the adapter.** "Temporary" with no
consumer named and no date attached is not time-boxed. It is permanent with a
comment on it, which is the worst of the two.

**Rewrite the tests to assert the new contract, and delete the ones that only pin
the old shape.** A test that calls the old API keeps the old API alive, because
the test is a caller nobody inventoried. A test that asserts a field the new
design removed asserts something that no longer exists.

**Run the check that fails when a caller is left behind.** `ripwire --callers` on
the old name, then the typecheck. A missed caller is a compile error, which is the
cheapest report you can get, so take it before the change is reviewed rather than
after.

## What this principle is not

- **Not a licence to break a published contract.** The `exports` map in
  `package.json` is a promise to whoever installed the package. Changing it is a
  breaking change, and it needs a version bump and a release note that says what
  moved. `principle-verification` owns the reporting half, and a claim others
  will trust without re-deriving it needs a source.
- **Not "delete anything with no callers."** A symbol nothing reaches is dead
  code, and that is `principle-hygiene`. This principle is about the callers that
  do exist, and about the commits in between.
- **Not an argument for one jumbo commit.** A migration that touches forty files
  in one diff is unreadable, and the reviewer who skims it approves a path nobody
  ran. Small commits are the point. Each one moves a caller group, and each one
  leaves the tree in a state you could check out and run.
- **Not permission to leave it half done.** A migration spread over five commits
  is five finished states, not one unfinished one. "We will delete it in the
  follow-up" is the shape that rots, because that follow-up has no author.
- **Not a claim that a staged rollout is always wrong.** A consumer you do not
  control, or a host that loads your code, means the old path stays on purpose.
  Say so, name the consumer, and the two-path state is a decision rather than an
  oversight. What is forbidden is arriving there by accident.
