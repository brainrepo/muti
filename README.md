# Muti

Player desktop per musica classica (Spotify + contesto dell'opera da fonti aperte). Vedi [SPEC.md](SPEC.md).

```
npm install
npm run dev        # sviluppo
npm test           # parse + resolve (offline, HTTP registrato)
npm run typecheck
npm run dist       # electron-builder
```

Primo avvio: crea la tua app su developer.spotify.com, redirect `http://127.0.0.1/callback`, incolla il Client ID e un contatto (email/URL) per Wikimedia/MusicBrainz.
Riproduzione solo via Spotify Connect: tieni aperta l’app Spotify su un dispositivo.
Da fare prima del rilascio: logo/attribuzione Spotify ufficiali, notarizzazione macOS.
