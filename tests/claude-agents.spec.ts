import assert from 'node:assert/strict'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { CallId } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import SubagentRuntime, {
  type ResolvedSubagentStartRequest,
  type SubagentProvider,
  type SubagentRun,
} from '@deepseek-ai/dsh-subagent'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import type { ComponentMaterializationInput } from '../src/kernel.js'

async function optionalImport<T>(path: string): Promise<T | undefined> {
  try {
    return await import(path) as T
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && error.code === 'ERR_MODULE_NOT_FOUND') return undefined
    throw error
  }
}

test('Claude agents component materializes as an isolated DSH subagent capability producer', async () => {
  const module = await optionalImport<{
    dshClaudeAgentsAdapter: {
      materialize(input: ComponentMaterializationInput): readonly unknown[]
    }
  }>('../src/adapters/dsh-claude-agents.js')
  assert.notEqual(module, undefined, 'Claude agents adapter module must exist')

  const input: ComponentMaterializationInput = {
    source: {
      root: '/fixture/plugin',
      has: path => path === 'agents/',
      kind: path => path === 'agents/' ? 'directory' : undefined,
      readJson: () => { throw new Error('agent directories are not JSON') },
    },
    detected: {
      provider: 'claude-code-legacy',
      manifestPath: '.claude-plugin/plugin.json',
      manifest: { name: 'review-pack' },
      components: [{ type: 'agent', path: 'agents/' }],
    },
    component: { type: 'agent', path: 'agents/' },
  }

  assert.deepEqual(module!.dshClaudeAgentsAdapter.materialize(input), [{
    id: 'plugin-bridge-review-pack-agent-agents',
    name: '@openma/dsh-agents-plugins-bridge/claude-agents',
    config: {
      pluginName: 'review-pack',
      pluginRoot: '/fixture/plugin',
      componentPath: 'agents/',
      provider: 'spawn',
    },
  }])
})

class CapturingProvider implements SubagentProvider {
  readonly name = 'spawn'
  readonly capabilities = {
    outputSchema: true,
    depthLimit: true,
    toolFilter: true,
    persona: true,
  }
  readonly inheritsParentContext = false
  request: ResolvedSubagentStartRequest | undefined
  disposed = 0

  async start(request: ResolvedSubagentStartRequest): Promise<SubagentRun> {
    this.request = request
    return {
      id: SessionId('claude-agent-child'),
      localAgent: undefined,
      result: Promise.resolve({
        output: [{ type: 'text', text: 'review complete' }],
        stopReason: 'completed',
      }),
      dispose: async () => { this.disposed += 1 },
    }
  }
}

test('Claude agents Markdown registers a real DSH tool that starts a persona-scoped subagent', async () => {
  const root = await mkdtemp(join(tmpdir(), 'plugin-bridge-claude-agents-'))
  await mkdir(join(root, 'agents'))
  await writeFile(join(root, 'agents', 'anonymous.md'), `---
description: This declaration must not acquire a filename-derived identity.
---
Do not import this agent without its declared name.
`)
  await writeFile(join(root, 'agents', 'reviewer.md'), `---
name: code-reviewer
description: Review code for correctness and security.
tools: Read, Grep, WebSearch, NotebookRead
model: sonnet
---
You are a meticulous code reviewer.
Return concrete findings with file locations.
`)

  const module = await optionalImport<{
    default?: unknown
    name: string
    inject: readonly string[]
    apply: (ctx: Context, config: unknown) => void
    inspectClaudeAgents: (config: unknown) => {
      readonly diagnostics: readonly string[]
    }
  }>('../src/claude-agents.js')
  assert.notEqual(module, undefined, 'Claude agents runtime module must exist')

  assert.deepEqual(module!.inspectClaudeAgents({
    pluginName: 'review-pack',
    pluginRoot: root,
    componentPath: 'agents/',
    provider: 'spawn',
  }).diagnostics, [
    'review-pack: agents/anonymous.md is not importable: name must be a non-empty string',
    'review-pack: agents/reviewer.md declares Claude model "sonnet", which has no exact DSH per-child model mapping; the DSH spawn provider model remains authoritative',
    'review-pack: agents/reviewer.md declares Claude tool "NotebookRead", which has no exact DSH tool mapping and was omitted from the child allow-list',
  ])

  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(SubagentRuntime)
  let capabilityCtx: Context | undefined
  const capabilityFiber = ctx.inject(['tools', 'subagents'], injected => { capabilityCtx = injected })
  await capabilityFiber
  assert.notEqual(capabilityCtx, undefined)
  const provider = new CapturingProvider()
  capabilityCtx!.subagents.registerProvider(provider)
  const fiber = await capabilityCtx!.plugin(module!, {
    pluginName: 'review-pack',
    pluginRoot: root,
    componentPath: 'agents/',
    provider: 'spawn',
  })

  const toolName = 'agent-review-pack-code-reviewer'
  assert.deepEqual(capabilityCtx!.tools.schemas().find(schema => schema.name === toolName), {
    name: toolName,
    description: 'Review code for correctness and security.',
    parameters: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description: 'The task for this specialized agent.',
        },
      },
      required: ['prompt'],
    },
  })

  const parent = { id: SessionId('claude-agent-parent') } as unknown as Agent
  const result = await capabilityCtx!.tools.execute({
    callId: CallId('claude-agent-call'),
    name: toolName,
    arguments: { prompt: 'Inspect the authentication changes.' },
    agent: parent,
    signal: new AbortController().signal,
  })

  assert.equal(result.isError, false)
  if (result.isError) throw new Error('expected Claude agent tool success')
  assert.deepEqual(result.value, {
    runId: 'claude-agent-child',
    output: [{ type: 'text', text: 'review complete' }],
  })
  assert.deepEqual(result.content, [{ type: 'text', text: 'review complete' }])
  assert.equal(provider.request?.label, 'code-reviewer')
  assert.deepEqual(provider.request?.prompt, [{ type: 'text', text: 'Inspect the authentication changes.' }])
  assert.equal(provider.request?.parent, parent)
  assert.equal(provider.request?.persona, `You are a meticulous code reviewer.
Return concrete findings with file locations.`)
  assert.deepEqual(provider.request?.toolFilter, { allow: ['read', 'grep', 'web_search'] })
  assert.equal(provider.disposed, 1)

  await fiber.dispose()
  assert.equal(capabilityCtx!.tools.get(toolName), undefined)
  await capabilityFiber.dispose()
})
