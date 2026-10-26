'use strict'

// Packaging invariants. These are the mistakes that only show up after publish:
// a missing bin file, a caret range that silently upgrades browserslist, an
// engine range nobody tested, a `process.exit()` that truncates piped output.

const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..')
const pkg = require('../package.json')

test('the declared node floor is what this project is developed against', () => {
  assert.strictEqual(pkg.engines.node, '>=18')
})

test('the browserslist dependency is pinned exactly', () => {
  assert.match(pkg.dependencies.browserslist, /^\d+\.\d+\.\d+$/)
  assert.strictEqual(pkg.dependencies.browserslist, require('browserslist/package.json').version)
})

test('the bin target exists and is the CLI entry', () => {
  assert.ok(pkg.bin && pkg.bin.targettrace)
  const file = path.join(ROOT, pkg.bin.targettrace)
  assert.ok(fs.existsSync(file), `${pkg.bin.targettrace} missing`)
  assert.match(fs.readFileSync(file, 'utf8'), /require\('\.\.\/src\/cli'\)/)
})

test('published files include everything the CLI needs', () => {
  const required = ['src/', 'bin/', 'LICENSE', 'NOTICE.md', 'README.md']
  for (const entry of required) {
    assert.ok(pkg.files.includes(entry), `${entry} is not in package.json files`)
  }
})

test('library entry exposes the documented surface', () => {
  const api = require('../src/index')
  for (const name of ['trace', 'lint', 'diff', 'loadFromConfig', 'shouldFail', 'RULES']) {
    assert.ok(api[name] !== undefined, `missing export: ${name}`)
  }
  assert.strictEqual(typeof api.trace, 'function')
  assert.strictEqual(typeof api.versions.browserslist, 'string')
})

test('no library file calls process.exit', () => {
  const dir = path.join(ROOT, 'src')
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith('.js')) continue
    const text = fs.readFileSync(path.join(dir, name), 'utf8')
    assert.ok(!/process\.exit\(/.test(text), `src/${name} calls process.exit()`)
  }
})

test('license and provenance files are present', () => {
  const license = fs.readFileSync(path.join(ROOT, 'LICENSE'), 'utf8')
  assert.match(license, /MIT License/)
  assert.match(license, /targettrace contributors/)

  const notice = fs.readFileSync(path.join(ROOT, 'NOTICE.md'), 'utf8')
  assert.match(notice, /browserslist/)
  assert.match(notice, new RegExp(require('browserslist/package.json').version.replace(/\./g, '\\.')))
  assert.match(notice, /MIT/)
  assert.match(notice, /caniuse/)
})

test('the corpus ships with the repository but not inside the npm tarball', () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'corpus', 'configs.json')))
  assert.ok(!pkg.files.some(entry => entry.startsWith('corpus')))
})
