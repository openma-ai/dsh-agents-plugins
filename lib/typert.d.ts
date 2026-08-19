/** Host face consumed automatically by DSH's typert-loader. */
export declare const TYPERT: {
    package: string;
    face: string;
    schemas: never[];
    invocations: {
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
                schema: import("zod").ZodType<unknown, unknown, import("zod/v4/core").$ZodTypeInternals<unknown, unknown>>;
            };
        }[];
        result: {
            mode: "strict";
            typeSymbol: string;
            schema: import("zod").ZodType<unknown, unknown, import("zod/v4/core").$ZodTypeInternals<unknown, unknown>>;
        };
    }[];
    model: {
        services: {
            description: string;
            summary: string;
            tags: never[];
            jsDoc: string;
            key: string;
            exportName: string;
            members: {
                kind: string;
                name: "snapshot" | "discoverLocal" | "discoverMarketplaces" | "addMarketplace" | "importMarketplace" | "importLocal" | "installPlugin" | "setEnabled";
                signature: "snapshot(): AgentPluginsSnapshot" | "discoverLocal(): Promise<AgentPluginsLocalDiscoveryView>" | "discoverMarketplaces(): Promise<AgentPluginsMarketplaceDiscoveryView>" | "addMarketplace(location: string): Promise<AgentPluginsSnapshot>" | "importMarketplace(ref: string): Promise<AgentPluginsSnapshot>" | "importLocal(ref: string): Promise<AgentPluginsSnapshot>" | "installPlugin(name: string, marketplace: string): Promise<AgentPluginsInstallResult>" | "setEnabled(name: string, enabled: boolean): Promise<AgentPluginsSnapshot>";
                summary: string;
                jsDoc: string;
            }[];
            types: never[];
        }[];
        events: never[];
        objects: never[];
    };
};
export default TYPERT;
//# sourceMappingURL=typert.d.ts.map