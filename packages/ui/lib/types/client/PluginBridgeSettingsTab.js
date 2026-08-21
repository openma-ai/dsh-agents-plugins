import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import React, { useEffect, useRef, useState } from 'react';
import { PluginBridgeContent, } from "./PluginBridgeContent.js";
function installErrorKey(error) {
    const reason = typeof error === 'object' && error !== null && 'reason' in error
        ? error.reason
        : undefined;
    const structured = {
        timeout: 'installErrorTimeout',
        source: 'installErrorSource',
        unsupported: 'installErrorUnsupported',
        invalid: 'installErrorInvalid',
        activation: 'installErrorActivation',
        'already-installed': 'installErrorInstalled',
        unknown: 'installErrorGeneric',
    };
    if (typeof reason === 'string' && reason in structured) {
        return structured[reason];
    }
    const message = error instanceof Error ? error.message : '';
    if (/timed?\s*out|timeout/iu.test(message))
        return 'installErrorTimeout';
    if (/already installed/iu.test(message))
        return 'installErrorInstalled';
    if (/unsupported package format|has no components supported|not supported/iu.test(message)) {
        return 'installErrorUnsupported';
    }
    if (/invalid (?:plugin )?manifest|manifest (?:is )?invalid|schema|parse|symlink|subdirectory|not a directory/iu.test(message)) {
        return 'installErrorInvalid';
    }
    if (/\bgit\b|clone|checkout|fetch|download|network|ECONN|ENOTFOUND|HTTP/iu.test(message)) {
        return 'installErrorSource';
    }
    return 'installErrorGeneric';
}
function mutationErrorKey(action, error) {
    return action.startsWith('install:') ? installErrorKey(error) : 'mutationError';
}
/** Mounted settings tab that owns async loading, retry, and mutation state. */
export function PluginBridgeSettingsTab(props) {
    const { t, load } = props;
    const mounted = useRef(true);
    const [request, setRequest] = useState(0);
    const [state, setState] = useState({ status: 'loading' });
    const [mutationFeedback, setMutationFeedback] = useState({});
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
        setMutationFeedback(current => ({ ...current, [name]: { status: 'pending' } }));
        try {
            const view = await operation();
            if (mounted.current)
                setState({ status: 'ready', view });
            if (mounted.current) {
                setMutationFeedback(current => {
                    const next = { ...current };
                    delete next[name];
                    return next;
                });
            }
            return true;
        }
        catch (error) {
            if (mounted.current) {
                setMutationFeedback(current => ({
                    ...current,
                    [name]: { status: 'error', messageKey: mutationErrorKey(name, error) },
                }));
            }
            return false;
        }
    };
    if (state.status === 'loading')
        return _jsx("p", { "data-state": "loading", children: t('loading') });
    if (state.status === 'error') {
        return (_jsxs("div", { children: [_jsx("p", { role: "alert", children: t('loadError') }), _jsx("button", { "data-action": "retry", type: "button", onClick: retry, children: t('retry') })] }));
    }
    return (_jsx(PluginBridgeContent, { view: state.view, mutationFeedback: mutationFeedback, marketplaceLocation: marketplaceLocation, t: t, onMarketplaceLocationChange: setMarketplaceLocation, onRescan: async () => { await run('rescan', props.rescan); }, onAddMarketplace: async () => {
            const location = marketplaceLocation.trim();
            const succeeded = await run('addMarketplace', () => props.addMarketplace(location));
            if (succeeded && mounted.current)
                setMarketplaceLocation('');
        }, onImportMarketplace: async (ref) => {
            await run(`importMarketplace:${ref}`, () => props.importMarketplace(ref));
        }, onImportLocal: async (ref) => { await run(`importLocal:${ref}`, () => props.importLocal(ref)); }, onInstall: async (name, marketplace) => {
            await run(`install:${marketplace}:${name}`, () => props.install(name, marketplace));
        }, onSetEnabled: async (name, enabled) => {
            await run(`setEnabled:${name}`, () => props.setEnabled(name, enabled));
        }, onCheckPiUpdates: async () => {
            await run('checkPiUpdates', props.checkPiUpdates);
        }, onSetPiUpdateMode: async (mode) => {
            await run('setPiUpdateMode', () => props.setPiUpdateMode(mode));
        }, onSetPiPackageAutoUpdate: async (id, enabled) => {
            await run(`setPiPackageAutoUpdate:${id}`, () => props.setPiPackageAutoUpdate(id, enabled));
        }, onUpdatePiPackage: async (id) => {
            await run(`updatePiPackage:${id}`, () => props.updatePiPackage(id));
        }, onUpdateAllPiPackages: async () => {
            await run('updateAllPiPackages', props.updateAllPiPackages);
        } }));
}
//# sourceMappingURL=PluginBridgeSettingsTab.js.map