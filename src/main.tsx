import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './app/App'
import {
  createLegacyPlannerApi,
  hasLegacyPlannerGlobal,
  LegacyPlannerIntegrationError,
} from './domain/project/legacy-planner-api'
import type { PlannerApi } from './domain/project/planner-api'
import './app/App.css'

const rootElement = document.getElementById('root')

if (!rootElement) {
  throw new Error('React migration preview root element was not found.')
}

let plannerApi: PlannerApi | undefined
let integrationDiagnostic: LegacyPlannerIntegrationError | undefined

if (hasLegacyPlannerGlobal()) {
  try {
    plannerApi = createLegacyPlannerApi()
  } catch (error) {
    if (
      error instanceof LegacyPlannerIntegrationError &&
      error.code === 'LegacyPlannerApiIncompleteError'
    ) {
      integrationDiagnostic = error
    } else {
      throw error
    }
  }
}

createRoot(rootElement).render(
  <StrictMode>
    <App
      plannerApi={plannerApi}
      integrationDiagnostic={integrationDiagnostic}
    />
  </StrictMode>,
)
