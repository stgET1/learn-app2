// ── TILA ──
let kysymykset = [];
let nykyinen = 0;
let pisteet = 0;
let vastaukset = [];
let timerInterval = null;
let aikaJaljella = 20;
let vastattu = false;
let pelimuoto = 'quiz';

const VARIT = ['A','B','C','D'];
const IKONIT = ['▲','◆','●','★'];

function nakyta(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

function valitsePelimuoto(muoto) {
  pelimuoto = muoto;
  document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('selected'));
  document.querySelector(`.mode-btn[data-mode="${muoto}"]`).classList.add('selected');
}

function paivitaTokeniNaytto(el, streamTokens) {
  const sisaan = parseInt(el.dataset.sisaan || 0);
  const ulos = parseInt(el.dataset.ulos || streamTokens || 0);
  const cacheLuettu = parseInt(el.dataset.cache_luettu || 0);
  const cacheLuotu = parseInt(el.dataset.cache_luotu || 0);

  let osat = [];
  if (sisaan > 0) osat.push(`📥 ${sisaan.toLocaleString()} sisään`);
  if (ulos > 0) osat.push(`📤 ${ulos.toLocaleString()} ulos`);
  if (cacheLuettu > 0) osat.push(`⚡ ${cacheLuettu.toLocaleString()} cachestä`);
  if (cacheLuotu > 0) osat.push(`💾 ${cacheLuotu.toLocaleString()} cacheen`);
  if (osat.length === 0 && streamTokens > 0) osat.push(`📤 ~${streamTokens} ulos`);

  el.textContent = osat.join('  ·  ');
}

async function aloitaKoe() {
  const apiKey = document.getElementById('api-key').value.trim();
  const aihe = document.getElementById('aihe').value.trim();
  const maara = document.getElementById('maara').value;
  const vaikeus = document.getElementById('vaikeus').value;

  if (!apiKey) { alert('Syötä API-avain!'); return; }
  if (!aihe) { alert('Lisää teksti tai lataa tiedosto!'); return; }

  localStorage.setItem('claude_api_key', apiKey);
  nakyta('screen-loading');

  let prompt;
  if (pelimuoto === 'kortit') {
    prompt = `Luo ${maara} kääntelykorttiparia AINOASTAAN seuraavan tekstin sisällöstä. Vaikeustaso: ${vaikeus}.

TEKSTI:
${aihe}

Vastaa AINOASTAAN validilla JSON-taulukolla (ei muuta tekstiä):
[
  {
    "etupuoli": "Käsite tai kysymys tähän",
    "takapuoli": "Selitys tai vastaus tähän",
    "selitys": "Lisäkonteksti tai muistivihje"
  }
]`;
  } else if (pelimuoto === 'kirjoitus') {
    prompt = `Luo ${maara} täydennystekstitehtävää AINOASTAAN seuraavan tekstin sisällöstä. Vaikeustaso: ${vaikeus}.

TEKSTI:
${aihe}

Vastaa AINOASTAAN validilla JSON-taulukolla (ei muuta tekstiä):
[
  {
    "kysymys": "Kysymys tai konteksti",
    "vastaus": "Oikea lyhyt vastaus (1-4 sanaa)",
    "vihje": "Lyhyt vihje jos tarvitaan"
  }
]`;
  } else {
    prompt = `Luo ${maara} monivalintakysymystä AINOASTAAN seuraavan tekstin sisällöstä. Vaikeustaso: ${vaikeus}.

TEKSTI:
${aihe}

Vastaa AINOASTAAN validilla JSON-taulukolla tässä muodossa (ei muuta tekstiä):
[
  {
    "kysymys": "Kysymyksen teksti tähän?",
    "vaihtoehdot": ["Vaihtoehto A", "Vaihtoehto B", "Vaihtoehto C", "Vaihtoehto D"],
    "oikea": 0,
    "selitys": "Lyhyt selitys miksi tämä on oikein"
  }
]

Oikea-kenttä on oikean vastauksen indeksi (0=A, 1=B, 2=C, 3=D).
Tee kysymyksistä selkeitä, opettavaisia ja ${vaikeus}-tasoisia.`;
  }

  const streamBox = document.getElementById('stream-box');
  const tokenCount = document.getElementById('token-count');
  const loadingSub = document.getElementById('loading-sub');
  streamBox.classList.add('active');
  streamBox.innerHTML = '<span class="stream-cursor"></span>';
  loadingSub.textContent = 'AI kirjoittaa sisältöä...';
  tokenCount.dataset.sisaan = '';
  tokenCount.dataset.ulos = '';
  tokenCount.dataset.cache_luettu = '';
  tokenCount.dataset.cache_luotu = '';
  tokenCount.textContent = '';

  try {
    // max_tokens lasketaan pelimuodon ja kysymysmäärän mukaan
    const tokensPerQ = {
      'quiz': 120, 'kortit': 80, 'kirjoitus': 60,
      'muisti': 80, 'jarjesta': 200
    }[pelimuoto] || 120;
    const arvioituTokenit = parseInt(maara) * tokensPerQ + 400;
    const maxTokens = Math.min(arvioituTokenit, 4096);

    // Pilkotaan prompt kahteen osaan:
    // 1. Teksti (cacheable — kallis osa, välimuistitetaan)
    // 2. Ohjeet (lyhyt, vaihtelee pelimuodon mukaan)
    const [ohjeOsa, tekstiOsa] = prompt.split('TEKSTI:');
    const kayttajanTeksti = tekstiOsa || '';

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "prompt-caching-2024-07-31",
        "anthropic-dangerous-direct-browser-access": "true"
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: maxTokens,
        stream: true,
        system: [
          {
            type: "text",
            text: "Olet opettavainen koe-generaattori. Vastaat AINOASTAAN validilla JSON-taulukolla ilman muuta tekstiä.",
            cache_control: { type: "ephemeral" }
          }
        ],
        messages: [{
          role: "user",
          content: [
            {
              type: "text",
              // Käyttäjän teksti cachetetaan — jos sama teksti lähetetään uudelleen
              // (eri pelimuoto), se haetaan välimuistista 90% halvemmalla
              text: kayttajanTeksti,
              cache_control: { type: "ephemeral" }
            },
            {
              type: "text",
              text: ohjeOsa
            }
          ]
        }]
      })
    });

    if (!res.ok) { const err = await res.json(); throw new Error(err.error?.message || 'API-virhe'); }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let kertynyt = '';
    let tokeneja = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      for (const rivi of chunk.split('\n')) {
        if (!rivi.startsWith('data: ')) continue;
        const data = rivi.slice(6).trim();
        if (data === '[DONE]') continue;
        try {
          const event = JSON.parse(data);
          if (event.type === 'message_start' && event.message?.usage) {
            const u = event.message.usage;
            tokenCount.dataset.sisaan = u.input_tokens || 0;
            tokenCount.dataset.cache_luettu = u.cache_read_input_tokens || 0;
            tokenCount.dataset.cache_luotu = u.cache_creation_input_tokens || 0;
            paivitaTokeniNaytto(tokenCount, tokeneja);
          } else if (event.type === 'message_delta' && event.usage) {
            tokenCount.dataset.ulos = event.usage.output_tokens || 0;
            paivitaTokeniNaytto(tokenCount, tokeneja);
          } else if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
            kertynyt += event.delta.text;
            tokeneja++;
            streamBox.innerHTML = kertynyt.slice(-300).replace(/</g, '&lt;') + '<span class="stream-cursor"></span>';
            streamBox.scrollTop = streamBox.scrollHeight;
            paivitaTokeniNaytto(tokenCount, tokeneja);
          }
        } catch (_) {}
      }
    }

    streamBox.classList.remove('active');
    tokenCount.textContent = '';
    loadingSub.textContent = 'Analysoidaan tekstiä ja luodaan sisältö';

    let teksti = kertynyt.trim()
      .replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();

    kysymykset = JSON.parse(teksti);
    nykyinen = 0; pisteet = 0; vastaukset = [];
    aikaJaljella = parseInt(document.getElementById('aika').value);

    if (pelimuoto === 'kortit') aloitaKortit();
    else if (pelimuoto === 'kirjoitus') aloitaKirjoitus();
    else { nakyta('screen-quiz'); naytaKysymys(); }

  } catch (e) {
    nakyta('screen-setup');
    alert('Virhe: ' + e.message);
  }
}

