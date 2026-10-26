'use strict'

// Lint rules run on a trace, so every finding carries the clause index, the
// clause text, and concrete browser names as evidence. No rule guesses: each
// one reads counts that the replay already produced.

const browserslist = require('browserslist')

const RULES = {
  TT001: {
    id: 'TT001',
    name: 'dead-clause',
    severity: 'warning',
    summary: 'A clause selected browsers but changed nothing.'
  },
  TT002: {
    id: 'TT002',
    name: 'shadowed-clause',
    severity: 'warning',
    summary: 'A clause only added browsers that later clauses removed.'
  },
  TT003: {
    id: 'TT003',
    name: 'no-effect-not',
    severity: 'warning',
    summary: 'A `not` clause removed nothing.'
  },
  TT004: {
    id: 'TT004',
    name: 'undone-not',
    severity: 'warning',
    summary: 'Browsers removed by a `not` clause were re-added later.'
  },
  TT005: {
    id: 'TT005',
    name: 'duplicate-clause',
    severity: 'info',
    summary: 'The same clause appears more than once.'
  },
  TT006: {
    id: 'TT006',
    name: 'eol-targets',
    severity: 'warning',
    summary: 'The final target list includes end-of-life browsers.'
  },
  TT007: {
    id: 'TT007',
    name: 'coverage-collapse',
    severity: 'info',
    summary: 'An `and` clause cut coverage sharply.'
  }
}

const SEVERITY_ORDER = { info: 0, warning: 1, error: 2 }

let deadCache = null
function deadSet () {
  if (!deadCache) deadCache = new Set(browserslist(['dead']))
  return deadCache
}

function preview (list, limit) {
  const max = limit || 4
  if (list.length <= max) return list.slice()
  return list.slice(0, max).concat([`+${list.length - max} more`])
}

function clauseLabel (step) {
  return `${step.not ? 'not ' : ''}${step.text}`
}

function coverageValue (coverage, area) {
  if (!coverage) return null
  if (typeof coverage === 'number') return coverage
  const key = area || 'global'
  const value = coverage[key]
  return typeof value === 'number' ? value : null
}

function lint (trace, options) {
  const opts = options || {}
  const area = typeof opts.coverage === 'string'
    ? opts.coverage
    : (Array.isArray(opts.coverage) ? opts.coverage[0] : 'global')
  const findings = []
  const seen = new Map()
  const final = new Set(trace.final)

  for (const step of trace.steps) {
    const label = clauseLabel(step)

    // A `not` clause that removes nothing is TT003's business; reporting it here
    // too would double-count the same defect.
    if (!step.not && step.added.length === 0 && step.removed.length === 0) {
      findings.push({
        rule: 'TT001',
        severity: RULES.TT001.severity,
        step: step.index,
        query: label,
        message: `\`${label}\` selected ${step.selectedCount} browser(s) but changed nothing — every match was already in the list.`,
        evidence: { selected: step.selectedCount, examples: preview(step.selected) }
      })
    }

    if (step.added.length > 0 && step.added.every(name => !final.has(name))) {
      findings.push({
        rule: 'TT002',
        severity: RULES.TT002.severity,
        step: step.index,
        query: label,
        message: `\`${label}\` added ${step.added.length} browser(s), but later clauses removed all of them.`,
        evidence: { added: step.added.length, examples: preview(step.added) }
      })
    }

    if (step.not && step.removed.length === 0) {
      findings.push({
        rule: 'TT003',
        severity: RULES.TT003.severity,
        step: step.index,
        query: label,
        message: `\`${label}\` removed nothing — its matches were already excluded.`,
        evidence: { selected: step.selectedCount, examples: preview(step.selected) }
      })
    }

    if (step.not && step.removed.length > 0) {
      const back = step.removed.filter(name => final.has(name))
      if (back.length > 0) {
        findings.push({
          rule: 'TT004',
          severity: RULES.TT004.severity,
          step: step.index,
          query: label,
          message: `\`${label}\` removed ${step.removed.length} browser(s), but ${back.length} of them were re-added by later clauses.`,
          evidence: { removed: step.removed.length, restored: back.length, examples: preview(back) }
        })
      }
    }

    const normalized = `${step.not ? 'not ' : ''}${step.text.trim().toLowerCase().replace(/\s+/g, ' ')}`
    if (seen.has(normalized)) {
      findings.push({
        rule: 'TT005',
        severity: RULES.TT005.severity,
        step: step.index,
        query: label,
        message: `\`${label}\` repeats clause ${seen.get(normalized)}.`,
        evidence: { duplicateOf: seen.get(normalized) }
      })
    } else {
      seen.set(normalized, step.index)
    }

    if (step.compose === 'and' && opts.coverage) {
      const prev = trace.steps[step.index - 1]
      const before = prev ? coverageValue(prev.coverageAfter, area) : null
      const after = coverageValue(step.coverageAfter, area)
      if (before !== null && after !== null && before - after >= (opts.collapseThreshold || 10)) {
        findings.push({
          rule: 'TT007',
          severity: RULES.TT007.severity,
          step: step.index,
          query: label,
          message: `\`and ${step.text}\` narrowed the list by intersection: coverage fell ${(before - after).toFixed(2)} points (${before.toFixed(2)}% → ${after.toFixed(2)}%).`,
          evidence: { before, after, delta: before - after }
        })
      }
    }
  }

  const dead = deadSet()
  const eol = trace.final.filter(name => dead.has(name))
  if (eol.length > 0) {
    findings.push({
      rule: 'TT006',
      severity: RULES.TT006.severity,
      step: null,
      query: '(final list)',
      message: `${eol.length} end-of-life browser(s) survived into the final list.`,
      evidence: { count: eol.length, examples: preview(eol, 6) }
    })
  }

  findings.sort((a, b) => {
    const byStep = (a.step === null ? 1e9 : a.step) - (b.step === null ? 1e9 : b.step)
    if (byStep !== 0) return byStep
    return SEVERITY_ORDER[b.severity] - SEVERITY_ORDER[a.severity]
  })

  const summary = { error: 0, warning: 0, info: 0 }
  for (const finding of findings) summary[finding.severity] += 1

  return {
    findings,
    summary,
    rules: RULES
  }
}

function shouldFail (result, threshold) {
  const limit = SEVERITY_ORDER[threshold === undefined ? 'warning' : threshold]
  if (limit === undefined) return false
  return result.findings.some(finding => SEVERITY_ORDER[finding.severity] >= limit)
}

module.exports = { lint, shouldFail, RULES, SEVERITY_ORDER, deadSet }
