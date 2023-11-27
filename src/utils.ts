import { resolve } from 'node:path'
import fs from 'node:fs'
import { workspace } from 'vscode'
import { isArray, useJSONParse } from 'lazy-js-utils'
import { getCurrentFileUrl } from '@vscode-use/utils'

const LOCAL_URL_REG = /^(\.|\/|\@\/)/

const projectRoot = workspace.workspaceFolders![0].uri.path
const suffix = ['.js', '.ts']
export let alias: any = null

if (!alias)
  getAlias().then(data => alias = data)

export function toAbsoluteUrl(url: string) {
  // 判断是否是node_modules or 相对路径
  if (LOCAL_URL_REG.test(url)) {
    const currentFileUrl = getCurrentFileUrl()

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
      ? resolve(projectRoot, '.', url)
      : resolve(currentFileUrl, '..', url)
    const isEnds = suffix.some(s => result.endsWith(s))
    if (isEnds && fs.existsSync(result))
      return result

    for (const s of suffix) {
      const child = resolve(result, `index${s}`)
      if (fs.existsSync(child))
        return child
    }
  }
  else {
    const node_modules = resolve(projectRoot, '.', 'node_modules')
    const moduleFolder = resolve(node_modules, '.', url)
    if (moduleFolder) {
      const url = resolve(moduleFolder, '.', 'package.json')
      const pkg = JSON.parse(fs.readFileSync(url, 'utf-8'))
      const main = pkg.types || pkg.module || pkg.main
      return resolve(moduleFolder, '.', main)
    }
  }
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

async function getAlias() {
  let configUrl = ''
  if (fs.existsSync(resolve(projectRoot, 'tsconfig.json')))
    configUrl = resolve(projectRoot, 'tsconfig.json')
  else if (fs.existsSync(resolve(projectRoot, 'jsconfig.json')))
    configUrl = resolve(projectRoot, 'jsconfig.json')

  if (!configUrl)
    return

  const _config = useJSONParse(await fs.promises.readFile(configUrl, 'utf-8'))
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
  const stats = fs.statSync(url)
  return stats.isDirectory()
}
