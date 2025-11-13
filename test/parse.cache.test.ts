import { describe, expect, it, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import { resolve } from 'node:path'

// Mock @vscode-use/utils to avoid pulling in the real `vscode` dependency during tests
vi.mock('@vscode-use/utils', () => ({
  createCompletionItem: () => ({}),
  createExtension: (fn: any) => fn(),
  createHover: (x: any) => x,
  createMarkdownString: () => ({ appendMarkdown: () => {}, appendCodeblock: () => {}, isTrusted: true, supportHtml: true }),
  createRange: () => ({}),
  getSelection: () => ({ character: 0, lineText: '', line: 0 }),
  registerCompletionItemProvider: () => {},
  registerHoverProvider: () => {},
  getActiveText: () => '',
  getActiveTextEditor: () => undefined,
  getActiveTextEditorLanguageId: () => 'typescript',
  getCurrentFileUrl: () => process.cwd(),
  getLineText: () => '',
  isInPosition: () => false,
}))

// Mock local utils to avoid importing vscode in tests; use actual module but override toAbsoluteUrl
vi.mock('../src/utils', async () => {
  const actual = await vi.importActual('../src/utils')
  return {
    ...(actual as any),
    toAbsoluteUrl: async (url: string) => ({ url }),
  }
})

import { getModule, invalidateCacheByUrl, clearAllCache } from '../src/parse'
import { ensureAlias } from '../src/utils'

const FIXTURE_DIR = resolve(__dirname, 'fixtures')
const FILE = resolve(FIXTURE_DIR, 'tmp-module.ts')

describe('parse cache invalidation', () => {
  it('should parse, cache, invalidate and reparse a module', async () => {
    await fs.mkdir(FIXTURE_DIR, { recursive: true })
    // initial file
    await fs.writeFile(FILE, `export const foo = 1\n`, 'utf8')

    clearAllCache()

    const result1 = await getModule(FILE, false, undefined, process.cwd())
    expect(result1).toBeDefined()
  expect(result1!.exports.some((e: any) => e.name === 'foo')).toBe(true)

    // change file
    await fs.writeFile(FILE, `export const bar = 2\n`, 'utf8')

    // without invalidation, cached result may still contain foo
    const result2 = await getModule(FILE, false, undefined, process.cwd())
    // either cached or updated depending on timing; ensure invalidation works
    // now invalidate and reparse
    invalidateCacheByUrl(FILE)
    const result3 = await getModule(FILE, false, undefined, process.cwd())
    expect(result3).toBeDefined()
  expect(result3!.exports.some((e: any) => e.name === 'bar')).toBe(true)
  })

  // Note: ensureAlias behavior depends on workspace tsconfig; skip direct assertion here to avoid
  // coupling tests to local developer environment.
})
