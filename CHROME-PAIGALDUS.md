# Juhend õpilasele: graafiku paigaldamine Chrome'i

Vaja on arvutis töötavat Google Chrome'i. Skript lisab Artificial Analysise lehele graafiku, kus saab võrrelda AI mudelite intelligentsust, ülesande aega ja hinda.

## 1. Paigalda Tampermonkey

1. Ava Chrome'is [Tampermonkey Chrome'i veebipoe leht](https://chromewebstore.google.com/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobfkfo).
2. Vajuta **Add to Chrome** või **Lisa Chrome'i**.
3. Kinnita nupuga **Add extension** või **Lisa laiendus**.
4. Soovi korral vajuta aadressiriba kõrval pusletüki ikooni ja kinnita Tampermonkey tööriistaribale.

Kui kooli hallatav Chrome ei luba laiendust paigaldada, küsi abi õpetajalt või IT-haldurilt.

## 2. Luba kasutajaskriptid

1. Ava Chrome'is `chrome://extensions/`.
2. Leia **Tampermonkey** ja ava **Details** ehk **Üksikasjad**.
3. Lülita sisse **Allow User Scripts** ehk **Luba kasutajaskriptid**.

Kui seda lülitit sinu Chrome'is ei ole, lülita `chrome://extensions/` lehe paremas ülanurgas sisse **Developer mode** ehk **Arendajarežiim**. Tampermonkey vajab Chrome'is üht neist valikutest, et skripte käivitada.

## 3. Paigalda graafiku skript

1. Ava [graafiku skripti paigalduslink](https://raw.githubusercontent.com/henno/artificial-analysis-bubble-chart/main/artificial-analysis-3d-bubble.user.js).
2. Kui avaneb Tampermonkey paigaldusleht, vajuta **Install** ehk **Paigalda**.

Kui näed ainult skripti teksti või fail laaditakse alla, tee nii:

1. Vajuta Tampermonkey ikooni ja ava **Dashboard** ehk **Juhtpaneel**.
2. Ava vahekaart **Utilities** ehk **Tööriistad**.
3. Kleebi väljale **Install from URL** see aadress:

   `https://raw.githubusercontent.com/henno/artificial-analysis-bubble-chart/main/artificial-analysis-3d-bubble.user.js`

4. Vajuta selle välja kõrval **Install** ja kinnita paigaldus avaneval lehel.

## 4. Kontrolli tulemust

1. Ava [artificialanalysis.ai](https://artificialanalysis.ai/) või [mudelite leht](https://artificialanalysis.ai/models).
2. Keri jaotiseni **Highlights**. Seal peaks esimene graafik olema **Intelligence Index vs. Time per Task**.
3. Proovi liigutada mõnda graafiku liugurit. Ringid peavad kohe muutuma.

Kui graafikut ei ole, värskenda lehte ja kontrolli, et Tampermonkey oleks sisse lülitatud ning **Allow User Scripts** oleks lubatud. Kui oled varem skripti käsitsi paigaldanud, jäta Tampermonkey juhtpaneelil sisse ainult üks selle graafiku skript.

## Graafiku kasutamine

- **Intelligence Index** peidab valitud piirist nõrgemad mudelid.
- **Time per Task** ja **Cost per Task** määravad suurima lubatud aja ja hinna.
- Ülemine mudelivaliku rippmenüü muudab ka AA teiste graafikute mudelivalikut.
- **Hide dominated models** peidab mudelid, millele leidub parem või ligikaudu parem alternatiiv. **Tolerance** määrab, kui suur erinevus võib veel olla väike. Väärtus **0%** tähendab täpset võrdlust.
- **Clear filters** eemaldab otsingu ja filtrid.

Skript jätab seaded selles brauseris meelde. Uue versiooni ilmumisel saab Tampermonkey seda paigalduslingilt uuendada.

## Abi ja allikad

- [Skripti avalik lähtekood ja vigadest teatamine](https://github.com/henno/artificial-analysis-bubble-chart)
- [Chrome'i juhend laienduse paigaldamiseks](https://support.google.com/chrome/answer/2664769)
- [Tampermonkey juhend kasutajaskriptide lubamiseks](https://www.tampermonkey.net/faq.php?ext=dhdg&q=Q209)
- [Tampermonkey juhend URL-i kaudu paigaldamiseks](https://www.tampermonkey.net/faq.php?ext=dhdg&q=Q106)
