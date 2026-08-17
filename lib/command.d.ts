import type { Context } from '@deepseek-ai/cordis';
import type { CommandResult } from '@deepseek-ai/dsh-commands';
import type { PluginBridgeKernel } from './kernel.js';
import type { PluginBridgeManagement } from './manager.js';
export declare const name = "plugin-bridge-command";
export declare const inject: string[];
/** Execute one human-facing bridge management command without a model turn. */
export declare function executePluginBridgeCommand(kernel: PluginBridgeKernel, rawInput: string, runtime?: PluginBridgeManagement): CommandResult | Promise<CommandResult>;
/** Register `/plugin-bridge` on every composed dsh command adapter. */
export declare function apply(ctx: Context): void;
//# sourceMappingURL=command.d.ts.map