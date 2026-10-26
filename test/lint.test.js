'use strict'

const test = require('node:test')
const assert = require('node:assert')

const { trace } = require('../src/engine')
const { lint, shouldFail, RULES } = require('../src/lint')

function rulesFor (queries, options) {
  const traceOptions = Object.assign({}, options)
  const result = trace(queries, traceOptions)
  return lint(result, { coverage: traceOptions.coverage })
}

test('clean configuration reports nothing', () => {
  const report = rulesFor(['defaults'])
  assert.deepStrictEqual(report.findings, [])
  assert.deepStrictEqual(report.summary, { error: 0, warning: 0, info: 0 })
})

test('TT001 dead-clause: a clause that matches but changes nothing', () => {
  const report = rulesFor(['defaults', '> 0.5%'])
  const hit = report.findings.find(finding => finding.rule === 'TT001')
  assert.ok(hit)
  assert.strictEqual(hit.step, 1)
  assert.strictEqual(hit.severity, 'warning')
  assert.ok(hit.evidence.selected > 0)
  assert.match(hit.message, /selected \d+ browser/)
})

test('TT001 ignores `not` clauses so TT003 is not double-reported', () => {
  const report = rulesFor(['defaults', 'not ie 11'])
  assert.strictEqual(report.findings.filter(finding => finding.rule === 'TT001').length, 0)
  assert.strictEqual(report.findings.filter(finding => finding.rule === 'TT003').length, 1)
})

test('TT002 shadowed-clause: additions all removed later', () => {
  const report = rulesFor(['ie 11', 'not ie 11'])
  const hit = report.findings.find(finding => finding.rule === 'TT002')
  assert.ok(hit)
  assert.strictEqual(hit.step, 0)
  assert.deepStrictEqual(hit.evidence.examples, ['ie 11'])
})

test('TT003 no-effect-not: removal matched nothing', () => {
  const report = rulesFor(['defaults', 'not ie 11'])
  const hit = report.findings.find(finding => finding.rule === 'TT003')
  assert.ok(hit)
  assert.strictEqual(hit.step, 1)
  assert.match(hit.message, /removed nothing/)
})

test('TT004 undone-not: a later clause brings the removal back', () => {
  const report = rulesFor(['last 2 versions', 'not ie 11', 'last 1 version'])
  const hit = report.findings.find(finding => finding.rule === 'TT004')
  assert.ok(hit)
  assert.strictEqual(hit.step, 1)
  assert.deepStrictEqual(hit.evidence.examples, ['ie 11'])
  assert.strictEqual(hit.evidence.restored, 1)
})

test('TT005 duplicate-clause', () => {
  const report = rulesFor(['> 1%', '> 1%'])
  const hit = report.findings.find(finding => finding.rule === 'TT005')
  assert.ok(hit)
  assert.strictEqual(hit.step, 1)
  assert.strictEqual(hit.evidence.duplicateOf, 0)
  assert.strictEqual(hit.severity, 'info')
})

test('TT006 eol-targets: final list keeps dead browsers', () => {
  const report = rulesFor(['ie 11'])
  const hit = report.findings.find(finding => finding.rule === 'TT006')
  assert.ok(hit)
  assert.strictEqual(hit.step, null)
  assert.ok(hit.evidence.examples.includes('ie 11'))
})

test('TT006 stays silent when browserslist itself excludes the dead', () => {
  const report = rulesFor(['defaults', 'not dead'])
  assert.strictEqual(report.findings.filter(finding => finding.rule === 'TT006').length, 0)
})

test('TT007 coverage-collapse needs coverage to be requested', () => {
  const without = rulesFor(['> 1% and last 2 versions'])
  assert.strictEqual(without.findings.filter(finding => finding.rule === 'TT007').length, 0)

  const withCoverage = rulesFor(['> 1% and last 2 versions'], { coverage: 'global' })
  const hit = withCoverage.findings.find(finding => finding.rule === 'TT007')
  assert.ok(hit)
  assert.ok(hit.evidence.delta >= 10)
  assert.strictEqual(hit.severity, 'info')
})

test('TT007 threshold is configurable', () => {
  const result = trace(['> 1% and last 2 versions'], { coverage: 'global' })
  const strict = lint(result, { coverage: 'global', collapseThreshold: 1 })
  const loose = lint(result, { coverage: 'global', collapseThreshold: 99 })
  assert.strictEqual(strict.findings.filter(finding => finding.rule === 'TT007').length, 1)
  assert.strictEqual(loose.findings.filter(finding => finding.rule === 'TT007').length, 0)
})

test('findings are ordered by clause, then severity', () => {
  const report = rulesFor(['ie 11', 'not ie 11', 'ie 11'])
  const steps = report.findings.map(finding => finding.step)
  const numbered = steps.filter(step => step !== null)
  assert.deepStrictEqual(numbered, numbered.slice().sort((a, b) => a - b))
  assert.strictEqual(steps[steps.length - 1], null)
})

test('shouldFail respects the severity threshold', () => {
  const warning = rulesFor(['defaults', 'not ie 11'])
  assert.strictEqual(shouldFail(warning, 'warning'), true)
  assert.strictEqual(shouldFail(warning, 'error'), false)

  const info = rulesFor(['> 1% and last 2 versions'], { coverage: 'global' })
  assert.deepStrictEqual(Object.keys(info.summary).filter(key => info.summary[key] > 0), ['info'])
  assert.strictEqual(shouldFail(info, 'info'), true)
  assert.strictEqual(shouldFail(info, 'warning'), false)

  const clean = rulesFor(['defaults'])
  assert.strictEqual(shouldFail(clean, 'info'), false)
})

test('every rule id in RULES is emitted by at least one fixture', () => {
  const fixtures = [
    ['defaults', '> 0.5%'],
    ['ie 11', 'not ie 11'],
    ['defaults', 'not ie 11'],
    ['last 2 versions', 'not ie 11', 'last 1 version'],
    ['> 1%', '> 1%'],
    ['ie 11'],
    ['> 1% and last 2 versions']
  ]
  const seen = new Set()
  for (const queries of fixtures) {
    for (const finding of rulesFor(queries, { coverage: 'global' }).findings) seen.add(finding.rule)
  }
  for (const id of Object.keys(RULES)) {
    assert.ok(seen.has(id), `rule ${id} (${RULES[id].name}) has no fixture`)
  }
})
