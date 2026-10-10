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

## Kohaliku skripti kontroll puhtas brauseris

- Kasuta Codexi sisemist brauserit, kus Tampermonkey skript ei käivitu automaatselt. Ava AA leht uuel testivahelehel.
- Ära käivita kohalikku skripti koos paigaldatud vana skriptiga. Kaks skripti võivad muuta sama graafikut ja AA mudelivalikut. See võib sulgeda otsingu rippmenüü või muuta kontrolli tulemust.
- Salvesta enne testi `localStorage` võtme `aa3d-bubble-settings-v1` senine väärtus. Uue kasutaja kontrolliks eemalda võti ajutiselt.
- Oota AA mudeliandmeid. Käivita kohaliku userscript-faili sisu testivahelehel ühe korra. Kasuta brauseritööriista CDP võimalust ja käsku `Runtime.evaluate`.
- Kontrolli, et lehel on üks `#aa3d-bubble-chart` ja uus otsinguajaloo rippmenüü. Kontrolli ka eespool kirjeldatud graafiku algseadeid.
- Sisesta tavaotsingud "Claude" ja "Gemini" ning salvesta need Enteriga või otsingukastist lahkumisega. Tühjenda kast ja vali see uuesti. Kontrolli, et rippmenüü avaneb ning sisaldab mõlemat otsingut.
- Sisesta "cl". Kontrolli, et alles jääb ainult "Claude". Klõpsa real ja kontrolli otsingukasti väärtust ning graafiku muutumist.
- Kustuta otsing rea X-nupuga. Kontrolli, et rida kaob ja ei ilmu uuesti otsingukastist lahkumisel.
- Lülita sisse Regex. Kontrolli, et tavaotsingute read puuduvad. Salvesta `^(?!.*(?:Claude|GPT)).*$` ja kontrolli, et graafikul puuduvad Claude'i ja GPT mudelid.
- Värskenda testivahelehte ning käivita kohalik skript uuesti ühe korra. Kontrolli, et mõlema režiimi ajalugu säilib eraldi ja kustutatud rida puudub.
- Salvesta ekraanipilt avatud rippmenüüst. Kontrolli pildilt, et read ja nende X-nupud on nähtavad.
- Taasta testi järel salvestatud väärtus. Kui võti enne testi puudus, eemalda testis loodud võti. Sulge enda loodud testivaheleht.

## Automaatne avaldamine Greasy Forkis

- GitHubi hoidlas `henno/artificial-analysis-bubble-chart` on aktiivne webhook ID-ga `695391889`. See saadab `push`-teated Greasy Forki. Kasutusel on JSON ja TLS-sertifikaadi kontroll.
- Greasy Forki skripti ID on `597690`. Selle lähtefaili aadress on `https://raw.githubusercontent.com/henno/artificial-analysis-bubble-chart/main/artificial-analysis-3d-bubble.user.js`.
- Avaldamiseks suurenda userscripti `@version` ja nähtavat `VERSION` väärtust koos. Kontrolli muudatust AA päris lehel. Käivita `node --check artificial-analysis-3d-bubble.user.js` ja `node --test tests/*.test.cjs`. Seejärel tee commit ja push `main`-harusse.
- Kui push muudab seda userscripti faili `main`-harus, uuendab Greasy Fork skripti automaatselt. Ainult dokumentatsiooni muutmine ei avalda uut skriptiversiooni. Eraldi avaldamisskripti ega käsitsi vormi täitmist pole vaja.
- Kontrolli teate tulemust käsuga `gh api repos/henno/artificial-analysis-bubble-chart/hooks/695391889/deliveries`. Leia vastava push-teate ID ning loe selle vastus käsuga `gh api repos/henno/artificial-analysis-bubble-chart/hooks/695391889/deliveries/ID`. Oota HTTP 200 vastust, skripti `597690` kirjet väljas `updated_scripts` ja tühja `updated_failed` loendit.
- Säilita teate ID täpselt. Kasuta JSON-i lugemiseks Pythonit või kopeeri ID GitHubi liidesest. Suure ID teisendamine `jq` kaudu võib muuta selle lõpunumbreid ja põhjustada detailpäringus HTTP 404 vastuse.
- Kontrolli ka Greasy Forki avalikku versiooni ja allalaaditud koodi. Selleks võib kasutada käsku `python3 scripts/publish.py --check`. Greasy Fork asendab päises `@updateURL` ja `@downloadURL` read enda aadressidega; kontroll arvestab seda ja võrdleb ülejäänud faili.
- Avalik versioon ja allalaaditav fail võivad uueneda eri ajal. Kui teate vastus kinnitab uuendust, kuid kood on veel vana, kontrolli hiljem uuesti. Ära saada uut avaldamisteadet ainult selle viivituse tõttu.
- Avaldamine ei kinnita Tampermonkeysse paigaldamist. Pärast paigaldatud skripti uuendamist värskenda avatud AA vahelehed ja kontrolli paremas ülanurgas versiooninumbrit.
- Seadistuse muutmiseks ava Greasy Forki skripti Admin-leht ja konto webhook'i leht. Konto kasutab Google'i kaudu sisselogimist. Säilita olemasolev webhook'i saladus; ära loo seda uuesti ilma vajaduseta. Ära lisa saladust, sessiooniküpsiseid ega võtmeid projekti failidesse või tööriista väljundisse.
- GitHubi webhook'i ja Greasy Forki uuendust kontrolliti versiooni `2.7.4` automaatse avaldamisega. Täpsem seadistus on failis `PUBLISHING.md`.
