export type ProjectRecord = Readonly<{
  id: string
  name: string
  version: number
  created_at: number
  updated_at: number
}>

export type AccountSession = Readonly<{ user_id: string; csrf_token: string }>
export type Challenge = Readonly<{
  challenge_id: string; expires_in: number; resend_after: number; local_inbox_ticket?: string
}>
export type Jobs = Readonly<{ items: unknown[]; availability: string; reason: string }>
export type PythonCalculation = Readonly<{
  project_id: string; metadata_version: number
  scope: 'supplied-input-utility-not-plan-study'; result: Record<string, unknown>
}>

export class ApiError extends Error {
  constructor(public readonly status: number, message: string) { super(message) }
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('The API returned an invalid response.')
  }
  return value as Record<string, unknown>
}

function string(value: unknown): string {
  if (typeof value !== 'string') throw new Error('The API returned an invalid string.')
  return value
}

function integer(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error('The API returned an invalid integer.')
  }
  return value
}

function project(value: unknown): ProjectRecord {
  const data = object(value)
  return {
    id: string(data.id), name: string(data.name), version: integer(data.version),
    created_at: integer(data.created_at), updated_at: integer(data.updated_at),
  }
}

function account(value: unknown): AccountSession {
  const data = object(value)
  return { user_id: string(data.user_id), csrf_token: string(data.csrf_token) }
}

export async function request(path: string, method = 'GET', body?: unknown, csrf?: string): Promise<unknown> {
  const response = await fetch(`/api/v1${path}`, {
    method, credentials: 'same-origin', cache: 'no-store',
    headers: {
      ...(method === 'GET' ? {} : { 'Content-Type': 'application/json' }),
      ...(csrf ? { 'X-CSRF-Token': csrf } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!response.ok) {
    const data = object(await response.json())
    const detail = data.detail
    const message = typeof detail === 'string' ? detail :
      Array.isArray(detail) ? detail.map(entry => string(object(entry).msg)).join(' ') :
        `Request failed (${response.status}).`
    throw new ApiError(response.status, message)
  }
  return response.status === 204 ? null : response.json()
}

export const platformApi = {
  calculate: async (record: ProjectRecord, kind: 'solar-position' | 'air-density',
    inputs: Record<string, unknown>, csrf: string): Promise<PythonCalculation> => {
    const data = object(await request(`/projects/${encodeURIComponent(record.id)}/analysis/${kind}`,
      'POST', { inputs }, csrf))
    if (data.scope !== 'supplied-input-utility-not-plan-study') throw new Error('Invalid calculation scope.')
    const result = object(data.result)
    if (result.status !== 'ok' || result.kind !== kind) throw new Error('Invalid calculation result.')
    object(result.output); object(result.engine)
    return { project_id: string(data.project_id), metadata_version: integer(data.metadata_version),
      scope: data.scope, result }
  },
  delivery: async (): Promise<'local-inbox' | 'sms'> => {
    const data = object(await request('/auth/delivery'))
    if (data.mode !== 'local-inbox' && data.mode !== 'sms') throw new Error('Invalid delivery mode.')
    return data.mode
  },
  localCode: async (ticket: string): Promise<string> => {
    const data = object(await request('/auth/local-inbox', 'POST', { ticket }))
    if (data.delivery !== 'simulated-local-only' || typeof data.code !== 'string'
      || !/^[0-9]{6}$/.test(data.code)) throw new Error('Invalid local inbox response.')
    return data.code
  },
  session: async () => account(await request('/auth/session')),
  challenge: async (phone: string): Promise<Challenge> => {
    const data = object(await request('/auth/challenges', 'POST', { phone }))
    return {
      challenge_id: string(data.challenge_id), expires_in: integer(data.expires_in),
      resend_after: integer(data.resend_after),
      ...(data.local_inbox_ticket === undefined ? {} : { local_inbox_ticket: string(data.local_inbox_ticket) }),
    }
  },
  verify: async (challenge_id: string, code: string) =>
    account(await request('/auth/verify', 'POST', { challenge_id, code })),
  logout: async (csrf: string) => { await request('/auth/logout', 'POST', {}, csrf) },
  projects: async (offset = 0): Promise<ProjectRecord[]> => {
    const data = object(await request(`/projects?offset=${offset}`))
    if (!Array.isArray(data.items)) throw new Error('The API returned an invalid project list.')
    return data.items.map(project)
  },
  create: async (csrf: string) => project(await request('/projects', 'POST', {}, csrf)),
  project: async (id: string) => project(await request(`/projects/${encodeURIComponent(id)}`)),
  rename: async (record: ProjectRecord, name: string, csrf: string) =>
    project(await request(`/projects/${encodeURIComponent(record.id)}`, 'PATCH',
      { name, expected_version: record.version }, csrf)),
  jobs: async (id: string): Promise<Jobs> => {
    const data = object(await request(`/projects/${encodeURIComponent(id)}/jobs`))
    if (!Array.isArray(data.items)) throw new Error('The API returned an invalid job list.')
    return { items: data.items, availability: string(data.availability), reason: string(data.reason) }
  },
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'An unexpected error occurred.'
}
