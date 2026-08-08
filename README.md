# Bitscrawl

Online, többjátékos pixel art rajzolós-kitalálós játék korai prototípusa.

## Jelenlegi állapot

- React + TypeScript + Vite kliens
- Supabase kapcsolat modern publishable kulccsal
- valódi, 2–6 fős online várószobák
- hatkarakteres szobakód és megosztható meghívó link
- valós időben frissülő játékoslista
- legalább 2 főnél, kizárólag a host által indítható meccs
- valós idejű várószoba → játék állapotváltás
- szerver által kiosztott rajzoló és három titkos szólehetőség
- csak a rajzoló számára látható szóválasztás
- host által kapcsolható egyszemélyes teszt mód
- 32×32-as HTML Canvas ceruzával, radírral és nyolcszínű palettával
- szerver által ellenőrzött, változásalapú élő pixelrajzolás
- valós idejű chat és szerveroldali, ékezetfüggetlen megfejtés-ellenőrzés
- szerver által felügyelt 90 másodperces köridő és gyors, 15 másodperces tesztidő
- szerveroldali, gyorsaságalapú pontozás
- játékosonként három rajz, automatikus körváltás és végeredmény
- új játék indítása ugyanazzal a társasággal
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
