import React, {
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
import type { PluginBridgePiUpdateMode, PluginBridgeView } from '../types.ts'
import css from './PluginBridgeContent.module.css'

export interface PluginBridgeContentProps {
  readonly view: PluginBridgeView
  readonly mutationFeedback?: Readonly<Record<string, PluginBridgeMutationFeedback>>
  readonly marketplaceLocation: string
  readonly t: (key: string) => string
  readonly onMarketplaceLocationChange: (value: string) => void
  readonly onRescan: () => Promise<void>
  readonly onAddMarketplace: () => Promise<void>
  readonly onImportMarketplace: (ref: string) => Promise<void>
  readonly onImportLocal: (ref: string) => Promise<void>
  readonly onInstall: (name: string, marketplace: string) => Promise<void>
  readonly onSetEnabled: (name: string, enabled: boolean) => Promise<void>
  readonly onCheckPiUpdates: () => Promise<void>
  readonly onSetPiUpdateMode: (mode: PluginBridgePiUpdateMode) => Promise<void>
  readonly onSetPiPackageAutoUpdate: (id: string, enabled: boolean) => Promise<void>
  readonly onUpdatePiPackage: (id: string) => Promise<void>
  readonly onUpdateAllPiPackages: () => Promise<void>
}

export type PluginBridgeMutationFeedback =
  | { readonly status: 'pending' }
  | { readonly status: 'error'; readonly messageKey: string }

type AgentBridge = 'codex' | 'claude-code' | 'pi'
type AgentBridgeTab = 'overview' | AgentBridge

const AGENT_BRIDGE_TABS: readonly AgentBridgeTab[] = ['overview', 'codex', 'claude-code', 'pi']
const AGENT_BRIDGE_TAB_LABELS = {
  overview: 'bridgeOverview',
  codex: 'codexBridge',
  'claude-code': 'claudeCodeBridge',
  pi: 'piBridge',
} as const

function bridgeFromIdentity(identity: string): AgentBridge | undefined {
  if (identity.startsWith('claude-code-') || identity === 'claude-code-legacy') return 'claude-code'
  if (identity.startsWith('codex-') || identity === 'codex-legacy') return 'codex'
  if (identity.startsWith('pi-') || identity === 'pi-package') return 'pi'
  return undefined
}

function installationBridge(
  installation: PluginBridgeView['snapshot']['installations'][number],
  marketplaces: PluginBridgeView['snapshot']['marketplaces'],
): AgentBridge | undefined {
  return bridgeFromIdentity(installation.format)
    ?? bridgeFromIdentity(installation.marketplace.replace(/^import:/u, ''))
    ?? bridgeFromIdentity(
      marketplaces.find(marketplace => marketplace.name === installation.marketplace)?.provider ?? '',
    )
}

function diagnosticBridge(diagnostic: string): AgentBridge | undefined {
  return bridgeFromIdentity(diagnostic.slice(0, diagnostic.indexOf(':') < 0 ? undefined : diagnostic.indexOf(':')))
}

function belongsToTab(tab: AgentBridgeTab, bridge: AgentBridge | undefined): boolean {
  return tab === 'overview' || tab === bridge
}

function Diagnostics({ values }: { readonly values: readonly string[] }): ReactNode {
  if (values.length === 0) return null
  return <ul className={css.diagnostic}>{values.map(value => <li key={value}>{value}</li>)}</ul>
}

function OperationError({
  action,
  feedback,
  t,
}: {
  readonly action: string
  readonly feedback: PluginBridgeMutationFeedback | undefined
  readonly t: (key: string) => string
}): ReactNode {
  if (feedback?.status !== 'error') return null
  return (
    <span
      className={css.operationError}
      data-operation-error={action}
      role="alert"
    >{t(feedback.messageKey)}</span>
  )
}

function Heading({ label, count }: { readonly label: string; readonly count: number }): ReactNode {
  return (
    <div className={css.heading}>
      <h3>{label}</h3>
      <span className={css.count}>{count}</span>
    </div>
  )
}

interface MarketplaceCatalogProps {
  readonly marketplace: PluginBridgeView['snapshot']['marketplaces'][number]
  readonly installations: PluginBridgeView['snapshot']['installations']
  readonly mutationFeedback: Readonly<Record<string, PluginBridgeMutationFeedback>>
  readonly t: (key: string) => string
  readonly onInstall: (name: string, marketplace: string) => Promise<void>
}

/** Progressive catalog disclosure keeps large marketplaces usable inside Settings. */
function MarketplaceCatalog({ marketplace, installations, mutationFeedback, t, onInstall }: MarketplaceCatalogProps): ReactNode {
  const [query, setQuery] = useState('')
  const normalizedQuery = query.trim().toLocaleLowerCase()
  const visiblePlugins = normalizedQuery.length === 0
    ? marketplace.plugins
    : marketplace.plugins.filter(plugin => plugin.toLocaleLowerCase().includes(normalizedQuery))
  const pluginCount = `${String(marketplace.plugins.length)} ${t('plugins')}`
  return (
    <li className={css.catalogItem}>
      <details className={css.catalog} data-catalog={marketplace.name}>
        <summary
          className={css.catalogSummary}
          data-catalog-summary
          aria-label={`${marketplace.name}, ${marketplace.provider}, ${pluginCount}`}
        >
          <span className={css.main}>
            <strong className={css.name}>{marketplace.name}</strong>
            <span className={css.meta}>{marketplace.provider}</span>
          </span>
          <span className={css.catalogCount}>{pluginCount}</span>
          <span className={css.disclosure} aria-hidden="true">›</span>
        </summary>
        <div className={css.catalogBody}>
          <input
            className={`${css.input} ${css.catalogFilter}`}
            data-action="filter-marketplace"
            data-control-size="large"
            type="search"
            value={query}
            aria-label={`${t('searchPlugins')}: ${marketplace.name}`}
            placeholder={t('searchPlugins')}
            onChange={(event: ChangeEvent<HTMLInputElement>) => { setQuery(event.currentTarget.value) }}
          />
          {visiblePlugins.length === 0 ? <p className={css.empty}>{t('noPluginMatches')}</p> : null}
          <div className={css.catalogScroll} data-catalog-scroll>
            <ul className={css.pluginList}>
              {visiblePlugins.map(plugin => {
                const action = `install:${marketplace.name}:${plugin}`
                const feedback = mutationFeedback[action]
                const installed = installations.some(installation => installation.name === plugin)
                const installing = feedback?.status === 'pending'
                return (
                  <li className={css.pluginRow} data-catalog-plugin key={plugin}>
                    <span className={css.pluginMain}>
                      <span className={css.pluginName} title={plugin}>{plugin}</span>
                      <OperationError action={action} feedback={feedback} t={t} />
                    </span>
                    <button
                      className={css.button}
                      data-action="install"
                      data-install-state={installed ? 'installed' : installing ? 'installing' : feedback?.status === 'error' ? 'error' : 'available'}
                      type="button"
                      disabled={installing || installed}
                      aria-busy={installing}
                      onClick={() => { void onInstall(plugin, marketplace.name) }}
                    >{t(installed ? 'installed' : installing ? 'installing' : 'install')}</button>
                  </li>
                )
              })}
            </ul>
          </div>
        </div>
      </details>
    </li>
  )
}

/** Agent Plugins management surface for DSH Web settings. */
export function PluginBridgeContent({
  view,
  mutationFeedback = {},
  marketplaceLocation,
  t,
  onMarketplaceLocationChange,
  onRescan,
  onAddMarketplace,
  onImportMarketplace,
  onImportLocal,
  onInstall,
  onSetEnabled,
  onCheckPiUpdates,
  onSetPiUpdateMode,
  onSetPiPackageAutoUpdate,
  onUpdatePiPackage,
  onUpdateAllPiPackages,
}: PluginBridgeContentProps): ReactNode {
  const changeLocation = (event: ChangeEvent<HTMLInputElement>): void => {
    onMarketplaceLocationChange(event.currentTarget.value)
  }
  const rescanFeedback = mutationFeedback.rescan
  const addMarketplaceFeedback = mutationFeedback.addMarketplace
  const piUpdates = view.piUpdates ?? { mode: 'notify' as const, updates: [] }
  const checkPiFeedback = mutationFeedback.checkPiUpdates
  const modeFeedback = mutationFeedback.setPiUpdateMode
  const updateAllPiFeedback = mutationFeedback.updateAllPiPackages
  const [activeBridge, setActiveBridge] = useState<AgentBridgeTab>('overview')
  const tabListId = useId()
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([])
  const installations = view.snapshot.installations.filter(installation => (
    belongsToTab(activeBridge, installationBridge(installation, view.snapshot.marketplaces))
  ))
  const configuredMarketplaces = view.snapshot.marketplaces.filter(marketplace => (
    belongsToTab(activeBridge, bridgeFromIdentity(marketplace.provider))
  ))
  const discoveredMarketplaces = view.marketplaces.candidates.filter(marketplace => (
    belongsToTab(activeBridge, bridgeFromIdentity(marketplace.locator))
  ))
  const marketplaceDiagnostics = view.marketplaces.diagnostics.filter(diagnostic => (
    belongsToTab(activeBridge, diagnosticBridge(diagnostic))
  ))
  const discoveredLocal = view.local.candidates.filter(plugin => (
    belongsToTab(activeBridge, bridgeFromIdentity(plugin.locator))
  ))
  const localDiagnostics = view.local.diagnostics.filter(diagnostic => (
    belongsToTab(activeBridge, diagnosticBridge(diagnostic))
  ))
  const marketplaceSectionsVisible = activeBridge === 'overview'
    || activeBridge === 'codex'
    || activeBridge === 'claude-code'
  const piUpdatesVisible = activeBridge === 'overview' || activeBridge === 'pi'
  const selectBridge = (tab: AgentBridgeTab, index: number): void => {
    setActiveBridge(tab)
    tabRefs.current[index]?.focus()
  }
  const navigateTabs = (event: KeyboardEvent<HTMLButtonElement>, index: number): void => {
    let nextIndex: number | undefined
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % AGENT_BRIDGE_TABS.length
    if (event.key === 'ArrowLeft') nextIndex = (index - 1 + AGENT_BRIDGE_TABS.length) % AGENT_BRIDGE_TABS.length
    if (event.key === 'Home') nextIndex = 0
    if (event.key === 'End') nextIndex = AGENT_BRIDGE_TABS.length - 1
    if (nextIndex === undefined) return
    event.preventDefault()
    selectBridge(AGENT_BRIDGE_TABS[nextIndex]!, nextIndex)
  }
  return (
    <div className={css.root}>
      <header className={css.header}>
        <h2>{t('title')}</h2>
        <button
          className={css.button}
          data-action="rescan"
          type="button"
          disabled={rescanFeedback?.status === 'pending'}
          aria-busy={rescanFeedback?.status === 'pending'}
          onClick={() => { void onRescan() }}
        >{t(rescanFeedback?.status === 'pending' ? 'working' : 'rescan')}</button>
      </header>
      <OperationError action="rescan" feedback={rescanFeedback} t={t} />

      <div className={css.bridgeTabs} role="tablist" aria-label={t('bridgeTabs')}>
        {AGENT_BRIDGE_TABS.map((tab, index) => {
          const selected = tab === activeBridge
          return (
            <button
              className={css.bridgeTab}
              data-bridge-tab={tab}
              id={`${tabListId}-${tab}-tab`}
              key={tab}
              role="tab"
              type="button"
              aria-controls={`${tabListId}-panel`}
              aria-selected={selected}
              tabIndex={selected ? 0 : -1}
              ref={element => { tabRefs.current[index] = element }}
              onClick={() => { selectBridge(tab, index) }}
              onKeyDown={event => { navigateTabs(event, index) }}
            >{t(AGENT_BRIDGE_TAB_LABELS[tab])}</button>
          )
        })}
      </div>

      <div
        className={css.bridgePanel}
        id={`${tabListId}-panel`}
        role="tabpanel"
        aria-labelledby={`${tabListId}-${activeBridge}-tab`}
      >

      {piUpdatesVisible ? <section className={css.section} data-section="pi-updates">
        <Heading label={t('piUpdates')} count={piUpdates.updates.length} />
        <div className={css.updateControls}>
          <label className={css.policy}>
            <span>{t('piUpdateMode')}</span>
            <select
              className={css.select}
              data-action="set-pi-update-mode"
              value={piUpdates.mode}
              disabled={modeFeedback?.status === 'pending'}
              aria-busy={modeFeedback?.status === 'pending'}
              onChange={(event: ChangeEvent<HTMLSelectElement>) => {
                void onSetPiUpdateMode(event.currentTarget.value as PluginBridgePiUpdateMode)
              }}
            >
              <option value="notify">{t('piUpdateModeNotify')}</option>
              <option value="auto">{t('piUpdateModeAuto')}</option>
              <option value="off">{t('piUpdateModeOff')}</option>
            </select>
          </label>
          <div className={css.actions}>
            <button
              className={css.button}
              data-action="check-pi-updates"
              type="button"
              disabled={checkPiFeedback?.status === 'pending'}
              aria-busy={checkPiFeedback?.status === 'pending'}
              onClick={() => { void onCheckPiUpdates() }}
            >{t(checkPiFeedback?.status === 'pending' ? 'working' : 'checkUpdates')}</button>
            <button
              className={css.button}
              data-action="update-all-pi-packages"
              data-primary="true"
              type="button"
              disabled={updateAllPiFeedback?.status === 'pending' || piUpdates.updates.length === 0}
              aria-busy={updateAllPiFeedback?.status === 'pending'}
              onClick={() => { void onUpdateAllPiPackages() }}
            >{t(updateAllPiFeedback?.status === 'pending' ? 'working' : 'updateAll')}</button>
          </div>
        </div>
        <OperationError action="checkPiUpdates" feedback={checkPiFeedback} t={t} />
        <OperationError action="setPiUpdateMode" feedback={modeFeedback} t={t} />
        <OperationError action="updateAllPiPackages" feedback={updateAllPiFeedback} t={t} />
        {piUpdates.lastCheckedAt === undefined ? null : (
          <p className={css.empty} data-pi-last-checked={piUpdates.lastCheckedAt}>
            {t('lastChecked')}: {new Date(piUpdates.lastCheckedAt).toLocaleString()}
          </p>
        )}
        {piUpdates.updates.length === 0 ? <p className={css.empty}>{t('piUpdatesEmpty')}</p> : null}
        <ul className={css.list}>
          {piUpdates.updates.map(update => {
            const updateAction = `updatePiPackage:${update.id}`
            const autoAction = `setPiPackageAutoUpdate:${update.id}`
            return (
              <li className={css.row} key={update.id}>
                <div className={css.main}>
                  <strong className={css.name}>{update.displayName}</strong>
                  <span className={css.meta}>{update.type} · {t(`piScope_${update.scope}`)}</span>
                  <label className={css.checkboxLabel}>
                    <input
                      data-action="set-pi-package-auto-update"
                      type="checkbox"
                      checked={update.autoUpdate}
                      disabled={mutationFeedback[autoAction]?.status === 'pending'}
                      onChange={(event: ChangeEvent<HTMLInputElement>) => {
                        void onSetPiPackageAutoUpdate(update.id, event.currentTarget.checked)
                      }}
                    />
                    <span>{t('autoUpdatePackage')}</span>
                  </label>
                  <OperationError action={autoAction} feedback={mutationFeedback[autoAction]} t={t} />
                  <OperationError action={updateAction} feedback={mutationFeedback[updateAction]} t={t} />
                </div>
                <button
                  className={css.button}
                  data-action="update-pi-package"
                  type="button"
                  disabled={mutationFeedback[updateAction]?.status === 'pending'}
                  aria-busy={mutationFeedback[updateAction]?.status === 'pending'}
                  onClick={() => { void onUpdatePiPackage(update.id) }}
                >{t(mutationFeedback[updateAction]?.status === 'pending' ? 'working' : 'update')}</button>
              </li>
            )
          })}
        </ul>
      </section> : null}

      <section className={css.section} data-section="installed">
        <Heading label={t('installed')} count={installations.length} />
        {installations.length === 0 ? <p className={css.empty}>{t('installedEmpty')}</p> : null}
        <ul className={css.list}>
          {installations.map(installation => (
            <li className={css.row} key={installation.name}>
              <div className={css.main}>
                <strong className={css.name}>{installation.name}</strong>
                <span className={css.meta}>
                  {installation.format} · {installation.marketplace}
                </span>
                <span className={css.meta}>
                  {t(installation.enabled ? 'enabled' : 'disabled')} · {String(installation.rowCount)} {t('rows')}
                  {' · '}{String(installation.protectedCount)} {t('protected')}
                  {' · '}{String(installation.unsupportedCount)} {t('unsupported')}
                </span>
                {(installation.requiredHosts ?? []).includes('codex') ? (
                  <p className={css.notice} data-notice="codex-host-required">
                    {t('codexHostRequired')}
                  </p>
                ) : null}
                <Diagnostics values={installation.diagnostics} />
                <OperationError
                  action={`setEnabled:${installation.name}`}
                  feedback={mutationFeedback[`setEnabled:${installation.name}`]}
                  t={t}
                />
              </div>
              <div className={css.actions}>
                <button
                  className={css.button}
                  data-action="set-enabled"
                  type="button"
                  disabled={mutationFeedback[`setEnabled:${installation.name}`]?.status === 'pending'}
                  aria-busy={mutationFeedback[`setEnabled:${installation.name}`]?.status === 'pending'}
                  onClick={() => { void onSetEnabled(installation.name, !installation.enabled) }}
                >{t(mutationFeedback[`setEnabled:${installation.name}`]?.status === 'pending'
                  ? 'working'
                  : installation.enabled ? 'disable' : 'enable')}</button>
              </div>
            </li>
          ))}
        </ul>
      </section>

      {marketplaceSectionsVisible ? <section className={css.section} data-section="configured-marketplaces">
        <Heading label={t('configuredMarketplaces')} count={configuredMarketplaces.length} />
        <div className={css.add}>
          <input
            className={css.input}
            type="text"
            value={marketplaceLocation}
            aria-label={t('marketplaceLocation')}
            placeholder={t('marketplaceLocation')}
            onChange={changeLocation}
          />
          <button
            className={css.button}
            data-action="add-marketplace"
            data-primary="true"
            type="button"
            disabled={addMarketplaceFeedback?.status === 'pending' || marketplaceLocation.trim().length === 0}
            aria-busy={addMarketplaceFeedback?.status === 'pending'}
            onClick={() => { void onAddMarketplace() }}
          >{t(addMarketplaceFeedback?.status === 'pending' ? 'working' : 'add')}</button>
        </div>
        <OperationError action="addMarketplace" feedback={addMarketplaceFeedback} t={t} />
        {configuredMarketplaces.length === 0 ? <p className={css.empty}>{t('configuredEmpty')}</p> : null}
        <ul className={css.list}>
          {configuredMarketplaces.map(marketplace => (
            <MarketplaceCatalog
              key={marketplace.name}
              marketplace={marketplace}
              installations={view.snapshot.installations}
              mutationFeedback={mutationFeedback}
              t={t}
              onInstall={onInstall}
            />
          ))}
        </ul>
      </section> : null}

      {marketplaceSectionsVisible ? <section className={css.section} data-section="discovered-marketplaces">
        <Heading label={t('discoveredMarketplaces')} count={discoveredMarketplaces.length} />
        {discoveredMarketplaces.length === 0 ? <p className={css.empty}>{t('discoveredMarketplacesEmpty')}</p> : null}
        <Diagnostics values={marketplaceDiagnostics} />
        <ul className={css.list}>
          {discoveredMarketplaces.map(marketplace => {
            const action = `importMarketplace:${marketplace.ref}`
            const feedback = mutationFeedback[action]
            const imported = view.snapshot.marketplaces.some(item => item.name === marketplace.name)
            const importing = feedback?.status === 'pending'
            const importState = imported ? 'imported' : importing ? 'importing' : feedback?.status === 'error' ? 'error' : 'available'
            return <li className={css.row} key={marketplace.ref}>
              <div className={css.main}>
                <strong className={css.name}>{marketplace.name}</strong>
                <span className={css.meta}>
                  {marketplace.locator} · {marketplace.sourceType === 'git'
                    ? t('remoteMarketplaceRegistration')
                    : marketplace.sourceType}
                  {marketplace.revision === undefined ? '' : ` · ${marketplace.revision}`}
                </span>
                {imported ? null : <OperationError action={action} feedback={feedback} t={t} />}
              </div>
              <button
                className={css.button}
                data-action="import-marketplace"
                data-import-state={importState}
                type="button"
                disabled={imported || importing}
                aria-busy={importing}
                onClick={() => { void onImportMarketplace(marketplace.ref) }}
              >{t(imported
                ? 'imported'
                : importing
                  ? marketplace.sourceType === 'git' ? 'downloading' : 'working'
                  : feedback?.status === 'error'
                    ? 'retry'
                    : marketplace.sourceType === 'git' ? 'add' : 'import')}</button>
            </li>
          })}
        </ul>
      </section> : null}

      <section className={css.section} data-section="discovered-local">
        <Heading label={t('discoveredLocal')} count={discoveredLocal.length} />
        {discoveredLocal.length === 0 ? <p className={css.empty}>{t('discoveredLocalEmpty')}</p> : null}
        <Diagnostics values={localDiagnostics} />
        <ul className={css.list}>
          {discoveredLocal.map(plugin => {
            const action = `importLocal:${plugin.ref}`
            const feedback = mutationFeedback[action]
            const imported = view.snapshot.installations.some(installation => installation.name === plugin.name)
            const importing = feedback?.status === 'pending'
            const importState = imported ? 'imported' : importing ? 'importing' : feedback?.status === 'error' ? 'error' : 'available'
            return <li className={css.row} key={plugin.ref}>
              <div className={css.main}>
                <strong className={css.name}>{plugin.name}</strong>
                <span className={css.meta}>
                  {[
                    plugin.locator,
                    plugin.evidence,
                    plugin.version,
                    plugin.marketplace,
                    plugin.scope,
                    plugin.enabled === undefined ? undefined : t(plugin.enabled ? 'foreignEnabled' : 'foreignDisabled'),
                  ].filter((value): value is string => value !== undefined).join(' · ')}
                </span>
                {imported ? null : <OperationError action={action} feedback={feedback} t={t} />}
              </div>
              <button
                className={css.button}
                data-action="import-local"
                data-import-state={importState}
                type="button"
                disabled={imported || importing}
                aria-busy={importing}
                onClick={() => { void onImportLocal(plugin.ref) }}
              >{t(imported ? 'imported' : importing ? 'working' : feedback?.status === 'error' ? 'retry' : 'import')}</button>
            </li>
          })}
        </ul>
      </section>
      </div>
    </div>
  )
}
