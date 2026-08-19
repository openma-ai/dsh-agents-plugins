export type JsonValue = null | boolean | number | string | JsonValue[] | {
    [key: string]: JsonValue;
};
export interface CodexAppRpc {
    request<Result>(method: string, params: unknown): Promise<Result>;
    close(): Promise<void>;
}
export interface CodexHostRelayOptions {
    readonly appName: string;
    readonly connectionId: string;
    readonly cwd: string;
}
export interface CodexMcpTool extends Record<string, unknown> {
    readonly name: string;
    readonly description?: string;
    readonly inputSchema: Readonly<Record<string, unknown>>;
    readonly annotations?: Readonly<Record<string, unknown>>;
    readonly _meta?: Readonly<Record<string, unknown>>;
}
export interface CodexMcpResource extends Record<string, unknown> {
    readonly uri: string;
    readonly name: string;
    readonly _meta?: Readonly<Record<string, unknown>>;
}
export interface CodexMcpResourceTemplate extends Record<string, unknown> {
    readonly uriTemplate: string;
    readonly name: string;
    readonly _meta?: Readonly<Record<string, unknown>>;
}
export interface CodexMcpCallResult extends Record<string, unknown> {
    readonly content: readonly JsonValue[];
    readonly structuredContent?: JsonValue;
    readonly isError?: boolean;
    readonly _meta?: JsonValue;
}
/** Deterministic public name used by dsh-mcp-client for one server/raw-tool identity. */
export declare function publicMcpToolName(serverName: string, rawName: string): string;
export interface CodexAppApprovalCatalog {
    requiresApproval(publicToolName: string): boolean;
}
/**
 * Classify the exact DSH names contributed by one relay. Unknown names inside
 * its namespace fail closed; tools declared read-only pass through.
 */
export declare function createCodexAppApprovalCatalog(serverName: string, tools: readonly CodexMcpTool[]): CodexAppApprovalCatalog;
/** One filtered view of Codex's hosted `codex_apps` MCP server. */
export declare class CodexHostRelay {
    private readonly rpc;
    private readonly options;
    private threadId;
    private tools;
    private resources;
    private resourceTemplates;
    private readonly rawToolNames;
    private readonly allowedResourceUris;
    constructor(rpc: CodexAppRpc, options: CodexHostRelayOptions);
    initialize(): Promise<void>;
    listTools(): readonly CodexMcpTool[];
    listResources(): readonly CodexMcpResource[];
    listResourceTemplates(): readonly CodexMcpResourceTemplate[];
    callTool(name: string, args?: Readonly<Record<string, unknown>>, meta?: Readonly<Record<string, unknown>>): Promise<CodexMcpCallResult>;
    readResource(uri: string): Promise<unknown>;
    close(): Promise<void>;
    private requireInitialized;
}
//# sourceMappingURL=codex-host-relay.d.ts.map