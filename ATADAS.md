# Bitscrawl – friss átadó

Frissítve: 2026. október 3.

Ez az egyetlen aktuális átadó. A korábbi package-, audit-, ZIP- és patch-alapú
átadások elavultak és eltávolításra kerültek. Az új beszélgetésben először ezt a
fájlt, utána a `PLAN.txt` elejét és a `README.md` fájlt olvasd el.

## Egyetlen hiteles munkapéldány

- Projekt: `C:\Users\23hun\Documents\Codex\2026-09-22\olvasd-el-teljesen-a-bitscrawl-atadas\work\package-10-live-extras`
- GitHub: `https://github.com/feherlofia895/Bitscrawl.git`
- Aktív ág: `agent/12-color-palette-logo`
- Legutóbbi funkcionális commit az átadáskor: `2526d40` (`Add installable PWA with custom icon`)
- Éles oldal: `https://bitscrawl.pages.dev/`
- Cloudflare Pages projekt: `bitscrawl`, production ág: `main`

A dokumentációs átadás után a pontos HEAD-et mindig a `git log -1 --oneline`
paranccsal ellenőrizd. Ne dolgozz a `work` mappa egy régi `package-*` vagy audit
másolatából; azok nem a jelenlegi források.

## Technikai alap

- React 19 + TypeScript + Vite 8
- Supabase Auth, Postgres, RLS, Realtime és RPC-k
- Cloudflare Pages frontend
- OXLint és Node beépített tesztfuttató
- Környezeti adatok: a Git által figyelmen kívül hagyott `.env.local`

Titkos vagy `service_role` kulcsot soha ne tegyél kliensoldali fájlba, commitba,
átadóba vagy böngészős buildbe. A jelenlegi frontend publishable Supabase kulccsal
működik.

## Jelenlegi termékállapot

- A klasszikus online játék 2–6 játékost, kódos szobát, hostkezelést, szerveroldali
  szókiosztást, köridőt, pontozást, újracsatlakozást és teljes meccsciklust kezel.
- Van külön párhuzamos rajzverseny, heti és havi kihívás, szavazás, archív galéria,
  örökranglista és „A legmenőbbek” dobogós nézet.
- A közösségi rajzfal napi három beküldést, leírást, kedvelést, kommentet és
  kommentkedvelést támogat. Az admin felület képet, kommentet és visszajelzést tud
  moderálni; az admin a képek reakcióinak szerzőit is láthatja.
- A profilok rajzolt avatárt, nyilvános statisztikát, trófeákat és három,
  profillal szinkronizált, legfeljebb 16 színes egyéni palettát kezelnek.
- A Szerkesztőben és mindkét kihívásban elérhető a pipetta, újra, 1×/2×/3× ecset és
  radír, színcsere, kijelölés, mozgatás, 90°-os forgatás, valamint vízszintes és
  függőleges tükrözés.
- A HSL+A színkeverő alapértelmezett fedettsége 100%. Az egyéni paletta alapból
  kiválasztható, színei rendezhetők és törölhetők.
- A Szerkesztő animációs módja legfeljebb három képkockát, hagymahéjat, 1–8 kép/mp
  előnézetet, GIF-exportot és profilonként két privát animációmentést kezel.
- A mobil fejléc, galéria, rajzeszköztár és animációs vezérlés 320–390 px szélességen
  igazítva lett. A fizikai iPhone-próba sikeres.
- A webalkalmazás telepíthető PWA. A beküldött fekete, színes pixelkarom ikon
  iPhone-on helyesen megjelenik. A service worker nem használ offline cache-t:
  navigációkor mindig hálózatról tölti az aktuális klienst.
- Az éles heti kihívás Boszorkány, a havi kihívás Halloween és 128×128-as. A korábbi
  Béka havi kihívás pontjai bekerültek a dicsőségfalba; Vivi korábbi hóemberrajza a
  rajzfalra került felirat nélkül.

## Következő kiemelt feladat: két réteg

A felhasználó első változatként pontosan két layert szeretne. Ez a Szerkesztőben,
a heti kihívásban és a havi kihívásban is legyen használható, mert már két réteg is
nagy segítség a rajzolóknak.

Javasolt v1-határ:

1. Két rögzített sorrendű réteg: alsó és felső.
2. Aktív réteg választása, láthatóság kapcsolása és az aktív réteg külön törlése.
3. Minden módosító rajzeszköz csak az aktív rétegen dolgozik; a pipetta a látható
   kompozitból olvas.
4. A régi egyrétegű mentés az alsó rétegre töltődik, a felső üres marad.
5. A réteges szerkeszthető adat külön, verziózott formában mentődik; galériához,
   nevezéshez, profilképhez és exporthoz továbbra is lapított pixelkép készül.
6. A heti/havi felhővázlat mindkét réteget őrzi, és a szerver méret-, szín- és
   tulajdonos-ellenőrzést végez.
