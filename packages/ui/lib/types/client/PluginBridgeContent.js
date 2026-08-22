import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import React, { useId, useRef, useState, } from 'react';
import css from './PluginBridgeContent.module.css';
const AGENT_BRIDGE_TABS = ['overview', 'codex', 'claude-code', 'pi'];
const AGENT_BRIDGE_TAB_LABELS = {
    overview: 'bridgeOverview',
    codex: 'codexBridge',
    'claude-code': 'claudeCodeBridge',
    pi: 'piBridge',
};
function bridgeFromIdentity(identity) {
    if (identity.startsWith('claude-code-') || identity === 'claude-code-legacy')
        return 'claude-code';
    if (identity.startsWith('codex-') || identity === 'codex-legacy')
        return 'codex';
    if (identity.startsWith('pi-') || identity === 'pi-package')
        return 'pi';
    return undefined;
}
function installationBridge(installation, marketplaces) {
    return bridgeFromIdentity(installation.format)
        ?? bridgeFromIdentity(installation.marketplace.replace(/^import:/u, ''))
        ?? bridgeFromIdentity(marketplaces.find(marketplace => marketplace.name === installation.marketplace)?.provider ?? '');
}
function diagnosticBridge(diagnostic) {
    return bridgeFromIdentity(diagnostic.slice(0, diagnostic.indexOf(':') < 0 ? undefined : diagnostic.indexOf(':')));
}
function belongsToTab(tab, bridge) {
    return tab === 'overview' || tab === bridge;
}
function Diagnostics({ values }) {
    if (values.length === 0)
        return null;
    return _jsx("ul", { className: css.diagnostic, children: values.map(value => _jsx("li", { children: value }, value)) });
}
function OperationError({ action, feedback, t, }) {
    if (feedback?.status !== 'error')
        return null;
    return (_jsx("span", { className: css.operationError, "data-operation-error": action, role: "alert", children: t(feedback.messageKey) }));
}
function Heading({ label, count }) {
    return (_jsxs("div", { className: css.heading, children: [_jsx("h3", { children: label }), _jsx("span", { className: css.count, children: count })] }));
}
/** Progressive catalog disclosure keeps large marketplaces usable inside Settings. */
function MarketplaceCatalog({ marketplace, installations, mutationFeedback, t, onInstall }) {
    const [query, setQuery] = useState('');
    const normalizedQuery = query.trim().toLocaleLowerCase();
    const visiblePlugins = normalizedQuery.length === 0
        ? marketplace.plugins
        : marketplace.plugins.filter(plugin => plugin.toLocaleLowerCase().includes(normalizedQuery));
    const pluginCount = `${String(marketplace.plugins.length)} ${t('plugins')}`;
    return (_jsx("li", { className: css.catalogItem, children: _jsxs("details", { className: css.catalog, "data-catalog": marketplace.name, children: [_jsxs("summary", { className: css.catalogSummary, "data-catalog-summary": true, "aria-label": `${marketplace.name}, ${marketplace.provider}, ${pluginCount}`, children: [_jsxs("span", { className: css.main, children: [_jsx("strong", { className: css.name, children: marketplace.name }), _jsx("span", { className: css.meta, children: marketplace.provider })] }), _jsx("span", { className: css.catalogCount, children: pluginCount }), _jsx("span", { className: css.disclosure, "aria-hidden": "true", children: "\u203A" })] }), _jsxs("div", { className: css.catalogBody, children: [_jsx("input", { className: `${css.input} ${css.catalogFilter}`, "data-action": "filter-marketplace", "data-control-size": "large", type: "search", value: query, "aria-label": `${t('searchPlugins')}: ${marketplace.name}`, placeholder: t('searchPlugins'), onChange: (event) => { setQuery(event.currentTarget.value); } }), visiblePlugins.length === 0 ? _jsx("p", { className: css.empty, children: t('noPluginMatches') }) : null, _jsx("div", { className: css.catalogScroll, "data-catalog-scroll": true, children: _jsx("ul", { className: css.pluginList, children: visiblePlugins.map(plugin => {
                                    const action = `install:${marketplace.name}:${plugin}`;
                                    const feedback = mutationFeedback[action];
                                    const installed = installations.some(installation => installation.name === plugin);
                                    const installing = feedback?.status === 'pending';
                                    return (_jsxs("li", { className: css.pluginRow, "data-catalog-plugin": true, children: [_jsxs("span", { className: css.pluginMain, children: [_jsx("span", { className: css.pluginName, title: plugin, children: plugin }), _jsx(OperationError, { action: action, feedback: feedback, t: t })] }), _jsx("button", { className: css.button, "data-action": "install", "data-install-state": installed ? 'installed' : installing ? 'installing' : feedback?.status === 'error' ? 'error' : 'available', type: "button", disabled: installing || installed, "aria-busy": installing, onClick: () => { void onInstall(plugin, marketplace.name); }, children: t(installed ? 'installed' : installing ? 'installing' : 'install') })] }, plugin));
                                }) }) })] })] }) }));
}
/** Agent Plugins management surface for DSH Web settings. */
export function PluginBridgeContent({ view, mutationFeedback = {}, marketplaceLocation, t, onMarketplaceLocationChange, onRescan, onAddMarketplace, onImportMarketplace, onImportLocal, onInstall, onSetEnabled, onCheckPiUpdates, onSetPiUpdateMode, onSetPiPackageAutoUpdate, onUpdatePiPackage, onUpdateAllPiPackages, }) {
    const changeLocation = (event) => {
        onMarketplaceLocationChange(event.currentTarget.value);
    };
    const rescanFeedback = mutationFeedback.rescan;
    const addMarketplaceFeedback = mutationFeedback.addMarketplace;
    const piUpdates = view.piUpdates ?? { mode: 'notify', updates: [] };
    const checkPiFeedback = mutationFeedback.checkPiUpdates;
    const modeFeedback = mutationFeedback.setPiUpdateMode;
    const updateAllPiFeedback = mutationFeedback.updateAllPiPackages;
    const [activeBridge, setActiveBridge] = useState('overview');
    const tabListId = useId();
    const tabRefs = useRef([]);
    const installations = view.snapshot.installations.filter(installation => (belongsToTab(activeBridge, installationBridge(installation, view.snapshot.marketplaces))));
    const configuredMarketplaces = view.snapshot.marketplaces.filter(marketplace => (belongsToTab(activeBridge, bridgeFromIdentity(marketplace.provider))));
    const discoveredMarketplaces = view.marketplaces.candidates.filter(marketplace => (belongsToTab(activeBridge, bridgeFromIdentity(marketplace.locator))));
    const marketplaceDiagnostics = view.marketplaces.diagnostics.filter(diagnostic => (belongsToTab(activeBridge, diagnosticBridge(diagnostic))));
    const discoveredLocal = view.local.candidates.filter(plugin => (belongsToTab(activeBridge, bridgeFromIdentity(plugin.locator))));
    const localDiagnostics = view.local.diagnostics.filter(diagnostic => (belongsToTab(activeBridge, diagnosticBridge(diagnostic))));
    const marketplaceSectionsVisible = activeBridge === 'overview'
        || activeBridge === 'codex'
        || activeBridge === 'claude-code';
    const piUpdatesVisible = activeBridge === 'overview' || activeBridge === 'pi';
    const selectBridge = (tab, index) => {
        setActiveBridge(tab);
        tabRefs.current[index]?.focus();
    };
    const navigateTabs = (event, index) => {
        let nextIndex;
        if (event.key === 'ArrowRight')
            nextIndex = (index + 1) % AGENT_BRIDGE_TABS.length;
        if (event.key === 'ArrowLeft')
            nextIndex = (index - 1 + AGENT_BRIDGE_TABS.length) % AGENT_BRIDGE_TABS.length;
        if (event.key === 'Home')
            nextIndex = 0;
        if (event.key === 'End')
            nextIndex = AGENT_BRIDGE_TABS.length - 1;
        if (nextIndex === undefined)
            return;
        event.preventDefault();
        selectBridge(AGENT_BRIDGE_TABS[nextIndex], nextIndex);
    };
    return (_jsxs("div", { className: css.root, children: [_jsxs("header", { className: css.header, children: [_jsx("h2", { children: t('title') }), _jsx("button", { className: css.button, "data-action": "rescan", type: "button", disabled: rescanFeedback?.status === 'pending', "aria-busy": rescanFeedback?.status === 'pending', onClick: () => { void onRescan(); }, children: t(rescanFeedback?.status === 'pending' ? 'working' : 'rescan') })] }), _jsx(OperationError, { action: "rescan", feedback: rescanFeedback, t: t }), _jsx("div", { className: css.bridgeTabs, role: "tablist", "aria-label": t('bridgeTabs'), children: AGENT_BRIDGE_TABS.map((tab, index) => {
                    const selected = tab === activeBridge;
                    return (_jsx("button", { className: css.bridgeTab, "data-bridge-tab": tab, id: `${tabListId}-${tab}-tab`, role: "tab", type: "button", "aria-controls": `${tabListId}-panel`, "aria-selected": selected, tabIndex: selected ? 0 : -1, ref: element => { tabRefs.current[index] = element; }, onClick: () => { selectBridge(tab, index); }, onKeyDown: event => { navigateTabs(event, index); }, children: t(AGENT_BRIDGE_TAB_LABELS[tab]) }, tab));
                }) }), _jsxs("div", { className: css.bridgePanel, id: `${tabListId}-panel`, role: "tabpanel", "aria-labelledby": `${tabListId}-${activeBridge}-tab`, children: [piUpdatesVisible ? _jsxs("section", { className: css.section, "data-section": "pi-updates", children: [_jsx(Heading, { label: t('piUpdates'), count: piUpdates.updates.length }), _jsxs("div", { className: css.updateControls, children: [_jsxs("label", { className: css.policy, children: [_jsx("span", { children: t('piUpdateMode') }), _jsxs("select", { className: css.select, "data-action": "set-pi-update-mode", value: piUpdates.mode, disabled: modeFeedback?.status === 'pending', "aria-busy": modeFeedback?.status === 'pending', onChange: (event) => {
                                                    void onSetPiUpdateMode(event.currentTarget.value);
                                                }, children: [_jsx("option", { value: "notify", children: t('piUpdateModeNotify') }), _jsx("option", { value: "auto", children: t('piUpdateModeAuto') }), _jsx("option", { value: "off", children: t('piUpdateModeOff') })] })] }), _jsxs("div", { className: css.actions, children: [_jsx("button", { className: css.button, "data-action": "check-pi-updates", type: "button", disabled: checkPiFeedback?.status === 'pending', "aria-busy": checkPiFeedback?.status === 'pending', onClick: () => { void onCheckPiUpdates(); }, children: t(checkPiFeedback?.status === 'pending' ? 'working' : 'checkUpdates') }), _jsx("button", { className: css.button, "data-action": "update-all-pi-packages", "data-primary": "true", type: "button", disabled: updateAllPiFeedback?.status === 'pending' || piUpdates.updates.length === 0, "aria-busy": updateAllPiFeedback?.status === 'pending', onClick: () => { void onUpdateAllPiPackages(); }, children: t(updateAllPiFeedback?.status === 'pending' ? 'working' : 'updateAll') })] })] }), _jsx(OperationError, { action: "checkPiUpdates", feedback: checkPiFeedback, t: t }), _jsx(OperationError, { action: "setPiUpdateMode", feedback: modeFeedback, t: t }), _jsx(OperationError, { action: "updateAllPiPackages", feedback: updateAllPiFeedback, t: t }), piUpdates.lastCheckedAt === undefined ? null : (_jsxs("p", { className: css.empty, "data-pi-last-checked": piUpdates.lastCheckedAt, children: [t('lastChecked'), ": ", new Date(piUpdates.lastCheckedAt).toLocaleString()] })), piUpdates.updates.length === 0 ? _jsx("p", { className: css.empty, children: t('piUpdatesEmpty') }) : null, _jsx("ul", { className: css.list, children: piUpdates.updates.map(update => {
                                    const updateAction = `updatePiPackage:${update.id}`;
                                    const autoAction = `setPiPackageAutoUpdate:${update.id}`;
                                    return (_jsxs("li", { className: css.row, children: [_jsxs("div", { className: css.main, children: [_jsx("strong", { className: css.name, children: update.displayName }), _jsxs("span", { className: css.meta, children: [update.type, " \u00B7 ", t(`piScope_${update.scope}`)] }), _jsxs("label", { className: css.checkboxLabel, children: [_jsx("input", { "data-action": "set-pi-package-auto-update", type: "checkbox", checked: update.autoUpdate, disabled: mutationFeedback[autoAction]?.status === 'pending', onChange: (event) => {
                                                                    void onSetPiPackageAutoUpdate(update.id, event.currentTarget.checked);
                                                                } }), _jsx("span", { children: t('autoUpdatePackage') })] }), _jsx(OperationError, { action: autoAction, feedback: mutationFeedback[autoAction], t: t }), _jsx(OperationError, { action: updateAction, feedback: mutationFeedback[updateAction], t: t })] }), _jsx("button", { className: css.button, "data-action": "update-pi-package", type: "button", disabled: mutationFeedback[updateAction]?.status === 'pending', "aria-busy": mutationFeedback[updateAction]?.status === 'pending', onClick: () => { void onUpdatePiPackage(update.id); }, children: t(mutationFeedback[updateAction]?.status === 'pending' ? 'working' : 'update') })] }, update.id));
                                }) })] }) : null, _jsxs("section", { className: css.section, "data-section": "installed", children: [_jsx(Heading, { label: t('installed'), count: installations.length }), installations.length === 0 ? _jsx("p", { className: css.empty, children: t('installedEmpty') }) : null, _jsx("ul", { className: css.list, children: installations.map(installation => (_jsxs("li", { className: css.row, children: [_jsxs("div", { className: css.main, children: [_jsx("strong", { className: css.name, children: installation.name }), _jsxs("span", { className: css.meta, children: [installation.format, " \u00B7 ", installation.marketplace] }), _jsxs("span", { className: css.meta, children: [t(installation.enabled ? 'enabled' : 'disabled'), " \u00B7 ", String(installation.rowCount), " ", t('rows'), ' · ', String(installation.protectedCount), " ", t('protected'), ' · ', String(installation.unsupportedCount), " ", t('unsupported')] }), (installation.requiredHosts ?? []).includes('codex') ? (_jsx("p", { className: css.notice, "data-notice": "codex-host-required", children: t('codexHostRequired') })) : null, _jsx(Diagnostics, { values: installation.diagnostics }), _jsx(OperationError, { action: `setEnabled:${installation.name}`, feedback: mutationFeedback[`setEnabled:${installation.name}`], t: t })] }), _jsx("div", { className: css.actions, children: _jsx("button", { className: css.button, "data-action": "set-enabled", type: "button", disabled: mutationFeedback[`setEnabled:${installation.name}`]?.status === 'pending', "aria-busy": mutationFeedback[`setEnabled:${installation.name}`]?.status === 'pending', onClick: () => { void onSetEnabled(installation.name, !installation.enabled); }, children: t(mutationFeedback[`setEnabled:${installation.name}`]?.status === 'pending'
                                                    ? 'working'
                                                    : installation.enabled ? 'disable' : 'enable') }) })] }, installation.name))) })] }), marketplaceSectionsVisible ? _jsxs("section", { className: css.section, "data-section": "configured-marketplaces", children: [_jsx(Heading, { label: t('configuredMarketplaces'), count: configuredMarketplaces.length }), _jsxs("div", { className: css.add, children: [_jsx("input", { className: css.input, type: "text", value: marketplaceLocation, "aria-label": t('marketplaceLocation'), placeholder: t('marketplaceLocation'), onChange: changeLocation }), _jsx("button", { className: css.button, "data-action": "add-marketplace", "data-primary": "true", type: "button", disabled: addMarketplaceFeedback?.status === 'pending' || marketplaceLocation.trim().length === 0, "aria-busy": addMarketplaceFeedback?.status === 'pending', onClick: () => { void onAddMarketplace(); }, children: t(addMarketplaceFeedback?.status === 'pending' ? 'working' : 'add') })] }), _jsx(OperationError, { action: "addMarketplace", feedback: addMarketplaceFeedback, t: t }), configuredMarketplaces.length === 0 ? _jsx("p", { className: css.empty, children: t('configuredEmpty') }) : null, _jsx("ul", { className: css.list, children: configuredMarketplaces.map(marketplace => (_jsx(MarketplaceCatalog, { marketplace: marketplace, installations: view.snapshot.installations, mutationFeedback: mutationFeedback, t: t, onInstall: onInstall }, marketplace.name))) })] }) : null, marketplaceSectionsVisible ? _jsxs("section", { className: css.section, "data-section": "discovered-marketplaces", children: [_jsx(Heading, { label: t('discoveredMarketplaces'), count: discoveredMarketplaces.length }), discoveredMarketplaces.length === 0 ? _jsx("p", { className: css.empty, children: t('discoveredMarketplacesEmpty') }) : null, _jsx(Diagnostics, { values: marketplaceDiagnostics }), _jsx("ul", { className: css.list, children: discoveredMarketplaces.map(marketplace => {
                                    const action = `importMarketplace:${marketplace.ref}`;
                                    const feedback = mutationFeedback[action];
                                    const imported = view.snapshot.marketplaces.some(item => item.name === marketplace.name);
                                    const importing = feedback?.status === 'pending';
                                    const importState = imported ? 'imported' : importing ? 'importing' : feedback?.status === 'error' ? 'error' : 'available';
                                    return _jsxs("li", { className: css.row, children: [_jsxs("div", { className: css.main, children: [_jsx("strong", { className: css.name, children: marketplace.name }), _jsxs("span", { className: css.meta, children: [marketplace.locator, " \u00B7 ", marketplace.sourceType === 'git'
                                                                ? t('remoteMarketplaceRegistration')
                                                                : marketplace.sourceType, marketplace.revision === undefined ? '' : ` · ${marketplace.revision}`] }), imported ? null : _jsx(OperationError, { action: action, feedback: feedback, t: t })] }), _jsx("button", { className: css.button, "data-action": "import-marketplace", "data-import-state": importState, type: "button", disabled: imported || importing, "aria-busy": importing, onClick: () => { void onImportMarketplace(marketplace.ref); }, children: t(imported
                                                    ? 'imported'
                                                    : importing
                                                        ? marketplace.sourceType === 'git' ? 'downloading' : 'working'
                                                        : feedback?.status === 'error'
                                                            ? 'retry'
                                                            : marketplace.sourceType === 'git' ? 'add' : 'import') })] }, marketplace.ref);
                                }) })] }) : null, _jsxs("section", { className: css.section, "data-section": "discovered-local", children: [_jsx(Heading, { label: t('discoveredLocal'), count: discoveredLocal.length }), discoveredLocal.length === 0 ? _jsx("p", { className: css.empty, children: t('discoveredLocalEmpty') }) : null, _jsx(Diagnostics, { values: localDiagnostics }), _jsx("ul", { className: css.list, children: discoveredLocal.map(plugin => {
                                    const action = `importLocal:${plugin.ref}`;
                                    const feedback = mutationFeedback[action];
                                    const imported = view.snapshot.installations.some(installation => installation.name === plugin.name);
                                    const importing = feedback?.status === 'pending';
                                    const importState = imported ? 'imported' : importing ? 'importing' : feedback?.status === 'error' ? 'error' : 'available';
                                    return _jsxs("li", { className: css.row, children: [_jsxs("div", { className: css.main, children: [_jsx("strong", { className: css.name, children: plugin.name }), _jsx("span", { className: css.meta, children: [
                                                            plugin.locator,
                                                            plugin.evidence,
                                                            plugin.version,
                                                            plugin.marketplace,
                                                            plugin.scope,
                                                            plugin.enabled === undefined ? undefined : t(plugin.enabled ? 'foreignEnabled' : 'foreignDisabled'),
                                                        ].filter((value) => value !== undefined).join(' · ') }), imported ? null : _jsx(OperationError, { action: action, feedback: feedback, t: t })] }), _jsx("button", { className: css.button, "data-action": "import-local", "data-import-state": importState, type: "button", disabled: imported || importing, "aria-busy": importing, onClick: () => { void onImportLocal(plugin.ref); }, children: t(imported ? 'imported' : importing ? 'working' : feedback?.status === 'error' ? 'retry' : 'import') })] }, plugin.ref);
                                }) })] })] })] }));
}
//# sourceMappingURL=PluginBridgeContent.js.map