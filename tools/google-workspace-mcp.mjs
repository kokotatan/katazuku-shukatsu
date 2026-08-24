#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { readGoogleWorkspaceConfig, resolveGoogleWorkspaceConfigPath } from '../src/google-workspace-config.js'

try {
  const configPath = resolveGoogleWorkspaceConfigPath()
  const config = await readGoogleWorkspaceConfig(configPath)

  if (process.argv.includes('--check-config')) {
    console.log(`Google Workspace設定: ok (${configPath})`)
    process.exit(0)
  }

  const bundledUvx = join(homedir(), '.local', 'bin', process.platform === 'win32' ? 'uvx.exe' : 'uvx')
  const command = existsSync(bundledUvx) ? bundledUvx : (process.platform === 'win32' ? 'uvx.exe' : 'uvx')
  const child = spawn(command, [
    'workspace-mcp',
    '--single-user',
    '--tools',
    'gmail',
    'calendar',
    'drive',
    'sheets',
  ], {
    env: {
      ...process.env,
      GOOGLE_OAUTH_CLIENT_ID: config.oauthClientId,
      GOOGLE_OAUTH_CLIENT_SECRET: config.oauthClientSecret,
      USER_GOOGLE_EMAIL: config.accountEmail,
    },
    stdio: 'inherit',
    windowsHide: true,
  })

  child.on('error', (error) => {
    console.error(`google-workspace MCPを起動できません: ${error.message}`)
    console.error('uv/uvxがインストールされているか確認してください。')
    process.exitCode = 1
  })
  child.on('exit', (code) => process.exit(code ?? 1))
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}
