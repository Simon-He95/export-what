import fs from 'node:fs'
import path from 'node:path'
import { createCompletionItem, getCurrentFileUrl, getLineText, getSelection, registerCompletionItemProvider } from '@vscode-use/utils'
import { useJSONParse } from 'lazy-js-utils'
import * as vscode from 'vscode'
import type { ExtensionContext } from 'vscode'

const suffix = ['.js', '.ts']
const cache = new Map()

const LOCAL_URL_REG = /^(\.|\/|\@\/)/
export function activate(context: ExtensionContext) {
  const IMPORT_REG = /import\s*(.*)\s*from ["']([^"']*)["']/
  const REQUIRE_REG = /require\(["']([^"']*)["']\)/

  context.subscriptions.push(vscode.languages.registerHoverProvider('*', {
    async provideHover(_, position) {
      const lineText = getLineText(position.line)
      const character = position.character
      if (!IMPORT_REG.test(lineText) && !REQUIRE_REG.test(lineText))
        return

      const importMatch = lineText.match(IMPORT_REG)
      // 判断是否是hover到了路径才触发提示
      if (importMatch) {
        const start = lineText.indexOf(importMatch.input!) + importMatch.input!.indexOf(importMatch[2]) - 1
        const end = start + importMatch[2].length + 1
        if ((character < start) || (character > end))
          return
      }
      const workspace = vscode.workspace.workspaceFolders![0].uri.path
      const node_modules = path.resolve(workspace, '.', 'node_modules')

      if (importMatch) {
        let dep = importMatch[2]
        if (cache.has(dep)) {
          const url = cache.get(dep)
          if (!url)
            return
          const content = await fs.promises.readFile(url, 'utf-8')
          return getHoverMd(getContentExport(content, url))
        }
        if (/^(\.|\/|\@\/)/.test(dep)) {
          // relative
          if (dep.startsWith('@')) {
            const url = path.resolve(workspace, 'jsconfig.json')
            const jsconfig = fs.existsSync(url)
            if (jsconfig) {
              const config = useJSONParse(await fs.promises.readFile(url, 'utf-8'))
              const paths = config?.compilerOptions?.paths
              if (paths) {
                for (const key in paths) {
                  let value = paths[key]
                  if (key.startsWith('@')) {
                    if (Array.isArray(value))
                      value = value[0]
                    value = value.replaceAll('/**', '').replaceAll('/*', '')
                    dep = dep.replace('@', path.resolve(workspace, '.', value))
                    break
                  }
                }
              }
            }
            else {
              const url = path.resolve(workspace, 'tsconfig.json')
              const tsconfig = fs.existsSync(url)
              if (tsconfig) {
                const config = useJSONParse(await fs.promises.readFile(url, 'utf-8'))
                const paths = config?.compilerOptions?.paths
                if (paths) {
                  for (const key in paths) {
                    let value = paths[key]
                    if (key.startsWith('@')) {
                      if (Array.isArray(value))
                        value = value[0]
                      value = value.replaceAll('/**', '').replaceAll('/*', '')
                      dep = dep.replace('@', path.resolve(workspace, '.', value))
                      break
                    }
                  }
                }
              }
            }

            // 没办法处理@，默认使用根目录
            dep = dep.replace('@', workspace)
          }

          const currentFile = getCurrentFileUrl()
          const url = path.resolve(currentFile, '..', dep)
          const target = findFile(url)
          if (target) {
            const content = await fs.promises.readFile(target, 'utf-8')
            cache.set(importMatch[2], target)
            return getHoverMd(getContentExport(content, target))
          }

          cache.set(importMatch[2], null)
        }
        else {
          // node_modules
          const moduleFolder = path.resolve(node_modules, '.', dep)
          if (moduleFolder) {
            const url = path.resolve(moduleFolder, '.', 'package.json')
            const pkg = JSON.parse(await fs.promises.readFile(url, 'utf-8'))
            const main = pkg.module || pkg.main
            if (main) {
              const url = path.resolve(moduleFolder, '.', main)
              const content = await fs.promises.readFile(url, 'utf-8')
              cache.set(importMatch[2], url)

              return getHoverMd(getContentExport(content, url))
            }
          }
          cache.set(importMatch[2], null)
        }
      }
      else {
        // todo: not plan support require
        const requireMatch = lineText.match(REQUIRE_REG)!
        const dep = requireMatch[1]
        if (/^[\.\/]/.test(dep)) {
          // relative
          const currentFile = getCurrentFileUrl()
          const url = path.resolve(currentFile, '..', dep)
        }
        else {
          // node_modules
        }
      }
    },
  }))

  const filter = ['javascript', 'javascriptreact', 'typescript', 'typescriptreact', 'vue', 'svelte']
  context.subscriptions.push(registerCompletionItemProvider(filter, async (_document, position) => {
    const lineText = getLineText(position.line)
    if (!IMPORT_REG.test(lineText) && !REQUIRE_REG.test(lineText))
      return
    const importMatch = lineText.match(IMPORT_REG)
    if (importMatch) {
      let dep = importMatch[2]
      if (cache.has(dep)) {
        const url = cache.get(dep)
        if (!url)
          return
        const content = await fs.promises.readFile(url, 'utf-8')
        return getCompletion(getContentExport(content, url), importMatch[1])
      }
      const workspace = vscode.workspace.workspaceFolders![0].uri.path
      if (LOCAL_URL_REG.test(dep)) {
        // relative
        if (dep.startsWith('@')) {
          const url = path.resolve(workspace, 'jsconfig.json')
          const jsconfig = fs.existsSync(url)
          if (jsconfig) {
            const config = useJSONParse(await fs.promises.readFile(url, 'utf-8'))
            const paths = config?.compilerOptions?.paths
            if (paths) {
              for (const key in paths) {
                let value = paths[key]
                if (key.startsWith('@')) {
                  if (Array.isArray(value))
                    value = value[0]
                  value = value.replaceAll('/**', '').replaceAll('/*', '')
                  dep = dep.replace('@', path.resolve(workspace, '.', value))
                  break
                }
              }
            }
          }
          else {
            const url = path.resolve(workspace, 'tsconfig.json')
            const tsconfig = fs.existsSync(url)
            if (tsconfig) {
              const config = useJSONParse(await fs.promises.readFile(url, 'utf-8'))
              const paths = config?.compilerOptions?.paths
              if (paths) {
                for (const key in paths) {
                  let value = paths[key]
                  if (key.startsWith('@')) {
                    if (Array.isArray(value))
                      value = value[0]
                    value = value.replaceAll('/**', '').replaceAll('/*', '')
                    dep = dep.replace('@', path.resolve(workspace, '.', value))
                    break
                  }
                }
              }
            }
          }

          // 没办法处理@，默认使用根目录
          dep = dep.replace('@', workspace)
        }

        const currentFile = getCurrentFileUrl()
        const url = path.resolve(currentFile, '..', dep)
        const target = findFile(url)
        if (target) {
          const content = await fs.promises.readFile(target, 'utf-8')
          cache.set(importMatch[2], target)
          return getCompletion(getContentExport(content, target), importMatch[1])
        }
        cache.set(importMatch[2], null)
      }
      else {
        // node_modules
        const node_modules = path.resolve(workspace, '.', 'node_modules')
        const moduleFolder = path.resolve(node_modules, '.', dep)
        if (moduleFolder) {
          const url = path.resolve(moduleFolder, '.', 'package.json')
          const pkg = JSON.parse(await fs.promises.readFile(url, 'utf-8'))
          const main = pkg.module || pkg.main
          if (main) {
            const url = path.resolve(moduleFolder, '.', main)
            const content = await fs.promises.readFile(url, 'utf-8')
            cache.set(importMatch[2], url)
            return getCompletion(getContentExport(content, url), importMatch[1])
          }
        }
        cache.set(importMatch[2], null)
      }
    }
    else {
      // todo
      const requireMatch = lineText.match(REQUIRE_REG)!
      const dep = requireMatch[1]
      if (LOCAL_URL_REG.test(dep)) {
        // relative
        const currentFile = getCurrentFileUrl()
        const url = path.resolve(currentFile, '..', dep)
      }
      else {
        // node_modules
      }
    }
  }, [' ', ',']))

  function getHoverMd(exportData: { export_default: string[]; exports: string[] }) {
    const { export_default, exports } = exportData

    const md = new vscode.MarkdownString()
    md.isTrusted = true
    md.supportHtml = true
    const blocks = []
    if (export_default.length) {
      blocks.push('## Export Default')
      blocks.push(...export_default.map(i => `- ${i}`))
    }

    if (exports.length) {
      blocks.push('## Export')
      blocks.push(...exports.map(i => `- ${i}`))
    }

    md.appendMarkdown(blocks.join('\n\n'))
    if (blocks.length)
      return new vscode.Hover(md)
  }

  function getCompletion(exportData: { export_default: string[]; exports: string[] }, currentModule: string) {
    const { export_default, exports } = exportData
    const match = currentModule.match(/{([^}]*)}/)
    let has: string[] = []
    if (match) {
      has = match[1].replace(/\s/g, '').split(',').filter(Boolean)
      const _default = match.input?.replace(match[0], '').replace(/[,\s]/g, '')
      if (_default)
        has.push(_default)
    }
    else {
      const _default = currentModule.replace(/[,\s]/g, '')
      if (_default)
        has.push(_default)
    }

    const { character, lineText } = getSelection()!
    let set_exports_snippet = (v: string) => ` ${v}$1`
    let show_default = true
    if (match) {
      const start = lineText.indexOf(currentModule) + match.input!.indexOf(match[1])
      const end = start + match[0].length - 1
      if ((character < start) || (character > end)) {
        // 说明在 {}外
      }
      else {
        show_default = false
        let pos = character - 1
        const start = lineText.indexOf(currentModule) + match.index! + match[0].indexOf(match[1])
        while (lineText[pos] === ' ' && pos > start)
          pos--

        if (lineText[pos] !== ' ' && lineText[pos] !== ',')
          set_exports_snippet = (v: string) => `, ${v}$1`
        else if (pos !== character - 1)
          set_exports_snippet = (v: string) => `${v}$1`
      }
    }
    else {
      if (!currentModule.trim()) {
        set_exports_snippet = (v: string) => `{ ${v}$1 }`
      }
      else {
        let pos = character - 1
        const start = lineText.indexOf(currentModule)
        while (lineText[pos] === ' ' && pos > start)
          pos--

        if (lineText[pos] !== ',')
          set_exports_snippet = (v: string) => `, { ${v}$1 }`
        else if (pos !== character - 1)
          set_exports_snippet = (v: string) => `{ ${v}$1 }`
        else
          set_exports_snippet = (v: string) => ` { ${v}$1 }`
      }
    }
    return [
      ...exports.filter(item => !has.includes(item)).map(item => createCompletionItem({ content: `Export: ${item}`, snippet: set_exports_snippet(item), type: 8 })),
      ...show_default
        ? export_default.filter(item => !has.includes(item)).map(item => createCompletionItem({ content: `Export Default: ${item}`, snippet: item, type: 5 }))
        : [],
    ]
  }
}

