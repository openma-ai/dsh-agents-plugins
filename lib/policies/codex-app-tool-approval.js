import { CodexAppServerProcess } from '../codex-app-server.js';
import { CodexHostRelay, createCodexAppApprovalCatalog, } from '../codex-host-relay.js';
export const name = 'plugin-bridge-policy-codex-app-tool-approval';
export const inject = ['tools'];
function requireString(value, label) {
    if (typeof value !== 'string' || value.length === 0)
        throw new TypeError(`${label} must be a non-empty string`);
    return value;
}
function validateConfig(config) {
    return {
        appName: requireString(config.appName, 'codex-app-tool-approval.appName'),
        connectionId: requireString(config.connectionId, 'codex-app-tool-approval.connectionId'),
        serverName: requireString(config.serverName, 'codex-app-tool-approval.serverName'),
        cwd: requireString(config.cwd, 'codex-app-tool-approval.cwd'),
        ...config.codexCommand === undefined
            ? {}
            : { codexCommand: requireString(config.codexCommand, 'codex-app-tool-approval.codexCommand') },
    };
}
/** Ask through DSH for every non-read-only Codex App tool; unknown future tools fail closed. */
export async function apply(ctx, rawConfig) {
    const config = validateConfig(rawConfig);
    let catalog = createCodexAppApprovalCatalog(config.serverName, []);
    let relay;
    try {
        const rpc = await CodexAppServerProcess.connect({
            cwd: config.cwd,
            ...config.codexCommand === undefined ? {} : { command: config.codexCommand },
        });
        relay = new CodexHostRelay(rpc, config);
        await relay.initialize();
        catalog = createCodexAppApprovalCatalog(config.serverName, relay.listTools());
    }
    catch (error) {
        ctx.logger.warn(`codex-app-tool-approval(${config.appName}): could not load read-only catalog; all relay tools require approval: ${String(error)}`);
    }
    finally {
        await relay?.close();
    }
    ctx.on('tools/pre-execute', (execution, next) => {
        if (!catalog.requiresApproval(execution.name))
            return next();
        return Promise.resolve({
            kind: 'ask',
            reason: `Codex App "${config.appName}" tool "${execution.name}" may modify external state.`,
        });
    });
}
//# sourceMappingURL=codex-app-tool-approval.js.map