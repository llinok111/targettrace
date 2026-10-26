// Builds demo/index.html: a single self-contained page with the traces baked in
// at build time. No browser data ships with the page, and no absolute asset
// paths are emitted (the page must work under a /<repo>/ sub-path).

const fs = require('fs')
const path = require('path')

const { trace } = require('../src/engine')
const { lint } = require('../src/lint')

const PRESETS = [
  {
    id: 'defaults',
    label: 'browserslist defaults',
    note: '`defaults` expands to four clauses. Nothing here is dead, and the `not dead` clause is what removes the end-of-life browsers.',
    queries: ['> 0.5%', 'last 2 versions', 'Firefox ESR', 'not dead']
  },
  {
    id: 'noop-not',
    label: 'defaults + not ie 11',
    note: 'One of the most common edits in the wild. `not ie 11` changes nothing here, because `defaults` already excluded it.',
    queries: ['defaults', 'not ie 11']
  },
  {
    id: 'and-narrow',
    label: 'and narrows',
    note: 'A comma unions clauses; `and` intersects them. The intersection quietly drops a quarter of the coverage.',
    queries: ['> 1% and last 2 versions']
  },
  {
    id: 'undone-not',
    label: 'not undone later',
    note: '`not ie 11` works, then `last 1 version` brings ie 11 straight back.',
    queries: ['last 2 versions', 'not ie 11', 'last 1 version']
  },
  {
    id: 'angular',
    label: 'per-engine floors',
    note: 'The Angular-style template: one clause per engine. Every number below is measured, not assumed.',
    queries: [
      'last 1 Chrome version',
      'last 1 Firefox version',
      'last 2 Edge major versions',
      'last 2 Safari major versions',
      'last 2 iOS major versions',
      'Firefox ESR'
    ]
  }
]

const measurementsFile = path.join(__dirname, '..', 'docs', 'MEASUREMENTS.json')
const measurements = fs.existsSync(measurementsFile)
  ? JSON.parse(fs.readFileSync(measurementsFile, 'utf8'))
  : null

function buildPreset (preset) {
  const result = trace(preset.queries, { coverage: 'global' })
  const report = lint(result, { coverage: 'global' })
  const chains = result.browsers
    .map(entry => ({
      name: entry.name,
      survived: entry.survived,
      steps: entry.steps.map(event => ({
        index: event.index,
        query: event.query,
        action: event.action
      }))
    }))
    .sort((a, b) => Number(b.survived) - Number(a.survived) || a.name.localeCompare(b.name))

  return {
    id: preset.id,
    label: preset.label,
    note: preset.note,
    queries: preset.queries,
    steps: result.steps.map(step => ({
      index: step.index,
      text: step.text,
      not: step.not,
      compose: step.compose,
      selected: step.selectedCount,
      add: step.added.length,
      remove: step.removed.length,
      size: step.sizeAfter,
      coverage: step.coverageAfter ? step.coverageAfter.global : null
    })),
    findings: report.findings.map(finding => ({
      rule: finding.rule,
      severity: finding.severity,
      message: finding.message,
      examples: finding.evidence && finding.evidence.examples ? finding.evidence.examples : []
    })),
    finalSize: result.finalSize,
    coverage: result.coverage ? result.coverage.global : null,
    chains,
    replayOk: true
  }
}

const presets = PRESETS.map(buildPreset)

const payload = {
  meta: {
    browserslist: presets.length ? require('browserslist/package.json').version : '',
    caniuseLite: require('caniuse-lite/package.json').version,
    builtAt: new Date().toISOString().slice(0, 10),
    corpusTotal: measurements ? measurements.corpus.total : 0,
    corpusTraceable: measurements ? measurements.buckets.traceable : 0,
    mismatches: measurements ? measurements.replay.mismatches : 0
  },
  presets
}

const template = fs.readFileSync(path.join(__dirname, '..', 'demo', 'template.html'), 'utf8')
const html = template.replace('__PRESETS__', JSON.stringify(payload).replace(/</g, '\\u003c'))

const out = path.join(__dirname, '..', 'demo', 'index.html')
fs.writeFileSync(out, html, 'utf8')
process.stdout.write(`wrote ${path.relative(process.cwd(), out)} (${(Buffer.byteLength(html) / 1024).toFixed(1)} KiB, ${presets.length} presets)\n`)
