import React, { useEffect, useRef, useState, type ReactNode } from 'react'
import type { PluginBridgeView } from '../types.ts'
import type { PluginBridgeSettingsTabInjected } from './register.ts'
import { PluginBridgeContent } from './PluginBridgeContent.tsx'

export interface PluginBridgeSettingsTabProps extends PluginBridgeSettingsTabInjected {
  readonly t: (key: string) => string
}

type ViewState =
  | { readonly status: 'loading' }
  | { readonly status: 'error' }
  | { readonly status: 'ready'; readonly view: PluginBridgeView }

/** Mounted settings tab that owns async loading, retry, and mutation state. */
export function PluginBridgeSettingsTab(props: PluginBridgeSettingsTabProps): ReactNode {
  const { t, load } = props
  const mounted = useRef(true)
  const [request, setRequest] = useState(0)
  const [state, setState] = useState<ViewState>({ status: 'loading' })
  const [busyAction, setBusyAction] = useState<string | null>(null)
  const [mutationFailed, setMutationFailed] = useState(false)
  const [marketplaceLocation, setMarketplaceLocation] = useState('')

  useEffect(() => {
    mounted.current = true
    let current = true
    void load().then(
      view => { if (current) setState({ status: 'ready', view }) },
      () => { if (current) setState({ status: 'error' }) },
    )
    return () => {
      current = false
      mounted.current = false
    }
  }, [load, request])

  const retry = (): void => {
    setState({ status: 'loading' })
    setRequest(value => value + 1)
  }

  const run = async (name: string, operation: () => Promise<PluginBridgeView>): Promise<boolean> => {
    setBusyAction(name)
    setMutationFailed(false)
    try {
      const view = await operation()
      if (mounted.current) setState({ status: 'ready', view })
      return true
    } catch {
      if (mounted.current) setMutationFailed(true)
      return false
    } finally {
      if (mounted.current) setBusyAction(null)
    }
  }

  if (state.status === 'loading') return <p data-state="loading">{t('loading')}</p>
  if (state.status === 'error') {
    return (
      <div>
        <p role="alert">{t('loadError')}</p>
        <button data-action="retry" type="button" onClick={retry}>{t('retry')}</button>
      </div>
    )
  }

  return (
    <>
      {mutationFailed ? <p role="alert">{t('mutationError')}</p> : null}
      <PluginBridgeContent
        view={state.view}
        busyAction={busyAction}
        marketplaceLocation={marketplaceLocation}
        t={t}
        onMarketplaceLocationChange={setMarketplaceLocation}
        onRescan={async () => { await run('rescan', props.rescan) }}
        onAddMarketplace={async () => {
          const location = marketplaceLocation.trim()
          const succeeded = await run('addMarketplace', () => props.addMarketplace(location))
          if (succeeded && mounted.current) setMarketplaceLocation('')
        }}
        onImportMarketplace={async (ref) => { await run('importMarketplace', () => props.importMarketplace(ref)) }}
        onImportLocal={async (ref) => { await run('importLocal', () => props.importLocal(ref)) }}
        onInstall={async (name, marketplace) => { await run('install', () => props.install(name, marketplace)) }}
        onSetEnabled={async (name, enabled) => { await run('setEnabled', () => props.setEnabled(name, enabled)) }}
      />
    </>
  )
}
