import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import React, { useEffect, useRef, useState } from 'react';
import { PluginBridgeContent } from "./PluginBridgeContent.js";
/** Mounted settings tab that owns async loading, retry, and mutation state. */
export function PluginBridgeSettingsTab(props) {
    const { t, load } = props;
    const mounted = useRef(true);
    const [request, setRequest] = useState(0);
    const [state, setState] = useState({ status: 'loading' });
    const [busyAction, setBusyAction] = useState(null);
    const [mutationFailed, setMutationFailed] = useState(false);
    const [marketplaceLocation, setMarketplaceLocation] = useState('');
    useEffect(() => {
        mounted.current = true;
        let current = true;
        void load().then(view => { if (current)
            setState({ status: 'ready', view }); }, () => { if (current)
            setState({ status: 'error' }); });
        return () => {
            current = false;
            mounted.current = false;
        };
    }, [load, request]);
    const retry = () => {
        setState({ status: 'loading' });
        setRequest(value => value + 1);
    };
    const run = async (name, operation) => {
        setBusyAction(name);
        setMutationFailed(false);
        try {
            const view = await operation();
            if (mounted.current)
                setState({ status: 'ready', view });
            return true;
        }
        catch {
            if (mounted.current)
                setMutationFailed(true);
            return false;
        }
        finally {
            if (mounted.current)
                setBusyAction(null);
        }
    };
    if (state.status === 'loading')
        return _jsx("p", { "data-state": "loading", children: t('loading') });
    if (state.status === 'error') {
        return (_jsxs("div", { children: [_jsx("p", { role: "alert", children: t('loadError') }), _jsx("button", { "data-action": "retry", type: "button", onClick: retry, children: t('retry') })] }));
    }
    return (_jsxs(_Fragment, { children: [mutationFailed ? _jsx("p", { role: "alert", children: t('mutationError') }) : null, _jsx(PluginBridgeContent, { view: state.view, busyAction: busyAction, marketplaceLocation: marketplaceLocation, t: t, onMarketplaceLocationChange: setMarketplaceLocation, onRescan: async () => { await run('rescan', props.rescan); }, onAddMarketplace: async () => {
                    const location = marketplaceLocation.trim();
                    const succeeded = await run('addMarketplace', () => props.addMarketplace(location));
                    if (succeeded && mounted.current)
                        setMarketplaceLocation('');
                }, onImportMarketplace: async (ref) => { await run('importMarketplace', () => props.importMarketplace(ref)); }, onImportLocal: async (ref) => { await run('importLocal', () => props.importLocal(ref)); }, onInstall: async (name, marketplace) => { await run('install', () => props.install(name, marketplace)); }, onSetEnabled: async (name, enabled) => { await run('setEnabled', () => props.setEnabled(name, enabled)); } })] }));
}
//# sourceMappingURL=PluginBridgeSettingsTab.js.map