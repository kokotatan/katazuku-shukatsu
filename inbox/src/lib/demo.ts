import type { RawEmail } from '../types'

const WEEKDAYS = '日月火水木金土'

/** 今日を基準に「◯日後 hh:mm」の Date を作る */
function at(now: Date, days: number, hour: number, min = 0): Date {
  const d = new Date(now)
  d.setDate(d.getDate() + days)
  d.setHours(hour, min, 0, 0)
  return d
}

/** 「6月15日(月) 17:00」形式 — 分類エンジンが抽出できる表記でデモ本文に埋め込む */
function jp(d: Date, withTime = true): string {
  const base = `${d.getMonth() + 1}月${d.getDate()}日(${WEEKDAYS[d.getDay()]})`
  if (!withTime) return base
  return `${base} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** 受信日時・締切が常に「今」を基準に生成されるデモメール */
export function makeDemoEmails(now: Date = new Date()): RawEmail[] {
  const emails: Array<Omit<RawEmail, 'id' | 'source'> & { key: string }> = [
    {
      key: 'techfrontier-interview',
      from: '株式会社テックフロンティア 新卒採用担当',
      fromAddress: 'recruit@techfrontier.example.jp',
      subject: '【重要/要返信】一次面接の日程調整のお願い',
      receivedAt: at(now, -1, 14, 32).toISOString(),
      body: `大久保 様

株式会社テックフロンティア 新卒採用担当の佐藤です。
このたびは書類選考にご応募いただき、誠にありがとうございました。

厳正なる選考の結果、一次面接にお進みいただくこととなりましたので、ご連絡いたします。

つきましては、下記URLより面接の候補日をご登録ください。
${jp(at(now, 1, 17))}までにご回答いただけますと幸いです。

▼日程登録URL
https://techfrontier.example.jp/schedule

形式:オンライン(Zoom) / 所要時間:45分程度

ご不明な点がございましたら、本メールにご返信ください。
何卒よろしくお願いいたします。`,
    },
    {
      key: 'mirai-es-deadline',
      from: 'ミライ総合商社 人事部',
      fromAddress: 'saiyo@mirai-shoji.example.co.jp',
      subject: '【リマインド】エントリーシートご提出期限のお知らせ',
      receivedAt: at(now, 0, 9, 5).toISOString(),
      body: `大久保 様

ミライ総合商社 人事部です。
総合職エントリーにあたり、エントリーシートのご提出期限が近づいておりますのでご案内いたします。

■提出期限:${jp(at(now, 0, 23, 59))} 締切
■提出方法:マイページよりアップロード

期限を過ぎた場合、いかなる理由でも受付できかねますのでご注意ください。
みなさまのご応募を心よりお待ちしております。`,
    },
    {
      key: 'connecthr-webtest',
      from: '株式会社コネクトHR 採用チーム',
      fromAddress: 'newgrads@connect-hr.example.com',
      subject: 'Webテスト受検のお願い(書類選考通過のご連絡)',
      receivedAt: at(now, -1, 19, 48).toISOString(),
      body: `大久保 様

株式会社コネクトHR 採用チームです。
書類選考の結果、次のステップへお進みいただくことになりました。

つきましては、下記の要領で適性検査(SPI)のご受検をお願いいたします。

■受検期限:${jp(at(now, 2, 12))}まで
■所要時間:約65分
■受検URL:https://spi.example.com/connect-hr

期限内のご受検が確認できない場合、選考辞退のお取り扱いとなります。
よろしくお願いいたします。`,
    },
    {
      key: 'northlight-final',
      from: '株式会社ノースライト 採用事務局',
      fromAddress: 'recruit@northlight.example.jp',
      subject: '最終面接のご案内(日時確定)',
      receivedAt: at(now, -2, 11, 20).toISOString(),
      body: `大久保 様

株式会社ノースライト 採用事務局です。
最終面接の日時が確定いたしましたのでご案内いたします。

■日時:${jp(at(now, 4, 10))}〜(60分程度)
■場所:本社8F(東京都港区)/受付で学生証をご提示ください
■持ち物:履歴書1部

当日お会いできることを楽しみにしております。
変更のご希望がある場合は、前日までにご返信ください。`,
    },
    {
      key: 'synergy-event',
      from: 'シナジー建設 新卒採用チーム',
      fromAddress: 'shinsotsu@synergy-kensetsu.example.co.jp',
      subject: '【先着順】社員座談会のご案内',
      receivedAt: at(now, -2, 16, 3).toISOString(),
      body: `就活生のみなさま

シナジー建設 新卒採用チームです。
現場社員と直接話せる少人数座談会を開催いたします。

■開催日時:${jp(at(now, 6, 15))}〜16:30
■形式:オンライン(Teams)
■定員:30名(先着順)

ご参加希望の方は、${jp(at(now, 3, 18))}までにマイページよりお申し込みください。`,
    },
    {
      key: 'hikari-result',
      from: 'ヒカリ食品株式会社 人事部',
      fromAddress: 'jinji@hikari-foods.example.co.jp',
      subject: '二次選考結果のご連絡',
      receivedAt: at(now, 0, 10, 41).toISOString(),
      body: `大久保 様

ヒカリ食品株式会社 人事部です。
先日は二次面接にお越しいただき、誠にありがとうございました。

厳正なる選考の結果、ぜひ次の最終選考にお進みいただきたくご連絡いたしました。

最終選考の詳細は、別途${jp(at(now, 1, 12), false)}頃にご案内予定です。
引き続きどうぞよろしくお願いいたします。`,
    },
    {
      key: 'aoba-intern',
      from: 'アオバ製薬 インターンシップ事務局',
      fromAddress: 'intern@aoba-pharma.example.jp',
      subject: 'サマーインターンシップ エントリー受付開始のお知らせ',
      receivedAt: at(now, -3, 13, 15).toISOString(),
      body: `就活生のみなさま

アオバ製薬 インターンシップ事務局です。
研究開発職を体験できるサマーインターンシップのエントリー受付を開始しました。

■開催:8月下旬(5日間/オンサイト)
■応募締切:${jp(at(now, 9, 23, 59))}
■応募方法:マイページよりエントリーシートをご提出ください

多くのご応募をお待ちしております。`,
    },
    {
      key: 'kaisei-casual',
      from: '株式会社カイセイ 採用担当 田中',
      fromAddress: 'tanaka@kaisei.example.com',
      subject: 'カジュアル面談のご都合はいかがでしょうか',
      receivedAt: at(now, -4, 18, 27).toISOString(),
      body: `大久保 様

株式会社カイセイ 採用担当の田中です。
プロフィールを拝見し、ぜひ一度カジュアル面談でお話しできればと思いご連絡いたしました。

来週ですと、下記の日程でご調整可能です。
・${jp(at(now, 5, 16))}〜
・${jp(at(now, 7, 11))}〜

ご都合のよい日時をご返信いただけますと幸いです。
もちろん、上記以外の日程でも調整いたします。`,
    },
    {
      key: 'shukatsu-navi-news',
      from: 'シューカツナビ編集部',
      fromAddress: 'news@shukatsu-navi.example.com',
      subject: '【シューカツナビ】今週のおすすめ企業10選',
      receivedAt: at(now, 0, 8, 0).toISOString(),
      body: `シューカツナビ メールマガジン

今週のおすすめ企業を10社ピックアップしました!
あなたのプロフィールにマッチする企業からのスカウトも届いています。

▼おすすめ企業を見る
https://shukatsu-navi.example.com/picks

※本メールはシューカツナビにご登録の方へ配信しています。
配信停止はこちら: https://shukatsu-navi.example.com/unsubscribe`,
    },
    {
      key: 'tsubasa-offer-docs',
      from: 'ツバサ物流株式会社 採用グループ',
      fromAddress: 'saiyou@tsubasa-logi.example.co.jp',
      subject: '【要対応】内々定に伴う承諾書のご提出について',
      receivedAt: at(now, -1, 9, 55).toISOString(),
      body: `大久保 様

ツバサ物流株式会社 採用グループです。
このたびは内々定おめでとうございます。

つきましては、内々定承諾書のご提出をお願いいたします。

■提出期限:${jp(at(now, 7, 17))}まで
■提出方法:同封の書類に署名のうえ、マイページよりアップロード

ご質問やお悩みの点がございましたら、お気軽にご相談ください。`,
    },
    {
      key: 'minato-seminar',
      from: 'ミナト証券 新卒採用セミナー事務局',
      fromAddress: 'seminar@minato-sec.example.co.jp',
      subject: '会社説明会(オンライン)のご予約確認',
      receivedAt: at(now, -5, 12, 30).toISOString(),
      body: `大久保 様

ミナト証券 新卒採用セミナー事務局です。
下記の会社説明会のご予約を承りました。

■日時:${jp(at(now, 2, 18))}〜19:00
■形式:オンライン(Zoom/開始10分前から入室可)
■参加URL:ご予約のマイページよりご確認ください

キャンセルの場合は前日までにマイページよりお手続きください。`,
    },
    {
      key: 'shukatsu-navi-scout',
      from: 'シューカツナビ スカウト便',
      fromAddress: 'scout@shukatsu-navi.example.com',
      subject: '3社からスカウトが届いています',
      receivedAt: at(now, -1, 7, 45).toISOString(),
      body: `シューカツナビをご利用いただきありがとうございます。

あなたのプロフィールを見た3社からスカウトが届いています。
スカウト経由のエントリーは選考が一部免除されることがあります。

▼スカウトを確認する
https://shukatsu-navi.example.com/scout

※配信停止をご希望の方はこちら`,
    },
  ]

  return emails.map(({ key, ...e }) => ({ ...e, id: `demo-${key}`, source: 'demo' as const }))
}
