# Artificial Analysis: intelligentsuse, aja ja hinna graafik

See Tampermonkey skript lisab [Artificial Analysise](https://artificialanalysis.ai/) avalehele ja [mudelite lehele](https://artificialanalysis.ai/models) võrdlusgraafiku. Graafiku horisontaaltelg näitab ülesande aega, vertikaaltelg intelligentsusindeksit ja ringi suurus ülesande hinda. Graafik asub lehe esimese graafikuna „Highlights” jaotises.

**[Paigalda skript Chrome'i](https://raw.githubusercontent.com/henno/artificial-analysis-bubble-chart/main/artificial-analysis-3d-bubble.user.js)** · **[Juhend õpilasele](CHROME-PAIGALDUS.md)**

## Mida saab teha?

- Piirata mudeleid intelligentsuse alampiiri ning aja ja hinna ülempiiriga.
- Otsida mudeli või pakkuja nime järgi.
- Valida mudeleid samast AA mudelivalikust, mida kasutavad teised graafikud.
- Näidata 2D Pareto joont ja 3D Pareto mudelite piirjoont.
- Peita domineeritud või peaaegu domineeritud mudelid. Taluvuse liuguri väärtus 0% kasutab täpset võrdlust; vaikimisi 15% lubab väikest erinevust ühes mõõdus, kui teine mudel on mõnes mõõdus selgelt parem.

Filtrid muudavad ka AA enda mudelivalikut. Seaded salvestatakse sama brauseri `localStorage`-isse ja taastatakse lehe värskendamisel.

## Andmed ja piirangud

Skript loeb andmed avatud AA lehelt. Mudel ilmub graafikule ainult siis, kui AA annab talle intelligentsusindeksi, ülesande aja ja ülesande hinna. AA lehe ülesehituse muutus võib skripti tööd mõjutada.

Skript ise ei saada andmeid teisele serverile. Tampermonkey võib kontrollida selle faili uuendusi GitHubist. See on sõltumatu täiendus ega ole Artificial Analysise ametlik osa.

## Failid

- [`artificial-analysis-3d-bubble.user.js`](artificial-analysis-3d-bubble.user.js) on paigaldatav skript.
- [`script.md`](script.md) on sama skripti koopia käsitsi lugemiseks või kopeerimiseks.
- [`CHROME-PAIGALDUS.md`](CHROME-PAIGALDUS.md) on sammhaaval juhend Chrome'i kasutajale.

Vigadest saab teada anda [GitHubi Issues lehel](https://github.com/henno/artificial-analysis-bubble-chart/issues).
