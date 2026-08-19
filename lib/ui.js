import { mountOwnedDependency } from './owned-dependency.js';
export const name = 'plugin-bridge-ui-wrapper';
export const inject = ['loader'];
export function apply(ctx, config) {
    return mountOwnedDependency(ctx, '@openma/dsh-agents-plugins-bridge-ui', config);
}
//# sourceMappingURL=ui.js.map