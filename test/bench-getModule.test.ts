import { test, expect, vi } from 'vitest'
import { resolve } from 'node:path'
import { performance } from 'perf_hooks'

test('bench getModule cold vs warm', async () => {
  try {
    // Mock vscode-using utilities so tests run outside VSCode environment
    vi.mock('@vscode-use/utils', () => ({
      getActiveText: () => '',
      getActiveTextEditor: () => null,
      getActiveTextEditorLanguageId: () => '',
      getCurrentFileUrl: () => process.cwd(),
      getLineText: () => '',
      isInPosition: () => false,
    }))

    const { getModule, clearAllCache } = await import('../src/parse')
  const file = resolve(__dirname, 'fixtures', 'tmp-module.ts')
  // ensure cache cleared before bench
  clearAllCache()

  const t0 = performance.now()
  const r1 = await getModule(file)
  const t1 = performance.now()

  // warm call (should hit cache / fast path)
  const r2 = await getModule(file)
  const t2 = performance.now()

  // print informal timings so we can eyeball improvements
  // (Vitest will show console output)
  // eslint-disable-next-line no-console
  console.log('getModule timings (ms): cold=', (t1 - t0).toFixed(3), 'warm=', (t2 - t1).toFixed(3))

    expect(r1).toBeDefined()
    expect(r2).toBeDefined()
  }
  catch (e) {
    // ensure we log full error for debugging
    // eslint-disable-next-line no-console
    console.error('bench getModule error:', e && (e as any).stack ? (e as any).stack : e)
    throw e
  }
})
