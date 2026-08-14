# AyTalk v9 Architecture

Bu sürüm bir "yeniden yazma" değildir. Çalışan özellikleri koruyarak modüler mimariye geçiştir.

## Yeni yapı

src/
  features/
    home/
      screens/
      components/
      index.ts
    livebridge/
      screens/
      components/
      types/
      index.ts
    translation/
    assistant/
    visual-translation/
    conference/
    history/

  shared/
    native/
    components/
    theme/

## Phase 1 — Bu paket
- HomeDashboard `features/home` altına taşındı.
- LiveBridge `features/livebridge` altına taşındı.
- AyTalk ve çağrı ikonları kendi feature'larına taşındı.
- Ortak theme token sistemi oluşturuldu.
- Native bridge erişimleri `shared/native` altında standartlaştırılmaya hazırlandı.
- Eski yollar için compatibility wrapper bırakıldı.
- App.tsx yeni feature entry-point'lerini kullanır.

## Neden compatibility wrapper var?
Eski bir dosya hâlâ:
`src/screens/RemoteCallScreen`
veya
`src/components/home/...`
import ediyorsa build kırılmaz.

Phase 2 tamamlandığında bu wrapper'lar kaldırılabilir.

## Sonraki Phase
App.tsx içindeki büyük çeviri / AI / OCR bloklarını tek tek feature ekranlarına çıkaracağız.
Bunu tek seferde yapmıyoruz; çalışan demo akışını koruyoruz.
