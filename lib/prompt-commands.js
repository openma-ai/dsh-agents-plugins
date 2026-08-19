import { readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { basename, extname, relative, resolve, sep } from 'node:path';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { minimatch } from 'minimatch';
import { slug } from './adapters/utils.js';
function contained(root, target) {
    return target === root || target.startsWith(`${root}${sep}`);
}
function scalar(value) {
    const trimmed = value.trim();
    if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
        try {
            return JSON.parse(trimmed);
        }
        catch {
            return trimmed.slice(1, -1);
        }
    }
    if (trimmed.length >= 2 && trimmed.startsWith("'") && trimmed.endsWith("'")) {
        return trimmed.slice(1, -1).replace(/''/gu, "'");
    }
    return trimmed;
}
function frontmatter(markdown) {
    if (!markdown.startsWith('---\n') && !markdown.startsWith('---\r\n')) {
        return { attributes: {}, body: markdown.trim() };
    }
    const normalized = markdown.replace(/\r\n/gu, '\n');
    const end = normalized.indexOf('\n---\n', 4);
    if (end < 0)
        return { attributes: {}, body: markdown.trim() };
    const attributes = {};
    for (const line of normalized.slice(4, end).split('\n')) {
        const match = /^([A-Za-z0-9_-]+):\s*(.*)$/u.exec(line);
        if (match?.[1] !== undefined && match[2] !== undefined)
            attributes[match[1]] = scalar(match[2]);
    }
    return { attributes, body: normalized.slice(end + 5).trim() };
}
function markdownFiles(root, target, recursive) {
    const realRoot = realpathSync(root);
    const realTarget = realpathSync(target);
    if (!contained(realRoot, realTarget))
        throw new TypeError(`prompt component resolves outside plugin root: ${target}`);
    if (statSync(realTarget).isFile())
        return extname(realTarget).toLowerCase() === '.md' ? [realTarget] : [];
    if (!statSync(realTarget).isDirectory())
        return [];
    const files = [];
    for (const entry of readdirSync(realTarget, { withFileTypes: true })) {
        const path = resolve(realTarget, entry.name);
        let real;
        try {
            real = realpathSync(path);
        }
        catch {
            continue;
        }
        if (!contained(realRoot, real))
            continue;
        if (entry.isDirectory() && recursive)
            files.push(...markdownFiles(realRoot, real, true));
        else if (entry.isFile() && extname(entry.name).toLowerCase() === '.md')
            files.push(real);
    }
    return files.sort();
}
function staticPrefix(pattern) {
    const wildcard = pattern.search(/[*?\[\]{}()]/u);
    if (wildcard < 0)
        return pattern;
    const prefix = pattern.slice(0, wildcard);
    const slash = prefix.lastIndexOf('/');
    return slash < 0 ? '.' : prefix.slice(0, slash) || '.';
}
function posix(path) {
    return path.split(sep).join('/');
}
function walkFiles(root, start) {
    let realStart;
    try {
        realStart = realpathSync(start);
    }
    catch {
        return [];
    }
    if (!contained(root, realStart))
        return [];
    const stats = statSync(realStart);
    if (stats.isFile())
        return [realStart];
    if (!stats.isDirectory())
        return [];
    const files = [];
    for (const entry of readdirSync(realStart, { withFileTypes: true })) {
        const path = resolve(realStart, entry.name);
        let real;
        try {
            real = realpathSync(path);
        }
        catch {
            continue;
        }
        if (!contained(root, real))
            continue;
        if (entry.isDirectory())
            files.push(...walkFiles(root, real));
        else if (entry.isFile())
            files.push(real);
    }
    return files;
}
function piMarkdownFiles(root, entries) {
    const excludes = entries.filter(entry => entry.startsWith('!')).map(entry => entry.slice(1));
    const files = new Set();
    for (const expression of entries.filter(entry => !entry.startsWith('!'))) {
        const patterned = /[*?\[\]{}()]/u.test(expression);
        const target = resolve(root, patterned ? staticPrefix(expression) : expression);
        if (!contained(root, target))
            throw new TypeError(`Pi prompt path "${expression}" escapes the plugin root`);
        const candidates = patterned
            ? walkFiles(root, target)
            : markdownFiles(root, target, false);
        for (const file of candidates) {
            if (extname(file).toLowerCase() !== '.md')
                continue;
            const local = posix(relative(root, file));
            if (patterned && !minimatch(local, expression, { dot: true }))
                continue;
            if (excludes.some(pattern => minimatch(local, pattern, { dot: true })))
                continue;
            files.add(file);
        }
    }
    return [...files].sort();
}
function commandSuffix(componentRoot, file, declaredName) {
    if (declaredName !== undefined && declaredName.trim().length > 0)
        return slug(declaredName);
    const stats = statSync(componentRoot);
    const withoutExtension = stats.isFile()
        ? basename(file, extname(file))
        : relative(componentRoot, file).slice(0, -extname(file).length);
    return slug(withoutExtension.split(sep).join('-'));
}
function parseArguments(input) {
    const args = [];
    let value = '';
    let quote;
    let escaped = false;
    for (const character of input.trim()) {
        if (escaped) {
            value += character;
            escaped = false;
            continue;
        }
        if (character === '\\' && quote !== "'") {
            escaped = true;
            continue;
        }
        if (quote !== undefined) {
            if (character === quote)
                quote = undefined;
            else
                value += character;
            continue;
        }
        if (character === '"' || character === "'") {
            quote = character;
            continue;
        }
        if (/\s/u.test(character)) {
            if (value.length > 0) {
                args.push(value);
                value = '';
            }
            continue;
        }
        value += character;
    }
    if (escaped)
        value += '\\';
    if (value.length > 0)
        args.push(value);
    return args;
}
function projectDir(agent) {
    const cwd = agent.session.header.cwd;
    return typeof cwd === 'string' && cwd.length > 0 ? cwd : process.cwd();
}
export function expandPrompt(body, rawInput, config, agent) {
    const args = parseArguments(rawInput);
    const all = args.join(' ');
    return body
        .replaceAll('${CLAUDE_PLUGIN_ROOT}', config.pluginRoot)
        .replaceAll('${CLAUDE_PLUGIN_DATA}', config.pluginData ?? '${CLAUDE_PLUGIN_DATA}')
        .replaceAll('${CLAUDE_PROJECT_DIR}', projectDir(agent))
        .replace(/\$\{(?:@|ARGUMENTS):-([^}]*)\}/gu, (_match, fallback) => all || fallback)
        .replace(/\$\{(\d+):-([^}]*)\}/gu, (_match, index, fallback) => args[Number(index) - 1] || fallback)
        .replace(/\$\{@:(\d+)(?::(\d+))?\}/gu, (_match, start, length) => {
        const from = Math.max(0, Number(start) - 1);
        return args.slice(from, length === undefined ? undefined : from + Number(length)).join(' ');
    })
        .replace(/\$ARGUMENTS|\$@/gu, all)
        .replace(/\$(\d+)/gu, (_match, index) => args[Number(index) - 1] ?? '');
}
function templates(config) {
    const pluginRoot = realpathSync(config.pluginRoot);
    const componentRoot = config.componentPath === undefined ? pluginRoot : resolve(pluginRoot, config.componentPath);
    if (!contained(pluginRoot, componentRoot))
        throw new TypeError('prompt component escapes plugin root');
    const files = config.dialect === 'pi' && config.entries !== undefined
        ? piMarkdownFiles(pluginRoot, config.entries)
        : markdownFiles(pluginRoot, componentRoot, config.dialect === 'claude-code');
    return files.map((file) => {
        const parsed = frontmatter(readFileSync(file, 'utf8'));
        const suffix = config.dialect === 'pi'
            ? slug(parsed.attributes.name ?? basename(file, extname(file)))
            : commandSuffix(componentRoot, file, parsed.attributes.name);
        return {
            name: `${slug(config.pluginName)}-${suffix}`,
            description: parsed.attributes.description ?? `Imported ${config.dialect} prompt ${suffix}`,
            ...parsed.attributes['argument-hint'] === undefined
                ? {}
                : { argumentHint: parsed.attributes['argument-hint'] },
            body: parsed.body,
        };
    });
}
export const name = 'plugin-bridge-prompt-commands';
export const inject = ['commands'];
export function apply(ctx, config) {
    for (const template of templates(config)) {
        ctx.commands.register({
            name: template.name,
            description: template.description,
            ...template.argumentHint === undefined ? {} : { input: { hint: template.argumentHint } },
            handler: ({ agent, rawInput }) => {
                const text = expandPrompt(template.body, rawInput, config, agent);
                agent.steer(createUserMessage({
                    content: [{ type: 'text', text }],
                    source: { kind: 'user' },
                }));
                return { kind: 'success', text: `Expanded /${template.name}.` };
            },
        });
    }
}
//# sourceMappingURL=prompt-commands.js.map