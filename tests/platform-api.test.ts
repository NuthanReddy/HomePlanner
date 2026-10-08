import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { ApiError, platformApi } from '../src/platform/api.ts'

const originalFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = originalFetch })

test('uses same-origin cookies, JSON and CSRF with expected version', async () => {
  const record = { id: 'stable-id', name: 'Original', version: 3, created_at: 1, updated_at: 2 }
  globalThis.fetch = async (input, init) => {
    assert.equal(input, '/api/v1/projects/stable-id')
    assert.equal(init?.credentials, 'same-origin')
    assert.equal(init?.method, 'PATCH')
    assert.deepEqual(init?.headers, { 'Content-Type': 'application/json', 'X-CSRF-Token': 'csrf' })
    assert.deepEqual(JSON.parse(String(init?.body)), { name: 'Edited', expected_version: 3 })
    return Response.json({ ...record, name: 'Edited', version: 4 })
  }
  assert.equal((await platformApi.rename(record, 'Edited', 'csrf')).version, 4)
})

test('retains explicit conflict status rather than returning fake success', async () => {
  globalThis.fetch = async () => Response.json({ detail: 'Project changed elsewhere.' }, { status: 409 })
  await assert.rejects(platformApi.create('csrf'), (error: unknown) =>
    error instanceof ApiError && error.status === 409 && error.message === 'Project changed elsewhere.')
})

test('invalid response shapes do not become an empty project list', async () => {
  globalThis.fetch = async () => Response.json({ items: null })
  await assert.rejects(platformApi.projects(), /invalid project list/)
})

test('logout handles a bodyless response', async () => {
  globalThis.fetch = async () => new Response(null, { status: 204 })
  await platformApi.logout('csrf')
})

test('network failure remains visible to caller', async () => {
  globalThis.fetch = async () => { throw new TypeError('Network unavailable') }
  await assert.rejects(platformApi.session(), /Network unavailable/)
})

test('local inbox remains explicit and validates random-code response shape', async () => {
  globalThis.fetch = async () => Response.json({ mode: 'local-inbox' })
  assert.equal(await platformApi.delivery(), 'local-inbox')
  globalThis.fetch = async () => Response.json({ code: '123456', delivery: 'simulated-local-only' })
  assert.equal(await platformApi.localCode('ticket'), '123456')
  globalThis.fetch = async () => Response.json({ code: '123456', delivery: 'sms' })
  await assert.rejects(platformApi.localCode('ticket'), /Invalid local inbox/)
})

test('Python results retain project identity and utility scope', async () => {
  const record = { id: 'project', name: 'Local', version: 2, created_at: 1, updated_at: 1 }
  globalThis.fetch = async (input, init) => {
    assert.equal(input, '/api/v1/projects/project/analysis/air-density')
    assert.deepEqual(JSON.parse(String(init?.body)), { inputs: { temperatureC: 25 } })
    return Response.json({ project_id: 'project', metadata_version: 2,
      scope: 'supplied-input-utility-not-plan-study',
      result: { status: 'ok', kind: 'air-density', output: {}, engine: {} } })
  }
  assert.equal((await platformApi.calculate(record, 'air-density', { temperatureC: 25 }, 'csrf')).metadata_version, 2)
  globalThis.fetch = async () => Response.json({ scope: 'plan-study' })
  await assert.rejects(platformApi.calculate(record, 'air-density', {}, 'csrf'), /Invalid calculation scope/)
})
