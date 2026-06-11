# Siglume Direct Request Payment SDK 公開案内ドラフト

Siglume Direct Request Payment 向けの外部事業者用SDKを公開しました。

このSDKは、小規模EC、予約サービス、会員制サービス、API販売、AtoA
エージェント決済など、Siglumeウォレット決済を自社チェックアウトに組み込みたい
事業者向けの導入支援SDKです。

TypeScript/JavaScript:

```bash
npm install @siglume/direct-request-payment
```

Python:

```bash
pip install siglume-direct-request-payment
```

SDKが提供するもの:

- マーチャントサーバーでの署名付き決済チャレンジ生成
- 購入者のSiglume bearer tokenによる決済要求作成
- Siglumeが返すprepared transactionの実行補助
- 決済要求の検証
- `direct_payment.confirmed` webhookの署名検証

このSDKは `@siglume/api-sdk` とは用途が異なります。`@siglume/api-sdk` は
Siglume API Storeにエージェント向けAPIを公開するためのSDKです。一方、
`@siglume/direct-request-payment` は外部ECやSaaSの checkout に Siglume
Direct Request Payment を組み込むためのSDKです。

## Trial Pricing

実証フェーズの料金は以下です。

| Plan | Monthly fee | Payment fee |
| --- | ---: | ---: |
| Launch | JPY 0 | 0% through 100 payments/month, then 1.8% |
| Starter | JPY 980 | 1.0% |
| Growth | JPY 2,980 | 0.7% |
| Pro | JPY 9,800 | 0.5% |

最低手数料は、手数料が発生する決済について共通でJPY 3/決済です。Launch
プランでも、100決済/月を超えた後は1.8%の従量手数料が発生します。

手数料は決済時に差し引かれ、マーチャントは純額を受領します。月額料金は
マーチャントのbilling mandateを通じて月次請求されます。現時点の公開料金は
JPY建てです。USD/USDCについては個別合意が必要です。

## 導入時の重要な境界

- マーチャントサーバーは注文金額、通貨、nonce、challenge secretを管理します。
- 購入者ウォレットを課金するAPI呼び出しには、購入者のSiglume bearer tokenが必要です。
- Developer Portalの `cli_` API key はこのSDKの決済要求作成には使えません。
- 決済完了処理は、ブラウザの戻り値ではなく署名検証済みwebhookを基準にしてください。
- challenge secretとwebhook secretはサーバー側にのみ保持してください。

## 公開リンク

- GitHub: https://github.com/taihei-05/siglume-direct-request-payment
- npm: https://www.npmjs.com/package/@siglume/direct-request-payment
- PyPI: https://pypi.org/project/siglume-direct-request-payment/

まずは実証フェーズのため、初期導入、技術相談、ユースケース検証まで個別に
サポートします。導入を検討したいEC、予約サービス、会員制サービス、API提供者、
AtoA課金の検証希望者はお問い合わせください。
