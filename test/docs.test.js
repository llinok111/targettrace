'use strict'

// The generated documentation must match the measured JSON. If this test fails,
// run `npm run docs`.

const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')

const { generate } = require('../scripts/gen-docs.cjs')

test('README.md and docs/CORPUS.md are up to date with the measurements', () => {
  for (const item of generate()) {
    const target = path.join(__dirname, '..', item.file)
    assert.ok(fs.existsSync(target), `${item.file} missing; run npm run docs`)
    assert.strictEqual(
      fs.readFileSync(target, 'utf8'),
      item.text,
      `${item.file} is stale; run npm run docs`
    )
  }
})

test('generated docs contain no unresolved tokens or placeholder values', () => {
  for (const item of generate()) {
    assert.ok(!item.text.includes('{{'), `${item.file} has an unresolved token`)
    assert.ok(!/\bundefined\b|\bNaN\b/.test(item.text), `${item.file} contains a placeholder value`)
  }
})

test('every documented number is traceable to a JSON artifact', () => {
  const measurements = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'docs', 'MEASUREMENTS.json'), 'utf8'))
  const readme = fs.readFileSync(path.join(__dirname, '..', 'README.md'), 'utf8')
  const checks = [
    [String(measurements.corpus.total), 'corpus total'],
    [String(measurements.buckets.traceable), 'traceable count'],
    [String(measurements.attribution.naiveDisagreements), 'naive disagreement count']
  ]
  for (const [value, label] of checks) {
    assert.ok(readme.includes(value), `README is missing the ${label} (${value})`)
  }
})
