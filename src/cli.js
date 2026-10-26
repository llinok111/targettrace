'use strict'

const browserslist = require('browserslist')

const { trace } = require('./engine')
const { lint, shouldFail } = require('./lint')
const { diff } = require('./diff')
const { loadFromConfig } = require('./config')
const format = require('./format')

const EXIT = {
  OK: 0,
  GATE: 1,
  USAGE: 2,
  QUERY: 3,
  CONFIG: 4,
  INTERNAL: 5
}

const USAGE = `targettrace — clause-level explainability for browserslist

Usage:
  targettrace trace   <query...>            clause ledger (+/- per clause)
  targettrace lint    <query...>            rules over the ledger
  targettrace diff    <query...> --vs <query...>
  targettrace explain <browser> <query...>  why one browser is (not) targeted
  targettrace rules                         list rule ids

Query source:
  <query...>              one argument per clause, or a single comma string
  --config=<file>         read queries from .browserslistrc / package.json
  --env=<name>            section to pick from the config (default: production)

Options:
  --coverage[=global|US,CN]   attach usage coverage per clause
  --json                      machine-readable output on stdout
  --fail-on=<severity>        lint gate: info | warning | error (default: warning)
  --collapse=<points>         TT007 threshold in coverage points (default: 10)
  --quiet                     suppress the human summary line
  --version, --help

Exit codes:
  0 clean · 1 gate hit · 2 usage error · 3 invalid browserslist query
  4 config problem · 5 internal replay mismatch
`

function parseArgs (argv) {
  const flags = {}
  const positionals = []
  const vsIndex = argv.indexOf('--vs')
  const before = vsIndex === -1 ? argv : argv.slice(0, vsIndex)
  const after = vsIndex === -1 ? [] : argv.slice(vsIndex + 1)

  for (const token of before) {
    if (token === '--vs') continue
    if (token === '--help' || token === '-h') { flags.help = true; continue }
    if (token === '--version' || token === '-v') { flags.version = true; continue }
    if (token === '--json') { flags.json = true; continue }
    if (token === '--quiet') { flags.quiet = true; continue }
    if (token === '--coverage') { flags.coverage = 'global'; continue }
    if (token.startsWith('--coverage=')) {
      const value = token.slice('--coverage='.length)
      flags.coverage = value.includes(',') ? value.split(',').map(s => s.trim()) : value
      continue
    }
    if (token.startsWith('--config=')) { flags.config = token.slice('--config='.length); continue }
    if (token.startsWith('--env=')) { flags.env = token.slice('--env='.length); continue }
    if (token.startsWith('--fail-on=')) { flags.failOn = token.slice('--fail-on='.length); continue }
    if (token.startsWith('--collapse=')) { flags.collapse = Number(token.slice('--collapse='.length)); continue }
    if (token.startsWith('-')) {
      const error = new Error(`unknown option: ${token}`)
      error.code = 'USAGE'
      throw error
    }
    positionals.push(token)
  }

  return { flags, positionals, second: after.filter(token => token !== '--vs') }
}

function queriesFrom (positionals, flags) {
  if (flags.config) {
    if (positionals.length > 0) {
      const error = new Error('pass either queries or --config, not both')
      error.code = 'USAGE'
      throw error
    }
    return loadFromConfig(flags.config, flags.env)
  }
  if (positionals.length === 0) {
    const error = new Error('missing queries (or --config=<file>)')
    error.code = 'USAGE'
    throw error
  }
  return { queries: positionals.length === 1 ? positionals[0] : positionals, source: null }
}

function traceOptions (flags) {
  const options = {}
  if (flags.coverage) options.coverage = flags.coverage
  if (flags.collapse !== undefined && !Number.isNaN(flags.collapse)) {
    options.collapseThreshold = flags.collapse
  }
  return options
}

function findBrowser (result, target) {
  const wanted = target.trim().toLowerCase()
  const exact = result.browsers.find(entry => entry.name.toLowerCase() === wanted)
  if (exact) return exact
  const matches = result.browsers
    .filter(entry => entry.name.toLowerCase().startsWith(`${wanted} `))
    .sort((a, b) => Number(b.survived) - Number(a.survived))
  return matches[0] || null
}

