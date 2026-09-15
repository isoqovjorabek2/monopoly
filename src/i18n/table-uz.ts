import type { TableDict } from './table-en';

const dat = (name: string): string => {
  const w = name.trim().toLowerCase();
  if (w.endsWith('g‘') || w.endsWith('q')) return `${name}qa`;
  if (w.endsWith('k') || w.endsWith('g')) return `${name}ka`;
  return `${name}ga`;
};

export const tableUz: TableDict = {
  counter: {
    button: 'Qarshi taklif',
    title: (name) => `${dat(name)} qarshi taklif`,
    note: (name) => `Istalgan narsani o‘zgartirib, qaytarib yuboring. Shunda ${name}ning dastlabki taklifi bekor bo‘ladi.`,
    send: 'Qarshi taklifni yuborish',
    badge: 'qarshi taklif',
  },

  alerts: {
    on: 'Ogohlantirish yoqiq',
    off: 'Ogohlantirish o‘chiq',
    title: 'Stol meni kutayotganda boshqa oynada bo‘lsam ham xabar berish',
    blocked: 'Brauzer sozlamalarida bu sayt uchun bildirishnomalar taqiqlangan.',
    yourTurn: 'Sizning navbatingiz',
    needed: 'Stol sizning qaroringizni kutmoqda',
    offer: (name) => `${name} sizga taklif yubordi`,
    request: (name) => `${name} joy egallamoqchi`,
  },

  rematch: {
    again: 'Shu stolda yana o‘ynash',
    note: 'Hamma o‘z joyida qoladi, birinchi zar tashlanishidan oldin qoidalarni o‘zgartirish mumkin.',
    waiting: 'Stol egasi yangi o‘yin boshlashini kutmoqdamiz…',
  },

  live: {
    inProgress: (round) => `O‘yin ketmoqda · ${round}-davra`,
    openSeats: (n) => `${n} ta bot o‘rni bo‘sh`,
    watch: 'Kuzatish va qo‘shilish',
    watchTitle: 'Kiring, kuzating va bot o‘rnini egallang',
  },

  log: {
    countered: (by, from) => `${by} ${dat(from)} qarshi taklif qildi.`,
  },

  mod: {
    coowner: 'ham egasi',
    coownerTitle: 'Egasiz qolganda stol saylagan; o‘yinchilarni chiqarish huquqi bor',
    kickTitle: (name) => `${name} — stoldan chiqarish; o‘rnini bot oladi`,
    kickSure: 'Ishonchingiz komilmi?',
    awayTitle: 'Stol egasi yo‘q',
    awayBody: (name, voters) =>
      `${name} ancha vaqtdan beri yo‘q. Tartibni saqlash uchun ham egasini qo‘llang; ${voters} ovozdan ko‘pchilik saylaydi.`,
    votes: (n) => `${n} ta ovoz`,
    endorse: 'Qo‘llash',
    endorsed: 'Qo‘llangan',
  },
};
