import { defineConfig } from 'wxt'
import { ALL_SOURCE_HOSTS } from './src/sources/registry'

// Хосты площадок берутся из реестра адаптеров — единый источник правды:
// добавил адаптер → host_permissions обновились сами.
export default defineConfig({
  srcDir: 'src',
  manifest: {
    name: 'Etown — импорт объявлений',
    description: 'Импорт объявления с Авито, ЦИАН, Домклик и Яндекс.Недвижимости в вашу платформу по ссылке',
    permissions: ['storage', 'scripting', 'activeTab'],
    host_permissions: ALL_SOURCE_HOSTS.flatMap(h => [`https://${h}/*`, `https://*.${h}/*`]),
    // Домены платформы у тенантов произвольные — запрашиваются у пользователя при подключении.
    optional_host_permissions: ['https://*/*', 'http://localhost/*', 'http://127.0.0.1/*'],
  },
})
