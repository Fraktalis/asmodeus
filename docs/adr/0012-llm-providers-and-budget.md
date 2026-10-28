# ADR-0012: LLM providers, roles and budget

- Status: Accepted
- Date: 2026-10-28

## Decision

- A thin `LlmProvider` interface with two implementations: Anthropic, and any OpenAI-compatible endpoint (covers Ollama, OpenRouter, LiteLLM). No multi-provider SDK dependency.
- Models are selected by **role** in config: `judge` (cheap model for gates/pre-filters) and `analyst` (strong model for analysis).
- Budget caps per run and per day are **hard stops**, not warnings. Cost is recorded and displayed per run.
- LLM calls happen only on content change (hash per source).
- Every LLM run is recorded (`llm_runs`); every write outside the store's attention/feedback tables goes to an `audit` table.

## Consequences

- Local-only deployments (Ollama) are first-class.
- The LLM foundation is built in phase 4 together with its first consumer, the news module.
