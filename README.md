# sitebill-realtor-chrome-extension

Браузерное расширение (Manifest V3, WXT + TypeScript): импорт объявления по ссылке с Авито, ЦИАН, Домклик,
Яндекс.Недвижимости и Юлы в платформу Sitebill/Etown.

Расширение только **извлекает данные** и отдаёт нормализованный `ImportedListing`. Маппинг на поля объявления и
сохранение делает платформа под сессией пользователя; учётных данных в расширении нет.

## Разработка

```bash
npm install
npm run dev        # сборка с автообновлением, открывает отдельный Chrome
npm run build      # .output/chrome-mv3
npm test           # vitest
npm run typecheck
```

Установка вручную: `chrome://extensions` → «Режим разработчика» → «Загрузить распакованное» → `.output/chrome-mv3`.

## Структура

- `src/shared/protocol.ts` — контракт (`ImportedListing`, сообщения моста). Копия типов — в платформе:
  `apps/web/app/types/listingImport.ts`; `PROTOCOL_VERSION` держать одинаковым.
- `src/sources/<площадка>/` — адаптеры; `registry.ts` — единый список и allowlist хостов
  (из него же строятся `host_permissions`).
- `src/platform/` — доверенные сайты (`trust.ts`), подключение домена (`connect.ts`), задание импорта (`importJob.ts`).
- `src/entrypoints/` — `background` (воркер), `platform.content` (мост на страницах платформы), `popup`.

## Как подключается сайт платформы

Известные зоны (`*.etownpro.ru`, `*.sitebill.site`, localhost) подключены статически. Домен тенанта пользователь
подключает в popup кнопкой «Подключить этот сайт»: запрос разрешения на origin → проверка
`/.well-known/etown-extension.json` → динамическая регистрация content script.

## Добавление площадки

1. `src/sources/<id>/index.ts` — `SourceAdapter` (`hosts`, `matchUrl`, `load`).
2. Добавить в `ADAPTERS` (`registry.ts`) и в тип `SourceId`.
3. Фикстуры страниц и тесты `extract/normalize`.

## Тестовые данные

`tests/fixtures/` — **обезличенные выдержки** из страниц площадок: структура и имена полей настоящие, а адреса, тексты и фото
заменены, идентификаторы объявлений вымышлены, контакты и сведения о продавцах удалены. Страницы проверки («капчи») — упрощённые
заглушки с теми же признаками. Добавляя фикстуру, не кладите в репозиторий сохранённые страницы целиком: в них бывают IP, cookie,
токены и персональные данные.
