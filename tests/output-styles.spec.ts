import assert from 'node:assert/strict'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import { createScope } from '@deepseek-ai/dsh-scope'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt, { PERSONA_SECTION, renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import { PluginBridgeKernel, type DshPluginRow, type PluginPackageSource } from '../src/kernel.js'
import type { Config as OutputStyleHostConfig } from '../src/adapters/dsh-output-style-host.js'

function source(root: string): PluginPackageSource {
  return {
    root,
    has: path => existsSync(join(root, path)),
    kind(path) {
      const target = join(root, path)
      if (!existsSync(target)) return undefined
      return statSync(target).isDirectory() ? 'directory' : 'file'
    },
    readJson: path => JSON.parse(readFileSync(join(root, path), 'utf8')) as unknown,
    readText: path => readFileSync(join(root, path), 'utf8'),
  }
}

function persona(ctx: Context, agent: Agent): Promise<string | undefined> {
  return ctx.systemPrompt.assemble({ scope: agent }).then(assembly => (
    assembly.sections.find(section => section.name === PERSONA_SECTION)?.text
  ))
}

function testAgent(ctx: Context, id: string): Agent {
  const session = ctx.sessions.create(SessionId(id))
  const agent = {
    id: session.id,
    options: { provider: 'fixture', model: 'fixture' },
    session,
    status: 'idle',
  } as unknown as Agent
  ;(agent as unknown as { ctx: Context }).ctx = createScope(ctx, agent).ctx
  return agent
}

async function materialize(root: string) {
  const { dshOutputStylesAdapter } = await import('../src/adapters/dsh-output-styles.js')
  const kernel = new PluginBridgeKernel(new Context())
  kernel.registerComponentAdapter(dshOutputStylesAdapter)
  return kernel.materializePackage(source(root), {
    provider: 'claude-code-legacy',
    manifestPath: '.claude-plugin/plugin.json',
    manifest: { name: 'voice-pack' },
    components: [{ type: 'output-style', path: 'output-styles/' }],
  })
}

function row(result: Awaited<ReturnType<typeof materialize>>, styleName: string): DshPluginRow {
  const found = result.rows.find(candidate => candidate.config?.styleName === styleName)
  assert.notEqual(found, undefined)
  return found!
}

function hostConfig(value: DshPluginRow): OutputStyleHostConfig {
  assert.notEqual(value.config, undefined)
  return value.config as unknown as OutputStyleHostConfig
}

async function promptHarness(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(CommandRuntime)
  await ctx.plugin(SystemPrompt, { persona: 'You are the deployment coding agent.' })
  await ctx.plugin(AgentRegistry)
  return ctx
}

test('an ordinary Claude output style changes only the invoking Agent through its explicit selector command', async () => {
  const root = await mkdtemp(join(tmpdir(), 'plugin-bridge-output-style-definition-'))
  await mkdir(join(root, 'output-styles'))
  await writeFile(join(root, 'output-styles', 'diagrams.md'), `---
name: Diagrams first
description: Lead explanations with a diagram
keep-coding-instructions: true
---
Start every code explanation with a Mermaid diagram.
`)

  const result = await materialize(root)

  assert.deepEqual(result.unsupported, [])
  assert.deepEqual(result.rows, [{
    id: 'plugin-bridge-voice-pack-output-style-output-styles-diagrams',
    name: '@openma/dsh-agents-plugins-bridge/adapters/dsh-output-style-host',
    config: {
      pluginName: 'voice-pack',
      styleName: 'Diagrams first',
      description: 'Lead explanations with a diagram',
      sourcePath: 'output-styles/diagrams.md',
      instructions: 'Start every code explanation with a Mermaid diagram.',
      keepCodingInstructions: true,
      forceForPlugin: false,
    },
  }])
  assert.deepEqual(result.diagnostics, undefined)

  const ctx = await promptHarness()
  const agent = testAgent(ctx, 'ordinary-style-agent')
  ctx.agents.register(agent)
  const host = await import('../src/adapters/dsh-output-style-host.js')
  const fiber = await ctx.plugin(host, hostConfig(result.rows[0]!))

  assert.equal(await persona(ctx, agent), 'You are the deployment coding agent.')
  assert.doesNotMatch(renderPrompt(await ctx.systemPrompt.assemble({ scope: agent })), /Mermaid diagram/u)
  const selector = ctx.commands.find(agent, 'output-style-voice-pack-diagrams-first')
  assert.notEqual(selector, undefined)
  assert.deepEqual(await selector!.handler({
    agent,
    commandId: 'select-output-style' as never,
    rawInput: '',
    signal: new AbortController().signal,
  }), { kind: 'success', text: 'Selected output style "Diagrams first".' })
  const selected = renderPrompt(await ctx.systemPrompt.assemble({ scope: agent }))
  assert.match(selected, /You are the deployment coding agent\./u)
  assert.match(selected, /Start every code explanation with a Mermaid diagram\./u)

  await fiber.dispose()
  assert.equal(ctx.commands.find(agent, 'output-style-voice-pack-diagrams-first'), undefined)
  assert.doesNotMatch(renderPrompt(await ctx.systemPrompt.assemble({ scope: agent })), /Mermaid diagram/u)
})

test('Claude output-style files missing strict frontmatter fields produce diagnostics and no guessed rows', async () => {
  const root = await mkdtemp(join(tmpdir(), 'plugin-bridge-output-style-invalid-'))
  await mkdir(join(root, 'output-styles'))
  await writeFile(join(root, 'output-styles', 'no-frontmatter.md'), 'Never infer my name from the file.')
  await writeFile(join(root, 'output-styles', 'no-name.md'), `---
description: Missing name
---
Instructions.
`)
  await writeFile(join(root, 'output-styles', 'no-description.md'), `---
name: Missing description
---
Instructions.
`)
  await writeFile(join(root, 'output-styles', 'no-body.md'), `---
name: Missing body
description: Has metadata only
---
`)

  const result = await materialize(root)

  assert.deepEqual(result.rows, [])
  assert.equal(result.diagnostics?.length, 4)
  assert.match(result.diagnostics?.join('\n') ?? '', /no-frontmatter\.md: frontmatter is required/u)
  assert.match(result.diagnostics?.join('\n') ?? '', /no-name\.md: frontmatter name is required/u)
  assert.match(result.diagnostics?.join('\n') ?? '', /no-description\.md: frontmatter description is required/u)
  assert.match(result.diagnostics?.join('\n') ?? '', /no-body\.md: instructions body is required/u)
})

test('a forced Claude output style shadows the persona for existing and future agents and unloads cleanly', async () => {
  const root = await mkdtemp(join(tmpdir(), 'plugin-bridge-output-style-forced-'))
  await mkdir(join(root, 'output-styles'))
  await writeFile(join(root, 'output-styles', 'analyst.md'), `---
name: Data analyst
description: Answer as a data analyst
force-for-plugin: true
---
You are a precise data analyst. State assumptions before conclusions.
`)
  const result = await materialize(root)
  const forced = row(result, 'Data analyst')
  const host = await import('../src/adapters/dsh-output-style-host.js')
  const ctx = await promptHarness()
  const existing = testAgent(ctx, 'existing-style-agent')
  ctx.agents.register(existing)

  const fiber = await ctx.plugin(host, hostConfig(forced))
  assert.equal(await persona(ctx, existing), 'You are a precise data analyst. State assumptions before conclusions.')

  const future = testAgent(ctx, 'future-style-agent')
  ctx.agents.register(future)
  assert.equal(await persona(ctx, future), 'You are a precise data analyst. State assumptions before conclusions.')

  await fiber.dispose()
  assert.equal(await persona(ctx, existing), 'You are the deployment coding agent.')
  assert.equal(await persona(ctx, future), 'You are the deployment coding agent.')
})

test('a forced keep-coding Claude output style appends instructions without replacing the persona', async () => {
  const root = await mkdtemp(join(tmpdir(), 'plugin-bridge-output-style-append-'))
  await mkdir(join(root, 'output-styles'))
  await writeFile(join(root, 'output-styles', 'teacher.md'), `---
name: Teacher
description: Explain non-obvious changes
keep-coding-instructions: true
force-for-plugin: true
---
Explain the reasoning behind every non-obvious code change.
`)
  const result = await materialize(root)
  const host = await import('../src/adapters/dsh-output-style-host.js')
  const ctx = await promptHarness()
  const agent = testAgent(ctx, 'append-style-agent')
  ctx.agents.register(agent)

  const fiber = await ctx.plugin(host, hostConfig(row(result, 'Teacher')))
  const prompt = renderPrompt(await ctx.systemPrompt.assemble({ scope: agent }))
  assert.match(prompt, /You are the deployment coding agent\./u)
  assert.match(prompt, /Explain the reasoning behind every non-obvious code change\./u)

  await fiber.dispose()
  assert.doesNotMatch(
    renderPrompt(await ctx.systemPrompt.assemble({ scope: agent })),
    /Explain the reasoning/u,
  )
})
