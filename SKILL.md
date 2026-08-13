---
name: git-researcher
status: implemented
description: Given a software idea, discovers and analyzes relevant GitHub repositories via a cascade of specialized analysis agents, producing structured analysis documents and a final report. Use when researching existing GitHub projects or comparing open-source solutions for a new idea. Never run it on a vague, unbounded idea -- the cascade has no request cap and can multiply API calls; never trust scraped search results as ground truth.
---

# GitResearcher

A terminal tool and agent pipeline that discovers and analyzes relevant GitHub repositories given a software idea.

## Features
- **Breakdown & Discovery**: Extracts search intents and queries GitHub/dorks/DuckDuckGo for relevant repos.
- **Cascade Analysis**: Analyzes repositories through multi-lens agent cascades.
- **Synthesis**: Produces structured analysis documents, architecture insights, and final reports.

## Execution
Run from the repository root directory:
```bash
node src/pipeline.js --idea "<idea>"
```

## When to use

- Given a software idea or problem statement, discovering and analyzing relevant existing GitHub
  projects before building something from scratch.
- Comparing multiple open-source solutions to the same problem across architecture, maturity,
  and maintenance activity.

## When NOT to use

- **The idea is too vague to bound the search** — the cascade has no built-in request budget, so
  a vague query can multiply discovery/analysis API calls; narrow the idea first.
- **You need ground-truth data from GitHub's API, not scraped search results** — discovery
  sources include DuckDuckGo/HN/SO HTML scraping (`src/discovery/`), which breaks silently when
  target markup changes; treat results as leads to verify, not verified facts.
