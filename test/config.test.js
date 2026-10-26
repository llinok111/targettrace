'use strict'

const test = require('node:test')
const assert = require('node:assert')
const path = require('node:path')

const { loadFromConfig, sectionsOf } = require('../src/config')
const { trace } = require('../src/engine')

const fixture = name => path.join(__dirname, 'fixtures', name, '.browserslistrc')

test('sections are listed from a config file', () => {
  const sections = sectionsOf(require('node:fs').readFileSync(fixture('sectioned'), 'utf8'))
  assert.deepStrictEqual(sections, ['defaults', 'production', 'development'])
})

test('env picks the matching section', () => {
  const production = loadFromConfig(fixture('sectioned'), 'production')
  assert.deepStrictEqual(production.queries, ['> 0.5%', 'last 2 versions', 'not dead'])
  assert.strictEqual(production.source.fellBackToDefaults, false)
  assert.deepStrictEqual(production.source.sections, ['defaults', 'production', 'development'])

  const development = loadFromConfig(fixture('sectioned'), 'development')
  assert.deepStrictEqual(development.queries, ['last 1 chrome version', 'last 1 firefox version'])
})

test('unknown env falls back to defaults and says so', () => {
  const loaded = loadFromConfig(fixture('sectioned'), 'staging')
  assert.deepStrictEqual(loaded.queries, ['defaults'])
  assert.strictEqual(loaded.source.fellBackToDefaults, true)
  assert.strictEqual(loaded.source.env, 'staging')
})

test('inline comments are stripped the way browserslist strips them', () => {
  const loaded = loadFromConfig(fixture('inline'), 'production')
  assert.deepStrictEqual(loaded.queries, ['last 2 versions', 'not IE 11'])
  const result = trace(loaded.queries)
  assert.ok(!result.final.includes('ie 11'))
})

test('package.json browsrslist field is accepted', () => {
  const file = path.join(__dirname, 'fixtures', 'pkg', 'package.json')
  const loaded = loadFromConfig(file, null)
  assert.deepStrictEqual(loaded.queries, ['> 1%', 'not dead'])
})

test('missing config file reports a typed error', () => {
  assert.throws(() => loadFromConfig('does/not/exist/.browserslistrc', 'production'), error => {
    assert.strictEqual(error.code, 'CONFIG_NOT_FOUND')
    return true
  })
})
