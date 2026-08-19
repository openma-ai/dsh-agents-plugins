import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import * as PromptCommands from '../src/prompt-commands.js'

async function mount(config: {
  dialect: 'claude-code' | 'pi'
  pluginName: string
  pluginRoot: string
  componentPath?: string
  entries?: readonly string[]
}): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(CommandRuntime)
  await ctx.plugin(PromptCommands, config)
  return ctx
}

function testAgent(ctx: Context, messages: unknown[]): Agent {
  const session = ctx.sessions.create(SessionId('prompt-command-test'))
  return {
    id: session.id,
    session,
    steer: message => { messages.push(message) },
  } as Agent
}

test('Pi prompt templates register namespaced commands and expand quoted positional arguments', async () => {
  const root = await mkdtemp(join(tmpdir(), 'plugin-bridge-pi-prompts-'))
  await mkdir(join(root, 'prompts'))
  await writeFile(join(root, 'prompts', 'component.md'), `---
description: Create a component
argument-hint: <name> [features]
---
Create $1 with $@. Remaining: \${@:2}. Count: \${3:-zero}.
`)
  const ctx = await mount({
    dialect: 'pi',
    pluginName: 'ui-kit',
    pluginRoot: root,
    componentPath: 'prompts/',
  })
  const messages: unknown[] = []
  const agent = testAgent(ctx, messages)

  assert.deepEqual(ctx.commands.list(agent), [{
    name: 'ui-kit-component',
    description: 'Create a component',
    input: { hint: '<name> [features]' },
  }])
  const definition = ctx.commands.find(agent, 'ui-kit-component')
  assert.notEqual(definition, undefined)
  const result = await definition!.handler({
    agent,
    commandId: 'test' as never,
    rawInput: ' Button "click handler"',
    signal: new AbortController().signal,
  })

  assert.deepEqual(result, { kind: 'success', text: 'Expanded /ui-kit-component.' })
  assert.equal(messages.length, 1)
  const message = messages[0] as { content: Array<{ type: string; text: string }>; source: unknown }
  assert.equal(message.content[0]?.text, 'Create Button with Button click handler. Remaining: click handler. Count: zero.')
  assert.deepEqual(message.source, { kind: 'user' })
})

test('Pi prompt expressions honor globs and exclusions without registering excluded commands', async () => {
  const root = await mkdtemp(join(tmpdir(), 'plugin-bridge-pi-prompt-patterns-'))
  await mkdir(join(root, 'prompts', 'nested'), { recursive: true })
  await mkdir(join(root, 'prompts', 'legacy'), { recursive: true })
  await writeFile(join(root, 'prompts', 'nested', 'ship.md'), 'Ship $1.')
  await writeFile(join(root, 'prompts', 'legacy', 'old.md'), 'Old.')

  const ctx = await mount({
    dialect: 'pi',
    pluginName: 'release-pack',
    pluginRoot: root,
    entries: ['prompts/**', '!prompts/legacy/**'],
  })
  const agent = testAgent(ctx, [])

  assert.notEqual(ctx.commands.find(agent, 'release-pack-ship'), undefined)
  assert.equal(ctx.commands.find(agent, 'release-pack-old'), undefined)
})

test('Claude command files recursively register stable names and expand all-arguments placeholders', async () => {
  const root = await mkdtemp(join(tmpdir(), 'plugin-bridge-claude-commands-'))
  await mkdir(join(root, 'commands', 'frontend'), { recursive: true })
  await writeFile(join(root, 'commands', 'frontend', 'review.md'), `---
description: Review a frontend target
argument-hint: <target>
---
Review $ARGUMENTS in \${CLAUDE_PLUGIN_ROOT}.
`)
  const ctx = await mount({
    dialect: 'claude-code',
    pluginName: 'review-pack',
    pluginRoot: root,
    componentPath: 'commands/',
  })
  const messages: unknown[] = []
  const agent = testAgent(ctx, messages)
  const definition = ctx.commands.find(agent, 'review-pack-frontend-review')
  assert.notEqual(definition, undefined)

  await definition!.handler({
    agent,
    commandId: 'test' as never,
    rawInput: ' src/button.tsx',
    signal: new AbortController().signal,
  })

  const message = messages[0] as { content: Array<{ type: string; text: string }>; source: unknown }
  assert.equal(message.content[0]?.text, `Review src/button.tsx in ${root}.`)
  assert.deepEqual(message.source, { kind: 'user' })
})
