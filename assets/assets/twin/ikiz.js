// Bütün kampüsün izometrik dijital ikizi: uydu + arazi + OSM binaları. Flutter'la "Ikiz" kanalı ve window.ikiz ile konuşur.
(() => {
  const V = window.IKIZ_VERI;
  const $ = (id) => document.getElementById(id);
  const azHareket = matchMedia('(prefers-reduced-motion: reduce)').matches;
  // Web sürümünde sayfa Flutter'ın içinde bir iframe'dir: "Ikiz" kanalı yerine üst pencereyle postMessage konuşulur
  if (!window.Ikiz && window.parent !== window) {
    window.Ikiz = { postMessage: (s) => window.parent.postMessage(s, location.origin) };
    addEventListener('message', (e) => {
      const d = e.data;
      if (e.origin !== location.origin || e.source !== window.parent || !d || typeof d.ikizCagri !== 'string') return;
      const f = window.ikiz && window.ikiz[d.ikizCagri];
      if (typeof f === 'function') f(...(d.arg || []));
    });
  }
  const flutter = (m) => window.Ikiz && window.Ikiz.postMessage(JSON.stringify(m));

  // --- Dil: Türkçe / İngilizce. Uygulamanın içindeyken seçim Flutter'dadır (dilAyarla ile gelir, düğme oraya iletir);
  // sayfa tek başına açıldıysa seçim tarayıcıda saklanır. Yer adları assets/twin/adlar.js'den çevrilir.
  let dil = 'tr';
  const adresDili = new URLSearchParams(location.search).get('dil');
  if (adresDili === 'en' || adresDili === 'tr') dil = adresDili;
  else try { if (!window.Ikiz && localStorage.getItem('ikizDil') === 'en') dil = 'en'; } catch (_) { /* depolama kapalı */ }
  const dl = (tr, en) => (dil === 'en' ? en : tr);
  const adCevir = (ad) => (dil === 'en' && window.IKIZ_ADLAR && window.IKIZ_ADLAR[ad]) || ad;
  const yerelAyar = () => (dil === 'en' ? 'en-GB' : 'tr-TR');
  // uyarı görünürken sol üstteki durum paneli onun altına kayar (--uyari-h, ikiz.css)
  const uyariGoster = (metin) => {
    $('uyari').hidden = !metin;
    $('uyari').textContent = metin || '';
    document.documentElement.style.setProperty('--uyari-h', metin ? `${$('uyari').offsetHeight + 8}px` : '0px');
  };
  // ?debug: kare hızı ve çözünürlük göstergesi (sunumda izleyici görmesin)
  const HATA_AYIKLA = new URLSearchParams(location.search).has('debug');
  if (HATA_AYIKLA) for (const id of ['hFps', 'hDpr']) $(id).hidden = false;

  // Betikler inmediyse (bozuk önbellek, yarım kurulum) sebebi doğru söylenir; eskiden "WebGL yok" deniyordu
  if (!window.maplibregl || !V || !window.IKIZ_YOL || !window.IKIZ_MODEL) {
    console.error('ikiz: betik eksik', { maplibre: !!window.maplibregl, veri: !!V, yol: !!window.IKIZ_YOL, model: !!window.IKIZ_MODEL });
    uyariGoster(dl('Harita dosyaları yüklenemedi. Sayfayı yenileyin; sürerse uygulamayı yeniden başlatın.',
      'The map files failed to load. Reload the page; if it persists, restart the app.'));
    return;
  }

  // Yalnızca kampüs: sınırın dışındaki çevre binaları, etiketleri ve uydu görüntüsü gizlenir (katmanlardan açılabilir)
  const SINIR = V.sinir.geometry.coordinates[0];
  function sinirIcinde([x, y]) {
    let ic = false;
    for (let i = 0, j = SINIR.length - 1; i < SINIR.length; j = i++) {
      const [xi, yi] = SINIR[i], [xj, yj] = SINIR[j];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) ic = !ic;
    }
    return ic;
  }
  const sinirKutu = SINIR.reduce((k, [x, y]) => [Math.min(k[0], x), Math.min(k[1], y), Math.max(k[2], x), Math.max(k[3], y)], [180, 90, -180, -90]);
  let cevreAcik = false;

  const UYDU = {
    type: 'raster',
    tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
    tileSize: 256,
    maxzoom: 18,
    attribution: 'Uydu: Esri, Maxar, Earthstar Geographics',
  };
  // Kampüs görünümünde uydu paftaları yalnızca kampüs kutusundan iner (dışarısı zaten örtülü); "Kampüs çevresi" açılınca
  // sınırsız kaynağa geçilir
  const UYDU_KAMPUS = { ...UYDU, bounds: [sinirKutu[0] - 0.002, sinirKutu[1] - 0.002, sinirKutu[2] + 0.002, sinirKutu[3] + 0.002] };
  const DEM = {
    type: 'raster-dem',
    tiles: ['https://elevation-tiles-prod.s3.amazonaws.com/terrarium/{z}/{x}/{y}.png'],
    encoding: 'terrarium',
    tileSize: 256,
    maxzoom: 14,
    attribution: 'Yükselti: Mapzen/AWS Terrain Tiles',
  };
  const ARAZI = { source: 'dem', exaggeration: 1 };
  // Uydu inmezse zemin bu düz renkle görünür (siyah ya da boş değil)
  const ZEMIN_RENK = '#d3d8c6';
  // Sunum sahnesi. Gündüz: kampüsün çevresi de uydu görüntüsüdür ama üstünde açık bir tül vardır (kampüs öne çıkar,
  // çevre aydınlık ve gerçekçi kalır), gökyüzü açık mavi, uzaklar açık sise karışır. Gece: çevre koyu, düz zemin.
  const SAHNE = { zemin: '#f2efe6', zeminTul: 0.5, geceZemin: '#03070e', sis: '#e3e9ec', ufuk: '#e8eff4', gok: '#8dbbe6' };
  // açılış kamerası; merkez ve yakınlık kampusKamerasi() ile ekrana göre hesaplanır
  const ACILIS = { center: [38.4405, 38.3285], zoom: 15.15, pitch: 58, bearing: 15 };
  // uydu yeşilleri zaten doygun: artırınca çimenler yapay, fosforlu durur
  const UYDU_DOYGUNLUK = -0.04;
  const TAC_ALTI = '#33402a';

  const CEPHE_RENK = ['#43a047', '#f9a825', '#e53935'];
  // varsayılan görünümdeki durum tonları (ikiz.css'teki --is ve --asinmis-ton ile aynı)
  const IS_TON = '#ff8f1f';
  const ASINMIS_TON = '#c0504a';
  const cepheAdi = (c) => [dl('Sağlam', 'Sound'), dl('Yenilenmeli', 'Needs renewal'), dl('Aşınmış', 'Worn')][c];
  const tipAdi = (tip) => ({
    hastane: dl('Hastane', 'Hospital'), egitim: dl('Eğitim binası', 'Teaching building'), salon: dl('Salon', 'Hall'),
    yurt: dl('Yurt', 'Dormitory'), yemekhane: dl('Yemekhane', 'Dining hall'),
  })[tip];
  const cephe = {};            // oid -> 0/1/2; Flutter oyun durumunu gönderene kadar başlangıç verisi
  V.binalar.features.forEach((f, i) => {
    f.id = i;
    if (f.properties.oid) cephe[f.properties.oid] = f.properties.c ?? 0;
    const halka = f.geometry.coordinates[0];
    const orta = halka.reduce((a, p) => [a[0] + p[0] / halka.length, a[1] + p[1] / halka.length], [0, 0]);
    f.properties.ic = f.properties.oid || sinirIcinde(orta) ? 1 : 0;
  });
  // dünya çerçevesi, ortasında kampüs deliği: dışarısı koyulaştırılır
  const DIS = { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [
    [[V.kutu[0] - 1, V.kutu[1] - 1], [V.kutu[2] + 1, V.kutu[1] - 1], [V.kutu[2] + 1, V.kutu[3] + 1], [V.kutu[0] - 1, V.kutu[3] + 1], [V.kutu[0] - 1, V.kutu[1] - 1]],
    // delik dış halkanın (saat yönünün tersi) tersine dönmeli
    SINIR.reduce((a, p, i) => { const q = SINIR[(i + 1) % SINIR.length]; return a + (q[0] - p[0]) * (q[1] + p[1]); }, 0) > 0 ? SINIR : SINIR.slice().reverse(),
  ] } };
  const icFiltre = () => (cevreAcik ? null : ['==', ['get', 'ic'], 1]);
  // Karbon yoğunluğu katmanı: oid -> kg CO₂e/m²·yıl (Flutter gönderir; bina tipine ve yapılan işlere göre değişir)
  const karbon = {};
  const RAMPA = [[0x43, 0xa0, 0x47], [0xf9, 0xa8, 0x25], [0xe5, 0x39, 0x35]];
  function rampaRengi(t) {   // 0 yeşil -> 0,5 sarı -> 1 kırmızı
    const k = Math.max(0, Math.min(1, t)) * 2, i = Math.min(1, Math.floor(k)), f = k - i;
    return '#' + RAMPA[i].map((v, j) => Math.round(v + (RAMPA[i + 1][j] - v) * f).toString(16).padStart(2, '0')).join('');
  }
  function karbonAraligi() {
    const d = Object.values(karbon);
    return d.length ? [Math.min(...d), Math.max(...d)] : [0, 1];
  }
  // oid -> o binanın taban parçaları (Turgut Özal gibi üç bina iki parçalı: boya hepsine gitmeli)
  const binaOid = {};
  V.binalar.features.forEach((f) => { if (f.properties.oid) (binaOid[f.properties.oid] ??= []).push(f); });
  const parcalar = (oid) => binaOid[oid] || [];   // Flutter'dan bilinmeyen kimlik gelirse boş: boyama durmasın

  // Çizim çözünürlüğü ekrana göre: her kare (en × boy × dpr²) piksel boyanır. Tümleşik GPU'da (Intel, telefon) büyük
  // ekran (1440p, 4K) bütçeyi aşınca dpr düşürülür; görüntü biraz yumuşar ama kare hızı ekran boyundan bağımsız kalır.
  const PIKSEL_BUTCE = (() => {
    try {
      const gl = document.createElement('canvas').getContext('webgl2');
      const ek = gl && gl.getExtension('WEBGL_debug_renderer_info');
      const ad = ek ? gl.getParameter(ek.UNMASKED_RENDERER_WEBGL) : '';
      if (gl) { const k = gl.getExtension('WEBGL_lose_context'); if (k) k.loseContext(); }   // geçici bağlamı bırak
      if (/nvidia|geforce|quadro|radeon rx|radeon pro|apple m\d/i.test(ad)) return 6e6;
      if (/intel|uhd|iris|mali|adreno|powervr|swiftshader|llvmpipe|microsoft basic/i.test(ad)) return 2.1e6;
    } catch (_) { /* bilinmiyor */ }
    return 3e6;
  })();
  const ekranDpr = (ust) => Math.max(0.6,
    Math.min(devicePixelRatio, ust, Math.sqrt(PIKSEL_BUTCE / Math.max(1, innerWidth * innerHeight))));

  // Bina gölgesi taban izinin kaydırılmasıdır: güneşin tersine, alçak güneşte uzar (en çok 3 kat). Haritada x doğu,
  // y güney (piksel); güneş vektöründe y kuzey. Katsayılar eski sabit gölgeyle (z14'te ~1, z19'da ~31 px) aynı boyu verir.
  function golgeKaymasi(v) {
    let x = -v[0] / v[2], y = -v[1] / v[2];
    const l = Math.hypot(x, y), en = 1.1;
    if (l > en) { x *= en / l; y *= en / l; }
    return ['interpolate', ['exponential', 2], ['zoom'], 14, ['literal', [x * 0.975, -y * 0.975]], 19, ['literal', [x * 30.6, -y * 30.6]]];
  }

  let harita;
  try {
    harita = new maplibregl.Map({
      container: 'harita',
      attributionControl: false,
      minZoom: 12.8,   // dar, uzun ekranda kampüsün tamamı ~13,3'te sığar
      maxZoom: 19,   // uydu görüntüsü z18; daha yakında bulanıklaşır
      maxPitch: 78,
      maxBounds: [[sinirKutu[0] - 0.02, sinirKutu[1] - 0.016], [sinirKutu[2] + 0.02, sinirKutu[3] + 0.016]],
      canvasContextAttributes: { antialias: true },
      // 2× çözünürlük tümleşik GPU'da kareyi dörde katlıyordu; 1,5 üstü gözle seçilmiyor
      pixelRatio: ekranDpr(1.5),
      center: ACILIS.center,
      zoom: azHareket ? ACILIS.zoom : 14.3,
      pitch: azHareket ? ACILIS.pitch : 20,
      bearing: azHareket ? ACILIS.bearing : -70,
      style: {
        version: 8,
        // boya geçişi anlık: arazi dokuları geçişin ilk karesinde (henüz aydınlıkken) saklanıp gece modunu bozuyordu
        transition: { duration: 0, delay: 0 },
        sources: {
          uydu: UYDU_KAMPUS,
          'uydu-cevre': UYDU,
          dem: DEM,
          binalar: { type: 'geojson', data: V.binalar, attribution: '© OpenStreetMap katkıda bulunanlar' },
          yollar: { type: 'geojson', data: V.yollar },
          bolgeler: { type: 'geojson', data: V.bolgeler },
          sinir: { type: 'geojson', data: V.sinir, attribution: window.IKIZ_AGAC ? 'Ağaçlar: Meta & WRI taç yüksekliği (CC BY 4.0), bahçeler uydu görüntüsünden' : undefined },
          dis: { type: 'geojson', data: DIS },
          taclar: { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: (window.IKIZ_AGAC && window.IKIZ_AGAC.tac) || { type: 'MultiPolygon', coordinates: [] } } },
        },
        terrain: ARAZI,
        sky: { 'sky-color': SAHNE.gok, 'horizon-color': SAHNE.ufuk, 'fog-color': SAHNE.sis, 'fog-ground-blend': 0.55, 'horizon-fog-blend': 0.7, 'sky-horizon-blend': 0.8, 'atmosphere-blend': 0 },
        light: { anchor: 'map', position: [1.3, 215, 42], color: '#fff6e6', intensity: 0.42 },
        layers: [
          { id: 'zemin', type: 'background', paint: { 'background-color': ZEMIN_RENK } },
          { id: 'uydu', type: 'raster', source: 'uydu', paint: { 'raster-fade-duration': 0, 'raster-contrast': 0.08, 'raster-saturation': UYDU_DOYGUNLUK } },
          // fotoğraftaki ağaç lekeleri (3B taçların altı) gölge tonuna boyanır: eğik bakışta yere dökülmüş çimen/ot gibi durmaz
          { id: 'tac-alti', type: 'fill', source: 'taclar', paint: { 'fill-color': TAC_ALTI, 'fill-opacity': 0.5, 'fill-antialias': true, 'fill-outline-color': 'rgba(0,0,0,0)' } },
          // gece yolları örtünün altında: kampüs dışında kalan parçaları görünmez (çevre açılınca örtü kalkar)
          { id: 'gece-yol-isik', type: 'line', source: 'yollar', layout: { visibility: 'none', 'line-cap': 'round', 'line-join': 'round' },
            paint: { 'line-color': '#ffb15c', 'line-blur': 5, 'line-opacity': 0.55,
              'line-width': ['interpolate', ['exponential', 2], ['zoom'], 14, ['match', ['get', 's'], 1, 5, 2, 3, 1.5], 19, ['match', ['get', 's'], 1, 60, 2, 34, 16]] } },
          { id: 'gece-yol', type: 'line', source: 'yollar', layout: { visibility: 'none', 'line-cap': 'round', 'line-join': 'round' },
            paint: { 'line-color': '#ffd9a0', 'line-opacity': 0.9,
              'line-width': ['interpolate', ['exponential', 2], ['zoom'], 14, ['match', ['get', 's'], 1, 1.2, 2, 0.7, 0.3], 19, ['match', ['get', 's'], 1, 8, 2, 5, 2]] } },
          { id: 'dis', type: 'fill', source: 'dis', paint: { 'fill-color': SAHNE.zemin, 'fill-opacity': SAHNE.zeminTul, 'fill-antialias': false } },
          { id: 'sinir-isik', type: 'line', source: 'sinir', paint: { 'line-color': '#5fdccb', 'line-width': 9, 'line-blur': 7, 'line-opacity': 0.4 } },
          // Bina gölgesi: taban izi güneşin ters yönüne (kuzeybatı, uydu görüntüsündeki gölgelerle aynı) kaydırılır
          { id: 'golge', type: 'fill', source: 'binalar', filter: icFiltre(),
            paint: { 'fill-color': '#0a1020', 'fill-opacity': 0.1, 'fill-translate-anchor': 'map',
              'fill-translate': golgeKaymasi([0.45, -0.55, 0.7]) } },   // GUNES ile aynı (o daha aşağıda tanımlı)
          { id: 'bolge-dolgu', type: 'fill', source: 'bolgeler', paint: { 'fill-color': '#5fdccb', 'fill-opacity': 0 } },
          { id: 'bolge-cizgi', type: 'line', source: 'bolgeler', paint: { 'line-color': '#5fdccb', 'line-width': 1.4, 'line-opacity': 0.55, 'line-dasharray': [3, 2] } },
          // yolunda iş süren bölgeler: turuncu tül ve kenar (isaretAyarla süzgeci günceller)
          { id: 'bolge-is', type: 'fill', source: 'bolgeler', filter: ['in', ['get', 'id'], ['literal', []]],
            paint: { 'fill-color': IS_TON, 'fill-opacity': 0.16 } },
          { id: 'bolge-is-cizgi', type: 'line', source: 'bolgeler', filter: ['in', ['get', 'id'], ['literal', []]],
            paint: { 'line-color': IS_TON, 'line-width': 3, 'line-opacity': 0.9 } },
          { id: 'sinir', type: 'line', source: 'sinir', paint: { 'line-color': '#ffffff', 'line-width': 1.6, 'line-opacity': 0.6 } },
          { id: 'binalar', type: 'fill-extrusion', source: 'binalar', filter: icFiltre(),
            paint: { 'fill-extrusion-color': ['get', 'r'], 'fill-extrusion-height': ['get', 'h'], 'fill-extrusion-base': 0,
              'fill-extrusion-opacity': 0.97, 'fill-extrusion-vertical-gradient': true } },
        ],
      },
    });
  } catch (hata) {
    console.error('ikiz: harita kurulamadı', hata);
    let webgl2 = false;
    try { webgl2 = !!document.createElement('canvas').getContext('webgl2'); } catch (_) { /* yok */ }
    uyariGoster(webgl2
      ? dl('3B harita açılamadı. Sayfayı yenileyin.', 'The 3D map could not be opened. Reload the page.')
      : dl('Bu cihaz 3B haritayı açamadı: WebGL2 kullanılamıyor.', 'This device cannot open the 3D map: WebGL2 is unavailable.'));
    return;
  }

  const kunye = new maplibregl.AttributionControl({ compact: innerWidth < 720 });
  harita.addControl(kunye, 'bottom-left');

  // Arazi açıkken MapLibre kamera her oynadığında araziyi iki kez daha, derinlik ve koordinat dokularına çizer. Bunlar
  // yalnızca maplibregl.Marker'ın örtülmesi ve imleçle yer seçimi içindir; burada Marker yok, seçim (sürükleme, tıklama)
  // ise gerektiğinde kesin=true ile kendisi çizdirir. Hareketli kare 1600×900'de ~31'den ~25 ms'ye iner.
  const ressam = harita.painter;
  if (ressam && typeof ressam.maybeDrawDepthAndCoords === 'function') {
    const asil = ressam.maybeDrawDepthAndCoords;
    ressam.maybeDrawDepthAndCoords = function (kesin) { if (kesin) return asil.call(this, kesin); };
  }

  // --- Ekrandaki işaretler. maplibregl.Marker arazi açıkken işaret başına GPU'dan piksel okur (readPixels) ve kareleri
  // durdurur; burada yalnızca görünen işaretlerin konumu yazılır. Sürükleme haritaya geçsin diye tuval kabındadırlar.
  const noktalar = [];

  function konumla(n) {
    const p = harita.project(n.c);
    n.el.style.transform = `translate(${p.x}px, ${p.y}px) ${n.kay}`;
  }

  function noktaEkle(el, c, kay) {
    const n = { el, c, kay, acik: false };
    el.classList.add('nokta', 'gizli');
    harita.getCanvasContainer().append(el);
    noktalar.push(n);
    return n;
  }

  function goster(n, acik) {
    if (n.acik === acik) return;
    n.acik = acik;
    n.el.classList.toggle('gizli', !acik);
    if (acik) konumla(n);
  }

  const ekranda = (c, ust = 0) => {
    const p = harita.project(c);
    return p.x > 0 && p.x < innerWidth && p.y > ust && p.y < innerHeight;
  };

  // --- 3B binalar: GLB modelleri + üretilmiş cepheler (scripts/ikiz_model.py), tek köşe tamponu, iki çizim çağrısı
  const KOSE_VS = `#version 300 es
  layout(location=0) in vec3 a_p;
  layout(location=1) in vec3 a_n;
  layout(location=2) in vec3 a_c;
  layout(location=3) in float a_l;
  layout(location=4) in float a_b;
  layout(location=5) in vec2 a_d;
  uniform highp mat4 u_m;
  uniform highp sampler2D u_taban;
  uniform float u_duz;
  out vec3 v_n; out vec3 v_c; out vec2 v_d; out vec3 v_p;
  flat out float v_l; flat out int v_b;
  void main() {
    vec3 p = a_p * 0.1;
    // arazi yokken (yükselti paftaları inmedi) bina kendi tabanına iner: düz zeminde havada durmaz
    if (u_duz > 0.5) { int b = int(a_b); p.z -= texelFetch(u_taban, ivec2(b % 256, b / 256), 0).r; }
    gl_Position = u_m * vec4(p, 1.0);
    v_n = a_n; v_c = a_c; v_d = a_d * 0.1; v_p = p; v_l = a_l; v_b = int(a_b);
  }`;
  const PARCA_FS = `#version 300 es
  precision highp float;
  in vec3 v_n; in vec3 v_c; in vec2 v_d; in vec3 v_p;
  flat in float v_l; flat in int v_b;
  uniform sampler2D u_ton;
  uniform vec3 u_gunes;
  uniform vec3 u_gunRenk;
  uniform float u_gece;
  uniform float u_saydam;
  out vec4 renk;
  float karistir(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  void main() {
    vec3 n = normalize(v_n);
    if (!gl_FrontFacing) n = -n;
    float gun = max(dot(n, u_gunes), 0.0);
    float gok = 0.5 + 0.5 * n.z;
    vec3 isik = mix(vec3(0.57, 0.59, 0.63) * (0.62 + 0.38 * gok) + u_gunRenk * gun * 0.95,
                    vec3(0.10, 0.13, 0.22) * (0.55 + 0.45 * gok) + vec3(0.10, 0.13, 0.24) * gun, u_gece);
    vec3 c = v_c;
    vec3 yanan = vec3(0.0);
    if (v_l > 1.5) {
      // üretilmiş cephe: kat ve aks ızgarası; uzaktan titrememesi için ortalama tona geçer
      vec2 boy = vec2(3.3, 3.05);
      vec2 g = v_d / boy;
      vec2 hucre = floor(g), f = fract(g);
      float uzak = clamp(max(fwidth(g.x), fwidth(g.y)) * 2.2 - 0.4, 0.0, 1.0);
      float pencere = step(0.24, f.x) * step(f.x, 0.76) * step(0.28, f.y) * step(f.y, 0.74);
      pencere = mix(pencere, 0.24, uzak);
      c = mix(c, vec3(0.20, 0.25, 0.31), pencere);
      float acik = step(0.56, karistir(hucre + float(v_b) * 0.37));
      yanan = vec3(1.0, 0.76, 0.42) * pencere * mix(acik, 0.44, uzak) * u_gece * 1.15;
    } else if (v_l > 0.5) {
      float acik = step(0.42, karistir(floor(vec2(v_p.x + v_p.y, v_p.z) / 3.2) + float(v_b)));
      yanan = vec3(1.0, 0.78, 0.46) * mix(0.1, 0.95, acik) * u_gece;
    }
    vec4 t = texelFetch(u_ton, ivec2(v_b % 256, v_b / 256), 0);
    if (t.a > 0.0 && t.a < 0.01) discard;   // kampüs dışı bina (ton dokusunda alfa 1/255)
    vec3 son = c * isik + yanan;
    son = mix(son, t.rgb * (0.55 + 0.45 * gok + gun * 0.35), t.a);
    renk = vec4(son, 1.0) * u_saydam;
  }`;

  // --- Ağaçlar: taç yüksekliği haritasından (scripts/ikiz_agac.py) gerçek konum ve boy; tek ağaç modeli, örnekli çizim.
  // Taç yumuşak gölgelenen bir elipsoid (bir kez bölünmüş, hafifçe sarsılmış ikosahedron), gövde beşgen prizma, yerde
  // yumuşak gölge. Boyut, dönüş ve ton ağaç başına değişir. Güneş, uydu görüntüsündeki gölgelerle aynı yönden
  // (güneydoğu) gelir; binalar da aynı ışıkla aydınlanır.
  // Uygulamanın içindeyken güneş oyun saatiyle hareket eder (gunesAyarla): yön, ışığın rengi ve gölgelerin gücü.
  // Uydu fotoğrafındaki gölgeler sabittir; 3B gölgeler bu yüzden hafiftir ve öğleden uzaklaştıkça fotoğraftan ayrılır.
  const GUNES = (() => { const v = [0.45, -0.55, 0.7], l = Math.hypot(...v); return v.map((x) => x / l); })();
  // Gölgeler bilerek çok hafif: güneş binaları aydınlatır, yere belirgin gölge düşmez (fotoğraftaki gölgelerle çakışmasın)
  const GOLGE_GUC = 0.3;
  const gunes = { v: GUNES, renk: [1, 0.95, 0.86], golge: GOLGE_GUC, yukseklik: 45 };
  // Hız: ~30 bin ağacın hepsini her karede 270 köşeyle çizmek tümleşik GPU'da kare başına ~150 ms tutuyordu. Ağaçlar
  // 100 m'lik hücrelere ayrılır; görüş alanı dışındaki hücreler atlanır, uzaktakiler 20 üçgenlik taçla ve yalnızca
  // ekranda seçilebilecek boydakilerle çizilir. Ekranda birkaç piksel kalanlar kameraya dönük tek karedir ("nokta"):
  // 20 üçgen orada piksel altı üçgenlerdir ve süreyi onlar belirliyordu. Gürültü sinüssüz özetle (hash) hesaplanır;
  // uzak taçta hiç yoktur.
  const AGAC_VS = `#version 300 es
  layout(location=0) in vec3 a_p;
  layout(location=1) in vec3 a_n;
  layout(location=2) in float a_t;
  layout(location=3) in vec4 a_o;
  uniform highp mat4 u_m;
  uniform highp vec3 u_gunes;
  uniform float u_uydu;
  uniform float u_duz;
  uniform vec3 u_sag, u_ust;
  out vec3 v_n; out vec3 v_y; out vec3 v_c;
  flat out float v_t;
  float rs(float n) { return fract(sin(n) * 43758.5453); }
  void main() {
    vec3 o = a_o.xyz * 0.1;
    o.z *= 1.0 - u_duz;   // arazi yokken ağaç düz zemine
    float h = abs(a_o.w) * 0.1;
    float s = rs(dot(o.xy, vec2(12.9898, 78.233)));
    float a = s * 6.2831853;
    mat2 d = mat2(cos(a), sin(a), -sin(a), cos(a));
    // taç fotoğraftaki lekeden biraz geniş: leke 3B tacın altında kalsın
    float tr = clamp(h * 0.37, 1.4, 6.0) * (0.88 + 0.28 * rs(s * 91.7));
    float tb = h * mix(0.26, 0.38, rs(s * 13.1));
    vec3 p, n;
    v_y = a_p;
    v_t = a_t;
    vec3 c = mix(vec3(0.22, 0.34, 0.13), vec3(0.37, 0.46, 0.20), rs(s * 7.3));
    c = mix(c, vec3(0.36, 0.40, 0.30), step(0.82, rs(s * 3.1)) * 0.7);
    float ez = (h - tb) * 0.5;
    if (a_t > 2.5) {
      // nokta: tacın kameradan görünen elipsini kaplayan kare; küre gibi boyanması AGAC_FS'de
      float ey = length(vec2(tr * length(u_ust.xy), ez * u_ust.z));
      p = vec3(0.0, 0.0, tb + ez) + u_sag * (a_p.x * tr) + u_ust * (a_p.y * ey);
      n = vec3(0.0, 0.0, 1.0);
      v_c = c * 0.94;
    } else if (a_t > 1.5) {
      // yer gölgesi: güneşin tersine, boyla uzar
      vec2 yon = -u_gunes.xy / u_gunes.z;
      p = vec3(yon * (tb + h) * 0.45 + a_p.xy * tr * 1.1, 0.25);
      n = vec3(0.0, 0.0, 1.0);
      v_c = vec3(0.0);
    } else if (a_t < 0.5) {
      float g = clamp(0.1 + h * 0.014, 0.12, 0.38);
      p = vec3(d * a_p.xy * g, a_p.z * (tb + 0.6));
      n = vec3(d * a_n.xy, 0.0);
      v_c = vec3(0.30, 0.24, 0.18);
    } else {
      vec3 e = vec3(tr, tr, ez);
      p = vec3(d * a_p.xy * e.xy, tb + (a_p.z + 1.0) * e.z);
      n = normalize(vec3(d * a_n.xy / e.xy, a_n.z / e.z));
      // köşe başına ton: yaprak kümeleri uzaktan da seçilsin; tacın altı kendi gölgesinde
      float k = rs(dot(a_p, vec3(3.1, 5.7, 7.3)) + s * 11.0);
      v_c = c * mix(0.78, 1.1, k) * mix(0.7, 1.04, clamp(a_p.z * 0.5 + 0.55, 0.0, 1.0));
    }
    v_n = n;
    gl_Position = u_m * vec4(o + p, 1.0);
    // eksi boy: uydu fotoğrafından gelen ağaç. Gölgesi fotoğrafta var; düşük kalitede hiç çizilmez (kırpılır)
    if (a_o.w < 0.0 && ((a_t > 1.5 && a_t < 2.5) || u_uydu < 0.5)) gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
    if (a_t > 0.5 && a_t < 1.5) v_y += vec3(s * 17.0);   // yaprak dokusu ağaçtan ağaca kaysın
  }`;
  const AGAC_FS = `#version 300 es
  precision highp float;
  in vec3 v_n; in vec3 v_y; in vec3 v_c;
  flat in float v_t;
  uniform vec3 u_gunes;
  uniform vec3 u_gunRenk;
  uniform float u_golge;
  uniform float u_gece;
  uniform float u_ayrinti;
  uniform vec3 u_sag, u_ust, u_ileri;
  out vec4 renk;
  float h3(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
  float gurultu(vec3 p) {
    vec3 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(h3(i), h3(i + vec3(1, 0, 0)), f.x), mix(h3(i + vec3(0, 1, 0)), h3(i + vec3(1, 1, 0)), f.x), f.y),
               mix(mix(h3(i + vec3(0, 0, 1)), h3(i + vec3(1, 0, 1)), f.x), mix(h3(i + vec3(0, 1, 1)), h3(i + vec3(1, 1, 1)), f.x), f.y), f.z);
  }
  void main() {
    vec3 n, c = v_c;
    if (v_t > 2.5) {
      float d = dot(v_y.xy, v_y.xy);
      if (d > 1.0) discard;
      n = normalize(u_sag * v_y.x + u_ust * v_y.y - u_ileri * sqrt(1.0 - d));
      c *= mix(0.7, 1.04, clamp(v_y.y * 0.5 + 0.55, 0.0, 1.0));
    } else if (v_t > 1.5) {
      float a = (1.0 - smoothstep(0.35, 1.0, length(v_y.xy))) * mix(0.42, 0.25, u_gece) * u_golge;
      renk = vec4(0.0, 0.0, 0.0, a);
      return;
    } else {
      n = normalize(v_n);
    }
    if (v_t > 0.5 && v_t < 1.5 && u_ayrinti > 0.5) {
      // yakın taç: yaprak kümeleri, normal biraz bozulur, oyuklar koyulaşır
      float g1 = gurultu(v_y * 3.4), g2 = gurultu(v_y * 7.3 + 5.0);
      n = normalize(n + vec3(g1 - 0.5, g2 - 0.5, (g1 + g2) * 0.5 - 0.5) * 0.9);
      c *= mix(0.68, 1.12, g1 * 0.65 + g2 * 0.35);
    }
    float gun = max(dot(n, u_gunes), 0.0);
    float gok = 0.5 + 0.5 * n.z;
    vec3 isik = mix(vec3(0.58, 0.62, 0.64) * (0.6 + 0.4 * gok) + u_gunRenk * gun * 0.78,
                    vec3(0.10, 0.13, 0.22) * (0.55 + 0.45 * gok) + vec3(0.10, 0.13, 0.24) * gun, u_gece);
    renk = vec4(c * isik * 1.3, 1.0);
  }`;

  // İndeksli model; indeks sırası: [yakın taç (80 üçgen) + gövde] [uzak taç (20 üçgen)] [yer gölgesi] [nokta]. Köşeler ortak:
  // indekssiz çizimde her köşe ~5 kez gölgelendiriliyordu, ağaç çiziminin süresi köşe aşamasındaydı.
  function agacModeli() {
    const k = [];   // x y z nx ny nz tür (0 gövde, 1 taç, 2 yer gölgesi)
    const ind = [];
    const t = (1 + Math.sqrt(5)) / 2;
    let ko = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]]
      .map((v) => { const l = Math.hypot(...v); return v.map((x) => x / l); });
    const temel = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
      [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
    const orta = {};
    const ortaNokta = (a, b) => {
      const anahtar = a < b ? a + '_' + b : b + '_' + a;
      if (!(anahtar in orta)) {
        const m = ko[a].map((x, i) => x + ko[b][i]), l = Math.hypot(...m);
        orta[anahtar] = ko.push(m.map((x) => x / l)) - 1;
      }
      return orta[anahtar];
    };
    const yuz = temel.flatMap(([a, b, c]) => {
      const ab = ortaNokta(a, b), bc = ortaNokta(b, c), ca = ortaNokta(c, a);
      return [[a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]];
    });
    // ilk 12 köşe iki modelde ortak: uzak taç yakınınkiyle aynı silueti verir
    ko = ko.map((v, i) => { const f = 1 + 0.13 * Math.sin(i * 12.7) + 0.07 * Math.sin(i * 5.3); return v.map((x) => x * f); });
    for (const v of ko) { const l = Math.hypot(...v); k.push(...v, ...v.map((x) => x / l), 1); }
    for (const tri of yuz) ind.push(...tri);
    const kenar = 5, g0 = k.length / 7;   // gövde: alt halka g0.., üst halka g0+kenar..
    for (let z = 0; z < 2; z++) {
      for (let i = 0; i < kenar; i++) { const a = (i / kenar) * 2 * Math.PI; k.push(Math.cos(a), Math.sin(a), z, Math.cos(a), Math.sin(a), 0, 0); }
    }
    for (let i = 0; i < kenar; i++) {
      const j = (i + 1) % kenar;
      ind.push(g0 + i, g0 + j, g0 + kenar + j, g0 + i, g0 + kenar + j, g0 + kenar + i);
    }
    const yakin = ind.length;
    for (const tri of temel) ind.push(...tri);
    const uzak = ind.length - yakin;
    const y0 = k.length / 7;
    for (const [x, y] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) k.push(x, y, 0, 0, 0, 1, 2);
    ind.push(y0, y0 + 1, y0 + 2, y0, y0 + 2, y0 + 3);
    const n0 = k.length / 7;
    for (const [x, y] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) k.push(x, y, 0, 0, 0, 1, 3);
    ind.push(n0, n0 + 1, n0 + 2, n0, n0 + 2, n0 + 3);
    return { veri: new Float32Array(k), indeks: new Uint16Array(ind), yakin, uzak, golge: 6, nokta: 6 };
  }

  // Ağaçları 100 m'lik hücrelere dizer; hücre içinde uzundan kısaya (veri zaten boya göre sıralı, kova sıralaması kararlı)
  function agacHucreleri(ham, adet) {
    const HUCRE = 1000;   // 0,1 m biriminde
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < adet; i++) {
      const x = ham[i * 4], y = ham[i * 4 + 1];
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    const nx = Math.floor((x1 - x0) / HUCRE) + 1, ny = Math.floor((y1 - y0) / HUCRE) + 1;
    const hucre = new Int32Array(adet), say = new Int32Array(nx * ny);
    for (let i = 0; i < adet; i++) {
      hucre[i] = Math.floor((ham[i * 4 + 1] - y0) / HUCRE) * nx + Math.floor((ham[i * 4] - x0) / HUCRE);
      say[hucre[i]]++;
    }
    const bas = new Int32Array(nx * ny);
    for (let i = 1; i < nx * ny; i++) bas[i] = bas[i - 1] + say[i - 1];
    const yer = bas.slice(), sirali = new Int16Array(adet * 4);
    for (let i = 0; i < adet; i++) sirali.set(ham.subarray(i * 4, i * 4 + 4), yer[hucre[i]]++ * 4);
    const hucreler = [];
    for (let h = 0; h < nx * ny; h++) {
      if (!say[h]) continue;
      let ax = Infinity, ay = Infinity, az = Infinity, bx = -Infinity, by = -Infinity, bz = -Infinity;
      const boy = new Float32Array(say[h]);
      for (let j = 0; j < say[h]; j++) {
        const o = (bas[h] + j) * 4, x = sirali[o] * 0.1, y = sirali[o + 1] * 0.1, z = sirali[o + 2] * 0.1, b = Math.abs(sirali[o + 3]) * 0.1;
        boy[j] = b;
        ax = Math.min(ax, x - 6); bx = Math.max(bx, x + 6); ay = Math.min(ay, y - 6); by = Math.max(by, y + 6);
        az = Math.min(az, z); bz = Math.max(bz, z + b);
      }
      const m = [(ax + bx) / 2, (ay + by) / 2, (az + bz) / 2];
      // düz zeminde (arazi yok) ağaçlar z=0'dan boyları kadar yükselir: ayrı görüş küresi (md, rd)
      const bmax = boy[0] || 0;
      hucreler.push({ bas: bas[h], adet: say[h], boy, m, r: Math.hypot(bx - ax, by - ay, bz - az) / 2,
        md: [m[0], m[1], bmax / 2], rd: Math.hypot(bx - ax, by - ay, bmax) / 2 });
    }
    return { sirali, hucreler };
  }

  // Bina üçgenlerini 200 m'lik hücrelere dizer (köşe aşaması bina çiziminin süresini belirliyor; görüş dışındaki
  // hücreler hiç çizilmez). Köşe: 10 short adım, konum ilk üçü (0,1 m), 8. short bina kimliği + 1. Kampüs dışındaki
  // binalar (üçgenlerin ~%16'sı) ayrı hücrelerde, sonda durur: yalnızca "Kampüs çevresi" açıkken çizilir.
  // Cam üçgenleri (opak'tan sonrası) olduğu gibi kalır.
  // taban: bina kimliği -> en alt köşesinin yüksekliği (m); düz zemin görüş küresi (md, rd) için
  function binaHucreleri(kp, ind, opak, disarida, taban) {
    const HUCRE = 2000, uc = opak / 3, DIS = 1 << 15;
    const anahtar = new Int32Array(uc);
    const kutu = new Map();   // hücre -> [ax, ay, az, bx, by, bz, üçgen sayısı, düz az, düz bz]
    for (let t = 0; t < uc; t++) {
      const v = ind[t * 3] * 10;
      const k = (Math.floor(kp[v + 1] / HUCRE) + 64) * 128 + Math.floor(kp[v] / HUCRE) + 64 + (disarida(kp[v + 7] & 0xffff) ? DIS : 0);
      anahtar[t] = k;
      let b = kutu.get(k);
      if (!b) kutu.set(k, (b = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity, 0, Infinity, -Infinity]));
      b[6]++;
      for (let j = 0; j < 3; j++) {
        const o = ind[t * 3 + j] * 10;
        for (let e = 0; e < 3; e++) {
          const d = kp[o + e];
          if (d < b[e]) b[e] = d;
          if (d > b[e + 3]) b[e + 3] = d;
        }
        const dz = kp[o + 2] - (taban[kp[o + 7] & 0xffff] || 0) * 10;
        if (dz < b[7]) b[7] = dz;
        if (dz > b[8]) b[8] = dz;
      }
    }
    const indeks = new Uint32Array(ind.length);
    indeks.set(ind.subarray(opak), opak);
    const hucreler = [];
    const yer = new Map();
    let bas = 0;
    for (const [k, b] of [...kutu].sort((x, y) => x[0] - y[0])) {
      yer.set(k, bas);
      const m = [0, 1, 2].map((e) => (b[e] + b[e + 3]) * 0.05);
      const r = Math.hypot(b[3] - b[0], b[4] - b[1], b[5] - b[2]) * 0.05;
      const md = [m[0], m[1], (b[7] + b[8]) * 0.05];
      const rd = Math.hypot(b[3] - b[0], b[4] - b[1], b[8] - b[7]) * 0.05;
      hucreler.push({ bas, adet: b[6] * 3, m, r, md, rd, dis: k >= DIS });
      bas += b[6] * 3;
    }
    for (let t = 0; t < uc; t++) {
      const o = yer.get(anahtar[t]);
      indeks[o] = ind[t * 3];
      indeks[o + 1] = ind[t * 3 + 1];
      indeks[o + 2] = ind[t * 3 + 2];
      yer.set(anahtar[t], o + 3);
    }
    return { indeks, hucreler };
  }

  // Uzak görünüm için sade bina üçgenleri: köşeler 1,5 m'lik ızgarada tek köşeye indirgenir (bina, yüzey türü ve normal
  // yönü ayrı tutulur: komşu binalar, çatı ve duvar birbirine karışmaz), çöken üçgenler atılır. Üçgen sayısı ~%61'e iner;
  // ayrıntılı modellerdeki pencere çıkıntıları, saçaklar uzaktan zaten piksel altındadır. Yeni köşe yok: indeksler
  // hücre sırasıyla ayrıntılıların arkasına eklenir (h.bas1, h.adet1).
  function sadeUcgenler(kp, kb, indeks, hucreler) {
    const IZGARA = 15;   // 0,1 m biriminde
    const temsil = new Map(), es = new Int32Array(kp.length / 10).fill(-1);
    const temsilci = (v) => {
      if (es[v] >= 0) return es[v];
      const o = v * 10, b = v * 20;
      const anahtar = `${Math.floor(kp[o] / IZGARA)},${Math.floor(kp[o + 1] / IZGARA)},${Math.floor(kp[o + 2] / IZGARA)},` +
        `${Math.round(kb[b + 6] / 64)},${Math.round(kb[b + 7] / 64)},${Math.round(kb[b + 8] / 64)},${kp[o + 7]},${kb[b + 13]}`;
      let t = temsil.get(anahtar);
      if (t === undefined) temsil.set(anahtar, (t = v));
      return (es[v] = t);
    };
    const sade = [];
    for (const h of hucreler) {
      h.bas1 = indeks.length + sade.length;
      for (let i = h.bas; i < h.bas + h.adet; i += 3) {
        const a = temsilci(indeks[i]), b = temsilci(indeks[i + 1]), c = temsilci(indeks[i + 2]);
        if (a !== b && b !== c && a !== c) sade.push(a, b, c);
      }
      h.adet1 = indeks.length + sade.length - h.bas1;
    }
    const hepsi = new Uint32Array(indeks.length + sade.length);
    hepsi.set(indeks);
    hepsi.set(sade, indeks.length);
    return hepsi;
  }

  // Kalite: kare süresi uzun kalırsa çözünürlük ve ağaç ayrıntısı kademeli düşer (bkz. kaliteyiIzle)
  const KALITE = [
    { dpr: 1.5, yakin: 3.2, piksel: 3.5, golge: 1.1 },
    { dpr: 1.25, yakin: 4.5, piksel: 4.5, golge: 1.6 },
    { dpr: 1, yakin: 6.5, piksel: 6, golge: 2.4 },
    { dpr: 1, yakin: 10, piksel: 8, golge: 99 },
  ];
  let kalite = 0;
  const kaliteDpr = () => ekranDpr(KALITE[kalite].dpr);

  // Görüş piramidinin altı düzlemi (matrisin satırlarından); kure(m, r): merkez m, yarıçap r olan küre görünür mü
  function gorusPiramidi(m) {
    const sat = (r) => [m[r], m[4 + r], m[8 + r], m[12 + r]];
    const s = [0, 1, 2, 3].map(sat);
    const duzlem = [];
    for (const r of s.slice(0, 3)) for (const k of [1, -1]) {
      const p = s[3].map((v, i) => v + k * r[i]);
      duzlem.push([p[0], p[1], p[2], p[3], Math.hypot(p[0], p[1], p[2])]);
    }
    const kure = ([x, y, z], r) => !duzlem.some((d) => d[0] * x + d[1] * y + d[2] * z + d[3] < -r * d[4]);
    return { s, kure };
  }
  // Kameranın model eksenlerindeki sağ, üst ve bakış yönü (matrisin x, y, w satırlarından, birbirine dik)
  function kameraEksenleri(m) {
    const sat = (r) => [m[r], m[4 + r], m[8 + r]];
    const ic = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const birim = (v) => { const l = Math.hypot(...v) || 1; return v.map((x) => x / l); };
    const dik = (v, ...e) => birim(e.reduce((a, b) => { const k = ic(a, b); return a.map((x, i) => x - k * b[i]); }, v));
    const ileri = birim(sat(3)), sag = dik(sat(0), ileri);
    return { sag, ust: dik(sat(1), ileri, sag), ileri };
  }
  // Ardışık aralıkları birleştirerek ekler: bitişik hücreler tek çizim çağrısı olur
  const araligaEkle = (liste, bas, adet) => {
    const son = liste[liste.length - 1];
    if (son && son[0] + son[1] === bas) son[1] += adet; else liste.push([bas, adet]);
  };

  // Boyu esik'ten kısa olmayan ilk ağaç sayısı (boy uzundan kısaya sıralı, ilk n'e bakılır)
  function enAz(boy, n, esik) {
    if (!n || boy[n - 1] >= esik) return n;
    let a = 0, b = n;
    while (a < b) { const o = (a + b) >> 1; if (boy[o] >= esik) a = o + 1; else b = o; }
    return a;
  }
  // metre başına K.yakin piksel düşen yerde bu boydaki (m) ağaç ayrıntılı taçla çizilmeye başlar; kısası daha yakında
  const YAKIN_BOY = 5;
  // ekranda bundan kısa (CSS pikseli) ağaçlar nokta olarak çizilir
  const NOKTA_PIKSEL = 16;

  // Binalar: ekranda 1,5 m'nin ~1,2 pikselden kısa kaldığı hücrelerde sade üçgenler (bkz. sadeUcgenler). Hücrenin
  // kameraya en yakın kısmı merkezden büyük görünür: ölçek derinlik oranıyla büyütülür.
  const BINA_SADE_PM = 0.8;
  // Arazi kapalıyken (yükselti inmedi) modeller düz zemine indirilir; hücrenin görüş küresi de o hâline göre
  let duzZemin = false;
  const gorusKuresi = (h) => (duzZemin && h.md ? { m: h.md, r: h.rd } : h);
  function binaAraliklari(m, hucreler, en, boy, oran) {
    const { kure, olcek } = hucreOlcegi(m, en, boy, oran);
    const liste = [];
    for (const h of hucreler) {
      const g = gorusKuresi(h);
      if ((h.dis && !cevreAcik) || !kure(g.m, g.r)) continue;
      const { pm, derin } = olcek(g);
      const yakinPm = derin > 0 ? pm * derin / Math.max(derin - g.r, derin * 0.25) : pm;
      if (yakinPm < BINA_SADE_PM) araligaEkle(liste, h.bas1, h.adet1); else araligaEkle(liste, h.bas, h.adet);
    }
    return liste;
  }

  // Görünen hücreler -> [yakın, uzak, gölge, nokta] örnek aralıkları
  // Görüş piramidi ve hücre merkezinde bir metrenin ekrandaki boyu (CSS pikseli; kamera hücrenin içindeyse çok büyük)
  function hucreOlcegi(m, en, boy, oran) {
    const { s: [s0, s1, , s3], kure } = gorusPiramidi(m);
    const ndc = (x, y, z) => {
      const w = s3[0] * x + s3[1] * y + s3[2] * z + s3[3];
      return [(s0[0] * x + s0[1] * y + s0[2] * z + s0[3]) / w, (s1[0] * x + s1[1] * y + s1[2] * z + s1[3]) / w, w];
    };
    const olcek = (h) => {
      const [x, y, z] = h.m;
      const c = ndc(x, y, z);
      if (c[2] <= h.r * 0.02) return { pm: 1e3, derin: 0 };
      let pm = 0;
      for (const [dx, dy, dz] of [[1, 0, 0], [0, 1, 0], [0, 0, 1]]) {
        const d = ndc(x + dx, y + dy, z + dz);
        pm = Math.max(pm, Math.hypot((d[0] - c[0]) * en, (d[1] - c[1]) * boy) / 2);
      }
      return { pm: pm / oran, derin: c[2] };   // CSS pikseli: yüksek DPR'de ayrıntı artmasın
    };
    return { kure, olcek };
  }

  function agacAraliklari(m, hucreler, en, boy, oran) {
    const { kure, olcek } = hucreOlcegi(m, en, boy, oran);
    const K = KALITE[kalite];
    const yakin = [], uzak = [], golge = [], nokta = [];
    const ekle = araligaEkle;
    for (const h of hucreler) {
      const g = gorusKuresi(h);
      if (!kure(g.m, g.r)) continue;
      const pm = olcek(g).pm;
      // ekranda K.piksel'den kısa kalacak ağaçlar çizilmez (hücre içi uzundan kısaya: ilk n tanesi)
      const n = enAz(h.boy, h.adet, K.piksel / pm);
      if (!n) continue;
      // ayrıntılı taç yalnızca ekranda yeterince büyük olanlara: tarladaki küçük ağaçlar yakında da sade taçla çizilir
      const ny = pm >= K.yakin ? enAz(h.boy, n, (K.yakin * YAKIN_BOY) / pm) : 0;
      const nu = Math.max(ny, enAz(h.boy, n, NOKTA_PIKSEL / pm));
      if (ny) ekle(yakin, h.bas, ny);
      if (nu > ny) ekle(uzak, h.bas + ny, nu - ny);
      if (n > nu) ekle(nokta, h.bas + nu, n - nu);
      if (pm >= K.golge) ekle(golge, h.bas, n);
    }
    return [yakin, uzak, golge, nokta];
  }

  const model = {
    id: 'modeller',
    type: 'custom',
    renderingMode: '3d',
    gorunur: true,
    hazir: false,
    onAdd(_, gl) {
      this.gl = gl;
      const derle = (tur, kaynak) => {
        const s = gl.createShader(tur);
        gl.shaderSource(s, kaynak);
        gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) console.error(gl.getShaderInfoLog(s));
        return s;
      };
      const program = (vs, fs, adlar) => {
        const p = gl.createProgram();
        gl.attachShader(p, derle(gl.VERTEX_SHADER, vs));
        gl.attachShader(p, derle(gl.FRAGMENT_SHADER, fs));
        gl.linkProgram(p);
        if (!gl.getProgramParameter(p, gl.LINK_STATUS)) console.error(gl.getProgramInfoLog(p));
        const u = {};
        for (const a of adlar) u[a] = gl.getUniformLocation(p, a);
        return [p, u];
      };
      [this.program, this.u] = program(KOSE_VS, PARCA_FS, ['u_m', 'u_ton', 'u_taban', 'u_duz', 'u_gunes', 'u_gunRenk', 'u_gece', 'u_saydam']);
      if (window.IKIZ_AGAC) this.agacKur(program);
      const n = V.binalar.features.length + 1;
      this.tonY = Math.ceil(n / 256);
      this.tonVeri = new Uint8Array(256 * this.tonY * 4);
      this.ton = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.ton);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 256, this.tonY, 0, gl.RGBA, gl.UNSIGNED_BYTE, this.tonVeri);
      this.yukle().catch((hata) => {
        // eski WebView'da DecompressionStream yok ya da veri bozuk: harita yine açık kalır, sebebi söylenir
        console.error('ikiz: modeller yüklenemedi', hata);
        modelHatasi = true;
        uyariYaz();
      });
    },
    agacKur(program) {
      const gl = this.gl;
      const A = window.IKIZ_AGAC;
      [this.agacProgram, this.agacU] = program(AGAC_VS, AGAC_FS, ['u_m', 'u_gunes', 'u_gunRenk', 'u_golge', 'u_gece', 'u_ayrinti', 'u_uydu', 'u_duz', 'u_sag', 'u_ust', 'u_ileri']);
      this.geo = agacModeli();
      const bayt = Uint8Array.from(atob(A.veri), (c) => c.charCodeAt(0));
      A.veri = null;
      const { sirali, hucreler } = agacHucreleri(new Int16Array(bayt.buffer, 0, A.adet * 4), A.adet);
      this.hucreler = hucreler;
      const ornek = sirali;
      this.agacVao = gl.createVertexArray();
      gl.bindVertexArray(this.agacVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
      gl.bufferData(gl.ARRAY_BUFFER, this.geo.veri, gl.STATIC_DRAW);
      for (const [i, n, o] of [[0, 3, 0], [1, 3, 12], [2, 1, 24]]) {
        gl.enableVertexAttribArray(i);
        gl.vertexAttribPointer(i, n, gl.FLOAT, false, 28, o);
      }
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, this.geo.indeks, gl.STATIC_DRAW);
      this.ornekTampon = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.ornekTampon);
      gl.bufferData(gl.ARRAY_BUFFER, ornek, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(3);
      gl.vertexAttribPointer(3, 4, gl.SHORT, false, 8, 0);
      gl.vertexAttribDivisor(3, 1);
      gl.bindVertexArray(null);
    },
    async yukle() {
      const M = window.IKIZ_MODEL;
      const ikili = Uint8Array.from(atob(M.veri), (c) => c.charCodeAt(0));
      const akis = new Blob([ikili]).stream().pipeThrough(new DecompressionStream('gzip'));
      const veri = await new Response(akis).arrayBuffer();
      M.veri = null;
      const gl = this.gl;
      const koseBayt = M.kose * 20;
      this.vao = gl.createVertexArray();
      gl.bindVertexArray(this.vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
      gl.bufferData(gl.ARRAY_BUFFER, new Uint8Array(veri, 0, koseBayt), gl.STATIC_DRAW);
      const disarida = (no) => no > 0 && no <= V.binalar.features.length && !V.binalar.features[no - 1].properties.ic;
      const kp = new Int16Array(veri, 0, koseBayt / 2);
      // Bina başına taban yüksekliği (m, M.taban'a göre): arazi kapalıyken model kendi tabanına indirilir
      const taban = new Float32Array(256 * this.tonY).fill(Infinity);
      for (let v = 0; v < M.kose; v++) {
        const b = kp[v * 10 + 7] & 0xffff, z = kp[v * 10 + 2] * 0.1;
        if (b < taban.length && z < taban[b]) taban[b] = z;
      }
      for (let i = 0; i < taban.length; i++) if (taban[i] === Infinity) taban[i] = 0;
      this.tabanDoku = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.tabanDoku);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      // MapLibre'nin açık bıraktığı paketleme ayarları kayan noktalı veriyi bozmasın: kapatılır, sonra geri konur
      const ayar = [gl.UNPACK_FLIP_Y_WEBGL, gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL].map((p) => [p, gl.getParameter(p)]);
      for (const [p] of ayar) gl.pixelStorei(p, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, 256, this.tonY, 0, gl.RED, gl.FLOAT, taban);
      for (const [p, d] of ayar) gl.pixelStorei(p, d);
      const { indeks, hucreler } = binaHucreleri(kp, new Uint32Array(veri, koseBayt), M.opak, disarida, taban);
      this.binaHucre = hucreler;
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, sadeUcgenler(kp, new Int8Array(veri, 0, koseBayt), indeks, hucreler), gl.STATIC_DRAW);
      const oz = (i, adet, tur, norm, ofset) => {
        gl.enableVertexAttribArray(i);
        gl.vertexAttribPointer(i, adet, tur, norm, 20, ofset);
      };
      oz(0, 3, gl.SHORT, false, 0);
      oz(1, 3, gl.BYTE, true, 6);
      oz(2, 3, gl.UNSIGNED_BYTE, true, 10);
      oz(3, 1, gl.UNSIGNED_BYTE, false, 13);
      oz(4, 1, gl.UNSIGNED_SHORT, false, 14);
      oz(5, 2, gl.SHORT, false, 16);
      gl.bindVertexArray(null);
      // yerel eksenler (doğu, kuzey, yukarı; metre) -> mercator. Arazi varken mutlak yükseklikte (M.taban), yokken
      // MapLibre zemini 0 m'dir: modeller oraya iner
      const eksen = (yukseklik) => {
        const c = maplibregl.MercatorCoordinate.fromLngLat({ lng: M.merkez[0], lat: M.merkez[1] }, yukseklik);
        const s = c.meterInMercatorCoordinateUnits();
        return [s, 0, 0, 0, 0, -s, 0, 0, 0, 0, s, 0, c.x, c.y, c.z, 1];
      };
      this.yerelArazi = eksen(M.taban);
      this.yerelDuz = eksen(0);
      this.opak = M.opak;
      this.cam = M.cam;
      this.hazir = true;
      harita.setPaintProperty('binalar', 'fill-extrusion-opacity', 0);
      this.gorunum();
      harita.triggerRepaint();
    },
    // Bina başına ton dokusu: seçim ve cephe katmanı
    gorunum() {
      if (!this.ton) return;
      const v = this.tonVeri;
      const hex = (h) => [1, 3, 5].map((i) => parseInt(h.substr(i, 2), 16));
      v.fill(0);
      const yaz = (i, h, a) => {
        const [r, g, b] = hex(h);
        v.set([r, g, b, a], i * 4);
      };
      const boya = (oid, h, a) => { for (const f of parcalar(oid)) yaz(f.id + 1, h, a); };
      if (cepheAcik || karbonAcik) {
        for (let i = 0; i < V.binalar.features.length + 1; i++) yaz(i, gece ? '#242c3a' : '#a8afb9', 215);
      }
      if (cepheAcik) {
        for (const id in cephe) boya(id, CEPHE_RENK[cephe[id]] || CEPHE_RENK[0], 225);
      } else if (karbonAcik) {
        const [en, eb] = karbonAraligi();
        for (const id in karbon) boya(id, rampaRengi((karbon[id] - en) / (eb - en || 1)), 230);
      } else {
        // Varsayılan görünüm: kararlar katman açmadan da görünsün. Aşınmış cephe hafif kiremit, süren iş turuncu.
        for (const id in cephe) if (cephe[id] === 2) boya(id, ASINMIS_TON, 105);
        for (const id in binaIsaret) if (binaIsaret[id].suruyor) boya(id, IS_TON, 150);
      }
      if (seciliOid) boya(seciliOid, '#5fdccb', 170);
      else if (seciliBina) yaz(seciliBina, '#5fdccb', 170);
      if (!cevreAcik) for (const f of V.binalar.features) if (!f.properties.ic) v[(f.id + 1) * 4 + 3] = 1;
      const gl = this.gl;
      gl.bindTexture(gl.TEXTURE_2D, this.ton);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 256, this.tonY, gl.RGBA, gl.UNSIGNED_BYTE, v);
      harita.triggerRepaint();
    },
    render(gl, args) {
      if (!this.hazir || !this.gorunur) return;
      const a = args.defaultProjectionData.mainMatrix, b = duzZemin ? this.yerelDuz : this.yerelArazi;
      const m = new Float32Array(16);
      for (let i = 0; i < 4; i++) {
        for (let j = 0; j < 4; j++) {
          m[i * 4 + j] = a[j] * b[i * 4] + a[j + 4] * b[i * 4 + 1] + a[j + 8] * b[i * 4 + 2] + a[j + 12] * b[i * 4 + 3];
        }
      }
      gl.useProgram(this.program);
      gl.uniformMatrix4fv(this.u.u_m, false, m);
      gl.uniform3f(this.u.u_gunes, ...gunes.v);
      gl.uniform3f(this.u.u_gunRenk, ...gunes.renk);
      gl.uniform1f(this.u.u_gece, gece ? 1 : 0);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.ton);
      gl.uniform1i(this.u.u_ton, 0);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, this.tabanDoku);
      gl.uniform1i(this.u.u_taban, 1);
      gl.activeTexture(gl.TEXTURE0);
      gl.uniform1f(this.u.u_duz, duzZemin ? 1 : 0);
      gl.bindVertexArray(this.vao);
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LEQUAL);
      gl.depthMask(true);
      gl.disable(gl.CULL_FACE);
      gl.disable(gl.BLEND);
      gl.uniform1f(this.u.u_saydam, 1);
      const binalar = binaAraliklari(m, this.binaHucre, gl.drawingBufferWidth, gl.drawingBufferHeight, harita.getPixelRatio());
      for (const [bas, adet] of binalar) gl.drawElements(gl.TRIANGLES, adet, gl.UNSIGNED_INT, bas * 4);
      if (this.agacVao && agacAcik) {
        const [yakin, uzak, golge, nokta] = agacAraliklari(m, this.hucreler, gl.drawingBufferWidth, gl.drawingBufferHeight, harita.getPixelRatio());
        const g = this.geo;
        gl.useProgram(this.agacProgram);
        gl.uniformMatrix4fv(this.agacU.u_m, false, m);
        gl.uniform3f(this.agacU.u_gunes, ...gunes.v);
        gl.uniform3f(this.agacU.u_gunRenk, ...gunes.renk);
        gl.uniform1f(this.agacU.u_golge, gunes.golge);
        gl.uniform1f(this.agacU.u_gece, gece ? 1 : 0);
        gl.uniform1f(this.agacU.u_uydu, kalite ? 0 : 1);
        gl.uniform1f(this.agacU.u_duz, duzZemin ? 1 : 0);
        const eksen = kameraEksenleri(m);
        for (const ad of ['sag', 'ust', 'ileri']) gl.uniform3f(this.agacU['u_' + ad], ...eksen[ad]);
        gl.bindVertexArray(this.agacVao);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.ornekTampon);
        const ciz = (araliklar, ilk, kose) => {
          for (const [bas, adet] of araliklar) {
            gl.vertexAttribPointer(3, 4, gl.SHORT, false, 8, bas * 8);
            gl.drawElementsInstanced(gl.TRIANGLES, kose, gl.UNSIGNED_SHORT, ilk * 2, adet);
          }
        };
        gl.uniform1f(this.agacU.u_ayrinti, 1);
        ciz(yakin, 0, g.yakin);
        gl.uniform1f(this.agacU.u_ayrinti, 0);
        ciz(uzak, g.yakin, g.uzak);
        ciz(nokta, g.yakin + g.uzak + g.golge, g.nokta);
        // yer gölgeleri: saydam, derinliğe yazmaz
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        gl.depthMask(false);
        ciz(golge, g.yakin + g.uzak, g.golge);
        gl.depthMask(true);
        gl.disable(gl.BLEND);
        gl.useProgram(this.program);
        gl.bindVertexArray(this.vao);
        this.sonCizim = [yakin, uzak, golge, nokta].map((l) => l.reduce((t, a) => t + a[1], 0));
      }
      if (this.cam) {
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        gl.depthMask(false);
        gl.uniform1f(this.u.u_saydam, gece ? 0.95 : 0.8);
        gl.drawElements(gl.TRIANGLES, this.cam, gl.UNSIGNED_INT, this.opak * 4);
        gl.depthMask(true);
      }
      gl.bindVertexArray(null);
    },
  };

  // --- Gündüz/gece, cephe katmanı: boya özellikleri tek yerden hesaplanır
  let gece = false;
  let cepheAcik = false;
  let karbonAcik = false;
  let agacAcik = true;

  function gorunumuUygula() {
    const m = harita;
    model.gorunum();
    // gündüz çevrenin uydu görüntüsü de iner (tülün altında görünür); gece çevre koyu örtülüdür
    const uyduKaynak = cevreAcik || !gece ? 'uydu-cevre' : 'uydu';
    if (m.getLayer('uydu').source !== uyduKaynak) {
      m.removeLayer('uydu');
      m.addLayer({ id: 'uydu', type: 'raster', source: uyduKaynak, paint: { 'raster-fade-duration': 0, 'raster-contrast': 0.08 } }, 'tac-alti');
    }
    m.setPaintProperty('uydu', 'raster-brightness-max', gece ? 0.26 : 1);
    m.setPaintProperty('uydu', 'raster-brightness-min', gece ? 0 : 0.04);
    m.setPaintProperty('uydu', 'raster-saturation', gece ? -0.45 : cepheAcik || karbonAcik ? -0.7 : UYDU_DOYGUNLUK);
    m.setPaintProperty('tac-alti', 'fill-color', gece ? '#05080c' : cepheAcik || karbonAcik ? '#3a3d3c' : TAC_ALTI);
    m.setLayoutProperty('tac-alti', 'visibility', agacAcik ? 'visible' : 'none');
    m.setPaintProperty('golge', 'fill-opacity', gece ? 0 : 0.34 * gunes.golge);
    m.setPaintProperty('golge', 'fill-translate', golgeKaymasi(gunes.v));
    m.setPaintProperty('sinir', 'line-opacity', gece ? 0.3 : 0.6);
    // yalnızca kampüs: dışarısı tamamen örtülür (eskiden yarı saydam karartmaydı, sunumda bulanık duruyordu)
    m.setPaintProperty('dis', 'fill-color', gece ? SAHNE.geceZemin : SAHNE.zemin);
    m.setPaintProperty('dis', 'fill-opacity', cevreAcik ? 0 : gece ? 1 : SAHNE.zeminTul);
    m.setLayoutProperty('sinir-isik', 'visibility', cevreAcik ? 'none' : 'visible');
    m.setFilter('golge', icFiltre());
    m.setFilter('binalar', icFiltre());
    for (const k of ['gece-yol', 'gece-yol-isik']) m.setLayoutProperty(k, 'visibility', gece ? 'visible' : 'none');
    m.setPaintProperty('zemin', 'background-color', gece ? '#0a1222' : ZEMIN_RENK);
    m.setLight(gece
      ? { anchor: 'map', position: [1.3, 120, 55], color: '#9fb6e8', intensity: 0.3 }
      : { anchor: 'map', position: [1.3, gunes.azimut ?? 215, Math.min(80, Math.max(10, 90 - gunes.yukseklik))], color: '#fff6e6', intensity: 0.42 });
    m.setSky(gece
      ? { 'sky-color': '#060c1c', 'horizon-color': '#1b2a4d', 'fog-color': cevreAcik ? '#0c1630' : '#060b16', 'fog-ground-blend': 0.75, 'horizon-fog-blend': 0.6, 'sky-horizon-blend': 0.6, 'atmosphere-blend': 0 }
      : cevreAcik
        ? { 'sky-color': '#7fb2e0', 'horizon-color': '#dbe6ee', 'fog-color': '#c9d6df', 'fog-ground-blend': 0.8, 'horizon-fog-blend': 0.5, 'sky-horizon-blend': 0.7, 'atmosphere-blend': 0 }
        : { 'sky-color': SAHNE.gok, 'horizon-color': SAHNE.ufuk, 'fog-color': SAHNE.sis, 'fog-ground-blend': 0.55, 'horizon-fog-blend': 0.7, 'sky-horizon-blend': 0.8, 'atmosphere-blend': 0 });
    miniyiBoya();
    // Arazi açıkken zemin katmanları paftalık dokulara bir kez çizilip saklanır; boya değişikliği (gece karartması,
    // cephe katmanında soluk uydu) bu dokuları geçersiz kılmıyordu. Saklananlar atılır, sonraki karede yeniden çizilir.
    if (m.terrain && m.terrain.sourceCache && m.terrain.sourceCache.freeRtt) m.terrain.sourceCache.freeRtt();
    m.triggerRepaint();
  }

  // --- Yer etiketleri: yalnızca çakışmayanlar gösterilir, büyük binalar önceliklidir
  const GENEL_AD = /^(Üniversite binası|Yurt Binası|Yurt$)/;
  const etiketler = [];
  const yerler = V.yerler.slice().sort((a, b) => (a.t === 'kampus' ? 0 : 1) - (b.t === 'kampus' ? 0 : 1) || (GENEL_AD.test(a.ad) ? 1 : 0) - (GENEL_AD.test(b.ad) ? 1 : 0) || (b.a || 0) - (a.a || 0));
  for (const y of yerler) {
    const el = document.createElement('div');
    el.className = 'yer t-' + y.t;
    if (y.renk) el.style.setProperty('--renk', y.renk);
    const yazi = document.createElement('b');
    yazi.textContent = adCevir(y.ad);
    el.append(yazi);
    el.addEventListener('click', (e) => { e.stopPropagation(); yereGit(y); });
    etiketler.push({ y, el, yazi, n: noktaEkle(el, y.c, 'translate(-50%, -100%)') });
  }
  let etiketAcik = true;

  function etiketleriSeyrelt() {
    const z = harita.getZoom();
    const dolu = [];
    for (const e of etiketler) {
      const asgari = GENEL_AD.test(e.y.ad) ? 16.6 : e.y.t === 'kampus' ? 14 : e.y.t === 'yeme' ? 15.8 : e.y.t === 'giris' ? 16.2 : 16.4;
      let ac = etiketAcik && (cevreAcik || e.y.t !== 'cevre') && z >= asgari && ekranda(e.y.c, 40);
      if (ac) {
        const nokta = harita.project(e.y.c);
        // büyük ekranda etiket yazısı büyür (ikiz.css): çakışma kutusu da büyür
        const o = innerWidth >= 2400 ? 1.6 : innerWidth >= 1600 ? 1.25 : 1;
        const g = Math.min(170, e.yazi.textContent.length * 6.9 + 16) * o / 2 + 3;
        const k = { x0: nokta.x - g, x1: nokta.x + g, y0: nokta.y - 32 * o, y1: nokta.y };
        ac = e.y.ad === seciliAd || !dolu.some((d) => k.x0 < d.x1 && k.x1 > d.x0 && k.y0 < d.y1 && k.y1 > d.y0);
        if (ac) dolu.push(k);
      }
      goster(e.n, ac);
      e.el.classList.toggle('secili', e.y.ad === seciliAd);
    }
    isaretleriSeyrelt();
  }

  // --- Yol noktaları ve süren bina işleri: durum Flutter'dan gelir, dokununca kart orada açılır
  let yolAcik = true;

  function isaretKur(c, ad, mesaj) {
    const el = document.createElement('button');
    el.className = 'isaret';
    el.setAttribute('aria-label', adCevir(ad));
    el.dataset.ad = ad;
    el.addEventListener('click', (e) => { e.stopPropagation(); aramaKapat(); flutter(mesaj); });
    return noktaEkle(el, c, 'translate(-50%, -50%)');
  }

  const yolIsaret = {};
  for (const y of window.IKIZ_YOL) yolIsaret[y.id] = { n: isaretKur(y.c, y.ad, { tur: 'yol', id: y.id }), sorun: false };
  const binaIsaret = {};
  const isBolgeleri = new Set();   // yolunda iş süren bölgeler
  let kampusProjeleri = [];        // [{ad, durum, bitti}] Flutter'dan

  // Sol üstteki durum paneli: kararların haritadaki karşılığı (renk açıklaması) ve kampüs geneli projeler. Yalnızca
  // gösterecek bir şey varken görünür.
  function durumPaneli() {
    const panel = $('durum');
    if (!panel) return;   // önbellekten eski index.html geldiyse
    const lejant = $('durumLejant');
    lejant.replaceChildren();
    const cip = (renk, metin, sinif) => {
      const s = document.createElement('span');
      s.className = 'cip' + (sinif ? ' ' + sinif : '');
      const i = document.createElement('i');
      i.style.background = renk;
      s.append(i, metin);
      lejant.append(s);
    };
    // cephe ya da karbon katmanı açıkken binalar o katmanın rengindedir: bina açıklamaları gizlenir
    const varsayilan = !cepheAcik && !karbonAcik;
    const isSay = Object.values(binaIsaret).filter((i) => i.suruyor).length;
    const asinmis = Object.keys(cephe).filter((id) => cephe[id] === 2 && binaOid[id]).length;
    const bolgeler = [...isBolgeleri].sort((a, b) => a - b).join(', ');
    if (varsayilan && isSay) cip(IS_TON, dl(`🏗️ Süren iş: ${isSay} bina`, `🏗️ Work in progress: ${isSay} building${isSay > 1 ? 's' : ''}`));
    if (bolgeler) cip(IS_TON, dl(`🚧 Yol çalışması: Bölge ${bolgeler}`, `🚧 Road works: zone ${bolgeler}`), 'cizgi');
    if (varsayilan && asinmis) cip(ASINMIS_TON, dl(`Aşınmış cephe: ${asinmis} bina`, `Worn facade: ${asinmis} building${asinmis > 1 ? 's' : ''}`));
    const liste = $('projeler');
    liste.replaceChildren();
    if (kampusProjeleri.length) {
      const baslik = document.createElement('li');
      baslik.className = 'baslik';
      baslik.textContent = dl('Kampüs geneli projeler', 'Campus-wide projects');
      liste.append(baslik);
    }
    for (const k of kampusProjeleri) {
      const li = document.createElement('li');
      if (k.bitti) li.className = 'bitti';
      const b = document.createElement('b');
      b.textContent = String(k.durum || '');
      li.append(b, ' ' + k.ad);
      liste.append(li);
    }
    lejant.hidden = !lejant.childElementCount;
    liste.hidden = !kampusProjeleri.length;
    panel.hidden = lejant.hidden && liste.hidden;
  }

  function isaretleriSeyrelt() {
    const z = harita.getZoom();
    for (const id in yolIsaret) {
      const i = yolIsaret[id];
      goster(i.n, yolAcik && z >= (i.sorun ? 14.5 : 16.2) && ekranda(i.n.c));
    }
    for (const id in binaIsaret) {
      const i = binaIsaret[id];
      goster(i.n, i.suruyor && ekranda(i.n.c));
    }
  }

  // --- Seçim ve bilgi kartı
  let seciliAd = null;
  let seciliBolge = null;
  let seciliBina = 0;
  let seciliOid = null;

  function bilgi(ad, deger, renk) {
    const dt = document.createElement('dt');
    dt.textContent = ad;
    const dd = document.createElement('dd');
    if (renk) {
      const i = document.createElement('i');
      i.style.background = renk;
      dd.append(i);
    }
    dd.append(deger);
    $('kartBilgi').append(dt, dd);
  }

  let sonSecim = [null, null];
  function sec(f, ozelAd) {
    sonSecim = [f, ozelAd];
    const o = f ? f.properties : null;
    seciliBina = f ? f.id + 1 : 0;
    seciliOid = o && o.oid ? o.oid : null;   // çok parçalı binada bütün parçalar vurgulanır
    model.gorunum();
    seciliAd = ozelAd || (o && o.ad) || null;
    seciliBolge = o && o.b ? o.b : null;
    if (!f && !ozelAd) { $('kart').hidden = true; etiketleriSeyrelt(); return; }
    $('kart').hidden = false;
    $('kartBilgi').replaceChildren();
    $('kartAd').textContent = seciliAd ? adCevir(seciliAd) : dl('Çevre binası', 'Nearby building');
    if (o && o.oid) {
      const giris = ozelAd && V.yerler.find((v) => v.t === 'giris' && v.ad === ozelAd);
      $('kartTur').textContent = giris ? `${adCevir(giris.bina)} · ${dl('giriş', 'entrance')}`
        : `${tipAdi(o.tip) || dl('Üniversite binası', 'University building')}, ${dl('Bölge', 'Zone')} ${o.b}`;
      bilgi(dl('Kat', 'Floors'), String(o.kat));
      bilgi(dl('Kapalı alan', 'Floor area'), `${Math.round(o.alan).toLocaleString(yerelAyar())} m²`);
      const c = cephe[o.oid];
      bilgi(dl('Cephe', 'Facade'), cepheAdi(c), CEPHE_RENK[c]);
      if (o.oid in karbon) {
        const [en, eb] = karbonAraligi();
        bilgi(dl('Karbon', 'Carbon'), `${karbon[o.oid].toLocaleString(yerelAyar())} kg CO₂e/m²·${dl('yıl', 'yr')}`, rampaRengi((karbon[o.oid] - en) / (eb - en || 1)));
      }
    } else if (o) {
      $('kartTur').textContent = o.tur ? dl(o.tur, o.turEn) : dl('Kampüs çevresi', 'Campus surroundings');
      bilgi(dl('Tahmini yükseklik', 'Estimated height'), `${Math.round(o.h)} m`);
    } else {
      $('kartTur').textContent = dl('Kampüs içi mekân', 'Place on campus');
    }
    $('kartEylem').hidden = !(seciliOid && window.Ikiz);
    $('kartYol').textContent = seciliBolge ? dl(`Bölge ${seciliBolge} yolları`, `Zone ${seciliBolge} roads`) : '';
    etiketleriSeyrelt();
  }

  function yereGit(y) {
    otomatikCerceve = false;
    // adı veriye sonradan eklenen binalar (scripts/ikiz_duzelt.py) adıyla, girişler ait oldukları binayla seçilir
    const f = y.oid ? parcalar(y.oid)[0] || null
      : V.binalar.features.find((b) => b.properties.ad === (y.t === 'giris' ? y.bina : y.ad)) || null;
    sec(f, y.ad);
    // telefonda kart ve durum paneli ekranın altını kaplar: bina kartın üstünde kalsın
    const alt = innerWidth < 720 ? innerHeight - $('kart').getBoundingClientRect().top : 0;
    harita.flyTo({ center: y.c, zoom: Math.max(harita.getZoom(), y.t === 'giris' ? 18 : 16.8), pitch: 60, duration: azHareket ? 0 : 1400, essential: false, padding: { bottom: alt } });
  }

  harita.on('click', (e) => {
    aramaKapat();
    const b = harita.queryRenderedFeatures(e.point, { layers: ['binalar'] })[0];
    if (!b) return sec(null);
    sec(V.binalar.features[b.id]);
  });
  harita.on('mousemove', 'binalar', () => { harita.getCanvas().style.cursor = 'pointer'; });
  harita.on('mouseleave', 'binalar', () => { harita.getCanvas().style.cursor = ''; });
  $('kartKapat').onclick = () => sec(null);
  $('kartAc').onclick = () => seciliOid && flutter({ tur: 'bina', id: seciliOid });
  $('kartYol').onclick = () => seciliBolge && flutter({ tur: 'yollar', bolge: seciliBolge });

  // --- Arama (Türkçe harfleri gözetmeden: "dis hekimligi" da bulur)
  const sade = (s) => s.toLocaleLowerCase('tr').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ı/g, 'i');
  // Türkçe ve İngilizce adla aranabilir
  const aranacak = V.yerler.map((y) => ({ y, s: sade(y.ad) + ' ' + sade((window.IKIZ_ADLAR && window.IKIZ_ADLAR[y.ad]) || '') }));
  const turAdi = (tur) => ({
    kampus: dl('Kampüs binası', 'Campus building'), yeme: dl('Kafe, restoran', 'Café, restaurant'), cevre: dl('Kampüs çevresi', 'Campus surroundings'),
  })[tur];
  let etkin = -1;
  let bulunan = [];

  function aramaKapat() { $('sonuclar').hidden = true; etkin = -1; }

  function sonuclariCiz() {
    const liste = $('sonuclar');
    liste.replaceChildren();
    const q = sade($('ara').value.trim());
    if (!q) return aramaKapat();
    bulunan = aranacak.filter((a) => a.s.includes(q)).sort((a, b) => a.s.indexOf(q) - b.s.indexOf(q)).slice(0, 7).map((a) => a.y);
    liste.hidden = false;
    if (!bulunan.length) {
      const li = document.createElement('li');
      li.className = 'bos';
      li.textContent = dl(`"${$('ara').value.trim()}" kampüste bulunamadı`, `"${$('ara').value.trim()}" not found on campus`);
      liste.append(li);
      return;
    }
    bulunan.forEach((y, i) => {
      const li = document.createElement('li');
      li.textContent = adCevir(y.ad);
      if (i === etkin) li.className = 'etkin';
      const k = document.createElement('small');
      k.textContent = y.t === 'giris' ? `${adCevir(y.bina)} · ${dl('giriş', 'entrance')}` : turAdi(y.t);
      li.append(k);
      li.addEventListener('click', () => sonucSec(y));
      liste.append(li);
    });
  }

  function sonucSec(y) {
    $('ara').value = adCevir(y.ad);
    $('ara').blur();
    aramaKapat();
    yereGit(y);
  }

  $('ara').addEventListener('input', () => { etkin = -1; sonuclariCiz(); });
  $('ara').addEventListener('focus', sonuclariCiz);
  $('ara').addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (bulunan.length) etkin = (etkin + (e.key === 'ArrowDown' ? 1 : bulunan.length - 1) + (etkin < 0 && e.key === 'ArrowUp' ? 1 : 0)) % bulunan.length;
      sonuclariCiz();
    } else if (e.key === 'Enter' && bulunan.length) {
      sonucSec(bulunan[Math.max(etkin, 0)]);
    } else if (e.key === 'Escape') {
      aramaKapat();
    }
  });

  // --- Denetimler
  $('yakin').onclick = () => { otomatikCerceve = false; harita.zoomIn(); };
  $('uzak').onclick = () => { otomatikCerceve = false; harita.zoomOut(); };
  $('pusula').onclick = () => { otomatikCerceve = false; harita.easeTo({ bearing: 0, pitch: 0, duration: azHareket ? 0 : 500 }); };
  $('geceSec').onchange = (e) => { gece = e.target.checked; gorunumuUygula(); };

  // Güneş: yön, renk (alçakta turuncu), gölge gücü (bulutta ve ufka yakın zayıf). Güneş ufku geçince gece modu kendiliğinden
  // açılır ya da kapanır; arada elle değiştirilen seçim bir sonraki doğuşa/batışa kadar kalır.
  // Üst şeritteki güneş rozeti: oyun saati, güneşin yönü (ekrana göre, harita döndükçe döner) ve yüksekliği
  const YONLER = () => [dl('K', 'N'), dl('KD', 'NE'), dl('D', 'E'), dl('GD', 'SE'), dl('G', 'S'), dl('GB', 'SW'), dl('B', 'W'), dl('KB', 'NW')];
  let rozetAz = null, rozetSon = null;
  function gunesRozeti(az, el, bulut, saat) {
    rozetSon = [az, el, bulut, saat];
    const r = $('gunesRozet');
    if (!r) return;   // önbellekten eski index.html geldiyse
    r.hidden = false;
    const batik = el < -0.8;
    r.classList.toggle('batik', batik);
    $('gunesSimge').textContent = batik ? '🌙' : bulut ? '⛅' : '☀️';
    if (saat) $('gunesSaat').textContent = saat;
    $('gunesYazi').textContent = batik
      ? dl('Güneş battı', 'Sun has set')
      : `${dl('Güneş', 'Sun')} ${YONLER()[Math.round(((az % 360) + 360) % 360 / 45) % 8]} ${Math.round(el)}°`;
    r.title = dl('Oyun saati ve güneşin konumu; nokta güneşin ekrandaki yönünü gösterir',
      'Game time and sun position; the dot shows the sun direction on screen');
    rozetAz = az;
    gunesOkunuDondur();
  }
  function gunesOkunuDondur() {
    if (rozetAz === null) return;
    const ok = document.querySelector('.gunes-ok');
    if (ok) ok.style.transform = `rotate(${rozetAz - harita.getBearing()}deg)`;
  }
  harita.on('rotate', gunesOkunuDondur);

  let gunesBatik = null;
  function gunesiUygula(az, el, bulut) {
    const r = Math.PI / 180, e = Math.max(el, 7) * r, a = az * r;
    gunes.v = [Math.sin(a) * Math.cos(e), Math.cos(a) * Math.cos(e), Math.sin(e)];
    gunes.azimut = az;
    gunes.yukseklik = Math.max(el, 7);
    const sicak = Math.min(1, Math.max(0, el / 25));            // 0: doğuş/batış, 1: gün ortası
    const guc = (bulut ? 0.45 : 1) * Math.min(1, Math.max(0.25, (el + 3) / 12));
    gunes.renk = [1, 0.62 + 0.33 * sicak, 0.38 + 0.48 * sicak].map((c) => c * guc);
    gunes.golge = GOLGE_GUC * (bulut ? 0.4 : 1) * Math.min(1, Math.max(0, el / 10));
    const batik = el < -2;
    if (batik !== gunesBatik) {
      const ilk = gunesBatik === null;
      gunesBatik = batik;
      if (!ilk || batik) { gece = batik; $('geceSec').checked = gece; }
      gorunumuUygula();
      return;
    }
    if (!gece) {
      harita.setPaintProperty('golge', 'fill-opacity', 0.34 * gunes.golge);
      harita.setPaintProperty('golge', 'fill-translate', golgeKaymasi(gunes.v));
      harita.setLight({ anchor: 'map', position: [1.3, az, Math.min(80, Math.max(10, 90 - gunes.yukseklik))], color: '#fff6e6', intensity: 0.42 });
    }
    harita.triggerRepaint();
  }
  $('katmanDug').onclick = () => {
    const a = $('katmanlar').hidden;
    $('katmanlar').hidden = !a;
    $('katmanDug').setAttribute('aria-expanded', String(a));
  };
  // cephe ve karbon aynı boyayı kullanır: biri açılınca öteki kapanır
  function boyaKatmani(cepheMi, acik) {
    cepheAcik = cepheMi && acik;
    karbonAcik = !cepheMi && acik;
    $('kCephe').checked = cepheAcik;
    $('kKarbon').checked = karbonAcik;
    $('lejant').hidden = !cepheAcik;
    $('lejantKarbon').hidden = !karbonAcik;
    gorunumuUygula();
    durumPaneli();
  }
  $('kCephe').onchange = (e) => boyaKatmani(true, e.target.checked);
  $('kKarbon').onchange = (e) => boyaKatmani(false, e.target.checked);
  $('kBolge').onchange = (e) => {
    harita.setLayoutProperty('bolge-cizgi', 'visibility', e.target.checked ? 'visible' : 'none');
  };
  $('kEtiket').onchange = (e) => { etiketAcik = e.target.checked; etiketleriSeyrelt(); };
  $('kBina').onchange = (e) => {
    const v = e.target.checked ? 'visible' : 'none';
    model.gorunur = e.target.checked;
    harita.triggerRepaint();
    harita.setLayoutProperty('golge', 'visibility', v);
  };
  $('kYol').onchange = (e) => { yolAcik = e.target.checked; isaretleriSeyrelt(); };
  $('kCevre').onchange = (e) => {
    cevreAcik = e.target.checked;
    if (!cevreAcik && seciliBina && !V.binalar.features[seciliBina - 1].properties.ic) sec(null);
    gorunumuUygula();
    etiketleriSeyrelt();
  };
  $('kAgac').onchange = (e) => {
    agacAcik = e.target.checked;
    harita.setLayoutProperty('tac-alti', 'visibility', agacAcik ? 'visible' : 'none');
    harita.triggerRepaint();
  };

  // Kullanıcının isteğiyle yavaş 360° tur; ilk dokunuşta durur
  let tur = null;
  function turuDurdur() {
    if (tur) cancelAnimationFrame(tur);
    tur = null;
    $('dondur').setAttribute('aria-pressed', 'false');
  }
  $('dondur').onclick = () => {
    if (tur) return turuDurdur();
    otomatikCerceve = false;
    $('dondur').setAttribute('aria-pressed', 'true');
    let son = performance.now();
    const adim = (t) => {
      harita.setBearing(harita.getBearing() + (t - son) * 0.006);
      son = t;
      tur = requestAnimationFrame(adim);
    };
    tur = requestAnimationFrame(adim);
  };
  harita.getCanvas().addEventListener('pointerdown', () => {
    turuDurdur();
    $('ipucu').classList.add('gizli');
  });
  setTimeout(() => $('ipucu').classList.add('gizli'), 9000);

  // --- Yuvarlak genel harita: ayrı, etkileşimsiz bir örnek; yalnızca görüş alanı değişince çizer
  const mini = new maplibregl.Map({
    container: 'mini',
    attributionControl: false,
    interactive: false,
    pixelRatio: 1,
    center: V.merkez,
    zoom: innerWidth < 720 ? 12.1 : 12.6,
    style: {
      version: 8,
      sources: {
        uydu: UYDU,
        sinir: { type: 'geojson', data: V.sinir },
        gorus: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
      },
      layers: [
        { id: 'zemin', type: 'background', paint: { 'background-color': ZEMIN_RENK } },   // uydu inmezse
        { id: 'uydu', type: 'raster', source: 'uydu', paint: { 'raster-fade-duration': 0, 'raster-saturation': -0.25 } },
        { id: 'sinir', type: 'line', source: 'sinir', paint: { 'line-color': '#ffffff', 'line-width': 1, 'line-opacity': 0.7 } },
        { id: 'gorus-d', type: 'fill', source: 'gorus', paint: { 'fill-color': '#5fdccb', 'fill-opacity': 0.25 } },
        { id: 'gorus-c', type: 'line', source: 'gorus', paint: { 'line-color': '#5fdccb', 'line-width': 1.6 } },
      ],
    },
  });

  function miniyiBoya() {
    if (mini.isStyleLoaded() && mini.getLayer('uydu')) {
      mini.setPaintProperty('uydu', 'raster-brightness-max', gece ? 0.4 : 1);
      mini.setPaintProperty('zemin', 'background-color', gece ? '#0a1222' : ZEMIN_RENK);
    }
  }

  function gorusAlani() {
    const k = harita.getCanvas();
    const w = k.clientWidth, h = k.clientHeight;
    // ekranın üstü ufka bakabilir: köşeleri kutuya kırparak görüş dörtgeni taşmaz
    const [x0, y0, x1, y1] = V.kutu;
    const kose = [[0, h * 0.12], [w, h * 0.12], [w, h], [0, h]].map(([x, y]) => {
      // harita.unproject arazi açıkken GPU'dan piksel okur; dörtgen için arazisiz hesap yeterli
      const p = harita.transform.screenPointToLocation(new maplibregl.Point(x, y));
      return [Math.min(x1 + 0.02, Math.max(x0 - 0.02, p.lng)), Math.min(y1 + 0.02, Math.max(y0 - 0.02, p.lat))];
    });
    kose.push(kose[0]);
    const s = mini.getSource('gorus');
    if (s) s.setData({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [kose] } });
  }
  mini.on('load', () => { gorusAlani(); miniyiBoya(); });
  mini.getContainer().addEventListener('click', (e) => {
    const r = mini.getContainer().getBoundingClientRect();
    otomatikCerceve = false;
    harita.flyTo({ center: mini.unproject([e.clientX - r.left, e.clientY - r.top]), duration: azHareket ? 0 : 900 });
  });

  // --- Sol alttaki gösterge
  const dms = (v, a, b) => `${Math.abs(v).toFixed(4)}°${v >= 0 ? a : b}`;
  function gostergeyiYaz() {
    const c = harita.getCenter();
    $('hKonum').textContent = `${dms(c.lat, dl('K', 'N'), dl('G', 'S'))} ${dms(c.lng, dl('D', 'E'), dl('B', 'W'))}`;
    $('hZoom').textContent = `z${harita.getZoom().toFixed(1)}`;
    $('igne').style.transform = `rotate(${-harita.getBearing()}deg)`;
  }
  // fps yalnızca harita çizerken sayılır; boştayken sayfa kare üretmesin
  let kare = 0, kareZaman = performance.now(), sonCizim = 0, yavasSaniye = 0, izlemeBasi = Infinity;
  const dprYaz = () => { $('hDpr').textContent = `DPR ${harita.getPixelRatio().toFixed(2)}${kalite ? ' · K' + kalite : ''}`; };
  // Sürekli kasıyorsa (2 sn üst üste 24 fps altı) bir kademe düş: çözünürlük, ağaç ayrıntısı, gölgeler.
  // Kasma geçiciyse (açılış, arka planda bir iş) kare hızı uzun süre rahat kalınca bir kademe geri çıkar. Çıktıktan
  // kısa süre sonra yine düşerse o kademe bu cihaza ağır demektir: bir sonraki çıkış için bekleme iki katına çıkar.
  let hizliSaniye = 0, cikisBekle = 6, sonCikis = -Infinity;
  function kaliteyiAyarla(yeni) {
    kalite = yeni;
    yavasSaniye = hizliSaniye = 0;
    if (Math.abs(harita.getPixelRatio() - kaliteDpr()) > 0.01) harita.setPixelRatio(kaliteDpr());
    dprYaz();
    harita.triggerRepaint();
  }
  function kaliteyiIzle(fps, t) {
    yavasSaniye = fps < 24 ? yavasSaniye + 1 : 0;
    hizliSaniye = fps >= 48 ? hizliSaniye + 1 : 0;
    if (yavasSaniye >= 2 && kalite < KALITE.length - 1) {
      if (t - sonCikis < 30000) cikisBekle = Math.min(cikisBekle * 2, 96);
      kaliteyiAyarla(kalite + 1);
    } else if (hizliSaniye >= cikisBekle && kalite > 0) {
      sonCikis = t;
      kaliteyiAyarla(kalite - 1);
    }
  }
  harita.on('render', () => {
    const t = performance.now();
    if (t - sonCizim > 400) {   // boşta geçen süre ortalamaya girmesin
      kare = 0;
      kareZaman = t;
    }
    sonCizim = t;
    kare++;
    if (t - kareZaman > 1000) {
      const fps = kare * 1000 / (t - kareZaman);
      $('hFps').textContent = `${Math.round(fps)} fps`;
      // sekme arka plandayken tarayıcı kareleri kısar: ölçüm yalnızca görünürken
      // açılışta paftalar inerken kareler doğal olarak yavaştır: ilk saniyeler sayılmaz
      if (document.visibilityState === 'visible' && kare >= 3 && t > izlemeBasi) kaliteyiIzle(fps, t);
      kare = 0;
      kareZaman = t;
    }
  });
  dprYaz();
  let seyreltmeZaman = 0, gorusZaman = 0;
  harita.on('move', () => {
    gostergeyiYaz();
    for (const n of noktalar) if (n.acik) konumla(n);
    const t = performance.now();
    if (t - seyreltmeZaman > 220) {
      seyreltmeZaman = t;
      etiketleriSeyrelt();
    }
    // görüş dörtgeni mini haritayı yeniden çizdirir ve veriyi işçiye yollar: her karede değil
    if (t - gorusZaman > 250) {
      gorusZaman = t;
      gorusAlani();
    }
  });
  harita.on('moveend', () => { etiketleriSeyrelt(); gorusAlani(); });
  harita.on('idle', etiketleriSeyrelt);   // arazi paftası inince yükseklik, dolayısıyla konum değişebilir

  // --- Ağ sorunları (zayıf konferans Wi-Fi'ı): uydu ya da yükselti paftaları inmezse sahne yine doğru görünür ve
  // uyarı gerçeği söyler. Yükselti yoksa MapLibre zemini 0 m sayar; mutlak yükseklikteki modeller (M.taban ~873 m)
  // havada kalırdı. Bu durumda arazi kapatılır, binalar ve ağaçlar kendi tabanlarıyla düz zemine iner (duzZemin).
  // Uydu yoksa zemin düz renktir (ZEMIN_RENK). Ağ geri gelince (online olayı ya da 20 sn'de bir deneme) ikisi de döner.
  let uyduHataSay = 0, uyduHata = false, demHataSay = 0, demYuklendi = false, modelHatasi = false;
  let denemeZaman = null, araziAcmaSay = 0;

  function uyariYaz() {
    let metin = '';
    if (modelHatasi) {
      metin = dl('3B bina modelleri bu cihazda açılamadı; harita ve yer adları kullanılabilir.',
        '3D building models could not be opened on this device; the map and place names still work.');
    } else if (uyduHata && duzZemin) {
      metin = dl('İnternet bağlantısı yok ya da zayıf: uydu görüntüsü ve arazi inmiyor. Kampüs düz zeminde gösteriliyor; bağlantı gelince kendiliğinden düzelir.',
        'No or weak internet: satellite imagery and terrain are not loading. The campus is shown on flat ground and recovers when the connection returns.');
    } else if (uyduHata) {
      metin = dl('Uydu görüntüsü inmiyor; zemin düz renkle gösteriliyor. Bağlantı gelince kendiliğinden düzelir.',
        'Satellite imagery is not loading; the ground is shown in a plain colour. It recovers when the connection returns.');
    } else if (duzZemin) {
      metin = dl('Arazi yükseklik verisi inmiyor; kampüs düz zeminde gösteriliyor. Bağlantı gelince kendiliğinden düzelir.',
        'Terrain data is not loading; the campus is shown on flat ground. It recovers when the connection returns.');
    }
    uyariGoster(metin);
  }

  // Arazi kamera hareketinin ortasında açılıp kapanırsa MapLibre kamera yüksekliğini dondurulmuş bırakıyordu
  // (_elevationFreeze): arazi geri gelince kamera yerin ~950 m altında kalıyor, ekran boş görünüyordu. Hareket
  // durdurulur, donma çözülür; yükseklik ilk yükselti paftasıyla yeniden hesaplanır.
  function araziGecisi(arazi) {
    harita.stop();
    harita.setTerrain(arazi);
    if ('_elevationFreeze' in harita) harita._elevationFreeze = false;
    harita.triggerRepaint();
    cerceveyiYenile(true);   // kullanıcı kamerayı oynatmadıysa (açılış sürerken) kampüs yeniden çerçevelenir
  }

  // Güvenlik ağı: MapLibre 5.6 her easeTo'da kamera yüksekliğini hedefe dondurur; hedef, yükselti paftası henüz
  // inmeden hesaplandıysa (arazi yeni açıldı) kamera 0 m'de, yerin altında kalır. Harita durunca fark büyükse çözülür.
  harita.on('idle', () => {
    const t = harita.terrain;
    if (!t || !harita._elevationFreeze) return;
    const yer = t.getElevationForLngLatZoom(harita.transform.center, harita.transform.tileZoom);
    if (Math.abs(yer - harita.transform.elevation) > 50) {
      harita._elevationFreeze = false;
      harita.triggerRepaint();
    }
  });

  function araziyiKapat() {
    if (duzZemin) return;
    console.warn('ikiz: yükselti paftaları inmiyor, arazi kapatıldı');
    duzZemin = true;
    araziGecisi(null);
    cerceveNoktalari = null;   // çerçeve yükseklikleri araziyle değişti
    harita.triggerRepaint();
    uyariYaz();
    denemeyiKur();
  }

  function araziyiAc() {
    if (!duzZemin) return;
    duzZemin = false;
    demHataSay = 0;
    demYuklendi = false;
    araziGecisi(ARAZI);   // terrain null iken MapLibre kaynağı baştan yükler
    araziyiBekle();
    cerceveNoktalari = null;
    gorunumuUygula();
    uyariYaz();
  }

  // Hatalı uydu paftaları MapLibre'de kendiliğinden yeniden istenmez. Kaynak katmanıyla birlikte kaldırılıp yeniden
  // eklenir. (setTiles arazi açıkken dokusu olmayan paftayı çizmeye kalkıp çizim döngüsünü durduruyordu: ekran boş.)
  function uyduyuTazele() {
    const m = harita;
    const kaynak = (m.getLayer('uydu') && m.getLayer('uydu').source) || 'uydu-cevre';
    if (m.getLayer('uydu')) m.removeLayer('uydu');
    for (const [id, tanim] of [['uydu', UYDU_KAMPUS], ['uydu-cevre', UYDU]]) {
      if (m.getSource(id)) m.removeSource(id);
      m.addSource(id, tanim);
    }
    m.addLayer({ id: 'uydu', type: 'raster', source: kaynak, paint: { 'raster-fade-duration': 0, 'raster-contrast': 0.08 } }, 'tac-alti');
    if (mini.getLayer('uydu')) {
      const boya = { 'raster-fade-duration': 0, 'raster-saturation': -0.25 };
      mini.removeLayer('uydu');
      mini.removeSource('uydu');
      mini.addSource('uydu', UYDU);
      mini.addLayer({ id: 'uydu', type: 'raster', source: 'uydu', paint: boya }, 'sinir');
    }
    gorunumuUygula();   // parlaklık, doygunluk
    if (dil !== 'tr') diliUygula(dil);   // künye yazıları
  }

  // ağ geldi mi: kampüsün z12 yükselti paftası sorulur (küçük, önbelleğe alınmaz)
  const DENEME_PAFTA = (() => {
    const z = 12, n = 2 ** z, r = V.merkez[1] * Math.PI / 180;
    const x = Math.floor((V.merkez[0] + 180) / 360 * n);
    const y = Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n);
    return DEM.tiles[0].replace('{z}', z).replace('{x}', x).replace('{y}', y);
  })();
  async function agiDene() {
    clearTimeout(denemeZaman);
    denemeZaman = null;
    if (!duzZemin && !uyduHata) return;
    let ulasildi = false;
    const iptal = new AbortController();
    const sure = setTimeout(() => iptal.abort(), 8000);
    try {
      ulasildi = (await fetch(DENEME_PAFTA, { cache: 'no-store', signal: iptal.signal })).ok;
    } catch (_) { /* hâlâ çevrimdışı */ }
    clearTimeout(sure);
    if (ulasildi) {
      if (duzZemin && araziAcmaSay++ < 6) araziyiAc();     // sonsuz aç-kapa olmasın
      if (uyduHata) { uyduHataSay = 0; uyduyuTazele(); }   // uyarı ilk pafta inince kalkar (sourcedata)
    }
    denemeyiKur();
  }
  function denemeyiKur() {
    if ((duzZemin || uyduHata) && !denemeZaman) denemeZaman = setTimeout(agiDene, 20000);
  }
  addEventListener('online', () => { agiDene(); });

  harita.on('error', (e) => {
    const k = String(e.sourceId || '');
    if (k.startsWith('uydu')) {
      if (++uyduHataSay >= 3 && !uyduHata) {
        uyduHata = true;
        uyariYaz();
        denemeyiKur();
      }
    } else if (k === 'dem') {
      // hiç pafta inmediyse 3 hata yeter; daha önce inmişse (ağ sunum sırasında koptu) kalıcı kopuş beklenir
      if (++demHataSay >= (demYuklendi ? 8 : 3)) araziyiKapat();
    } else if (!k) {
      console.warn('ikiz: harita hatası', e.error || e);
    }
  });
  harita.on('sourcedata', (e) => {
    if (!e.tile || e.tile.state !== 'loaded') return;
    const k = String(e.sourceId);
    if (k.startsWith('uydu')) {
      uyduHataSay = 0;
      if (uyduHata) { uyduHata = false; uyariYaz(); }
    } else if (k === 'dem') {
      demYuklendi = true;
      demHataSay = 0;
    }
  });

  // --- Kampüsü çerçeveleyen kamera. MapLibre'nin perspektif izdüşümü burada yeniden yapılır (görüş açısı, merkezin arazi
  // yüksekliği, kenar boşluğu); cameraForBounds eğimi ve araziyi hesaba katmadığından kampüs ya küçük ya kesik kalıyordu.
  // Sınırın köşeleri ve bina tepeleri üst şerit ile alt panel arasındaki boş alana sığar; bakış yönü -45..45° arasında
  // kampüsü en büyük gösteren seçilir (16:9'da ~15°: eski -28°'den %30 büyük).
  const R_DUNYA = 6378137;
  const KOS0 = Math.cos(V.merkez[1] * Math.PI / 180);
  const mercY = (la) => Math.log(Math.tan(Math.PI / 4 + la * Math.PI / 360)) * R_DUNYA * KOS0;
  const yerel = (lo, la) => [(lo - V.merkez[0]) * Math.PI / 180 * R_DUNYA * KOS0, mercY(la) - mercY(V.merkez[1])];
  const yereldenLL = (x, y) => [V.merkez[0] + x / (Math.PI / 180 * R_DUNYA * KOS0),
    (2 * Math.atan(Math.exp((y + mercY(V.merkez[1])) / (R_DUNYA * KOS0))) - Math.PI / 2) * 180 / Math.PI];
  let cerceveNoktalari = null;   // [x, y, yükseklik] (m); arazi inince bir kez kurulur
  let otomatikCerceve = true;    // kullanıcı kamerayı oynatana kadar ekran değişince kampüs yeniden çerçevelenir
  let kenarAlt = 0, acilisBitis = 0, cerceveZaman = null;

  function noktalariKur() {
    const ham = SINIR.map((q) => [q[0], q[1], 0]);
    for (const f of V.binalar.features) {
      if (!f.properties.ic) continue;
      const h = f.geometry.coordinates[0];
      const o = h.reduce((a, q) => [a[0] + q[0] / h.length, a[1] + q[1] / h.length], [0, 0]);
      ham.push([o[0], o[1], f.properties.h || 0]);
    }
    const e = ham.map(([lo, la]) => harita.queryTerrainElevation([lo, la]));
    const bilinen = e.filter((v) => v != null);
    const ort = bilinen.length ? bilinen.reduce((a, v) => a + v, 0) / bilinen.length : 0;
    const n = ham.map(([lo, la, h], i) => [...yerel(lo, la), (e[i] ?? ort) + h]);
    // arazi henüz inmediyse eksikler ortalamayla tahmin edilir; tamamı bilinene kadar her seferinde yeniden sorulur
    if (bilinen.length === ham.length) cerceveNoktalari = n;
    return n;
  }

  function cerceveBul(nok, b, W, H, pad) {
    const th = ACILIS.pitch * Math.PI / 180, br = b * Math.PI / 180;
    const st = Math.sin(th), ct = Math.cos(th), sb = Math.sin(br), cb = Math.cos(br);
    const D = 0.5 * H / Math.tan((harita.transform.fov || 36.87) * Math.PI / 360);   // MapLibre'nin dikey görüş açısı
    const aw = W - pad.left - pad.right, ah = H - pad.top - pad.bottom;
    const tx = pad.left + aw / 2, ty = pad.top + ah / 2;
    let cx = 0, cy = 0, z = 15, e0 = nok.reduce((a, q) => a + q[2], 0) / nok.length;
    for (let k = 0; k < 30; k++) {
      const e = harita.queryTerrainElevation(yereldenLL(cx, cy));
      if (e != null) e0 = e;
      const ppm = 512 * 2 ** z / (2 * Math.PI * R_DUNYA * KOS0);
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (const [x, y, h] of nok) {
        const X = (x - cx) * ppm, Y = (y - cy) * ppm, Z = (h - e0) * ppm;
        const a = X * cb - Y * sb, d = X * sb + Y * cb;
        const derin = D + d * st - Z * ct, yc = d * ct + Z * st;
        const sx = tx + a * D / derin, sy = ty - yc * D / derin;
        if (sx < x0) x0 = sx;
        if (sx > x1) x1 = sx;
        if (sy < y0) y0 = sy;
        if (sy > y1) y1 = sy;
      }
      const olcek = Math.log2(Math.min(aw / (x1 - x0), ah / (y1 - y0)));
      const ex = (x0 + x1) / 2 - tx, ey = (y0 + y1) / 2 - ty;
      if (Math.abs(olcek) < 0.002 && Math.abs(ex) < 0.5 && Math.abs(ey) < 0.5) break;
      // kutunun ortası hedefe gelsin: ekrandaki kayma merkezde yere izdüşürülür (dikeyde eğim kadar kısalır)
      const da = ex / ppm * 0.85, dd = -ey / (ppm * ct) * 0.85;
      cx += da * cb + dd * sb;
      cy += -da * sb + dd * cb;
      z += olcek;
    }
    return { center: yereldenLL(cx, cy), zoom: z, bearing: b };
  }

  function cerceveBoslugu() {
    const pay = Math.round(Math.min(innerWidth, innerHeight) * 0.025);
    const ust = document.querySelector('.ust').getBoundingClientRect().bottom;
    const sag = innerWidth <= 720 ? 12 : innerWidth - $('yakin').getBoundingClientRect().left + 8;
    return { top: Math.round(ust + pay), bottom: Math.round(kenarAlt + 26 + pay), left: 12 + pay, right: Math.round(sag + pay) };
  }

  function kampusKamerasi() {
    const nok = cerceveNoktalari || noktalariKur();
    const W = harita.getCanvas().clientWidth, H = harita.getCanvas().clientHeight, pad = cerceveBoslugu();
    if (W - pad.left - pad.right < 80 || H - pad.top - pad.bottom < 80) return;
    let en = null;
    const dene = (b) => { const k = cerceveBul(nok, b, W, H, pad); if (!en || k.zoom > en.zoom) en = k; };
    for (let b = -45; b <= 45; b += 5) dene(b);
    const kaba = en.bearing;
    for (let b = kaba - 4; b <= kaba + 4; b += 1) if (b !== kaba) dene(b);
    if (!Number.isFinite(en.zoom) || !en.center.every(Number.isFinite)) return;
    Object.assign(ACILIS, { center: en.center, zoom: Math.max(en.zoom, harita.getMinZoom()), bearing: en.bearing, padding: pad });
  }

  // ekran, üst şerit ya da alt panel değişince: kullanıcı kamerayı oynatmadıysa kampüs yeniden çerçevelenir
  function cerceveyiYenile(hemen) {
    clearTimeout(cerceveZaman);
    cerceveZaman = setTimeout(() => {
      if (!acilisBitis || !otomatikCerceve) return;
      kampusKamerasi();
      const kalan = acilisBitis - performance.now();
      harita.easeTo({ ...ACILIS, duration: azHareket ? 0 : Math.max(kalan, 700), easing: (t) => 1 - Math.pow(1 - t, 3) }, { cerceve: true });
    }, hemen ? 0 : 150);
  }
  harita.on('resize', () => {
    // pencere büyüyüp küçülünce (tam ekran, başka monitör) piksel bütçesi yeniden hesaplanır
    if (Math.abs(harita.getPixelRatio() - kaliteDpr()) > 0.02) { harita.setPixelRatio(kaliteDpr()); dprYaz(); }
    cerceveyiYenile();
  });
  harita.on('movestart', (e) => { if (e.originalEvent) otomatikCerceve = false; });
  const marka = document.querySelector('.marka');
  marka.setAttribute('role', 'button');
  marka.tabIndex = 0;
  marka.title = dl('Kampüsün tamamını göster', 'Show the whole campus');
  const eveDon = () => { otomatikCerceve = true; turuDurdur(); cerceveyiYenile(true); };
  marka.addEventListener('click', eveDon);
  marka.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); eveDon(); } });

  // --- Dil değişimi: sayfadaki sabit yazılar, etiketler, açık kart, arama sonuçları ve harita künyesi
  const SABIT = [
    ['.marka span', 'textContent', 'İnönü Kampüs İkizi', 'İnönü Campus Twin'],
    ['#harita', 'aria-label', 'Kampüsün üç boyutlu haritası', '3D map of the campus'],
    ['#ara', 'placeholder', 'Fakülte, yurt, kafe ara', 'Search faculties, dorms, cafés'],
    ['#ara', 'aria-label', 'Kampüste yer ara', 'Search places on campus'],
    ['.gece span', 'textContent', 'Gece modu', 'Night mode'],
    ['.kontroller', 'aria-label', 'Harita denetimleri', 'Map controls'],
    ['#yakin', 'aria-label', 'Yakınlaştır', 'Zoom in'],
    ['#uzak', 'aria-label', 'Uzaklaştır', 'Zoom out'],
    ['#pusula', 'aria-label', 'Kuzeye döndür', 'Reset to north'],
    ['#dondur', 'aria-label', 'Otomatik döndür', 'Auto-rotate'],
    ['#katmanDug', 'aria-label', 'Katmanlar', 'Layers'],
    ['#kCephe', 'etiket', 'Cephe durumu', 'Facade condition'],
    ['#kKarbon', 'etiket', 'Karbon yoğunluğu', 'Carbon intensity'],
    ['#kYol', 'etiket', 'Yol noktaları', 'Road points'],
    ['#kBolge', 'etiket', 'Bölgeler', 'Zones'],
    ['#kEtiket', 'etiket', 'Yer adları', 'Place names'],
    ['#kBina', 'etiket', '3B binalar', '3D buildings'],
    ['#kAgac', 'etiket', 'Ağaçlar', 'Trees'],
    ['#kCevre', 'etiket', 'Kampüs çevresi', 'Campus surroundings'],
    ['#lejant span:nth-child(1)', 'etiket', 'Sağlam', 'Sound'],
    ['#lejant span:nth-child(2)', 'etiket', 'Yenilenmeli', 'Needs renewal'],
    ['#lejant span:nth-child(3)', 'etiket', 'Aşınmış', 'Worn'],
    ['#lejantKarbon .uclar small:nth-child(2)', 'textContent', 'kg CO₂e/m²·yıl', 'kg CO₂e/m²·yr'],
    ['#ipucu', 'textContent', 'Sağ tıkla sürükleyerek 360° döndürün', 'Right-click and drag to rotate 360°'],
    ['#kartKapat', 'aria-label', 'Kartı kapat', 'Close card'],
    ['#kartAc', 'textContent', 'Detaylar ve işlemler', 'Details and actions'],
    ['#mini', 'aria-label', 'Kampüs genel haritası, dokunduğunuz yere gider', 'Campus overview map; tap to go there'],
    ['.marka', 'title', 'Kampüsün tamamını göster', 'Show the whole campus'],
    ['#dilDug', 'textContent', 'EN', 'TR'],
    ['#dilDug', 'aria-label', 'Switch to English', 'Türkçeye geç'],
  ];
  const KUNYE = {
    uydu: ['Uydu: Esri, Maxar, Earthstar Geographics', 'Imagery: Esri, Maxar, Earthstar Geographics'],
    'uydu-cevre': ['Uydu: Esri, Maxar, Earthstar Geographics', 'Imagery: Esri, Maxar, Earthstar Geographics'],
    dem: ['Yükselti: Mapzen/AWS Terrain Tiles', 'Elevation: Mapzen/AWS Terrain Tiles'],
    binalar: ['© OpenStreetMap katkıda bulunanlar', '© OpenStreetMap contributors'],
    sinir: ['Ağaçlar: Meta & WRI taç yüksekliği (CC BY 4.0), bahçeler uydu görüntüsünden',
      'Trees: Meta & WRI canopy height (CC BY 4.0), orchards from satellite imagery'],
  };

  function diliUygula(yeni) {
    dil = yeni;
    document.documentElement.lang = dil;
    document.title = dl('İnönü Kampüs İkizi', 'İnönü Campus Twin');
    for (const [secici, alan, tr, en] of SABIT) {
      const el = document.querySelector(secici);
      if (!el) continue;
      const metin = dl(tr, en);
      if (alan === 'textContent') el.textContent = metin;
      // katman kutuları: <label><input> Metin</label>; lejant: <span><i></i>Metin</span>
      else if (alan === 'etiket') {
        if (el.tagName === 'INPUT') el.parentNode.lastChild.textContent = ' ' + metin;
        else el.lastChild.textContent = metin;
      }
      else el.setAttribute(alan, metin);
    }
    for (const e of etiketler) e.yazi.textContent = adCevir(e.y.ad);
    for (const i of [...Object.values(yolIsaret), ...Object.values(binaIsaret)]) {
      if (i.n.el.dataset.ad) i.n.el.setAttribute('aria-label', adCevir(i.n.el.dataset.ad));
    }
    for (const [id, [tr, en]] of Object.entries(KUNYE)) {
      const k = harita.getSource(id);
      if (k && (id !== 'sinir' || window.IKIZ_AGAC)) k.attribution = dl(tr, en);
    }
    if (kunye && typeof kunye._updateAttributions === 'function') kunye._updateAttributions();
    if (!$('kart').hidden) sec(...sonSecim);
    if (!$('sonuclar').hidden) sonuclariCiz();
    gostergeyiYaz();
    etiketleriSeyrelt();
    if (rozetSon) gunesRozeti(...rozetSon);
    durumPaneli();
    uyariYaz();
    try { if (!window.Ikiz) localStorage.setItem('ikizDil', dil); } catch (_) { /* depolama kapalı */ }
  }
  $('dilDug').onclick = () => {
    const yeni = dil === 'en' ? 'tr' : 'en';
    diliUygula(yeni);
    flutter({ tur: 'dil', dil: yeni });   // uygulama da dilini değiştirir, dilAyarla ile aynısı geri gelir
  };
  if (dil !== 'tr') {
    diliUygula(dil);
    harita.once('load', () => diliUygula(dil));   // künye kaynakları ancak yüklenince var
  }

  // Arazi ağı: yükselti z14 paftalarından geliyor; 128×128 ağ verinin çözünürlüğünden sık, kare başına birkaç ms boşa
  // gidiyordu. 64×64 ağ ~15 m aralıklı, kampüsün yumuşak eğimini aynı veriyor. Arazi bazen 'load'dan sonra kurulur.
  function araziAginiSeyrelt() {
    const t = harita.terrain;
    if (!t || !(t.meshSize > 64)) return;
    t.meshSize = 64;
    t._meshCache = {};
    harita.triggerRepaint();
  }
  harita.on('terrain', araziAginiSeyrelt);

  harita.on('load', () => {
    harita.addLayer(model);
    araziAginiSeyrelt();
    // açılış: kampüsün tamamı, ekran boyutu ne olursa olsun
    kampusKamerasi();
    acilisBitis = performance.now() + (azHareket ? 0 : 2800);
    if (azHareket) harita.jumpTo(ACILIS, { cerceve: true });
    gorunumuUygula();
    gostergeyiYaz();
    etiketleriSeyrelt();
    if (!azHareket) harita.easeTo({ ...ACILIS, duration: 2800, easing: (t) => 1 - Math.pow(1 - t, 3) }, { cerceve: true });
    flutter({ tur: 'hazir' });
    izlemeBasi = performance.now() + 6000;
    araziyiBekle();
  });
  // Yükselti paftası hiç gelmiyorsa (istek asılı kaldı, hata da gelmedi) arazi beklemeden kapatılır
  // Sekme arka plandayken harita çizmez, pafta da istemez: o süre "gelmedi" sayılmaz (yoksa sunum sırasında başka
  // pencereye geçilince arazi boşuna kapanıyordu).
  function araziyiBekle() {
    setTimeout(() => {
      if (duzZemin || demYuklendi) return;
      if (document.hidden) araziyiBekle(); else araziyiKapat();
    }, 15000);
  }

  // MapLibre 5.6: kamera hareketi arazi yokken başlayıp arazi hareketin ortasında açılırsa _updateElevation
  // hazırlanmamış merkezle çalışıp istisna atıyor ve çizim döngüsü kalıcı olarak duruyor (boş ekran). Eksikse hazırlanır.
  if (typeof harita._updateElevation === 'function' && typeof harita._prepareElevation === 'function') {
    const yukseklikGuncelle = harita._updateElevation;
    harita._updateElevation = function (k) {
      if (this.terrain && (this._elevationCenter === undefined || this._elevationStart === undefined)) {
        this._prepareElevation(this.transform.center);
      }
      return yukseklikGuncelle.call(this, k);
    };
  }

  // Android'de uygulama arka plana geçince WebGL bağlamı kaybolabilir. MapLibre yalnızca kendi çizicisini kurar;
  // bina ve ağaç tamponları eski bağlamda kalır. En güvenlisi sayfayı yeniden yüklemek: Flutter 'hazir' iletisiyle
  // bütün durumu yeniden gönderir.
  harita.on('webglcontextrestored', () => location.reload());

  // Flutter'dan gelenler
  window.ikiz = {
    cepheAyarla(d) {
      Object.assign(cephe, d);
      model.gorunum();   // varsayılan görünümde de aşınmış cepheler tonlanır
      durumPaneli();
      if (seciliAd && !$('kart').hidden) {
        if (sonSecim[0]) sec(...sonSecim);   // kart açık: cephe satırı tazelensin
      }
    },
    karbonAyarla(d) {
      Object.assign(karbon, d);
      const [en, eb] = karbonAraligi();
      $('kMin').textContent = Math.round(en);
      $('kMax').textContent = Math.round(eb);
      if (karbonAcik) gorunumuUygula();
    },
    // yol: id -> durum simgesi, bina: id -> süren işin yazısı, kampus: [{ad, durum, bitti}] kampüs geneli projeler
    isaretAyarla(d) {
      const yol = (d && d.yol) || {}, bina = (d && d.bina) || {};
      isBolgeleri.clear();
      for (const id in yol) {
        const i = yolIsaret[id];
        if (!i) continue;
        i.n.el.textContent = yol[id];
        i.sorun = yol[id] !== '✅';
        const calisma = yol[id] === '🚧';
        i.n.el.classList.toggle('calisma', calisma);
        const b = /^b(\d+)_/.exec(id);
        if (calisma && b) isBolgeleri.add(Number(b[1]));
      }
      const suzgec = ['in', ['get', 'id'], ['literal', [...isBolgeleri]]];
      for (const k of ['bolge-is', 'bolge-is-cizgi']) if (harita.getLayer(k)) harita.setFilter(k, suzgec);
      for (const id in binaIsaret) binaIsaret[id].suruyor = id in bina;
      for (const id in bina) {
        const y = V.yerler.find((a) => a.oid === id);
        if (!y) continue;
        binaIsaret[id] ??= { n: isaretKur(y.c, y.ad, { tur: 'bina', id }), suruyor: true };
        binaIsaret[id].suruyor = true;
        binaIsaret[id].n.el.textContent = bina[id];
        binaIsaret[id].n.el.classList.add('calisma');
      }
      if (Array.isArray(d && d.kampus)) kampusProjeleri = d.kampus.filter((k) => k && typeof k.ad === 'string');
      isaretleriSeyrelt();
      model.gorunum();   // süren işi olan bina turuncu
      durumPaneli();
    },
    binaGit(id) {
      const y = V.yerler.find((a) => a.oid === id);
      if (y) yereGit(y);
    },
    dilAyarla(yeni) { diliUygula(yeni === 'en' ? 'en' : 'tr'); },
    // az: kuzeyden saat yönünde, el: ufkun üstündeki açı (°), bulut: güneş kapalı mı
    gunesAyarla(az, el, bulut, saat) { gunesiUygula(az, el, bulut); gunesRozeti(az, el, bulut, saat); },
    // yalnızca rozet (saat yazısı): güneş ışığı değişecek kadar oynamadı, harita yeniden çizilmez
    saatAyarla(az, el, bulut, saat) { gunesRozeti(az, el, bulut, saat); },
    kenarAyarla(ust, alt) {
      document.documentElement.style.setProperty('--ust', `${ust}px`);
      document.documentElement.style.setProperty('--alt', `${alt}px`);
      kenarAlt = alt;
      cerceveyiYenile();
    },
  };
  window.ikizHarita = harita;
})();
