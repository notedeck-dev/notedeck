export interface Player {
  url: string
  width: number | null
  height: number | null
  allow: string[]
}

export interface SummaryData {
  title: string | null
  description: string | null
  icon: string | null
  sitename: string | null
  thumbnail: string | null
  medias: string[]
  player: Player | null
  url: string
  sensitive: boolean
}

/** Legacy alias for backward compatibility */
export type OgpData = SummaryData
