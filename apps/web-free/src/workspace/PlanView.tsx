import type { NodeType } from '@open-waterhammer/core'
import type { KeyboardEvent } from 'react'

import type { LinkedFocus } from './focus'
import type { PlanDiagram, PlanNode, PlanPoint } from './plan-view'
import './PlanView.css'

const NODE_KIND_LABEL: Record<NodeType, string> = {
  reservoir: '貯水池・水槽',
  junction: '接続節点',
  tank: '調整水槽',
  pump_node: 'ポンプ',
  valve_node: 'バルブ',
}

function pointsAttribute(points: PlanPoint[]): string {
  return points.map(({ x, y }) => `${x.toFixed(2)},${y.toFixed(2)}`).join(' ')
}

function NodeSymbol({ node }: { node: PlanNode }) {
  const { x, y } = node.point
  if (node.status === 'missing') return <g className="plan-node-symbol plan-node-symbol--missing"><circle cx={x} cy={y} r="16" /><path d={`M${x - 7},${y - 7} L${x + 7},${y + 7} M${x + 7},${y - 7} L${x - 7},${y + 7}`} /></g>
  if (node.kind === 'reservoir') return <g className="plan-node-symbol plan-node-symbol--reservoir"><rect x={x - 18} y={y - 13} width="36" height="26" rx="2" /><path d={`M${x - 12},${y + 4} Q${x - 6},${y - 1} ${x},${y + 4} T${x + 12},${y + 4}`} /></g>
  if (node.kind === 'tank') return <g className="plan-node-symbol plan-node-symbol--tank"><rect x={x - 15} y={y - 18} width="30" height="36" rx="4" /><path d={`M${x - 10},${y - 7} H${x + 10}`} /></g>
  if (node.kind === 'valve_node') return <g className="plan-node-symbol plan-node-symbol--valve"><path d={`M${x},${y - 17} L${x + 17},${y} L${x},${y + 17} L${x - 17},${y} Z`} /><text x={x} y={y + 4}>V</text></g>
  if (node.kind === 'pump_node') return <g className="plan-node-symbol plan-node-symbol--pump"><circle cx={x} cy={y} r="17" /><text x={x} y={y + 4}>P</text></g>
  return <g className="plan-node-symbol plan-node-symbol--junction"><circle cx={x} cy={y} r="9" /></g>
}

function focusFor(id: string): LinkedFocus {
  return { targetRef: id, mapFeatureId: id, profileCursor: id, envelopeSeriesId: id, timeSeriesId: id }
}

function activateOnKeyboard(event: KeyboardEvent<SVGGElement>, action: () => void) {
  if (event.key !== 'Enter' && event.key !== ' ') return
  event.preventDefault()
  action()
}

export function PlanView({ diagram, focus, onFocus }: { diagram?: PlanDiagram; focus?: LinkedFocus; onFocus?(focus: LinkedFocus): void }) {
  if (!diagram) return <p className="muted">管路・節点モデルが未設定です</p>
  const errorCount = diagram.issues.length
  return <div className="plan-view">
    <div className="plan-view-heading">
      <strong>{diagram.mode === 'real-coordinates' ? '実座標平面図' : '模式図'}</strong>
      <span>{diagram.mode === 'real-coordinates' ? `座標系：${diagram.crs ?? '未指定'}` : '位置・距離は実座標ではありません'}</span>
      <b className={errorCount ? 'plan-view-issues plan-view-issues--warning' : 'plan-view-issues'}>{errorCount ? `要確認 ${errorCount}件` : '接続確認済み'}</b>
    </div>
    <div className="plan-view-canvas">
      <svg viewBox={`0 0 ${diagram.width} ${diagram.height}`} role="img" aria-label={`${diagram.mode === 'real-coordinates' ? '実座標平面図' : '管路網模式図'}、管路${diagram.pipes.length}件、節点${diagram.nodes.length}件`}>
        <g className="plan-pipes">
          {diagram.pipes.map((pipe) => {
            const selected = focus?.mapFeatureId === pipe.id
            const action = () => onFocus?.(focusFor(pipe.id))
            return <g key={pipe.id} className={`plan-pipe plan-pipe--${pipe.status}${selected ? ' plan-pipe--selected' : ''}`} role={onFocus ? 'button' : undefined} tabIndex={onFocus ? 0 : undefined} aria-label={`管路 ${pipe.id}、${pipe.fromNodeId}から${pipe.toNodeId}`} aria-pressed={onFocus ? selected : undefined} onClick={action} onKeyDown={(event) => activateOnKeyboard(event, action)}>
            <polyline points={pointsAttribute(pipe.points)} />
            <title>{`${pipe.id}：${pipe.fromNodeId} → ${pipe.toNodeId}${pipe.innerDiameter === undefined ? '' : `、管内径 ${Math.round(pipe.innerDiameter * 1000)} mm`}`}</title>
            {pipe.points.length >= 2 && <text x={(pipe.points[0]!.x + pipe.points.at(-1)!.x) / 2} y={(pipe.points[0]!.y + pipe.points.at(-1)!.y) / 2 - 9}>{pipe.id}</text>}
          </g>})}
        </g>
        <g className="plan-nodes">
          {diagram.nodes.map((node) => {
            const selected = focus?.mapFeatureId === node.id
            const action = () => onFocus?.(focusFor(node.id))
            return <g key={node.id} className={`plan-node plan-node--${node.status}${selected ? ' plan-node--selected' : ''}`} role={onFocus ? 'button' : 'img'} tabIndex={onFocus ? 0 : undefined} aria-label={`${node.id}、${NODE_KIND_LABEL[node.kind]}、${node.status === 'valid' ? '接続済み' : '要確認'}`} aria-pressed={onFocus ? selected : undefined} onClick={action} onKeyDown={(event) => activateOnKeyboard(event, action)}>
            <NodeSymbol node={node} />
            <text className="plan-node-label" x={node.point.x} y={node.point.y + 34}>{node.id}</text>
            <title>{`${node.name ?? node.id}：${NODE_KIND_LABEL[node.kind]}${node.elevation === undefined ? '' : `、標高 ${node.elevation} m`}`}</title>
          </g>})}
        </g>
      </svg>
    </div>
    <div className="plan-view-legend" aria-label="平面図の凡例">
      <span><i className="legend-line" />管路</span>
      <span><i className="legend-node" />節点・施設</span>
      <span><i className="legend-warning" />未接続・不正要素</span>
    </div>
    {errorCount > 0 && <ul className="plan-view-error-list">{diagram.issues.map((issue) => <li key={`${issue.code}-${issue.entityId}`}>{issue.message}</li>)}</ul>}
  </div>
}
