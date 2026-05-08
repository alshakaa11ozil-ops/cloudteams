const path = require('path')

try {
  // Try loading @hocuspocus/server
  const hocuspocusPath = path.join(process.cwd(), 'node_modules', '@hocuspocus', 'server', 'dist', 'hocuspocus-server.cjs')
  const { Hocuspocus, Server } = require(hocuspocusPath)

  console.log('\n=== @hocuspocus/server exports ===')
  console.log('Has Hocuspocus class:', typeof Hocuspocus)
  console.log('Has Server class:', typeof Server)

  if (Hocuspocus) {
    const instance = new Hocuspocus({ debounce: 1000, extensions: [] })
    const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(instance))
    console.log('\nHocuspocus instance methods:')
    methods.forEach(m => console.log(' -', m))
    console.log('\nhas handleConnection:', typeof instance.handleConnection)
    console.log('has getConnectionsCount:', typeof instance.getConnectionsCount)
  }

  if (Server) {
    const instance = new Server({ debounce: 1000, extensions: [] })
    const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(instance))
    console.log('\nServer instance methods:')
    methods.forEach(m => console.log(' -', m))
    console.log('\nhas handleConnection:', typeof instance.handleConnection)
  }

} catch (e) {
  console.error('Error:', e.message)
  console.log('\nTry checking the dist folder manually:')
  console.log('  ls node_modules/@hocuspocus/server/dist/')
}
