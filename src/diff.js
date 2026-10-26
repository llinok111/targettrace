'use strict'

const { trace } = require('./engine')

function coverageNumber (coverage, area) {
  if (typeof coverage === 'number') return coverage
  if (!coverage) return null
  const key = area || 'global'
  const value = coverage[key]
  return typeof value === 'number' ? value : null
}

function areaOf (coverageOpt) {
  if (typeof coverageOpt === 'string') return coverageOpt
  if (Array.isArray(coverageOpt)) return coverageOpt[0]
  return 'global'
}

function diff (queriesA, queriesB, options) {
  const opts = options || {}
  const ta = trace(queriesA, opts)
  const tb = trace(queriesB, opts)

  const setA = new Set(ta.final)
  const setB = new Set(tb.final)
  const onlyA = ta.final.filter(name => !setB.has(name))
  const onlyB = tb.final.filter(name => !setA.has(name))
  const common = ta.final.filter(name => setB.has(name))
  const area = areaOf(opts.coverage)

  const coverageA = opts.coverage ? coverageNumber(ta.coverage, area) : null
  const coverageB = opts.coverage ? coverageNumber(tb.coverage, area) : null

  return {
    data: ta.data,
    a: { queries: ta.queries, final: ta.final, size: ta.final.length, coverage: coverageA },
    b: { queries: tb.queries, final: tb.final, size: tb.final.length, coverage: coverageB },
    onlyA,
    onlyB,
    common: { count: common.length, browsers: common },
    coverageDelta: coverageA !== null && coverageB !== null
      ? Number((coverageB - coverageA).toFixed(4))
      : null
  }
}

module.exports = { diff, coverageNumber, areaOf }
