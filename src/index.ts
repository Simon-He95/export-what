import { createCompletionItem, createExtension, getSelection, registerCompletionItemProvider, registerHoverProvider } from '@vscode-use/utils'
import { isArray, toArray } from 'lazy-js-utils'
import * as vscode from 'vscode'
import type { ExportType } from './parse'
import { getModule } from './parse'
import { getImportSource } from './utils'

export = createExtension(() => {
  const filter = ['javascript', 'javascriptreact', 'typescript', 'typescriptreact', 'vue', 'svelte']
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
    JSON: 0,
  }

  return [
    registerHoverProvider('*',
      async (_, position) => {
        const source = getImportSource(position)
        if (!source)
          return

        if (!source.isInSource)
          return

        const data = await getModule(source.source)
        if (data)
          return getHoverMd(data.exports)
      }),
    registerCompletionItemProvider(filter, async (_document, position) => {
      const source = getImportSource(position)
      if (!source)
        return
      const data = await getModule(source.source)

      if (data)
        return getCompletion(data.exports, source.imports)
    }, [' ', ',']),
  ]

  function getHoverMd(exportData: ExportType[]) {
    const md = new vscode.MarkdownString()
    md.isTrusted = true
    md.supportHtml = true
    const blocks: string[] = []
    let isTitle = false
    exportData.sort(a =>
      a.type.includes('default') ? -1 : 1,
    ).forEach((data) => {
      let { type, name, alias } = data
      if (!name)
        name = 'default'
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

        if (lineText[pos] !== ',' && lineText.slice(Math.max(pos - 5, 0), pos + 1) !== 'import')
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
      }).map(({ name, type, returnType, raw, params = '', optionsTypes }) => {
        let _type: any = isArray(type) ? type.filter(t => t !== 'default') : [type]
        if (_type.length > 1)
          _type = _type.filter((t: string) => t !== 'Identifier')
        const detail = `${params ? `参数：${params}` : ''}${returnType ? `\n\n返回类型：${returnType}` : ''}`

        const documentation = new vscode.MarkdownString()
        documentation.isTrusted = true
        documentation.supportHtml = true
        const details = []
        optionsTypes = optionsTypes?.map(i => i.trim()).filter(Boolean)
        if (optionsTypes && optionsTypes.length) {
          details.push('## 参数类型')
          details.push('```')
          details.push(...optionsTypes)
          details.push('```')
        }
        if (raw) {
          details.push('## 定义')
          details.push(`\`\`\`\n${raw}\n\`\`\``)
        }
        documentation.appendMarkdown(details.join('\n\n'))
        _type = _type[0]
        return createCompletionItem({ content: `Export: ${name}  ->  ${type}`, snippet: set_exports_snippet(name), type: typeCode[_type] ?? 8, detail, documentation })
      }),
      ...show_default
        ? exportData.filter(({ type }) => type.includes('default')).map(({ name, raw, params, optionsTypes, returnType, type }) => {
          let _type: any = isArray(type) ? type.filter(t => t !== 'default') : type
          if (_type.length > 1)
            _type = _type.filter((t: string) => t !== 'Identifier')
          const detail = `${params} ${returnType}`

          const documentation = new vscode.MarkdownString()
          documentation.isTrusted = true
          documentation.supportHtml = true
          const details = []
          if (optionsTypes && optionsTypes.length) {
            details.push('## 参数类型')
            details.push(...optionsTypes)
          }
          if (raw) {
            details.push('## 定义')
            details.push(raw)
          }
          documentation.appendMarkdown(details.join('\n\n'))

          _type = _type[0]
          return createCompletionItem({ content: `Export Default: ${name}  ->  ${type}`, snippet: name, type: typeCode[_type] ?? 5, detail, documentation, sortText: '0', preselect: true })
        })
        : [],
    ]
  }
})
