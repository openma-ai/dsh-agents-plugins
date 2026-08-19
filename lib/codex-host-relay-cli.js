#!/usr/bin/env node
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { CodexAppServerProcess } from './codex-app-server.js';
import { CodexHostRelay } from './codex-host-relay.js';
function record(value, label) {
    if (typeof value !== 'object' || value === null || Array.isArray(value))
        throw new Error(`${label} must be an object`);
    return value;
}
function parseArgs(args) {
    const values = new Map();
    for (let index = 0; index < args.length; index += 2) {
        const key = args[index];
        const value = args[index + 1];
        if (key === undefined || value === undefined || !key.startsWith('--')) {
            throw new Error('usage: codex-host-relay --app-name NAME --connection-id ID --cwd PATH [--codex-command PATH]');
        }
        values.set(key, value);
    }
    const appName = values.get('--app-name');
    const connectionId = values.get('--connection-id');
    const cwd = values.get('--cwd');
    if (appName === undefined || connectionId === undefined || cwd === undefined) {
        throw new Error('usage: codex-host-relay --app-name NAME --connection-id ID --cwd PATH [--codex-command PATH]');
    }
    const codexCommand = values.get('--codex-command');
    return { appName, connectionId, cwd, ...codexCommand === undefined ? {} : { codexCommand } };
}
export class CodexRelayMcpProtocol {
    relay;
    initialized = false;
    constructor(relay) {
        this.relay = relay;
    }
    async handle(message) {
        if (message.method === 'notifications/initialized' || message.method === 'notifications/cancelled')
            return undefined;
        if (message.id === undefined)
            return undefined;
        try {
            const result = await this.dispatch(message.method, message.params);
            return { jsonrpc: '2.0', id: message.id, result };
        }
        catch (error) {
            return {
                jsonrpc: '2.0',
                id: message.id,
                error: {
                    code: error instanceof UnsupportedMethodError ? -32601 : -32602,
                    message: error instanceof Error ? error.message : String(error),
                },
            };
        }
    }
    async dispatch(method, params) {
        if (method === 'initialize') {
            const input = record(params, 'initialize params');
            const protocolVersion = typeof input.protocolVersion === 'string'
                ? input.protocolVersion
                : '2025-06-18';
            this.initialized = true;
            return {
                protocolVersion,
                capabilities: {
                    tools: { listChanged: false },
                    resources: { subscribe: false, listChanged: false },
                },
                serverInfo: { name: 'dsh-codex-host-relay', version: '0.1.0' },
            };
        }
        if (!this.initialized)
            throw new Error('MCP relay is not initialized');
        if (method === 'ping')
            return {};
        if (method === 'tools/list')
            return { tools: this.relay.listTools() };
        if (method === 'tools/call') {
            const input = record(params, 'tools/call params');
            const name = typeof input.name === 'string' ? input.name : undefined;
            if (name === undefined)
                throw new Error('tools/call params.name must be a string');
            const args = input.arguments === undefined ? undefined : record(input.arguments, 'tools/call arguments');
            const meta = input._meta === undefined ? undefined : record(input._meta, 'tools/call _meta');
            return await this.relay.callTool(name, args, meta);
        }
        if (method === 'resources/list')
            return { resources: this.relay.listResources() };
        if (method === 'resources/templates/list') {
            return { resourceTemplates: this.relay.listResourceTemplates() };
        }
        if (method === 'resources/read') {
            const input = record(params, 'resources/read params');
            const uri = typeof input.uri === 'string' ? input.uri : undefined;
            if (uri === undefined)
                throw new Error('resources/read params.uri must be a string');
            return await this.relay.readResource(uri);
        }
        throw new UnsupportedMethodError(method);
    }
}
class UnsupportedMethodError extends Error {
    constructor(method) {
        super(`MCP method ${method} is not supported by the Codex App relay`);
    }
}
async function main() {
    const config = parseArgs(process.argv.slice(2));
    const rpc = await CodexAppServerProcess.connect({
        cwd: config.cwd,
        ...config.codexCommand === undefined ? {} : { command: config.codexCommand },
        onStderr: text => { process.stderr.write(text); },
    });
    const relay = new CodexHostRelay(rpc, config);
    await relay.initialize();
    const protocol = new CodexRelayMcpProtocol(relay);
    const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
    let chain = Promise.resolve();
    input.on('line', line => {
        chain = chain.then(async () => {
            if (line.trim().length === 0)
                return;
            const parsed = JSON.parse(line);
            const message = record(parsed, 'MCP request');
            if (typeof message.method !== 'string')
                throw new Error('MCP request method must be a string');
            const response = await protocol.handle(message);
            if (response !== undefined)
                process.stdout.write(`${JSON.stringify(response)}\n`);
        }).catch(error => {
            process.stderr.write(`codex-host-relay: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
        });
    });
    const dispose = async () => {
        input.close();
        await chain;
        await relay.close();
    };
    process.once('SIGINT', () => { void dispose().finally(() => process.exit(130)); });
    process.once('SIGTERM', () => { void dispose().finally(() => process.exit(143)); });
    await new Promise(resolveDone => { input.once('close', () => resolveDone()); });
    await chain;
    await relay.close();
}
if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    void main().catch(error => {
        process.stderr.write(`codex-host-relay: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
        process.exitCode = 1;
    });
}
//# sourceMappingURL=codex-host-relay-cli.js.map