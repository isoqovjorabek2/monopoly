import type { EntryDict } from './entry-en';

export const entryUz: EntryDict = {
  you: 'Siz',
  orGuest: 'yoki mehmon sifatida o‘ynang',
  howAria: 'Qanday o‘ynamoqchisiz?',
  tabs: {
    host: 'Stol ochish',
    join: 'Qo‘shilish',
    practice: 'Mashq',
  },

  host: {
    who: 'Kim qo‘shila oladi?',
    private: ['Yopiq', 'Faqat siz havola yoki kod yuborgan odamlar'],
    public: ['Ommaviy', 'Istalgan kishi uni shu sahifada topib, o‘yin boshlanguncha o‘tira oladi'],
    publicCashflow: 'Nest Egg stollari hozircha faqat taklif bilan.',
    create: (visibility, game) => `${visibility === 'public' ? 'Ommaviy' : 'Yopiq'} ${game} stolini ochish`,
    after: 'Ulashish uchun havola olasiz va birinchi zar tashlanishidan oldin qoidalarni belgilaysiz.',
  },

  join: {
    code: 'Kod yoki taklif havolasi bormi?',
    codeHint: 'Stol egasi tanlagan o‘yinga qo‘shilasiz.',
    paste: 'Kod yoki havolani qo‘ying',
    invited: (code) => `Sizni ${code} stoliga taklif qilishdi. Tayyor bo‘lsangiz, «Qo‘shilish»ni bosing.`,
    publicTitle: 'Ochiq ommaviy stollar',
    yourGames: 'O‘yinlaringiz',
    yourGamesHint: 'O‘ynalayotganda serverimizda saqlanadi. «Davom etish» stolga qaytaradi yoki hech kim stolni ushlab turmasa, saqlanganidan qayta boshlaydi.',
    resume: 'Davom etish',
    forget: 'O‘chirish',
    savedMeta: (game, round, names) => `${game} · ${round}-davra · ${names}`,
  },

  practice: {
    body: (game) => `${game}ni ikki botga qarshi o‘rganing. Hech kim qo‘shila olmaydi va hech narsa ulashilmaydi.`,
    start: (game) => `Mashqni boshlash · ${game}`,
  },

  needName: 'O‘tirish uchun kiring yoki ism yozing.',
  signedOutNote: 'Kirsangiz, joyingiz istalgan qurilmada saqlanadi va boshlangan o‘yinlarga qo‘shila olasiz.',
};
