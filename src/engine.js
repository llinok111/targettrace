'use strict'

// targettrace engine.
//
// Invariant: the traced result must always equal what `browserslist()` returns
// for the same queries. browserslist is treated as the single source of truth:
// every trace runs the upstream call once, replays the clause reduction, and
// throws if the replay disagrees. Nothing here patches or re-implements the
// query matchers — only the 15-line reduction loop is mirrored, because
// browserslist does not expose per-clause set operations.

const browserslist = require('browserslist')

const BROWSERSLIST_VERSION = require('browserslist/package.json').version

// Options browserslist understands; anything else is ignored by upstream too.
const OPTION_KEYS = [
  'env',
  'path',
  'stats',
  'config',
  'mobileToDesktop',
  'ignoreUnknownVersions',
  'dangerousExtend',
  'throwOnMissing',
  'customUsage'
]

class TraceMismatchError extends Error {
  constructor (queries, upstream, replayed) {
    const missing = upstream.filter(item => !replayed.includes(item))
    const extra = replayed.filter(item => !upstream.includes(item))
    super(
      'trace replay disagreed with browserslist: ' +
      `${missing.length} missing (${missing.slice(0, 3).join(', ') || '-'}), ` +
      `${extra.length} extra (${extra.slice(0, 3).join(', ') || '-'})`
    )
    this.name = 'TraceMismatchError'
    this.code = 'TRACE_MISMATCH'
    this.queries = queries
    this.upstream = upstream
    this.replayed = replayed
  }
}

function caniuseVersion () {
  try {
    return require('caniuse-lite/package.json').version
  } catch (error) {
    return null
  }
}

function normalizeQueries (queries) {
  if (typeof queries === 'string') return [queries]
  if (Array.isArray(queries)) {
    for (const item of queries) {
      if (typeof item !== 'string') {
        throw new TypeError('queries must be a string or an array of strings')
      }
    }
    return queries.slice()
  }
  if (queries === undefined || queries === null) return undefined
  throw new TypeError('queries must be a string or an array of strings')
}

function pickOptions (options) {
  const picked = {}
  if (!options) return picked
  for (const key of OPTION_KEYS) {
    if (options[key] !== undefined) picked[key] = options[key]
  }
  return picked
}

function clauseText (node) {
  if (!node.not) return node.query
  return node.query.replace(/^\s*not\s+/i, '')
}

// Evaluate one clause on its own. browserslist applies the same "browser 0"
// remapping inside its own reducer, so a standalone call returns exactly the
// set the reducer saw.
function selectClause (node, context) {
  return browserslist([clauseText(node)], context)
}

function uniqPush (target, items) {
  for (const item of items) {
    if (!target.includes(item)) target.push(item)
  }
}

function replay (nodes, context) {
  const states = []
  let current = []

  nodes.forEach((node, index) => {
    const before = current
    const selected = selectClause(node, context)
    const selectedSet = new Set(selected)
    const added = []
    const removed = []

    if (node.not) {
      current = before.filter(item => !selectedSet.has(item))
      for (const item of before) {
        if (selectedSet.has(item)) removed.push(item)
      }
    } else if (node.compose === 'or') {
      const merged = before.slice()
      uniqPush(merged, selected)
      for (const item of merged) {
        if (!before.includes(item)) added.push(item)
      }
      current = merged
    } else {
      current = before.filter(item => selectedSet.has(item))
      for (const item of before) {
        if (!selectedSet.has(item)) removed.push(item)
      }
      for (const item of current) {
        if (!before.includes(item)) added.push(item)
      }
    }

    states.push({
      index,
      query: node.query,
      text: clauseText(node),
      not: node.not === true,
      compose: node.compose,
      type: node.type,
      selected,
      added,
      removed,
      before: before.slice(),
      after: current.slice()
    })
  })

  return states
}

function coverageOf (list, areas) {
  if (!areas) return null
  const value = browserslist.coverage(list, areas)
  if (typeof value === 'number') {
    return { [typeof areas === 'string' ? areas : 'global']: value }
  }
  return value
}

function buildProvenance (states, finalSet) {
  const seen = new Map()

  const touch = name => {
    if (!seen.has(name)) {
      seen.set(name, { name, steps: [], survived: false })
    }
    return seen.get(name)
  }

  for (const state of states) {
    for (const name of state.selected) touch(name)
    for (const name of state.added) {
      touch(name).steps.push({ index: state.index, query: state.query, action: 'add' })
    }
    for (const name of state.removed) {
      touch(name).steps.push({ index: state.index, query: state.query, action: 'remove' })
    }
  }

  for (const entry of seen.values()) {
    entry.survived = finalSet.has(entry.name)
  }

  return [...seen.values()]
}

function trace (queries, options) {
  const opts = options || {}
  const list = normalizeQueries(queries)
  const context = pickOptions(opts)

  // 1. Upstream answer (throws the upstream error for bad queries).
  const upstream = browserslist(list, context)

  // 2. Parsed clause list (public API, no re-parsing of our own).
  const nodes = browserslist.parse(list, context)

  // 3. Replay the reduction, recording what each clause did.
  const states = replay(nodes, context)

  const replayed = []
  uniqPush(replayed, states.length === 0 ? [] : states[states.length - 1].after)
  const upstreamSorted = upstream.slice().sort()
  const replayedSorted = replayed.slice().sort()
  if (
    upstreamSorted.length !== replayedSorted.length ||
    upstreamSorted.some((item, i) => item !== replayedSorted[i])
  ) {
    throw new TraceMismatchError(list, upstreamSorted, replayedSorted)
  }

  const finalSet = new Set(upstream)
  const coverageArea = opts.coverage === undefined ? null : opts.coverage
  let running = []
  const steps = states.map(state => {
    running = state.after
    return {
      index: state.index,
      query: state.query,
      text: state.text,
      not: state.not,
      compose: state.compose,
      type: state.type,
      selectedCount: state.selected.length,
      selected: state.selected,
      added: state.added,
      removed: state.removed,
      sizeAfter: state.after.length,
      coverageAfter: coverageArea ? coverageOf(running, coverageArea) : null
    }
  })

  return {
    queries: list || browserslist.defaults.slice(),
    options: context,
    data: {
      browserslist: BROWSERSLIST_VERSION,
      caniuseLite: caniuseVersion()
    },
    final: upstream,
    finalSize: upstream.length,
    coverage: coverageArea ? coverageOf(upstream, coverageArea) : null,
    steps,
    browsers: buildProvenance(states, finalSet)
  }
}

module.exports = {
  trace,
  TraceMismatchError,
  BROWSERSLIST_VERSION,
  caniuseVersion,
  clauseText,
  pickOptions,
  normalizeQueries
}
