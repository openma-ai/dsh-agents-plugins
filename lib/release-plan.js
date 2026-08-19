import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
const RELEASE_DIRECTORIES = ['packages/theme-adapter', 'packages/ui', '.'];
/** Build the dependency-safe workspace publication order for one repository tag. */
export async function createReleasePlan(root, tag) {
    const packages = await Promise.all(RELEASE_DIRECTORIES.map(async (directory) => {
        const manifest = JSON.parse(await readFile(join(root, directory, 'package.json'), 'utf8'));
        if (typeof manifest.name !== 'string' || typeof manifest.version !== 'string') {
            throw new TypeError(`${directory}/package.json: release packages require string name and version`);
        }
        return { directory, name: manifest.name, version: manifest.version };
    }));
    const versions = new Set(packages.map(pkg => pkg.version));
    if (versions.size !== 1) {
        throw new Error(`release package versions must match: ${packages.map(pkg => `${pkg.name}@${pkg.version}`).join(', ')}`);
    }
    const version = packages[0].version;
    if (tag !== `v${version}`)
        throw new Error(`release tag ${tag} does not match package version ${version}`);
    return packages;
}
//# sourceMappingURL=release-plan.js.map