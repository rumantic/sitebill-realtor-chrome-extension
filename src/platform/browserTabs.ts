import { browser } from 'wxt/browser'
import type { TabApi } from './captchaTab'

/** Реальные вкладки браузера для loadViaTab. Прав `tabs` не требуется: нужны только id и статус загрузки. */
export function createBrowserTabApi(): TabApi {
  return {
    async open(url) {
      const tab = await browser.tabs.create({ url, active: false })
      if (tab.id === undefined) throw new Error('tab without id')
      return tab.id
    },

    async focus(tabId) {
      const tab = await browser.tabs.update(tabId, { active: true })
      if (tab?.windowId !== undefined) await browser.windows.update(tab.windowId, { focused: true }).catch(() => {})
    },

    async status(tabId) {
      try {
        const tab = await browser.tabs.get(tabId)
        return tab.status === 'complete' ? 'complete' : 'loading'
      }
      catch {
        return 'gone'
      }
    },

    async readHtml(tabId) {
      try {
        const [res] = await browser.scripting.executeScript({
          target: { tabId },
          func: () => document.documentElement.outerHTML,
        })
        return typeof res?.result === 'string' ? res.result : null
      }
      catch {
        return null
      }
    },

    async close(tabId) {
      await browser.tabs.remove(tabId)
    },
  }
}
