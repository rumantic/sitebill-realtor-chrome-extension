import { browser } from 'wxt/browser'
import { ADAPTERS } from '../sources/registry'
import { STATIC_PLATFORM_MATCHES } from '../platform/trust'
import {
  BRIDGE_CHANNEL,
  DETECT_ATTRIBUTE,
  PROTOCOL_VERSION,
  type ExtToPage,
  type PageToExt,
} from '../shared/protocol'

/**
 * Мост между страницей платформы и расширением.
 * Подключается статически на известных зонах и динамически — на доменах, подключённых пользователем.
 */
export default defineContentScript({
  matches: STATIC_PLATFORM_MATCHES,
  runAt: 'document_start',
  main() {
    const root = document.documentElement
    // Защита от двойного внедрения (статический + динамический скрипт, executeScript после подключения).
    if (root.hasAttribute(DETECT_ATTRIBUTE)) return
    const version = browser.runtime.getManifest().version
    root.setAttribute(DETECT_ATTRIBUTE, version)

    const ports = new Map<string, chrome.runtime.Port>()

    const toPage = (msg: Omit<ExtToPage, 'channel' | 'protocol' | 'dir'> | ExtToPage) => {
      const full = 'channel' in msg ? msg : { channel: BRIDGE_CHANNEL, protocol: PROTOCOL_VERSION, dir: 'to-page' as const, ...msg }
      window.postMessage(full, location.origin)
    }

    window.addEventListener('message', (event: MessageEvent<PageToExt>) => {
      if (event.source !== window || event.origin !== location.origin) return
      const data = event.data
      if (!data || data.channel !== BRIDGE_CHANNEL || data.dir !== 'to-ext') return
      if (data.protocol !== PROTOCOL_VERSION || typeof data.requestId !== 'string') return

      if (data.type === 'hello') {
        toPage({ type: 'hello_ok', requestId: data.requestId, version, sources: ADAPTERS.map(a => ({ id: a.id, label: a.label })) })
        return
      }

      if (data.type === 'import') {
        if (typeof data.url !== 'string' || data.url.length > 2048 || ports.has(data.requestId)) return
        const port = browser.runtime.connect({ name: 'etown-import' })
        ports.set(data.requestId, port)
        port.onMessage.addListener((msg: ExtToPage) => {
          toPage(msg)
          if (msg.type === 'result' || msg.type === 'error') ports.delete(data.requestId)
        })
        port.onDisconnect.addListener(() => {
          if (ports.delete(data.requestId)) {
            toPage({ type: 'error', requestId: data.requestId, code: 'blocked', message: 'Расширение остановлено' })
          }
        })
        port.postMessage({ type: 'import', requestId: data.requestId, url: data.url })
        return
      }

      if (data.type === 'cancel') {
        ports.get(data.requestId)?.postMessage({ type: 'cancel', requestId: data.requestId })
      }
    })
  },
})
