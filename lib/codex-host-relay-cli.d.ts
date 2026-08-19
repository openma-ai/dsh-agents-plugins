#!/usr/bin/env node
import { CodexHostRelay } from './codex-host-relay.js';
type RequestId = number | string;
interface McpRequest {
    readonly jsonrpc?: string;
    readonly id?: RequestId;
    readonly method: string;
    readonly params?: unknown;
}
export declare class CodexRelayMcpProtocol {
    private readonly relay;
    private initialized;
    constructor(relay: CodexHostRelay);
    handle(message: McpRequest): Promise<Record<string, unknown> | undefined>;
    private dispatch;
}
export {};
//# sourceMappingURL=codex-host-relay-cli.d.ts.map