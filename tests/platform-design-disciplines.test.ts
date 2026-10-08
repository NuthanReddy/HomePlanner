import test from 'node:test'
import assert from 'node:assert/strict'
import { scopedDocument, scripts, styles } from '../src/platform/design-discipline-scope'
import type { PlannerApi } from '../src/domain/project/planner-api'

test('incumbent mounts resolve only their owned subtree and injected authority', () => {
  const planner = { id: 'native-authority' } as unknown as PlannerApi
  const incumbent = { id: 'other-authority' }
  const nodes = [{ id: 'workspaceStructure' }, { id: 'hp-structure-label' }]
  const listeners = new Set()
  const document = {
    getElementById() { throw new Error('Global ID lookup must not be used') },
    createElement() { assert.equal(this, document); return 'owned-document-element' },
  }
  const runtime = {
    HomePlanner: incumbent,
    URL,
    Blob,
    marker: 7,
    confirm() { assert.equal(this, runtime); return true },
  }
  const host = {
    id: 'owned-root', ownerDocument: document,
    querySelectorAll() { return nodes },
    querySelector() { return nodes[0] },
    addEventListener(type: string) { assert.equal(this, host); listeners.add(type) },
    removeEventListener(type: string) { assert.equal(this, host); listeners.delete(type) },
  }
  const scoped = scopedDocument(host as unknown as HTMLElement, planner, runtime as unknown as Window)
  assert.equal((scoped.defaultView as unknown as { HomePlanner: PlannerApi }).HomePlanner, planner)
  assert.equal(runtime.HomePlanner, incumbent)
  assert.equal(scoped.defaultView!.URL, URL)
  assert.equal(scoped.defaultView!.URL.createObjectURL, URL.createObjectURL)
  assert.equal(scoped.getElementById('hp-structure-label'), nodes[1])
  assert.equal(scoped.getElementById('outside-node'), null)
  assert.equal(scoped.body, host)
  assert.equal(scoped.createElement('p'), 'owned-document-element')
  assert.equal(scoped.defaultView!.confirm('Confirm'), true)
  scoped.addEventListener('click', () => {})
  assert.ok(listeners.has('click'))
  scoped.removeEventListener('click', () => {})
  assert.ok(!listeners.has('click'))
})

test('discipline assets reuse incumbent forms and sheets without full portal or GPU', () => {
  for (const name of ['planner-structure-ui', 'planner-elevation-ui', 'planner-facade-ui',
    'planner-services-ui', 'planner-drainage-ui', 'electrical-planner', 'planner-drawing-ui'])
    assert.ok(scripts.includes(name))
  assert.ok(!scripts.includes('index'))
  assert.ok(!scripts.includes('planner-3d'))
  assert.ok(!styles.includes('planner-drainage-ui'))
  assert.ok(scripts.indexOf('planner-services-ui') < scripts.indexOf('planner-drainage-ui'))
  assert.ok(scripts.indexOf('planner-drawing') < scripts.indexOf('planner-drawing-ui'))
})
