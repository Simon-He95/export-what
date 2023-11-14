import fs from 'node:fs'
import path from 'node:path'
import { createCompletionItem, getCurrentFileUrl, getLineText, registerCompletionItemProvider } from '@vscode-use/utils'
import { useJSONParse } from 'lazy-js-utils'
import * as vscode from 'vscode'
import type { ExtensionContext } from 'vscode'

export function activate(context: ExtensionContext) {
  const IMPORT_REG = /import\s*(.*)\s*from ["']([^"']*)["']/
  const REQUIRE_REG = /require\(["']([^"']*)["']\)/
  const suffix = ['.js', '.ts']
  const cache = new Map()

  context.subscriptions.push(vscode.languages.registerHoverProvider('*', {
    async provideHover(_document, position) {
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
          return getHoverMd(getContentExport(content))
        }
        const workspace = vscode.workspace.workspaceFolders![0].uri.path
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
          for (const end of suffix) {
            let temp = url
            if (!url.endsWith(end))
              temp += end

            if (!fs.existsSync(temp))
              continue
            const content = await fs.promises.readFile(temp, 'utf-8')
            cache.set(importMatch[2], temp)
            return getHoverMd(getContentExport(content))
          }
          if (await isDirectory(url)) {
            const folderUrl = `${url}/index`
            for (const end of suffix) {
              let temp = folderUrl
              if (!url.endsWith(end))
                temp += end

              if (!fs.existsSync(temp))
                continue
              const content = await fs.promises.readFile(temp, 'utf-8')
              cache.set(importMatch[2], temp)
              return getHoverMd(getContentExport(content))
            }
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
              return getHoverMd(getContentExport(content))
            }
          }
          cache.set(importMatch[2], null)
        }
      }
      else {
        // todo
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

  const filter = ['javascript', 'javascriptreact', 'typescriptreact', 'vue', 'svelte']

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
        return getCompletion(getContentExport(content), importMatch[1])
      }
      const workspace = vscode.workspace.workspaceFolders![0].uri.path
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
        for (const end of suffix) {
          let temp = url
          if (!url.endsWith(end))
            temp += end

          if (!fs.existsSync(temp))
            continue
          const content = await fs.promises.readFile(temp, 'utf-8')
          cache.set(importMatch[2], temp)
          return getCompletion(getContentExport(content), importMatch[1])
        }
        if (await isDirectory(url)) {
          const folderUrl = `${url}/index`
          for (const end of suffix) {
            let temp = folderUrl
            if (!url.endsWith(end))
              temp += end

            if (!fs.existsSync(temp))
              continue
            const content = await fs.promises.readFile(temp, 'utf-8')
            cache.set(importMatch[2], temp)
            return getCompletion(getContentExport(content), importMatch[1])
          }
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
            return getCompletion(getContentExport(content), importMatch[1])
          }
        }
        cache.set(importMatch[2], null)
      }
    }
    else {
      // todo
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
  }, [' ', ',']))

  function getHoverMd(exportData: { export_default: string[]; exports: string[] }) {
    const { export_default, exports } = exportData

    const md = new vscode.MarkdownString()
    md.isTrusted = true
    md.supportHtml = true
    const blocks = []
    if (exports.length) {
      blocks.push('## Export')
      blocks.push(...exports.map(i => `- ${i}`))
    }
    if (export_default.length) {
      blocks.push('## Export Default')
      blocks.push(...export_default.map(i => `- ${i}`))
    }

    md.appendMarkdown(blocks.join('\n\n'))
    if (blocks.length)
      return new vscode.Hover(md)
  }

  function getCompletion(exportData: { export_default: string[]; exports: string[] }, currentModule: string) {
    const { export_default, exports } = exportData
    const match = currentModule.match(/{([^}]*)}/)
    const has = match ? match[1].replace(/\s/g, '').split(',').filter(Boolean) : []

    return [
      ...exports.filter(item => !has.includes(item)).map(item => createCompletionItem({ content: `Export: ${item}`, snippet: item })),
      ...export_default.map(item => createCompletionItem({ content: `Export Default: ${item}`, snippet: item })),
    ]
  }
}

export function deactivate() {

}

const EXPORT_REG = /export (?:const|let|var|function)\s+([\w_]+)\s*/g
const EXPORT_MULTIPLE_REG = /export\s+{([^}]*)}/g
const EXPORT_DEFAULT_FUNCTION_REG = /export\s+default\s+function\s+([\w_]+)\s*\([^\)]*\)/g
const EXPORT_DEFAULT_REG = /export\s+default\s+([\w_]+)[;\s]?$/g
// 暂时不考虑复杂的*的dep递归追踪module

export function getContentExport(content: string) {
  const exports = []
  const export_default = []
  for (const match of content.matchAll(EXPORT_REG))
    exports.push(match[1])

  for (const match of content.matchAll(EXPORT_DEFAULT_FUNCTION_REG))
    export_default.push(match[1])

  for (const match of content.matchAll(EXPORT_MULTIPLE_REG)) {
    const items = match[1].replace(/\s/g, '').split(',')
    exports.push(...items.map(i => i.split(':')[0]))
  }

  for (const match of content.matchAll(EXPORT_DEFAULT_REG))
    export_default.push(match[1])

  return {
    export_default,
    exports,
  }
}

export function isDirectory(url: string): Promise<boolean> {
  return new Promise((resolve, _reject) => {
    fs.stat(url, (err, stats) => {
      if (err) {
        resolve(false)
        return
      }

      resolve(stats.isDirectory())
    })
  })
}
