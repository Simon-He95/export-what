import { createCompletionItem, getLineText, getSelection, registerCompletionItemProvider } from '@vscode-use/utils'
import { isArray, toArray } from 'lazy-js-utils'
import * as vscode from 'vscode'
import type { ExtensionContext } from 'vscode'
import type { ExportType } from './parse'
import { getModule } from './parse'

export function activate(context: ExtensionContext) {
  const IMPORT_REG = /import\s*(.*)\s*from\s+["']([^"']*)["']/
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
        const start = lineText.indexOf(importMatch.input!) + importMatch.input!.lastIndexOf(importMatch[2]) - 1
        const end = start + importMatch[2].length + 1
        if ((character < start) || (character > end))
          return
      }

      const data = await getModule(importMatch![2])
      if (data)
        return getHoverMd(data.exports)
    },
  }))

  const filter = ['javascript', 'javascriptreact', 'typescript', 'typescriptreact', 'vue', 'svelte']
  context.subscriptions.push(registerCompletionItemProvider(filter, async (_document, position) => {
    const lineText = getLineText(position.line)
    if (!IMPORT_REG.test(lineText) && !REQUIRE_REG.test(lineText))
      return
    const importMatch = lineText.match(IMPORT_REG)

    const data = await getModule(importMatch![2])

    if (data)
      return getCompletion(data.exports, importMatch![1])
  }, [' ', ',']))

  function getHoverMd(exportData: ExportType[]) {
    const md = new vscode.MarkdownString()
    md.isTrusted = true
    md.supportHtml = true
    const blocks: string[] = []
    let isTitle = false
    exportData.sort((a, b) =>
      a.type.includes('default') ? -1 : 1,
    ).forEach((data) => {
      const { type, name, alias } = data
      if (type.includes('default')) {
        const _type = type.find(i => i !== 'default')
        blocks.push('## Export Default')
        blocks.push(`- \`${alias || name}\`   ->   \`${_type}\``)
      }
      else {
        if (!isTitle) {
          isTitle = true
          blocks.push('## Export')
        }
        const _type = toArray(type)
        blocks.push(`- \`${alias || name}\`   ->   \`${_type[0]}\``)
      }
    })

    md.appendMarkdown(blocks.join('\n\n'))
    if (blocks.length)
      return new vscode.Hover(md)
  }

  const typeCode: Record<string, number> = {
    TSTypeAliasDeclaration: 24,
    TSEnumDeclaration: 24,
    ClassDeclaration: 6,
    FunctionDeclaration: 2,
    TSInterfaceDeclaration: 7,
    Struct: 21,
    VariableDeclaration: 5,
    TSFunctionType: 24,
    TSTypeLiteral: 24,
  }

  function getCompletion(exportData: ExportType[], currentModule: string) {
    const match = currentModule.match(/{([^}]*)}/)
    const isTypeOnly = currentModule.startsWith('type')
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
      ...exportData.filter(({ name, type }) => {
        if (has.includes(name))
          return false
        if (isTypeOnly && !['TSInterfaceDeclaration', 'TSTypeAliasDeclaration', 'TSEnumDeclaration', 'TSFunctionType', 'TSTypeLiteral'].includes(type[0]))
          return false
        return true
      }).map(({ name, type, returnType }) => {
        let _type: any = isArray(type) ? type.filter(t => t !== 'default') : [type]
        if (_type.length > 1)
          _type = _type.filter((t: string) => t !== 'Identifier')

        _type = _type[0]
        return createCompletionItem({ content: `Export: ${name}  ->  ${type}`, snippet: set_exports_snippet(name), type: typeCode[_type] ?? 8, detail: returnType })
      }),
      ...show_default
        ? exportData.filter(({ type }) => type.includes('default')).map(({ name, type, returnType }) => {
          let _type: any = isArray(type) ? type.filter(t => t !== 'default') : type
          if (_type.length > 1)
            _type = _type.filter((t: string) => t !== 'Identifier')

          _type = _type[0]
          return createCompletionItem({ content: `Export Default: ${name}  ->  ${type}`, snippet: name, type: typeCode[_type] ?? 5, detail: returnType })
        })
        : [],
    ]
  }
}

export function deactivate() {

}
