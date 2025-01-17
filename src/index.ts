import { createCompletionItem, createExtension, createHover, createMarkdownString, createRange, getSelection, registerCompletionItemProvider, registerHoverProvider } from '@vscode-use/utils'
import { hash, isArray, toArray } from 'lazy-js-utils'
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
    registerHoverProvider('*', async (_, position) => {
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
    const md = createMarkdownString()
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
      return createHover(md)
  }

  function getCompletion(exportData: ExportType[], currentModule: string) {
    const match = currentModule.match(/\{([^}]*)\}/)
    const isTypeOnly = /^import\s+type/.test(currentModule)
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

    const { character, lineText, line } = getSelection()!
    let set_exports_snippet = (v: string) => ` ${v}$1`
    let show_default = true
    let range: any = createRange(line, character, line, character)
    if (match) {
      const start = lineText.indexOf(currentModule) + match.input!.indexOf(match[1])
      const end = start + match[0].length
      if ((character < start) || (character > end)) {
        // 说明在 {}外
        let pos = character - 1
        const start = lineText.indexOf(currentModule) + match.index! + match[0].indexOf(match[1])
        while (lineText[pos] === ' ' && pos > start)
          pos--
        range = createRange(line, pos + 1, line, character)
        if (lineText[pos] === '}')
          set_exports_snippet = (v: string) => `, ${v}$1`
        // 只使用export default
        exportData = exportData.filter(item => item.type.includes('default'))
      }
      else {
        show_default = false
        let pos = character - 1
        const start = lineText.indexOf(currentModule) + match.index! + match[0].indexOf(match[1])
        while (lineText[pos] === ' ' && pos > start)
          pos--

        range = createRange(line, pos + 1, line, character)
        if (lineText[pos] !== ' ' && (lineText[pos] !== ',' && lineText[pos] !== '{'))
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
        range = createRange(line, pos + 1, line, character)
        if (pos === character - 1)
          set_exports_snippet = (v: string) => `{ ${v}$1 }`
        else if (lineText[pos] !== ',' && lineText.slice(Math.max(pos - 5, 0), pos + 1) !== 'import')
          set_exports_snippet = (v: string) => `, { ${v}$1 }`
        else
          set_exports_snippet = (v: string) => ` { ${v}$1 }`
      }
    }

    const sortedExportData = exportData.filter(({ name }) => {
      if (has.includes(name))
        return false
      return true
    }).sort((bB: any, aA: any) => {
      const typeA = aA.type
      const typeB = bB.type
      if (isTypeOnly) {
        if (['TSInterfaceDeclaration', 'TSTypeAliasDeclaration', 'TSEnumDeclaration', 'TSFunctionType', 'TSTypeLiteral'].includes(typeA[0]) && !['TSInterfaceDeclaration', 'TSTypeAliasDeclaration', 'TSEnumDeclaration', 'TSFunctionType', 'TSTypeLiteral'].includes(typeB[0]))
          return 1

        if (!['TSInterfaceDeclaration', 'TSTypeAliasDeclaration', 'TSEnumDeclaration', 'TSFunctionType', 'TSTypeLiteral'].includes(typeA[0]) && ['TSInterfaceDeclaration', 'TSTypeAliasDeclaration', 'TSEnumDeclaration', 'TSFunctionType', 'TSTypeLiteral'].includes(typeB[0]))
          return -1
      }
      else {
        if (['TSInterfaceDeclaration', 'TSTypeAliasDeclaration', 'TSEnumDeclaration', 'TSFunctionType', 'TSTypeLiteral'].includes(typeA[0]) && !['TSInterfaceDeclaration', 'TSTypeAliasDeclaration', 'TSEnumDeclaration', 'TSFunctionType', 'TSTypeLiteral'].includes(typeB[0]))
          return -1

        if (!['TSInterfaceDeclaration', 'TSTypeAliasDeclaration', 'TSEnumDeclaration', 'TSFunctionType', 'TSTypeLiteral'].includes(typeA[0]) && ['TSInterfaceDeclaration', 'TSTypeAliasDeclaration', 'TSEnumDeclaration', 'TSFunctionType', 'TSTypeLiteral'].includes(typeB[0]))
          return 1
      }
      const a = aA.name
      const b = bB.name
      const aLower = a.toLowerCase()
      const bLower = b.toLowerCase()
      if (a === aLower && b !== bLower)
        return 1
      if (a !== aLower && b === bLower)
        return -1

      if (a < b)
        return -1
      if (a > b)
        return 1
      return 0
    })

    return [
      ...sortedExportData.map(({ name, type, returnType, raw, params = '', optionsTypes }, i) => {
        let _type: any = isArray(type) ? type.filter(t => t !== 'default') : [type]
        if (_type.length > 1)
          _type = _type.filter((t: string) => t !== 'Identifier')
        const detail = '导出方式: export'
        const documentation = new vscode.MarkdownString()
        documentation.isTrusted = true
        documentation.supportHtml = true
        const details = []
        optionsTypes = optionsTypes?.map(i => i.trim()).filter(Boolean)
        if (optionsTypes && optionsTypes.length) {
          details.push('### 参数类型')
          details.push('```')
          details.push(...optionsTypes)
          details.push('```')
        }
        if (raw) {
          details.push('### 定义')
          details.push(`\`\`\`\n${raw}\n\`\`\``)
        }
        documentation.appendMarkdown(details.join('\n\n'))
        if (params) {
          documentation.appendMarkdown('### 参数')
          documentation.appendMarkdown('\n')
          documentation.appendCodeblock(tidyUpType(params), 'typescript')
        }
        if (returnType) {
          documentation.appendMarkdown('### 返回类型')
          documentation.appendMarkdown('\n')
          documentation.appendCodeblock(tidyUpType(returnType), 'typescript')
        }
        _type = _type[0]
        return createCompletionItem({ content: `${name}  ->  ${type}`, sortText: String(i), preselect: true, snippet: set_exports_snippet(name), type: typeCode[_type] ?? 8, detail, range, documentation })
      }),
      ...show_default
        ? exportData.filter(({ type }) => type.includes('default')).map(({ name, raw, params, optionsTypes, returnType, type }) => {
          let _type: any = isArray(type) ? type.filter(t => t !== 'default') : type
          if (_type.length > 1)
            _type = _type.filter((t: string) => t !== 'Identifier')
          const detail = '导出方式: export default'

          const documentation = createMarkdownString()
          documentation.isTrusted = true
          documentation.supportHtml = true
          const details = []
          if (optionsTypes && optionsTypes.length) {
            details.push('### 参数类型')
            details.push(...optionsTypes)
          }
          if (raw) {
            details.push('### 定义')
            details.push(raw)
          }
          documentation.appendMarkdown(details.join('\n\n'))

          if (params) {
            documentation.appendMarkdown('### 参数')
            documentation.appendMarkdown('\n')
            documentation.appendCodeblock(tidyUpType(params), 'typescript')
          }
          if (returnType) {
            documentation.appendMarkdown('### 返回类型')
            documentation.appendMarkdown('\n')
            documentation.appendCodeblock(tidyUpType(returnType), 'typescript')
          }

          _type = _type[0]
          return createCompletionItem({ content: `${name}  ->  ${type}`, snippet: name, type: typeCode[_type] ?? 5, detail, documentation, sortText: '0', range, preselect: true })
        })
        : [],
    ]
  }
})

function tidyUpType(str: string) {
  const transformedMap = new Map<string, string>()
  let i = 0
  str = str.replace(/<[^>]+>/g, (match) => {
    const _hash = hash(match) + i++
    transformedMap.set(_hash, match)
    return _hash
  }).replace(/, /g, ',\n')
    .split(' | ')
    .join('\n| ')
    .split('>,')
    .join('>,\n ')
    .split(' ? ')
    .join('\n? ')
    .split(' : ')
    .join('\n: ')
  Array.from(transformedMap.entries()).forEach(([k, v]) => {
    str = str.replaceAll(k, v)
  })
  return str
}
