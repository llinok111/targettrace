#!/usr/bin/env node
'use strict'

const { run } = require('../src/cli')

// Set exitCode instead of calling process.exit(): a bare exit would truncate
// piped stdout before the kernel drains it.
const code = run(process.argv.slice(2))
if (code !== 0) process.exitCode = code
