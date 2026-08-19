export const inject = ['theme'];
/** Register package-owned themes as one disposable client contribution. */
export function apply(ctx, config) {
    if (!Array.isArray(config.themes))
        throw new TypeError('plugin bridge theme config requires a themes array');
    const disposers = [];
    try {
        for (const definition of config.themes)
            disposers.push(ctx.theme.register(definition));
    }
    catch (error) {
        for (const dispose of disposers.reverse())
            dispose();
        throw error;
    }
    return () => {
        for (const dispose of disposers.reverse())
            dispose();
    };
}
//# sourceMappingURL=client.js.map