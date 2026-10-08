const fs = require('node:fs')
const physics = process.argv[2] === 'presets' ? require('..\\environment-ui.js') : require('..\\building-physics.js')
if (process.argv[2] === 'presets') {
  process.stdout.write(JSON.stringify(physics.MATERIAL_PRESETS))
  process.exit(0)
}
const inputs = JSON.parse(fs.readFileSync(0, 'utf8'))
process.stdout.write(JSON.stringify(inputs.map(input => physics.assemblyProperties(input.layers, input.films))))
