export interface ReleasePackage {
    readonly directory: string;
    readonly name: string;
    readonly version: string;
}
/** Build the dependency-safe workspace publication order for one repository tag. */
export declare function createReleasePlan(root: string, tag: string): Promise<ReleasePackage[]>;
//# sourceMappingURL=release-plan.d.ts.map