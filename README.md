# Bitscrawl

Online, többjátékos pixel art rajzolós-kitalálós játék közösségi rajzfelületekkel.

Nyilvános változat: **https://bitscrawl.pages.dev/**

## Jelenlegi állapot

- React 19, TypeScript és Vite 8 kliens Supabase háttérrel.
- Valódi, 2–6 fős klasszikus online játék kódos szobákkal, hostkezeléssel,
  szerveroldali, ellenőrzött szóbankkal és célhoz kötött szinonimákkal,
  köridővel, pontozással és újracsatlakozással.
- Párhuzamos rajzverseny közös szóval, névtelen szavazással és összesített
  eredménnyel.
- Heti és havi rajzkihívás menthető vázlatokkal, szavazással, archív galériával,
  Dicsőségfallal és örökranglistával.
- Közösségi rajzfal kedvelésekkel, kommentekkel, kommentkedvelésekkel és
  adminisztrátori moderációval.
- Opcionális profilok rajzolt avatárral, nyilvános statisztikákkal, trófeákkal és
  három szinkronizált egyéni színpalettával.
- Önálló Szerkesztő fejlett rajzeszközökkel, kijelöléssel, transzformációkkal,
  HSL+A színkeverővel, privát mentésekkel és PNG-exporttal.
- Legfeljebb három képkockás animációs mód hagymahéjjal, 1–8 kép/mp előnézettel,
  GIF-exporttal és privát animációmentésekkel.
- Mobilra igazított fontos felületek és saját ikonnal telepíthető PWA.
- RLS-sel védett táblák, ellenőrzött RPC-k és szerveroldali jogosultságvizsgálatok.

## Supabase beállítás

A klasszikus játék vendégként, külön regisztráció nélkül is használható. Ehhez a
Supabase Dashboardon kapcsold be az
**Authentication → Sign In / Providers → Anonymous Sign-Ins** lehetőséget. A
profilokhoz és a közösségi funkciókhoz e-mailes felhasználói fiók használható.

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
automatikusan megnyílik; a parancsablakot hagyd nyitva játék közben. Másik,
ugyanazon a Wi-Fi-hálózaton lévő eszközről a Vite által kiírt `Network` címet
használd, mert a helyi IP-cím hálózatonként változhat.

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

## Telepítés alkalmazásként (PWA)

A nyilvános Bitscrawl kezdőképernyőre vagy asztalra telepíthető, de továbbra is
internetkapcsolatot igényel. A service worker szándékosan nem tárol offline
alkalmazáscsomagot: minden megnyitáskor a hálózatról kéri az aktuális változatot,
így nem keveredik régi kliens az élő multiplayerrel.

- iPhone/iPad Safariban: **Megosztás → Főképernyőhöz adás**.
- Android Chrome-ban: **Menü → Alkalmazás telepítése** vagy **Hozzáadás a
  kezdőképernyőhöz**.
- Asztali Chrome/Edge alatt: a címsor telepítésikonja vagy a böngésző
  **Telepítés** menüpontja.

A Beállítások oldal jelzi, ha a böngésző közvetlen telepítőgombot biztosít, iPhone-on
pedig megmutatja a kézi lépéseket.

## Ellenőrzés

```bash
npm run lint
npm run build
npm run test:editor
npm run test:drawing-safety
npm run test:challenge-rules
npm run test:editor-palettes
npm run test:editor-animation
npm run test:editor-animation-gallery
npm run test:pwa
```

A `package.json` további célzott ellenőrzéseket tartalmaz a galériákhoz,
moderációhoz, pontozáshoz, köridőhöz és multiplayerhez. Élő Supabase-t használó
tesztet csak izolált próbaadattal futtass, majd töröld a létrehozott adatokat.

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

A háromjátékos, kilenckörös teljes meccsszimuláció futtatása:

```bash
npm run test:three-player
```

Az adatbázis változásai a `supabase/migrations` mappában találhatók.

## Adatbázis-migrációk

A helyi és az éles Supabase-migrációtörténetben történeti név- és
verzióeltérések vannak. Production környezetben ne futtass vakon `supabase db push`
vagy általános `migration repair` parancsot. Új adatbázis-módosítás előtt hasonlítsd
össze a helyi és távoli migrációlistát, majd az új migrációt célzottan alkalmazd és
ellenőrizd a jogosultságait.

## Dokumentáció és következő lépések

- Az aktuális fejlesztői átadás az `ATADAS.md` fájlban található.
- A részletes funkcióterv és az elfogadási feltételek a `PLAN.txt` fájlban vannak.
- A következő kisebb fejlesztés a látható PWA-verziófrissítési jelzés és a
  kliensből olvasható buildazonosító.
- A következő kiemelt fejlesztés pontosan két szerkeszthető rajzréteg a statikus
  Szerkesztőben, majd a heti és havi kihívásban.
