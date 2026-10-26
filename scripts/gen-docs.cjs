// Generates README.md and docs/CORPUS.md from templates plus the measured JSON.
//
// Every number in the generated documentation is a token resolved from
// docs/MEASUREMENTS.json, docs/BENCH.json, docs/VERIFY-DEMO.json and
// docs/TEST.json, so the docs cannot drift away from the measurements they
// claim. `test/docs.test.js` re-renders and compares, and CI runs it.

const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..')

function readJson (relative, fallback) {
  const file = path.join(ROOT, relative)
  if (!fs.existsSync(file)) return fallback
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

function benchRow (bench, phase, label) {
  const row = (bench[phase] || []).find(entry => entry.label === label)
  return row || { medianMs: null, ratioVsUpstream: null }
}

function shapeTable (corpus, limit) {
  const counts = new Map()
  for (const entry of corpus.entries) {
    const shape = entry.text
      .replace(/#[^\n]*/g, '')
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean)
      .join(' | ')
    if (!shape) continue
    counts.set(shape, (counts.get(shape) || 0) + 1)
  }
  const rows = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit)
  return rows.map(([shape, count]) => {
    const clipped = shape.length > 78 ? `${shape.slice(0, 75)}...` : shape
    return `| ${count} | \`${clipped}\` |`
  }).join('\n')
}

function naiveExampleList (measurements) {
  return measurements.attribution.examples.map(example => {
    const onlyA = example.missingFromNaive.length
      ? `missing from the order-free reading: ${example.missingFromNaive.join(', ')}`
      : `${example.extraInNaive.length} extra browsers (e.g. ${example.extraInNaive.slice(0, 3).join(', ')})`
    return `- \`${example.repo}\` — ${example.queries.join(' | ')}\n  - actual ${example.sizeActual} browsers vs order-free ${example.sizeNaive}; ${onlyA}`
  }).join('\n')
}

function failureList (measurements) {
  return measurements.failures.map(failure =>
    `| \`${failure.repo}\` | ${failure.kind} | ${String(failure.message).replace(/\|/g, '\\|').slice(0, 70)} |`
  ).join('\n')
}

