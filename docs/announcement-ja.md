# Siglume Direct Request Payment SDK 公開ドラフト

Siglume Direct Request Payment 向けの外部事業者用SDKを公開しました。

- npm: https://www.npmjs.com/package/@siglume/direct-request-payment
- PyPI: https://pypi.org/project/siglume-direct-request-payment/
- GitHub: https://github.com/taihei-05/siglume-direct-request-payment

> **Beta / サーバーロールアウト中**: Hosted Checkout はアカウントごとに段階提供中です。未提供アカウントでは `createCheckoutSession(...)` / `getCheckoutSession(...)` が `HostedCheckoutNotAvailableError` を返します。生の 404/409 をそのまま利用者へ見せず、提供開始まで既存の agent/API 経路を利用してください。

> **対応チェーン**: 現在の公開ベータは **Polygon PoS 上の JPYC / USDC 精算のみ** に対応しています。マルチチェーン、チェーン選択、クロスチェーン精算、複数の merchant settlement wallet、決済ごとの settlement wallet override、分割・マルチウォレット課金には対応していません。

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

## 新機能: Hosted Checkout と「2種類の買い手」

今回 **Hosted Checkout（ホスト型チェックアウト）** を追加しました。これにより、買い手のタイプごとに別々の組み込み方ができます。どちらの場合も買い手は **Siglume ウォレット**（JPY は JPYC、USD は USDC の **ステーブルコイン**）で支払い、**カード決済ではありません**。また **merchant 用 SDK が買い手を認証することはありません**（非カストディアル＝顧客資金を預かりません）。

1. **人間のウェブ購入者 → Hosted Checkout**。サイトの「Siglume で支払う」ボタンが押されたら `createCheckoutSession(...)` を呼び、返ってきた `checkout_url`（`https://siglume.com/pay/<session_id>`）へリダイレクトします。購入者はそのページで Siglume にログイン（パスキー／メールコード＝ログインがそのままウォレット）し、金額を確認して一度承認し、自分のウォレットから支払い、`success_url` に戻ります。これは Siglume ウォレット向けのホスト型チェックアウトです。

2. **AI エージェント / エージェント間決済（AtoA） → 直接 API / ツール**。自律的な買い手エージェントは `DirectRequestPaymentClient`（自社アプリが買い手の Siglume JWT を保持）か、Siglume マーケットプレイスのツール `market_confirm_direct_payment_and_execute`（MCP）で支払います。

   **前提（重要）**: エージェント決済は、支払いの **前にすでに買い手エージェントが Siglume に接続済み** であることを前提とします。AI クライアント（Claude / ChatGPT / Cursor など）は **Siglume MCP サーバー（OAuth 認可＋同意画面）** 経由で接続し、カスタムアプリは買い手の **Siglume bearer token（JWT）** を保持します。いずれの場合も支払い前に Siglume の認証コンテキストが確立されており、**merchant 用 SDK が買い手をログインさせるわけではありません**。無人実行は merchant 側ではなく Siglume の **承認ゲート／支払い予算**（1回あたり・日次・月次の auto-pay budget、または Works の承認）で制限されます。

Hosted Checkout では、金額・通貨・challenge・戻り先 URL をすべて **サーバー側で確定** するため、ブラウザが価格やリダイレクト先を改ざんできません。購入者の Siglume の認証情報がストア側に渡ることもありません。

実装はどちらも、署名付きの `direct_payment.confirmed` webhook（正本）を起点にしますが、イベント名だけで「支払い済み」と判断しないでください。SDK の `classifyDirectPaymentConfirmation(event)` / `classify_direct_payment_confirmation(event)`、または同等の `pricing_band`、`finality`、`settlement_status`、非空の識別子チェックで判定します。Standard Payment はオンチェーン精算済みのときに paid、Micro / Nano は利用受付時点では fulfilled_unsettled / 未精算、集約精算バッチが `settled` かつ `chain_receipt_id` ありになって初めて精算済みとして扱います。Hosted Checkout で新たな資金移動や新しい webhook が増えることはありません。

正直なところ、素早く組み込めるのは **merchant 側の配線**（challenge またはチェックアウトセッション＋webhook）です。人間のウェブ決済は依然として、購入者が Siglume ウォレットを持つ（または作る）必要があり、そこから支払う形になります。初回購入者にとってカードのような「即時」決済ではない点にご注意ください。

## SDRP内の位置づけ

Siglume Direct Request Payment は、merchantが注文・金額・通貨をサーバー側で確定し、buyerがSiglumeウォレットで支払い、Siglumeが決済金額に応じて料金と精算方法を自動適用するSDRP決済プロトコルです。

選択が必要なのは Standard Payment / 通常決済領域のプランだけです。Micro Payment / Nano Payment は別途選ぶものではなく、金額帯によって自動適用されます。

