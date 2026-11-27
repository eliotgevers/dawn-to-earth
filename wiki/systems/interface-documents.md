---
title: Interface control documents
summary: What belongs in a shared description of a boundary.
tags: ICD ownership compatibility revision agreement matrix
---

## A shared source of interface intent

An interface control document records an agreement between the parties responsible for the two sides of an interface. The purpose is to keep the boundary understandable and controlled as the underlying products evolve. Interface ownership helps identify who evaluates and agrees to a proposed change.

| Information | What it lets a reviewer ask |
| --- | --- |
| Parties and boundary | Which two sides are covered? |
| Applicable versions | Does this agreement cover the version in the build record? |
| Related requirements and evidence | Where is compatibility defined and evaluated? |
| Revision and disposition | Which definition was agreed at the time? |

A document identifier without its revision may be insufficient when two versions exist.

## Fictional example

The Fern Pathfinder tray and cover share an interface document. A newer cover drawing does not, on its own, revise the agreed boundary.

## Related articles

- [Spacecraft interfaces](interfaces.md)
- [Configuration baselines](baselines.md)
- [Requirements and evidence traceability](../evidence/traceability.md)

## Public references

- [NASA · Interface Management](https://www.nasa.gov/reference/6-3-interface-management/)
- [NASA · Configuration Management](https://www.nasa.gov/reference/6-5-configuration-management/)
