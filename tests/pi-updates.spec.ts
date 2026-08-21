import assert from 'node:assert/strict'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  createPiNativePackageManager,
  PiUpdateController,
  type PiNativePackageManager,
  type PiNativePackageUpdate,
} from '../src/pi-updates.js'
import { listImportedPiPackages } from '../src/runtime.js'

class FakePiPackageManager implements PiNativePackageManager {
  readonly updated: string[] = []

  constructor(readonly available: PiNativePackageUpdate[]) {}

  async checkForAvailableUpdates(): Promise<readonly PiNativePackageUpdate[]> {
    return structuredClone(this.available)
  }

  async update(source: string): Promise<void> {
    this.updated.push(source)
    const index = this.available.findIndex(update => update.source === source)
    if (index >= 0) this.available.splice(index, 1)
  }
}

async function fixture(options: {
  readonly available?: PiNativePackageUpdate[]
  readonly imported?: readonly { readonly source: string; readonly scope: 'user' | 'project' }[]
  readonly now?: () => number
} = {}) {
  const storageDir = await mkdtemp(join(tmpdir(), 'plugin-bridge-pi-updates-'))
  const nativeManager = new FakePiPackageManager(options.available ?? [])
  let reconciliations = 0
  const controller = new PiUpdateController({
    storageDir,
    nativeManager,
    listImportedPackages: () => options.imported ?? [],
    reconcile: async () => { reconciliations += 1 },
    ...(options.now === undefined ? {} : { now: options.now }),
  })
  await controller.start()
  return {
    controller,
    nativeManager,
    storageDir,
    reconciliations: () => reconciliations,
  }
}

test('Pi update checks default to notify and expose only imported packages through opaque IDs', async () => {
  const privateSource = 'git:https://secret-user@example.test/company/private-plugin.git'
  const { controller, storageDir } = await fixture({
    available: [
      { source: privateSource, displayName: 'private-plugin', type: 'git', scope: 'user' },
      { source: 'npm:not-imported', displayName: 'not-imported', type: 'npm', scope: 'user' },
    ],
    imported: [{ source: privateSource, scope: 'user' }],
    now: () => 1_000,
  })

  const status = await controller.checkNow()

  assert.equal(status.mode, 'notify')
  assert.deepEqual(status.updates, [{
    id: status.updates[0]?.id,
    displayName: 'private-plugin',
    type: 'git',
    scope: 'user',
    autoUpdate: true,
  }])
  assert.match(status.updates[0]?.id ?? '', /^[a-f0-9]{32}$/u)
  assert.equal(status.lastCheckedAt, 1_000)
  assert.equal(status.nextCheckAt, 1_000 + 6 * 60 * 60 * 1_000)
  assert.doesNotMatch(JSON.stringify(status), /secret-user|private-plugin\.git/u)
  assert.doesNotMatch(await readFile(join(storageDir, 'pi-updates.json'), 'utf8'), /secret-user|private-plugin\.git/u)
})

test('Pi update policy and package exclusions survive a controller restart', async () => {
  const source = 'npm:@company/pi-tools'
  const first = await fixture({
    available: [{ source, displayName: '@company/pi-tools', type: 'npm', scope: 'project' }],
    imported: [{ source, scope: 'project' }],
  })
  const checked = await first.controller.checkNow()
  const id = checked.updates[0]?.id
  assert.ok(id)
  await first.controller.setMode('auto')
  await first.controller.setPackageAutoUpdate(id, false)

  const restarted = new PiUpdateController({
    storageDir: first.storageDir,
    nativeManager: first.nativeManager,
    listImportedPackages: () => [{ source, scope: 'project' }],
    reconcile: async () => undefined,
  })
  await restarted.start()

  const status = restarted.status()
  assert.equal(status.mode, 'auto')
  assert.deepEqual(status.updates, [])
  const refreshed = await restarted.checkNow()
  assert.equal(refreshed.updates[0]?.autoUpdate, false)
})

