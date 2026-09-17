export function privateAssetsGuard(): {
  name: string
  configResolved(value: unknown): void
  buildStart(): void
  closeBundle(): void
}
