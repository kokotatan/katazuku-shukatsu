COMPANY と POSITION の企業研究を行い、面接準備に使える根拠付きdossierを正本DBへ反映してください。

原則:
- WebSearch/WebFetchを使い、公式サイト、IR、有価証券報告書、公式技術ブログ、採用ページ等の一次情報を優先する。
- 断定には根拠URLを付ける。分からないことを作らない。
- POSITIONがある場合は、その職種の業務・顧客・技術・評価軸まで掘る。
- 最新情報は取得日を明記する。

手順:
1. 会社概要だけでなく、事業、顧客、プロダクト、収益構造、技術、財務、カルチャー、競争優位、リスク、直近ニュースを調査する。
   公式新卒採用ページがある場合は、募集職種、選考フロー、応募期限、公式エントリーURLも調べる。
2. 面接で使える「なぜこの会社か」「入社後何をするか」「確認すべき問い」を抽出する。
3. DB_JSONへ次の厳格JSONをWriteする。Markdownやコメントは混ぜない:
   {
     "sourceRef":"research:<企業の正規化名>:<YYYY-MM-DD>",
     "company":"COMPANY",
     "position":"POSITION（空なら省略）",
     "summary":"面接前に読む要約",
     "researchedAt":"ISO 8601",
     "facts":{
       "business":..., "customers":..., "products":..., "technology":...,
       "financials":..., "culture":..., "competition":..., "risks":...,
       "recentNews":..., "recruiting":..., "selectionProcess":...,
       "interviewAngles":..., "questionsToAsk":...
     },
     "sources":[{"title":"資料名","url":"https://...","retrievedAt":"ISO 8601"}]
   }
4. cd sync; npx tsx scripts/db-apply-research.ts <DB_JSON> を実行する。
5. npx tsx scripts/db-snapshot.ts を実行する。
6. scripts/log-activity.ps1へ By=company-research、Action=<企業>の企業研究、Why=面接準備を一次情報に基づかせるため、How=参照した主要資料とdossier更新、Result=成功で1行残す。
7. 最終行に単独で === company-research DONE === と出力する。
