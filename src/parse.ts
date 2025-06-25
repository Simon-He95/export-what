import type { ParserOptions } from '@babel/parser'
import fs, { existsSync } from 'node:fs'
import { parse } from '@babel/parser'
import {
  isArrowFunctionExpression,
  isAssignmentExpression,
  isClassDeclaration,
  isExportAllDeclaration,
  isExportDefaultDeclaration,
  isExportNamedDeclaration,
  isExportSpecifier,
  isExpressionStatement,
  isFunctionDeclaration,
  isIdentifier,
  isImportDeclaration,
  isImportDefaultSpecifier,
  isImportSpecifier,
  isMemberExpression,
  isObjectExpression,
  isObjectProperty,
  isTSDeclareFunction,
  isTSEnumDeclaration,
  isTSInterfaceDeclaration,
  isTSModuleDeclaration,
  isTSTypeAliasDeclaration,
  isVariableDeclaration,
  isVariableDeclarator,
} from '@babel/types'
import { toAbsoluteUrl } from './utils'

export function parser(code: string) {
  const finalOptions: ParserOptions = {
    sourceType: 'module',
    plugins: ['jsx', 'typescript'],
    errorRecovery: true,
  }
  try {
    return parse(code, finalOptions)
  }
  catch (err) {
    return parse('', finalOptions)
  }
}

interface ImportType {
  name: string
  type?: 'default'
  source: string
  alias?: string
}

export interface ExportType {
  name: string
  alias?: string
  params?: string
  returnType?: string
  type: string[]
  optionsTypes?: string[]
  raw?: string
}

interface ScopedType {
  name: string
  alias?: string
  params?: string
  returnType?: string
  optionsTypes?: string[]
  type: string
  raw?: string
}
const urlMap = new Map()
const codeMap = new Map()