// ══ MONIVALINTA ══
function naytaKysymys() {
  vastattu = false;
  const q = kysymykset[nykyinen];
  const total = kysymykset.length;
  document.getElementById('question-num').textContent = `KYSYMYS ${nykyinen + 1}`;
  document.getElementById('question-text').textContent = q.kysymys;
  document.getElementById('progress-label').textContent = `Kysymys ${nykyinen + 1} / ${total}`;
  document.getElementById('progress-fill').style.width = `${(nykyinen / total) * 100}%`;
  document.getElementById('score-display').textContent = pisteet;
  document.getElementById('feedback-bar').style.display = 'none';
  document.getElementById('btn-next').classList.remove('visible');
  const grid = document.getElementById('answers-grid');
  grid.innerHTML = '';
  // Randomoi vastausjärjestys, tallenna järjestys nappeihin data-attribuuttina
  const jarjestys = [0,1,2,3].sort(() => Math.random() - 0.5);
  jarjestys.forEach((alkuperainen, nakyvaIndeksi) => {
    const btn = document.createElement('button');
    btn.className = `answer-btn ${VARIT[nakyvaIndeksi]}`;
    btn.dataset.alkuperainen = alkuperainen;
    btn.innerHTML = `<div class="answer-icon">${IKONIT[nakyvaIndeksi]}</div><span>${q.vaihtoehdot[alkuperainen]}</span>`;
    btn.onclick = () => vastaa(alkuperainen);
    grid.appendChild(btn);
  });
  aloitaAjastin();
}

function aloitaAjastin() {
  clearInterval(timerInterval);
  aikaJaljella = parseInt(document.getElementById('aika').value);
  const maxAika = aikaJaljella;
  const circumference = 150.8;
  const timerFg = document.getElementById('timer-fg');
  const timerNum = document.getElementById('timer-num');
  timerFg.style.stroke = '#c084fc';
  timerFg.style.strokeDashoffset = '0';
  timerNum.textContent = aikaJaljella;
  timerInterval = setInterval(() => {
    aikaJaljella--;
    timerNum.textContent = aikaJaljella;
    timerFg.style.strokeDashoffset = circumference * (1 - aikaJaljella / maxAika);
    if (aikaJaljella <= 5) timerFg.style.stroke = '#e8394a';
    else if (aikaJaljella <= 10) timerFg.style.stroke = '#ffc107';
    if (aikaJaljella <= 0) { clearInterval(timerInterval); if (!vastattu) aikaLoppui(); }
  }, 1000);
}

function aikaLoppui() {
  vastattu = true;
  const q = kysymykset[nykyinen];
  vastaukset.push({ kysymys: q.kysymys, oma: -1, oikea: q.oikea, oikein: false, selitys: q.selitys, vaihtoehdot: q.vaihtoehdot });
  document.querySelectorAll('.answer-btn').forEach(b => {
    b.disabled = true;
    if (parseInt(b.dataset.alkuperainen) === q.oikea) b.classList.add('correct');
  });
  const fb = document.getElementById('feedback-bar');
  fb.textContent = `⏰ Aika loppui! Oikea: ${q.vaihtoehdot[q.oikea]}`;
  fb.className = 'feedback-bar vaarin'; fb.style.display = 'block';
  document.getElementById('btn-next').classList.add('visible');
}

function vastaa(valinta) {
  if (vastattu) return;
  vastattu = true;
  clearInterval(timerInterval);
  const q = kysymykset[nykyinen];
  const oikein = valinta === q.oikea;
  const aikaBonus = Math.round(aikaJaljella * 10);
  if (oikein) pisteet += 100 + aikaBonus;
  vastaukset.push({ kysymys: q.kysymys, oma: valinta, oikea: q.oikea, oikein, selitys: q.selitys, vaihtoehdot: q.vaihtoehdot });
  document.querySelectorAll('.answer-btn').forEach(b => {
    b.disabled = true;
    const orig = parseInt(b.dataset.alkuperainen);
    if (orig === q.oikea) b.classList.add('correct');
    else if (orig === valinta && !oikein) b.classList.add('wrong');
  });
  const fb = document.getElementById('feedback-bar');
  fb.textContent = oikein ? `✅ Oikein! +${100 + aikaBonus} pistettä — ${q.selitys}` : `❌ Väärin. Oikea: ${q.vaihtoehdot[q.oikea]} — ${q.selitys}`;
  fb.className = `feedback-bar ${oikein ? 'oikein' : 'vaarin'}`; fb.style.display = 'block';
  document.getElementById('score-display').textContent = pisteet;
  document.getElementById('btn-next').classList.add('visible');
}

function seuraava() {
  nykyinen++;
  if (nykyinen >= kysymykset.length) naytaTulokset();
  else naytaKysymys();
}

// ══ KÄÄNTELYKORTIT ══
let korttiJarjestys = [], korttiNykyinen = 0, korttiKaannetty = false;
let korttiTunnetaan = 0, korttiEiTunnetaan = 0;

