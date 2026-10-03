# Communication

ASD-STE100 Simplified Technical English governs how this set writes. It is a
controlled language built by the aerospace and defence industry so a technician
cannot misread a maintenance instruction. Its reader cannot ask a follow-up
question. So does a downstream model parsing a tool description, an error
string, or a report from another agent, so the discipline transfers.

This skill owns that decision and routes to the rules. It owns no rule of its
own.

## What this standard covers

Communication is the text a person or a model reads: a reply, an error message,
a tool description, a commit body, a document, a report. It is not how you work.
`principle-*` states how to work and is loaded as an instruction to a model, so
no writing rule in this set applies to a principle body. The prose *inside* a
principle body is communication, and it is covered.

**STE wins every contradiction.** When a rule here and a STE rule disagree, the
STE rule lands and the local rule is deleted, not negotiated. One exception is
recorded in `grammar-sentence`, because following STE there would cost a claim
rather than a sentence.

STE is a floor, not a ceiling. It governs aerospace maintenance procedures and
is silent on developer prose: mannered phrasing, rule-of-three padding,
boldface used as decoration. Those tells are not in the standard, so
`grammar-*` carries them as residue under their original `unslop` numbers.

## What the standard does not cover

The dictionary is absent. ASD-STE100 Issue 9 restricts reproduction of its
~900 approved words to eight categories of organisation, and this project is in
none of them, so no file here carries the word list. What carries instead is the
principle underneath it: pick the plainest available word, and use the same word
for the same thing every time. That much is checkable without the list, and
`lint/prose.ts` checks the part of it that is mechanical.

Two rules are deliberately unimplemented because a regex cannot do them without
constant false positives: capping a noun cluster at three words needs
part-of-speech tagging, and spotting a dropped article needs semantics. Both are
in `grammar-words` as judgement.

## The rules

| Leaf | Its test | The verb that answers it |
| ---- | -------- | ------------------------ |
| `grammar-sentence` | does one sentence carry one claim, and is the actor named | `bun run lint/prose.ts` for length, tense, voice and the semicolon |
| `grammar-words` | is this the plainest word, and is it the same word as last time | `bun run lint/prose.ts` for the phrasal verbs and the marketing adjectives. The dictionary half is a person |
| `grammar-text` | can a reader find the thing they came for | none. Paragraph shape and list shape are a person reading the page |

## Before sending

Run the linter. It is advisory on passive voice and on the present perfect, and
hard on everything else, so a clean run is not a clean sentence.

```sh
bun run lint/prose.ts --baseline 12 skills/definitions/<id>/SKILL.md
```

`--baseline N` tolerates N hard findings, which is how this set adopted the
rules without rewriting 79 files first. A finding count is not a defect list to
clear before you send; it is a list to read.

The prose in the rule bodies here passes the rules, or says why it does not.
Where a body deliberately keeps a violation, the reason is in the body. An
unexplained finding means the linter found something the author missed.