function values () {
  const measurements = readJson('docs/MEASUREMENTS.json', null)
  const corpus = readJson('corpus/configs.json', { entries: [] })
  const bench = readJson('docs/BENCH.json', { warm: [], cold: [], corpusSweep: {} })
  const verify = readJson('docs/VERIFY-DEMO.json', { checks: [], shots: {} })
  const verifyLive = readJson('docs/VERIFY-DEMO-LIVE.json', null)
  const tests = readJson('docs/TEST.json', { files: [], tests: null, pass: null, fail: null })
  const pkg = readJson('package.json', {})

  const attribution = measurements
    ? Number((measurements.attribution.naiveDisagreements / measurements.attribution.compared * 100).toFixed(1))
    : null

  const map = {
    'project.version': pkg.version,
    'versions.browserslist': measurements ? measurements.versions.browserslist : null,
    'versions.caniuseLite': measurements ? measurements.versions.caniuseLite : null,
    'tests.files': tests.files.length,
    'tests.count': tests.tests,
    'tests.pass': tests.pass,
    'tests.fail': tests.fail,

    'corpus.total': measurements && measurements.corpus.total,
    'corpus.shapes': measurements && measurements.corpus.distinctShapes,
    'corpus.collectedAt': measurements && measurements.corpus.collectedAt,
    'corpus.traceable': measurements && measurements.buckets.traceable,
    'corpus.extends': measurements && measurements.buckets['extends-unresolved'],
    'corpus.invalid': measurements && measurements.buckets['invalid-query'],
    'corpus.mismatches': measurements && measurements.replay.mismatches,
    'corpus.naiveDisagreements': measurements && measurements.attribution.naiveDisagreements,
    'corpus.compared': measurements && measurements.attribution.compared,
    'corpus.naiveShare': attribution,
    'corpus.clauses.total': measurements && measurements.clauses.total,
    'corpus.clauses.median': measurements && measurements.clauses.median,
    'corpus.clauses.max': measurements && measurements.clauses.max,
    'corpus.coverage.median': measurements && measurements.coverage.medianGlobal,
    'corpus.coverage.min': measurements && measurements.coverage.min,
    'corpus.coverage.max': measurements && measurements.coverage.max,
    'corpus.topShapes': shapeTable(corpus, 10),
    'corpus.naiveExamples': naiveExampleList(measurements),
    'corpus.failures': failureList(measurements),

    'rule.tt001': measurements && measurements.rules.TT001,
    'rule.tt002': measurements && measurements.rules.TT002,
    'rule.tt003': measurements && measurements.rules.TT003,
    'rule.tt004': measurements && measurements.rules.TT004,
    'rule.tt005': measurements && measurements.rules.TT005,
    'rule.tt006': measurements && measurements.rules.TT006,
    'rule.tt007': measurements && measurements.rules.TT007,
    'cfg.tt001': measurements && measurements.configsWithRule.TT001,
    'cfg.tt002': measurements && measurements.configsWithRule.TT002,
    'cfg.tt003': measurements && measurements.configsWithRule.TT003,
    'cfg.tt004': measurements && measurements.configsWithRule.TT004,
    'cfg.tt005': measurements && measurements.configsWithRule.TT005,
    'cfg.tt006': measurements && measurements.configsWithRule.TT006,
    'cfg.tt007': measurements && measurements.configsWithRule.TT007,

    'bench.warm.upstream': benchRow(bench, 'warm', 'browserslist(queries)').medianMs,
    'bench.warm.trace': benchRow(bench, 'warm', 'trace(queries)').medianMs,
    'bench.warm.traceCoverage': benchRow(bench, 'warm', 'trace(queries, {coverage})').medianMs,
    'bench.warm.lint': benchRow(bench, 'warm', 'lint(trace, {coverage})').medianMs,
    'bench.cold.upstream': benchRow(bench, 'cold', 'browserslist(queries)').medianMs,
    'bench.cold.trace': benchRow(bench, 'cold', 'trace(queries)').medianMs,
    'bench.cold.traceCoverage': benchRow(bench, 'cold', 'trace(queries, {coverage})').medianMs,
    'bench.cold.lint': benchRow(bench, 'cold', 'lint(trace, {coverage})').medianMs,
    'bench.cold.ratio': benchRow(bench, 'cold', 'trace(queries)').ratioVsUpstream,
    'bench.cold.ratioCoverage': benchRow(bench, 'cold', 'trace(queries, {coverage})').ratioVsUpstream,
    'bench.warm.ratio': benchRow(bench, 'warm', 'trace(queries)').ratioVsUpstream,
    'bench.sweep.configs': bench.corpusSweep && bench.corpusSweep.configs,
    'bench.sweep.medianMs': bench.corpusSweep && bench.corpusSweep.medianMs,
    'bench.sweep.perConfig': bench.corpusSweep && bench.corpusSweep.medianMsPerConfig,
    'bench.clauses': bench.clauseCount,
    'bench.node': bench.node,
    'bench.platform': bench.platform,

    'verify.checks': verify.checks.length,
    'verify.passed': verify.checks.filter(check => check.ok).length,
    'verify.browser': verify.browser,
    'verify.desktopInk': verify.shots && verify.shots.desktop ? verify.shots.desktop.inkShare : null,
    'verify.desktopColors': verify.shots && verify.shots.desktop ? verify.shots.desktop.colors : null,
    'verify.mobileInk': verify.shots && verify.shots.mobile ? verify.shots.mobile.inkShare : null,
    'verify.liveChecks': verifyLive ? verifyLive.checks.length : null,
    'verify.livePassed': verifyLive ? verifyLive.checks.filter(check => check.ok).length : null
  }

  return { map, measurements }
}

function render (template, map) {
  return template.replace(/\{\{([a-zA-Z0-9_.]+)\}\}/g, (whole, key) => {
    if (!(key in map)) throw new Error(`unknown documentation token: ${key}`)
    const value = map[key]
    if (value === null || value === undefined) throw new Error(`token ${key} has no measured value`)
    return String(value)
  })
}

function generate () {
  const { map, measurements } = values()
  if (!measurements) throw new Error('docs/MEASUREMENTS.json missing; run `node scripts/measure.cjs` first')

  const outputs = [
    { template: 'docs/readme.template.md', out: 'README.md' },
    { template: 'docs/corpus.template.md', out: 'docs/CORPUS.md' }
  ]

  const written = []
  for (const item of outputs) {
    const source = fs.readFileSync(path.join(ROOT, item.template), 'utf8')
    const text = render(source, map)
    written.push({ file: item.out, text })
  }
  return written
}

function main () {
  for (const item of generate()) {
    const target = path.join(ROOT, item.file)
    const previous = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : null
    fs.writeFileSync(target, item.text, 'utf8')
    process.stdout.write(`${previous === item.text ? 'unchanged' : 'wrote'} ${item.file}\n`)
  }
}

module.exports = { generate, values, render }

if (require.main === module) main()
