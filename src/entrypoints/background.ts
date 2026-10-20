import { browser } from 'wxt/browser'
import { getConnectedOrigins, syncContentScripts } from '../platform/connect'
import { createBrowserTabApi } from '../platform/browserTabs'
import { runImport } from '../platform/importJob'
import { isTrustedOrigin } from '../platform/trust'

/** Порт могли закрыть (страница ушла или перезагрузилась) — отправка в него бросает исключение. */
function safePost(port: { postMessage: (m: unknown) => void }, message: unknown) {
  try {
    port.postMessage(message)
  }
  catch { /* порт закрыт — отправлять некому */ }
}

export default defineBackground(() => {
  // Вкладки для запасного пути при проверке («капче») на площадке — см. platform/captchaTab.ts
  const tabs = createBrowserTabApi()

  browser.runtime.onInstalled.addListener(() => void syncContentScripts())
  browser.runtime.onStartup.addListener(() => void syncContentScripts())

  // Порт на одно задание импорта: content script на странице платформы <-> этот воркер.
  browser.runtime.onConnect.addListener((port) => {
    if (port.name !== 'etown-import') return

    const tabId = port.sender?.tab?.id
    let origin: string | null = null
    try {
      origin = port.sender?.url ? new URL(port.sender.url).origin : null
    }
    catch { /* некорректный URL отправителя — отклоняем ниже */ }

    // Принимаем задания только от доверенных страниц платформы; чужие порты закрываем.
    const trusted = (async () => origin !== null && tabId !== undefined && isTrustedOrigin(origin, await getConnectedOrigins()))()

    let cancel: (() => void) | null = null

    port.onMessage.addListener(async (msg: { type?: string, requestId?: string, url?: string }) => {
      if (!await trusted || tabId === undefined) return port.disconnect()

      if (msg.type === 'import' && typeof msg.requestId === 'string' && typeof msg.url === 'string') {
        cancel = runImport(tabId, msg.requestId, msg.url, out => safePost(port, out), { tabs })
      }
      else if (msg.type === 'cancel') {
        cancel?.()
      }
    })
    port.onDisconnect.addListener(() => cancel?.())
  })
})
