# PhotoMap

Небольшое приложение, которое раскладывает ваши фотографии по карте. Координаты и направление съёмки (азимут по компасу) читаются прямо из EXIF, так что у каждого фото появляется метка, которая показывает, куда была направлена камера.

Сделано на [Tauri 2](https://v2.tauri.app/).

[English version →](README.md)

## Что умеет

- **Импорт папок** — перетащите их в окно или выберите через диалог. Файлы без GPS пропускаются.
- **Подложки** — OpenStreetMap, Яндекс (схема / спутник) и Google (схема / спутник / гибрид).
- **Конусы направления** — если в фото есть `GPSImgDirection`, метка показывает сектор обзора полупрозрачным клином. У фото без азимута просто точка.
- **Двусторонняя связь** — клик по метке прокручивает боковую панель до этого фото; клик по фото в панели двигает карту к нему.
- **Кластеризация** для больших альбомов, поиск, фильтр по альбому и сортировка по дате/имени.
- **Просмотр** — двойной клик открывает фото на весь экран с данными из EXIF.
- **Экспорт** — KML, GeoJSON и PNG-снимок текущего вида карты (с легендой по альбомам).
- **Material You** с выбором акцентного цвета и светлой/тёмной/системной темой.
- Интерфейс на **русском и английском**.
- **Автообновление** — проверяет новые версии при старте и ставит их после подтверждения.
- **Подписи и копирование** — показ названий фото на карте и в экспорте; правый клик по фото копирует координаты или ссылку на Google Maps; снимок можно скопировать в буфер.

## Скриншоты

| Фото на карте с направлением | Настройки |
| --- | --- |
| ![Фото на карте](docs/screenshots/map.png) | ![Настройки](docs/screenshots/settings.png) |

## Веб-версия

Есть и браузерная версия, которая работает целиком на вашем устройстве: **[skibidius.github.io/PhotoMap](https://skibidius.github.io/PhotoMap/)**.

Интерфейс тот же, EXIF читается локально через [exifr](https://github.com/MikeKovarik/exifr) — фотографии никуда не загружаются. Перетащите папку или нажмите **«Импорт»**. KML и GeoJSON экспортируются всегда; для PNG-снимка нужны тайлы с CORS, поэтому используйте OpenStreetMap или OpenTopoMap (Google и Яндекс не дают прочитать canvas — приложение предупредит).

Локально: `npm run dev:web` (сервер на порту 5174) или `npm run build:web` (сборка в `dist-web/`). Каждый пуш в `main` публикует её на GitHub Pages через `.github/workflows/pages.yml`.

## Скачать

Готовые сборки — на странице [Releases](../../releases). Для Windows — `.msi` / `.exe`, для macOS — `.dmg` (Intel и Apple Silicon), для Linux — `.deb` и AppImage.

> macOS: приложение не подписано (no notarization), поэтому Gatekeeper может
> ругаться. Если видите «приложение повреждено» — снимите карантинный флаг:
> `xattr -d com.apple.quarantine /Applications/PhotoMap.app`

## Запуск из исходников

Нужны Node.js 20+ и свежий Rust.

```bash
npm install
npm run tauri dev
```

На Linux дополнительно понадобятся системные библиотеки Tauri (`libwebkit2gtk-4.1-dev`, `libgtk-3-dev`, `libayatana-appindicator3-dev`, `librsvg2-dev`).

## Локальная сборка

Минуты GitHub Actions не нужны — собирайте каждую ОС на этой же ОС (macOS умеет обе архитектуры Mac, но не соберёт установщики для Windows/Linux).

```bash
./scripts/build-local.sh
```

Или вручную:

```bash
npm install
npm run tauri build
```

Установщики появятся в `src-tauri/target/release/bundle/`: `dmg/` и `macos/` на macOS, `msi/` и `nsis/` на Windows, `deb/`, `rpm/` и `appimage/` на Linux.

### Подпись и публикация без Actions

Апдейтер принимает только подписанные артефакты. Ключ лежит в `~/.tauri/photomap.key`:

```bash
export TAURI_SIGNING_PRIVATE_KEY="$(cat ~/.tauri/photomap.key)"
npm run tauri build
```

В Windows PowerShell: `$env:TAURI_SIGNING_PRIVATE_KEY = Get-Content "$HOME\.tauri\photomap.key" -Raw`.

Затем опубликуйте релиз и соберите манифест обновления:

```bash
gh release create v0.1.5 --title "PhotoMap v0.1.5" --notes "Local build"
gh release upload v0.1.5 $(find src-tauri/target/release/bundle -type f \
  \( -name '*.dmg' -o -name '*.msi' -o -name '*-setup.exe' -o -name '*.deb' \
  -o -name '*.rpm' -o -name '*.AppImage' -o -name '*.app.tar.gz' -o -name '*.sig' \))
python3 scripts/make_latest.py --repo skibidius/PhotoMap --tag v0.1.5 --version 0.1.5
gh release upload v0.1.5 src-tauri/target/release/bundle/latest.json
```

## Как собрать релиз

Релизы собираются автоматически через GitHub Actions. Поднимите `version` в `src-tauri/tauri.conf.json`, затем:

```bash
git tag v0.1.0
git push origin v0.1.0
```

Workflow соберёт инсталляторы для Windows, macOS (Intel + Apple Silicon) и Linux и автоматически выложит их в Releases.

## Примечания

- Координаты берутся из стандартных GPS-тегов EXIF, направление — из `GPSImgDirection` / `GPSImgDirectionRef` (магнитные значения используются как есть).
- Предпросмотр HEIC/HEIF работает на macOS. На Windows и Linux бэкенд их не декодирует — вместо миниатюры будет заглушка, но координаты импортируются нормально.
- Тайлы Google и Яндекса используются как есть, с указанием источника. Если будете продавать это приложение, сверьтесь с их условиями.

## Лицензия

MIT — см. [LICENSE](LICENSE).
