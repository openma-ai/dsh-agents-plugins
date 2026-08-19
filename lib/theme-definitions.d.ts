export interface DshThemeDefinition {
    readonly id: string;
    readonly colorScheme: 'light' | 'dark';
    readonly tokens: Readonly<Record<string, string>>;
}
export interface ThemeLoadResult {
    readonly themes: readonly DshThemeDefinition[];
    readonly diagnostics: readonly string[];
}
type ThemeDialect = 'claude-code' | 'pi';
export declare function loadThemeDefinitions(dialect: ThemeDialect, pluginName: string, pluginRoot: string, entries: readonly string[]): ThemeLoadResult;
export {};
//# sourceMappingURL=theme-definitions.d.ts.map