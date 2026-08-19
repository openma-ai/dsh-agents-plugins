# dsh Agents Plugins Bridge

One dsh bridge kernel for portable [Agent Plugins](https://agent-plugins.org/), Codex plugins, Claude Code plugins, Pi packages, and future OpenCode package dialects.

Canonical source: [openma-ai/dsh-agents-plugins-bridge](https://github.com/openma-ai/dsh-agents-plugins-bridge).

## Install

The root package is the one-install dsh bundle. Installing it adds the kernel,
format providers, adapters, command, and platform adapter rows. Use the same
package for TUI and Web:

```sh
dsh plugin --profile tui add @openma/dsh-agents-plugins-bridge
dsh plugin --profile web add @openma/dsh-agents-plugins-bridge
```

The bridge registers `/plugin-bridge` on the Host. DSH ACP projects that
command, imported foreign slash commands, and user-invocable skills into the
TUI command menu. Hooks, skills, commands, prompts, MCP connections, and the
other backend rows therefore work without a browser UI or MCP Apps renderer.

The root bundle carries the Web UI package as a child dependency. Its adaptive
surface row mounts the independent Host-gateway and Browser rows through DSH's
Loader only when the Web Host seam exists. The **Agent plugins** tab therefore
appears in Web Plugins settings, while TUI loads only the backend capabilities.
Existing profiles that explicitly installed the older UI bundle continue to
work; the adaptive row reuses those Loader entries rather than duplicating them.

DSH composes plugins per profile. Install the root bridge into each profile
that should consume foreign plugins. The independent MCP Apps bundle is
optional and belongs on a Web profile when foreign MCP servers expose Apps;
the bridge's backend capabilities do not depend on it:

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

The install command copies the selected package into profile-local bridge storage, detects its format, materializes its supported components as independent dsh Loader rows, and commits the row plan atomically. Skills, MCP rows, Pi extensions, and Codex and Claude Code hooks activate immediately because explicit import plus enable is their execution-consent boundary. A restart restores the active subset of the exact plan. `disable` removes the live rows while retaining the package, `enable` restores eligible rows, and `uninstall` moves its package copy into the bridge trash directory.

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

MCP tools, resources, prompts, and Apps share the same MCP connection. They are separate consumers of that connection, rather than separate server processes. The [`@openma/dsh-mcp-apps`](https://github.com/openma-ai/dsh-mcp-apps) bundle composes its Host and browser renderer as independent plugins; this bridge contributes the server connection row they consume. A Codex registered App is the exception at the foreign-host boundary: its relay row owns one Codex app-server process because the connection and OAuth lifecycle remain owned by Codex. Hook rows mount Bridge-owned Host plugins; each Host nests dsh's official Codex or Claude Code hook dialect plugin with `ctx.plugin`, so Web and TUI share the same lifecycle and dependency closure.

The shipped rows are intentionally granular:

| Row | Responsibility |
|---|---|
| kernel | reversible provider registries and deterministic detection |
| Agent Plugins / Codex / Claude / Pi format providers | one package dialect each |
| Codex / Claude marketplace providers | one catalog dialect each |
| Codex / Claude / Pi installed-plugin locators | one local state dialect each |
| Codex / Claude marketplace-registration locators | one registration state dialect each |
| skills / commands / prompts / themes / LSP / MCP / Codex registered Apps / hooks / Claude agents / output styles / monitors adapters | one dsh capability dialect each |
| foreign-theme client | registers compiled themes on the Web `theme` seam and disposes them with the owning row |
| Codex App MCP relay | filters one declared connection and proxies its tools and resources through the public Codex app-server protocol |
| Codex App tool approval policy | lets declared read-only tools pass and asks through DSH before writes; unknown future tools fail closed |
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
| Codex | `.agents/plugins/marketplace.json` | `.codex-plugin/plugin.json` | skills, MCP servers, registered Apps, Codex hooks |
| Claude Code | `.claude-plugin/marketplace.json` | `.claude-plugin/plugin.json` | skills, MCP servers, hooks, commands, agents, output styles, monitors, themes, LSP servers |
| Pi | no marketplace registry | `package.json` with `pi`, or convention directories | extensions, skills, prompt templates, themes |

Codex marketplace parsing follows the [official OpenAI packaging reference](https://developers.openai.com/plugins/build/plugins): local sources may be a `./` string or `{ "source": "local", "path": "./..." }`; HTTPS `url` and `git-subdir` entries honor `ref` or `sha`. Git subdirectories are copied from a root-contained path after clone. The documented `npm` source is rejected with an explicit unsupported diagnostic because reproducing Codex's no-lifecycle-script install safely is not implemented yet.

Claude marketplace-local directories plus the official `github`, HTTPS `url`, and `git-subdir` source shapes are supported. Git subdirectories must remain root-contained and `ref` or `sha` pins are preserved. The documented `npm` source remains an explicit unsupported error; unknown source shapes are never guessed or silently downgraded. GitHub marketplace URLs and `owner/repo@ref` shorthand are cloned without a shell.

### Local discovery boundaries

Codex plugin discovery reads only `[plugins."plugin@marketplace"]` registrations from `~/.codex/config.toml`, then resolves matching versioned copies under `~/.codex/plugins/cache/<marketplace>/<plugin>/<version>`. Results retain the configured enabled/disabled state and are labeled `plugin-cache`, because Codex does not expose a separate installed-path JSON registry there. The broad `~/.codex/.tmp/plugins` catalog sync is deliberately ignored and is never presented as installed state.

Claude Code plugin discovery reads its explicit `~/.claude/plugins/installed_plugins.json` registry and labels results `installed-registry`. It does not infer installations from marketplace checkout or cache contents.

Pi package discovery reads the explicit `packages` arrays in `~/.pi/agent/settings.json` and the current project's `.pi/settings.json`. It resolves Pi's managed npm and git install roots plus local paths relative to the owning settings file. Pi has no marketplace registry: npm, git, and local paths are package sources, while the public package gallery is discovery metadata rather than a catalog registration. The `pi-package` keyword alone never claims an ordinary Node package.

Pi package manifests may declare extensions, skills, prompt templates, and themes, or use the matching convention directories. A dedicated Pi skill provider preserves exact files, directories, recursive `SKILL.md` discovery, flat Markdown skills, glob expressions, and `!` exclusions before registering each definition on `ctx.skills`. Prompt resources preserve the same path-expression boundary and become namespaced DSH slash commands. Theme JSON resolves Pi variables and xterm-256 colors, maps the roles DSH exposes, and registers browser themes through the independent theme client row. Pi extensions load through an agent-scoped compatibility host that maps their commands, tools, UI questions, and lifecycle callbacks onto DSH.

Registered marketplace discovery is a different provider layer. Codex reads only `[marketplaces.<name>]` entries from `~/.codex/config.toml`; Claude Code reads only `~/.claude/plugins/known_marketplaces.json`. Claude `installLocation` and Codex local sources are copied before registration. Supported GitHub Codex Git registrations are reacquired through the existing safe marketplace manager. Malformed, missing, duplicate, or unsupported entries become per-provider diagnostics and do not suppress valid siblings.

Unsupported legacy components remain in the install result instead of disappearing silently. Claude agents become namespaced DSH subagent tools; only explicitly mapped Claude tool names enter their allow-list, and unsupported model overrides remain diagnostics. Ordinary output styles register per-Agent `/output-style-<plugin>-<style>` commands, while `force-for-plugin` styles follow Claude's automatic replace or `keep-coding-instructions` behavior. Monitors use only the verified `always` and `on-skill-invoke:<name>` lifecycle seams and run through DSH's subprocess service. Missing required fields and unknown variants produce diagnostics and no row—there is no basename, default-description, event, or model fallback. Future OpenCode dialects still need a matching DSH seam or runtime compatibility layer. MCP Apps returned by a bundled MCP server work through the shared dsh MCP connection.

The Codex Apps adapter recognizes `.app.json` registered-connection identifiers without treating opaque IDs as executable MCP configuration. A same-name bundled MCP server resolves the App directly. Otherwise each declared connection compiles into two independent rows: a standard `@deepseek-ai/dsh-mcp-client` row that launches `codex-host-relay`, and a DSH tool-approval policy row. The relay uses `codex app-server --stdio`, verifies `app/installed` says the connection is enabled and callable, opens an ephemeral thread, filters the `codex_apps` catalog by connector ID, and proxies that App's tools, resources, resource templates, tool `_meta`, result `_meta`, and structured content. It never reads or copies Codex's OAuth database or tokens. Codex app-server does not currently expose hosted-App prompts through its direct MCP status/call surface, so the relay advertises no invented prompts; ordinary bundled MCP servers still retain their native prompt lifecycle.

Read-only classification comes from the hosted tool annotations. Declared read-only calls pass through; writes ask through DSH's normal approval seam, and a new tool absent from the inspected catalog is treated as a write. The foreign-host requirement remains attached so Web can explain that Codex must be installed, connected, and signed in. Durable installations intentionally restore their exact stored row plan, so a plugin imported by an older bridge build must be uninstalled and imported again to acquire newly added adapter rows.

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
/plugin-bridge enable <plugin>
/plugin-bridge disable <plugin>
/plugin-bridge uninstall <plugin>
```

Discovery is always read-only and import is always explicit. Package update is reserved for a transaction that can acquire and validate the replacement before swapping rows; it is not exposed as a partial in-place mutation.

Imported Claude output styles expose their generated selection commands in the normal DSH command registry. Hook rows do not add a second digest-approval gate: importing and enabling the plugin activates the native DSH Codex or Claude Code hook bridge directly.

## Safety and lifecycle

- Package paths and symlink targets cannot escape the copied plugin root.
- Foreign plugin and marketplace directories are never modified; explicit imports copy first.
- Marketplace relative sources reject absolute paths and traversal.
- Git is invoked with argument arrays and never through a shell.
- Portable MCP subprocesses receive fixed bridge-owned `PLUGIN_ROOT` and `PLUGIN_DATA`; arbitrary `${ENV}` expansion is not performed for the portable dialect.
- Codex registered-App credentials stay inside Codex; the relay uses the public app-server protocol and persists only the opaque connection identifier already declared by the plugin.
- Codex App tools marked non-read-only, plus unknown future tools in that relay namespace, require DSH approval before dispatch.
- Loader activation and state persistence roll back together on failure.
- Foreign executable modules are never run during discovery. Explicit import plus enable is the execution consent boundary; Pi extensions and Codex and Claude Code hooks do not add a duplicate digest-approval step.
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
