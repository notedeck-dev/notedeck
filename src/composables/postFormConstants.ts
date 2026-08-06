import type { NoteVisibility } from '@/adapters/types'

export const MAX_TEXT_LENGTH = 3000

export interface VisibilityOption {
  value: NoteVisibility
  label: string
  icon: string
}

export const visibilityOptions: VisibilityOption[] = [
  {
    value: 'public',
    label: 'パブリック',
    icon: 'M22 12A10 10 0 112 12a10 10 0 0120 0zM2 12h20M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10A15.3 15.3 0 0112 2z',
  },
  {
    value: 'home',
    label: 'ホーム',
    icon: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 01-1-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 01-1 1m-2 0h2',
  },
  {
    value: 'followers',
    label: 'フォロワー',
    icon: 'M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z',
  },
  {
    value: 'specified',
    label: 'ダイレクト',
    icon: 'M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0l-8.25 5.25a1.5 1.5 0 01-1.5 0L2.25 6.75',
  },
]

export const defaultVisibility = visibilityOptions[0] as VisibilityOption