function aloitaKortit() {
  korttiJarjestys = kysymykset.map((_, i) => i).sort(() => Math.random() - 0.5);
  korttiNykyinen = 0; korttiKaannetty = false; korttiTunnetaan = 0; korttiEiTunnetaan = 0;
  nakyta('screen-kortit');
  naytaKortti();
}

function naytaKortti() {
  const total = korttiJarjestys.length;
  if (korttiNykyinen >= total) { naytaKorttiTulokset(); return; }
  const k = kysymykset[korttiJarjestys[korttiNykyinen]];
  korttiKaannetty = false;
  document.getElementById('kortti-progress').textContent = `${korttiNykyinen + 1} / ${total}`;
  document.getElementById('kortti-progress-fill').style.width = `${(korttiNykyinen / total) * 100}%`;
  document.getElementById('kortti-tunnetaan').textContent = korttiTunnetaan;
  document.getElementById('kortti-ei-tunnetaan').textContent = korttiEiTunnetaan;
  const kortti = document.getElementById('flash-kortti');
  kortti.classList.remove('kaannetty', 'slide-out-right', 'slide-out-left');
  document.getElementById('kortti-etu').textContent = k.etupuoli;
  document.getElementById('kortti-taka').textContent = k.takapuoli;
  document.getElementById('kortti-selitys').textContent = k.selitys || '';
  document.getElementById('kortti-toiminnot').style.display = 'none';
}

function kaannaKortti() {
  if (korttiKaannetty) return;
  korttiKaannetty = true;
  document.getElementById('flash-kortti').classList.add('kaannetty');
  setTimeout(() => { document.getElementById('kortti-toiminnot').style.display = 'flex'; }, 350);
}

function korttiVastaus(tunnetaan) {
  if (tunnetaan) korttiTunnetaan++; else korttiEiTunnetaan++;
  const kortti = document.getElementById('flash-kortti');
  kortti.classList.add(tunnetaan ? 'slide-out-right' : 'slide-out-left');
  setTimeout(() => { kortti.classList.remove('slide-out-right','slide-out-left'); korttiNykyinen++; naytaKortti(); }, 400);
}

function naytaKorttiTulokset() {
  nakyta('screen-results');
  const total = korttiJarjestys.length;
  const prosentti = Math.round((korttiTunnetaan / total) * 100);
  let emoji = '😅', title = 'Harjoittele lisää!';
  if (prosentti >= 90) { emoji = '🏆'; title = 'Mestari!'; konfetti(); }
  else if (prosentti >= 70) { emoji = '🎉'; title = 'Hienoa työtä!'; }
  else if (prosentti >= 50) { emoji = '👍'; title = 'Ihan hyvä!'; }
  document.getElementById('result-emoji').textContent = emoji;
  document.getElementById('result-title').textContent = title;
  document.getElementById('big-score').textContent = `${korttiTunnetaan}/${total}`;
  document.getElementById('score-label').textContent = `korttia tunnettiin · ${prosentti}%`;
  document.getElementById('result-breakdown').innerHTML = `
    <div class="breakdown-item" style="justify-content:center;gap:32px">
      <div style="text-align:center"><div style="font-size:2rem">✅</div><div style="font-size:1.4rem;font-weight:900;color:#52e8a0">${korttiTunnetaan}</div><div style="font-size:0.8rem;color:var(--muted)">Tunnettiin</div></div>
      <div style="text-align:center"><div style="font-size:2rem">❌</div><div style="font-size:1.4rem;font-weight:900;color:#ff6b78">${korttiEiTunnetaan}</div><div style="font-size:0.8rem;color:var(--muted)">Ei tunnistettu</div></div>
    </div>`;
}

// ══ KIRJOITUSMINIPELI ══
let kirjoitusAika = 0, kirjoitusTimer = null, kirjoitusVirheet = 0, kirjoitusOikein = 0;

function aloitaKirjoitus() {
  kirjoitusVirheet = 0; kirjoitusOikein = 0; nykyinen = 0;
  nakyta('screen-kirjoitus');
  naytaKirjoitusTehtava();
}

function naytaKirjoitusTehtava() {
  if (nykyinen >= kysymykset.length) { naytaKirjoitusTulokset(); return; }
  const q = kysymykset[nykyinen];
  const total = kysymykset.length;
  document.getElementById('kirj-progress').textContent = `${nykyinen + 1} / ${total}`;
  document.getElementById('kirj-progress-fill').style.width = `${(nykyinen / total) * 100}%`;
  document.getElementById('kirj-kysymys').textContent = q.kysymys;
  document.getElementById('kirj-vihje').textContent = '';
  document.getElementById('kirj-feedback').textContent = '';
  document.getElementById('kirj-feedback').className = 'kirj-feedback';
  document.getElementById('kirj-input').value = '';
  document.getElementById('kirj-input').disabled = false;
  document.getElementById('kirj-pituus').textContent = `Vastauksen pituus: ${q.vastaus.length} merkkiä`;
  document.getElementById('kirj-score').textContent = pisteet;
  document.getElementById('kirj-input').focus();
  clearInterval(kirjoitusTimer);
  kirjoitusAika = parseInt(document.getElementById('aika').value);
  document.getElementById('kirj-aika').textContent = kirjoitusAika;
  kirjoitusTimer = setInterval(() => {
    kirjoitusAika--;
    document.getElementById('kirj-aika').textContent = kirjoitusAika;
    if (kirjoitusAika <= 5) document.getElementById('kirj-aika').style.color = '#ff6b78';
    else document.getElementById('kirj-aika').style.color = '';
    if (kirjoitusAika <= 0) { clearInterval(kirjoitusTimer); kirjoitusAikaLoppui(); }
  }, 1000);
}

function kirjoitusTarkista() {
  const q = kysymykset[nykyinen];
  const syote = document.getElementById('kirj-input').value.trim().toLowerCase();
  const oikea = q.vastaus.toLowerCase();
  if (!syote) return;
  clearInterval(kirjoitusTimer);
  document.getElementById('kirj-input').disabled = true;
  const oikein = syote === oikea || oikea.includes(syote) || syote.includes(oikea);
  const aikaBonus = Math.round(kirjoitusAika * 10);
  const fb = document.getElementById('kirj-feedback');
  if (oikein) {
    pisteet += 100 + aikaBonus; kirjoitusOikein++;
    fb.textContent = `✅ Oikein! +${100 + aikaBonus} pistettä`;
    fb.className = 'kirj-feedback oikein';
  } else {
    kirjoitusVirheet++;
    fb.textContent = `❌ Oikea vastaus: "${q.vastaus}"`;
    fb.className = 'kirj-feedback vaarin';
  }
  vastaukset.push({ kysymys: q.kysymys, oma: syote, oikea: q.vastaus, oikein, selitys: q.vihje || '', vaihtoehdot: [] });
  setTimeout(() => { nykyinen++; naytaKirjoitusTehtava(); }, 1200);
}

