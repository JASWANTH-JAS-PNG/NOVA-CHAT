const REQUEST_TIMEOUT_MS = 45_000

export class ApiError extends Error {
  code: 'timeout' | 'offline' | 'network' | 'server' | 'client'

  constructor(message: string, code: ApiError['code']) {
    super(message)
    this.name = 'ApiError'
    this.code = code
  }
}

function mapStatusToMessage(status: number, serverMessage?: string): string {
  if (status === 429) return 'Too many requests. Please wait a moment and try again.'
  if (status === 401 || status === 403) return 'Not authorized to perform this request.'
  if (status === 404) return 'The requested resource was not found.'
  if (status >= 500) return serverMessage || 'Something went wrong on the server. Please try again.'
  return serverMessage || `Request failed (${status}).`
}

/**
 * Streams an assistant reply token-by-token over SSE.
 * `onToken` is called with each incremental text chunk as it arrives.
 * Resolves with the full accumulated text once the stream completes.
 */
export async function sendMessageStream(
  messages: Array<{ role: string; content: string }>,
  onToken: (delta: string) => void,
  signal?: AbortSignal
): Promise<string> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    throw new ApiError("You're offline. Check your connection and try again.", 'offline')
  }

  const timeoutController = new AbortController()
  const timeoutId = setTimeout(() => timeoutController.abort(), REQUEST_TIMEOUT_MS)
  const onExternalAbort = () => timeoutController.abort()
  signal?.addEventListener('abort', onExternalAbort)

  let full = ''

  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages }),
      signal: timeoutController.signal,
    })

    if (!response.ok) {
      const err = await response.json().catch(() => ({ error: undefined as string | undefined }))
      throw new ApiError(mapStatusToMessage(response.status, err.error), response.status >= 500 ? 'server' : 'client')
    }

    if (!response.body) {
      const data = await response.json()
      full = (data.reply as string) ?? ''
      if (full) onToken(full)
      return full
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      let idx: number
      while ((idx = buffer.indexOf('\n\n')) !== -1) {
        const rawEvent = buffer.slice(0, idx)
        buffer = buffer.slice(idx + 2)
        const line = rawEvent.replace(/^data:\s*/, '').trim()
        if (!line || line === '[DONE]') continue

        try {
          const parsed = JSON.parse(line)
          if (parsed.error) throw new ApiError(parsed.error, 'server')
          if (parsed.content) {
            full += parsed.content
            onToken(parsed.content)
          }
        } catch (parseErr) {
          if (parseErr instanceof ApiError) throw parseErr
          // malformed SSE line — ignore and continue
        }
      }
    }

    return full
  } catch (err) {
    if (err instanceof ApiError) throw err

    if (err instanceof DOMException && err.name === 'AbortError') {
      if (signal?.aborted) {
        const abortErr = new ApiError('Request stopped.', 'client')
        abortErr.name = 'AbortError'
        throw abortErr
      }
      throw new ApiError('The request took too long and timed out. Please try again.', 'timeout')
    }

    throw new ApiError('Cannot reach the server. Check your connection and try again.', 'network')
  } finally {
    clearTimeout(timeoutId)
    signal?.removeEventListener('abort', onExternalAbort)
  }
}
