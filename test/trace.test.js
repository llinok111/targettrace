'use strict'

const test = require('node:test')
const assert = require('node:assert')

const browserslist = require('browserslist')
const { trace, TraceMismatchError } = require('../src/engine')

const BASIC = [
  ['defaults'],
  ['defaults', 'not ie 11'],
  ['> 0.5%', 'last 2 versions', 'Firefox ESR', 'not dead'],
  ['last 2 versions', 'not ie 11', 'last 1 version'],
  ['> 1% and last 2 versions'],
  ['chrome 120', 'firefox 120', 'not chrome 120'],
  ['> 0.2%', 'not dead', 'not op_mini all', 'last 2 versions', 'not ie 11'],
  ['> 0.2%', 'not dead', 'last 2 versions', 'ie 11'],
  ['current node'],
  ['maintained node versions', 'not dead'],
  ['> 0.5%', 'not dead', '> 0.5%'],
  ['unreleased versions', 'last 2 versions']
]

test('every fixture replays to exactly the browserslist answer', () => {
  for (const queries of BASIC) {
    const result = trace(queries)
    assert.deepStrictEqual(
      result.final.slice().sort(),
      browserslist(queries).slice().sort(),
      `queries: ${JSON.stringify(queries)}`
    )
  }
})

test('fuzz: 400 generated query sets replay without mismatch', () => {
  const vocabulary = [
    'defaults',
    '> 1%',
    '> 0.5%',
    '> 0.2%',
    'last 2 versions',
    'last 1 version',
    'Firefox ESR',
    'not dead',
    'not ie 11',
    'ie 11',
    'ie 9-11',
    'chrome 120',
    'chrome >= 100',
    'safari 17.0',
    'ios_saf 17.2',
    'android >= 4.4',
    'last 2 years',
    'unreleased versions',
    'not op_mini all',
    'not dead and > 0.5%',
    '> 0.2% and last 2 versions',
    'current node',
    'maintained node versions',
    'not and_uc > 0'
  ]
  let seed = 20261026
  const rand = limit => {
    seed = (seed * 1103515245 + 12345) % 2147483648
    return seed % limit
  }

  let checked = 0
  for (let i = 0; i < 400; i++) {
    const size = 1 + rand(5)
    const queries = []
    for (let j = 0; j < size; j++) {
      let query = vocabulary[rand(vocabulary.length)]
      // browserslist rejects a leading `not`; keep the generator honest.
      if (j === 0) query = query.replace(/^not\s+/i, '')
      queries.push(query)
    }
    let expected
    try {
      expected = browserslist(queries)
    } catch (error) {
      continue
    }
    const result = trace(queries)
    assert.deepStrictEqual(
      result.final.slice().sort(),
      expected.slice().sort(),
      `queries: ${JSON.stringify(queries)}`
    )
    checked += 1
  }
  assert.ok(checked > 350, `expected most generated sets to be valid, got ${checked}`)
})

test('ledger arithmetic holds for every step', () => {
  for (const queries of BASIC) {
    const result = trace(queries)
    // The ledger must be replayable on its own: apply added/removed in order and
    // you get the final list back. This is the property a consumer relies on.
    const running = new Set()
    for (const step of result.steps) {
      for (const name of step.added) {
        assert.ok(!running.has(name), `step ${step.index} re-adds ${name}`)
        running.add(name)
      }
      for (const name of step.removed) {
        assert.ok(running.has(name), `step ${step.index} removes absent ${name}`)
        running.delete(name)
      }
      for (const name of step.added) {
        assert.ok(!step.removed.includes(name), `${name} both added and removed in step ${step.index}`)
      }
      assert.strictEqual(step.sizeAfter, running.size, `size mismatch at step ${step.index}`)
    }
    assert.deepStrictEqual([...running].sort(), result.final.slice().sort())
    assert.strictEqual(
      result.steps.reduce((sum, step) => sum + step.added.length - step.removed.length, 0),
      result.finalSize
    )
  }
})

test('provenance explains every surviving browser', () => {
  for (const queries of BASIC) {
    const result = trace(queries)
    const byName = new Map(result.browsers.map(entry => [entry.name, entry]))
    for (const name of result.final) {
      const entry = byName.get(name)
      assert.ok(entry, `${name} has no provenance row`)
      assert.strictEqual(entry.survived, true)
      const adds = entry.steps.filter(event => event.action === 'add')
      assert.ok(adds.length >= 1, `${name} survived without ever being added`)
      const last = entry.steps[entry.steps.length - 1]
      assert.strictEqual(last.action, 'add', `${name} ends on a removal but survived`)
    }
    for (const entry of result.browsers) {
      if (entry.survived) continue
      if (entry.steps.length === 0) continue // only ever matched by a `not` clause
      const last = entry.steps[entry.steps.length - 1]
      assert.strictEqual(last.action, 'remove', `${entry.name} was dropped without a removal event`)
    }
  }
})

test('coverage is attached per step and matches the final list', () => {
  const result = trace(['defaults', 'not ie 11'], { coverage: 'global' })
  assert.strictEqual(typeof result.coverage.global, 'number')
  assert.strictEqual(result.steps[0].coverageAfter.global, result.coverage.global)
  const again = browserslist.coverage(result.final, 'global')
  assert.strictEqual(Number(result.coverage.global.toFixed(6)), Number(again.toFixed(6)))
})

test('trace reports the data versions it was produced with', () => {
  const result = trace(['defaults'])
  assert.strictEqual(result.data.browserslist, require('browserslist/package.json').version)
  assert.match(String(result.data.caniuseLite), /^\d+\.\d+\.\d+/)
})

test('invalid queries keep the upstream error', () => {
  assert.throws(() => trace(['definitely not a query']), error => {
    assert.strictEqual(error.name, 'BrowserslistError')
    return true
  })
})

test('mismatch error carries both sides for diagnosis', () => {
  const error = new TraceMismatchError(['x'], ['chrome 120', 'ie 11'], ['chrome 120'])
  assert.strictEqual(error.code, 'TRACE_MISMATCH')
  assert.match(error.message, /1 missing \(ie 11\)/)
  assert.match(error.message, /0 extra/)
})

test('query argument validation', () => {
  assert.throws(() => trace(42), TypeError)
  assert.throws(() => trace([1, 2]), TypeError)
  assert.deepStrictEqual(trace('defaults').queries, ['defaults'])
})