function kirjoitusAikaLoppui() {
  const q = kysymykset[nykyinen];
  document.getElementById('kirj-input').disabled = true;
  const fb = document.getElementById('kirj-feedback');
  fb.textContent = `⏰ Aika loppui! Oikea: "${q.vastaus}"`;
  fb.className = 'kirj-feedback vaarin';
  kirjoitusVirheet++;
  vastaukset.push({ kysymys: q.kysymys, oma: '', oikea: q.vastaus, oikein: false, selitys: q.vihje || '', vaihtoehdot: [] });
  setTimeout(() => { nykyinen++; naytaKirjoitusTehtava(); }, 1200);
}

function naytaVihje() {
  const q = kysymykset[nykyinen];
  document.getElementById('kirj-vihje').textContent = q.vihje ? `💡 ${q.vihje}` : '💡 Ei vihjettä saatavilla';
}

function naytaKirjoitusTulokset() {
  nakyta('screen-results');
  const total = kysymykset.length;
  const prosentti = Math.round((kirjoitusOikein / total) * 100);
  let emoji = '😅', title = 'Harjoittele lisää!';
  if (prosentti >= 90) { emoji = '🏆'; title = 'Kirjoitustaituri!'; konfetti(); }
  else if (prosentti >= 70) { emoji = '🎉'; title = 'Hienoa työtä!'; }
  else if (prosentti >= 50) { emoji = '👍'; title = 'Ihan hyvä!'; }
  document.getElementById('result-emoji').textContent = emoji;
  document.getElementById('result-title').textContent = title;
  document.getElementById('big-score').textContent = `${kirjoitusOikein}/${total}`;
  document.getElementById('score-label').textContent = `oikein · ${pisteet} pistettä · ${prosentti}%`;
  const bd = document.getElementById('result-breakdown');
  bd.innerHTML = '';
  vastaukset.forEach((v, i) => {
    const item = document.createElement('div');
    item.className = 'breakdown-item';
    item.innerHTML = `
      <div class="breakdown-icon">${v.oikein ? '✅' : '❌'}</div>
      <div>
        <div class="breakdown-q">${i+1}. ${v.kysymys}</div>
        <div class="breakdown-a ${v.oikein ? 'oikein' : 'vaarin'}">${v.oikein ? `Oikein: "${v.oikea}"` : `Vastattu: "${v.oma || '–'}" → Oikea: "${v.oikea}"`}</div>
      </div>`;
    bd.appendChild(item);
  });
}

// ══ YHTEINEN TULOKSET (monivalinta) ══
function naytaTulokset() {
  nakyta('screen-results');
  const oikeitaKpl = vastaukset.filter(v => v.oikein).length;
  const total = kysymykset.length;
  const prosentti = Math.round((oikeitaKpl / total) * 100);
  let emoji = '😅', title = 'Harjoittele lisää!';
  if (prosentti >= 90) { emoji = '🏆'; title = 'Loistava suoritus!'; konfetti(); }
  else if (prosentti >= 70) { emoji = '🎉'; title = 'Hienoa työtä!'; }
  else if (prosentti >= 50) { emoji = '👍'; title = 'Ihan hyvä!'; }
  document.getElementById('result-emoji').textContent = emoji;
  document.getElementById('result-title').textContent = title;
  document.getElementById('big-score').textContent = `${oikeitaKpl}/${total}`;
  document.getElementById('score-label').textContent = `oikein · ${pisteet} pistettä · ${prosentti}%`;
  const bd = document.getElementById('result-breakdown');
  bd.innerHTML = '';
  vastaukset.forEach((v, i) => {
    const item = document.createElement('div');
    item.className = 'breakdown-item';
    const icon = v.oma === -1 ? '⏰' : v.oikein ? '✅' : '❌';
    const aTeksti = v.oikein ? `Oikein: ${v.vaihtoehdot[v.oikea]}` : `Vastattu: ${v.oma >= 0 ? v.vaihtoehdot[v.oma] : 'Ei vastattu'} → Oikea: ${v.vaihtoehdot[v.oikea]}`;
    item.innerHTML = `
      <div class="breakdown-icon">${icon}</div>
      <div>
        <div class="breakdown-q">${i+1}. ${v.kysymys}</div>
        <div class="breakdown-a ${v.oikein ? 'oikein' : 'vaarin'}">${aTeksti}</div>
      </div>`;
    bd.appendChild(item);
  });
}

function konfetti() {
  const varit = ['#c084fc','#818cf8','#38bdf8','#fbbf24','#34d399','#f87171'];
  for (let i = 0; i < 80; i++) {
    setTimeout(() => {
      const el = document.createElement('div');
      el.className = 'confetti-piece';
      el.style.cssText = `left:${Math.random()*100}vw;background:${varit[Math.floor(Math.random()*varit.length)]};width:${Math.random()*10+6}px;height:${Math.random()*10+6}px;animation-duration:${Math.random()*2+2}s;border-radius:${Math.random()>.5?'50%':'2px'}`;
      document.body.appendChild(el);
      setTimeout(() => el.remove(), 4000);
    }, i * 40);
  }
}

function takaisin() {
  clearInterval(timerInterval); clearInterval(kirjoitusTimer);
  nakyta('screen-setup');
  document.getElementById('aihe').value = '';
  dropZone.classList.remove('has-file');
  fileNameEl.textContent = '';
}

// ── DRAG & DROP ──
const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');
const fileNameEl = document.getElementById('file-name');
const aiheTextarea = document.getElementById('aihe');

const IMAGE_TYPES = ['image/png','image/jpeg','image/jpg','image/webp','image/gif','image/bmp'];

