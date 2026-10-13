import type { JSX } from 'react'
import type { ChartKind } from '@shared/types'
import { ChartArea, ChartBar, ChartColumn, ChartDonut, ChartLine, ChartNumber, ChartPie } from '@/ui/icons'

export function ChartKindIcon({ kind, size = 14 }: { kind: ChartKind; size?: number }): JSX.Element {
  switch (kind) {
    case 'bar':
      return <ChartBar size={size} />
    case 'line':
      return <ChartLine size={size} />
    case 'area':
      return <ChartArea size={size} />
    case 'pie':
      return <ChartPie size={size} />
    case 'donut':
      return <ChartDonut size={size} />
    case 'number':
      return <ChartNumber size={size} />
    default:
      return <ChartColumn size={size} />
  }
}
