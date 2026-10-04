type PrivacyPolicyProps = {
  onBack: () => void
}

type PrivacyNoticePromptProps = {
  onOpenPrivacy: () => void
}

export function PrivacyNoticePrompt({ onOpenPrivacy }: PrivacyNoticePromptProps) {
  return (
    <p className="privacy-notice-prompt">
      A regisztráció és a belépés előtt olvasd el az{' '}
      <button className="text-link-button" onClick={onOpenPrivacy} type="button">
        adatvédelmi tájékoztatót
      </button>.
    </p>
  )
}

export function PrivacyPolicy({ onBack }: PrivacyPolicyProps) {
  return (
    <section className="privacy-page" aria-labelledby="privacy-title">
      <header className="privacy-header">
        <div>
          <p className="step-label">Jogi tájékoztató · 1.1</p>
          <h1 id="privacy-title">Adatvédelmi tájékoztató</h1>
          <p>Hatályos: 2026. október 4-től</p>
        </div>
        <button onClick={onBack} type="button">Vissza</button>
      </header>

      <div className="privacy-content">
        <section>
          <h2>1. Ki kezeli az adatokat?</h2>
          <dl className="privacy-controller-details">
            <div><dt>Adatkezelő</dt><dd>Sárközi Martin János</dd></div>
            <div><dt>Kapcsolati e-mail</dt><dd><a href="mailto:bitscrawl.adatvedelem@gmail.com">bitscrawl.adatvedelem@gmail.com</a></dd></div>
          </dl>
          <p>
            Az adatkezelő határozza meg, hogy a Bitscrawl milyen célból és hogyan kezeli a felhasználók
            személyes adatait. A Supabase és a Cloudflare az adatkezelő megbízásából technikai
            szolgáltatóként, adatfeldolgozóként jár el.
          </p>
        </section>

        <section>
          <h2>2. Milyen adatokat és miért kezelünk?</h2>
          <div className="privacy-table-wrap">
            <table className="privacy-table">
              <thead>
                <tr><th>Adatkör</th><th>Cél</th><th>Jogalap</th><th>Megőrzés</th></tr>
              </thead>
              <tbody>
                <tr>
                  <td>E-mail-cím, titkosított jelszólenyomat, felhasználói és munkamenet-azonosítók</td>
                  <td>Fiók létrehozása, belépés és a fiók biztonságos működtetése</td>
                  <td>Szerződés teljesítése, illetve a regisztrációt megelőző lépések (GDPR 6. cikk (1) b))</td>
                  <td>A fiók fennállásáig, majd a törlés technikai teljesítéséhez és biztonsági mentések kifutásához szükséges ideig</td>
                </tr>
                <tr>
                  <td>Megjelenített név, rajzolt profilkép</td>
                  <td>A játékos azonosítása és megjelenítése a közösségi felületeken</td>
                  <td>Szerződés teljesítése (GDPR 6. cikk (1) b))</td>
                  <td>A fiók fennállásáig vagy a törlési kérelem teljesítéséig</td>
                </tr>
                <tr>
                  <td>A Rajzfalra feltöltött rajzok és animációk, valamint a kihívások nevezései</td>
                  <td>A nyilvános Rajzfal, a kihívásgalériák és a közösségi képarchívum működtetése</td>
                  <td>Szerződés teljesítése; visszaélések kezelése esetén jogos érdek (GDPR 6. cikk (1) b) és f))</td>
                  <td>Határozatlan ideig, amíg a galéria vagy archívum működik; a szerző törlési kérelméig, a tartalom eltávolításáig vagy a szolgáltatás megszűnéséig</td>
                </tr>
                <tr>
                  <td>Saját piszkozatok, paletták, hozzászólások, kedvelések, szavazatok, pontok és érmek</td>
                  <td>A szerkesztő, a fiókhoz kötött előzmények és a közösségi funkciók biztosítása</td>
                  <td>Szerződés teljesítése; visszaélések kezelése esetén jogos érdek (GDPR 6. cikk (1) b) és f))</td>
                  <td>A tartalom törléséig, a fiók megszüntetéséig vagy addig, amíg az adott közösségi funkció működéséhez szükséges</td>
                </tr>
                <tr>
                  <td>Játékszoba-azonosítók, választott nyilvános szobanév, chat- és tippüzenetek, rajzesemények, jelenléti és időbélyegadatok</td>
                  <td>Többjátékos működés, játékállapot-szinkronizálás és visszaélés-megelőzés</td>
                  <td>Szerződés teljesítése és az üzemeltető biztonsághoz fűződő jogos érdeke (GDPR 6. cikk (1) b) és f))</td>
                  <td>A játékszoba megszűnését vagy a játék befejezését követő legfeljebb 30 napig, majd töröljük vagy személyhez nem köthetővé tesszük; biztonsági esemény vagy jogi igény esetén a kivizsgálás lezárásáig tovább őrizhető</td>
                </tr>
                <tr>
                  <td>Hiba- és ötletbejelentések, kapcsolódó technikai környezet, moderációs adatok</td>
                  <td>Hibajavítás, fejlesztés, panaszok és szabálysértések kivizsgálása</td>
                  <td>Az üzemeltető működéshez és biztonsághoz fűződő jogos érdeke (GDPR 6. cikk (1) f))</td>
                  <td>A kivizsgálás lezárásáig és az esetleges jogi igények érvényesíthetőségéhez szükséges ideig</td>
                </tr>
                <tr>
                  <td>IP-cím, eszköz- és böngészőadatok, kérés- és biztonsági naplók</td>
                  <td>Az oldal kiszolgálása, hibakeresés, támadások és visszaélések felismerése</td>
                  <td>Az üzemeltető biztonságos szolgáltatáshoz fűződő jogos érdeke (GDPR 6. cikk (1) f))</td>
                  <td>A szolgáltatók korlátozott naplómegőrzési ideje, illetve a biztonsági esemény kivizsgálásához szükséges idő</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p>
            Jogi kötelezettség vagy hatósági megkeresés esetén az ehhez szükséges adatokat a GDPR
            6. cikk (1) c) pontja alapján, a kötelező ideig kezelhetjük. Az adatok megadása a fiókhoz és
            az adott funkcióhoz szükséges; nélkülük a kapcsolódó funkció nem használható.
          </p>
          <p>
            Az adatokat közvetlenül tőled, az alkalmazás használata során kapjuk. A Bitscrawl jelenleg
            nem végez joghatással vagy hasonlóan jelentős hatással járó automatizált döntéshozatalt,
            és nem készít ilyen célú profilt a felhasználókról.
          </p>
        </section>

        <section>
          <h2>3. Mit lát más?</h2>
          <p>
            Az e-mail-cím nem nyilvános. A megjelenített név, profilkép, választott nyilvános szobanév,
            közzétett rajzok és animációk, hozzászólások, eredmények, érmek, valamint egyes kedvelési és
            szavazási adatok azonban a funkció jellegétől függően más játékosok számára is láthatók
            lehetnek. Ne használj valódi nevet vagy más személyes adatot nyilvános névként, rajzon,
            hozzászólásban vagy chatben, ha azt nem szeretnéd megosztani.
          </p>
        </section>

        <section>
          <h2>4. Hogyan kezeljük a jelszót?</h2>
          <p>
            A hitelesítést a Supabase Auth végzi. A jelszó nem olvasható szövegként kerül az adatbázisba,
            hanem egyirányú bcrypt jelszólenyomatként. Az adatkezelő sem tudja megtekinteni vagy
            visszaállítani az eredeti jelszót. Elfelejtett jelszó esetén új jelszót kell beállítani.
          </p>
        </section>

        <section>
          <h2>5. Adatfeldolgozók és külföldi adattovábbítás</h2>
          <ul>
            <li>
              <strong>Supabase, Inc. / Supabase Pte. Ltd.</strong> – adatbázis, hitelesítés és valós idejű
              adatkapcsolat. A kiválasztott projekt-régióban tárolja és elsődlegesen ott kezeli az
              adatokat. Részletek a{' '}
              <a href="https://supabase.com/legal/customer-resources/data-processing-addendum" rel="noreferrer" target="_blank">Supabase adatfeldolgozási feltételeiben</a>.
            </li>
            <li>
              <strong>Cloudflare, Inc.</strong> – tárhely, tartalomtovábbítás és biztonsági védelem.
              Részletek a{' '}
              <a href="https://www.cloudflare.com/cloudflare-customer-dpa/" rel="noreferrer" target="_blank">Cloudflare adatfeldolgozási feltételeiben</a>.
            </li>
          </ul>
          <p>
            A szolgáltatók és al-adatfeldolgozóik az Európai Gazdasági Térségen kívül is kezelhetnek
            adatokat. Ilyenkor az adattovábbítás megfelelő garanciák, különösen az Európai Bizottság
            általános szerződési feltételei alapján történik. A Bitscrawl jelenleg nem értékesít személyes
            adatokat, és nem használja őket célzott reklámozásra.
          </p>
        </section>

        <section>
          <h2>6. Helyi tárolás és sütik</h2>
          <p>
            A böngésző a bejelentkezés fenntartásához, a rajzpiszkozatokhoz, egyéni palettákhoz és
            beállításokhoz szükséges adatokat helyben tárolhatja. Ezek egy része csak az adott eszközön
            marad, más része bejelentkezés után a felhasználói fiókhoz szinkronizálódhat. Jelenleg nincs
            célzott reklám vagy opcionális marketingkövetés. Ha később nem szükséges analitika vagy
            marketingcélú tárolás kerül be, ahhoz előzetes választási lehetőséget biztosítunk.
          </p>
        </section>

        <section>
          <h2>7. Biztonság</h2>
          <p>
            A szolgáltatás hozzáférés-szabályozást, titkosított adatkapcsolatot és szolgáltatói
            biztonsági megoldásokat használ. Az adminisztrátori hozzáférés csak az üzemeltetéshez,
            moderáláshoz, támogatáshoz és jogi kötelezettségek teljesítéséhez használható. Teljes
            kockázatmentesség nem garantálható; adatvédelmi incidens esetén a jogszabály szerinti
            intézkedéseket tesszük meg.
          </p>
        </section>

        <section>
          <h2>8. A felhasználó jogai</h2>
          <p>
            Kérhetsz hozzáférést a rólad kezelt adatokhoz, helyesbítést, törlést, az adatkezelés
            korlátozását és – ha a feltételei fennállnak – adathordozhatóságot. Jogos érdeken alapuló
            adatkezelés ellen tiltakozhatsz. Ha egy későbbi adatkezelés hozzájáruláson alapul, a
            hozzájárulás bármikor visszavonható, a korábbi adatkezelés jogszerűségének érintése nélkül.
          </p>
          <p>
            A kérelmet az 1. pontban megadott e-mail-címre küldheted. A választ indokolatlan késedelem
            nélkül, főszabály szerint egy hónapon belül adjuk meg. A személyazonosság igazolásához csak
            a szükséges adatokat kérjük. Törlési jog esetén lehetnek jogszabályi kivételek, és a
            biztonsági mentésekből való teljes kifutás további technikai időt vehet igénybe.
          </p>
          <p>
            Panaszt tehetsz a{' '}
            <a href="https://www.naih.hu/" rel="noreferrer" target="_blank">Nemzeti Adatvédelmi és Információszabadság Hatóságnál (NAIH)</a>,
            illetve a szokásos tartózkodási helyed vagy munkahelyed szerinti uniós felügyeleti hatóságnál.
          </p>
        </section>

        <section>
          <h2>9. Kiskorú felhasználók</h2>
          <p>
            A Bitscrawl nem kifejezetten gyermekeknek szánt szolgáltatás. Ha a felhasználó életkora
            miatt a törvényes képviselő közreműködése szükséges, a regisztráció és használat csak ennek
            megfelelően történhet. Ha tudomásunkra jut, hogy személyes adat kezelése jogalap nélkül
            történt, megtesszük a szükséges törlési intézkedéseket.
          </p>
        </section>

        <section>
          <h2>10. A tájékoztató változásai</h2>
          <p>
            Új funkció, szolgáltató vagy adatkezelési cél bevezetésekor ezt a tájékoztatót frissítjük.
            A lényeges változásokról az oldalon jól látható módon tájékoztatunk, és ahol a jogszabály
            megköveteli, új hozzájárulást kérünk.
          </p>
        </section>
      </div>
    </section>
  )
}