function lueTiedosto(file) {
  if (!file) return;

  const onKuva = IMAGE_TYPES.includes(file.type) ||
    /\.(png|jpe?g|webp|gif|bmp)$/i.test(file.name);

  if (onKuva) {
    // Kuvatiedosto — näytä esikatselu ja analysoi-nappi
    const reader = new FileReader();
    reader.onload = e => {
      document.getElementById('tiedosto-kuva-preview').src = e.target.result;
      document.getElementById('kuva-analysoi-rivi').style.display = 'flex';
      document.getElementById('drop-icon').textContent = '🖼️';
      fileNameEl.textContent = '🖼️ ' + file.name + ' (' + Math.round(file.size/1024) + ' KB)';
      dropZone.classList.add('has-file');

      // Tallenna base64 analysointia varten
      const base64 = e.target.result.split(',')[1];
      const mediaType = file.type || 'image/jpeg';
      document.getElementById('tiedosto-analysoi-btn').onclick = () =>
        analysoiTiedostoKuva(base64, mediaType);
    };
    reader.readAsDataURL(file);
    return;
  }

  // Tekstitiedosto
  document.getElementById('kuva-analysoi-rivi').style.display = 'none';
  document.getElementById('drop-icon').textContent = '📂';
  const reader = new FileReader();
  reader.onload = e => {
    let teksti = e.target.result;
    if (file.name.endsWith('.html') || file.name.endsWith('.htm'))
      teksti = teksti.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    aiheTextarea.value = teksti;
    fileNameEl.textContent = '✅ ' + file.name + ' (' + Math.round(file.size/1024) + ' KB)';
    dropZone.classList.add('has-file');
  };
  reader.readAsText(file, 'UTF-8');
}

async function analysoiTiedostoKuva(base64, mediaType) {
  const apiKey = document.getElementById('api-key').value.trim();
  if (!apiKey) { alert('Syötä ensin API-avain!'); return; }

  const btn = document.getElementById('tiedosto-analysoi-btn');
  const status = document.getElementById('tiedosto-ocr-status');
  btn.disabled = true;
  btn.textContent = '🔍 Analysoidaan...';
  status.textContent = '🔍 Analysoidaan kuvaa...';
  status.className = 'ocr-status lataa';

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true"
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 4096,
        messages: [{
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } },
            { type: "text", text: "Lue tämä kuva tarkasti ja pura kaikki teksti siitä. Säilytä rakenne mahdollisimman hyvin. Jos kuvassa EI ole tekstiä, vastaa AINOASTAAN: \"EI_TEKSTIA\". Muussa tapauksessa palauta AINOASTAAN kuvan teksti." }
          ]
        }]
      })
    });

    const data = await res.json();
    if (data.error) throw new Error(data.error.message);

    const teksti = data.content[0].text.trim();
    if (teksti === 'EI_TEKSTIA' || !teksti) {
      status.textContent = '📷 Kuvassa ei tunnistettu tekstiä — kokeile selkeämpää kuvaa.';
      status.className = 'ocr-status virhe';
      return;
    }

    aiheTextarea.value = teksti;
    vaihdaTab('teksti');
    status.textContent = `✅ Teksti tunnistettu (${teksti.length} merkkiä)!`;
    status.className = 'ocr-status valmis';

  } catch (e) {
    status.textContent = '⚠️ Virhe: ' + e.message;
    status.className = 'ocr-status virhe';
  } finally {
    btn.disabled = false;
    btn.textContent = '🔍 Analysoi teksti kuvasta';
  }
}

fileInput.addEventListener('change', e => lueTiedosto(e.target.files[0]));
dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
dropZone.addEventListener('drop', e => {
  e.preventDefault(); dropZone.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file) lueTiedosto(file);
});

document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && document.getElementById('screen-kirjoitus')?.classList.contains('active')) {
    if (!document.getElementById('kirj-input').disabled) kirjoitusTarkista();
  }
  if (e.key === ' ' && document.getElementById('screen-kortit')?.classList.contains('active')) {
    e.preventDefault();
    if (!document.getElementById('flash-kortti').classList.contains('kaannetty')) kaannaKortti();
  }
});

const savedKey = localStorage.getItem("claude_api_key");
if (savedKey) document.getElementById("api-key").value = savedKey;

// ══ TABS ══
function vaihdaTab(tab) {
  document.querySelectorAll('.input-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.tab === tab);
  });
  document.querySelectorAll('.input-panel').forEach(p => p.classList.remove('active'));
  document.getElementById(`panel-${tab}`).classList.add('active');
  if (tab === 'kamera') aloitaKamera();
  else pysaytaKamera();
}

// ══ KAMERA ══
let kameraStream = null;
let kameraFacing = 'environment'; // takakamera ensin
let otettuKuvaData = null;

async function aloitaKamera() {
  pysaytaKamera();
  try {
    document.getElementById('ocr-status').textContent = '';
    document.getElementById('kuva-esikatselu').style.display = 'none';
    document.getElementById('kamera-wrap').style.display = 'block';
    kameraStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: kameraFacing, width: { ideal: 1920 }, height: { ideal: 1080 } }
    });
    document.getElementById('kamera-video').srcObject = kameraStream;
  } catch (e) {
    document.getElementById('ocr-status').textContent = '⚠️ Kamera ei ole käytettävissä: ' + e.message;
    document.getElementById('ocr-status').className = 'ocr-status virhe';
  }
}

function pysaytaKamera() {
  if (kameraStream) {
    kameraStream.getTracks().forEach(t => t.stop());
    kameraStream = null;
  }
}

async function vaihdaKamera() {
  kameraFacing = kameraFacing === 'environment' ? 'user' : 'environment';
  await aloitaKamera();
}

// Aseta vaihda-nappi oikein (inline onclick ei pysty kutsua async suoraan)
document.addEventListener('DOMContentLoaded', () => {
  const vaihda = document.querySelector('.kamera-btn.vaihda');
  if (vaihda) vaihda.onclick = vaihdaKamera;
});

function otaKuva() {
  const video = document.getElementById('kamera-video');
  const canvas = document.getElementById('kamera-canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext('2d').drawImage(video, 0, 0);
  otettuKuvaData = canvas.toDataURL('image/jpeg', 0.92);

  // Näytä esikatselu
  document.getElementById('kuva-preview').src = otettuKuvaData;
  document.getElementById('kuva-esikatselu').style.display = 'block';
  document.getElementById('kamera-wrap').style.display = 'none';
  document.getElementById('ocr-status').textContent = '✅ Kuva otettu — paina "Analysoi teksti"';
  document.getElementById('ocr-status').className = 'ocr-status valmis';

  pysaytaKamera();

  // Korjaa analysoi-nappi
  document.querySelector('.kuva-btn.analysoi').onclick = analysoiKuva;
}

function uusiKuva() {
  otettuKuvaData = null;
  document.getElementById('kuva-esikatselu').style.display = 'none';
  document.getElementById('ocr-status').textContent = '';
  aloitaKamera();
}

async function analysoiKuva() {
  const apiKey = document.getElementById('api-key').value.trim();
  if (!apiKey) { alert('Syötä ensin API-avain!'); return; }
  if (!otettuKuvaData) { alert('Ota ensin kuva!'); return; }

  const status = document.getElementById('ocr-status');
  status.textContent = '🔍 Analysoidaan kuvaa...';
  status.className = 'ocr-status lataa';

  try {
    const base64 = otettuKuvaData.split(',')[1];
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true"
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 4096,
        messages: [{
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: "image/jpeg", data: base64 }
            },
            {
              type: "text",
              text: "Lue tämä kuva tarkasti ja pura kaikki teksti siitä. Säilytä rakenne (otsikot, kappaleet, listat) mahdollisimman hyvin. Palauta AINOASTAAN kuvan teksti ilman kommentteja tai selityksiä."
            }
          ]
        }]
      })
    });

    const data = await res.json();
    if (data.error) throw new Error(data.error.message);

    const teksti = data.content[0].text.trim();
    document.getElementById('aihe').value = teksti;

    // Vaihda teksti-tabille jotta käyttäjä näkee tuloksen
    vaihdaTab('teksti');

    status.textContent = `✅ Teksti tunnistettu (${teksti.length} merkkiä) — tarkista ja aloita koe!`;
    status.className = 'ocr-status valmis';

  } catch (e) {
    status.textContent = '⚠️ Virhe: ' + e.message;
    status.className = 'ocr-status virhe';
  }
}
// ── OHJE TOGGLE ──
function toggleOhje() {
  const btn = document.getElementById('ohje-toggle');
  const sisalto = document.getElementById('ohje-sisalto');
  btn.classList.toggle('auki');
  sisalto.classList.toggle('nakyva');
}

