import type { OutputChannel } from 'vscode'
let channel: OutputChannel | null = null
let useVscode = false
let enabled = false
try {
  // lazy require to avoid errors in test/non-vscode environments
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const vscode = require('vscode') as typeof import('vscode')
  if (vscode && vscode.window && typeof vscode.window.createOutputChannel === 'function') {
    channel = vscode.window.createOutputChannel('export-what')
    useVscode = true
  }
}
catch (e) {
  // not running inside vscode
}

export function debug(...args: any[]) {
  if (!enabled)
    return
  if (useVscode && channel)
    channel.appendLine(['[debug]', ...args].join(' '))
  else
    console.debug('[export-what]', ...args)
}

export function info(...args: any[]) {
  if (useVscode && channel)
    channel.appendLine(['[info]', ...args].join(' '))
  else
    console.info('[export-what]', ...args)
}

export function error(...args: any[]) {
  if (useVscode && channel)
    channel.appendLine(['[error]', ...args].join(' '))
  else
    console.error('[export-what]', ...args)
}

export function dispose() {
  if (channel)
    channel.dispose()
}

export function setEnabled(v: boolean) {
  enabled = !!v
}
