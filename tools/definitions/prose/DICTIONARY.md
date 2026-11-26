# ASD-STE100 Dictionary Export

`tools.spectre.prose` reads the lexical half of ASD-STE100 from a JSON export that you produce from your own copy of the specification. `spectre.json` configures the file path under `dictionary` (`spectre.jsonc` also works). A relative path resolves against the config file that names it.

This repository does not ship the export. Issue 9, page 2 restricts reproduction of the dictionary to eight categories of organisation, and this project belongs to none of them. Request the standard from [asd-ste100.org](https://www.asd-ste100.org/STE_downloads.html) and export it locally.

## Expected JSON shape

```jsonc
{
  "meta": {
    "issue": "9 (2025-01-15)",
    "source_url": "https://www.asd-ste100.org/assets/files/ASD-STE100_ISSUE9.pdf",
    "copyright": "© ASD, 2025 – All rights reserved",
  },
  "entries": [
    {
      "headword": "CHECK (n)",
      "pos": "n",
      "approved": true,
      "meaning": "an inspection",
      "page": "2-1-C2",
      "alternatives": [{ "word": "ATTACH", "pos": "v" }],
      "senses": [
        { "meaning": "an inspection", "ste": "Do a check.", "non_ste": "" },
      ],
    },
  ],
}
```

- `headword` carries the part of speech (for example, `CHECK (n)`). Lookup strips the marker so `check` matches this entry.
- `approved` defaults to `true` when omitted.
- `senses`, `annotation`, `forms`, `raw`, and `replacement_hint` act as optional metadata. The tool does not turn `senses[].non_ste` into an automated rule because context checks belong to review.

## Lookup rules

- **Missing words return `unknown`, not `not-approved`.** A missing word may name a project technical noun under STE rule 1.5.
- **Entries with no `pos` match every part of speech.** A ruling on the bare word covers every use of it.
