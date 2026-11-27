# Fleet orbit sources

The dated local copy contains matching records from CelesTrak’s [active satellite feed](https://celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=csv), retrieved 26 November 2026 at 23:53:58 UTC. Each row matches a sourced spacecraft by both NORAD number and international designator. Each spacecraft record links its mission sources separately.

SGP4 estimates positions from the element epoch supplied for each object. Fleet suppresses estimates more than 72 hours from that epoch. A spacecraft may still appear in the mission list after reentry or when there are no matching elements. The Earth imagery is a separately dated NASA geographic reference. [CelesTrak data formats](https://celestrak.org/NORAD/documentation/gp-data-formats.php)
