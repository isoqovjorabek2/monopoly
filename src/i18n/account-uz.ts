import type { AccountDict } from './account-en';

export const accountUz: AccountDict = {
  signIn: 'Google orqali kirish',
  signingIn: 'Google oynasida kirishni yakunlang…',
  signOut: 'Hisobdan chiqish',
  errors: {
    cancelled: 'Kirish bekor qilindi.',
    failed: 'Google kirishni tasdiqlamadi. Qayta urinib ko‘ring.',
    unavailable: 'Hozir kirish imkoni yo‘q.',
    invalid: 'Kirishni tekshirib bo‘lmadi. Qayta urinib ko‘ring.',
    popup: 'Kirish oynasi bloklandi.',
  },
  joinAfterSignIn: (code) => `Kirib, ${code} ga qo‘shilish`,

  watching: 'Kuzatish',
  watchingNote: 'Bu o‘yin siz kelmasdan boshlangan. Bot o‘rnini egallab, shu joydan davom eting — uning puli, mulklari va navbati sizniki bo‘ladi.',
  takeSeat: (name) => `${name} o‘rniga o‘ynash`,
  seatSummary: (cash, deeds) => `${cash} · ${deeds} ta mulk`,
  noSeats: 'Hamma joyda odamlar o‘ynayapti. O‘yin tugaguncha kuzatishingiz mumkin.',
  watchers: (names) => `Kuzatmoqda: ${names}`,

  policy: {
    label: 'Boshlangan o‘yinga qo‘shilish',
    hint: 'Kirgan o‘yinchilar o‘yin boshlangach bot o‘rnini egallashi mumkin.',
    ask: 'Mendan so‘rash',
    anyone: 'Har bir kirgan',
    off: 'Hech kim',
  },
  askNote: 'O‘tirishingizdan oldin stol egasidan so‘raladi.',
  asked: 'Stol egasidan so‘raldi…',
  waitingHost: (bot) => `Stol egasi ${bot} o‘rnini berishini kutmoqdamiz.`,
  closed: 'Stol egasi bu o‘yinda bot o‘rnini egallashga ruxsat bermayapti. Kuzatishingiz mumkin.',
  seatDenied: 'Stol egasi bu joyni botda qoldirdi.',
  request: (name, bot) => `${name} ${bot} o‘rnini egallamoqchi`,
  allow: 'Ruxsat berish',
  deny: 'Yo‘q',

  log: {
    seatTaken: (name, bot) => `${name} ${bot}ning o‘rnini egalladi.`,
  },
};
