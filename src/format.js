'use strict'

// Plain-text rendering. Kept deliberately dependency-free and column-stable so
// the output can be diffed in CI logs.

const { areaOf } = require('./diff')

function pad (text, width) {
  const value = String(text)
  return value.length >= width ? value : value + ' '.repeat(width - value.length)
}

function padLeft (text, width) {
  const value = String(text)
  return value.length >= width ? value : ' '.repeat(width - value.length) + value
}

function fmtPct (value) {
  return typeof value === 'number' ? `${value.toFixed(2)}%` : '-'
}

function coverageLine (coverage, area) {
  if (!coverage) return ''
  if (typeof coverage === 'number') return `${fmtPct(coverage)} of ${area || 'global'} usage`
  return Object.keys(coverage)
    .map(key => `${fmtPct(coverage[key])} ${key}`)
    .join(' · ')
}

function renderTrace (result, options) {
  const opts = options || {}
  const area = areaOf(opts.coverage)
  const lines = []
  const label = query => `${query}`
  const width = Math.min(
    46,
    Math.max(24, ...result.steps.map(step => label(`${step.not ? 'not ' : ''}${step.text}`).length))
  )

  lines.push(
    pad('#', 3) + pad('clause', width + 2) + padLeft('sel', 5) + padLeft('+', 5) +
    padLeft('-', 5) + padLeft('size', 6) + (opts.coverage ? padLeft('coverage', 10) : '')
  )
  lines.push('-'.repeat(width + 26 + (opts.coverage ? 10 : 0)))

  for (const step of result.steps) {
    const text = `${step.not ? 'not ' : ''}${step.text}`
    lines.push(
      pad(step.index, 3) + pad(text, width + 2) +
      padLeft(step.selectedCount, 5) + padLeft(step.added.length, 5) +
      padLeft(step.removed.length, 5) + padLeft(step.sizeAfter, 6) +
      (opts.coverage ? padLeft(fmtPct(step.coverageAfter && step.coverageAfter[area]), 10) : '')
    )
  }

  lines.push('')
  lines.push(`final: ${result.finalSize} browser(s)`)
  if (opts.coverage) {
    const line = coverageLine(result.coverage, area)
    if (line) lines.push(`coverage: ${line}`)
  }
  lines.push(`data: browserslist ${result.data.browserslist} · caniuse-lite ${result.data.caniuseLite}`)
  return lines.join('\n')
}

function renderLint (result, options) {
  const opts = options || {}
  const lines = []
  if (result.findings.length === 0) {
    lines.push(`no findings (${result.summary.error} error, ${result.summary.warning} warning, ${result.summary.info} info)`)
    return lines.join('\n')
  }

  for (const finding of result.findings) {
    const where = finding.step === null ? '[final]' : `[${finding.step}]`
    lines.push(`${pad(finding.severity, 7)} ${finding.rule} ${pad(where, 7)} ${finding.message}`)
    if (finding.evidence && finding.evidence.examples && finding.evidence.examples.length) {
      lines.push(`${' '.repeat(8)}e.g. ${finding.evidence.examples.join(', ')}`)
    }
  }
  lines.push('')
  lines.push(`summary: ${result.summary.error} error · ${result.summary.warning} warning · ${result.summary.info} info`)
  if (opts.failOn) lines.push(`gate: --fail-on=${opts.failOn}`)
  return lines.join('\n')
}

function renderDiff (result, options) {
  const opts = options || {}
  const lines = []
  lines.push(`A: ${result.a.size} browser(s)${opts.coverage ? ` · ${fmtPct(result.a.coverage)}` : ''}`)
  lines.push(`B: ${result.b.size} browser(s)${opts.coverage ? ` · ${fmtPct(result.b.coverage)}` : ''}`)
  lines.push('')
  lines.push(`only in A (${result.onlyA.length}): ${result.onlyA.join(', ') || '-'}`)
  lines.push(`only in B (${result.onlyB.length}): ${result.onlyB.join(', ') || '-'}`)
  if (opts.coverage && result.coverageDelta !== null) {
    const sign = result.coverageDelta >= 0 ? '+' : ''
    lines.push(`coverage delta: ${sign}${result.coverageDelta.toFixed(2)} points`)
  }
  return lines.join('\n')
}

function renderExplain (entry, options) {
  const opts = options || {}
  const lines = []
  if (!entry) {
    lines.push('browser not present in any clause selection')
    return lines.join('\n')
  }
  lines.push(`${entry.name}: ${entry.survived ? 'in final list' : 'not in final list'}`)
  for (const event of entry.steps) {
    const verb = event.action === 'add' ? 'added by' : 'removed by'
    lines.push(`  ${verb} [${event.index}] ${event.query}`)
  }
  if (entry.steps.length === 0) lines.push('  selected by no clause')
  if (opts.coverage) lines.push(`  clause count: ${entry.steps.length}`)
  return lines.join('\n')
}

module.exports = { renderTrace, renderLint, renderDiff, renderExplain, fmtPct }
