'use strict'

const test = require('node:test')
const assert = require('node:assert')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const ROOT = path.join(__dirname, '..')
const BIN = path.join(ROOT, 'bin', 'targettrace.js')

function run (args) {
  const result = spawnSync(process.execPath, [BIN, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    env: Object.assign({}, process.env, {
      // Keep output identical across machines that happen to run in CI.
      BROWSERSLIST_DISABLE_CACHE: '',
      NODE_ENV: ''
    })
  })
  return { code: result.status, stdout: result.stdout, stderr: result.stderr }
}

test('trace prints a ledger and exits 0', () => {
  const result = run(['trace', 'defaults'])
  assert.strictEqual(result.code, 0)
  assert.match(result.stdout, /#\s+clause/)
  assert.match(result.stdout, /final: 36 browser\(s\)/)
  assert.match(result.stdout, /data: browserslist \d+\.\d+\.\d+/)
})

test('trace --json is machine readable', () => {
  const result = run(['trace', 'defaults', 'not ie 11', '--json'])
  assert.strictEqual(result.code, 0)
  const payload = JSON.parse(result.stdout)
  assert.strictEqual(payload.ok, true)
  assert.strictEqual(payload.result.steps.length, 2)
  assert.strictEqual(payload.result.steps[1].added.length, 0)
  assert.ok(Array.isArray(payload.result.browsers))
})

test('lint exits 0 on a clean config and 1 when the gate trips', () => {
  const clean = run(['lint', 'defaults'])
  assert.strictEqual(clean.code, 0)
  assert.match(clean.stdout, /no findings/)

  const dirty = run(['lint', 'defaults', 'not ie 11'])
  assert.strictEqual(dirty.code, 1)
  assert.match(dirty.stdout, /TT003/)
  assert.match(dirty.stdout, /gate failed/)

  const relaxed = run(['lint', 'defaults', 'not ie 11', '--fail-on=error'])
  assert.strictEqual(relaxed.code, 0)
  assert.match(relaxed.stdout, /gate passed/)
})

test('lint --json carries the summary and findings', () => {
  const result = run(['lint', 'ie 11', '--json', '--coverage'])
  assert.strictEqual(result.code, 1)
  const payload = JSON.parse(result.stdout)
  assert.strictEqual(payload.ok, false)
  assert.ok(payload.summary.warning >= 1)
  assert.ok(payload.findings.some(finding => finding.rule === 'TT006'))
})

test('usage errors exit 2', () => {
  const noArgs = run(['trace'])
  assert.strictEqual(noArgs.code, 2)
  assert.match(noArgs.stderr, /missing queries/)

  const unknownFlag = run(['trace', 'defaults', '--nope'])
  assert.strictEqual(unknownFlag.code, 2)
  assert.match(unknownFlag.stderr, /unknown option/)

  const bothSources = run(['trace', 'defaults', '--config=test/fixtures/pkg/package.json'])
  assert.strictEqual(bothSources.code, 2)
})

test('invalid queries exit 3 with the browserslist message', () => {
  const result = run(['trace', 'this is not a query'])
  assert.strictEqual(result.code, 3)
  assert.match(result.stderr, /Unknown browser query/)
})

test('config problems exit 4', () => {
  const missing = run(['trace', '--config=missing/.browserslistrc'])
  assert.strictEqual(missing.code, 4)
  assert.match(missing.stderr, /config file not found/)

  const extendsMissing = run(['trace', '--config=test/fixtures/extends/.browserslistrc'])
  assert.strictEqual(extendsMissing.code, 4)
  assert.match(extendsMissing.stderr, /Cannot find module/)
  assert.match(extendsMissing.stderr, /needs that config package installed/)
})

test('--config reads sections and reports the env it used', () => {
  const result = run(['trace', '--config=test/fixtures/sectioned/.browserslistrc', '--env=development'])
  assert.strictEqual(result.code, 0)
  assert.match(result.stdout, /env: development/)
  assert.match(result.stdout, /last 1 chrome version/)

  const fallback = run(['trace', '--config=test/fixtures/sectioned/.browserslistrc', '--env=staging'])
  assert.strictEqual(fallback.code, 0)
  assert.match(fallback.stdout, /fell back to the defaults section/)
})

test('explain shows the provenance chain', () => {
  const inList = run(['explain', 'ie 11', 'last 2 versions'])
  assert.strictEqual(inList.code, 0)
  assert.match(inList.stdout, /ie 11: in final list/)
  assert.match(inList.stdout, /added by \[0\]/)

  const removed = run(['explain', 'ie 11', 'defaults'])
  assert.strictEqual(removed.code, 1)
  assert.match(removed.stdout, /not present in any clause selection/)
})

test('diff needs both sides', () => {
  const missing = run(['diff', 'defaults'])
  assert.strictEqual(missing.code, 2)
  assert.match(missing.stderr, /separated by --vs/)

  const ok = run(['diff', 'last 2 versions', '--vs', 'last 2 versions', 'not ie 11'])
  assert.strictEqual(ok.code, 0)
  assert.match(ok.stdout, /only in A \(1\): ie 11/)
})

test('rules lists every rule id', () => {
  const result = run(['rules'])
  assert.strictEqual(result.code, 0)
  for (const id of ['TT001', 'TT002', 'TT003', 'TT004', 'TT005', 'TT006', 'TT007']) {
    assert.ok(result.stdout.includes(id), `missing ${id}`)
  }
})

test('--version does not print usage', () => {
  const result = run(['--version'])
  assert.strictEqual(result.code, 0)
  assert.match(result.stdout, /^targettrace \d+\.\d+\.\d+/)
})

test('large JSON output is not truncated when piped', () => {
  const result = run(['trace', '> 0.2%', 'not dead', '--json', '--coverage'])
  assert.strictEqual(result.code, 0)
  const payload = JSON.parse(result.stdout)
  assert.ok(result.stdout.length > 0)
  assert.ok(payload.result.steps.length >= 2)
  assert.ok(payload.result.browsers.length > 10)
})
