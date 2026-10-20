# Code hardness

Status: evidence, nothing built. This file states what the literature says about
hard code, what this repository already measures, and the four changes the
evidence asks for. Every number carries the paper it came from and the caveat
that paper gives.

## Goal

A coding agent fails on some code more than other code. The literature names
three families of reason. Defects concentrate in a minority of files. The
metrics that predict defects are mostly process metrics, and code complexity is
not one of them. A model reads complex code worse than simple code.

That last one is the one an agent can act on. The first two tell a reader where
the risk sits. The third says the model itself is the weak link.

## Mechanism

### Defects concentrate, and the share depends on how you count

Across 100 GitHub systems, the top 20% of files carried 80.53% of the fixes on
average, and the median was 78.49% (Walkinshaw & Minku 2018). A power law held
in 66% of the projects. When a fix that touches many files counts once, the
median file set that covers 80% of the fixes grows to 32%, with an
interquartile range of 20% to 47%. The paper infers fixes from commit-message
keywords, so it sees detected defects only.

A model with per-file fault history does better than the raw distribution. The
negative-binomial model of Ostrand, Weyuker & Bell (2005) placed 71% to 92% of a
release's faults in the 20% of files it ranked highest, with a mean of 83%. That
result needs the fault history of every file, so it is not a cold-start answer.

### Churn and ownership predict defects. Complexity does not

Nagappan & Ball (2005) measured 44.97M lines across 2,465 binaries of Windows
Server 2003. A model on absolute churn reached R² 0.052, and a model on
relative churn reached R² 0.811. The relative model then classified fault-prone
binaries with 89.0% accuracy. The caveat sits in the paper: one Microsoft
product, and the authors call the metric set case-specific.

Fenton & Ohlsson (2000) found no support for a relationship between module size
and fault density, and no evidence that the popular complexity metrics predict
fault-prone modules. Landman et al. (2016) read 17.6M Java methods and 6.3M C
functions, and the cyclomatic-complexity to lines correlation stayed only
moderate, with a widening spread. Complexity is therefore not merely size, and
it is still not a defect predictor.

Nagappan, Ball & Zeller (2006) found complexity metrics that predict defects
inside one project and fail to carry across five Microsoft systems, where the
correlation between class count and post-release defects ran from 0.066 to
0.713. The authors conclude that no single set of complexity metrics could act
as a universally best defect predictor.

The strongest single signal in the literature is about people. Bird et al.
(2011) counted the minor contributors to each binary of Windows Vista and
Windows 7, where a minor contributor holds less than 5% of the commits. That
count correlated 0.86 with pre-release failures, above any other metric
Microsoft collects, and adding it raised the explained variance from 26% to 46%.
The signal weakens after release, where the correlation drops to 0.25.

Two change-level results say the same thing from the other side. Kamei et al.
(2013) measured 250,000 changes in 11 projects, and reviewing the 20% of changes
with the most lines found 35% of the defect-inducing changes against 20% at
random. Zeng et al. (2021) compared 81,000 defects against 310,000 commits, and
logistic regression on the added lines alone reached AUC 0.7246 while the deep
models reached 0.7065 and 0.7055. Rahman & Devanbu (2013) found the same
ordering at release level: across 85 releases of 12 projects, process metrics
beat code metrics at p below 0.001, and a single process variable reached a
median AUC near 0.8.

### Complexity measures do not predict comprehension

McCabe (1976) defined the measure M = E − N + 2P and illustrated it on several
Fortran programs. The paper reports no subjects, no correlation and no defect
data. Its proved properties are mathematical.

Peitek et al. (2021) put 19 programmers in an fMRI scanner over 16 snippets.
Cyclomatic complexity showed no correlation with response time, correctness,
subjective difficulty, or brain activation. Lines of code and Halstead volume
showed medium correlations with the default-mode deactivation that stands for
cognitive load. The authors conclude that no single metric predicts the overall
cognitive effort.

Muñoz Barón et al. (2020) pooled 10 studies, 427 snippets and about 24,000
evaluations. Cognitive complexity correlated 0.54 with comprehension time and
-0.13 with correctness. Almost every snippet sat below the threshold of 15, so
the paper offers no usable cut.

