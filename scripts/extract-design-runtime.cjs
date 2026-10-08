const fs = require('node:fs');
const ts = require('typescript');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const code = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)]
  .map(match => match[1]).find(source => source.includes('function roomPlannerConfig'));
const ast = ts.createSourceFile('legacy.js', code, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const declarations = new Map();
for (const statement of ast.statements) {
  if (ts.isFunctionDeclaration(statement) && statement.name)
    declarations.set(statement.name.text, statement.getText(ast));
  if (ts.isVariableStatement(statement)) {
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name)) continue;
      const keyword = statement.declarationList.flags & ts.NodeFlags.Const ? 'const' :
        statement.declarationList.flags & ts.NodeFlags.Let ? 'let' : 'var';
      declarations.set(declaration.name.text, `${keyword} ${declaration.getText(ast)};`);
    }
  }
}
const bridge = fs.readFileSync(path.join(root, 'planner-bridge.js'), 'utf8');
const hooks = bridge.slice(bridge.indexOf('  const sceneForRender=controller.sceneForRender;'),
  bridge.indexOf("  for(const name of ['renderRoomPlanner','roomSaveManualLayout'])"));
const bridgeAst = ts.createSourceFile('bridge.js', bridge, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const methods = new Map();
function findMethods(node) {
  if (ts.isMethodDeclaration(node) && ts.isIdentifier(node.name)) methods.set(node.name.text, node.getText(bridgeAst));
  ts.forEachChild(node, findMethods);
}
findMethods(bridgeAst);
const adapterMethods = ['prepareOpeningDeletion', 'deleteOpening', 'deleteRoom', 'deleteBalcony', 'restoreWall', 'edit', 'addOpening']
  .map(name => methods.get(name)).join(',\n');
const seeds = ['roomLayoutRuntimeAdapter', 'roomCommitManual', 'roomCommitFurniture',
  'roomRotateFurniture', 'roomPlanSignature', 'roomPointToEdge', 'roomPlannerConfig', 'roomPlateFor',
  'deriveRoomGeometry', 'roomPackProgram', 'roomPreserveProgrammeChange', 'roomApplyManualLayout',
  'roomApplySavedBalconies', 'roomUpdateLibrarySummaries', 'initRoomLibrary', 'initComponentPalette',
  'roomChecklistItemsFor', 'roomChecklistAggregate', 'roomApplyChecklistFix', 'roomFixImproved'];
const excluded = new Set(['$', 'renderRoomPlanner', 'roomSvgPlan', 'isNS']);
const included = new Set();
function include(name) {
  if (included.has(name) || excluded.has(name)) return;
  const source = declarations.get(name);
  if (!source) throw new Error(`Missing incumbent declaration ${name}`);
  included.add(name);
  scan(source, name);
}
function scan(source, owner) {
  const parsed = ts.createSourceFile('source.js', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  function walk(node) {
    if (ts.isIdentifier(node) && node.text !== owner && declarations.has(node.text)) include(node.text);
    ts.forEachChild(node, walk);
  }
  walk(parsed);
}
seeds.forEach(include);
scan(hooks);
scan(adapterMethods);
const source = fs.readFileSync(path.join(root, 'scripts', 'design-runtime-host.js'), 'utf8')
  .replace('/* INCUMBENT_HELPERS */', [...declarations].filter(([name]) => included.has(name))
    .map(([, value]) => value).join('\n\n'))
  .replace('/* INCUMBENT_BRIDGE_HOOKS */', hooks);
const complete = source.replace('/* INCUMBENT_EDIT_ADAPTER */', adapterMethods);
const settings = html.slice(html.indexOf('<div class="room-settings-pane">'),
  html.indexOf('    <details class="component-pane" open>'));
const palette = html.slice(html.indexOf('    <details class="component-pane" open>'),
  html.indexOf('    <div class="room-output-pane">'))
  .replace(/<details class="card planner-extension" id="plannerInspector"[^>]*><\/details>/, '');
const controlsSource = `(function(root){root.HomePlannerDesignControls=${JSON.stringify({settings,palette})};})(typeof globalThis!=='undefined'?globalThis:this);\n`;
const output = path.join(root, 'planner-design-runtime.js');
if (process.argv.includes('--check')) {
  if (fs.readFileSync(output, 'utf8') !== complete) throw new Error('Design runtime differs from its incumbent extraction. Regenerate it.');
  if (fs.readFileSync(path.join(root,'planner-design-controls.js'),'utf8') !== controlsSource)
    throw new Error('Design controls differ from the incumbent markup. Regenerate them.');
  console.log(`Design extraction parity: ${included.size} unchanged incumbent declarations and shared opening/render hooks.`);
} else {
  fs.writeFileSync(output, complete);
  fs.writeFileSync(path.join(root,'planner-design-controls.js'),controlsSource);
  console.log(`Extracted ${included.size} incumbent declarations into planner-design-runtime.js.`);
}
