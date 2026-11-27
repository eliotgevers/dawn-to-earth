---
title: Evidence coverage
summary: Count documented applicability without turning a count into an approval.
tags: coverage denominator serials evidence completeness percentage unknown formula
---

## Define the denominator first

Coverage is a descriptive count, not a technical conclusion. For a group of in-scope serials, a simple evidence coverage measure is

$$
C = 100\% \times \frac{n_{\mathrm{with}}}{n_{\mathrm{scope}}}.
$$

Here $n_{\mathrm{with}}$ counts distinct in-scope serials with at least one applicable evidence record, and $n_{\mathrm{scope}}$ counts all in-scope serials. Both are unitless whole numbers. $C$ is expressed as a percentage. If the scope has no serials, the fraction is undefined.

An unreviewed record can count toward evidence coverage while contributing nothing to approval coverage. Multiple records for one serial count only once in this specific metric. State whether coverage refers to serials, requirements, or another set.

## Distinguish coverage from completed reviews

A complementary measure is $C_{\mathrm{reviewed}} = 100\% \times n_{\mathrm{reviewed}}/n_{\mathrm{scope}}$, where $n_{\mathrm{reviewed}}$ counts distinct in-scope serials with a documented review for that evidence. This is also a percentage. If three of four fictional serials have evidence and one has been reviewed, the figures are 75% and 25%, respectively. Report the actual review outcomes separately, including any disagreements or open follow-up.

## Fictional example

One of two fictional build articles has a witness record, giving 50% evidence coverage. This alone does not indicate that either article passed.

## Related articles

- [Requirements verification matrices](../evidence/matrices.md)
- [Evidence dispositions and mixed outcomes](../evidence/dispositions.md)
- [Serials, revisions, and groups](../integration/serialization.md)

## Public references

- [NASA · Requirements Verification Matrix](https://www.nasa.gov/reference/appendix-d-requirements-verification-matrix/)
- [NASA · Product Verification](https://www.nasa.gov/reference/5-3-product-verification/)