function run (argv) {
  let parsed
  try {
    parsed = parseArgs(argv)
  } catch (error) {
    process.stderr.write(`targettrace: ${error.message}\n\n${USAGE}`)
    return EXIT.USAGE
  }

  const { flags, positionals, second } = parsed

  if (flags.version) {
    process.stdout.write(`targettrace ${require('../package.json').version}\n`)
    return EXIT.OK
  }

  if (flags.help || positionals.length === 0) {
    process.stdout.write(USAGE)
    return flags.help ? EXIT.OK : EXIT.USAGE
  }

  const command = positionals[0]
  const rest = positionals.slice(1)

  if (command === 'rules') {
    const { RULES } = require('./lint')
    const rows = Object.values(RULES).map(rule =>
      `${rule.id}  ${rule.severity.padEnd(7)} ${rule.name.padEnd(18)} ${rule.summary}`
    )
    if (flags.json) {
      process.stdout.write(JSON.stringify(RULES, null, 2) + '\n')
    } else {
      process.stdout.write(rows.join('\n') + '\n')
    }
    return EXIT.OK
  }

  try {
    if (command === 'trace') {
      const source = queriesFrom(rest, flags)
      const result = trace(source.queries, traceOptions(flags))
      if (flags.json) {
        process.stdout.write(JSON.stringify({ command, ok: true, source: source.source, result }, null, 2) + '\n')
      } else {
        if (source.source) {
          process.stdout.write(`source: ${source.source.config}${source.source.env ? ` (env: ${source.source.env})` : ''}\n`)
          if (source.source.fellBackToDefaults) {
            process.stdout.write(`note: env \`${source.source.env}\` not found; fell back to the defaults section\n`)
          }
          process.stdout.write('\n')
        }
        process.stdout.write(format.renderTrace(result, flags) + '\n')
      }
      return EXIT.OK
    }

    if (command === 'lint') {
      const source = queriesFrom(rest, flags)
      const options = traceOptions(flags)
      const result = trace(source.queries, options)
      const report = lint(result, {
        coverage: options.coverage,
        collapseThreshold: options.collapseThreshold
      })
      const failOn = flags.failOn || 'warning'
      const failed = shouldFail(report, failOn)

      if (flags.json) {
        process.stdout.write(JSON.stringify({
          command,
          ok: !failed,
          failOn,
          source: source.source,
          data: result.data,
          summary: report.summary,
          findings: report.findings,
          finalSize: result.finalSize,
          coverage: result.coverage
        }, null, 2) + '\n')
      } else {
        process.stdout.write(format.renderLint(report, { failOn }) + '\n')
        if (!flags.quiet && report.findings.length > 0) {
          process.stdout.write(failed
            ? `result: gate failed at --fail-on=${failOn}\n`
            : `result: gate passed at --fail-on=${failOn}\n`)
        }
      }
      return failed ? EXIT.GATE : EXIT.OK
    }

    if (command === 'diff') {
      if (second.length === 0) {
        const error = new Error('diff needs two query sets separated by --vs')
        error.code = 'USAGE'
        throw error
      }
      const a = queriesFrom(rest, flags)
      const b = queriesFrom(second, flags)
      const result = diff(a.queries, b.queries, traceOptions(flags))
      if (flags.json) {
        process.stdout.write(JSON.stringify({ command, ok: true, result }, null, 2) + '\n')
      } else {
        process.stdout.write(format.renderDiff(result, flags) + '\n')
      }
      return EXIT.OK
    }

    if (command === 'explain') {
      if (rest.length === 0) {
        const error = new Error('explain needs a browser name, e.g. `explain chrome 120`')
        error.code = 'USAGE'
        throw error
      }
      const target = rest[0]
      const source = queriesFrom(rest.slice(1), flags)
      const result = trace(source.queries, traceOptions(flags))
      const entry = findBrowser(result, target)
      if (flags.json) {
        process.stdout.write(JSON.stringify({
          command,
          ok: entry !== null,
          target,
          entry,
          finalSize: result.finalSize
        }, null, 2) + '\n')
      } else {
        process.stdout.write(format.renderExplain(entry, flags) + '\n')
      }
      return entry ? EXIT.OK : EXIT.GATE
    }

    const error = new Error(`unknown command: ${command}`)
    error.code = 'USAGE'
    throw error
  } catch (error) {
    if (error.code === 'USAGE' || error.code === 'CONFIG_NOT_FOUND' || error.code === 'CONFIG_EMPTY') {
      process.stderr.write(`targettrace: ${error.message}\n`)
      if (error.code === 'USAGE') process.stderr.write(`\n${USAGE}`)
      return error.code === 'USAGE' ? EXIT.USAGE : EXIT.CONFIG
    }
    if (error.name === 'BrowserslistError' || error.browserslist === true) {
      process.stderr.write(`targettrace: ${error.message}\n`)
      return EXIT.QUERY
    }
    if (error.code === 'MODULE_NOT_FOUND') {
      // `extends <pkg>` is resolved by browserslist at query time, so a missing
      // shareable config surfaces here rather than while reading the file.
      process.stderr.write(`targettrace: ${String(error.message).split('\n')[0]}\n`)
      process.stderr.write('hint: an `extends` entry needs that config package installed in this project.\n')
      return EXIT.CONFIG
    }
    if (error.code === 'TRACE_MISMATCH') {
      process.stderr.write(`targettrace: ${error.message}\n`)
      return EXIT.INTERNAL
    }
    if (error.name === 'TypeError') {
      process.stderr.write(`targettrace: ${error.message}\n`)
      return EXIT.USAGE
    }
    throw error
  }
}

module.exports = { run, EXIT, USAGE, parseArgs, findBrowser }
