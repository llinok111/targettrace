// Collects real-world `.browserslistrc` files through the GitHub code search
// API so the audit numbers in docs/CORPUS.md can be reproduced by anyone with
// `gh` authenticated. Output: corpus/configs.json (committed on purpose — it is
// the evidence behind every published number).
//
// Usage: node scripts/collect-corpus.mjs [--pages 3] [--per-page 100]

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { execFileSync } = require('child_process')

const args = process.argv.slice(2)
function arg (name, fallback) {
  const hit = args.find(item => item.startsWith(`--${name}=`))
  return hit ? Number(hit.split('=')[1]) : fallback
}

const PAGES = arg('pages', 3)
const PER_PAGE = arg('per-page', 100)
const MAX_BYTES = 4096

function gh (apiArgs) {
  return execFileSync('gh', ['api', ...apiArgs], {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024
  })
}

function search (page) {
  const out = gh([
    '-X', 'GET', 'search/code',
    '-f', 'q=filename:.browserslistrc',
    '-f', `per_page=${PER_PAGE}`,
    '-f', `page=${page}`,
    '--jq', '.items[] | [.repository.full_name, .path] | @tsv'
  ])
  return out.split('\n').filter(Boolean).map(line => {
    const [repo, filePath] = line.split('\t')
    return { repo, path: filePath }
  })
}

function fetchFile (repo, filePath) {
  return gh([
    `repos/${repo}/contents/${encodeURI(filePath)}`,
    '-H', 'Accept: application/vnd.github.raw'
  ])
}

function main () {
  const seen = new Set()
  const entries = []

  for (let page = 1; page <= PAGES; page++) {
    const hits = search(page)
    process.stderr.write(`page ${page}: ${hits.length} hits\n`)
    for (const hit of hits) {
      if (!/\.browserslistrc$/.test(hit.path)) continue
      const key = `${hit.repo}:${hit.path}`
      if (seen.has(key)) continue
      seen.add(key)
      let text
      try {
        text = fetchFile(hit.repo, hit.path)
      } catch (error) {
        process.stderr.write(`  skip ${key}: ${String(error.message).slice(0, 80)}\n`)
        continue
      }
      if (Buffer.byteLength(text, 'utf8') > MAX_BYTES) {
        process.stderr.write(`  skip ${key}: too large\n`)
        continue
      }
      entries.push({
        repo: hit.repo,
        path: hit.path,
        url: `https://github.com/${hit.repo}/blob/HEAD/${hit.path}`,
        sha256: crypto.createHash('sha256').update(text, 'utf8').digest('hex'),
        text
      })
    }
  }

  const out = {
    collectedAt: new Date().toISOString().slice(0, 10),
    source: 'GitHub code search: filename:.browserslistrc',
    count: entries.length,
    entries
  }
  const target = path.join(__dirname, '..', 'corpus', 'configs.json')
  fs.writeFileSync(target, JSON.stringify(out, null, 2) + '\n', 'utf8')
  process.stderr.write(`wrote ${entries.length} configs to ${target}\n`)
}

main()
