export function projectDisplayName(project: { id: string; name: string }): string {
  const isLegacySample = project.id === '11111111-1111-4111-8111-111111111111'
    && project.name === '東部幹線 水撃圧比較'
  return isLegacySample ? 'サンプル：N地区東部幹線水路' : project.name
}

/** 変更理由をそのまま見出しにすると長すぎるので、一覧ではここで丸める。 */
const CASE_LABEL_MAX = 24

/**
 * 比較案の表示名。
 *
 * 優先順は「設計ラベル → 変更理由（丸めたもの）→ 起点の既定名」。
 * 起点の比較案には名前が無く UUID の断片（`比較案 bd3b1cb5`）が出ていたため、
 * 派生案（変更理由が名前になる）と並ぶと一覧の見出しが揃わなかった。
 * 起点は「基準ケース」という既定名にして、UUID を画面の既定表示から外す。
 */
export function caseDisplayName(caseRecord: {
  parentCaseId?: string | null
  revisionReason?: string | null
  modelSnapshot?: unknown
}): string {
  // 見出しは設計上の名前（designLabel）を優先し、変更理由はツールチップに回す。
  // 変更理由は文章になりやすく、一覧の見出しとしては長すぎるため。
  const model = caseRecord.modelSnapshot
  if (model && typeof model === 'object' && !Array.isArray(model)) {
    const designLabel = (model as Record<string, unknown>).designLabel
    if (typeof designLabel === 'string' && designLabel.trim()) return designLabel.trim()
  }
  const reason = caseRecord.revisionReason?.trim()
  if (reason) return reason.length > CASE_LABEL_MAX ? `${reason.slice(0, CASE_LABEL_MAX)}…` : reason
  return caseRecord.parentCaseId ? '派生ケース' : '基準ケース'
}

/** ツールチップ等で全文が要るとき用。丸めていない元の文字列を返す。 */
export function caseDisplayNameFull(caseRecord: {
  parentCaseId?: string | null
  revisionReason?: string | null
  modelSnapshot?: unknown
}): string {
  return caseRecord.revisionReason?.trim() || caseDisplayName(caseRecord)
}
