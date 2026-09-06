AyTalk Orange/CAMARA Sandbox - Step 7

Bu paket production'a doğrudan deploy edilmemelidir.
Önce security/global-auth-router-v1 branch'inde syntax/build kontrolü yapılır.

Yeni environment variable isimleri (değerleri bu dosyada YOKTUR):
ORANGE_PLAYGROUND_ENABLED=true
ORANGE_PLAYGROUND_CLIENT_ID=<Orange console Client ID>
ORANGE_PLAYGROUND_AUTH_HEADER=<Orange console'daki tam Authorization header; Basic ...>
ORANGE_PLAYGROUND_REDIRECT_URI=<sandbox backend URL>/auth/network/orange/callback

Secret'i GitHub'a veya mobil uygulamaya koymayın.

Yeni endpointler:
POST /auth/network/orange/start
GET  /auth/network/orange/callback
GET  /auth/network/orange/status/:verificationId

Sandbox akışı:
1) start -> authorizationUrl + verificationId
2) Kullanıcı authorizationUrl'i cihazda açar
3) Orange callback -> token exchange -> /verify
4) status -> Firebase custom token
5) Mobil uygulama custom token ile Firebase oturumu açar

Not: verificationStore şu anda test için RAM kullanır. Production'da Postgres/Redis'e taşınacaktır.
