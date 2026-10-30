/**
 * 代表窓と見ている窓 (#1131) の composable 向けの口。本体は `src/windows/roles.ts`
 * (stores は composables を import できないので、状態はそちらに置く)。
 */
export {
  announceWindow,
  isRepresentativeNow,
  useRepresentative,
  whenRepresentative,
} from '@/windows/roles'