// ══════════════════════════════════════
// PELIMUOTO 4: MUISTIPELI
// ══════════════════════════════════════
let muistiKortit = [];
let muistiAuki = [];
let muistiLoydetty = 0;
let muistiYritykset = 0;
let muistiEstetty = false;
let muistiPisteet = 0;

function aloitaMuisti() {
  // Luo parit: etupuoli + takapuoli jokaisesta kortista
  const parit = [];
  kysymykset.forEach((k, i) => {
    parit.push({ id: i * 2,     pariId: i, teksti: k.etupuoli  || k.kysymys,  tyyppi: 'kysymys' });
    parit.push({ id: i * 2 + 1, pariId: i, teksti: k.takapuoli || (k.vaihtoehdot ? k.vaihtoehdot[k.oikea] : k.vastaus), tyyppi: 'vastaus' });
  });

  // Sekoita
  muistiKortit = parit.sort(() => Math.random() - 0.5);
  muistiAuki = [];
  muistiLoydetty = 0;
  muistiYritykset = 0;
  muistiEstetty = false;
  muistiPisteet = 0;

  nakyta('screen-muisti');

  const grid = document.getElementById('muisti-grid');
  const total = muistiKortit.length;
  grid.className = 'muisti-grid ' + (total <= 8 ? 'cols-4' : 'cols-6');
  grid.innerHTML = '';

  muistiKortit.forEach((k, idx) => {
    const el = document.createElement('button');
    el.className = 'muisti-kortti';
    el.dataset.idx = idx;
    el.innerHTML = `<div class="muisti-front">❓</div><div class="muisti-back">${k.teksti}</div>`;
    el.onclick = () => muistiKlikkaus(idx);
    grid.appendChild(el);
  });

  paivitaMuistiStats();
}

function muistiKlikkaus(idx) {
  if (muistiEstetty) return;
  const el = document.querySelectorAll('.muisti-kortti')[idx];
  const k = muistiKortit[idx];
  if (el.classList.contains('avoin') || el.classList.contains('loydetty')) return;

  el.classList.add('avoin');
  muistiAuki.push(idx);

  if (muistiAuki.length === 2) {
    muistiEstetty = true;
    muistiYritykset++;
    const [idx1, idx2] = muistiAuki;
    const k1 = muistiKortit[idx1];
    const k2 = muistiKortit[idx2];
    const els = document.querySelectorAll('.muisti-kortti');

    if (k1.pariId === k2.pariId && idx1 !== idx2) {
      // Pari löytyi!
      muistiLoydetty++;
      muistiPisteet += Math.max(50, 100 - muistiYritykset * 2);
      setTimeout(() => {
        els[idx1].classList.add('loydetty');
        els[idx2].classList.add('loydetty');
        muistiAuki = [];
        muistiEstetty = false;
        paivitaMuistiStats();
        if (muistiLoydetty === kysymykset.length) muistiValmis();
      }, 400);
    } else {
      // Ei pari
      els[idx1].classList.add('varin');
      els[idx2].classList.add('varin');
      setTimeout(() => {
        els[idx1].classList.remove('avoin', 'varin');
        els[idx2].classList.remove('avoin', 'varin');
        muistiAuki = [];
        muistiEstetty = false;
      }, 900);
    }
  }
}

function paivitaMuistiStats() {
  const total = kysymykset.length;
  document.getElementById('muisti-progress').textContent = `${muistiLoydetty} / ${total} paria löydetty`;
  document.getElementById('muisti-progress-fill').style.width = `${(muistiLoydetty / total) * 100}%`;
  document.getElementById('muisti-yritykset').textContent = muistiYritykset;
  document.getElementById('muisti-parit').textContent = muistiLoydetty;
  document.getElementById('muisti-pisteet').textContent = muistiPisteet;
  const tarkkuus = muistiYritykset > 0 ? Math.round((muistiLoydetty / muistiYritykset) * 100) : '—';
  document.getElementById('muisti-tarkkuus').textContent = tarkkuus + (muistiYritykset > 0 ? '%' : '');
}

function muistiValmis() {
  nakyta('screen-results');
  const total = kysymykset.length;
  const tarkkuus = Math.round((total / muistiYritykset) * 100);
  const emoji = tarkkuus >= 80 ? '🏆' : tarkkuus >= 60 ? '🎉' : '👍';
  const title = tarkkuus >= 80 ? 'Muistiammattilainen!' : tarkkuus >= 60 ? 'Hienoa työtä!' : 'Ihan hyvä!';
  if (tarkkuus >= 80) konfetti();
  document.getElementById('result-emoji').textContent = emoji;
  document.getElementById('result-title').textContent = title;
  document.getElementById('big-score').textContent = `${muistiPisteet}`;
  document.getElementById('score-label').textContent = `pistettä · ${total} paria · ${tarkkuus}% tarkkuus · ${muistiYritykset} yritystä`;
  document.getElementById('result-breakdown').innerHTML = `
    <div class="breakdown-item" style="justify-content:center;gap:32px;flex-wrap:wrap">
      <div style="text-align:center"><div style="font-size:2rem">🧩</div><div style="font-size:1.4rem;font-weight:900;color:#c084fc">${total}</div><div style="font-size:0.8rem;color:var(--muted)">Paria löydetty</div></div>
      <div style="text-align:center"><div style="font-size:2rem">🎯</div><div style="font-size:1.4rem;font-weight:900;color:#52e8a0">${tarkkuus}%</div><div style="font-size:0.8rem;color:var(--muted)">Tarkkuus</div></div>
      <div style="text-align:center"><div style="font-size:2rem">🔁</div><div style="font-size:1.4rem;font-weight:900;color:#5bc8ff">${muistiYritykset}</div><div style="font-size:0.8rem;color:var(--muted)">Yritystä</div></div>
    </div>`;
}

