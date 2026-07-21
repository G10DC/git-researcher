---
name: git-researcher
description: Given a software idea, discovers and analyzes relevant GitHub repositories via a cascade of specialized analysis agents, producing structured analysis documents and a final report. Activate when researching existing GitHub projects, analyzing codebase architecture, or comparing open-source solutions for a new software idea.
---

# GitResearcher

A terminal tool and agent pipeline that discovers and analyzes relevant GitHub repositories given a software idea.

## Features
- **Breakdown & Discovery**: Extracts search intents and queries GitHub/dorks/DuckDuckGo for relevant repos.
- **Cascade Analysis**: Analyzes repositories through multi-lens agent cascades.
- **Synthesis**: Produces structured analysis documents, architecture insights, and final reports.

## Execution
Run from `C:\Users\GdC\.gemini\config\skills\git-researcher`:
```bash
node src/pipeline.js --idea "<idea>"
```
