(function () {
  var translations = {
    en: {
      tag1: 'Community<br />Builder',
      tag2: 'Creative<br />Head',
      bio1: "I'm Armağan. I make video series about the random thoughts and things I get stuck on, and somehow that's how I've ended up existing on the internet.",
      bio2: "I guess you could say I'm somewhere between a creative and an entrepreneur. The things I work on tend to change all the time, so if you run into me at different points in life, I'm probably obsessing over something completely different each time.",
      bio3: 'Right now, I\'m running NotWork, a networking event, and still posting my video series on <a href="https://www.instagram.com/armmagan/" target="_blank" rel="noopener">Instagram</a> whenever another thought decides to take up space in my head.',
      more: "See what I've been up to &rarr;",
      shopHeading: "Couldn't find it, so I made it",
      item1Name: 'Chill Wall Lamp',
      item2Name: 'This Is Fine (F*ck) Pillow',
      shopCta: 'coming soon to the shop',
      collabHeading: "let's collaborate",
      collabCopy: 'For brand collabs, events, or anything else &mdash; reach out.',
      collabCta: 'get in touch &rarr;',
      footer: "I follow whatever catches my interest.",
      updatesBack: '&larr; back',
      updatesTitle: "what I've been up to",
      updatesBody: 'coming soon.',
      u1Tag: '&#10038; events',
      u1Desc: 'NotWork İzmir &mdash; a night bringing together creatives and entrepreneurs from different fields for real conversations, not the usual networking-event small talk.',
      u2Tag: '&#10038; content series',
      u2Desc: 'The designs and organization tricks I put together around my house, paired with the philosophy behind each one.',
      u3Tag: '&#10038; content series',
      u3Desc: 'Where I share ADHD-friendly organization tricks to make everyday life easier.',
      u4Tag: '&#10038; origin series',
      u4Desc: 'My origin series, where I tell the stories in my head in a visually heavy, highly-edited format &mdash; playing with the "why" behind everyday actions in an imaginative way.',
      updatesMore: 'more projects &amp; experiments being added soon'
    },
    tr: {
      tag1: 'Topluluk<br />Kurucusu',
      tag2: 'Yaratıcı<br />Direktör',
      bio1: 'Ben Armağan. Aklıma takılan rastgele düşünceler hakkında video serileri çekiyorum, ve nasıl olduysa böyle internette var olmaya başladım.',
      bio2: 'Kendimi bir kreatif ile bir girişimci arasında bir yerde tanımlayabilirim sanırım. Üzerinde çalıştığım şeyler sürekli değişiyor, o yüzden hayatın farklı zamanlarında karşıma çıkarsan muhtemelen her seferinde tamamen farklı bir şeye kafayı takmış olurum.',
      bio3: 'Şu anda bir networking etkinliği olan NotWork’ü yürütüyorum, ve kafamda yer kaplayan yeni bir düşünce olduğu her seferinde <a href="https://www.instagram.com/armmagan/" target="_blank" rel="noopener">Instagram</a>’da video serilerimi paylaşmaya devam ediyorum.',
      more: 'Neler yaptığıma göz at &rarr;',
      shopHeading: 'Neden yok diyip yaptığım şeyler',
      item1Name: 'Chill Duvar Lambası',
      item2Name: 'This Is Fine (F*ck) Pillow',
      shopCta: 'yakında satışa sunulacak',
      collabHeading: 'hadi işbirliği yapalım',
      collabCopy: 'Marka iş birlikleri, etkinlikler veya başka her şey için &mdash; bana ulaş.',
      collabCta: 'iletişime geç &rarr;',
      footer: 'ilgimi çeken şeyleri takip ediyorum. artık beni nereye götürürse.',
      updatesBack: '&larr; geri',
      updatesTitle: 'neler yaptım, yapıyorum',
      updatesBody: 'çok yakında.',
      u1Tag: '&#10038; etkinlikler',
      u1Desc: 'NotWork İzmir &mdash; farklı alanlardan yaratıcıları ve girişimcileri bir araya getirip, klasik networking sohbetlerinin ötesinde gerçek konuşmalar yaşadığımız bir gece.',
      u2Tag: '&#10038; içerik serisi',
      u2Desc: 'Evimin etrafında uyguladığım tasarım ve düzenleme fikirleri, her birinin arkasındaki felsefeyle birlikte.',
      u3Tag: '&#10038; içerik serisi',
      u3Desc: 'Günlük hayatı kolaylaştırmak için DEHB dostu düzenleme fikirlerini paylaştığım seri.',
      u4Tag: '&#10038; köken serisi',
      u4Desc: 'Kafamdaki hikayeleri görsel açıdan yoğun, oldukça kurgulanmış bir formatta anlattığım köken serim &mdash; günlük eylemlerin arkasındaki "neden"i hayal gücüyle irdeliyorum.',
      updatesMore: 'yeni projeler ve denemeler yakında ekleniyor'
    }
  };

  function applyLanguage(lang) {
    var dict = translations[lang] || translations.en;
    document.documentElement.setAttribute('lang', lang);

    document.querySelectorAll('[data-i18n]').forEach(function (el) {
      var key = el.getAttribute('data-i18n');
      if (dict[key] !== undefined) {
        el.innerHTML = dict[key];
      }
    });

    document.querySelectorAll('.lang-toggle button').forEach(function (btn) {
      btn.classList.toggle('is-active', btn.getAttribute('data-lang') === lang);
    });

    localStorage.setItem('armagan-lang', lang);
  }

  document.addEventListener('DOMContentLoaded', function () {
    var saved = localStorage.getItem('armagan-lang') || 'en';
    applyLanguage(saved);

    document.querySelectorAll('.lang-toggle button').forEach(function (btn) {
      btn.addEventListener('click', function () {
        applyLanguage(btn.getAttribute('data-lang'));
      });
    });
  });
})();