Scalabrino et al. (2021) collected 444 human judgments from 63 developers over
121 metrics, and the strongest correlation with actual understandability was
about 0.16. No metric reached medium strength. Lavazza et al. (2023) trained
students on real maintenance tasks, and models built from structural measures
err by about 30%. Cognitive complexity did not improve them. The authors
conclude that an understandability model from structural code measures alone
does not appear possible, and they suggest process measures instead.

### An LLM reads complex code worse

Esfahani et al. (2026) scored 300 Python functions with two code models, and
the overall accuracy was 78.33% and 70.33%. Inside that, the low-complexity band
scored 93.52% and 87.04%, and the high-complexity band scored 52.78% and 47.22%.
On a 60-function subset judged by hand, the fall ran from 100% to 75% and from
90% to 60%. The caveats: a preprint, Python only, two models in zero-shot mode,
and overlapping confidence intervals, so no single metric wins.

Hariharan et al. (2025) built 930 repair tasks and moved the difficulty by
corrupting code, and success fell from 55% on the easiest band to 0% on the
hardest. Choosing functions at or above the 90th percentile of both cyclomatic
complexity and call-graph centrality cut performance by nearly 40% for every
model. The caveat: the difficulty is synthetic corruption, not real issues.

The file count is a gradient too. DeepSeek-V3-0324 resolved 28.6% of one-file
tasks, 20.6% of two-file tasks and 17.5% of tasks that touch three or more files
(SWE-rebench 2025).

### The benchmarks themselves carry weak tests

SWE-bench+ (Aleithan et al. 2024) found that 32.67% of the successful patches
of one agent had the solution inside the issue, and that 31.08% passed only
because the tests were too weak. Removing both took the resolution rate from
12.47% to 3.97%. OpenAI's own validation of SWE-bench (2024) found 38.3% of the
issues underspecified and 61.1% of the tests able to reject a valid fix, and
dropped 68.3% of the samples. Wang, Pradel & Liu (2025) found 7.8% of the
patches that counted as correct failed the developer suite, and 29.6% behaved
differently from the ground truth.

EvalPlus (Liu et al. 2023) expanded the HumanEval tests 80 times, and the pass
rate fell by 19.3% to 28.9% across 26 models, and the model ranking changed.
The strength of a test decides what "correct" means, not its count.

Two results say the corpus itself can lie. Liang et al. (2025) found that
models could name the buggy file from the issue text alone, and that the 5-gram
overlap with the benchmark ran at 35% against 18% for repositories outside it.
SWE-rebench (2025) then cut DeepSeek-V3's score from 39.7% to 21.3% on a fresh
task set.

### Refactoring pays less than new code

Palomba et al. (2018) studied 395 releases of 30 projects and 17,350
manually validated instances of 13 code smells. Smelly classes took a median of
32 changes against 12, and 9 defects against 3. The effect grew with the number
of smells: median changes ran 12, 22, 32, 54 as classes carried 0, 1, 2 and 3
smells. The same paper found no substantial difference in fault-proneness
between periods with the smell and periods without it, so the authors treat
smells as a co-occurring phenomenon rather than a cause.

Kim et al. (2012) found that the most-refactored quarter of Windows 7 binaries
had 12.2% greater reduction in post-release defects than the other modified
binaries, with a Spearman correlation of 0.368. Only 1.27% of the changes came
from the refactoring team's branches, and the authors claim correlation rather
than causation.

Digkas et al. (2022) measured 27 projects, 66,661 classes and 56,890 commits.
New methods carried a lower technical debt density than the code around them in
61% to 86% of the revisions per project. Board-level discussion of quality went
with 5% more cleaner commits, and commit guidelines with 3.88% at a p of 0.09.

The hotspot method has the weakest sources of the lot. The intersection of
churn and complexity comes from a trade book (Tornhill 2024), and the code
health score comes from the vendor's own customer data (Tornhill & Borg 2022),
where files on alert averaged 3.70 Jira defects against 0.25 in healthy files
and 124% longer time in development.

## What this repository already measures

Four verbs answer a question about hardness, and every one of them reads the
same index.