export async function getModule(url: string, onlyExports = false, moduleFolder?: string, currentUrl?: string) {
  const urlInfo = await toAbsoluteUrl(url, moduleFolder, currentUrl)!
  if (!urlInfo)
    return
  const { url: _url, moduleFolder: _moduleFolder } = urlInfo
  url = _url
  if (!existsSync(url))
    return
  const code = fs.readFileSync(url, 'utf-8')
  if (urlMap.has(url)) {
    const originCode = urlMap.get(url)
    if (originCode === code)
      return codeMap.get(originCode)
    codeMap.delete(originCode)
  }
  urlMap.set(url, code)

  const imports: ImportType[] = []
  let exports: ExportType[] = []
  const scoped: ScopedType[] = []

  if (url.endsWith('.json')) {
    // 对于json文件不用再解析了
    const json = JSON.parse(code)
    Object.keys(json).forEach((k) => {
      const v = json[k]
      exports.push({
        name: k,
        type: ['JSON'],
        returnType: JSON.stringify(v),
        raw: JSON.stringify(v),
      })
    })
    const result = {
      imports,
      exports,
      scoped,
    }
    codeMap.set(code, result)

    return result
  }

  const ast = parser(code)
  const body = ast.program.body

  for (const node of body) {
    try {
      if (!onlyExports && isImportDeclaration(node)) {
        const specifiers = node.specifiers
        const source = node.source.value
        imports.push(...specifiers.map((specifier) => {
          if (isImportDefaultSpecifier(specifier)) {
            return {
              name: specifier.local.name,
              type: 'default',
              source,
            }
          }
          else if (isImportSpecifier(specifier)) {
            const alias = specifier.local.name
            return {
              name: (specifier.imported as any).name,
              alias,
              source,
            }
          }
          return false
        }).filter(Boolean) as ImportType[])
      }
      else if (isExportNamedDeclaration(node)) {
        if (isFunctionDeclaration(node.declaration) || isTSDeclareFunction(node.declaration)) {
          const name = node.declaration.id?.name || ''

          const params = node.declaration.params.map(p => code.slice(p.start!, p.end!)).join(', ')
          const returnType = node.declaration.returnType ? code.slice(node.declaration.returnType.start! + 2, node.declaration.returnType.end!) : ''
          // 如果exports中存在同名，可能是函数的重载
          const hasTarget = exports.find(i => i.name === name)
          if (!hasTarget) {
            exports.push({
              name,
              params,
              returnType,
              type: ['FunctionDeclaration'],
            })
          }
          else {
            hasTarget.params = `${hasTarget.params} | ${params}`
            hasTarget.returnType = `${hasTarget.returnType} | ${returnType}`
          }
        }
        else if (isClassDeclaration(node.declaration)) {
          const name = node.declaration.id!.name
          const returnType = code.slice(node.declaration.start!, node.declaration.end!)
          exports.push({
            name,
            returnType,
            type: ['ClassDeclaration'],
          })
        }
        else if (isVariableDeclaration(node.declaration)) {
          const declaration = (node as any)?.declaration?.declarations?.[0]
          const name = declaration.id?.name
          if (!name)
            continue
          const init = (node as any)?.declaration?.declarations?.[0]?.init

          if (isIdentifier(init)) {
            // 变量
            exports.push({
              name,
              type: ['Identifier'],
            })
          }
          else if (isArrowFunctionExpression(init)) {
            const params = init.params.map(p => code.slice(p.start!, p.end!)).join(', ')
            const returnType = init.returnType ? code.slice(init.returnType.start!, init.returnType.end!) : ''
            exports.push({
              name,
              type: ['ArrowFunctionExpression'],
              params,
              returnType,
            })
          }
          else if (init === null && declaration.id.typeAnnotation) {
            const type = declaration.id?.typeAnnotation.typeAnnotation?.type
            if (!type)
              continue
            exports.push({
              name,
              type,
              returnType: code.slice(node.start!, node.end!),
            })
          }
          else {
            exports.push({
              name,
              type: [init.type],
              returnType: code.slice(init.start!, init.end!),
            })
          }
        }
        else if (isVariableDeclarator(node.declaration)) {
          // debugger
        }
        else if (isTSInterfaceDeclaration(node.declaration)) {
          const name = node.declaration.id.name
          const returnType = code.slice(node.declaration.start!, node.declaration.end!)
          exports.push({
            name,
            returnType,
            type: ['TSInterfaceDeclaration'],
          })
        }
        else if (isTSTypeAliasDeclaration(node.declaration)) {
          const name = node.declaration.id.name
          const returnType = code.slice(node.declaration.start!, node.declaration.end!)
          exports.push({
            name,
            returnType,
            type: ['TSTypeAliasDeclaration'],
          })
        }
        else if (isTSEnumDeclaration(node.declaration)) {
          const name = node.declaration.id.name
          const returnType = code.slice(node.declaration.start!, node.declaration.end!)
          exports.push({
            name,
            returnType,
            type: ['TSEnumDeclaration'],
          })
        }
        else if (node.specifiers) {
          exports.push(...node.specifiers.map((specifier) => {
            if (isExportSpecifier(specifier)) {
              const name = specifier.local.name
              const alias = (specifier as any).exported?.name
              const source = node?.source?.value
              return {
                name,
                alias,
                type: ['Identifier'],
                source,
              }
            }
            return false
          }).filter(Boolean) as ExportType[])
        }
      }
      else if (isExportDefaultDeclaration(node)) {
        if (isFunctionDeclaration(node.declaration)) {
          const name = node.declaration.id?.name || ''
          const params = node.declaration.params.map(p => code.slice(p.start!, p.end!)).join(', ')
          const returnType = node.declaration.returnType ? code.slice(node.declaration.returnType.start!, node.declaration.returnType.end!) : ''
          exports.push({
            name,
            params,
            returnType,
            type: ['Function', 'default'],
          })
        }
        else if (isArrowFunctionExpression(node.declaration)) {
          const name = (node as any).declaration.id?.name
          const params = node.declaration.params.map(p => code.slice(p.start!, p.end!)).join(', ')
          const returnType = node.declaration.returnType ? code.slice(node.declaration.returnType.start!, node.declaration.returnType.end!) : ''
          exports.push({
            name,
            params,
            returnType,
            type: ['ArrowFunctionExpression', 'default'],
          })
        }
        else if (isClassDeclaration(node.declaration)) {
          const name = node.declaration.id!.name
          const returnType = code.slice(node.declaration.start!, node.declaration.end!)
          exports.push({
            name,
            returnType,
            type: ['TSEnumDeclaration', 'default'],
          })
        }
        else if (isIdentifier(node.declaration)) {
          const name = node.declaration.name
          exports.push({
            name,
            type: ['Identifier', 'default'],
          })
        }
      }
      else if (isExpressionStatement(node) && isAssignmentExpression(node.expression) && isMemberExpression(node.expression.left) && isIdentifier(node.expression.left.object) && node.expression.left.object.name === 'module') {
        if (isObjectExpression(node.expression.right)) {
          if (isObjectProperty(node.expression.right.properties[0])) {
            if (isIdentifier(node.expression.right.properties[0].key)) {
              const name = node.expression.right.properties[0].key.name
              exports.push({
                name,
                type: ['Identifier', 'require'],
              })
            }
          }
        }
      }
      else if (isFunctionDeclaration(node)) {
        const name = node?.id?.name || ''
        const params = node.params.map(p => code.slice(p.start!, p.end!)).join(', ')
        const returnType = node.returnType ? code.slice(node.returnType.start!, node.returnType.end!) : ''
        scoped.push({
          name,
          params,
          returnType,
          type: 'FunctionDeclaration',
          raw: code.slice(node.start!, node.end!),
        })
      }
      else if (isVariableDeclarator(node)) {
        const declaration = (node as any).declarations?.[0]
        if (!declaration)
          continue
        const name = declaration.id.name
        const init = declaration.init
        const type = init.type
        if (isArrowFunctionExpression(init)) {
          const params = init.params.map(p => code.slice(p.start!, p.end!)).join(', ')
          const returnType = init.returnType ? code.slice(init.returnType.start!, init.returnType.end!) : ''
          scoped.push({
            name,
            returnType,
            params,
            type,
            raw: code.slice((node as any).start!, (node as any).end!),
          })
        }
        else if (isIdentifier(init)) {
          const alias = init.name
          scoped.push({
            name,
            alias,
            type,
          })
        }
        else {
          scoped.push({
            name,
            returnType: code.slice(init.start, init.end),
            type,
            raw: code.slice((node as any).start!, (node as any).end!),
          })
        }
      }
      else if (isExportAllDeclaration(node)) {
        const _exports = (await getModule(node.source.value, false, _moduleFolder, url))!.exports
        if (_exports)
          exports.push(..._exports)
      }
      else if (isClassDeclaration(node)) {
        const name = node.id!.name || ''
        scoped.push({
          name,
          type: 'ClassDeclaration',
          returnType: code.slice(node.start!, node.end!),
          raw: code.slice(node.start!, node.end!),
        })
      }
      else if (isVariableDeclaration(node)) {
        const name = (node as any).declarations[0].id.name
        const returnType = code.slice(node.declarations[0].start!, node.declarations[0].end!)
        scoped.push({
          name,
          returnType,
          type: node.type,
          raw: code.slice(node.start!, node.end!),
        })
      }
      else if (isTSTypeAliasDeclaration(node)) {
        const name = node.id.name
        const optionsType = code.slice(node.start!, node.end!)
        const t = scoped.find(i => i.name === name)
        if (t) {
          if (t.optionsTypes)
            t.optionsTypes.push(optionsType)
          else
            t.optionsTypes = [optionsType]
        }
        else {
          scoped.push({
            name,
            optionsTypes: [optionsType],
            type: 'TSTypeAliasDeclaration',
          })
        }
      }
      else if (!onlyExports && isTSInterfaceDeclaration(node)) {
        const name = node.id.name
        const optionsType = code.slice(node.start!, node.end!)
        const t = scoped.find(i => i.name === name)
        if (t) {
          if (t.optionsTypes)
            t.optionsTypes.push(optionsType)
          else
            t.optionsTypes = [optionsType]
        }
        else {
          scoped.push({
            name,
            optionsTypes: [optionsType],
            type: 'TSInterfaceDeclaration',
          })
        }
      }
      else if (!onlyExports && isTSModuleDeclaration(node)) {
        (node as any).body.body?.forEach((item: any) => {
          if (isExportNamedDeclaration(item)) {
            const de = (item as any)?.declaration
            if (!de)
              return
            if (isVariableDeclarator(de) || isVariableDeclaration(de) || isTSEnumDeclaration(de) || isTSTypeAliasDeclaration(de)) {
              const name = (de as any)?.declarations?.[0]?.id?.name
              if (!name)
                return
              const returnType = code.slice(de.start!, de.end!)
              exports.push({
                name,
                returnType,
                type: ['Identifier'],
              })
            }
            else if (isTSInterfaceDeclaration(de) || isTSModuleDeclaration(de)) {
              const name = (de as any).id?.name
              if (!name)
                return
              const returnType = code.slice(de.start!, de.end!)
              exports.push({
                name,
                returnType,
                type: ['Identifier'],
              })
            }
            else if (isClassDeclaration(de)) {
              const name = de?.id?.name
              if (!name)
                return
              const returnType = code.slice(de.start!, de.end!)
              exports.push({
                name,
                returnType,
                type: ['ClassDeclaration'],
              })
            }
            else {
              // debugger
            }
          }
        })
      }
      else if (!onlyExports && isTSDeclareFunction(node)) {
        const name = node?.id?.name || ''
        const params = node.params.map(p => code.slice(p.start!, p.end!)).join(', ')
        const returnType = node.returnType ? code.slice(node.returnType.start!, node.returnType.end!) : ''
        const t = scoped.find(i => i.name === name)
        if (t) {
          t.params = params
          t.returnType = returnType
          t.type = 'FunctionDeclaration'
        }
        else {
          scoped.push({
            name,
            params,
            returnType,
            type: 'FunctionDeclaration',
            raw: code.slice(node.start!, node.end!),
          })
        }
      }
    }
    catch (error) {
      // debugger
    }
  }
  exports = await Promise.all(exports.map(async (item) => {
    const result = await findTarget(scoped, imports, item.name, moduleFolder, url) || item

    if (item.alias) {
      result.returnType = result.returnType?.replace(result.name, item.alias) || ''
      result.name = item.alias
    }
    return result
  })) as ExportType[]

  const result = {
    exports,
    imports,
    scoped,
  }

  codeMap.set(code, result)
  return result
}

async function findTarget(scoped: ScopedType[], imports: ImportType[], name: string, moduleFolder?: string, currentUrl?: string) {
  const target = scoped.find(s => s.name === name)
  if (target && target.type !== 'Identifier')
    return target

  if (target)
    return findTarget(scoped, imports, target.alias || target.name, moduleFolder, currentUrl)

  const importTarget = imports.find(i => (i.alias || i.name) === name)
  if (importTarget) {
    const module = await getModule(importTarget.source, false, moduleFolder, currentUrl)
    if (!module)
      return target
    const { exports } = module
    const t = importTarget?.type === 'default'
      ? exports.find((e: any) => e.type.includes('default'))
      : exports.find((e: any) => (e.alias || e.name) === importTarget.name)
    return t
  }
}
