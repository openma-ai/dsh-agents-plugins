# Marketplace fixtures

`codex-local/.agents/plugins/marketplace.json` uses the canonical repo-local
path documented by OpenAI. Its contents are a minimal, field-preserving excerpt
of the Codex-managed `openai-curated` catalog observed locally at
`~/.codex/.tmp/plugins/.agents/plugins/marketplace.json` on 2026-08-17. Every
entry in that 180-entry catalog used the same `{ "source": "local", "path":
"./plugins/..." }` source shape.

The fixture covers the local source variant only. Remote `url`, `git-subdir`,
and `npm` variants are derived from the published OpenAI reference rather than
inferred from this file.

Official packaging and marketplace reference:
<https://developers.openai.com/plugins/build/plugins>
