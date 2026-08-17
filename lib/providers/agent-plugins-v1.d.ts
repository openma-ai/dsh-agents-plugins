import type { Context } from '@deepseek-ai/cordis';
import type { PackageFormatProvider } from '../kernel.js';
export declare const AGENT_PLUGINS_V1_SCHEMA = "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json";
export declare const AGENT_PLUGINS_V1_MCP_SCHEMA = "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json";
/** Portable Agent Plugins 1.0 package format. */
export declare const agentPluginsV1Provider: PackageFormatProvider;
export declare const name = "plugin-bridge-format-agent-plugins-v1";
export declare const inject: string[];
/** Register the portable standard format on the shared bridge kernel. */
export declare function apply(ctx: Context): void;
//# sourceMappingURL=agent-plugins-v1.d.ts.map