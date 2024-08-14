import { resolve } from 'node:path'
import { existsSync, promises, readFileSync, statSync } from 'node:fs'
import { workspace } from 'vscode'
import type { Position } from 'vscode'
import { isArray, useJSONParse } from 'lazy-js-utils'
import { getActiveText, getActiveTextEditor, getActiveTextEditorLanguageId, getCurrentFileUrl, getLineText, isInPosition } from '@vscode-use/utils'
import { findUpSync } from 'find-up'
import fg from 'fast-glob'
import { parser } from './parse'

const LOCAL_URL_REG = /^(?:\.|\/|@\/)/

const _projectRoot = workspace.workspaceFolders![0].uri.fsPath
const suffix = ['.ts', '.js', '.tsx', '.jsx']
export let alias: any = null

if (!alias)
  getAlias().then(data => alias = data)

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
export function toAbsoluteUrl(url: string, module = '', currentFileUrl = getCurrentFileUrl()!) {
  // 判断是否是node_modules or 相对路径
  if (LOCAL_URL_REG.test(url)) {
    let isUseAlia = false

    if (alias) {
      Object.keys(alias).forEach((alia) => {
        url = url.replace(alia, () => {
          isUseAlia = true
          return alias[alia]
        })
      })
    }

    const result = isUseAlia
      ? resolve(_projectRoot, '.', url)
      : resolve(currentFileUrl, '..', url)

    if (existsSync(result) && statSync(result).isFile())
      return { url: result }

    for (const s of suffix) {
      const _url = `${result}${s}`
      if (existsSync(_url))
        return { url: _url }
    }

    for (const s of suffix) {
      const child = resolve(result, `index${s}`)
      if (existsSync(child))
        return { url: child }
    }
  }
  else {
    const moduleFolder = findNodeModules(module, url)

    if (moduleFolder) {
      const _url = resolve(moduleFolder, '.', 'package.json')
      if (!existsSync(_url)) {
        // todo: 修复没找到的文件
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
          return { url: resolve(moduleFolder, `${moduleName}.d.ts`), moduleFolder }
        }
      }
      if (!main)
        main = pkg.types || pkg.typings || pkg.module || pkg.main || pkg?.exports?.types || pkg?.exports?.default
      return { url: resolve(moduleFolder, '.', main), moduleFolder: resolve(moduleFolder, 'node_modules') }
    }
  }
}

const workspaceCache = new Set()
function isTarget(moduleFolder: string) {
  return isDirectory(moduleFolder) && existsSync(resolve(moduleFolder, './package.json'))
}
export function findNodeModules(module: string, url: string, projectRoot = _projectRoot) {
  let moduleFolder = ''
  if (module)
    moduleFolder = resolve(module, '.', url)

  if (isTarget(moduleFolder))
    return moduleFolder

  moduleFolder = resolve(resolve(projectRoot, '.', 'node_modules'), '.', url)

  if (isTarget(moduleFolder))
    return moduleFolder
  moduleFolder = toPnpmUrl(url) || moduleFolder

  // 从@types中获取
  if (isTarget(moduleFolder))
    return moduleFolder
  moduleFolder = resolve(resolve(projectRoot, '.', 'node_modules/@types'), '.', url)

  if (!isTarget(moduleFolder)) {
    // 判断当前是否是pnpm在子仓找依赖
    const currentFileUrl = getCurrentFileUrl()!
    const _workspace = findUpSync('node_modules', {
      cwd: currentFileUrl,
      stopAt: _projectRoot,
      type: 'directory',
    })

    if (_workspace && !workspaceCache.has(_workspace)) {
      workspaceCache.add(_workspace)
      const workspace = resolve(_workspace, '..')
      moduleFolder = findNodeModules(module, url, workspace)
      if (!isDirectory(moduleFolder) && url.includes('/'))
        moduleFolder = findNodeModules(module, url.split('/').slice(0, -1).join('/'), workspace)
      else
        return moduleFolder
    }
  }

  if (!isTarget(moduleFolder) && url.includes('/')) {
    // 考虑只匹配前面再从exports中匹配后半部份
    moduleFolder = findNodeModules(module, url.split('/').slice(0, -1).join('/'))
  }

  return moduleFolder
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
  }
}
