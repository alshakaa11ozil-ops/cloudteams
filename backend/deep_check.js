const path = require('path')
const hocuspocusPath = path.join(process.cwd(), 'node_modules', '@hocuspocus', 'server', 'dist', 'hocuspocus-server.cjs')
const { Hocuspocus } = require(hocuspocusPath)

// Read the actual source of handleConnection
const src = require('fs').readFileSync(hocuspocusPath, 'utf8')

// Find handleConnection in source
const idx = src.indexOf('handleConnection(')
if (idx !== -1) {
  console.log('\n=== handleConnection source (first 600 chars after match) ===')
  console.log(src.substring(idx, idx + 600))
} else {
  console.log('handleConnection not found in source text')
}

// Also find openDirectConnection
const idx2 = src.indexOf('openDirectConnection(')
if (idx2 !== -1) {
  console.log('\n=== openDirectConnection source (first 400 chars) ===')
  console.log(src.substring(idx2, idx2 + 400))
}

// Check what the 'ws' package exports
try {
  const ws = require(path.join(process.cwd(), 'node_modules', 'ws'))
  console.log('\n=== ws package exports ===')
  console.log(Object.keys(ws))
} catch(e) {
  console.log('ws not found:', e.message)
}

// Check @hocuspocus/server package.json for version
try {
  const pkg = require(path.join(process.cwd(), 'node_modules', '@hocuspocus', 'server', 'package.json'))
  console.log('\n=== @hocuspocus/server version ===', pkg.version)
  console.log('peer deps:', pkg.peerDependencies)
} catch(e) {}
