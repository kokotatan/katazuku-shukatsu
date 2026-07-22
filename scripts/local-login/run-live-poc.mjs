import { execFile, spawn } from 'node:child_process'
import { access, mkdir, open } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const repoRoot = fileURLToPath(new URL('../..', import.meta.url))
const logDir = join(repoRoot, 'logs', 'local-model')
const modelPath = process.env.LOCAL_LOGIN_MODEL_PATH || join(logDir, 'Qwen3VL-4B-Instruct-Q4_K_M.gguf')
const llamaServer = process.env.LOCAL_LOGIN_LLAMA_SERVER || join(
  process.env.LOCALAPPDATA || '',
  'Microsoft', 'WinGet', 'Packages',
  'ggml.llamacpp_Microsoft.Winget.Source_8wekyb3d8bbwe',
  'llama-server.exe'
)
const port = Number(process.env.LOCAL_LOGIN_MODEL_PORT || 18080)

async function waitForModel(serverProcess) {
  for (let attempt = 0; attempt < 240; attempt += 1) {
    if (serverProcess.exitCode != null) throw new Error(`llama-serverが終了しました: ${serverProcess.exitCode}`)
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1000) })
      if (response.ok) return
    } catch {}
    await delay(500)
  }
  throw new Error('ローカルモデルの起動がタイムアウトしました')
}

async function main() {
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('LOCAL_LOGIN_MODEL_PORTが不正です')
  await access(modelPath)
  await access(llamaServer)
  await mkdir(logDir, { recursive: true })
  const stdoutHandle = await open(join(logDir, 'llama-server.stdout.log'), 'a')
  const stderrHandle = await open(join(logDir, 'llama-server.stderr.log'), 'a')
  const server = spawn(llamaServer, [
    '--offline',
    '--host', '127.0.0.1',
    '--port', String(port),
    '-m', modelPath,
    '-ngl', '99',
    '-c', '4096'
  ], {
    cwd: repoRoot,
    windowsHide: true,
    stdio: ['ignore', stdoutHandle.fd, stderrHandle.fd]
  })
  try {
    await waitForModel(server)
    const result = await execFileAsync(process.execPath, ['scripts/local-login/check.mjs'], {
      cwd: repoRoot,
      encoding: 'utf8',
      windowsHide: true,
      timeout: 180000,
      maxBuffer: 1024 * 1024,
      env: { ...process.env, LOCAL_LOGIN_MODEL_URL: `http://127.0.0.1:${port}` }
    })
    process.stdout.write(result.stdout)
  } finally {
    server.kill()
    await stdoutHandle.close()
    await stderrHandle.close()
  }
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`)
  process.exitCode = 1
})
