import {
  type FollowApi,
  type FollowState,
  followTransition,
} from '@/services/followTransition'
import { hapticLight } from '@/utils/haptics'

/**
 * フォローボタンの操作。状態遷移は services/followTransition、ここは
 * 触覚 (Tauri) だけ。
 */
export function executeFollowAction(
  api: FollowApi,
  userId: string,
  state: FollowState,
  options: Parameters<typeof followTransition>[3] = {},
): Promise<FollowState> {
  hapticLight()
  return followTransition(api, userId, state, options)
}
