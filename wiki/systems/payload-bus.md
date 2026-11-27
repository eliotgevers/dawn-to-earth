---
title: Payload and spacecraft bus
summary: Distinguish the mission instrument from the services that support it.
tags: instrument platform subsystem bus mission support
---

## Mission function and supporting services

A payload is the equipment that directly serves a mission objective. The spacecraft bus is the platform that supports it with services such as power, pointing, data handling, and communication. The boundary can differ by mission, so these labels are most useful when paired with a clear description of responsibilities.

An instrument working on its own does not establish that it will work with the platform. The platform and payload teams still share assumptions about where they meet and what information they exchange. The integration record is where the team identifies which versions were actually evaluated together.

## Fictional example

Kōtare Mapper treats its observing instrument as the payload, while the platform supports the instrument and receives its science files.

## Related articles

- [Spacecraft interfaces](interfaces.md)
- [Civil satellite mission lifecycle](../space/mission-lifecycle.md)
- [Spacecraft communications concepts](communications.md)

## Public references

- [ESA · Newcomers Earth Observation Guide](https://business.esa.int/newcomers-earth-observation-guide)
- [NASA · Interface Management](https://www.nasa.gov/reference/6-3-interface-management/)
- [NASA · Product Integration](https://www.nasa.gov/reference/5-2-product-integration/)
