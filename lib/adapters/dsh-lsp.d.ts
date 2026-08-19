import type { Context } from '@deepseek-ai/cordis';
import type { ComponentAdapter } from '../kernel.js';
/** Map Claude's declarative stdio LSP table onto DSH's generic LSP provider seam. */
export declare const dshLspAdapter: ComponentAdapter;
export declare const name = "plugin-bridge-adapter-dsh-lsp";
export declare const inject: string[];
export declare function apply(ctx: Context): void;
//# sourceMappingURL=dsh-lsp.d.ts.map