# Worktree cleanup

A worktree is a directory that costs disk and looks like work. This is how to
reclaim the first without losing the second.

The decision is not yours. `tools.spectre.worktrees({})` computes it from git
state as a pure function, which means it gives the same answer every time for the
same state. Reading a directory listing and judging by eye is how a branch with
one unpushed commit gets removed, and the mistake is invisible afterwards because
the directory is gone and so is the evidence.

## Start

Call the tool. Everything below is what to do with what it returns.

```
const a = await tools.spectre.worktrees({})
a.counts        // how much there is to reclaim
a.worktrees     // one row per worktree, with the evidence
a.problems      // read this before acting on a count
```

## Phase A: Read the warnings

`problems` changes what the answer is worth, and skipping it is the one way to be
wrong here.

- **`origin/main` is not fetched.** Every `merged` is then false, and a `safe`
  bucket rests on the PR column alone. Run `git fetch origin main` and call again.
- **`gh` failed.** The tool says which way it failed and why. With no PR data,
  `pr` is `-` everywhere and nothing is `safe` on that account.

Both are cheap to fix and expensive to skip. A `review` row under a stale-fetch
warning might be a branch that merged last month.

## Phase B: Take the holds off the table

Three buckets are not candidates, and none of them is a judgement call:

- `hold-wip` has tracked edits in the tree. Not a candidate at any priority.
- `hold-open-pr` has an OPEN pull request. Somebody is waiting on it.
- `review` is a branch with no PR, not merged, and not pushed, or pushed with
  commits that never landed. **This is the one to read.** A `no-remote` branch
  exists in one directory and nowhere else, so removing the directory is
  removing the work.

Read what a `review` row actually contains before deciding. `git log --oneline
main..<branch>` in that worktree tells you whether there is anything on it that
is not already on main. If there is, that is unpushed work and it is the author's
call, not yours.

## Phase C: Reclaim the safe ones

`safe` means deleting loses nothing the author was still holding. It does **not**
mean the work was good: a CLOSED pull request is proof the author let it go, and
that is what the bucket accepts.

So `safe` is the list to work from, in this order:

1. Start the largest. The path is where the disk went.
2. Re-read the row before you act on it. The call in Start is a snapshot, and by
   the time you reach the last row the branch may have moved. `git -C <path> status
   --porcelain` and `git -C <path> log --oneline main..<branch>` are the two checks
   that matter, and a row that no longer matches is not a candidate any more.
3. `tools.spectre.worktrees({ action: "remove", directory: path })`. The tool
   asks git to remove it without force and then reads the result back, so a
   worktree holding modified or untracked files comes back as `failed` with
   git's own message and the tree is still there — that refusal is the guard.
   Never `rm -rf` the directory: the worktree metadata lives in the main
   repository's `.git/worktrees`, and removing the directory behind git's back
   leaves a stale entry that every later `git worktree list` still reports.
4. `git worktree prune` only when a `failed` or `already-gone` status names a
   stale entry, which clears metadata for a directory that is already gone.
5. `git branch -d <branch>` only for a branch that was merged. `-d` refuses to
   delete an unmerged branch, which is the guard you want; `-D` overrides it and
   is how work disappears. `tools.spectre.worktrees` never deletes a branch —
   removal reclaims a directory, and a branch is somebody's work.

## Phase D: Report what you did not do

Say which buckets you left and why, by name. A cleanup that silently skips three
`review` rows leaves the reader thinking the disk is clean.

```
removed 4 safe worktrees, 1.2G
left 2 hold-wip (tracked edits), 1 hold-open-pr (#412)
left 1 review: feature/experiment, 3 commits not on main, never pushed
```

The last line is the one that matters. It is the difference between a cleanup and
a deletion nobody agreed to.

## When not to run this

- **Before a landing.** `tools.spectre.stack({})` may be about to rebase a branch
  that lives in one of these directories.
- **On a worktree whose session is live.** The tool cannot see an agent working
  in it. `safe` means the *git* state is settled, not that nobody is mid-edit, and
  an uncommitted thought in a merged worktree still reads as `safe`.
- **To solve a disk problem you have not measured.** Count first, delete second.
  Deleting three worktrees to free 40M is a worse answer than the one you started
  with.
