export function projectDisplayName(project: { id: string; name: string }): string {
  const isLegacySample = project.id === '11111111-1111-4111-8111-111111111111'
    && project.name === '東部幹線 水撃圧比較'
  return isLegacySample ? 'サンプル：N地区東部幹線水路' : project.name
}
