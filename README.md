# Bitscrawl

Online, többjátékos pixel art rajzolós-kitalálós játék korai prototípusa.

Nyilvános tesztváltozat: **https://bitscrawl.pages.dev/**

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
- egyszemélyes teszt módban korlátlan rajzidő
- 32×32-as HTML Canvas ceruzával, radírral és nyolcszínű palettával
- szerver által ellenőrzött, változásalapú élő pixelrajzolás
- valós idejű chat és szerveroldali, ékezetfüggetlen megfejtés-ellenőrzés
- szerver által felügyelt 90 másodperces köridő és gyors, 15 másodperces tesztidő
- szerveroldali, gyorsaságalapú pontozás
- játékosonként három rajz, automatikus körváltás és végeredmény
- új játék indítása ugyanazzal a társasággal
- automatikus visszatérés oldalfrissítés után és rövid kimaradás utáni újraszinkronizálás
- kiesett host automatikus átadása és kiesett rajzoló körének biztonságos lezárása
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

Windows alatt a `start-bitscrawl.cmd` fájlra is duplán kattinthatsz. A böngésző
automatikusan megnyílik; a parancsablakot hagyd nyitva játék közben. Az ugyanazon
a Wi-Fi-hálózaton lévő telefon jelenleg a `http://192.168.0.112:5173/` címen éri
el a játékot.

## Nyilvános kihelyezés

A frontend a `bitscrawl` nevű ingyenes Cloudflare Pages projektben fut. A Vite
build a helyi, Git által figyelmen kívül hagyott `.env.local` fájlból olvassa a
Supabase URL-t és a publishable kulcsot. `service_role` vagy más titkos kulcsot
tilos a kliensoldali buildbe tenni.

Első használatkor jelentkezz be a Cloudflare-fiókba:

```bash
npx wrangler login
```

Ezután az aktuális production build kihelyezése:

```bash
npm run deploy
```

A parancs előbb elkészíti a `dist` mappát, majd feltölti a `main` production
ágra. A publikus cím HTTPS-t használ, és nem szükséges hozzá saját domain.

## Ellenőrzés

```bash
npm run lint
npm run build
```

A kapcsolat-helyreállítás kétjátékos integrációs próbája fejlesztői ellenőrzéshez:

```bash
node --env-file=.env.local scripts/verify-connection-recovery.mjs
```

A teszt körülbelül egy percig fut: két külön játékost hoz létre, majd ellenőrzi
a 45 másodperces türelmi időt, a hostátadást és a következő kör indulását.

A multiplayer-jogosultságok és az egyszemélyes korlátlan idő ellenőrzése:

```bash
node --env-file=.env.local scripts/verify-multiplayer-security.mjs
```

Az adatbázis változásai a `supabase/migrations` mappában találhatók.