7. Mobilon a rétegváltó kompakt, becsukható panel legyen, ne szűkítse tovább a vásznat.
8. A háromképkockás animáció és a multiplayer rétegei ne kerüljenek az első körbe;
   külön adatmodell- és teljesítményfeladatként folytathatók.

A részletes elfogadási feltételek a `PLAN.txt` elején, a
„KÖVETKEZŐ KIEMELT FEJLESZTÉS – KÉT RÉTEG” részben vannak.

## Fontos adatbázis-megjegyzés

A helyi `20260924113451_allow_editing_own_feed_posts.sql` migráció a meglévő éles
adatbázisban történetileg `20260924113829` verziószámon lett alkalmazva. A helyi
fájlnév a fejlesztési történet miatt maradt meg, a későbbi
`20260925204835_increase_daily_feed_limit_to_three.sql` pedig már felülírja az érintett
publikáló függvényt napi három képre.

Ezt a migrációt ne alkalmazd vakon újra, és production környezeten ne futtass
automatikus migration repairt. Új migráció előtt előbb hasonlítsd össze a helyi és
távoli migrációlistát, majd az eltérést tudatosan kezeld. Tiszta, új adatbázison a
helyi migrációs sor normál sorrendben alkalmazható.

## PWA- és kiadási szabályok

- A manifest: `public/manifest.webmanifest`.
- A service worker: `public/service-worker.js`.
- Az alkalmazásikonok: `public/icons/bitscrawl-app-180.png`, `-192.png`, `-512.png`
  és `bitscrawl-app-maskable-512.png`.
- Ne vezess be offline App Shell cache-t külön multiplayer-verzióegyeztetés nélkül.
- Élesítés előtt legyen sikeres build, lint, releváns tesztek és `git diff --check`.
- Frontend kiadás: `npm run deploy`. Ez buildel, majd a Cloudflare Pages `bitscrawl`
  projekt `main` production ágára tölt.
- A GitHub push és a Cloudflare kiadás két külön lépés; mindkettő állapotát ellenőrizd.
- Dokumentációs-only változást nem kell Cloudflare-re kiadni.

## Helyi indítás és alapellenőrzés

```powershell
npm install
npm run dev
```

Alap átadási ellenőrzés:

```powershell
npm run lint
npm run build
npm run test:editor
npm run test:drawing-safety
npm run test:challenge-rules
npm run test:editor-palettes
npm run test:editor-animation
npm run test:editor-animation-gallery
npm run test:pwa
git diff --check
```

A `package.json` tartalmaz további célzott teszteket a galériához, moderációhoz,
scoreboardhoz, havi ponthoz, köridőhöz és multiplayerhez. A `.env.local`-t igénylő
élő teszteket csak izolált próbaadatokkal futtasd; a létrehozott szobákat és adatokat
a teszt végén takarítsd el.

## Még nyitott ellenőrzések

- Android Chrome és asztali Chrome/Edge PWA-telepítés.
- Korábban telepített PWA automatikus frissülése egy új kiadás után.
- Fizikai telefonon billentyűzetes mezők és hálózatkimaradás utáni folytatás.
- A két réteg implementációja előtt a mentési formátum és az adatbázis-migráció
  részletes, visszafelé kompatibilis megtervezése.
- A production JavaScript jelenleg körülbelül 662 kB tömörítés előtt; a build sikeres,
  de a Vite 500 kB felett kódszétválasztást javasol. Ez nem kiadást blokkoló hiba,
  későbbi teljesítményfeladatként érdemes a nagy nézeteket dinamikusan betölteni.

## Átadáskori ellenőrzési eredmény

2026. október 3-án lefutott mind a 21 helyi, `.env.local` nélküli tesztparancs:
összesen 203 ellenőrzés ment át, hiba és kihagyás nélkül. A TypeScript/Vite production
build, az OXLint és a `git diff --check` szintén sikeres. Ez a dokumentációs kör nem
futtatta újra az élő Supabase-t módosító többjátékos teszteket, és futásidejű kódot
nem változtatott.

## Munkakezdési sorrend az új beszélgetésben

1. `git status --short`, `git log -5 --oneline`, majd az éles oldal és a branch
   egyezésének ellenőrzése.
2. `ATADAS.md`, a `PLAN.txt` eleje és `README.md` elolvasása.
3. A két réteg adatmodelljének megtervezése a meglévő `PixelCanvas`, `DrawingEditor`,
   `WeeklyDraw`, `MonthlyDraw`, `challengeDrafts` és mentési RPC-k alapján.
4. Először kompatibilitási tesztek, utána a statikus Szerkesztő prototípusa.
5. Mobilos próba után heti, majd havi kihívás bekötése.
6. A felhasználó tesztje és külön jóváhagyása előtt ne élesítsd a réteges változatot.
