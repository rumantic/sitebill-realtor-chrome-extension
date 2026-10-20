import { browser } from 'wxt/browser'
import { connectOrigin, disconnectOrigin, getConnectedOrigins } from '../../platform/connect'
import { isTrustedOrigin, isStaticallyTrusted, normalizePlatformOrigin } from '../../platform/trust'
import { ADAPTERS } from '../../sources/registry'
import './style.css'

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T

const statusEl = $('status')
const connectBtn = $<HTMLButtonElement>('connect')
const errorEl = $('error')
const originsEl = $('origins')
const sourcesEl = $('sources')

const ERRORS: Record<string, string> = {
  bad_origin: 'Этот адрес подключить нельзя (нужен https или localhost).',
  denied: 'Доступ к сайту не выдан.',
  not_platform: 'Этот сайт не похож на платформу: нет /.well-known/etown-extension.json.',
}

function showError(text: string | null) {
  errorEl.hidden = !text
  errorEl.textContent = text ?? ''
}

function li(text: string, action?: HTMLElement): HTMLLIElement {
  const item = document.createElement('li')
  const span = document.createElement('span')
  span.textContent = text
  item.append(span)
  if (action) item.append(action)
  return item
}

async function render() {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true })
  const origin = tab?.url ? normalizePlatformOrigin(tab.url) : null
  const connected = await getConnectedOrigins()

  if (!origin) {
    statusEl.textContent = 'Откройте страницу вашей платформы, чтобы подключить её.'
    connectBtn.hidden = true
  }
  else if (isTrustedOrigin(origin, connected)) {
    statusEl.textContent = `Сайт подключён: ${new URL(origin).host}`
    connectBtn.hidden = true
  }
  else {
    statusEl.textContent = `Сайт ${new URL(origin).host} не подключён.`
    connectBtn.hidden = false
    connectBtn.onclick = async () => {
      showError(null)
      // permissions.request должен идти прямо из обработчика клика — без await до вызова.
      const res = await connectOrigin(origin, tab?.id)
      if (!res.ok) showError(ERRORS[res.reason] ?? 'Не удалось подключить сайт.')
      await render()
    }
  }

  originsEl.replaceChildren()
  if (!connected.length) {
    const empty = li('Нет')
    empty.classList.add('empty')
    originsEl.append(empty)
  }
  for (const o of connected) {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'link'
    btn.textContent = 'Отключить'
    btn.onclick = async () => {
      await disconnectOrigin(o)
      await render()
    }
    originsEl.append(li(new URL(o).host, isStaticallyTrusted(o) ? undefined : btn))
  }
}

for (const a of ADAPTERS) {
  sourcesEl.append(li(a.label, Object.assign(document.createElement('span'), {
    className: 'empty',
    textContent: a.load ? 'готово' : 'скоро',
  })))
}

void render()
