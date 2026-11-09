import { writeFile, unlink, stat } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'

/** 只序列化已完成的语义识别结论，不将未知状态降级为 false。 */
export async function writeManifest(directory, decision) {
  if (!['true', 'false', 'unknown', 'failed'].includes(decision)) {
    throw new Error('decision must be true, false, unknown or failed')
  }
  const root = resolve(directory)
  if (!(await stat(join(root, 'index.html'))).isFile()) throw new Error('index.html missing')
  const target = join(root, 'mini_tool.json')
  // 先删除旧标记（也避免沿旧符号链接写到产物目录外）。
  try { await unlink(target) } catch (error) { if (error.code !== 'ENOENT') throw error }
  if (decision === 'unknown' || decision === 'failed') return null
  const value = decision === 'true'
  await writeFile(target, JSON.stringify({ is_high_consumption_scene: value }) + '\n', { flag: 'wx' })
  return value
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [, , directory, decision] = process.argv
  try {
    if (!directory) throw new Error('usage: write_manifest.mjs <artifact-dir> <true|false|unknown|failed>')
    const result = await writeManifest(directory, decision)
    console.log(result === null ? '识别未完成：已清除旧标记，沿原打包流程。' : `mini_tool.json: ${result}`)
  } catch (error) { console.error(error.message); process.exitCode = 1 }
}
