# targettrace

Clause-level explainability and lint for [browserslist](https://github.com/browserslist/browserslist).

browserslist answers **what** your build targets are. targettrace answers **which clause** put each
browser there, which clauses changed nothing, and which `not` clauses were quietly undone later.

```
$ node bin/targettrace.js trace "defaults" "not ie 11"
#  clause                      sel    +    -  size  coverage
------------------------------------------------------------
0  defaults                     36   36    0    36    86.04%
1  not ie 11                     1    0    0    36    86.04%

final: 36 browser(s)
coverage: 86.04% global
```

`not ie 11` matched one browser and removed nothing: `defaults` already excludes it through its own
`not dead` clause. The list is identical with or without that line.

## Why this exists

browserslist exposes `browserslist(queries)`, `browserslist.parse(queries)`, `browserslist.coverage()`
and `loadConfig()`. None of them reports what a single clause *did*. The clause reducer is order
dependent — a comma unions, ` and ` intersects, `not` subtracts from what has accumulated so far —
so a per-clause loop that unions the positive clauses and subtracts the negative ones is **not**
equivalent:

```
> 1% and last 2 versions       -> 4 browsers, 54.39% coverage   (intersection, not union)
```

Measured on 268 real `.browserslistrc` files collected from GitHub
(2026-10-26): the order-free reading disagrees with browserslist on
**27 of 268** configs (**10.1%**). Two
reproductions taken straight from the sample:

```
last 2 versions, not dead, > 0.2%, Firefox ESR, IE 11
  order-free: 56 browsers · actual: 57   (IE 11 is re-added after `not dead`)
current node, last 2 versions and > 2%, ie > 10
  order-free: 36 browsers · actual: 3
```

So targettrace replays the reduction instead of guessing at it, and then **verifies the replay
against browserslist itself on every call**: the upstream answer is always computed first, and a
`TraceMismatchError` is raised if the ledger does not reproduce it. The upstream library is never
patched — see `NOTICE.md`.

## Install

Not published to npm. From source:

```
git clone https://github.com/llinok111/targettrace.git
cd targettrace
npm ci
node bin/targettrace.js --help
```

Optionally make it available as `targettrace`:

```
npm link          # or: npm install -g .
```

Requires Node >= 18 and has exactly one dependency, `browserslist` 4.29.4 (pinned).

## CLI

```
targettrace trace   <query...>            clause ledger (+/- per clause)
targettrace lint    <query...>            rules over the ledger
targettrace diff    <query...> --vs <query...>
targettrace explain <browser> <query...>  why one browser is (or is not) targeted
targettrace rules                         list rule ids
```

Query source:

| form | meaning |
| --- | --- |
| `"defaults" "not ie 11"` | one argument per clause |
| `"defaults, not ie 11"` | a single comma-separated string |
| `--config=<file>` | read `.browserslistrc` / `browserslist` / `package.json` |
| `--env=<name>` | section to pick from the config (browserslist default: `production`) |

Options: `--coverage[=global|US,CN]` (attach usage coverage per clause), `--json`,
`--fail-on=info|warning|error` (lint gate, default `warning`), `--collapse=<points>` (TT007
threshold, default 10), `--quiet`, `--version`, `--help`.

Exit codes are a contract, so this can sit in CI:

| code | meaning |
| --- | --- |
| 0 | ran, no finding at or above the gate |
| 1 | a finding reached `--fail-on` (or `explain` matched no browser) |
| 2 | usage error |
| 3 | browserslist rejected a query |
| 4 | config problem (missing file, unresolvable `extends`) |
| 5 | replay disagreed with browserslist — please report it |

```
$ node bin/targettrace.js lint "last 2 versions" "not ie 11" "last 1 version" --coverage
warning TT004 [1]     `not ie 11` removed 1 browser(s), but 1 of them were re-added by later clauses.
        e.g. ie 11
warning TT006 [final] 7 end-of-life browser(s) survived into the final list.
        e.g. baidu 13.52, bb 10, bb 7, ie 11, ie 10, ie_mob 11, +1 more

summary: 0 error · 2 warning · 0 info
```

`--json` returns the same data plus the full per-browser provenance:

```
$ node bin/targettrace.js trace "last 2 versions" "not ie 11" "last 1 version" --json
{ "ok": true, "result": { "final": [...], "steps": [...], "browsers": [ { "name": "ie 11",
  "survived": true, "steps": [ { "index": 0, "action": "add" }, { "index": 1, "action": "remove" },
  { "index": 2, "action": "add" } ] } ] } }
```

## Rules

| id | severity | fires when | measured hits |
| --- | --- | --- | --- |
| TT001 dead-clause | warning | a positive clause matched browsers but changed nothing | 71 (71 configs) |
| TT002 shadowed-clause | warning | everything a clause added was removed later | 6 (6 configs) |
| TT003 no-effect-not | warning | a `not` clause removed nothing | 123 (123 configs) |
| TT004 undone-not | warning | browsers removed by `not` were re-added later | 17 (17 configs) |
| TT005 duplicate-clause | info | the same clause appears twice | 45 (45 configs) |
| TT006 eol-targets | warning | the final list keeps browsers browserslist itself calls `dead` | 83 (83 configs) |
| TT007 coverage-collapse | info | an ` and ` clause cut coverage by >= 10 points (needs `--coverage`) | 1 (1 configs) |

TT007 only runs when coverage is requested, which is the one rule whose count depends on an option.
Nothing rewrites your config; targettrace reports, it does not fix.

## Library

```js
const { trace, lint, diff, loadFromConfig, shouldFail } = require('targettrace')

const loaded = loadFromConfig('.browserslistrc', 'production')
const result = trace(loaded.queries)            // or trace(['defaults', 'not ie 11'])
console.log(result.final.length, result.steps[1].removed)
console.log(result.browsers.find(b => b.name === 'ie 11').steps)
```

`trace()` returns `{ queries, options, data, final, finalSize, coverage, steps, browsers }`; each step
carries `added` / `removed` / `selected` / `sizeAfter` / `coverageAfter`, and `browsers` carries the
ordered add/remove events per browser. `lint()` returns `{ findings, summary, rules }` with
`finding.evidence.examples` naming the browsers behind each hit.

## Is the ledger trustworthy?

Three independent checks, all re-runnable:

1. **Replay fidelity.** For every loadable config in the corpus, the ledger must reproduce
   `browserslist(queries)` exactly: **268 of 268 traced,
   0 mismatches**. Plus 62 tests across 8 files
   (62 passing), including 400 generated query sets.
2. **Ledger arithmetic.** The ledger is replayed on its own (`+`/`-` applied in order) and must land
   on the final list, with `sizeAfter` matching at every step.
3. **The corpus itself.** `corpus/configs.json` stores the repository, path, URL and a SHA-256 per
   config, and `test/corpus.test.js` re-verifies every hash.

Corpus composition (276 files, 121 distinct query shapes,
1381 clauses, median 4 per file, max 55):

| outcome | count | note |
| --- | --- | --- |
| traced end to end | 268 | replay identical to browserslist |
| `extends @scope/config` | 7 | needs the referenced package installed |
| unparseable | 1 | a `package.json` renamed to `.browserslistrc` |

Median final coverage is 83.55% of global usage
(range 0%–97.49%; the 0% files target a single old version
or `current node`, which caniuse has no usage data for). Details, examples and the full list of
skipped files: [`docs/CORPUS.md`](docs/CORPUS.md).

## Cost

`trace()` issues one upstream call plus one call per clause. Measured on Node v22.22.2
(win32), 5-clause config (`docs/BENCH.json`):

| | median | vs one `browserslist()` call |
| --- | --- | --- |
| warm, upstream (cache hit) | 0.0043 ms | 1x |
| warm, `trace()` | 0.0504 ms | 11.72x |
| cold process, upstream | 7.9756 ms | 1x |
| cold process, `trace()` | 11.3549 ms | 1.42x |
| cold process, `trace({coverage})` | 11.5584 ms | 1.45x |
| sweep of 276 real configs | 41.75 ms | 0.151 ms/config |

A warm upstream call is a cache hit, so the large warm ratio is mostly "not a cache hit" rather than
algorithmic cost; the cold ratio (1.42x) is the honest one for a one-shot CLI run.

## Demo

`demo/index.html` is a single self-contained page (no CDN, no browser data shipped) showing the
ledger, the findings and a browser-provenance lookup for five presets. It is generated by
`npm run demo` and accepted automatically by `node scripts/verify-demo.cjs`, which drives a headless
Chromium over the DevTools protocol: **15/15 checks** on
msedge.exe — geometry, overflow, WCAG AA contrast, preset switching, console cleanliness,
plus pixel statistics on both viewports (desktop ink 4.92%,
3043 distinct colours; mobile ink 5.27%).

## Reproducing every number

```
npm ci
npm test                 # 62 tests, writes docs/TEST.json
npm run measure          # corpus sweep    -> docs/MEASUREMENTS.json
npm run bench            # timing          -> docs/BENCH.json
npm run demo             # demo/index.html
npm run verify:demo      # headless browser acceptance -> docs/VERIFY-DEMO.json
npm run docs             # regenerate README.md + docs/CORPUS.md from the JSON above
npm run corpus           # re-collect the corpus from GitHub (needs `gh auth login`)
```

`README.md` and `docs/CORPUS.md` are generated from templates and the JSON files above;
`test/docs.test.js` fails if they are stale, so the numbers in this file are always the measured
ones.

## Known limitations

- The reducer mirror in `src/engine.js` is 15 lines and order-exact, but it is a mirror. A
  `TraceMismatchError` (exit 5) means upstream changed; that is a bug report, not a user error.
- Configs using `extends` need the referenced package installed, otherwise exit 4. The corpus
  excludes 7 such files for that reason.
- Coverage and "end of life" both come from caniuse-lite; numbers are tied to the version recorded in
  the output (1.0.30001819 here).
- The corpus is a GitHub code-search sample of 276 files, not a census. Popular
  templates appear many times, which is why 121 distinct shapes remain; treat the
  rule counts as an indication of how common each pattern is, not as an industry-wide rate.
- No auto-fix by design: the interesting decisions (drop IE 11? narrow with `and`?) are policy.

## License and upstream

MIT (`LICENSE`). Built on browserslist 4.29.4 (MIT) through its public API only;
no upstream file is patched, vendored or forked. Browser data: caniuse-lite (CC-BY-4.0). See
`NOTICE.md` for the exact API surface used and the corpus attribution.
