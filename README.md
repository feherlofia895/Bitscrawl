# PixelGuess

Online, többjátékos pixel art rajzolós-kitalálós játék korai prototípusa.

## Jelenlegi állapot

- React + TypeScript + Vite kliens
- Supabase kapcsolat modern publishable kulccsal
- valódi, 2–6 fős online várószobák
- hatkarakteres szobakód és megosztható meghívó link
- valós időben frissülő játékoslista
- RLS-sel védett táblák és ellenőrzött szobaműveletek

## Supabase beállítás

A játékosoknak nem kell fiókot készíteniük. Ehhez a Supabase Dashboardon kapcsold
be az **Authentication → Sign In / Providers → Anonymous Sign-Ins** lehetőséget.

Másold le a környezeti mintafájlt `.env.local` néven, majd töltsd ki a saját
Supabase projekted publishable adataival. Titkos vagy `service_role` kulcsot
soha ne tegyél a böngészős alkalmazásba.

```powershell
Copy-Item .env.example .env.local
```

macOS vagy Linux alatt ugyanez: `cp .env.example .env.local`.

## Helyi indítás

```bash
npm install
npm run dev
```

## Ellenőrzés

```bash
npm run lint
npm run build
```

Az adatbázis változásai a `supabase/migrations` mappában találhatók.
