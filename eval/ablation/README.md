# Skill Ablation Harness (`eval/ablation/`)

This harness measures whether keeping a skill improves real execution over removing that skill, relative to same-config variance.

Version 1 targets `tdd` through one behavioral scenario (`eval/ablation/scenarios/tdd-bugfix.json`).

## Commands

Run the zero-LLM self-test:

```sh
bun run eval:ablation -- --self-test
```

Run a live 3-arm sweep with balanced arm rotation (`present`, `stripped`, `replicate`):

```sh
bun run eval:ablation -- --live --trials=3 --model=opencode-go/kimi-k3
```

Run a live sweep without the blind judge:

```sh
bun run eval:ablation -- --live --trials=3 --model=opencode-go/kimi-k3 --no-judge
```

## Design Guarantees

1. **Zero production edits**: every arm runs from an isolated copy via `preparePlugin(dir, "live")`. Stripping deletes staged `skills/definitions/tdd/SKILL.md`, filters staged `definitions`, removes residual `tdd` cues across catalog, playbooks, principles, and tool schemas, and audits the staged copy before launch.
2. **Exact host verification**: each trial checks exact deduplicated set equality on `Registered skills` and verifies host `/api/skill` availability.
3. **Separate metrics**: activation, causal red-before-edit trajectory, workspace oracle verification, and host-recorded USD stay separate in all outputs.
4. **Causal witness**: a red witness requires a completed failing run before the first production edit, real assertion evidence rather than syntax or setup errors, and a passing run after the last production edit.
5. **Blind cross-family judging**: when enabled, the judge runs on a plugin-free server with a fresh session per pass over allowlisted diffs and verification output, swaps submission order across two passes, and labels disagreements `unresolved`.
6. **Conservative verdicts**: small samples (`< 5` complete pairs), incomplete runs, timed-out runs, unexposed treatment arms, or failed gates report `inconclusive`.
