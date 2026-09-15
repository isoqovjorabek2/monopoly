import type { DealsDict } from './deals-en';

/* Deal Maker, o‘zbekcha. Jo‘nalish kelishigi uz.ts dagi kabi: k/g dan keyin
 * -ka, q/g‘ dan keyin -qa. */

const dat = (name: string): string => {
  const w = name.trim().toLowerCase();
  if (w.endsWith('g‘') || w.endsWith('q')) return `${name}qa`;
  if (w.endsWith('k') || w.endsWith('g')) return `${name}ka`;
  return `${name}ga`;
};

export const dealsUz: DealsDict = {
  rule: ['Savdolarda shartnomalar', '«Ishbilarmon» rejimi. Savdoga imtiyozli ijara, daromad ulushi va qarz qo‘shish mumkin — ijrosini stol o‘zi kuzatadi.'],
  chip: 'Shartnomalar',
  presetBadge: 'Tajribalilar uchun',

  kinds: { pass: 'Imtiyozli ijara', share: 'Daromad ulushi', loan: 'Qarz' },
  kindHints: {
    pass: 'Ularning mulkida kamroq to‘lash yoki bepul turish',
    share: 'Mulk olgan har bir ijaradan ulush olish',
    loan: 'Pul hozir, foizi bilan keyin qaytariladi',
  },

  section: 'Shartnomalar',
  sectionHint: 'Savdo bilan birga keladigan majburiyatlar. Qabul qilingach, stol ularni o‘zi bajaradi — hech kim eslab yurishi shart emas.',
  add: 'Qo‘shish',
  remove: 'Shartnomani olib tashlash',
  full: 'Bitta taklifda to‘rttagacha shartnoma bo‘lishi mumkin.',
  grantedBy: 'Kim beradi',
  lentBy: 'Kim qarz beradi',
  onDeeds: 'Mulklar',
  pickDeeds: 'Kamida bitta mulkni tanlang.',
  noDeeds: (name) => `${name}da buning uchun mulk yo‘q.`,
  discount: 'Chegirma',
  free: 'Bepul',
  off: (pct) => `−${pct}%`,
  uses: 'Necha marta',
  times: (n) => `${n}×`,
  pct: 'Ijara ulushi',
  duration: 'Muddati',
  rounds: (n) => `${n} davra`,
  wholeGame: 'Butun o‘yin',
  amount: 'Summa',
  rate: 'Foiz',
  due: 'Qaytarish',
  repays: (x) => `${x} qaytadi`,
  unsound: 'Shartnomani bu holda imzolab bo‘lmaydi: almashuvdan keyin uning mulklari shartnomani beruvchi tomonga tegishli bo‘lishi kerak va hech bir katak butun ijarasidan ko‘pini bera olmaydi.',
  sharedBadge: (pct) => `${pct}% ulush`,

  term: {
    pass: (deeds, pct) => (pct >= 100 ? `Ijarasiz: ${deeds}` : `Ijara −${pct}%: ${deeds}`),
    passMeta: (uses) => `${uses} marta`,
    share: (deeds, pct) => `Ijaraning ${pct}%: ${deeds}`,
    shareMeta: (n) => (n === null ? 'butun o‘yin davomida' : `${n} davra davomida`),
    loan: (principal, repay) => `hozir ${principal}, keyin ${repay} qaytadi`,
    loanMeta: (n) => `${n} davradan keyin`,
    grants: 'beradi',
    lends: 'qarz beradi',
  },

  ledger: {
    button: (n) => `Shartnomalar${n > 0 ? ` (${n})` : ''}`,
    title: 'Amaldagi shartnomalar',
    yours: 'Sizniki',
    others: 'Boshqa o‘yinchilar orasida',
    empty: 'Hali hech narsa imzolanmagan. Savdoni oching va unga imtiyozli ijara, daromad ulushi yoki qarz qo‘shing — qabul qilingach, shartnoma shu yerda paydo bo‘ladi.',
    usesLeft: (n) => `${n} marta qoldi`,
    endsIn: (n) => (n <= 1 ? 'shu davradan keyin tugaydi' : `${n} davra qoldi`),
    forever: 'butun o‘yin',
    dueIn: (n) => (n <= 0 ? 'keyingi navbatda to‘lanadi' : `${n} davradan keyin to‘lanadi`),
    repay: (x) => `${x}ni hozir qaytarish`,
    release: 'Bekor qilish',
    releaseTitle: 'Shartnomani bekor qilish. U sizning foydangizga, shuning uchun undan faqat siz voz kecha olasiz.',
    onDeed: 'Bu mulkdagi shartnomalar',
    owes: (x) => `Qarz ${x}`,
    owesTitle: 'Qarzlar bo‘yicha qaytarilishi kerak',
  },

  log: {
    pass: (grantor, holder, deeds) => `${grantor} ${dat(holder)} imtiyozli ijara berdi: ${deeds}.`,
    share: (grantor, holder, pct, deeds) => `${grantor} ${dat(holder)} ijaraning ${pct}% ulushini berdi: ${deeds}.`,
    loan: (lender, borrower, principal, repay, round) =>
      `${lender} ${dat(borrower)} ${principal} qarz berdi; ${round}-davrada ${repay} qaytarilishi kerak.`,
    passUsed: (p, space, saved) => `${p} «${space}»da imtiyozdan foydalanib, ${saved} tejadi.`,
    sharePaid: (p, x, space) => `${p} «${space}» ijarasidan ${x} ulush oldi.`,
    repaid: (borrower, lender, x, early) =>
      `${borrower} ${dat(lender)} ${x}ni ${early ? 'muddatidan oldin ' : ''}qaytardi.`,
    ended: (kind, holder, reason) => {
      const what = { pass: 'imtiyozli ijarasi', share: 'daromad ulushi', loan: 'qarzi' }[kind];
      const why = {
        used: 'tugadi',
        expired: 'muddati o‘tdi',
        released: 'bekor qilindi',
        void: 'kuchini yo‘qotdi',
      }[reason];
      return `${holder}ning ${what} ${why}.`;
    },
  },

  help: {
    heading: '«Ishbilarmon» shartnomalari',
    rows: [
      ['Imtiyozli ijara', 'Egasi ko‘rsatilgan mulklarda belgilangan marta kamroq yoki umuman to‘lamaydi'],
      ['Daromad ulushi', 'Egasi ko‘rsatilgan mulklar olgan har bir ijaradan muddat davomida ulush oladi'],
      ['Qarz', 'Pul hozir; qarzdorning navbati kelganda avtomatik qaytariladi yoki boshqa qarz kabi yig‘iladi'],
      ['Mulk bilan birga', 'Imtiyoz va ulushlar mulk egasi almashsa ham unda qoladi'],
      ['Bankrotlik', 'Bankrot foydasiga bo‘lgan shartnomalar kreditorga o‘tadi; bankrotning qarzlari u bilan yo‘qoladi'],
    ],
  },
};
