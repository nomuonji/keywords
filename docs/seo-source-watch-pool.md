# SEO Source Watch Pool

SEOに関するXアカウント、ブログ、ニュースレター、YouTubeなどを「正しい情報源」ではなく、定期的に見に行く観測対象として保存する。

## Flow

Source → Scan → Finding → independent verification → Evaluation Registry update (必要な場合のみ) → Planner decision

Sourceの肩書きや評判は、主張が正しいことの証明ではない。

## Source

- sourceType: x_account / website / newsletter / youtube / other
- canonicalUrl / handle / topics
- whyWatch / trustNotes
- reviewCadenceDays / status

## Scan

指定期間の公開発信を確認した記録。outcome は useful / mixed / nothing_new / needs_followup / unavailable。何も新しいものがなかったことは正常な結果で、Findingを無理に作らない。

## Finding

投稿本文を丸ごと保存せず、original URL、publishedAt、claimSummary、relevance、disposition、confidence、verificationNeeded、evaluatorIds、notes を保存する。disposition は candidate / adopted / rejected / watch。

Google Searchの仕様やポリシーに関する主張はGoogle公式等の一次情報を優先して別途確認する。実務ノウハウは対象サイトの実測・再現可能性・独立情報と照合する。

## MCP

- seo_source_pool_context: 監視対象、due状態、最近のScan/Findingを読む。
- seo_source_get: 1情報源の履歴を読む。
- seo_source_save: 監視対象を追加・編集する。
- seo_source_scan_record: 外部で最近の発信を調べた結果を保存する。

MCP自体はXを取得しない。取得はChatGPTのweb searchや将来の専用adapterに任せ、Source Poolは永続的な観測状態だけを正本にする。

## Initial source

x_ezayan (https://x.com/ezayan) をbuiltin seedとして登録する。Firestoreに同じIDを保存すると上書きされるため、初期seedと後から追加したSourceは同じUI/MCP上で扱える。

## Agent routine

1. seo_source_pool_context を読む。
2. 必要なら seo_source_get で履歴を読む。
3. Web/Xから指定期間の公開発信を調べる。
4. 発信者の権威だけで採用しない。
5. URL、要約、relevance、confidence、verificationNeeded を付ける。
6. seo_source_scan_record で保存する。
7. 評価関数変更に値する場合のみ一次情報や実測で別途検証する。
8. 新規性がなければ nothing_new を保存する。