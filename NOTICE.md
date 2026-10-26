# NOTICE

targettrace is an independent work built on top of an unmodified upstream
library. It does not vendor, patch, or fork upstream source code.

## Runtime dependency

**browserslist 4.29.4** — MIT — https://github.com/browserslist/browserslist

Used through its public API only:

- `browserslist(queries, opts)` — authoritative target resolution
- `browserslist.parse(queries)` — clause list, with `not` / `compose` metadata
- `browserslist.coverage(list, areas)` — usage coverage
- `browserslist.loadConfig({ config, env })` and `browserslist/node`
  (`parseConfig`) — config file and `[section]` handling
- `browserslist(['dead'])` — the end-of-life set used by rule TT006

The 15-line clause reduction in `src/engine.js` mirrors the order of operations
that `browserslist` performs internally (`or` = union, `and` = intersection,
`not` = subtraction, then deduplicate). That mirror exists only to observe each
step; every trace also runs the upstream call and throws `TraceMismatchError`
if the replay disagrees, so upstream output always wins.

browserslist is distributed under the MIT license; its full text is available
in `node_modules/browserslist/LICENSE` after `npm install` and at
https://github.com/browserslist/browserslist/blob/main/LICENSE.

## Data attribution

Browser versions, usage shares, and end-of-life status come from
**caniuse-lite** (CC-BY-4.0, https://github.com/browserslist/caniuse-lite),
consumed at runtime through browserslist. No caniuse data file is copied into
this repository; the numbers in `docs/MEASUREMENTS.json` are outputs computed
from that data and record the exact caniuse-lite version used.

## Corpus attribution

`corpus/configs.json` contains `.browserslistrc` snippets collected from public
GitHub repositories through the GitHub code search API. Each entry records the
repository, file path, canonical URL, collection date, and a SHA-256 of the
retrieved text, so any entry can be re-checked against its source. The snippets
remain the property of their respective repositories and are included only as
the reproducible input for the measurements in `docs/`, not as a redistribution
of those projects. Only files the GitHub API returned as public were collected;
nothing from private repositories is included.

Re-collect with `node scripts/collect-corpus.cjs` (requires an authenticated
`gh` CLI). Re-measure with `node scripts/measure.cjs`.

## Prior art

`npx browserslist` prints the resolved list, and `browserslist.coverage()`
reports usage share. Neither reports *which clause* contributed a browser,
whether a clause changed anything, or whether a `not` clause was undone later.
targettrace adds that layer; it does not replace the resolver.
