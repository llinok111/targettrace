// Deterministic test entry point.
//
// `node --test test/` is not portable (Node 18 rejects directory arguments on
// some platforms, and shell globs behave differently under cmd.exe), so the
// file list is expanded here and passed explicitly.
//
// The node:test summary is captured, echoed, and stored in docs/TEST.json so the
// documented test counts are the ones that actually ran.

const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const root = path.join(__dirname, '..')
const testDir = path.join(root, 'test')
const files = fs.readdirSync(testDir)
  .filter(name => name.endsWith('.test.js'))
  .sort()
  .map(name => path.join(testDir, name))

if (files.length === 0) {
  process.stderr.write('no test files found\n')
  process.exit(1)
}

const result = spawnSync(process.execPath, ['--test', ...files], {
  cwd: root,
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024
})

if (result.error) {
  process.stderr.write(String(result.error) + '\n')
  process.exit(1)
}

const stdout = result.stdout || ''
const stderr = result.stderr || ''
process.stdout.write(stdout)
process.stderr.write(stderr)

function summaryNumber (label) {
  const match = stdout.match(new RegExp(`^# ${label} ([\\d.]+)$`, 'm'))
  return match ? Number(match[1]) : null
}

const summary = {
  generatedAt: new Date().toISOString().slice(0, 10),
  files: files.map(file => path.relative(root, file).replace(/\\/g, '/')),
  tests: summaryNumber('tests'),
  pass: summaryNumber('pass'),
  fail: summaryNumber('fail'),
  skipped: summaryNumber('todo'),
  exitCode: result.status === null ? 1 : result.status
}

if (summary.tests === null) {
  process.stderr.write('could not read the node:test summary; not writing docs/TEST.json\n')
} else {
  fs.writeFileSync(path.join(root, 'docs', 'TEST.json'), JSON.stringify(summary, null, 2) + '\n', 'utf8')
}

process.exit(summary.exitCode)