test('manual Pi package updates use the native package manager then reconcile the Bridge copy', async () => {
  const source = 'npm:pi-demo'
  const state = await fixture({
    available: [{ source, displayName: 'pi-demo', type: 'npm', scope: 'user' }],
    imported: [{ source, scope: 'user' }],
  })
  const checked = await state.controller.checkNow()
  const id = checked.updates[0]?.id
  assert.ok(id)

  const updated = await state.controller.updatePackage(id)

  assert.deepEqual(state.nativeManager.updated, [source])
  assert.equal(state.reconciliations(), 1)
  assert.deepEqual(updated.updates, [])
})

test('update all reconciles successful native updates even when another package fails', async () => {
  const first = 'npm:first'
  const second = 'npm:second'
  const state = await fixture({
    available: [
      { source: first, displayName: 'first', type: 'npm', scope: 'user' },
      { source: second, displayName: 'second', type: 'npm', scope: 'user' },
    ],
    imported: [{ source: first, scope: 'user' }, { source: second, scope: 'user' }],
  })
  const nativeUpdate = state.nativeManager.update.bind(state.nativeManager)
  state.nativeManager.update = async (source: string) => {
    if (source === second) throw new Error('second failed with private native detail')
    await nativeUpdate(source)
  }
  await state.controller.checkNow()

  await assert.rejects(() => state.controller.updateAll(), /one or more Pi package updates failed/u)

  assert.equal(state.reconciliations(), 1)
  assert.deepEqual(state.controller.status().updates.map(update => update.displayName), ['second'])
})

test('scheduled auto mode updates eligible packages but respects per-package exclusions', async () => {
  let currentTime = 10_000
  const included = 'npm:included'
  const excluded = 'npm:excluded'
  const state = await fixture({
    available: [
      { source: included, displayName: 'included', type: 'npm', scope: 'user' },
      { source: excluded, displayName: 'excluded', type: 'npm', scope: 'user' },
    ],
    imported: [
      { source: included, scope: 'user' },
      { source: excluded, scope: 'user' },
    ],
    now: () => currentTime,
  })
  const checked = await state.controller.checkNow()
  const excludedId = checked.updates.find(update => update.displayName === 'excluded')?.id
  assert.ok(excludedId)
  await state.controller.setPackageAutoUpdate(excludedId, false)
  await state.controller.setMode('auto')

  currentTime += 6 * 60 * 60 * 1_000
  const result = await state.controller.runScheduledCheck()

  assert.deepEqual(state.nativeManager.updated, [included])
  assert.equal(state.reconciliations(), 1)
  assert.deepEqual(result.updates.map(update => update.displayName), ['excluded'])
})

test('off mode skips scheduled Pi update checks', async () => {
  let checks = 0
  const state = await fixture()
  state.nativeManager.checkForAvailableUpdates = async () => {
    checks += 1
    return []
  }
  await state.controller.setMode('off')

  const status = await state.controller.runScheduledCheck()

  assert.equal(checks, 0)
  assert.equal(status.mode, 'off')
})

test('the runtime selects only managed Pi sources and the native adapter uses Pi public APIs', () => {
  assert.deepEqual(listImportedPiPackages([
    {
      source: {
        locator: 'pi-installed-user',
        upstreamSource: 'npm:pi-demo',
      },
    },
    {
      source: {
        locator: 'pi-installed-project',
        upstreamSource: 'git:https://example.test/team/pi-demo.git',
      },
    },
    {
      source: {
        locator: 'codex-local-cache',
        upstreamSource: 'npm:not-pi',
      },
    },
    { source: { locator: 'pi-installed-user' } },
  ]), [
    { source: 'npm:pi-demo', scope: 'user' },
    { source: 'git:https://example.test/team/pi-demo.git', scope: 'project' },
  ])

  const nativeManager = createPiNativePackageManager(process.cwd())
  assert.equal(typeof nativeManager.checkForAvailableUpdates, 'function')
  assert.equal(typeof nativeManager.update, 'function')
})
