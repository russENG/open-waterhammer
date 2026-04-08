/**
 * 水理計算フロー俯瞰ページ
 * 実装状況マトリクスと計算手法の解説
 */
export function HydraulicOverviewPage() {
  return (
    <div className="page-hydraulic">
      <div className="page-header">
        <h2 className="page-title">水理計算フロー 俯瞰</h2>
        <p className="page-desc">
          農業用パイプラインの水理解析手法と本ツールの実装状況
        </p>
      </div>

      <section className="hydraulic-section">
        <h3 className="hydraulic-section-title">実装状況マトリクス</h3>
        <div className="impl-matrix">
          <table className="impl-table">
            <thead>
              <tr>
                <th>計算カテゴリ</th>
                <th>手法 / 機能</th>
                <th>準拠条文</th>
                <th>状態</th>
              </tr>
            </thead>
            <tbody>
              <tr className="impl-row--done">
                <td rowSpan={2}>伝播速度</td>
                <td>管種・管厚から a を算定（Korteweg式）</td>
                <td>§8.3</td>
                <td><span className="impl-badge impl-badge--done">実装済</span></td>
              </tr>
              <tr className="impl-row--done">
                <td>複合管種への対応（鋼管・DIP・塩ビ）</td>
                <td>§8.3</td>
                <td><span className="impl-badge impl-badge--done">実装済</span></td>
              </tr>
              <tr className="impl-row--done">
                <td rowSpan={2}>経験式（簡易推定）</td>
                <td>直接水撃圧（瞬時閉鎖）</td>
                <td>§8.4.2</td>
                <td><span className="impl-badge impl-badge--done">実装済</span></td>
              </tr>
              <tr className="impl-row--done">
                <td>間接水撃圧（有限閉鎖時間）</td>
                <td>§8.4.2</td>
                <td><span className="impl-badge impl-badge--done">実装済</span></td>
              </tr>
              <tr className="impl-row--done">
                <td rowSpan={6}>数値解析（特性曲線法）<br/>境界条件</td>
                <td>貯水池・末端死点 BC</td>
                <td>§8.4.3</td>
                <td><span className="impl-badge impl-badge--done">実装済</span></td>
              </tr>
              <tr className="impl-row--done">
                <td>バルブ閉鎖 BC（流量係数 C_v 時系列）</td>
                <td>§8.4.3</td>
                <td><span className="impl-badge impl-badge--done">実装済</span></td>
              </tr>
              <tr className="impl-row--done">
                <td>ポンプ急停止 BC（GD² 慣性方程式）</td>
                <td>§8.4.4–5</td>
                <td><span className="impl-badge impl-badge--done">実装済</span></td>
              </tr>
              <tr className="impl-row--done">
                <td>ポンプ起動 BC（線形 α ランプ）</td>
                <td>§8.4.4</td>
                <td><span className="impl-badge impl-badge--done">実装済</span></td>
              </tr>
              <tr className="impl-row--done">
                <td>T字・Y字分岐 BC（n管接続汎用解法）</td>
                <td>§8.4.3</td>
                <td><span className="impl-badge impl-badge--done">実装済</span></td>
              </tr>
              <tr className="impl-row--done">
                <td>摩擦損失（局所 Darcy-Weisbach / 節点別更新）</td>
                <td>§8.4.3</td>
                <td><span className="impl-badge impl-badge--done">実装済</span></td>
              </tr>
              <tr className="impl-row--done">
                <td rowSpan={4}>水撃防護工<br/>数値解析</td>
                <td>エアチャンバ BC（ポリトロープ圧縮 + 予測修正法）</td>
                <td>§8.4.6</td>
                <td><span className="impl-badge impl-badge--done">実装済</span></td>
              </tr>
              <tr className="impl-row--done">
                <td>サージタンク BC（陰解法 ODE）</td>
                <td>§8.4.6</td>
                <td><span className="impl-badge impl-badge--done">実装済</span></td>
              </tr>
              <tr className="impl-row--done">
                <td>吸気弁 BC（大気圧維持）</td>
                <td>§8.4.6</td>
                <td><span className="impl-badge impl-badge--done">実装済</span></td>
              </tr>
              <tr className="impl-row--done">
                <td>減圧弁 BC（設定圧維持）</td>
                <td>§8.4.6</td>
                <td><span className="impl-badge impl-badge--done">実装済</span></td>
              </tr>
              <tr className="impl-row--planned">
                <td rowSpan={3}>開水路水理</td>
                <td>等流計算（Manning式）</td>
                <td>—</td>
                <td><span className="impl-badge impl-badge--planned">計画中</span></td>
              </tr>
              <tr className="impl-row--planned">
                <td>不等流（徐変流）計算</td>
                <td>—</td>
                <td><span className="impl-badge impl-badge--planned">計画中</span></td>
              </tr>
              <tr className="impl-row--planned">
                <td>急変流・跳水解析</td>
                <td>—</td>
                <td><span className="impl-badge impl-badge--planned">計画中</span></td>
              </tr>
              <tr className="impl-row--planned">
                <td rowSpan={2}>ため池・排水路</td>
                <td>洪水調節計算</td>
                <td>—</td>
                <td><span className="impl-badge impl-badge--planned">計画中</span></td>
              </tr>
              <tr className="impl-row--planned">
                <td>暗渠・排水管水理</td>
                <td>—</td>
                <td><span className="impl-badge impl-badge--planned">計画中</span></td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="hydraulic-section">
        <h3 className="hydraulic-section-title">水撃圧解析手法の比較</h3>
        <div className="method-compare">
          <div className="method-card">
            <div className="method-card-header method-card-header--empirical">
              <h4>経験式（簡易法）</h4>
              <span className="method-tag">§8.4.2</span>
            </div>
            <div className="method-card-body">
              <div className="method-when">
                <strong>適用場面</strong>
                <p>設計初期の概算・スクリーニング。単純な直管系。</p>
              </div>
              <div className="method-pros">
                <strong>長所</strong>
                <ul>
                  <li>計算が即時、入力パラメータが少ない</li>
                  <li>設計者が手計算で確認できる</li>
                  <li>安全側の概算として利用可能</li>
                </ul>
              </div>
              <div className="method-cons">
                <strong>制約</strong>
                <ul>
                  <li>分岐・複合管系には不適</li>
                  <li>時系列変化・防護工効果を評価できない</li>
                  <li>ポンプ慣性効果を考慮しない</li>
                </ul>
              </div>
            </div>
          </div>

          <div className="method-card">
            <div className="method-card-header method-card-header--moc">
              <h4>特性曲線法</h4>
              <span className="method-tag">§8.4.3〜8.4.6</span>
            </div>
            <div className="method-card-body">
              <div className="method-when">
                <strong>適用場面</strong>
                <p>設計確認・防護工選定・複雑管系・ポンプ急停止解析。</p>
              </div>
              <div className="method-pros">
                <strong>長所</strong>
                <ul>
                  <li>双曲型偏微分方程式を正確に離散化</li>
                  <li>分岐・複合管系に対応</li>
                  <li>ポンプ GD²・防護工を BC として組込み可能</li>
                  <li>圧力・流速の時系列を完全に取得</li>
                </ul>
              </div>
              <div className="method-cons">
                <strong>制約</strong>
                <ul>
                  <li>Δx = a·Δt の制約（Courant条件）</li>
                  <li>格子生成に管長・伝播速度の整合が必要</li>
                  <li>非線形 BC（ポンプ特性曲線）は反復が必要</li>
                </ul>
              </div>
            </div>
          </div>

          <div className="method-card">
            <div className="method-card-header method-card-header--fdm">
              <h4>中心差分法（陰解法）</h4>
              <span className="method-tag">§8.4.3（参考）</span>
            </div>
            <div className="method-card-body">
              <div className="method-when">
                <strong>適用場面</strong>
                <p>格子間隔を Courant 条件に縛られたくない場合の代替手法。</p>
              </div>
              <div className="method-pros">
                <strong>長所</strong>
                <ul>
                  <li>任意の Δx, Δt を選択可能</li>
                  <li>管長が異なる複合系でも格子整合が不要</li>
                </ul>
              </div>
              <div className="method-cons">
                <strong>制約</strong>
                <ul>
                  <li>大規模連立方程式の求解が必要</li>
                  <li>数値拡散が生じる場合がある</li>
                  <li>本ツールでは未実装（特性曲線法で対応）</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="hydraulic-section">
        <h3 className="hydraulic-section-title">特性曲線法の基礎方程式</h3>
        <div className="about-card">
          <p>水撃現象は、管内の圧力 H と流速 V に関する双曲型偏微分方程式（連続式＋運動方程式）で記述されます：</p>

          <div className="eq-block">
            <div className="eq-row">
              <span className="eq-label">運動方程式</span>
              <span className="eq-formula">∂V/∂t + g·∂H/∂x + f·V|V|/(2D) = 0</span>
            </div>
            <div className="eq-row">
              <span className="eq-label">連続式</span>
              <span className="eq-formula">∂H/∂t + a²/g·∂V/∂x = 0</span>
            </div>
          </div>

          <p>特性曲線法では、これを正負の特性線（C⁺, C⁻）に沿った常微分方程式に変換して差分化します：</p>

          <div className="eq-block">
            <div className="eq-row">
              <span className="eq-label">C⁺（正方向）</span>
              <span className="eq-formula">H_P = C_P − B·Q_P &nbsp; where C_P = H_A + B·Q_A − R·Q_A|Q_A|</span>
            </div>
            <div className="eq-row">
              <span className="eq-label">C⁻（負方向）</span>
              <span className="eq-formula">H_P = C_M + B·Q_P &nbsp; where C_M = H_B − B·Q_B + R·Q_B|Q_B|</span>
            </div>
            <div className="eq-row">
              <span className="eq-label">B, R</span>
              <span className="eq-formula">B = a/(g·A), &nbsp; R = f·Δx/(2g·D·A²)</span>
            </div>
          </div>

          <p>
            内部節点では C⁺ と C⁻ を連立して H_P, Q_P を直接求め、境界節点では BC（貯水池・ポンプ・防護工等）との
            連立方程式を解きます。
          </p>
        </div>
      </section>
    </div>
  );
}
