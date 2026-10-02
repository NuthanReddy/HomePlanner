import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import type { PlannerApi } from '../domain/project/planner-api'
import type {
  PlannerCommand,
  PlannerObserverErrorStatus,
  PlannerSceneSnapshot,
  PlannerSelection,
  ProjectSnapshot,
} from '../domain/project/types'

const MAX_OBSERVER_ERRORS = 40

type ProviderErrorSource = 'planner' | 'provider'

export type PlannerProviderObserverError = PlannerObserverErrorStatus &
  Readonly<{
    id: string
    source: ProviderErrorSource
  }>

type ProviderOwnedObserverError = PlannerProviderObserverError &
  Readonly<{
    source: 'provider'
  }>

export type PlannerContextValue = Readonly<{
  project: ProjectSnapshot
  scene: PlannerSceneSnapshot | null
  scenes: readonly PlannerSceneSnapshot[]
  selection: PlannerSelection
  busy: boolean
  canUndo: boolean
  canRedo: boolean
  observerErrors: readonly PlannerProviderObserverError[]
  execute(command: PlannerCommand): ProjectSnapshot
  select(selection: PlannerSelection): void
  undo(): boolean
  redo(): boolean
}>

type PlannerProviderState = Readonly<{
  plannerApi: PlannerApi
  project: ProjectSnapshot
  scene: PlannerSceneSnapshot | null
  scenes: readonly PlannerSceneSnapshot[]
  selection: PlannerSelection
  busy: boolean
  canUndo: boolean
  canRedo: boolean
  providerErrors: readonly ProviderOwnedObserverError[]
  observerErrors: readonly PlannerProviderObserverError[]
}>

export type PlannerProviderProps = Readonly<{
  plannerApi: PlannerApi
  children: ReactNode
}>

const PlannerContext = createContext<PlannerContextValue | null>(null)

function appendProviderError(
  errors: readonly ProviderOwnedObserverError[],
  error: ProviderOwnedObserverError,
) {
  return [...errors, error].slice(-MAX_OBSERVER_ERRORS)
}

function normalizePlannerObserverErrors(plannerApi: PlannerApi) {
  return (plannerApi.getObserverErrors?.() ?? [])
    .slice(-MAX_OBSERVER_ERRORS)
    .map(
      (error, index): PlannerProviderObserverError => ({
        ...error,
        id: `planner:${index}:${error.code}:${error.message}`,
        source: 'planner',
      }),
    )
}

function readPlannerState(
  plannerApi: PlannerApi,
  providerErrors: readonly ProviderOwnedObserverError[],
): PlannerProviderState {
  const project = plannerApi.getProject()

  return {
    plannerApi,
    project,
    scene: plannerApi.getScene(),
    scenes: plannerApi.getScenes(),
    selection: plannerApi.getSelection(),
    busy: plannerApi.isBusy(),
    canUndo: plannerApi.canUndo(),
    canRedo: plannerApi.canRedo(),
    providerErrors,
    observerErrors: [
      ...normalizePlannerObserverErrors(plannerApi),
      ...providerErrors,
    ].slice(-MAX_OBSERVER_ERRORS),
  }
}

function errorName(error: unknown) {
  return error instanceof Error ? error.name : 'Error'
}

