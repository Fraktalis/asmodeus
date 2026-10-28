# ADR-0001: Hybrid architecture — deterministic core, optional LLM layer

- Status: Accepted
- Date: 2026-10-28

## Context

Three approaches were considered: a purely deterministic dashboard, an agent-first harness where an LLM drives everything, and a hybrid. Reported failure modes of agent-first setups include unguarded autonomy causing outages, cost drift from always-on agents, and a single agent doing everything badly.

## Decision

Asmodeus is a deterministic system (collectors → store → rules → overview/UI/MCP) with an LLM layer on top that only reads the store and produces analyses (news pipeline, later triage). Acceptance test for the boundary: with every LLM feature disabled, the dashboard is complete and useful.

## Consequences

- LLM features are additive modules with zero cost when disabled.
- Rules, not models, decide what becomes an attention item in phases 1–3.
- LLM calls are gated by deterministic pre-filters (content hash per source; called only on change).
