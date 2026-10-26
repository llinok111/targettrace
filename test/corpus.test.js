'use strict'

// The corpus is the third-party evidence behind every published number. These
// tests re-run the two claims that matter on it:
//   1. the replay reproduces browserslist exactly for every config,
//   2. order-free attribution really does disagree on real configs.

const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const crypto = require('node:crypto')

const browserslist = require('browserslist')
const { trace } = require('../src/engine')
const { loadFromConfig } = require('../src/config')

const corpus = require('../corpus/configs.json')

function withConfigFile (entry, index, root) {
  const dir = path.join(root, String(index))
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, '.browserslistrc')
  fs.writeFileSync(file, entry.text, 'utf8')
  return file
}

function naiveFinal (queries) {
  const nodes = browserslist.parse(queries)
  const positive = new Set()
  const negative = new Set()
  for (const node of nodes) {
    const text = node.not ? node.query.replace(/^\s*not\s+/i, '') : node.query
    const set = browserslist([text])
    for (const name of set) {
      if (node.not) negative.add(name)
      else positive.add(name)
    }
  }
  return [...positive].filter(name => !negative.has(name)).sort()
}

test('corpus file is intact', () => {
  assert.ok(corpus.entries.length >= 250, `only ${corpus.entries.length} configs`)
  assert.match(corpus.collectedAt, /^\d{4}-\d{2}-\d{2}$/)
  for (const entry of corpus.entries) {
    const digest = crypto.createHash('sha256').update(entry.text, 'utf8').digest('hex')
    assert.strictEqual(digest, entry.sha256, `${entry.repo}:${entry.path} content changed`)
    assert.match(entry.url, /^https:\/\/github\.com\//)
  }
})

test('every loadable corpus config replays exactly', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'targettrace-test-'))
  let traceable = 0
  const skipped = []
  try {
    corpus.entries.forEach((entry, index) => {
      const file = withConfigFile(entry, index, root)
      let loaded
      try {
        loaded = loadFromConfig(file, 'production')
      } catch (error) {
        skipped.push(`${entry.repo}: ${String(error.message).split('\n')[0]}`)
        return
      }
      let result
      try {
        result = trace(loaded.queries, { coverage: 'global' })
      } catch (error) {
        // `extends @scope/config` only fails here, when browserslist resolves it.
        skipped.push(`${entry.repo}: ${String(error.message).split('\n')[0]}`)
        return
      }
      assert.deepStrictEqual(
        result.final.slice().sort(),
        browserslist(loaded.queries).slice().sort(),
        `${entry.repo}:${entry.path}`
      )
      traceable += 1
    })
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }

  assert.ok(traceable >= 260, `only ${traceable} configs traced (skipped ${skipped.length})`)
  assert.ok(skipped.length <= 10, `unexpectedly many skipped configs: ${skipped.join(' | ')}`)
})

test('order-free attribution is wrong on real configs, so replay is required', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'targettrace-naive-'))
  let disagreements = 0
  let compared = 0
  try {
    corpus.entries.forEach((entry, index) => {
      const file = withConfigFile(entry, index, root)
      let loaded
      let actual
      try {
        loaded = loadFromConfig(file, 'production')
        actual = trace(loaded.queries).final.slice().sort()
      } catch (error) {
        return
      }
      const naive = naiveFinal(loaded.queries)
      const same = actual.length === naive.length && actual.every((name, i) => name === naive[i])
      compared += 1
      if (!same) disagreements += 1
    })
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
  assert.ok(compared >= 260, `only ${compared} configs compared`)
  assert.ok(disagreements >= 10, `expected real counterexamples, got ${disagreements}`)
})

test('published measurements agree with this run', () => {
  const measurements = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'docs', 'MEASUREMENTS.json'), 'utf8'))
  assert.strictEqual(measurements.replay.mismatches, 0)
  assert.strictEqual(measurements.versions.browserslist, require('browserslist/package.json').version)
  assert.strictEqual(
    measurements.attribution.compared,
    measurements.buckets.traceable,
    'attribution comparison must cover every traceable config'
  )
})
