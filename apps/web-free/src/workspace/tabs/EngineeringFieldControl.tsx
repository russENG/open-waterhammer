import type { JsonValue } from '@open-waterhammer/contracts'
import type { EngineeringField } from '../engineering-fields'

export function EngineeringFieldControl({ field, value, locked, onChange }: {
  field: EngineeringField
  value: JsonValue | undefined
  locked: boolean
  onChange(raw: string | boolean): void
}) {
  const id = `engineering-${field.target}-${field.path.replace(/[^a-zA-Z0-9]/g, '-')}`
  return <label htmlFor={id}><span>{field.label}{field.unit && <b>{field.unit}</b>}</span>{field.kind === 'select'
    ? <select id={id} value={typeof value === 'string' ? value : ''} onChange={(event) => onChange(event.target.value)} disabled={locked}><option value="">選択してください</option>{field.options?.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
    : field.kind === 'boolean'
      ? <input id={id} type="checkbox" checked={value === true} onChange={(event) => onChange(event.target.checked)} disabled={locked} />
      : <input id={id} type={field.kind === 'number' ? 'number' : 'text'} step={field.kind === 'number' ? 'any' : undefined} value={typeof value === 'string' || typeof value === 'number' ? value : ''} onChange={(event) => onChange(event.target.value)} disabled={locked} />}</label>
}
