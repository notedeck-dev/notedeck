import { describe, expect, it } from 'vitest'
import { AppError } from '@/utils/errors'
import { classifyUserLookupError } from './userLookupResult'

describe('classifyUserLookupError', () => {
  it('サーバーの 2 種のコードを見分け、他は failed', () => {
    expect(
      classifyUserLookupError(new AppError('API', 'x', 'NO_SUCH_USER')),
    ).toBe('notFound')
    expect(
      classifyUserLookupError(
        new AppError('API', 'x', 'FAILED_TO_RESOLVE_REMOTE_USER'),
      ),
    ).toBe('unresolved')
    expect(classifyUserLookupError(new Error('boom'))).toBe('failed')
    // Rust から届く直列化の形 (code / message / apiCode)
    expect(
      classifyUserLookupError({
        code: 'API',
        message: 'x',
        apiCode: 'NO_SUCH_USER',
      }),
    ).toBe('notFound')
  })
})
