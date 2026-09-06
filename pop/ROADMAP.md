# patlat v2 — geliştirme yol haritası

Bu dosya `patlat-v2` dalında (branch) tutuluyor. `main`'deki `pop/` = canlı
sürüm, olduğu gibi kalıyor. Burada geliştirip hazır olunca `main`'e merge
edeceğiz.

Yerelde çalıştırmak: repo kökünde `python3 -m http.server 4610` → tarayıcıda
`http://localhost:4610/pop/` (ya da Claude Code'da "patlat-dev" preview).

---

## Planlanan özellikler

### 1. Birden fazla sekme (kafa)  — ✅ YAPILDI (commit 5f3ec2d)
- `store.js` DB v3: `boards` store (id, name, order, createdAt) + CRUD.
  `tasks.boardId`; `getTasks(boardId)`. `deleteBoard` o kafadaki task'leri de siler.
- `boards` şeridi çerçevenin üst içinde: dokun→geç, aktif sekmeye dokun→satır içi
  yeniden adlandır + sil (son kafa silinemez). `+` yeni kafa açar ve isim moduna girer.
- Eski (v1/v2) board'suz task'ler ilk açılışta bir "kafam" board'una taşınır.
- Takvim hatırlatıcısı tek bir kafada belirir (tüm kafalar taranarak kopya önlenir).
- TODO/polish: şerit şu an düz CSS pill; el-çizimi estetiğe geçirmek için asset gerek
  (aşağıya bak).

### 2. Baloncuk rengi seçme
- Baloncuk başına renk (`tasks.color`) veya sekme geneli varsayılan renk.
- Halka `stroke` + metin rengi bu değeri kullanır (şu an `currentColor`).
- Seçim UI'si: baloncuğa uzun basınca küçük palet.

### 3. Baloncuk boyutu ayarı
- Kişi bir baloncuğu isteğe göre büyütüp küçültebilir (`tasks.scale` çarpanı,
  `radiusFor` sonucuna uygulanır).
- Pinch veya baloncuk üstünde +/- ; fizik `body.r` buna göre güncellenir.

### 4. Reskinler / app temaları
- Tema = renk paleti + arka plan + çerçeve/kafa çizim seti + font.
- `themes` tanımı (JS obje) + aktif tema id (kişi başına, satın almaya bağlı).
- CSS custom property'leri tema ile set edilir; SVG çizim setleri değişebilir.

### 1b. Onboarding + yardım + patlatma mekanikleri — ✅ YAPILDI
- `reset` özelliği kaldırıldı (web'e özeldi). Temizleme artık kafa silme ile.
- Kafa silme: aktif sekmenin yanında `tinycross` × (onaylı). `+` artık `tinyplus`.
- **Patlatma mekaniği ayarı** (`patlat.popMechanic`): `hairswitch` (varsayılan) |
  `hold` (3sn basılı tut) | `doubletap`. Ayarlar panelinde "HOW TO POP" bölümü.
  `hold` sırasında baloncuk 3sn'de "şarj olur" (soluklaşır). Mekanik hairswitch
  değilse Add/Pop modu kapalı, saç anahtarı etkisiz, mode-word gizli.
- **`?` yardım butonu** (sol alt, `questionmark`) → rehberli tur (5 adım, mevcut
  mekaniğe göre metin).
- **İlk açılış onboarding'i**: karartılmış arka plan + hedefi çerçeveleyen halka +
  adım kartları. Son adım mekanik seçtiriyor; "Bitti"de başlangıç baloncukları eklenir.
- BEKLEYEN (asset lazım): `cactus` / `bin` mekanikleri + kafa içi kaktüs/çöp kovası
  görselleri. `tinyframe` asset'i kopyalandı ama henüz kullanılmadı (sekme arka planı
  için düşünülmüştü; düz pill şu an yeterli).

### 5. Bireysel kozmetik + fonksiyonel eklentiler
- Kafanın içine yerleştirilebilen "aygıt"lar: kaktüs (balonu kaktüse
  patlatma), çöp kovası (balonu kovaya atma), vb.
- Her biri hem görsel hem küçük bir davranış değişikliği getirir
  (pop animasyonu / hedef nokta / ses).
- Mimari: `gadgets` kaydı; aktif gadget sekmeye bağlı; `pop()` akışında
  gadget'a özel efekt hook'u.

### 6. Mikro-ödeme (IAP)
- Tüm kozmetikler (temalar, gadget'lar, renk paketleri) satın alınabilir.
- **Web'de test edilemez** — StoreKit (iOS) / Play Billing (Android), native
  şart. Şimdilik: bir "mağaza" ekranı + `owned` unlock listesi (localStorage).
  Native pakette gerçek IAP bu listeyi doldurur.

### 7. Sallama (shake)
- `DeviceMotionEvent` (iOS'ta izin ister: `requestPermission`).
- Sallama şiddetine göre fizik alanına dürtü: tüm `body`'lere rastgele
  hız + `sim.wake()`. Baloncuklar zaten birbiriyle çarpışıyor, gerisi fizik.

### 8. İçeride mini oyunlar
- **Yılan**: basit snake. Her 3 normal yemde 1 bonus yem; bonus yemin görseli
  = kişinin kendi hatırlatıcı baloncukları (`events` / `tasks` metinleri).
- **Kaçış oyunu** (Chrome dino tarzı): atılan engellerden kaçış; engeller =
  kişinin task'leri ("görevlerinden kaçıyorsun"). Tek tuş zıplama/eğilme.
- İkisi de ayrı `js/games/*.js`, canvas tabanlı, ana uygulamadan bir menüyle
  açılır.

---

## Sıra (öneri)
1. Çoklu sekme (temel — diğer her şey sekmeye bağlanıyor)
2. Tema/skin altyapısı + renk & boyut (kozmetik altyapı)
3. Gadget altyapısı (kaktüs/çöp kovası)
4. Mağaza ekranı + unlock listesi (IAP native'e bırakılıyor)
5. Sallama
6. Mini oyunlar
