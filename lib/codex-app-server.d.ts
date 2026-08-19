import type { CodexAppRpc } from './codex-host-relay.js';
export interface CodexAppServerProcessOptions {
    readonly command?: string;
    readonly cwd: string;
    readonly requestTimeoutMs?: number;
    readonly onStderr?: (text: string) => void;
}
/** JSONL client for the public `codex app-server --stdio` protocol. */
export declare class CodexAppServerProcess implements CodexAppRpc {
    private readonly options;
    private readonly child;
    private readonly pending;
    private nextId;
    private closed;
    private readonly requestTimeoutMs;
    private constructor();
    static connect(options: CodexAppServerProcessOptions): Promise<CodexAppServerProcess>;
    request<Result>(method: string, params: unknown): Promise<Result>;
    close(): Promise<void>;
    private notify;
    private write;
    private receive;
    private failAll;
}
//# sourceMappingURL=codex-app-server.d.ts.map