| Verb | What it answers | What it said here |
| --- | --- | --- |
| `--hotspots` | which files cost the most to maintain | 93 of 393 files have a measured complexity. The top of the list is `tools/definitions/anatomy/kit/audit.ts`, with churn 1 and cognitive complexity 596 |
| `--rank-by=churn` | which files change most | the top three are `test/history/history.test.ts`, `tools/definitions/pr/read.ts` and `tools/definitions/history/parse.ts` |
| `--graph-query` | which functions are complex and central | `cx(all,20)` names 18 functions, `fanin(all,10)` names 27, and the conjunction of the two names none |
| `--cochange` | which files move together | `skills/FOR_AGENTS.md` and `skills/definitions/ripwire/SKILL.md` changed together 48 times in 18 months, and `TODO.md` joined both of them at 32 times |

The `--quality-panel` adds six families of evidence, and two of them do not run
on a TypeScript tree. The confusion family reads C, C++, Objective-C and CUDA
paths, and the state family reads C++, Objective-C and Objective-C++. The panel
found 965 eligible functions, ranked 27, and left 719 with no family at all.

Two numbers here matter for what follows. The complex code in this repository is
leaf code, and the central code is simple, so the two hardness axes do not
overlap here. And the co-change measure found the rule this repository already
follows by hand, because the three files that hold the routing numbers always
move together.

## What it must do

### 1. Correct the map's sentence about complexity and coupling

`skills/definitions/ripwire/SKILL.md` says that coupling is the validated
signal and complexity is a size-correlated one. The evidence above says that
neither carries the signal outside one project, and that churn does. The
sentence also quotes ripwire's own `--metrics` text, so the correction belongs
in the map and in the documents that quote it.

Cost: one sentence, a re-measurement of the full-text arm, and the three files
that hold the numbers.

### 2. Add a leaf for the moment where you choose where to look first

No leaf owns that moment. `playbook-investigation` owns the read-only question
and grounds it with `ripwire.explore`, which ranks a subsystem but does not
rank by risk. The new leaf would state the moment, rank by churn rather than by
complexity, and carry the caveat that the literature gives: only 50% to 75% of
the top fifth of churny files also sit in the top fifth of defective files, so
the ranking is a place to start and not an oracle.

Cost: one folder, one row in the map, one line in the hub, the row count in the
map's closing sentence, and six corpus rows.

### 3. Let the history tool count who owns a file

`tools.spectre.history` already returns the authors of a file's history and the
commit behind each one. Bird et al. (2011) make the minor-contributor count the
strongest single predictor of failure in their corpus. The tool would add a
per-author count, and a leaf would say what a file with five authors and no
owner means.

Cost: one field, one test, one clause.

### 4. Write the next blind rows without reading the descriptions

The blind slice is spent, because every leaf with a row in it now wins at least
one of those rows. The writer of that slice read all 31 descriptions. The
four-word bar catches a row that quotes a description, and it does not catch a
row that copies the shape of one.

The benchmark literature found the same thing at a larger scale. A writer that
never sees the descriptions is the instrument this slice needs, and the
contamination result says the current slice reads high for a reason that has
nothing to do with routing.

Cost: one session per batch.

## What is still open

1. **Does a risk ranking name the same files as a complexity ranking?** In this
   repository the two do not overlap at all. The answer says which verb a leaf
   should name.
2. **What does a model do with a hotspot?** The literature says where a model
   fails, and no leaf changes that. A leaf can point at the file. It cannot
   make the model read it better.
3. **How much of the blind slice is contaminated?** The four-word bar is a
   floor, and nobody measured how much a description-blind writer would agree
   with the current rows.
4. **Which of the four items lands first?** The map sentence is one line and the
   history field is one field. The leaf is a day, and the blind batch is a
   session with a writer that knows nothing about the descriptions.

## Appendix: sources

Every URL below resolved. Crossref confirmed the 18 DOIs with their title, year
and venue, the arXiv API confirmed the 7 preprint ids with their titles and
authors, and a fetch confirmed the two web pages. The papers came from four
searches that each had to fetch the landing page, and the papers that failed
that check did not make the list.

