'use strict'

const { trace, TraceMismatchError, BROWSERSLIST_VERSION, caniuseVersion } = require('./engine')
const { lint, shouldFail, RULES } = require('./lint')
const { diff } = require('./diff')
const { loadFromConfig, sectionsOf } = require('./config')

module.exports = {
  trace,
  lint,
  shouldFail,
  diff,
  loadFromConfig,
  sectionsOf,
  RULES,
  TraceMismatchError,
  versions: {
    browserslist: BROWSERSLIST_VERSION,
    caniuseLite: caniuseVersion()
  }
}