// ══════════════════════════════════════
// PELIMUOTO 5: JÄRJESTÄ
// ══════════════════════════════════════
let jarjestaIndeksi = 0;
let jarjestaPisteet = 0;
let jarjestaVastaukset = [];
let dragSrcIdx = null;

function aloitaJarjesta() {
  jarjestaIndeksi = 0;
  jarjestaPisteet = 0;
  jarjestaVastaukset = [];
  nakyta('screen-jarjesta');
  naytaJarjestaTehtava();
}

function naytaJarjestaTehtava() {
  if (jarjestaIndeksi >= kysymykset.length) { naytaJarjestaTulokset(); return; }
  const q = kysymykset[jarjestaIndeksi];
  const total = kysymykset.length;

  document.getElementById('jarjesta-progress').textContent = `Tehtävä ${jarjestaIndeksi + 1} / ${total}`;
  document.getElementById('jarjesta-progress-fill').style.width = `${(jarjestaIndeksi / total) * 100}%`;
  document.getElementById('jarjesta-pisteet').textContent = jarjestaPisteet;
  document.getElementById('jarjesta-kysymys').textContent = q.kysymys;
  document.getElementById('jarjesta-feedback').style.display = 'none';
  document.getElementById('jarjesta-next').classList.remove('visible');

  // Sekoita vaihtoehdot
  const vaihtoehdot = [...q.vaihtoehdot];
  const sekoitettu = [...vaihtoehdot].sort(() => Math.random() - 0.5);

  const lista = document.getElementById('jarjesta-lista');
  lista.innerHTML = '';
  sekoitettu.forEach((v, i) => {
    const item = document.createElement('div');
    item.className = 'jarjesta-item';
    item.draggable = true;
    item.dataset.teksti = v;
    item.innerHTML = `<span class="jarjesta-handle">⠿</span><span class="jarjesta-num">${i + 1}</span><span>${v}</span>`;
    item.addEventListener('dragstart', e => { dragSrcIdx = i; item.classList.add('dragging'); });
    item.addEventListener('dragend', () => { item.classList.remove('dragging'); paivitaJarjestaNumerot(); });
    item.addEventListener('dragover', e => { e.preventDefault(); item.classList.add('drag-over'); });
    item.addEventListener('dragleave', () => item.classList.remove('drag-over'));
    item.addEventListener('drop', e => {
      e.preventDefault();
      item.classList.remove('drag-over');
      const items = [...lista.querySelectorAll('.jarjesta-item')];
      const draggedEl = items[dragSrcIdx];
      const targetEl = item;
      if (draggedEl !== targetEl) {
        const allItems = [...lista.children];
        const dragIdx = allItems.indexOf(draggedEl);
        const targetIdx = allItems.indexOf(targetEl);
        if (dragIdx < targetIdx) lista.insertBefore(draggedEl, targetEl.nextSibling);
        else lista.insertBefore(draggedEl, targetEl);
      }
      paivitaJarjestaNumerot();
    });
    lista.appendChild(item);
  });
}

function paivitaJarjestaNumerot() {
  document.querySelectorAll('.jarjesta-item').forEach((item, i) => {
    item.querySelector('.jarjesta-num').textContent = i + 1;
  });
}

function jarjestaTarkista() {
  const q = kysymykset[jarjestaIndeksi];
  const items = [...document.querySelectorAll('.jarjesta-item')];
  const kaytettyJarjestys = items.map(el => el.dataset.teksti);
  const oikeaJarjestys = q.vaihtoehdot;

  let oikein = 0;
  items.forEach((item, i) => {
    if (kaytettyJarjestys[i] === oikeaJarjestys[i]) {
      item.classList.add('oikein');
      oikein++;
    } else {
      item.classList.add('vaarin');
    }
    item.draggable = false;
  });

  const kaikki = oikein === oikeaJarjestys.length;
  if (kaikki) jarjestaPisteet += 150;
  else if (oikein >= oikeaJarjestys.length - 1) jarjestaPisteet += 75;

  jarjestaVastaukset.push({ kysymys: q.kysymys, oikein: kaikki, oikeita: oikein, total: oikeaJarjestys.length });

  const fb = document.getElementById('jarjesta-feedback');
  fb.textContent = kaikki ? `✅ Täydellinen! +150 pistettä` : `📊 ${oikein}/${oikeaJarjestys.length} oikeassa kohdassa${oikein > 0 ? ' +75 pistettä' : ''}`;
  fb.className = `feedback-bar ${kaikki ? 'oikein' : 'vaarin'}`;
  fb.style.display = 'block';
  document.getElementById('jarjesta-pisteet').textContent = jarjestaPisteet;
  document.getElementById('jarjesta-next').classList.add('visible');
  document.querySelector('.jarjesta-tarkista').disabled = true;
}

function jarjestaSeuraava() {
  jarjestaIndeksi++;
  document.querySelector('.jarjesta-tarkista').disabled = false;
  naytaJarjestaTehtava();
}

function naytaJarjestaTulokset() {
  nakyta('screen-results');
  const total = jarjestaVastaukset.length;
  const taydellisia = jarjestaVastaukset.filter(v => v.oikein).length;
  const prosentti = Math.round((taydellisia / total) * 100);
  let emoji = '😅', title = 'Harjoittele lisää!';
  if (prosentti >= 80) { emoji = '🏆'; title = 'Järjestelymestari!'; konfetti(); }
  else if (prosentti >= 60) { emoji = '🎉'; title = 'Hienoa työtä!'; }
  else if (prosentti >= 40) { emoji = '👍'; title = 'Ihan hyvä!'; }
  document.getElementById('result-emoji').textContent = emoji;
  document.getElementById('result-title').textContent = title;
  document.getElementById('big-score').textContent = `${jarjestaPisteet}`;
  document.getElementById('score-label').textContent = `pistettä · ${taydellisia}/${total} täydellisesti oikein`;
  const bd = document.getElementById('result-breakdown');
  bd.innerHTML = '';
  jarjestaVastaukset.forEach((v, i) => {
    const item = document.createElement('div');
    item.className = 'breakdown-item';
    item.innerHTML = `<div class="breakdown-icon">${v.oikein ? '✅' : '⚠️'}</div><div><div class="breakdown-q">${i+1}. ${v.kysymys}</div><div class="breakdown-a ${v.oikein ? 'oikein' : 'vaarin'}">${v.oikein ? 'Täydellinen järjestys!' : `${v.oikeita}/${v.total} oikeassa kohdassa`}</div></div>`;
    bd.appendChild(item);
  });
}

