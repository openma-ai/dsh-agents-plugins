import TYPERT_REMOTE from './remote.js'

const members = [
  ['snapshot', 'snapshot(): AgentPluginsSnapshot'],
  ['discoverLocal', 'discoverLocal(): Promise<AgentPluginsLocalDiscoveryView>'],
  ['discoverMarketplaces', 'discoverMarketplaces(): Promise<AgentPluginsMarketplaceDiscoveryView>'],
  ['addMarketplace', 'addMarketplace(location: string): Promise<AgentPluginsSnapshot>'],
  ['importMarketplace', 'importMarketplace(ref: string): Promise<AgentPluginsSnapshot>'],
  ['importLocal', 'importLocal(ref: string): Promise<AgentPluginsSnapshot>'],
  ['installPlugin', 'installPlugin(name: string, marketplace: string): Promise<AgentPluginsInstallResult>'],
  ['setEnabled', 'setEnabled(name: string, enabled: boolean): Promise<AgentPluginsSnapshot>'],
] as const

/** Host face consumed automatically by DSH's typert-loader. */
export const TYPERT = {
  package: '@openma/dsh-agents-plugins-bridge',
  face: 'host',
  schemas: [],
  invocations: TYPERT_REMOTE.descriptors,
  model: {
    services: [{
      description: 'Agent Plugins bridge gateway for durable state and foreign-agent discovery.',
      summary: 'Agent Plugins bridge Host gateway.',
      tags: [],
      jsDoc: '/** Agent Plugins bridge Host gateway. */',
      key: 'agentPluginsBridge',
      exportName: 'AgentPluginsGateway',
      members: members.map(([name, signature]) => ({
        kind: 'method',
        name,
        signature,
        summary: `Remote ${name} operation.`,
        jsDoc: `/** Remote ${name} operation. */`,
      })),
      types: [],
    }],
    events: [],
    objects: [],
  },
}

export default TYPERT