export function deactivate() {

}

const EXPORT_REG = /export (?:const|let|var|function)\s+([\w_]+)\s*/g
const EXPORT_MULTIPLE_REG = /export\s+{([^}]*)}/g
const EXPORT_DEFAULT_FUNCTION_REG = /export\s+default\s+function\s+([\w_]+)\s*\([^\)]*\)/g
const EXPORT_DEFAULT_REG = /export\s+default\s+([\w_]+)[;\s]?$/g
const TREE_MODULE_REG = /export\s+\*\s+from\s+["']([^'"]*)["']/g

export function getContentExport(content: string, workspace: string): { export_default: string[]; exports: string[] } {
  const exports = []
  const export_default = []

  for (const match of content.matchAll(EXPORT_REG))
    exports.push(match[1])

  for (const match of content.matchAll(EXPORT_DEFAULT_FUNCTION_REG))
    export_default.push(match[1])

  for (const match of content.matchAll(EXPORT_MULTIPLE_REG)) {
    const items = match[1].trim().split(',')

    exports.push(...items.map((i) => {
      i = i.trim().replace(/\s+/g, ' ')
      if (i.startsWith('//'))
        return false
      const asMatch = i.match(/ as\s+(.*)/)
      if (asMatch) {
        const asValue = asMatch[1].trim()
        if (asValue === 'default') {
          export_default.push(asValue)
          return false
        }
        else { return asValue }
      }
      return i.split(':')[0]
    }).filter(Boolean) as string[])
  }

  for (const match of content.matchAll(EXPORT_DEFAULT_REG))
    export_default.push(match[1])

  for (const match of content.matchAll(TREE_MODULE_REG)) {
    const tree_url = match[1]
    if (cache.has(tree_url)) {
      const url = cache.get(tree_url)
      if (!url)
        continue
      const tree_content = fs.readFileSync(url, 'utf-8')
      const { exports: treeExports } = getContentExport(tree_content, url)
      exports.push(...treeExports)
      continue
    }
    // 判断是否是node_modules or 相对路径
    if (LOCAL_URL_REG.test(tree_url)) {
      const url = path.resolve(workspace, '..', tree_url)
      const target = findFile(url)
      if (target) {
        const tree_content = fs.readFileSync(target, 'utf-8')
        const { exports: treeExports } = getContentExport(tree_content, target)
        exports.push(...treeExports)
      }
      else {
        cache.set(tree_url, null)
      }
    }
    else {
      const node_modules = path.resolve(vscode.workspace.workspaceFolders![0].uri.path, '.', 'node_modules')
      const moduleFolder = path.resolve(node_modules, '.', tree_url)
      if (moduleFolder) {
        const url = path.resolve(moduleFolder, '.', 'package.json')
        const pkg = JSON.parse(fs.readFileSync(url, 'utf-8'))
        const main = pkg.module || pkg.main
        if (main) {
          const url = path.resolve(moduleFolder, '.', main)
          const tree_content = fs.readFileSync(url, 'utf-8')
          cache.set(tree_url, url)
          const { exports: treeExports } = getContentExport(tree_content, url)
          exports.push(...treeExports)
        }
        else {
          cache.set(tree_url, null)
        }
      }
    }
  }

  return {
    export_default,
    exports,
  }
}

export function isDirectory(url: string) {
  const stats = fs.statSync(url)
  return stats.isDirectory()
}

export function findFile(url: string) {
  const target = null
  for (const s of suffix) {
    if (url.endsWith(s))
      return url

    const temp = `${url}${s}`
    if (fs.existsSync(temp))
      return temp
  }
  if (target)
    return target

  if (!isDirectory(url))
    return target

  return findFile(`${url}/index`)
}
