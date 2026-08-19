# @openma/dsh-agents-plugins-bridge-ui

DSH Web settings contribution for `@openma/dsh-agents-plugins-bridge`.

The package mounts the bridge's checked-in Typert Remote descriptor, then adds
an **Agent plugins** tab to the existing Plugins settings page. It exposes four
capability sections: installed plugins, configured marketplaces, discovered
marketplace registrations, and discovered local Codex, Claude Code, or Pi
plugins.

Install this Web surface beside the platform-neutral root bridge bundle. TUI
profiles install only the root bridge and therefore do not mount these rows.

```sh
dsh plugin --profile web add \
  @openma/dsh-agents-plugins-bridge \
  @openma/dsh-agents-plugins-bridge-ui
```

MIT licensed.
