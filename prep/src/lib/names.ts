/**
 * 企業名の名寄せ。pipeline/src/lib/importer.ts の sameCompany と同一仕様
 * (NFKC正規化・法人格やカッコの除去・3文字未満は完全一致のみ)。
 */
export function normalize(name: string): string {
  return name
    .normalize('NFKC')
    .toLowerCase()
    .replace(/株式会社|合同会社|有限会社|\(株\)/g, '')
    .replace(/[()\s　]/g, '')
}

export function sameCompany(a: string, b: string): boolean {
  const na = normalize(a)
  const nb = normalize(b)
  if (na.length < 3 || nb.length < 3) return na === nb
  return na.includes(nb) || nb.includes(na)
}
