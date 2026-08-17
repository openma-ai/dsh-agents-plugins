import type { TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import { z } from 'zod'
import type { PluginBridgeRemoteApi } from '../types.ts'

const ROOT = '@openma/dsh-agents-plugins-bridge'
const NAMESPACE = 'agentPluginsBridge'

const marketplaceSchema = z.object({
  name: z.string(),
  provider: z.string(),
  plugins: z.array(z.string()),
})

const installationSchema = z.object({
  name: z.string(),
  marketplace: z.string(),
  format: z.string(),
  enabled: z.boolean(),
  rowCount: z.number(),
  protectedCount: z.number(),
  unsupportedCount: z.number(),
  diagnostics: z.array(z.string()),
})

const snapshotSchema = z.object({
  marketplaces: z.array(marketplaceSchema),
  installations: z.array(installationSchema),
})

const localDiscoverySchema = z.object({
  candidates: z.array(z.object({
    ref: z.string(),
    locator: z.string(),
    name: z.string(),
    evidence: z.union([z.literal('installed-registry'), z.literal('plugin-cache')]),
    version: z.string().optional(),
    marketplace: z.string().optional(),
    scope: z.string().optional(),
    enabled: z.boolean().optional(),
  })),
  diagnostics: z.array(z.string()),
})

const marketplaceDiscoverySchema = z.object({
  candidates: z.array(z.object({
    ref: z.string(),
    locator: z.string(),
    name: z.string(),
    sourceType: z.union([z.literal('local'), z.literal('git'), z.literal('installed-checkout')]),
    revision: z.string().optional(),
  })),
  diagnostics: z.array(z.string()),
})

const strict = (typeSymbol: string, schema: z.ZodType) => ({ mode: 'strict' as const, typeSymbol, schema })
const parameter = (method: string, name: string, schema: z.ZodType) => ({
  name,
  wire: name,
  source: 'json' as const,
  codec: strict(`${ROOT}/ui-host#${NAMESPACE}/${method}:${name}`, schema),
})
const descriptor = (
  method: string,
  parameters: readonly ReturnType<typeof parameter>[],
  resultType: string,
  schema: z.ZodType,
) => ({
  id: `${ROOT}#${NAMESPACE}/${method}`,
  service: NAMESPACE,
  namespace: NAMESPACE,
  method,
  invocation: { kind: 'direct' as const },
  parameters,
  result: strict(`${ROOT}/ui-host#${resultType}`, schema),
})

/** Checked-in strict descriptor for the external Bridge Host gateway. */
export const TYPERT_REMOTE = {
  package: ROOT,
  descriptors: [
    descriptor('snapshot', [], 'AgentPluginsSnapshot', snapshotSchema),
    descriptor('discoverLocal', [], 'AgentPluginsLocalDiscoveryView', localDiscoverySchema),
    descriptor('discoverMarketplaces', [], 'AgentPluginsMarketplaceDiscoveryView', marketplaceDiscoverySchema),
    descriptor('addMarketplace', [parameter('addMarketplace', 'location', z.string())], 'AgentPluginsSnapshot', snapshotSchema),
    descriptor('importMarketplace', [parameter('importMarketplace', 'ref', z.string())], 'AgentPluginsSnapshot', snapshotSchema),
    descriptor('importLocal', [parameter('importLocal', 'ref', z.string())], 'AgentPluginsSnapshot', snapshotSchema),
    descriptor('installPlugin', [
      parameter('installPlugin', 'name', z.string()),
      parameter('installPlugin', 'marketplace', z.string()),
    ], 'AgentPluginsSnapshot', snapshotSchema),
    descriptor('setEnabled', [
      parameter('setEnabled', 'name', z.string()),
      parameter('setEnabled', 'enabled', z.boolean()),
    ], 'AgentPluginsSnapshot', snapshotSchema),
  ],
} satisfies TypertRemoteContribution

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertRemoteNamespaceMap {
    agentPluginsBridge: PluginBridgeRemoteApi
  }
}

export default TYPERT_REMOTE
