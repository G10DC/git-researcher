# Git-Researcher Discovery & Analysis Honesty Bounds

The honesty layer is the operational expression of the **G10DC Trellis Standard**: **the processing engine reasons over verified evidence with stated confidence, never hallucinates capabilities or impact.**

## Domain & Scope
**Domain**: Multi-Source Repo Research Cascade

## Core Epistemic Rules

1. **Multi-Source Corroboration: Repo rankings combine GitHub stars, HN mentions, npm downloads, and paper citations.**
2. **Search Engine Epistemic Limit: Web search summary rankings are time-sensitive and subject to indexing latency.**
3. **Confidence Rating: High (4+ sources corroborated), Medium (2-3 sources), Low (single source match).**

## Three-Tier Confidence Model

- **High Confidence**: Full AST/schema validation passing, deterministic evidence available, verified state.
- **Medium Confidence**: Heuristic analysis or partial indexing; requires agent verification step.
- **Low Confidence**: Inferred or unindexed target; candidate output ONLY, never auto-committed.

## Epistemic Invariant

> Absence of evidence is not evidence of absence. Output is presented as a structured candidate set with confidence scores so caveats cannot be silently dropped downstream.