export function PlannerProvider({
  plannerApi,
  children,
}: PlannerProviderProps) {
  const errorSequence = useRef(0)
  const [state, setState] = useState<PlannerProviderState>(() =>
    readPlannerState(plannerApi, []),
  )
  const stateForApi =
    state.plannerApi === plannerApi
      ? state
      : readPlannerState(plannerApi, [])

  const recordProviderError = useCallback(
    (code: string, message: string, error: unknown) => {
      const providerError: ProviderOwnedObserverError = {
        id: `provider:${errorSequence.current++}`,
        source: 'provider',
        code,
        message,
        errorName: errorName(error),
      }
      console.error(`${providerError.code}: ${providerError.message}`, error)
      setState((current) => {
        const providerErrors =
          current.plannerApi === plannerApi ? current.providerErrors : []
        const nextProviderErrors = appendProviderError(
          providerErrors,
          providerError,
        )
        return {
          ...current,
          providerErrors: nextProviderErrors,
          observerErrors: [
            ...current.observerErrors,
            providerError,
          ].slice(-MAX_OBSERVER_ERRORS),
        }
      })
    },
    [plannerApi],
  )

  const refreshFromPlanner = useCallback(() => {
    setState((current) =>
      readPlannerState(
        plannerApi,
        current.plannerApi === plannerApi ? current.providerErrors : [],
      ),
    )
  }, [plannerApi])

  useEffect(() => {
    let active = true

    const sync = () => {
      if (!active) return
      try {
        refreshFromPlanner()
      } catch (error) {
        recordProviderError(
          'PlannerProviderSnapshotError',
          'The planner provider could not read the latest planner snapshot. The project authority was not replaced.',
          error,
        )
      }
    }

    let unsubscribe: (() => void) | null = null
    try {
      unsubscribe = plannerApi.subscribe(sync)
      sync()
    } catch (error) {
      recordProviderError(
        'PlannerProviderSubscriptionError',
        'The planner provider could not subscribe to planner updates. The injected planner remains the only project authority.',
        error,
      )
    }

    return () => {
      active = false
      if (!unsubscribe) return
      try {
        unsubscribe()
      } catch (error) {
        console.error(
          'PlannerProviderUnsubscribeError: The planner provider could not cleanly remove its observer.',
          error,
        )
      }
    }
  }, [plannerApi, recordProviderError, refreshFromPlanner])

  const runAndRefresh = useCallback(
    <Result,>(operation: () => Result, code: string, message: string) => {
      let result: Result
      try {
        result = operation()
      } catch (error) {
        recordProviderError(code, message, error)
        throw error
      }
      try {
        refreshFromPlanner()
      } catch (error) {
        recordProviderError(
          'PlannerProviderRefreshError',
          'The planner command completed, but its latest snapshot could not be read. The planner authority remains unchanged.',
          error,
        )
      }
      return result
    },
    [recordProviderError, refreshFromPlanner],
  )

  const execute = useCallback(
    (command: PlannerCommand) =>
      runAndRefresh(
        () => plannerApi.execute(command),
        'PlannerProviderExecuteError',
        'The planner provider could not execute the requested planner command.',
      ),
    [plannerApi, runAndRefresh],
  )

  const select = useCallback(
    (selection: PlannerSelection) => {
      runAndRefresh(
        () => plannerApi.select(selection),
        'PlannerProviderSelectionError',
        'The planner provider could not update planner selection.',
      )
    },
    [plannerApi, runAndRefresh],
  )

  const undo = useCallback(
    () =>
      runAndRefresh(
        () => plannerApi.undo(),
        'PlannerProviderUndoError',
        'The planner provider could not undo the latest planner command.',
      ),
    [plannerApi, runAndRefresh],
  )

  const redo = useCallback(
    () =>
      runAndRefresh(
        () => plannerApi.redo(),
        'PlannerProviderRedoError',
        'The planner provider could not redo the latest planner command.',
      ),
    [plannerApi, runAndRefresh],
  )

  const value = useMemo<PlannerContextValue>(
    () => ({
      project: stateForApi.project,
      scene: stateForApi.scene,
      scenes: stateForApi.scenes,
      selection: stateForApi.selection,
      busy: stateForApi.busy,
      canUndo: stateForApi.canUndo,
      canRedo: stateForApi.canRedo,
      observerErrors: stateForApi.observerErrors,
      execute,
      select,
      undo,
      redo,
    }),
    [execute, redo, select, stateForApi, undo],
  )

  return (
    <PlannerContext.Provider value={value}>{children}</PlannerContext.Provider>
  )
}

export function usePlanner() {
  const context = useContext(PlannerContext)
  if (!context) {
    throw new Error('usePlanner must be used within a PlannerProvider.')
  }
  return context
}
