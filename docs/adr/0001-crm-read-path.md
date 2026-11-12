# ADR-0001: Primary read path for CRM data

- **Status:** Proposed (decision due 2026-11-13)
- **Date:** 2026-11-11
- **Deciders:** project owner

## Context

Stakes pushes customer organizations and deals into the Teamwork Graph through a `graph:connector`. Not every connector object type has a matching Teamwork Graph API object type yet, so it is unknown whether deals pushed by our connector can be read back through curated or persisted queries, as the viewing user, with their association to Jira work items.

The Phase 0 spike pushes one customer and one deal linked to a `PAY` issue and tries to read them back.

## Options considered

1. **Graph primary.** Q1 reads deals and customers; the entity-store mirror and `stakesBridge.crm` are fallbacks for degraded reads. Strongest Teamwork Graph story; depends on Preview APIs at demo time.
2. **Mirror primary.** Deals and customers come from the entity-store mirror (CSV/demo) and `stakesBridge.crm` (live). The graph is used for escalations, conversations, goals and teams, and connector data still appears in Rovo Search. Most reliable; weaker "consumes the graph" claim for CRM data.

## Decision

_To be filled in at the gate with the spike evidence (query text, response, screenshots)._

## Consequences

- Either way, the collector keeps the ordered source chain (graph → bridge property → mirror) and every evidence item shows its `source`.
- Record the outcome in `CLAUDE.md` and update [teamwork-graph.md](../teamwork-graph.md) §5.
