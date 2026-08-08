# PixelGuess

Online, többjátékos pixel art rajzolós-kitalálós játék korai prototípusa.

## Helyi indítás

Másold le a környezeti mintafájlt `.env.local` néven, majd töltsd ki a saját
Supabase projekted publishable adataival. Titkos vagy `service_role` kulcsot
soha ne tegyél a böngészős alkalmazásba.

```powershell
Copy-Item .env.example .env.local
```

macOS vagy Linux alatt ugyanez: `cp .env.example .env.local`.

```bash
npm install
npm run dev
```

## Ellenőrzés

```bash
npm run lint
npm run build
```

A Supabase klienskapcsolat már be van kötve, de adatbázistáblák, online szobák
és multiplayer játékmenet még nincsenek létrehozva.
