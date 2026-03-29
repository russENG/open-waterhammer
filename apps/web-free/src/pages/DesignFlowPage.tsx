/**
 * 農業用パイプライン設計フロー説明ページ
 * 土地改良設計基準　設計「パイプライン」技術書（令和3年6月改訂）に基づく設計手順の俯瞰
 */
export function DesignFlowPage() {
  return (
    <div className="page-design-flow">
      <div className="page-header">
        <h2 className="page-title">農業用パイプライン 設計フロー</h2>
        <p className="page-desc">
          土地改良設計基準　設計「パイプライン」技術書（令和3年6月改訂）に基づく設計手順
        </p>
      </div>

      <section className="flow-section">
        <div className="flow-chain">

          <div className="flow-phase">
            <div className="flow-phase-header">
              <span className="flow-phase-num">1</span>
              <h3>基本計画・諸元設定</h3>
            </div>
            <div className="flow-phase-body">
              <div className="flow-items">
                <div className="flow-item">
                  <span className="flow-item-name">計画用水量の算定</span>
                  <span className="flow-item-desc">作付計画・かんがい面積・単位用水量から設計流量 Q [m³/s] を算定</span>
                </div>
                <div className="flow-item">
                  <span className="flow-item-name">経路・構造型式の選定</span>
                  <span className="flow-item-desc">地形条件・揚程・経済性から管種・口径・ポンプ型式を選定</span>
                </div>
                <div className="flow-item">
                  <span className="flow-item-name">水源・取水施設</span>
                  <span className="flow-item-desc">ため池・河川・地下水などの取水計画</span>
                </div>
              </div>
            </div>
          </div>

          <div className="flow-arrow">↓</div>

          <div className="flow-phase">
            <div className="flow-phase-header">
              <span className="flow-phase-num">2</span>
              <h3>管水路水理計算（定常流）</h3>
            </div>
            <div className="flow-phase-body">
              <div className="flow-items">
                <div className="flow-item">
                  <span className="flow-item-name">摩擦損失水頭</span>
                  <span className="flow-item-desc">Darcy-Weisbach式（動水勾配）または Hazen-Williams 式で管路損失を算定</span>
                </div>
                <div className="flow-item">
                  <span className="flow-item-name">局部損失</span>
                  <span className="flow-item-desc">曲管・分岐・バルブ等の損失係数 ζ から h_L = ζ·V²/2g を積算</span>
                </div>
                <div className="flow-item">
                  <span className="flow-item-name">全損失水頭・ポンプ揚程設計</span>
                  <span className="flow-item-desc">動水線を描き、必要揚程・余裕水頭を確認。ポンプ選定（H-Q曲線）</span>
                </div>
                <div className="flow-item">
                  <span className="flow-item-name">口径の決定</span>
                  <span className="flow-item-desc">経済流速（0.5〜2.5 m/s 程度）と許容水頭損失の両面から最終決定</span>
                </div>
              </div>
            </div>
          </div>

          <div className="flow-arrow">↓</div>

          <div className="flow-phase flow-phase--highlight">
            <div className="flow-phase-header">
              <span className="flow-phase-num">3</span>
              <h3>水撃圧計算（非定常流）</h3>
              <span className="flow-phase-badge">本ツールの対象</span>
            </div>
            <div className="flow-phase-body">
              <div className="flow-items">
                <div className="flow-item flow-item--active">
                  <span className="flow-item-name">伝播速度の算定</span>
                  <span className="flow-item-desc">管種・管厚・流体の体積弾性係数から a = √(K/ρ·(1+K·D/E/e)) を算定（§8.3）</span>
                </div>
                <div className="flow-item flow-item--active">
                  <span className="flow-item-name">発生水撃圧（経験式）</span>
                  <span className="flow-item-desc">§8.4.2 簡易式（直接水撃・間接水撃）による概算。設計初期の適否判定に使用</span>
                </div>
                <div className="flow-item flow-item--active">
                  <span className="flow-item-name">特性曲線法（MOC）解析</span>
                  <span className="flow-item-desc">§8.4.3〜8.4.6 バルブ閉鎖・ポンプ急停止・起動シナリオの詳細時系列解析</span>
                </div>
                <div className="flow-item flow-item--active">
                  <span className="flow-item-name">防護工の選定・検証</span>
                  <span className="flow-item-desc">エアチャンバ・サージタンク・吸気弁・減圧弁の効果をMOCで定量評価</span>
                </div>
              </div>
            </div>
          </div>

          <div className="flow-arrow">↓</div>

          <div className="flow-phase">
            <div className="flow-phase-header">
              <span className="flow-phase-num">4</span>
              <h3>管体強度・構造設計</h3>
            </div>
            <div className="flow-phase-body">
              <div className="flow-items">
                <div className="flow-item">
                  <span className="flow-item-name">設計水圧の設定</span>
                  <span className="flow-item-desc">静水圧 + 水撃圧（最大値）を設計水圧として管体・継手の強度確認</span>
                </div>
                <div className="flow-item">
                  <span className="flow-item-name">土圧・活荷重</span>
                  <span className="flow-item-desc">埋設深さ・土質・交通荷重から外圧を算定し、管体の座屈・変形を確認</span>
                </div>
                <div className="flow-item">
                  <span className="flow-item-name">管種・管厚の確定</span>
                  <span className="flow-item-desc">鋼管・ダクタイル鋳鉄管・塩ビ管等の規格から適合製品を選定</span>
                </div>
              </div>
            </div>
          </div>

          <div className="flow-arrow">↓</div>

          <div className="flow-phase">
            <div className="flow-phase-header">
              <span className="flow-phase-num">5</span>
              <h3>附属施設・安全装置の設計</h3>
            </div>
            <div className="flow-phase-body">
              <div className="flow-items">
                <div className="flow-item">
                  <span className="flow-item-name">制水弁・逆止弁・空気弁</span>
                  <span className="flow-item-desc">管路の凸部・分岐・ポンプ吐出側への設置位置と口径の設計</span>
                </div>
                <div className="flow-item">
                  <span className="flow-item-name">水撃防護工</span>
                  <span className="flow-item-desc">§8.4 解析結果に基づく防護工の最終設計（容量・位置・設置条件）</span>
                </div>
                <div className="flow-item">
                  <span className="flow-item-name">自動化・遠方監視</span>
                  <span className="flow-item-desc">電動バルブ・流量計・圧力計・遠方監視設備の設計</span>
                </div>
              </div>
            </div>
          </div>

          <div className="flow-arrow">↓</div>

          <div className="flow-phase">
            <div className="flow-phase-header">
              <span className="flow-phase-num">6</span>
              <h3>施工・試験・維持管理計画</h3>
            </div>
            <div className="flow-phase-body">
              <div className="flow-items">
                <div className="flow-item">
                  <span className="flow-item-name">水圧試験計画</span>
                  <span className="flow-item-desc">設計水圧の 1.5 倍（または規定値）による管路充水・加圧試験</span>
                </div>
                <div className="flow-item">
                  <span className="flow-item-name">通水試験・流量確認</span>
                  <span className="flow-item-desc">計画流量・水頭損失・ポンプ運転点の実測値と設計値の照合</span>
                </div>
                <div className="flow-item">
                  <span className="flow-item-name">維持管理マニュアル</span>
                  <span className="flow-item-desc">点検頻度・清掃・バルブ操作手順・緊急時対応の整備</span>
                </div>
              </div>
            </div>
          </div>

        </div>
      </section>

      <section className="flow-note">
        <h3>設計基準について</h3>
        <div className="about-card">
          <p>
            農業用パイプラインの設計は、農林水産省農村振興局が定める
            <strong>「土地改良設計基準　設計「パイプライン」技術書」（令和3年6月改訂）</strong>（以下「パイプライン技術書」）に基づいて行います。
            同技術書は農林水産省のウェブサイトで公開されています。
          </p>
          <p>
            本ツールの水撃圧計算（ステップ3）は、同技術書 §8（水撃作用）の規定に準拠して実装されています。
            各計算画面には準拠条文を明示しています。
          </p>
        </div>
      </section>
    </div>
  );
}
