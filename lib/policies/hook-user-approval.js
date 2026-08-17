import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
function nonEmptyString(value, field) {
    if (typeof value !== 'string' || value.length === 0) {
        throw new TypeError(`hook approval metadata "${field}" must be a non-empty string`);
    }
    return value;
}
export const hookUserApprovalPolicy = {
    name: 'hook-user-approval',
    async inspect(requirement) {
        const metadata = requirement.metadata ?? {};
        const configPath = nonEmptyString(metadata.configPath, 'configPath');
        const componentPath = nonEmptyString(metadata.componentPath, 'componentPath');
        const pluginName = nonEmptyString(metadata.pluginName, 'pluginName');
        const fileText = await readFile(configPath, 'utf8');
        const manifestField = metadata.manifestField;
        if (manifestField !== undefined && typeof manifestField !== 'string') {
            throw new TypeError('hook approval metadata "manifestField" must be a string');
        }
        let definition = fileText;
        if (manifestField !== undefined) {
            const manifest = JSON.parse(fileText);
            if (typeof manifest !== 'object' || manifest === null || Array.isArray(manifest)) {
                throw new TypeError(`hook manifest "${configPath}" must contain an object`);
            }
            definition = JSON.stringify(manifest[manifestField]);
        }
        const digest = createHash('sha256').update(definition).digest('hex');
        return {
            ...requirement,
            digest,
            review: [
                `Plugin: ${pluginName}`,
                `Hook: ${componentPath}`,
                `File: ${configPath}`,
                `Digest: ${digest}`,
                'Definition:',
                definition.trimEnd(),
            ].join('\n'),
        };
    },
};
export const name = 'plugin-bridge-policy-hook-user-approval';
export const inject = ['pluginBridge'];
export function apply(ctx) {
    ctx.pluginBridge.registerActivationPolicy(hookUserApprovalPolicy);
}
//# sourceMappingURL=hook-user-approval.js.map