import type { PropertyKind } from './protocol'

/** 81.6 → «81,6» — для заголовка на русском. */
export function formatNumberRu(n: number): string {
  return String(Math.round(n * 100) / 100).replace('.', ',')
}

/**
 * Заголовок объявления для площадок, у которых его нет (ЦИАН, Яндекс.Недвижимость):
 * «2-комн. квартира, 81,6 м², 17/30 эт.», «Дом, 120 м², участок 6 сот.».
 */
export function buildTitle(parts: {
  kind: PropertyKind | null
  studio: boolean
  rooms?: number
  total?: number
  floor?: number
  floorsTotal?: number
  landSotka?: number
}): string | undefined {
  const { kind, studio, rooms, total, floor, floorsTotal, landSotka } = parts
  let head: string
  switch (kind) {
    case 'flat': head = studio ? 'Студия' : rooms ? `${rooms}-комн. квартира` : 'Квартира'; break
    case 'room': head = 'Комната'; break
    case 'house': head = 'Дом'; break
    case 'land': head = 'Участок'; break
    case 'garage': head = 'Гараж'; break
    case 'commercial': head = 'Коммерческая недвижимость'; break
    default: return undefined
  }
  const bits = [head]
  if (total !== undefined && kind !== 'land') bits.push(`${formatNumberRu(total)} м²`)
  if (kind === 'house' && landSotka !== undefined) bits.push(`участок ${formatNumberRu(landSotka)} сот.`)
  if (kind === 'land' && landSotka !== undefined) bits.push(`${formatNumberRu(landSotka)} сот.`)
  if (floor !== undefined && floorsTotal !== undefined) bits.push(`${floor}/${floorsTotal} эт.`)
  else if (floor !== undefined) bits.push(`${floor} эт.`)
  return bits.join(', ')
}
