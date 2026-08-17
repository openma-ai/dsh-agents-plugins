import { z } from 'zod';
import type { PluginBridgeRemoteApi } from '../types.ts';
/** Checked-in strict descriptor for the external Bridge Host gateway. */
export declare const TYPERT_REMOTE: {
    package: string;
    descriptors: {
        id: string;
        service: string;
        namespace: string;
        method: string;
        invocation: {
            kind: "direct";
        };
        parameters: readonly {
            name: string;
            wire: string;
            source: "json";
            codec: {
                mode: "strict";
                typeSymbol: string;
                schema: z.ZodType<unknown, unknown, z.core.$ZodTypeInternals<unknown, unknown>>;
            };
        }[];
        result: {
            mode: "strict";
            typeSymbol: string;
            schema: z.ZodType<unknown, unknown, z.core.$ZodTypeInternals<unknown, unknown>>;
        };
    }[];
};
declare module '@deepseek-ai/dsh-typert-protocol' {
    interface TypertRemoteNamespaceMap {
        agentPluginsBridge: PluginBridgeRemoteApi;
    }
}
export default TYPERT_REMOTE;
//# sourceMappingURL=remote.d.ts.map