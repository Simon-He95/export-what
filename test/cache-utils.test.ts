import { describe, it, expect, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import { resolve } from 'node:path'

// Mock @vscode-use/utils to avoid pulling in the real `vscode` dependency during tests
vi.mock('@vscode-use/utils', () => ({
  getActiveText: () => '',
  getActiveTextEditor: () => undefined,
  getActiveTextEditorLanguageId: () => 'typescript',
  getCurrentFileUrl: () => process.cwd(),
  getLineText: () => '',
  isInPosition: () => false,
}))

import * as fsMod from 'node:fs'
import { toAbsoluteUrl, clearToAbsoluteUrlCache } from '../src/utils'
import { clearAllCache } from '../src/parse'

describe('toAbsoluteUrl cache', () => {
  it('caches local resolution and is cleared by parse.clearAllCache', async () => {
    const testFile = resolve(__dirname, 'fixtures', 'tmp-module.ts')
    await fs.mkdir(resolve(__dirname, 'fixtures'), { recursive: true })
    await fs.writeFile(testFile, `export const x = 1\n`, 'utf8')

    // ensure caches empty
    clearToAbsoluteUrlCache()
    clearAllCache()

    // first resolution (cold) — cache should store the same object reference
    const absPath = resolve(__dirname, 'fixtures', 'tmp-module.ts')
    const r1 = await toAbsoluteUrl(absPath, '', process.cwd())
    const r2 = await toAbsoluteUrl(absPath, '', process.cwd())

    expect(r1).toBeDefined()
    expect(r2).toBeDefined()
    // warm call should return the same cached object reference
    expect(r1).toBe(r2)

    // clearing through parse.clearAllCache should clear the toAbsoluteUrl cache
    clearAllCache()

    // resolve again — should produce a new object (cache miss)
    const r3 = await toAbsoluteUrl(absPath, '', process.cwd())
    expect(r3).toBeDefined()
    expect(r3).not.toBe(r2)
  })
})
