import type { Context } from '@deepseek-ai/cordis';
import type { ThemeDefinition } from '@deepseek-ai/dsh-client-ui-theme/client';
export interface Config {
    readonly themes: readonly ThemeDefinition[];
}
export declare const inject: string[];
/** Register package-owned themes as one disposable client contribution. */
export declare function apply(ctx: Context, config: Config): () => void;
//# sourceMappingURL=client.d.ts.map