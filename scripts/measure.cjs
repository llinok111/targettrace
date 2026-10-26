// Reproducible measurement over corpus/configs.json.
//
// Produces docs/MEASUREMENTS.json, which every number in README.md and
// docs/CORPUS.md is read from. Re-run with: node scripts/measure.cjs
//
// Two things are measured:
//   1. Replay fidelity — the trace must reproduce browserslist's own answer for
//      every collected config (this is the correctness gate for the whole tool).
//   2. Ordered vs order-free attribution — how often a naive "union of clauses"
//      reading gives a different target list than browserslist actually returns.

const fs = require('fs')
const os = require('os')
const path = require('path')

const browserslist = require('browserslist')
const { trace } = require('../src/engine')
const { lint } = require('../src/lint')
const { loadFromConfig } = require('../src/config')

const corpus = require('../corpus/configs.json')

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'targettrace-corpus-'))

function withConfigFile (entry, index) {
  const dir = path.join(tempRoot, String(index))
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, '.browserslistrc')
  fs.writeFileSync(file, entry.text, 'utf8')
  return file
}

function classifyError (error) {
  const message = String(error.message || error)
  if (/Cannot find module/.test(message)) return 'extends-unresolved'
  if (/Missing config for Browserslist environment/.test(message)) return 'env-missing'
  if (error.name === 'BrowserslistError' || error.browserslist === true) return 'invalid-query'
  return 'other-error'
}

// Order-free reading: every clause contributes its own matches, `not` clauses
// subtract globally. This is what a reasonable person writes on a whiteboard,
// and what a per-clause `browserslist([clause])` loop produces.
function naiveFinal (queries) {
  const nodes = browserslist.parse(queries)
  const positive = new Set()
  const negative = new Set()
  for (const node of nodes) {
    const text = node.not ? node.query.replace(/^\s*not\s+/i, '') : node.query
    const set = browserslist([text])
    if (node.not) {
      for (const name of set) negative.add(name)
    } else {
      for (const name of set) positive.add(name)
    }
  }
  const result = []
  for (const name of positive) {
    if (!negative.has(name)) result.push(name)
  }
  return result.sort()
}

function main () {
  const buckets = {
    traceable: 0,
    'extends-unresolved': 0,
    'env-missing': 0,
    'invalid-query': 0,
    'other-error': 0,
    empty: 0
  }
  const failures = []
  const ruleCounts = {}
  const configsWithRule = {}
  const coverageValues = []
  const clauseCounts = []
  let naiveDisagreements = 0
  const naiveExamples = []
  const nodeNotes = []

  corpus.entries.forEach((entry, index) => {
    const trimmed = entry.text.replace(/\r\n?/g, '\n').trim()
    if (trimmed.length === 0) {
      buckets.empty += 1
      return
    }

    const file = withConfigFile(entry, index)
    let loaded
    try {
      loaded = loadFromConfig(file, 'production')
    } catch (error) {
      const kind = classifyError(error)
      buckets[kind] = (buckets[kind] || 0) + 1
      failures.push({ repo: entry.repo, path: entry.path, kind, message: String(error.message).split('\n')[0] })
      return
    }

    let result
    try {
      result = trace(loaded.queries, { coverage: 'global' })
    } catch (error) {
      const kind = error.code === 'TRACE_MISMATCH' ? 'trace-mismatch' : classifyError(error)
      buckets[kind] = (buckets[kind] || 0) + 1
      failures.push({
        repo: entry.repo,
        path: entry.path,
        kind,
        queries: loaded.queries,
        message: String(error.message).split('\n')[0]
      })
      return
    }

    buckets.traceable += 1
    clauseCounts.push(result.steps.length)
    if (result.coverage && typeof result.coverage.global === 'number') {
      coverageValues.push(result.coverage.global)
    }

    const report = lint(result, { coverage: 'global' })
    for (const finding of report.findings) {
      ruleCounts[finding.rule] = (ruleCounts[finding.rule] || 0) + 1
      configsWithRule[finding.rule] = (configsWithRule[finding.rule] || 0) + 1
    }

    const naive = naiveFinal(loaded.queries)
    const actual = result.final.slice().sort()
    const same = naive.length === actual.length && naive.every((name, i) => name === actual[i])
    if (!same) {
      naiveDisagreements += 1
      if (naiveExamples.length < 6) {
        naiveExamples.push({
          repo: `${entry.repo}:${entry.path}`,
          queries: loaded.queries,
          missingFromNaive: actual.filter(name => !naive.includes(name)).slice(0, 6),
          extraInNaive: naive.filter(name => !actual.includes(name)).slice(0, 6),
          sizeActual: actual.length,
          sizeNaive: naive.length
        })
      }
    }
  })

  const sorted = coverageValues.slice().sort((a, b) => a - b)
  const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : null

  const out = {
    generatedAt: new Date().toISOString().slice(0, 10),
    corpus: {
      file: 'corpus/configs.json',
      collectedAt: corpus.collectedAt,
      total: corpus.entries.length,
      distinctShapes: new Set(corpus.entries.map(entry =>
        entry.text.replace(/#[^\n]*/g, '').split('\n').map(line => line.trim()).filter(Boolean).join(' | ')
      )).size
    },
    buckets,
    replay: {
      traceable: buckets.traceable,
      mismatches: buckets['trace-mismatch'] || 0,
      exact: buckets.traceable - (buckets['trace-mismatch'] || 0)
    },
    attribution: {
      naiveDisagreements,
      compared: buckets.traceable,
      examples: naiveExamples
    },
    rules: ruleCounts,
    configsWithRule,
    coverage: {
      samples: coverageValues.length,
      medianGlobal: median === null ? null : Number(median.toFixed(2)),
      min: sorted.length ? Number(sorted[0].toFixed(2)) : null,
      max: sorted.length ? Number(sorted[sorted.length - 1].toFixed(2)) : null
    },
    clauses: {
      total: clauseCounts.reduce((sum, value) => sum + value, 0),
      median: clauseCounts.length
        ? clauseCounts.slice().sort((a, b) => a - b)[Math.floor(clauseCounts.length / 2)]
        : null,
      max: clauseCounts.length ? Math.max(...clauseCounts) : null
    },
    versions: {
      browserslist: require('browserslist/package.json').version,
      caniuseLite: require('caniuse-lite/package.json').version
    },
    failures
  }

  fs.writeFileSync(
    path.join(__dirname, '..', 'docs', 'MEASUREMENTS.json'),
    JSON.stringify(out, null, 2) + '\n',
    'utf8'
  )

  process.stdout.write(JSON.stringify({ buckets, rules: ruleCounts, naiveDisagreements, median, notes: nodeNotes }, null, 2) + '\n')

  if (failures.length) {
    process.stdout.write('\nfailures by kind:\n')
    const byKind = {}
    for (const failure of failures) byKind[failure.kind] = (byKind[failure.kind] || 0) + 1
    process.stdout.write(JSON.stringify(byKind, null, 2) + '\n')
  }

  fs.rmSync(tempRoot, { recursive: true, force: true })
}

main()
