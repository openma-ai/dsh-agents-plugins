# dsh Agents Plugins Bridge

One dsh bridge kernel for portable [Agent Plugins](https://agent-plugins.org/), Codex plugins, Claude Code plugins, Pi packages, and future OpenCode package dialects.

Canonical source: [openma-ai/dsh-agents-plugins](https://github.com/openma-ai/dsh-agents-plugins).

## Install

The package is a dsh bundle. Installing it adds the kernel, format providers, adapters, and the human command as separate Cordis rows:

```sh
dsh plugin --profile web add @openma/dsh-agents-plugins-bridge
```

The Web profile also loads the bundle-owned
`@openma/dsh-agents-plugins-bridge-ui` contribution. Its **Agent plugins** tab
appears in Plugins settings after the Host Remote is ready; no separate UI
installation is required.

DSH composes plugins per profile. Install the bridge into each profile that
should consume foreign plugins (replace `web` with that profile name). The Web
profile is the recommended first install when foreign MCP servers expose Apps.
Install the independent MCP Apps bundle there unless the active Web bundle
already provides it:

```sh
dsh plugin --profile web add @openma/dsh-mcp-apps
```

Then inspect the active bridge:

```text
/plugin-bridge
/plugin-bridge marketplace list
/plugin-bridge discover
/plugin-bridge marketplace discover
```

Add a local marketplace directory or a GitHub repository, then install one entry:

```text
/plugin-bridge marketplace add /absolute/path/to/marketplace
/plugin-bridge marketplace add https://github.com/company/agent-plugins
/plugin-bridge marketplace add company/agent-plugins@main
/plugin-bridge install deployment-tools@company-tools
```

Existing foreign-agent state can be imported explicitly as well:

```text
/plugin-bridge discover
/plugin-bridge import codex-local-cache:personal/deployment-tools/1.2.3
/plugin-bridge marketplace discover
/plugin-bridge marketplace import claude-code-registered-marketplaces:company-tools
```

Both discovery commands are read-only. Import copies the selected package or local catalog into profile-local bridge storage before detection; it never activates code from the foreign agent's directory in place. Plugin import then uses the same format detection, component adapters, Loader transaction, rollback, and durable state as a marketplace install.

The install command copies the selected package into profile-local bridge storage, detects its format, materializes its supported components as independent dsh Loader rows, and commits the row plan atomically. Skills and MCP rows activate immediately. Bundled hook rows stay held until the user reviews and approves their current SHA-256 definition digest. A restart restores the approved subset of the exact plan. `disable` removes the live rows while retaining the package and digest approval, `enable` restores only currently approved rows, and `uninstall` removes installation approvals and moves its package copy into the bridge trash directory.

## Architecture

There is one installation and lifecycle kernel. Platforms extend it through six reversible registries:

```text
MarketplaceProvider   discovers marketplace catalogs and resolves package sources
PackageFormatProvider recognizes and normalizes an extracted plugin package
ComponentAdapter      maps normalized components onto explicit dsh Cordis rows
InstalledPluginLocator observes one agent's local plugin registry/cache
MarketplaceRegistrationLocator observes one agent's registered catalogs
ActivationPolicy      inspects and gates rows that require explicit user trust
```

The bundle never mounts one universal plugin runtime. A successful installation is compiled into explicit rows such as skill provider, MCP connection, hook dialect bridge, context contribution, or Web/TUI client extension. Each row can load, fail, reload, disable, and uninstall independently.

MCP tools, resources, prompts, and Apps share the same MCP connection. They are separate consumers of that connection, rather than separate server processes. The [`@openma/dsh-mcp-apps`](https://github.com/openma-ai/dsh-mcp-apps) bundle composes its Host and browser renderer as independent plugins; this bridge contributes the server connection row they consume. Hooks reuse dsh's existing Codex and Claude Code dialect bridges.

The shipped rows are intentionally granular:

| Row | Responsibility |
|---|---|
| kernel | reversible provider registries and deterministic detection |
| Agent Plugins / Codex / Claude / Pi format providers | one package dialect each |
| Codex / Claude marketplace providers | one catalog dialect each |
| Codex / Claude / Pi installed-plugin locators | one local state dialect each |
| Codex / Claude marketplace-registration locators | one registration state dialect each |
| skills / portable MCP / legacy MCP / hooks adapters | one dsh capability dialect each |
| hook approval policy | re-inspection, digest calculation, and human review text |
| runtime | durable install state and Loader transactions |
| UI Host gateway | strict browser-safe Remote projection and mutations |
| Web UI | installed, configured-marketplace, discovered-marketplace, and discovered-local views |
| command | `/plugin-bridge` user operations |

An MCP manifest expands again: every configured MCP server becomes its own `@deepseek-ai/dsh-mcp-client` row. One foreign bundle therefore never becomes one opaque universal runtime.

## Portable package core

Agent Plugins 1.0 is the portable core. The current provider recognizes the canonical root manifest:

```json
{
  "$schema": "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
  "name": "minimal-plugin"
}
```

It discovers standard components only at their fixed locations:

- `skills/` for Agent Skills
- `mcp.json` for MCP servers

The bridge first verifies that `skills/` is a directory and `mcp.json` is a regular file. A wrong entry type disables only that component and produces an install diagnostic. A valid `skills/` directory becomes one isolated `@deepseek-ai/dsh-skill-filesystem` row; that dsh provider discovers immediate `<name>/SKILL.md` bundles and warns and skips malformed entries without dropping valid siblings. Per-skill parse warnings therefore belong to the dsh skill provider rather than the bridge install result.

Schema selection is local and keyed by the canonical `$schema` identifier. Plugin loading never downloads a schema. The provider enforces Agent Plugins name constraints and the closed author object. Unknown top-level fields and a non-object `extensions` field remain visible diagnostics without becoming portable semantics.

Portable `mcp.json` uses its own adapter row, separate from Codex and Claude MCP compatibility. Every valid server becomes one Loader row. The adapter supports `stdio` and `streamable-http`, validates their closed variants, applies only the standard `${PLUGIN_ROOT}` and `${PLUGIN_DATA}` substitutions in `args`, `env`, and `cwd`, and injects a persistent per-installation `PLUGIN_DATA` directory. Invalid individual servers and dsh's unsupported legacy `sse` transport are skipped with diagnostics while independent skills and servers keep loading.

Codex `.codex-plugin/plugin.json` and Claude Code `.claude-plugin/plugin.json` layouts are compatibility providers; they do not redefine the portable core.

## Compatibility

| Source | Catalog | Package | Materialized components |
|---|---|---|---|
| Agent Plugins 1.0 | marketplace dialect not standardized | `plugin.json` | `skills/`, `mcp.json` |
| Codex | `.agents/plugins/marketplace.json` | `.codex-plugin/plugin.json` | skills, MCP servers, Codex hooks |
| Claude Code | `.claude-plugin/marketplace.json` | `.claude-plugin/plugin.json` | skills, MCP servers, Claude hooks |
| Pi | no marketplace registry | `package.json` with `pi`, or convention directories | directory skills |

Codex marketplace parsing follows the [official OpenAI packaging reference](https://developers.openai.com/plugins/build/plugins): local sources may be a `./` string or `{ "source": "local", "path": "./..." }`; HTTPS `url` and `git-subdir` entries honor `ref` or `sha`. Git subdirectories are copied from a root-contained path after clone. The documented `npm` source is rejected with an explicit unsupported diagnostic because reproducing Codex's no-lifecycle-script install safely is not implemented yet.

Claude marketplace-local directories and documented GitHub repository sources are supported. Other Claude source variants (`url`, `git-subdir`, `npm`, `archive`, and `command`) are not yet accepted. GitHub marketplace URLs and `owner/repo@ref` shorthand are cloned without a shell, and a supported catalog GitHub source honors its declared `ref` or `sha`.

### Local discovery boundaries

Codex plugin discovery reads only `[plugins."plugin@marketplace"]` registrations from `~/.codex/config.toml`, then resolves matching versioned copies under `~/.codex/plugins/cache/<marketplace>/<plugin>/<version>`. Results retain the configured enabled/disabled state and are labeled `plugin-cache`, because Codex does not expose a separate installed-path JSON registry there. The broad `~/.codex/.tmp/plugins` catalog sync is deliberately ignored and is never presented as installed state.

Claude Code plugin discovery reads its explicit `~/.claude/plugins/installed_plugins.json` registry and labels results `installed-registry`. It does not infer installations from marketplace checkout or cache contents.

Pi package discovery reads the explicit `packages` arrays in `~/.pi/agent/settings.json` and the current project's `.pi/settings.json`. It resolves Pi's managed npm and git install roots plus local paths relative to the owning settings file. Pi has no marketplace registry: npm, git, and local paths are package sources, while the public package gallery is discovery metadata rather than a catalog registration. The `pi-package` keyword alone never claims an ordinary Node package.

Pi package manifests may declare extensions, skills, prompt templates, and themes, or use the matching convention directories. Day-one bridging maps only directory skill roots to `@deepseek-ai/dsh-skill-filesystem`; flat Markdown skills and immediate `<name>/SKILL.md` bundles load, while Pi's recursively nested skill bundles are outside dsh's one-level discovery contract. Pi extensions execute arbitrary Pi runtime code, and Pi prompts, themes, resource globs, exclusions, and file-valued skills have different host semantics; they remain explicit unsupported components until dedicated adapters exist.

Registered marketplace discovery is a different provider layer. Codex reads only `[marketplaces.<name>]` entries from `~/.codex/config.toml`; Claude Code reads only `~/.claude/plugins/known_marketplaces.json`. Claude `installLocation` and Codex local sources are copied before registration. Supported GitHub Codex Git registrations are reacquired through the existing safe marketplace manager. Malformed, missing, duplicate, or unsupported entries become per-provider diagnostics and do not suppress valid siblings.

Unsupported legacy components remain in the install result instead of disappearing silently. Codex connector `.app.json`, Claude agents/commands/output styles/LSP/monitors, Pi runtime-specific resources, and future OpenCode dialects need their own component or format provider rows. MCP Apps returned by a bundled MCP server work through the shared dsh MCP connection; Codex `.app.json` registered-connection identifiers are host-specific and are not treated as executable MCP configuration.

## Commands

The owned command namespace is `/plugin-bridge`:

```text
/plugin-bridge marketplace add <url>
/plugin-bridge marketplace discover
/plugin-bridge marketplace import <locator:key>
/plugin-bridge marketplace list
/plugin-bridge install <plugin>@<marketplace>
/plugin-bridge discover
/plugin-bridge import <locator:key>
/plugin-bridge hooks review [plugin]
/plugin-bridge hooks approve <plugin> <sha256>
/plugin-bridge enable <plugin>
/plugin-bridge disable <plugin>
/plugin-bridge uninstall <plugin>
```

Discovery is always read-only and import is always explicit. Package update is reserved for a transaction that can acquire and validate the replacement before swapping rows; it is not exposed as a partial in-place mutation.

`hooks review` prints the exact current bundled hook definition and digest without activating it. `hooks approve` accepts only that 64-character digest. Approval is stored per policy, Loader row, and digest; changing a hook file invalidates the old approval on review, enable, or restart while independent skills and MCP rows remain active. The hook adapter contributes only generic activation metadata. Digest re-inspection lives in its own Cordis policy row, so the bridge kernel contains no Codex- or Claude-specific trust branch.

## Safety and lifecycle

- Package paths and symlink targets cannot escape the copied plugin root.
- Foreign plugin and marketplace directories are never modified; explicit imports copy first.
- Marketplace relative sources reject absolute paths and traversal.
- Git is invoked with argument arrays and never through a shell.
- Portable MCP subprocesses receive fixed bridge-owned `PLUGIN_ROOT` and `PLUGIN_DATA`; arbitrary `${ENV}` expansion is not performed for the portable dialect.
- Loader activation and state persistence roll back together on failure.
- Bundled hooks never activate merely because a foreign plugin was installed or enabled.
- Registration, row activation, disable, and disposal are reversible.
- Uninstalled package copies move to profile-local trash rather than being recursively deleted.

## Development

```sh
npm install
npm test
npm run typecheck
npm run build
```

Git installations run `prepare` to produce `lib/`. pnpm 10 may require the user to allow that build script explicitly; registry releases and packed tarballs ship built output.
