import type { ComponentMaterializationInput } from '../kernel.js';
export declare function record(value: unknown, label: string): Record<string, unknown>;
export declare function packageName(input: ComponentMaterializationInput): string;
export declare function slug(value: string): string;
export declare function boundedName(value: string, maxLength: number): string;
export declare function insidePlugin(input: ComponentMaterializationInput, path: string): string;
export declare function componentJson(input: ComponentMaterializationInput): unknown;
//# sourceMappingURL=utils.d.ts.map