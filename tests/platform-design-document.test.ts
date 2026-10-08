import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { assertEditableDesign } from '../src/platform/design-document'
const require = createRequire(import.meta.url)
const fixtures = require('./fixtures/drawing-fixtures.cjs')

test('model-valid drawing contexts cannot enter the live editor', () => {
  for (const id of fixtures.fixtureIds)
    assert.throws(() => assertEditableDesign(fixtures.createFixture(id)), /complete Room Planner editor context/)
  assert.throws(() => assertEditableDesign({ legacy: { context: {} } }), /Current Design and drafts were kept/)
})