| 公開一回払いの決済金額 | 自動適用 | 選択するもの | 料金 | 精算 |
| --- | --- | --- | --- | --- |
| JPY 501以上 / USD 3.01以上 | Standard Payment / 通常決済 | Launch / Starter / Growth / Pro から1つ | Launch 1.8%、Starter 1.0%、Growth 0.7%、Pro 0.5%。最低 JPY 30 / USD 0.20 | 決済確定後すぐにオンチェーンで精算 |
| JPY 50-500 / USD 0.31-3.00 | Micro Payment / マイクロペイメント | 選択不要。金額で自動適用 | JPY 2 / USD 0.01 per SDRP Tx | **週次締め**、または provider gross が JPY 10,000 / USD 100.00 に到達した時点の早い方で締め（[精算スケジュール](#精算スケジュール)参照） |
| JPY 1-49 / USD 0.01-0.30 | Nano Payment / ナノペイメント | 選択不要。金額で自動適用 | JPY 0.2 / USD 0.001 per SDRP Tx | **月次締め**、または provider gross が JPY 10,000 / USD 100.00 に到達した時点の早い方で締め（[精算スケジュール](#精算スケジュール)参照） |

ここでの Tx は1件のSDRP決済を指し、集約精算のオンチェーンTxではありません。

Standard Payment は1決済ごとに精算します。Micro / Nano は金額帯で自動適用され、週次 / 月次でまとめて精算されます。SDRP の導入・merchant setup・billing mandate は、この Micro / Nano の後払い的な集約精算を受け入れる前提です。self-service setup では、この受諾が `merchant_account.metadata_jsonb.metered_risk_acceptance` に `terms_version`、`accepted_at`、`principal_user_id`、`receipt_id`、固定市場閾値 JPY 10,000 / USD 100.00 として記録されます。このリスクを受け入れない商品は、JPY 500 以下 / USD 3 以下では提供せず、Standard Payment 帯の価格にしてください。締め・支払い予定・未精算・精算済み・past due は statement API と CSV で確認します。なお、少額の支払いは実行前に購入者ウォレットの予算が確認され、予算・scope・金額帯のいずれかが満たされない場合はその場で拒否され、課金は発生しません（リクエストは実行されません）。

公開されている Direct Payment / Hosted Checkout の `amount_minor` は通貨の最小単位の正の整数です。そのため、一回払いの公開経路で表現できる最小金額は JPY 1 / USD 0.01 であり、この経路での Nano Payment は JPY 1-49 / USD 0.01-0.30 を指します。USD 0.001 / SDRP Tx などのサブマイナー単位は、外部チェックアウトの商品価格ではなく、集約精算時のプロトコルフィー会計です。

## 精算スケジュール

3つの帯は「確定した決済がいつ精算ウォレットに着金するか」が異なります。

| 帯 | 周期 | 締め期間 | 着金タイミング |
| --- | --- | --- | --- |
| Standard Payment | 都度 | — | 各決済の確定直後にオンチェーン精算 |
| Micro Payment | 週次 | アカウント別に割り当てられた固定の週次スロット | 締め後、確定通知と約3日間の事前通知期間を置いてから、受取先・出品ごとに集約してオンチェーン精算（1件以上） |
| Nano Payment | 月次 | アカウント別に割り当てられた固定の月次スロット | 締め後、確定通知と約3日間の事前通知期間を置いてから、受取先・出品ごとに集約してオンチェーン精算（1件以上） |

- **締め期間**: Micro は provider gross 累計が JPY 10,000 / USD 100.00 に到達するか、週次締めが来た時点の早い方で締まります。Nano は同じ閾値に到達するか、月次締めが来た時点の早い方で締まります。JPY 10,000 と USD 100.00 は為替換算上の同額ではなく、市場別の固定閾値です。
- **タイムゾーン**: 締めの境界は購入者が設定した精算タイムゾーン（既定は UTC）で判定されます。割り当て済みスロットは、予告なくオンザフライで再計算されません。
- **精算バッチ／支払い実行**: 期間が締まった後、その期間分を購入者・provider・トークン・pricing band ごとに集約し（1件以上）、購入者へ確定通知を送ります。実際の引き落としは締め後おおむね3日間の事前通知期間後、`not_before_attempt_at` 以降の精算パスで実行されます。閾値判定は手数料控除前の `provider_gross_amount_minor` の累計で行い、`>= settlement_threshold_minor` で発火します。
- **売上として確認できる時点**: Micro/Nano の支払いはオンチェーン精算が確定して初めて確定売上になります。それまでは「未精算」です。statement API / CSV の `settled`、`chain_receipt_id`、未精算額、past-due 額を正本としてください。
- **休日・失敗・再試行・繰越**: オンチェーン精算のため銀行休業日の影響はなく、曜日に関係なくカレンダー境界で締まります。精算が失敗した場合（例: 精算時に購入者ウォレットの残高・allowance・BudgetVault 設定が不足／無効）は自動で再試行され、その購入者・provider・トークン・pricing band の Micro/Nano は未解決の精算が片付くまで一時停止します。past due では停止が継続します。past due は記録・表示されますが、最終的な回収や provider への支払いを保証するものではありません。
- **rejected / 課金なし**: 購入者ウォレットの予算枠は **provider gross**（購入者に見える利用額）で予約されます。Micro / Nano の protocol fee は buyer に上乗せせず、provider receivable から差し引きます。これは支払い原資・残高・allowance をロック、保全、保証するものではありません。予算・scope・金額帯が満たされない場合、または同じ buyer / provider / token / pricing band の `total_unsettled_exposure_minor`（settled / uncollectible / written_off 以外の chargeable provider gross）が閾値以上の場合は **課金なしで拒否**され、provider API は呼び出されず、精算にも計上されません。

**確定事項と可変事項**: 周期は固定です（**Micro は週次または閾値到達、Nano は月次または閾値到達**。確定はオンチェーン精算後）。具体的な締めスロット、予定引き落とし時刻、再試行間隔はプラットフォーム側で管理されるため、暦をハードコードしないでください。Standard Payment は payment requirement の `fee_bps`、Micro / Nano は statement API の `provider_gross_amount_minor`、`protocol_fee_minor`、`provider_receivable_minor`、`buyer_debit_minor`、`status`、`settlement_trigger`、`settlement_threshold_minor`、`threshold_reached_at`、`total_unsettled_exposure_minor`、`not_before_attempt_at` を正本としてください。運用マニュアルは [Micro / Nano Statements and Notices](./metered-statements.md) を参照してください。

## 最短導入

最短導入で案内できるのは、事前に merchant account、Hosted Checkout 有効化、active billing mandate、公開 HTTPS webhook URL、`SIGLUME_WEBHOOK_SECRET`、buyer のテスト用 Siglume ウォレットがそろっている場合の **Standard Payment の初回テスト決済**です。まず readiness を通し、Express / FastAPI の生成テンプレートを自社サーバーに組み込みます。Micro / Nano 会計、subscription、scheduled autopay、返金対応は別途実装・確認が必要です。

```bash
# Node / Express
npm install @siglume/direct-request-payment
npx siglume-check readiness
npx siglume-sdrp init express --target src/siglume

# Python / FastAPI
pip install siglume-direct-request-payment
siglume-check readiness
siglume-sdrp init fastapi --target app/siglume
```

生成テンプレートの既定は Standard-only です。JPY 500 以下 / USD 3.00 以下の注文は、Micro / Nano の fulfilled-but-unsettled 状態、精算照合、past due 対応を実装して `allow_metered_payments` を有効にするまで `METERED_INTEGRATION_REQUIRED` で止めてください。

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

// setup.env には merchant key と challenge / webhook secret が入ります。
// secret はサーバー側の secret store に保存し、値はログ出力しないでください。
console.log(`Configured merchant: ${setup.env.SIGLUME_DIRECT_PAYMENT_MERCHANT}`);
```

`setup.env` に、サーバー側で保存すべき `SIGLUME_DIRECT_PAYMENT_MERCHANT`、`SIGLUME_DIRECT_PAYMENT_CHALLENGE_SECRET`、`SIGLUME_WEBHOOK_SECRET` が返ります。secret 値はログに出さず、secret store に保存してください。

## 料金

| Plan | Monthly fee (JPY / USD) | Payment fee |
| --- | ---: | ---: |
| Launch | JPY 0 / USD 0 | 1.8% |
| Starter | JPY 980 / USD 6.00 | 1.0% |
| Growth | JPY 2,980 / USD 18.00 | 0.7% |
| Pro | JPY 9,800 / USD 60.00 | 0.5% |

Standard Payment には選択したプラン料率の手数料が発生します。最低手数料は 1 決済あたり JPY 30(USD マーチャントは USD 0.20)です。Micro / Nano は固定プロトコルフィーが provider 負担で適用されます。例: Micro で JPY 100 の商品なら `buyer_debit_minor = 100`、`provider_gross_amount_minor = 100`、`protocol_fee_minor = 2`、`provider_receivable_minor = 98` です。`rounding_delta_minor` は buyer に上乗せせず、provider revenue でもありません。月額料金は merchant billing mandate 経由で請求されます。

## Scheduled Autopay

`cadence: "daily"` は scheduled autopay の承認タグであり、1日1回の実行制限ではありません。実際の実行は、購入者が承認した1回あたり、日次、月次の auto-pay budget によって制御されます。

## 注意点

- challenge secret と webhook secret はサーバー側だけに保存してください。
- merchant JWT で購入者ウォレットを課金することはできません。
- buyer の支払い作成には buyer JWT が必要です。
- 本番受付前に billing mandate の承認状態を確認してください。
