import React, { type ChangeEvent, type ReactNode } from 'react'
import type { PluginBridgeView } from '../types.ts'
import css from './PluginBridgeContent.module.css'

export interface PluginBridgeContentProps {
  readonly view: PluginBridgeView
  readonly busyAction: string | null
  readonly marketplaceLocation: string
  readonly t: (key: string) => string
  readonly onMarketplaceLocationChange: (value: string) => void
  readonly onRescan: () => Promise<void>
  readonly onAddMarketplace: () => Promise<void>
  readonly onImportMarketplace: (ref: string) => Promise<void>
  readonly onImportLocal: (ref: string) => Promise<void>
  readonly onInstall: (name: string, marketplace: string) => Promise<void>
  readonly onSetEnabled: (name: string, enabled: boolean) => Promise<void>
}

function Diagnostics({ values }: { readonly values: readonly string[] }): ReactNode {
  if (values.length === 0) return null
  return <ul className={css.diagnostic}>{values.map(value => <li key={value}>{value}</li>)}</ul>
}

function Heading({ label, count }: { readonly label: string; readonly count: number }): ReactNode {
  return (
    <div className={css.heading}>
      <h3>{label}</h3>
      <span className={css.count}>{count}</span>
    </div>
  )
}

/** Four-section Agent Plugins management surface for DSH Web settings. */
export function PluginBridgeContent({
  view,
  busyAction,
  marketplaceLocation,
  t,
  onMarketplaceLocationChange,
  onRescan,
  onAddMarketplace,
  onImportMarketplace,
  onImportLocal,
  onInstall,
  onSetEnabled,
}: PluginBridgeContentProps): ReactNode {
  const busy = busyAction !== null
  const changeLocation = (event: ChangeEvent<HTMLInputElement>): void => {
    onMarketplaceLocationChange(event.currentTarget.value)
  }
  return (
    <div className={css.root} aria-busy={busy}>
      <header className={css.header}>
        <h2>{t('title')}</h2>
        <button
          className={css.button}
          data-action="rescan"
          type="button"
          disabled={busy}
          onClick={() => { void onRescan() }}
        >{t('rescan')}</button>
      </header>

      <section className={css.section} data-section="installed">
        <Heading label={t('installed')} count={view.snapshot.installations.length} />
        {view.snapshot.installations.length === 0 ? <p className={css.empty}>{t('installedEmpty')}</p> : null}
        <ul className={css.list}>
          {view.snapshot.installations.map(installation => (
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
                <Diagnostics values={installation.diagnostics} />
              </div>
              <div className={css.actions}>
                <button
                  className={css.button}
                  data-action="set-enabled"
                  type="button"
                  disabled={busy}
                  onClick={() => { void onSetEnabled(installation.name, !installation.enabled) }}
                >{t(installation.enabled ? 'disable' : 'enable')}</button>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className={css.section} data-section="configured-marketplaces">
        <Heading label={t('configuredMarketplaces')} count={view.snapshot.marketplaces.length} />
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
            disabled={busy || marketplaceLocation.trim().length === 0}
            onClick={() => { void onAddMarketplace() }}
          >{t('add')}</button>
        </div>
        {view.snapshot.marketplaces.length === 0 ? <p className={css.empty}>{t('configuredEmpty')}</p> : null}
        <ul className={css.list}>
          {view.snapshot.marketplaces.map(marketplace => (
            <li className={css.row} key={marketplace.name}>
              <div className={css.main}>
                <strong className={css.name}>{marketplace.name}</strong>
                <span className={css.meta}>{marketplace.provider}</span>
              </div>
              <div className={css.actions}>
                {marketplace.plugins.map(plugin => (
                  <button
                    className={css.button}
                    data-action="install"
                    type="button"
                    key={plugin}
                    disabled={busy}
                    onClick={() => { void onInstall(plugin, marketplace.name) }}
                  >{t('install')} {plugin}</button>
                ))}
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className={css.section} data-section="discovered-marketplaces">
        <Heading label={t('discoveredMarketplaces')} count={view.marketplaces.candidates.length} />
        {view.marketplaces.candidates.length === 0 ? <p className={css.empty}>{t('discoveredMarketplacesEmpty')}</p> : null}
        <Diagnostics values={view.marketplaces.diagnostics} />
        <ul className={css.list}>
          {view.marketplaces.candidates.map(marketplace => (
            <li className={css.row} key={marketplace.ref}>
              <div className={css.main}>
                <strong className={css.name}>{marketplace.name}</strong>
                <span className={css.meta}>
                  {marketplace.locator} · {marketplace.sourceType}
                  {marketplace.revision === undefined ? '' : ` · ${marketplace.revision}`}
                </span>
              </div>
              <button
                className={css.button}
                data-action="import-marketplace"
                type="button"
                disabled={busy}
                onClick={() => { void onImportMarketplace(marketplace.ref) }}
              >{t('import')}</button>
            </li>
          ))}
        </ul>
      </section>

      <section className={css.section} data-section="discovered-local">
        <Heading label={t('discoveredLocal')} count={view.local.candidates.length} />
        {view.local.candidates.length === 0 ? <p className={css.empty}>{t('discoveredLocalEmpty')}</p> : null}
        <Diagnostics values={view.local.diagnostics} />
        <ul className={css.list}>
          {view.local.candidates.map(plugin => (
            <li className={css.row} key={plugin.ref}>
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
              </div>
              <button
                className={css.button}
                data-action="import-local"
                type="button"
                disabled={busy}
                onClick={() => { void onImportLocal(plugin.ref) }}
              >{t('import')}</button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