| Claim | Paper | Where |
| ----- | ----- | ----- |
| Defects concentrate in about a fifth of the files | Walkinshaw & Minku 2018, ESEM | https://doi.org/10.1145/3239235.3239244 |
| A model with fault history concentrates further | Ostrand, Weyuker & Bell 2005, IEEE TSE | https://doi.org/10.1109/TSE.2005.49 |
| Relative churn predicts defect density | Nagappan & Ball 2005, ICSE | https://doi.org/10.1145/1062455.1062514 |
| Size and complexity do not predict defects | Fenton & Ohlsson 2000, IEEE TSE | https://doi.org/10.1109/32.879815 |
| Complexity is not merely size | Landman et al. 2016, J. Software Evolution and Process | https://doi.org/10.1002/smr.1760 |
| No complexity metric set ports across projects | Nagappan, Ball & Zeller 2006, ICSE | https://doi.org/10.1145/1134285.1134349 |
| Minor contributors predict failures | Bird et al. 2011, ESEC/FSE | https://doi.org/10.1145/2025113.2025119 |
| Review effort follows the changed lines | Kamei et al. 2013, IEEE TSE | https://doi.org/10.1109/TSE.2012.70 |
| One feature beats a deep model | Zeng et al. 2021, ISSTA | https://doi.org/10.1145/3460319.3464819 |
| Process metrics beat code metrics | Rahman & Devanbu 2013, ICSE | https://doi.org/10.1109/icse.2013.6606589 |
| Complexity was defined, not validated | McCabe 1976, IEEE TSE | https://doi.org/10.1109/TSE.1976.233837 |
| Cyclomatic complexity does not track comprehension | Peitek et al. 2021, ICSE | https://doi.org/10.1109/ICSE43902.2021.00056 |
| Cognitive complexity tracks time, not correctness | Muñoz Barón et al. 2020, ESEM | https://doi.org/10.1145/3382494.3410636 |
| The best of 121 metrics explains little | Scalabrino et al. 2021, IEEE TSE | https://doi.org/10.1109/TSE.2019.2901468 |
| Structural measures cannot model understandability | Lavazza et al. 2023, EMSE | https://doi.org/10.1007/s10664-023-10396-7 |
| A model's accuracy falls as complexity rises | Esfahani et al. 2026, arXiv preprint | https://arxiv.org/abs/2609.37405 |
| Complexity and centrality predict agent failure | Hariharan et al. 2025, arXiv preprint | https://arxiv.org/abs/2506.00172 |
| More files means lower success | Badertdinov et al. 2025, SWE-rebench | https://arxiv.org/abs/2505.20411 |
| Weak tests and leaked solutions inflate scores | Aleithan et al. 2024, SWE-bench+ | https://arxiv.org/abs/2410.06992 |
| Most benchmark samples carry a defect | OpenAI 2024, SWE-bench Verified | https://openai.com/index/introducing-swe-bench-verified/ |
| Passing tests is not resolving the issue | Wang, Pradel & Liu 2025, arXiv preprint | https://arxiv.org/abs/2503.15223 |
| Test strength decides what correct means | Liu et al. 2023, EvalPlus | https://arxiv.org/abs/2305.01210 |
| A model can name the file without the repository | Liang et al. 2025, arXiv preprint | https://arxiv.org/abs/2506.12286 |
| Smells track change-proneness, not fault-proneness | Palomba et al. 2018, EMSE | https://doi.org/10.1007/s10664-017-9535-z |
| Refactoring correlates with fewer defects | Kim et al. 2012, FSE | https://doi.org/10.1145/2393596.2393655 |
| New code moves debt density more than refactoring | Digkas et al. 2022, IEEE TSE | https://doi.org/10.1109/TSE.2020.3032557 |
| The code health score comes from vendor data | Tornhill & Borg 2022, TechDebt | https://doi.org/10.1145/3524843.3528091 |
| The hotspot intersection comes from a trade book | Tornhill 2024, Your Code as a Crime Scene, 2nd ed. | https://pragprog.com/titles/atcrime2/your-code-as-a-crime-scene-second-edition/ |

One candidate did not survive the check. The 1969 paper behind "Moser's law" has
no record in Crossref, and no source ties the name to a standard software
engineering result, so the report does not use it.
