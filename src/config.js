'use strict'

// Config loading. Section handling (`[production]`), `extends`, and comment
// stripping all stay inside browserslist (`loadConfig` / `parseConfig`) so the
// queries we trace are exactly the queries a build tool would see.

const fs = require('fs')
const path = require('path')
const browserslist = require('browserslist')

let nodeHelpers = null
function helpers () {
  if (!nodeHelpers) nodeHelpers = require('browserslist/node')
  return nodeHelpers
}

function sectionsOf (text) {
  const parsed = helpers().parseConfig(text)
  return Object.keys(parsed)
}

function loadFromConfig (configPath, env) {
  const resolved = path.resolve(process.cwd(), configPath)
  if (!fs.existsSync(resolved)) {
    const error = new Error(`config file not found: ${resolved}`)
    error.code = 'CONFIG_NOT_FOUND'
    throw error
  }

  let sections = null
  let requested = env
  try {
    sections = sectionsOf(fs.readFileSync(resolved, 'utf8'))
  } catch (error) {
    sections = null
  }

  const picked = browserslist.loadConfig({ config: resolved, env })

  if (picked === undefined) {
    const error = new Error(`no browserslist config found in ${resolved}`)
    error.code = 'CONFIG_EMPTY'
    throw error
  }

  const fallback = Boolean(
    requested && sections && !sections.includes(requested) && sections.includes('defaults')
  )

  return {
    queries: typeof picked === 'string' ? [picked] : picked.slice(),
    source: {
      config: resolved,
      env: requested || null,
      sections,
      fellBackToDefaults: fallback
    }
  }
}

module.exports = { loadFromConfig, sectionsOf }
