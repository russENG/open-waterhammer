import { describe, expect, test } from 'vitest'

import { TOPICS } from '../referenceTopics'

function findRef(topicId: string, note: string) {
  const topic = TOPICS.find(topic => topic.id === topicId)
  return topic?.refs.find(ref => ref.note === note)
}

describe('PDF参照ページ', () => {
  test('すべての参照にPDF内の物理ページ番号がある', () => {
    for (const topic of TOPICS) {
      for (const ref of topic.refs) {
        expect(Number.isInteger(ref.page), `${topic.id}: ${ref.note}`).toBe(true)
        expect(ref.page, `${topic.id}: ${ref.note}`).toBeGreaterThan(0)
      }
    }
  })

  test.each([
    ['design-flow', '5 設計の手順', 18],
    ['pipe-material', '7-9 管体及び継手等の選定', 32],
    ['steady-flow', '9-1 定常的な水理現象の解析', 36],
    ['wave-speed', '8.2.2 圧力波の伝播速度と圧力振動周期', 7],
    ['waterhammer-estimate', '8.3.2 水撃圧の推定方法（理論解法・数値解法・経験則）', 14],
    ['waterhammer-result', '8.3.6 水撃圧対策', 25],
    ['moc', '8.4.2 数理モデル（特性曲線法）', 31],
    ['pump', '8.4.2 ポンプ境界（急停止後の回転速度）', 38],
    ['surging', '8.5.1 剛体理論による非定常流況解析', 45],
    ['structure', '10 管路の構造設計', 42],
  ])('%s の「%s」はPDFの%sページを開く', (topicId, note, page) => {
    expect(findRef(topicId, note)?.page).toBe(page)
  })
})
