# Projekti töövõtted

## Skripti kontroll AA päris lehel

- Ava `https://artificialanalysis.ai/` päris brauseris. Oota, kuni lehel on `#intelligence` ja AA mudeliandmed.
- Kui kasutad Codexi brauseritööriista, liigu lehele käsuga `tab.goto('https://artificialanalysis.ai/')`. See tööriist ei toeta CDP käsku `Page.navigate`.
- Käivita kontrollitav kohalik userscript lehel. Enne uue kasutaja testi salvesta `localStorage` võtme `aa3d-bubble-settings-v1` senine väärtus ja eemalda võti ajutiselt. Taasta väärtus pärast testi.
- Kontrolli, et esimesel käivitamisel valib skript kõik AA mudelid enne domineerimisfiltrit. Kontrolli ka 4% tolerantsi, sisse lülitatud **Hide dominated models** valikut ja AA enda mudelivaliku muutumist.
- Kontrolli, et sildid, 2D Pareto joon, 3D Pareto piirjoon ja kuluga võrdelised ringid on näha ilma eraldi linnukesteta.
- Uuenda lehte ja käivita skript uuesti. Kontrolli, et salvestatud seaded ja AA mudelivalik püsivad. Vaata üle graafik, veateated ja ekraanipilt.
- Pärast Tampermonkey skripti uuendamist värskenda ka need AA vahelehed, mis olid enne uuendust lahti. Kontrolli, et uus liides ilmub ja vana versiooni nupud puuduvad.
- Taasta testi järel brauseri esialgne salvestatud olek ja aadress. Ära lisa siia paroole, võtmeid ega brauseri salvestatud andmeid.