// ── PÄIVITETTY aloitaKoe ──
// Lisää uudet pelimuodot routing-logiikkaan
const _origAloita = window.aloitaKoe;

// Päivitä routing pelimuodoille muisti, jarjesta, aikapaine
const _patchRouting = () => {
  const origParse = (teksti, muoto) => {
    let t = teksti.trim()
      .replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
    return JSON.parse(t);
  };

  // Patch prompt generation and routing for new modes
  const origAloita = aloitaKoe;
};

// Extend aloitaKoe to handle new modes and their prompts
(function() {
  const orig = aloitaKoe;
  window.aloitaKoe = async function() {
    // For new modes that need different data format, we patch the prompt + routing
    if (!['muisti','jarjesta'].includes(pelimuoto)) {
      return orig.apply(this, arguments);
    }

    const apiKey = document.getElementById('api-key').value.trim();
    const aihe = document.getElementById('aihe').value.trim();
    const maara = document.getElementById('maara').value;
    const vaikeus = document.getElementById('vaikeus').value;

    if (!apiKey) { alert('Syötä API-avain!'); return; }
    if (!aihe) { alert('Lisää teksti tai lataa tiedosto!'); return; }

    localStorage.setItem('claude_api_key', apiKey);
    nakyta('screen-loading');

    let prompt;
    if (pelimuoto === 'muisti') {
      prompt = `Luo ${maara} käsite-vastaus-paria muistipeliin AINOASTAAN seuraavan tekstin sisällöstä.

TEKSTI:
${aihe}

Vastaa AINOASTAAN validilla JSON-taulukolla (ei muuta tekstiä):
[{"etupuoli":"Käsite","takapuoli":"Lyhyt vastaus (max 5 sanaa)","selitys":""}]`;
    } else if (pelimuoto === 'jarjesta') {
      prompt = `Luo ${maara} järjestystehtävää AINOASTAAN seuraavan tekstin sisällöstä. Vaikeustaso: ${vaikeus}.
Jokaisessa tehtävässä on 4 vaihtoehtoa jotka pitää järjestää oikeaan järjestykseen (esim. aikajärjestykseen, tärkeysjärjestykseen tai loogiseen järjestykseen).

TEKSTI:
${aihe}

Vastaa AINOASTAAN validilla JSON-taulukolla (ei muuta tekstiä):
[{"kysymys":"Järjestä nämä oikeaan järjestykseen:","vaihtoehdot":["1. asia","2. asia","3. asia","4. asia"]}]

TÄRKEÄÄ: vaihtoehdot-taulukon järjestys ON oikea järjestys. Sekoitan sen pelaajalle automaattisesti.`;
    }

    const streamBox = document.getElementById('stream-box');
    const tokenCount = document.getElementById('token-count');
    const loadingSub = document.getElementById('loading-sub');
    streamBox.classList.add('active');
    streamBox.innerHTML = '<span class="stream-cursor"></span>';
    loadingSub.textContent = 'AI luo sisältöä...';

    try {
      const kysymysMaara = parseInt(maara);
      const tokensPerQNew = pelimuoto === 'jarjesta' ? 200 : 80;
      const arvioituTokenit = kysymysMaara * tokensPerQNew + 400;
      const maxTokens = Math.min(arvioituTokenit, 4096);

      const [ohjeOsa, tekstiOsa] = prompt.split('TEKSTI:\n');
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "anthropic-beta": "prompt-caching-2024-07-31",
          "anthropic-dangerous-direct-browser-access": "true"
        },
        body: JSON.stringify({
          model: "claude-haiku-4-5-20251001",
          max_tokens: maxTokens,
          stream: true,
          system: [{ type: "text", text: "Olet opettavainen koe-generaattori. Vastaat AINOASTAAN validilla JSON-taulukolla.", cache_control: { type: "ephemeral" } }],
          messages: [{ role: "user", content: [
            { type: "text", text: tekstiOsa || '', cache_control: { type: "ephemeral" } },
            { type: "text", text: ohjeOsa }
          ]}]
        })
      });

      if (!res.ok) { const err = await res.json(); throw new Error(err.error?.message || 'API-virhe'); }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let kertynyt = '', tokeneja = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        for (const rivi of decoder.decode(value, { stream: true }).split('\n')) {
          if (!rivi.startsWith('data: ')) continue;
          const data = rivi.slice(6).trim();
          if (data === '[DONE]') continue;
          try {
            const event = JSON.parse(data);
            if (event.type === 'message_start' && event.message?.usage) {
              const u = event.message.usage;
              tokenCount.dataset.sisaan = u.input_tokens || 0;
              tokenCount.dataset.cache_luettu = u.cache_read_input_tokens || 0;
              tokenCount.dataset.cache_luotu = u.cache_creation_input_tokens || 0;
              paivitaTokeniNaytto(tokenCount, tokeneja);
            } else if (event.type === 'message_delta' && event.usage) {
              tokenCount.dataset.ulos = event.usage.output_tokens || 0;
              paivitaTokeniNaytto(tokenCount, tokeneja);
            } else if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
              kertynyt += event.delta.text;
              tokeneja++;
              streamBox.innerHTML = kertynyt.slice(-300).replace(/</g, '&lt;') + '<span class="stream-cursor"></span>';
              streamBox.scrollTop = streamBox.scrollHeight;
              paivitaTokeniNaytto(tokenCount, tokeneja);
            }
          } catch (_) {}
        }
      }

      streamBox.classList.remove('active');
      tokenCount.textContent = '';
      loadingSub.textContent = 'Analysoidaan tekstiä ja luodaan sisältö';

      let teksti = kertynyt.trim()
        .replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();

      kysymykset = JSON.parse(teksti);
      nykyinen = 0; pisteet = 0; vastaukset = [];
      aikaJaljella = parseInt(document.getElementById('aika').value);

      if (pelimuoto === 'muisti') aloitaMuisti();
      else if (pelimuoto === 'jarjesta') aloitaJarjesta();

    } catch (e) {
      nakyta('screen-setup');
      alert('Virhe: ' + e.message);
    }
  };
})();

// Kirjoituspeli Enter (varmistetaan)
document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && document.getElementById('screen-kirjoitus')?.classList.contains('active')) {
    if (!document.getElementById('kirj-input').disabled) kirjoitusTarkista();
  }
});