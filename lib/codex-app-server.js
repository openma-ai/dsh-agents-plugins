import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
function errorMessage(value) {
    if (typeof value !== 'object' || value === null || Array.isArray(value))
        return String(value);
    const record = value;
    return typeof record.message === 'string' ? record.message : JSON.stringify(value);
}
/** JSONL client for the public `codex app-server --stdio` protocol. */
export class CodexAppServerProcess {
    options;
    child;
    pending = new Map();
    nextId = 1;
    closed = false;
    requestTimeoutMs;
    constructor(options) {
        this.options = options;
        this.requestTimeoutMs = options.requestTimeoutMs ?? 120_000;
        this.child = spawn(options.command ?? 'codex', ['app-server', '--stdio'], {
            cwd: options.cwd,
            env: process.env,
            stdio: ['pipe', 'pipe', 'pipe'],
        });
        const stdout = createInterface({ input: this.child.stdout, crlfDelay: Infinity });
        stdout.on('line', line => this.receive(line));
        if (options.onStderr !== undefined) {
            this.child.stderr.setEncoding('utf8');
            this.child.stderr.on('data', chunk => { options.onStderr?.(String(chunk)); });
        }
        else {
            this.child.stderr.resume();
        }
        this.child.once('error', error => this.failAll(error));
        this.child.once('exit', (code, signal) => {
            this.closed = true;
            this.failAll(new Error(`codex app-server exited (code=${String(code)}, signal=${String(signal)})`));
        });
    }
    static async connect(options) {
        const rpc = new CodexAppServerProcess(options);
        try {
            await rpc.request('initialize', {
                clientInfo: {
                    name: 'dsh_plugin_bridge',
                    title: 'DSH Plugin Bridge',
                    version: '0.1.0',
                },
                capabilities: {
                    experimentalApi: true,
                    extensions: {
                        'io.modelcontextprotocol/ui': {
                            mimeTypes: ['text/html;profile=mcp-app'],
                        },
                    },
                },
            });
            rpc.notify('initialized');
            return rpc;
        }
        catch (error) {
            await rpc.close();
            throw error;
        }
    }
    request(method, params) {
        if (this.closed)
            return Promise.reject(new Error('codex app-server connection is closed'));
        const id = this.nextId++;
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                this.pending.delete(id);
                reject(new Error(`codex app-server request ${method} timed out after ${this.requestTimeoutMs}ms`));
            }, this.requestTimeoutMs);
            timeout.unref();
            this.pending.set(id, {
                method,
                resolve: value => resolve(value),
                reject,
                timeout,
            });
            this.write({ method, id, params });
        });
    }
    async close() {
        if (this.closed)
            return;
        this.closed = true;
        this.failAll(new Error('codex app-server connection closed'));
        this.child.stdin.end();
        if (this.child.exitCode !== null || this.child.signalCode !== null)
            return;
        const exited = new Promise(resolve => { this.child.once('exit', () => resolve()); });
        const timeout = new Promise(resolve => {
            const timer = setTimeout(resolve, 2_000);
            timer.unref();
        });
        await Promise.race([exited, timeout]);
        if (this.child.exitCode === null && this.child.signalCode === null)
            this.child.kill('SIGTERM');
    }
    notify(method, params) {
        this.write({ method, ...params === undefined ? {} : { params } });
    }
    write(message) {
        if (this.closed)
            throw new Error('codex app-server connection is closed');
        this.child.stdin.write(`${JSON.stringify(message)}\n`);
    }
    receive(line) {
        if (line.trim().length === 0)
            return;
        let message;
        try {
            const parsed = JSON.parse(line);
            if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))
                throw new Error('message is not an object');
            message = parsed;
        }
        catch (error) {
            this.failAll(new Error(`invalid JSON from codex app-server: ${String(error)}`));
            return;
        }
        if ((typeof message.id === 'number') && this.pending.has(message.id)) {
            const pending = this.pending.get(message.id);
            this.pending.delete(message.id);
            clearTimeout(pending.timeout);
            if (message.error !== undefined) {
                pending.reject(new Error(`codex app-server ${pending.method} failed: ${errorMessage(message.error)}`));
            }
            else {
                pending.resolve(message.result);
            }
            return;
        }
        // Direct MCP calls must never hang on an approval or other host callback
        // that DSH cannot safely answer on this transport. The DSH policy layer
        // asks before writes; anything still requested here fails closed.
        if ((typeof message.id === 'number' || typeof message.id === 'string')
            && typeof message.method === 'string') {
            this.write({
                id: message.id,
                error: {
                    code: -32601,
                    message: `DSH Codex relay does not support server request ${message.method}`,
                },
            });
        }
    }
    failAll(error) {
        for (const pending of this.pending.values()) {
            clearTimeout(pending.timeout);
            pending.reject(error);
        }
        this.pending.clear();
    }
}
//# sourceMappingURL=codex-app-server.js.map