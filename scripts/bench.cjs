// Cost of tracing, measured on this machine.
//
// browserslist caches by (queries, context), so an in-process repeat of the same
// call measures a cache hit, not the resolver. Both numbers are reported:
//   warm  — repeated identical call in one process (cache hit for upstream;
//           trace still has to evaluate each clause of the pair, also cached)
//   cold  — a fresh Node process per sample, so nothing is cached
// Only ratios between measurements taken the same way are used in the docs.

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { performance } = require('node:perf_hooks')
const { spawnSync } = require('node:child_process')

const browserslist = require('browserslist')
const { trace } = require('../src/engine')
const { lint } = require('../src/lint')
const { loadFromConfig } = require('../src/config')
const corpus = require('../corpus/configs.json')

function median (values) {
  const sorted = values.slice().sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}

function benchWarm (fn, runs) {
  const times = []
  for (let i = 0; i < runs; i++) {
    const start = performance.now()
    fn()
    times.push(performance.now() - start)
  }
  return Number(median(times).toFixed(4))
}

// Runs one sample per fresh process. `body` is executed with `require` available
// and must print the measured milliseconds to stdout.
function benchCold (body, runs) {
  const script = `
    const { performance } = require('node:perf_hooks')
    const path = require('node:path')
    const browserslist = require('browserslist')
    const { trace } = require(${JSON.stringify(path.join(__dirname, '..', 'src', 'engine.js'))})
    const { lint } = require(${JSON.stringify(path.join(__dirname, '..', 'src', 'lint.js'))})
    ;(function () {
      const queries = ${JSON.stringify(QUERIES)}
      const start = performance.now()
      ${body}
      process.stdout.write((performance.now() - start).toFixed(4))
    })()
  `
  const times = []
  for (let i = 0; i < runs; i++) {
    const result = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8' })
    if (result.status !== 0) throw new Error(result.stderr || 'child failed')
    times.push(Number(result.stdout.trim()))
  }
  return Number(median(times).toFixed(4))
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'targettrace-bench-'))
fs.writeFileSync(path.join(root, '.browserslistrc'), [
  '> 0.5%',
  'last 2 versions',
  'Firefox ESR',
  'not dead',
  'not ie 11'
].join('\n') + '\n')
const QUERIES = loadFromConfig(path.join(root, '.browserslistrc'), 'production').queries

const runs = 200
const coldRuns = 25

const warmRows = [
  { label: 'browserslist(queries)', medianMs: benchWarm(() => browserslist(QUERIES), runs) },
  { label: 'trace(queries)', medianMs: benchWarm(() => trace(QUERIES), runs) },
  { label: 'trace(queries, {coverage})', medianMs: benchWarm(() => trace(QUERIES, { coverage: 'global' }), runs) },
  {
    label: 'lint(trace, {coverage})',
    medianMs: benchWarm(() => lint(trace(QUERIES, { coverage: 'global' }), { coverage: 'global' }), runs)
  }
]

const coldRows = [
  { label: 'browserslist(queries)', medianMs: benchCold('browserslist(queries)', coldRuns) },
  { label: 'trace(queries)', medianMs: benchCold('trace(queries)', coldRuns) },
  { label: 'trace(queries, {coverage})', medianMs: benchCold("trace(queries, { coverage: 'global' })", coldRuns) },
  {
    label: 'lint(trace, {coverage})',
    medianMs: benchCold("lint(trace(queries, { coverage: 'global' }), { coverage: 'global' })", coldRuns)
  }
]

for (const rows of [warmRows, coldRows]) {
  const baseline = rows[0].medianMs
  for (const row of rows) row.ratioVsUpstream = Number((row.medianMs / baseline).toFixed(2))
}

const corpusRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'targettrace-bench-corpus-'))
const corpusQueries = []
for (const [index, entry] of corpus.entries.entries()) {
  const dir = path.join(corpusRoot, String(index))
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, '.browserslistrc')
  fs.writeFileSync(file, entry.text)
  try {
    corpusQueries.push(loadFromConfig(file, 'production').queries)
  } catch (error) {
    // skip unresolvable `extends` configs
  }
}

const sweepTimes = []
for (let i = 0; i < 5; i++) {
  const start = performance.now()
  for (const list of corpusQueries) {
    try {
      trace(list)
    } catch (error) {
      // unresolvable `extends`
    }
  }
  sweepTimes.push(performance.now() - start)
}
const sweepMedian = Number(median(sweepTimes).toFixed(2))

const out = {
  generatedAt: new Date().toISOString().slice(0, 10),
  node: process.version,
  browserslist: require('browserslist/package.json').version,
  caniuseLite: require('caniuse-lite/package.json').version,
  platform: process.platform,
  queries: QUERIES,
  clauseCount: QUERIES.length,
  warmRuns: runs,
  coldRuns,
  warm: warmRows,
  cold: coldRows,
  corpusSweep: {
    configs: corpusQueries.length,
    runs: sweepTimes.length,
    medianMs: sweepMedian,
    medianMsPerConfig: Number((sweepMedian / corpusQueries.length).toFixed(3))
  }
}

fs.writeFileSync(path.join(__dirname, '..', 'docs', 'BENCH.json'), JSON.stringify(out, null, 2) + '\n', 'utf8')
fs.rmSync(root, { recursive: true, force: true })
fs.rmSync(corpusRoot, { recursive: true, force: true })

process.stdout.write(`queries: ${JSON.stringify(QUERIES)} (${QUERIES.length} clauses)\n`)
process.stdout.write('warm (same process, caches populated)\n')
for (const row of warmRows) process.stdout.write(`  ${row.label.padEnd(28)} ${String(row.medianMs).padStart(8)} ms  x${row.ratioVsUpstream}\n`)
process.stdout.write('cold (one fresh process per sample)\n')
for (const row of coldRows) process.stdout.write(`  ${row.label.padEnd(28)} ${String(row.medianMs).padStart(8)} ms  x${row.ratioVsUpstream}\n`)
process.stdout.write(`sweep ${corpusQueries.length} real configs: median ${sweepMedian} ms (${out.corpusSweep.medianMsPerConfig} ms/config)\n`)
