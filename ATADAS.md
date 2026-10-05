# Bitscrawl – aktuális átadó

Frissítve: 2026. október 4.

Ez az egyetlen aktuális átadó dokumentum. Új beszélgetésben először ezt a fájlt,
utána a `PLAN.txt` elejét és a `README.md` fájlt olvasd el. A korábbi package-,
audit-, ZIP- és patch-alapú átadók elavultak és eltávolításra kerültek.

## Hiteles munkapéldány

- Projekt: `C:\Users\23hun\Documents\Codex\2026-09-22\olvasd-el-teljesen-a-bitscrawl-atadas\work\package-10-live-extras`
- GitHub: `https://github.com/feherlofia895/Bitscrawl.git`
- Aktív ág: `feature/editor-two-layers`
- Utolsó éles funkcionális commit: `286b0ae` (`Audit word bank and add synonyms`)
- GitHub `main` legutóbbi merge commit: `7c180ef` (PR #28)
- Éles oldal: `https://bitscrawl.pages.dev/`
- Ellenőrzött kiadás: `https://bitscrawl.pages.dev/?deploy=286b0ae`
- Éles buildazonosító: `dad46bec968e-20261004T062346Z`
- Cloudflare Pages projekt: `bitscrawl`, production ág: `main`

Munkakezdéskor mindig futtasd:

```powershell
git status --short
git log -5 --oneline
```

Ne dolgozz másik `package-*` mappából. A pontos dokumentációs HEAD változhat, ezért
a fenti parancsok eredménye az irányadó; a `286b0ae` az utolsó ellenőrzött és éles
funkcionális kiadás.

## Technikai alap

- React 19, TypeScript és Vite 8
- Supabase Auth, Postgres, RLS, Realtime és RPC-k
- Cloudflare Pages frontend
- OXLint és Node beépített tesztfuttató
- Lokális, Git által figyelmen kívül hagyott `.env.local`

Titkot vagy `service_role` kulcsot soha ne tegyél kliensoldali fájlba, commitba,
átadóba vagy böngészős buildbe. A frontend publishable Supabase kulcsot használ.

## Jelenlegi éles termékállapot

- A klasszikus online játék 2–6 játékost, kódos szobát, hostkezelést, szerveroldali
  szókiosztást, köridőt, pontozást, újracsatlakozást és teljes meccsciklust kezel.
- Van párhuzamos rajzverseny, heti és havi kihívás, szavazás, archív galéria,
  Dicsőségfal és örökranglista. „A legmenőbbek” összesített nézetben csak az érmes
  játékosokat mutatja, mindenkit egyetlen kártyán az összes érmével.
- A rajzfal napi három képet, leírást, kedvelést, kommentet és kommentkedvelést
  támogat. A képek, kommentek és visszajelzések adminisztrátorként moderálhatók.
- Mobilon az előszoba-chat „Most online” része alapból összecsukott, a címsorával
  nyitható és zárható, így az üzenetek több helyet kapnak.
- A profilok rajzolt avatárt, nyilvános statisztikát, trófeákat és három,
  profillal szinkronizált, legfeljebb 16 színes egyéni palettát kezelnek.
- A Szerkesztőben és a heti/havi kihívásban elérhető a pipetta, újra, 1×/2×/3×
  ecset és radír, színcsere, kijelölés, mozgatás, 90°-os forgatás, valamint
  vízszintes és függőleges tükrözés.
- A HSL+A színkeverő 100% fedettséggel indul. Az egyéni paletták átnevezhetők,
  rendezhetők, a színeik mozgathatók és törölhetők.
- A Szerkesztő animációs módja legfeljebb három képkockát, hagymahéjat, 1–8 kép/mp
  előnézetet, GIF-exportot és profilonként két privát animációmentést kezel.
- Bejelentkezés nélkül a Szerkesztő a 12 alapszínt, a statikus rajzolást és a
  PNG-letöltést engedi. A bővített és egyéni paletta, a színkeverő, a pipetta,
  a galériaműveletek és az animáció csak mentett, bejelentkezett profillal érhetők el.
- A kijelentkezett vendég nem lát kommenteket vagy kedvelési adatokat; a kliens
  kommenttartalmat és profil-lájkadatot sem kér le neki. A Rajzfal eleve csak
  bejelentkezett profillal látható.
- A fontos mobilfelületek 320–390 px szélességre igazítva lettek. A fizikai iPhone-
  próba, a telepítés, az indítás és az egyedi ikon ellenőrzése sikeres.
- Az éles heti kihívás Boszorkány, a havi kihívás Halloween és 128×128 pixeles.

## Legutóbbi változás: vendég Szerkesztő és közösségi adatok

- A Szerkesztő a fő alkalmazás profilállapotából kapja a haladó hozzáférést.
- Vendégként mindig a 12 színű alappal indul; a korábban megnyitott animációs mód
  kijelentkezéskor állóképre, a paletta pedig az alapváltozatra áll vissza.
- A vendégfelület külön, mobilbarát belépési felhívást mutat. A PNG-export megmarad,
  de az animáció, a pipetta, a színkeverő, az egyéni/bővített paletta és a saját
  galéria vezérlői nem használhatók.
- Kijelentkezve a kommentkomponens nem jelenik meg és nem indít kommentlekérést.
  A profilablak sem kér le vagy mutat kedvelési adatokat.
- GitHub: PR #25, merge commit `a78bb76`. Cloudflare production build:
  `62392fd514e4-20261004T055020Z`.

## Korábbi változás: előszoba-admin

- A `martinteteme` profil a szerveroldali `private.app_admins` lista tagja.
- Az admin minden előszobaüzenet mellett külön Törlés gombot lát.
- A törlés kompakt, mobilbarát, beágyazott megerősítést kér. A közös modál helyett
  ez maradt, mert böngészős próbán a profil-/előzményablakokkal összeakadhatott.
- A törlést a `public.moderate_delete_lobby_message` security-invoker wrapper hívja;
  a tényleges security-definer művelet a privát sémában újra ellenőrzi az admint.
- `anon` nem futtathatja az RPC-t; `authenticated` csak a belső adminellenőrzésen
  át törölhet. Közvetlen táblatörlési jog nem került a klienshez.
- A `martinteteme` 497 karakteres, kilógó utolsó üzenete (message id `31`) célzottan
  törölve lett az éles adatbázisból.
- A migráció: `supabase/migrations/20261003160309_admin_delete_lobby_messages.sql`.
- Az éles felületen a gomb, a megerősítés megnyitása és megszakítása ellenőrzött;
  más valódi üzenet nem lett törölve.

## PWA telepítés és frissítés

- Manifest: `public/manifest.webmanifest`
- Service worker: `public/service-worker.js`
- Regisztráció: `src/main.tsx`
- Ikonok: `public/icons/bitscrawl-app-180.png`, `-192.png`, `-512.png` és
  `bitscrawl-app-maskable-512.png`
- A telepített Bitscrawl ugyanarról a `https://bitscrawl.pages.dev/` címről indul,
  ezért az új verziókhoz nem kell újratelepíteni.
- A service worker `updateViaCache: 'none'`, `skipWaiting()` és `clients.claim()`
  beállítást használ. Szándékosan nincs offline alkalmazás-cache: a multiplayer
  kliens nem maradhat észrevétlenül egy régi, gyorsítótárazott verzión.
- iPhone-on az alkalmazásváltóban teljesen bezárt, majd újranyitott PWA biztosan az
  aktuális klienst tölti be. Ikon- vagy manifestcsere az iOS erős gyorsítótára miatt
  esetenként törlést és újbóli „Főképernyőhöz adás” műveletet igényelhet.
- Elkészült és Cloudflare Pagesre élesedett a látható
  `Új Bitscrawl-verzió érhető el – Frissítés` jelzés.
  Induláskor és előtérbe kerüléskor hálózatról ellenőrzi a `build-info.json` fájlt,
  de aktív rajzolást vagy játékot soha nem tölt újra automatikusan. A gomb csak
  felhasználói kattintásra frissít.
- A kliens buildazonosítója a Beállításokban, a hibajelentések technikai adatai között
  és az admin visszajelzőközpontban is látható. A frissítési folyamatot még valós A → B
  kiadással kell iPhone-on, majd Android Chrome-on és asztali Chrome/Edge alatt
  ellenőrizni. A részletes feladatok a `PLAN.txt` elején vannak.

## Legutóbbi fejlesztés: két réteg a statikus Szerkesztőben

A felhasználó a jelenlegi változat határát a sima Szerkesztőre szűkítette. A
heti/havi kihívás, az animáció és a multiplayer-vászon nem kapott rétegeket.

1. Két rögzített sorrendű réteg van: alsó és felső.
2. Az aktív réteg választható, a láthatóság rétegenként kapcsolható, a vászon
   Törlés eszköze pedig csak az aktív réteget üríti és visszavonható marad.
3. Minden módosító eszköz csak az aktív rétegen dolgozik; a pipetta a látható,
   összerakott képből olvas.
4. A régi egyrétegű helyi mentés az alsó rétegre töltődik, a felső üres marad.
5. A verziózott helyi v2 formátum mindkét réteget, az aktív réteget és a
   láthatóságokat megőrzi.
6. A Rajzfal, a heti/havi nevezés, a profilkép, a saját galéria és a PNG-export
   lapított képet kap, ezért adatbázis-migráció nem készült.
7. Automatizált kompatibilitási és komponenspróbák készültek; a helyi asztali
   böngészős felület működik. Fizikai telefonos próba még szükséges.

A részletes elfogadási állapot a `PLAN.txt` elején, a
„KIEMELT FEJLESZTÉS – KÉT RÉTEG A SZERKESZTŐBEN” részben található.

## Adatbázis és biztonság

A helyi és éles Supabase-migrációtörténetben több korábbi név- és verzióeltérés
van. Production környezetben tilos vakon `supabase db push` vagy általános
`migration repair` parancsot futtatni.

Új adatbázis-módosítás előtt:

1. `supabase migration list --linked`
2. a helyi és távoli sor kézi összehasonlítása;
3. új, önálló migráció készítése;
4. célzott alkalmazás és csak annak a verziónak a rögzítése;
5. jogosultságok és security advisor újbóli ellenőrzése.

A `20261003160309_admin_delete_lobby_messages.sql` célzott SQL-ként került élesre,
majd kizárólag a `20261003160309` verzió lett alkalmazottként rögzítve.

A 2026-10-03-i security advisor több korábbi, nyilvános `SECURITY DEFINER` RPC-re
és az anonymous Auth mellett használt RLS-szabályra jelez. Ezek nem az új
előszobatörlésből származnak. Ne módosítsd őket egyben vagy vakon, mert a vendégjáték
és több ellenőrzött RPC szándékosan ezekre épül; külön auditban kell egyenként
értékelni őket.

## Ellenőrzés és kiadás

Helyi indítás:

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

A `package.json` további célzott teszteket tartalmaz galériához, moderációhoz,
scoreboardhoz, havi pontozáshoz, köridőhöz és multiplayerhez. Élő tesztet csak
izolált próbaadattal futtass, majd takarítsd el a létrehozott adatokat.

Élesítés előtt legyen sikeres a build, lint, releváns teszt és `git diff --check`.
A GitHub push és a Cloudflare-kiadás két külön művelet. Frontend kiadás:

```powershell
npm run deploy
```

Dokumentációs-only változást nem kell Cloudflare-re kiadni.

## Utolsó ellenőrzési eredmény

- 2026-10-05-én elkészült a Szerkesztő egységes v3 projektmodelljének első üteme:
  három réteg, legfeljebb öt képkocka, közös rétegsorrend és pontosan négy privát
  Saját projekt hely. A régi két állókép- és két animációhely adatai az éles
  Supabase-migrációban az új négy helyre kerültek.
- A projektmodellhez, szerkesztőfelülethez, felhőmentéshez, animációhoz és az
  admin tárhelyjelzéshez kapcsolódó célzott helyi próbák sikeresek; TypeScript/Vite
  production build és OXLint is hibamentes.
- TypeScript/Vite production build sikeres
- OXLint sikeres
- `git diff --check` sikeres
- A frissített réteg- és képkockafelület helyi böngészőben asztali nézetben működik;
  a képkockamásolás/törlés és az éles Saját projekt-választó valódi fiókkal is
  sikeresen megnyílt. A frontend-változat még nincs élesítve.
- Az éles adatbázis 18,6 MB / 500 MB (3,7%). Az admin központban elkészült a
  szerveroldali, kizárólag admin által olvasható mérés és a pontosan 70%-nál
  aktiválódó figyelmeztetés; a nyolc migrált projekt 13,7 kB-ot használ.
- A jelenlegi publikus kiadás buildazonosítója továbbra is
  `dad46bec968e-20261004T062346Z`.

A Vite továbbra is jelzi, hogy a production JavaScript körülbelül 671 kB
tömörítés előtt. Ez nem kiadást blokkoló hiba, de később érdemes a nagy nézeteket
dinamikusan betölteni.

## Még nyitott ellenőrzések

- Telepített PWA valós A → B frissítési próbája iPhone-on az aktuális éles buildről.
- Android Chrome és asztali Chrome/Edge PWA-telepítés/frissítés.
- Fizikai telefonos billentyűzet- és hálózatkimaradási esetek.
- A Szerkesztő három rétegének, öt képkockájának és teljes projekt-visszatöltésének
  fizikai iPhone-/Android-kezelési és PNG/GIF-export próbája.
- Az Aseprite-szerű közös képkocka–réteg rács felületi finomítása és a következő
  képkockát is mutató hagymahéj.
- A régi security-advisor figyelmeztetések egyenkénti biztonsági felülvizsgálata.
- Production JavaScript kódszétválasztása.

## Javasolt munkakezdési sorrend az új beszélgetésben

1. Git-állapot és éles commit ellenőrzése.
2. `ATADAS.md`, a `PLAN.txt` eleje és `README.md` elolvasása.
3. A Szerkesztő egységes háromréteges/ötképkockás felületét helyi tesztszerveren,
   majd fizikai telefonon ellenőrizni álló és fekvő nézetben.
4. A PWA A → B frissítési próbáját iPhone-on, majd Androidon és asztali telepített
   módban lefuttatni.
5. A felhasználó tesztje és külön jóváhagyása előtt a réteges változatot ne élesítsd.
