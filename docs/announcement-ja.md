# Siglume Direct Request Payment SDK 公開ドラフト

Siglume Direct Request Payment 向けの外部事業者用SDKを公開しました。

- npm: https://www.npmjs.com/package/@siglume/direct-request-payment
- PyPI: https://pypi.org/project/siglume-direct-request-payment/
- GitHub: https://github.com/taihei-05/siglume-direct-request-payment

このSDKは、外部EC、予約サービス、会員制サービス、有料API、scheduled autopay などで、SDRP の Standard Payment / 通常決済を自社プロダクトに組み込むためのSDKです。

## できること

- merchant JWT によるセルフサービスの導入設定
- merchant key の作成
- challenge secret の発行とローテーション
- billing mandate の準備
- webhook subscription の作成
- merchant server 側での署名付き challenge 生成
- buyer JWT による payment requirement 作成
- prepared transaction の実行補助
- `direct_payment.confirmed` webhook の署名検証
- subscription / scheduled autopay 向け recurring challenge 生成

Developer Portal の `cli_` API key を使うSDKではありません。導入設定は merchant の Siglume JWT、支払い作成は buyer の Siglume JWT で行います。

## SDRP内の位置づけ

SDRP は全体プロトコル名です。このSDKは外部merchant向けの Standard Payment / 通常決済を扱います。

| SDRPメニュー | 金額帯 | 精算 |
| --- | --- | --- |
| Standard Payment / 通常決済 | JPY 500超 / USD 3.00超、または即時finalityが必要な決済 | DirectPaymentHubで即時オンチェーン分配 |
| Micro Payment / マイクロペイメント | JPY 50-500 / 約USD 0.30-3.00 | API Storeのmeter gate後、週次後精算 |
| Nano Payment / ナノペイメント | JPY 1未満-49 / USD 0.01未満-約USD 0.30 | API Storeのmeter gate後、月次後精算 |

Micro Payment / Nano Payment はこのMerchant SDKのcheckout flowではありません。API実行前にAPI Store側のmeter gateを通し、予算やscopeに失敗した場合は `rejected_no_charge` として記録され、provider APIは呼ばれません。

## 最短導入

```ts
import { DirectRequestPaymentMerchantClient } from "@siglume/direct-request-payment";

const merchant = new DirectRequestPaymentMerchantClient({
  auth_token: process.env.SIGLUME_MERCHANT_AUTH_TOKEN!,
});

const setup = await merchant.setupCheckout({
  merchant: "example_merchant",
  display_name: "Example Merchant",
  billing_plan: "launch",
  billing_currency: "JPY",
  webhook_callback_url: "https://merchant.example/siglume/webhook",
  max_amount_minor: 100000,
});

console.log(setup.env);
```

`setup.env` に、サーバー側で保存すべき `SIGLUME_DIRECT_PAYMENT_MERCHANT`、`SIGLUME_DIRECT_PAYMENT_CHALLENGE_SECRET`、`SIGLUME_WEBHOOK_SECRET` が返ります。

## 料金

| Plan | Monthly fee (JPY / USD) | Payment fee |
| --- | ---: | ---: |
| Launch | JPY 0 / USD 0 | 1.8% |
| Starter | JPY 980 / USD 6.00 | 1.0% |
| Growth | JPY 2,980 / USD 18.00 | 0.7% |
| Pro | JPY 9,800 / USD 60.00 | 0.5% |

すべての決済にプラン料率の手数料が発生します。最低手数料は 1 決済あたり JPY 30(USD マーチャントは USD 0.20)です。手数料は決済時に差し引かれ、マーチャントは純額を受け取ります。月額料金は merchant billing mandate 経由で請求されます。

## Scheduled Autopay

`cadence: "daily"` は scheduled autopay の承認タグであり、1日1回の実行制限ではありません。実際の実行は、購入者が承認した1回あたり、日次、月次の auto-pay budget によって制御されます。

## 注意点

- challenge secret と webhook secret はサーバー側だけに保存してください。
- merchant JWT で購入者ウォレットを課金することはできません。
- buyer の支払い作成には buyer JWT が必要です。
- 本番受付前に billing mandate の承認状態を確認してください。
