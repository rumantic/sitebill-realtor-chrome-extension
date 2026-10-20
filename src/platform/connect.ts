import { browser } from 'wxt/browser'
import { PROTOCOL_VERSION, type PlatformManifest } from '../shared/protocol'
import { normalizePlatformOrigin, originToPattern } from './trust'

const STORAGE_KEY = 'connectedOrigins'
const SCRIPT_ID = 'etown-platform'
const SCRIPT_FILE = '/content-scripts/platform.js'

export async function getConnectedOrigins(): Promise<string[]> {
  const data = await browser.storage.sync.get(STORAGE_KEY)
  const list = data[STORAGE_KEY]
  return Array.isArray(list) ? list.filter((o): o is string => typeof o === 'string') : []
}

async function saveConnectedOrigins(list: string[]): Promise<void> {
  await browser.storage.sync.set({ [STORAGE_KEY]: [...new Set(list)] })
}

/** Проверка, что на origin действительно платформа (а не произвольный сайт). */
export async function verifyPlatform(origin: string): Promise<boolean> {
  try {
    const res = await fetch(`${origin}/.well-known/etown-extension.json`, { credentials: 'omit', cache: 'no-store' })
    if (!res.ok) return false
    const data = await res.json() as Partial<PlatformManifest>
    return data.platform === 'etown' && typeof data.protocol === 'number' && data.protocol >= PROTOCOL_VERSION
  }
  catch {
    return false
  }
}

/** Приводит зарегистрированный динамический content script в соответствие со списком подключённых доменов. */
export async function syncContentScripts(): Promise<void> {
  const origins = await getConnectedOrigins()
  const matches = [...new Set(origins.map(originToPattern))]
  const existing = await browser.scripting.getRegisteredContentScripts({ ids: [SCRIPT_ID] })

  if (!matches.length) {
    if (existing.length) await browser.scripting.unregisterContentScripts({ ids: [SCRIPT_ID] })
    return
  }

  const script = {
    id: SCRIPT_ID,
    matches,
    js: [SCRIPT_FILE],
    runAt: 'document_start' as const,
    persistAcrossSessions: true,
  }
  if (existing.length) await browser.scripting.updateContentScripts([script])
  else await browser.scripting.registerContentScripts([script])
}

export type ConnectResult = { ok: true } | { ok: false, reason: 'bad_origin' | 'denied' | 'not_platform' }

/**
 * Подключение сайта. ВАЖНО: вызывать из обработчика клика (нужен user gesture для permissions.request),
 * поэтому запрос разрешения идёт первым, до любых await.
 */
export async function connectOrigin(rawOrigin: string, tabId?: number): Promise<ConnectResult> {
  const origin = normalizePlatformOrigin(rawOrigin)
  if (!origin) return { ok: false, reason: 'bad_origin' }
  const pattern = originToPattern(origin)

  const granted = await browser.permissions.request({ origins: [pattern] })
  if (!granted) return { ok: false, reason: 'denied' }

  if (!await verifyPlatform(origin)) {
    await browser.permissions.remove({ origins: [pattern] })
    return { ok: false, reason: 'not_platform' }
  }

  await saveConnectedOrigins([...await getConnectedOrigins(), origin])
  await syncContentScripts()
  if (tabId !== undefined) {
    // На уже открытой вкладке скрипт сам не появится до перезагрузки.
    await browser.scripting.executeScript({ target: { tabId }, files: [SCRIPT_FILE] }).catch(() => {})
  }
  return { ok: true }
}

export async function disconnectOrigin(origin: string): Promise<void> {
  const list = (await getConnectedOrigins()).filter(o => o !== origin)
  await saveConnectedOrigins(list)
  await syncContentScripts()
  // Право снимаем, только если другой подключённый origin не делит с ним паттерн (схема + хост).
  const pattern = originToPattern(origin)
  if (!list.some(o => originToPattern(o) === pattern)) {
    await browser.permissions.remove({ origins: [pattern] }).catch(() => {})
  }
}
