import type { Position } from 'vscode'
import { existsSync, promises, readFileSync, statSync } from 'node:fs'
import { resolve, isAbsolute } from 'node:path'
import { getActiveText, getActiveTextEditor, getActiveTextEditorLanguageId, getCurrentFileUrl, getLineText, isInPosition } from '@vscode-use/utils'
import fg from 'fast-glob'
import { findUp } from 'find-up'
import { isArray, useJSONParse } from 'lazy-js-utils'
import { parser } from './parse'
import { debug } from './logger'

const LOCAL_URL_REG = /^(?:\.|\/|@\/)/

// Determine project root. Avoid top-level static import of `vscode` so tests and
// non-VS Code contexts don't fail. Fall back to `process.cwd()` when not
// available.
let _projectRoot: string
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const vscode = require('vscode') as any
  _projectRoot = (vscode && vscode.workspace && vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length)
    ? vscode.workspace.workspaceFolders[0].uri.fsPath
    : process.cwd()
}
catch (e) {
  _projectRoot = process.cwd()
}
const suffix = ['.ts', '.js', '.tsx', '.jsx']
export let alias: Record<string, string> | null = null

/**
 * Ensure alias mapping is loaded. This avoids a race where resolution runs
 * before the initial async load completes. Callers can `await ensureAlias()`.
 */
export async function ensureAlias() {
  if (alias)
    return alias
  // getAlias may return undefined
  const data = await getAlias()
  alias = (data as Record<string, string>) || null
  return alias
}

