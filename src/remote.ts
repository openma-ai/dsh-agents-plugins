import type { RemoteResult, TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import { z } from 'zod'
import type {
  AgentPluginsLocalDiscoveryView,
  AgentPluginsInstallResult,
  AgentPluginsMarketplaceDiscoveryView,
  AgentPluginsPiUpdateMode,
  AgentPluginsPiUpdateStatus,
  AgentPluginsSnapshot,
} from './ui-host.js'

const ROOT = '@openma/dsh-agents-plugins-bridge'
const NAMESPACE = 'agentPluginsBridge'

/** Browser projection of the Bridge Host Remote namespace. */
export interface AgentPluginsRemoteApi {
  snapshot(): Promise<RemoteResult<AgentPluginsSnapshot>>
  discoverLocal(): Promise<RemoteResult<AgentPluginsLocalDiscoveryView>>
  discoverMarketplaces(): Promise<RemoteResult<AgentPluginsMarketplaceDiscoveryView>>
  addMarketplace(location: string): Promise<RemoteResult<AgentPluginsSnapshot>>
  importMarketplace(ref: string): Promise<RemoteResult<AgentPluginsSnapshot>>
  importLocal(ref: string): Promise<RemoteResult<AgentPluginsSnapshot>>
  installPlugin(name: string, marketplace: string): Promise<RemoteResult<AgentPluginsInstallResult>>
  setEnabled(name: string, enabled: boolean): Promise<RemoteResult<AgentPluginsSnapshot>>
  piUpdates(): Promise<RemoteResult<AgentPluginsPiUpdateStatus>>
  checkPiUpdates(): Promise<RemoteResult<AgentPluginsPiUpdateStatus>>
  setPiUpdateMode(mode: AgentPluginsPiUpdateMode): Promise<RemoteResult<AgentPluginsPiUpdateStatus>>
  setPiPackageAutoUpdate(id: string, enabled: boolean): Promise<RemoteResult<AgentPluginsPiUpdateStatus>>
  updatePiPackage(id: string): Promise<RemoteResult<AgentPluginsPiUpdateStatus>>
  updateAllPiPackages(): Promise<RemoteResult<AgentPluginsPiUpdateStatus>>
}

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
  requiredHosts: z.array(z.string()),
  unsupportedCount: z.number(),
  diagnostics: z.array(z.string()),
})

const snapshotSchema = z.object({
  marketplaces: z.array(marketplaceSchema),
  installations: z.array(installationSchema),
})

const installResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('installed'), snapshot: snapshotSchema }),
  z.object({
    status: z.literal('failed'),
    reason: z.enum(['timeout', 'source', 'unsupported', 'invalid', 'activation', 'already-installed', 'unknown']),
  }),
])

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

const piUpdateStatusSchema = z.object({
  mode: z.enum(['notify', 'auto', 'off']),
  updates: z.array(z.object({
    id: z.string().regex(/^[a-f0-9]{32}$/u),
    displayName: z.string(),
    type: z.enum(['npm', 'git']),
    scope: z.enum(['user', 'project']),
    autoUpdate: z.boolean(),
  })),
  lastCheckedAt: z.number().finite().optional(),
  nextCheckAt: z.number().finite().optional(),
})

const strict = (typeSymbol: string, schema: z.ZodType) => ({
  mode: 'strict' as const,
  typeSymbol,
  schema,
})

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

/** Generated-shape Client contribution paired with the package Host manifest. */
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
    ], 'AgentPluginsInstallResult', installResultSchema),
    descriptor('setEnabled', [
      parameter('setEnabled', 'name', z.string()),
      parameter('setEnabled', 'enabled', z.boolean()),
    ], 'AgentPluginsSnapshot', snapshotSchema),
    descriptor('piUpdates', [], 'AgentPluginsPiUpdateStatus', piUpdateStatusSchema),
    descriptor('checkPiUpdates', [], 'AgentPluginsPiUpdateStatus', piUpdateStatusSchema),
    descriptor('setPiUpdateMode', [
      parameter('setPiUpdateMode', 'mode', z.enum(['notify', 'auto', 'off'])),
    ], 'AgentPluginsPiUpdateStatus', piUpdateStatusSchema),
    descriptor('setPiPackageAutoUpdate', [
      parameter('setPiPackageAutoUpdate', 'id', z.string().regex(/^[a-f0-9]{32}$/u)),
      parameter('setPiPackageAutoUpdate', 'enabled', z.boolean()),
    ], 'AgentPluginsPiUpdateStatus', piUpdateStatusSchema),
    descriptor('updatePiPackage', [
      parameter('updatePiPackage', 'id', z.string().regex(/^[a-f0-9]{32}$/u)),
    ], 'AgentPluginsPiUpdateStatus', piUpdateStatusSchema),
    descriptor('updateAllPiPackages', [], 'AgentPluginsPiUpdateStatus', piUpdateStatusSchema),
  ],
} satisfies TypertRemoteContribution

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertRemoteNamespaceMap {
    agentPluginsBridge: AgentPluginsRemoteApi
  }
}

export default TYPERT_REMOTE
