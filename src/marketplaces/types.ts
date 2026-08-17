/** An already-loaded marketplace manifest and its marketplace-root-relative path. */
export interface MarketplaceCatalogSource {
  readonly manifestPath: string
  readonly manifest: unknown
}

/** A safe marketplace-local plugin directory. */
export interface MarketplaceRelativeDirectorySource {
  readonly kind: 'marketplace-relative-directory'
  readonly path: string
}

/** A plugin fetched from one GitHub repository. */
export interface GitHubRepositorySource {
  readonly kind: 'github-repository'
  readonly repo: string
  readonly ref?: string
  readonly sha?: string
}

/** An HTTPS Git repository, optionally narrowed to one root-contained subdirectory. */
export interface GitRepositorySource {
  readonly kind: 'git-repository'
  readonly url: string
  readonly subdirectory?: string
  readonly ref?: string
  readonly sha?: string
}

export type MarketplacePluginSource =
  | MarketplaceRelativeDirectorySource
  | GitHubRepositorySource
  | GitRepositorySource

export interface MarketplacePluginEntry {
  readonly name: string
  readonly source: MarketplacePluginSource
}

/** The portable catalog fields consumed by the bridge kernel. */
export interface MarketplaceCatalogObservation {
  readonly name: string
  readonly manifestPath: string
  readonly plugins: readonly MarketplacePluginEntry[]
}

/** Recognizes and normalizes one marketplace catalog dialect. */
export interface MarketplaceCatalogProvider {
  readonly name: string
  probe(source: MarketplaceCatalogSource): MarketplaceCatalogObservation | undefined
}