export function toPnpmUrl(url: string) {
  const pnpm = resolve(_projectRoot, 'node_modules/.pnpm')
  const modules = resolve(pnpm, 'lock.yaml')
  if (!existsSync(modules))
    return
  const content = readFileSync(modules, 'utf-8')
  const versionMatch = content.match(`${url}@([^:]+):`)
  if (!versionMatch)
    return
  const v = versionMatch[1].replace(/['"]/g, '')
  const toUrl = `${url.replace(/\//g, '+')}@${v}*/node_modules/${url}`

  const entry = fg.sync(resolve(pnpm, toUrl), {
    cwd: pnpm,
    absolute: true,
    onlyDirectories: true,
    dot: true,
  })
  if (entry.length)
    return entry[0]
}

// todo: 判断是否是pnpm通过pnpm 组合命名xx+xx去找目录下的类型
const toAbsoluteUrlCache = new Map<string, { url: string; moduleFolder?: string } | undefined>()

export function clearToAbsoluteUrlCache() {
  toAbsoluteUrlCache.clear()
}

export async function toAbsoluteUrl(url: string, module = '', currentFileUrl = getCurrentFileUrl()!) {
  const cacheKey = `${module}::${url}::${currentFileUrl}`
  if (toAbsoluteUrlCache.has(cacheKey))
    return toAbsoluteUrlCache.get(cacheKey)

  try {
    if (LOCAL_URL_REG.test(url)) {
      let isUseAlia = false
      const aliasMap = await ensureAlias()
      if (aliasMap) {
        Object.keys(aliasMap).forEach((alia) => {
          url = url.replace(alia, () => {
            isUseAlia = true
            return aliasMap[alia]
          })
        })
      }
      // If the url is already absolute, use it directly.
      const result = isAbsolute(url) ? url : (isUseAlia ? resolve(_projectRoot, '.', url) : resolve(currentFileUrl, '..', url))

      if (existsSync(result) && statSync(result).isFile()) {
        const res = { url: result }
        toAbsoluteUrlCache.set(cacheKey, res)
        return res
      }

      for (const s of suffix) {
        const _url = `${result}${s}`
        if (existsSync(_url)) {
          const res = { url: _url }
          toAbsoluteUrlCache.set(cacheKey, res)
          return res
        }
      }

      for (const s of suffix) {
        const child = resolve(result, `index${s}`)
        if (existsSync(child)) {
          const res = { url: child }
          toAbsoluteUrlCache.set(cacheKey, res)
          return res
        }
      }

      toAbsoluteUrlCache.set(cacheKey, undefined)
      return
    }

    const moduleFolder = await findNodeModules(module, url)
    if (moduleFolder) {
      const _url = resolve(moduleFolder, '.', 'package.json')
      if (!existsSync(_url)) {
        toAbsoluteUrlCache.set(cacheKey, undefined)
        return
      }
      const pkg = JSON.parse(readFileSync(_url, 'utf-8'))
      let main
      if (url.includes('/')) {
        const moduleName = url.split('/').slice(-1)[0]
        const _name = `./${moduleName}`
        const exportName = pkg?.exports?.[_name]
        if (exportName) {
          main = exportName?.types
          if (!main) {
            const ts = resolve(moduleFolder, `dist/${moduleName}.d.ts`)
            if (existsSync(ts))
              main = ts
          }
        }
        else if (existsSync(resolve(moduleFolder, `${moduleName}.d.ts`))) {
          const res = { url: resolve(moduleFolder, `${moduleName}.d.ts`), moduleFolder }
          toAbsoluteUrlCache.set(cacheKey, res)
          return res
        }
      }
      if (!main)
        main = pkg.types || pkg.typings || pkg.module || pkg.main || pkg?.exports?.types || pkg?.exports?.default

      const res = { url: resolve(moduleFolder, '.', main), moduleFolder: resolve(moduleFolder, 'node_modules') }
      toAbsoluteUrlCache.set(cacheKey, res)
      return res
    }

    toAbsoluteUrlCache.set(cacheKey, undefined)
    return
  }
  catch (e) {
    toAbsoluteUrlCache.set(cacheKey, undefined)
    return
  }
}
 
const workspaceCache = new Set()
const findNodeModulesCache = new Map<string, string>()
function isTarget(moduleFolder: string) {
  return isDirectory(moduleFolder) && existsSync(resolve(moduleFolder, './package.json'))
}
export async function findNodeModules(module: string, url: string, projectRoot = _projectRoot) {
  const cacheKey = `${projectRoot}::${module}::${url}`
  if (findNodeModulesCache.has(cacheKey))
    return findNodeModulesCache.get(cacheKey)!

  let moduleFolder = ''
  if (module)
    moduleFolder = resolve(module, '.', url)

  if (isTarget(moduleFolder))
    {
      findNodeModulesCache.set(cacheKey, moduleFolder)
      return moduleFolder
    }

  moduleFolder = resolve(resolve(projectRoot, '.', 'node_modules'), '.', url)

  if (isTarget(moduleFolder))
    {
      findNodeModulesCache.set(cacheKey, moduleFolder)
      return moduleFolder
    }
  moduleFolder = toPnpmUrl(url) || moduleFolder

  // 从@types中获取
  if (isTarget(moduleFolder))
    {
      findNodeModulesCache.set(cacheKey, moduleFolder)
      return moduleFolder
    }
  moduleFolder = resolve(resolve(projectRoot, '.', 'node_modules/@types'), '.', url)

  if (!isTarget(moduleFolder)) {
    // 判断当前是否是pnpm在子仓找依赖
    const currentFileUrl = getCurrentFileUrl()!
    const _workspace = await findUp('node_modules', {
      cwd: currentFileUrl,
      stopAt: _projectRoot,
      type: 'directory',
    })

    if (_workspace && !workspaceCache.has(_workspace)) {
      workspaceCache.add(_workspace)
      const workspace = resolve(_workspace, '..')
      moduleFolder = await findNodeModules(module, url, workspace)
      if (!isDirectory(moduleFolder) && url.includes('/'))
        moduleFolder = await findNodeModules(module, url.split('/').slice(0, -1).join('/'), workspace)
      else
        {
          findNodeModulesCache.set(cacheKey, moduleFolder)
          return moduleFolder
        }
    }
  }

  if (!isTarget(moduleFolder) && url.includes('/')) {
    // 考虑只匹配前面再从exports中匹配后半部份
    moduleFolder = await findNodeModules(module, url.split('/').slice(0, -1).join('/'))
  }

  findNodeModulesCache.set(cacheKey, moduleFolder)
  return moduleFolder
}

export function clearFindNodeModulesCache() {
  findNodeModulesCache.clear()
}

export function findFile(url: string) {
  const target = null
  for (const s of suffix) {
    if (url.endsWith(s))
      return url

    const temp = `${url}${s}`
    if (existsSync(temp))
      return temp
  }
  if (target)
    return target

  if (!isDirectory(url))
    return target

  return findFile(`${url}/index`)
}

async function getAlias() {
  let configUrl = ''
  if (existsSync(resolve(_projectRoot, 'tsconfig.json')))
    configUrl = resolve(_projectRoot, 'tsconfig.json')
  else if (existsSync(resolve(_projectRoot, 'jsconfig.json')))
    configUrl = resolve(_projectRoot, 'jsconfig.json')

  if (!configUrl)
    return

  const _config = useJSONParse(await promises.readFile(configUrl, 'utf-8'))
  if (_config) {
    const paths = _config?.compilerOptions?.paths
    if (!paths)
      return
    return Object.keys(paths).reduce((result, key) => {
      let value = paths[key]
      if (isArray(value))
        value = value[0]
      result[key.replace(/\/\*\*/g, '').replace(/\/\*/g, '')] = value.replace(/\/\*\*/g, '').replace(/\/\*/g, '')
      return result
    }, {} as Record<string, string>)
  }
}

export function isDirectory(url: string) {
  try {
    const stats = statSync(url)
    return stats.isDirectory()
  }
  catch (error) {
    return false
  }
}

const IMPORTREG = /import(\s+)from\s+['"]([^"']+)['"]/

export function getImportSource(pos: Position) {
  const text = getActiveText()
  if (!text)
    return
  const isVue = getActiveTextEditorLanguageId() === 'vue'
  const activeTextEditor = getActiveTextEditor()
  if (!activeTextEditor)
    return
  try {
    if (isVue) {
      // 如果是vue就拿script
      const offset = activeTextEditor.document.offsetAt(pos)

      for (const match of text.matchAll(/<script[^>]+>(.*)<\/script>/gs)) {
        const [all, content] = match
        const ast = parser(content)

        const baseOffset = match.index! + all.indexOf(content)
        for (const item of ast.program.body) {
          // 需要计算一个新的loc
          const start = item.loc!.start.index + baseOffset
          const end = item.loc!.end.index + baseOffset
          if (item.type === 'ImportDeclaration' && start < offset && end > offset) {
            const imports = text.slice(item.start! + baseOffset, item.source.start! + baseOffset)
            return {
              imports,
              source: item.source.value,
              isInSource: isInPosition(item.source.loc!, pos),
            }
          }
          continue
        }
      }
      const lineText = getLineText(pos.line)?.trim()
      if (!lineText)
        return
      const match = lineText.match(IMPORTREG)
      if (!match)
        return
      return {
        imports: match[0],
        source: match[2],
        isInSource: false,
      }
    }
    else {
      const ast = parser(text)
      for (const item of ast.program.body) {
        if (item.type === 'ImportDeclaration' && isInPosition(item.loc!, pos)) {
          const imports = text.slice(item.start!, item.source.start!)
          return {
            imports,
            source: item.source.value,
            isInSource: isInPosition(item.source.loc!, pos),
          }
        }
        else if (item.type === 'VariableDeclaration' && item.declarations[0].type === 'VariableDeclarator' && item.declarations[0].init?.type === 'CallExpression' && item.declarations[0].init.callee.type === 'Identifier' && item.declarations[0].init.arguments[0].type === 'StringLiteral' && item.declarations[0].init.callee.name === 'require' && isInPosition(item.declarations[0].loc as any, pos)) {
          const imports = text.slice(item.declarations[0].id.start!, item.declarations[0].id.end!)
          return {
            imports,
            source: item.declarations[0].init.arguments[0].value,
            isInSource: isInPosition(item.declarations[0].init.arguments[0].loc!, pos),
          }
        }
        continue
      }
      const lineText = getLineText(pos.line)?.trim()
      if (!lineText)
        return
      const match = lineText.match(IMPORTREG)
      if (!match)
        return
      return {
        imports: match[0],
        source: match[2],
        isInSource: false,
      }
    }
  }
  catch (error) {
    debug('getImportSource error', (error && (error as any).message) || error)
  }
}
