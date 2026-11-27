---
id: integration-records
title: Integration records
summary: How a build’s configuration, observations, and decisions stay traceable.
tags: as built as-built traveler serial revision handoff issue evidence traceability
---

## What was actually assembled?

A configuration record describes the intended definition. An as-built record describes the particular article that was assembled. A useful integration record connects the serial and revision to this history so later readers can tell which observations apply.

Integration records can capture discrepancies, decisions, and reasons. A link from a build or issue to its evidence lets a reviewer tell a captured observation apart from a disposition. Preserve the build identity when a follow-up changes the issue’s status. If a later article used a different design revision, give it a separate build reference rather than quietly updating the old record.

## A trace from requirement to decision

![A requirement links to the as-built record, which links to evidence and the reviewer’s decision.](/wiki-diagrams/traceability.svg)

*Original diagram for Dawn to Earth. It shows relationships between fictional records.*

| Record | Question it answers |
| --- | --- |
| Requirement | What property is under review? |
| As-built record | Which serial and revision were observed? |
| Evidence | What was observed, and where did the record come from? |
| Review decision | How did the reviewer interpret that evidence for this scope? |

NASA describes product integration and product verification as related technical processes. A single observation can be useful to both teams when the record preserves its identity and scope. In this fictional workflow, an issue remains linked to the earlier build even when a later observation resolves it.

## Fictional example

A Tern Payload Cradle build names its installed definition. The linked issue explains why the first photograph was insufficient, and a later photo identifies which article was observed.

## Related articles

- [Build travelers](travelers.md)
- [Issues and nonconformances](issues.md)
- [Configuration baselines](../systems/baselines.md)

## Public references

- [NASA · Product Integration](https://www.nasa.gov/reference/5-2-product-integration/)
- [NASA · Product Verification](https://www.nasa.gov/reference/5-3-product-verification/)
