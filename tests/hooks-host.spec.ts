import assert from 'node:assert/strict'
import test from 'node:test'
import { Context, Service } from '@deepseek-ai/cordis'
import * as ClaudeCodeHooksHost from '../src/hooks-claude-code.js'
import * as CodexHooksHost from '../src/hooks-codex.js'

class ShellProbe extends Service {
  constructor(ctx: Context) {
    super(ctx, 'shell')
  }
}

async function contextWithShell(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(ShellProbe)
  return ctx
}

test('Claude Code Hooks Host mounts the official DSH hook plugin as its child', async () => {
  const ctx = await contextWithShell()

  await assert.rejects(
    async () => {
      await ctx.plugin(ClaudeCodeHooksHost, {
        configPath: '/fixture/hooks.json',
        stderrSummaryMaxChars: 0,
      })
    },
    /hooks-claude-code: stderrSummaryMaxChars must be a positive integer/u,
  )
})

test('Codex Hooks Host mounts the official DSH hook plugin as its child', async () => {
  const ctx = await contextWithShell()

  await assert.rejects(
    async () => {
      await ctx.plugin(CodexHooksHost, {
        configPath: '/fixture/hooks.json',
        model: 'test-model',
        stderrSummaryMaxChars: 0,
      })
    },
    /hooks-codex: stderrSummaryMaxChars must be a positive integer/u,
  )
})
