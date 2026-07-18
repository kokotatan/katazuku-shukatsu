export type Kind = 'gakuchika' | 'research' | 'jikoPR' | 'shibou' | 'other'

/** ESの部品(スニペット) */
export interface Snippet {
  id: string
  kind: Kind
  /** 「LayerXハッカソンの話」など */
  title: string
  body: string
  /** 目標文字数(null=指定なし) */
  targetChars: number | null
  /** 使った企業名のメモ */
  usedAt: string[]
  updatedAt: string
}

export const KINDS: { key: Kind; label: string }[] = [
  { key: 'gakuchika', label: 'ガクチカ' },
  { key: 'research', label: '研究概要' },
  { key: 'jikoPR', label: '自己PR' },
  { key: 'shibou', label: '志望動機' },
  { key: 'other', label: 'その他' },
]

/**
 * 基本情報(履歴書項目)。エントリーフォームに毎回入力する定型データを1件だけ保持する。
 * 将来のフォーム自動入力の元データにもなる。localStorage キー `katazuku-profile/basic`。
 */
export interface BasicProfile {
  lastName: string
  firstName: string
  lastKana: string
  firstKana: string
  lastRoma: string
  firstRoma: string
  /** 生年月日 YYYY-MM-DD */
  birthday: string
  /** 男性/女性/回答しない/その他 */
  gender: string
  phone: string
  email: string
  emailSub: string
  postalCode: string
  address: string
  addressKana: string
  /** 帰省先・実家住所など */
  homeAddress: string
  /** 証明写真 dataURL */
  photo: string
  // 学歴: university 以下は大学院(最終学歴)として扱う
  university: string
  faculty: string
  department: string
  lab: string
  degree: string
  gpa: string
  /** 入学年月 YYYY-MM */
  enrollYm: string
  /** 卒業・修了予定年月 YYYY-MM */
  gradYm: string
  // 学部(学士課程)
  undergradSchool: string
  undergradFaculty: string
  undergradDepartment: string
  undergradLab: string
  /** 学部 入学年月 YYYY-MM */
  undergradEnrollYm: string
  /** 学部 卒業年月 YYYY-MM */
  undergradGradYm: string
  undergradGpa: string
  highSchool: string
  certifications: string
  languages: string
  skills: string
  github: string
  portfolio: string
  otherUrls: string
  desiredIndustry: string
  desiredRole: string
  strengths: string
  weaknesses: string
  hobbies: string
  clubs: string
  // 緊急連絡先
  emergencyName: string
  emergencyRelation: string
  emergencyPhone: string
  emergencyPostal: string
  emergencyAddress: string
  // その他
  mbti: string
  /** キャリア軸・自己PRの軸 */
  careerAxis: string
  /** このサービス/企業を知ったきっかけ */
  foundVia: string
  updatedAt: string
}

export function emptyBasicProfile(): BasicProfile {
  return {
    lastName: '',
    firstName: '',
    lastKana: '',
    firstKana: '',
    lastRoma: '',
    firstRoma: '',
    birthday: '',
    gender: '',
    phone: '',
    email: '',
    emailSub: '',
    postalCode: '',
    address: '',
    addressKana: '',
    homeAddress: '',
    photo: '',
    university: '',
    faculty: '',
    department: '',
    lab: '',
    degree: '',
    gpa: '',
    enrollYm: '',
    gradYm: '',
    undergradSchool: '',
    undergradFaculty: '',
    undergradDepartment: '',
    undergradLab: '',
    undergradEnrollYm: '',
    undergradGradYm: '',
    undergradGpa: '',
    highSchool: '',
    certifications: '',
    languages: '',
    skills: '',
    github: '',
    portfolio: '',
    otherUrls: '',
    desiredIndustry: '',
    desiredRole: '',
    strengths: '',
    weaknesses: '',
    hobbies: '',
    clubs: '',
    emergencyName: '',
    emergencyRelation: '',
    emergencyPhone: '',
    emergencyPostal: '',
    emergencyAddress: '',
    mbti: '',
    careerAxis: '',
    foundVia: '',
    updatedAt: '',
  }
}
