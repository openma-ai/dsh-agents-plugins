# @openma/dsh-agents-plugins-bridge-ui

DSH Web settings contribution for `@openma/dsh-agents-plugins-bridge`.

The package mounts the bridge's checked-in Typert Remote descriptor, then adds
an **Agent plugins** tab to the existing Plugins settings page. It exposes four
capability sections: installed plugins, configured marketplaces, discovered
marketplace registrations, and discovered local Codex, Claude Code, or Pi
plugins.

This is a runtime package of the root Bridge bundle, not a standalone DSH
bundle. Install only the public root package; it brings this Web surface into
Web profiles while TUI profiles keep it dormant.

```sh
dsh plugin --profile web add @openma/dsh-agents-plugins-bridge
```

MIT licensed.
