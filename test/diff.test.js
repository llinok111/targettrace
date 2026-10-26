'use strict'

const test = require('node:test')
const assert = require('node:assert')

const { diff } = require('../src/diff')

test('diff reports what each side adds', () => {
  const result = diff(['last 2 versions'], ['last 2 versions', 'not ie 11'])
  assert.deepStrictEqual(result.onlyA, ['ie 11'])
  assert.deepStrictEqual(result.onlyB, [])
  assert.strictEqual(result.a.size - result.b.size, 1)
  assert.ok(result.common.count > 0)
})

test('diff of identical query sets is empty', () => {
  const result = diff(['defaults'], ['defaults'])
  assert.deepStrictEqual(result.onlyA, [])
  assert.deepStrictEqual(result.onlyB, [])
  assert.strictEqual(result.a.size, result.b.size)
})

test('diff of a no-op clause shows no target change', () => {
  const result = diff(['defaults'], ['defaults', 'not ie 11'])
  assert.deepStrictEqual(result.onlyA, [])
  assert.deepStrictEqual(result.onlyB, [])
})

test('coverage delta follows the direction of the change', () => {
  const shrink = diff(['last 2 versions'], ['last 2 versions', 'not ie 11'], { coverage: 'global' })
  assert.ok(shrink.coverageDelta < 0)
  assert.ok(shrink.a.coverage > shrink.b.coverage)

  const grow = diff(['last 1 version'], ['last 2 versions'], { coverage: 'global' })
  assert.ok(grow.coverageDelta > 0)
})

test('both sides keep their own provenance data', () => {
  const result = diff(['ie 11'], ['chrome 120'], { coverage: 'global' })
  assert.deepStrictEqual(result.a.final, ['ie 11'])
  assert.deepStrictEqual(result.b.final, ['chrome 120'])
  assert.deepStrictEqual(result.onlyA, ['ie 11'])
  assert.deepStrictEqual(result.onlyB, ['chrome 120'])
  assert.strictEqual(result.data.browserslist, require('browserslist/package.json').version)
})
