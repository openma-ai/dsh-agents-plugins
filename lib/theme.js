import { mountOwnedDependency } from './owned-dependency.js';
export const name = 'plugin-bridge-theme-wrapper';
export const inject = ['loader'];
export function apply(ctx, config) {
    return mountOwnedDependency(ctx, '@openma/dsh-agents-plugins-bridge-theme', config);
}
//# sourceMappingURL=theme.js.map