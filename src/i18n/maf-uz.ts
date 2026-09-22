import type { MafiaRole } from '../mafia/types';
import type { MafDict } from './maf-en';

/* Uzbek for Omertà, Latin alphabet, with the same conventions as cf-uz.ts:
 * oʻ and gʻ written with ‘ (U+2018), the tutuq belgisi with ’ (U+2019),
 * and counts as "3 ta" rather than inflected plurals. The game name stays
 * as-is, like Nest Egg and Bazaar Barons. */

export const mafUz: MafDict = {
  name: 'Omertà',

  roles: {
    godfather: {
      name: 'Don',
      brief: 'Siz oilaga boshchilik qilasiz. Detektiv sizni begunoh deb o‘qiydi. Har kecha o‘zgalaringiz bilan qurbonni belgilang.',
    },
    mafia: {
      name: 'Mafiya',
      brief: 'Oila a’zosi. Har kecha o‘zgalaringiz bilan qurbonni belgilang, kunduzi esa aralashib yuring.',
    },
    silencer: {
      name: 'Ovoz o‘chiruvchi',
      brief: 'Oila a’zosi. Har kecha bir o‘yinchining og‘zini beklaysiz: ertasi kun u ovoz bera olmaydi.',
    },
    doctor: {
      name: 'Doktor',
      brief: 'Har kecha bir o‘yinchini saqlashni tanlang. Oila uning ortidan kelsa, u tirik qoladi.',
    },
    detective: {
      name: 'Detektiv',
      brief: 'Har kecha bir o‘yinchini tekshirishni tanlang. U oiladanmi yoki yo‘q — bilib olasiz, lekin Don toza ko‘rinadi.',
    },
    bodyguard: {
      name: 'Qo‘riqchi',
      brief: 'Har kecha bir o‘yinchini qo‘riqlashni tanlang. Oila uning ortidan kelsa, u tirik qoladi.',
    },
    sniper: {
      name: 'Snayper',
      brief: 'Butun o‘yin uchun bitta o‘qingiz bor. Uni to‘g‘ri kechada sarflang.',
    },
    jester: {
      name: 'Masxaraboz',
      brief: 'Siz hech kimga bo‘ysunmaysiz. Shaharni o‘zingizni osishga ko‘ndiring — va yolg‘iz g‘olib bo‘ling.',
    },
    villager: {
      name: 'Shaharlik',
      brief: 'Tunda ishingiz yo‘q. Kuzating, tinglang va kunduzi ovoz berib oilani shahardan quvib chiqaring.',
    },
  } satisfies Record<MafiaRole, { name: string; brief: string }>,

  lobby: {
    settingsTitle: 'Uy qoidalari',
    discussion: 'Kunduzgi muhokama',
    discussionNote: 'Ovoz berish ochilishidan oldin shahar qancha vaqt gaplashadi.',
    revealRoles: 'O‘lganlarning rollarini oshkor qilish',
    revealRolesNote: 'O‘chirilsa, shahar kimni ko‘mganini taxmin qilib yuradi.',
    castTitle: 'Bugungi kechadagi tarkib',
    seconds: (n: number): string => `${n} soniya`,
  },

  reveal: {
    title: 'Shahar o‘z o‘rinlarini egallaydi',
    lead: 'Rolingiz faqat o‘zingizniki. Jim turing.',
    yourRole: 'Siz —',
    teammatesTitle: 'Oila',
    ack: 'Tushunarli',
    waiting: (n: number): string => `Yana ${n} ta o‘yinchi kutilmoqda…`,
  },

  night: {
    title: (round: number): string => `${round}-kecha`,
    lead: 'Shahar uxlamoqda. Tungi odamlar o‘z ishlarida.',
    asleep: 'Tunda ishingiz yo‘q. Tonggacha kuting.',
    chooseVictim: 'Oilaning qurbonini tanlang',
    chooseSilence: 'Ertaga kim gapirolmasligini tanlang',
    chooseSave: 'Bu kecha kimni saqlashni tanlang',
    chooseCheck: 'Kimni tekshirishni tanlang',
    chooseGuard: 'Bu kecha kimni qo‘riqlashni tanlang',
    chooseShoot: 'O‘qingizni sarflang yoki o‘q uzmay qo‘ying',
    holdFire: 'O‘q uzmaslik',
    submit: 'Tayyor',
    submitted: 'Ishingiz tugadi. Tonggacha kuting.',
    teamChose: (name: string, target: string): string => `${name} nishonga ${target}ni oldi`,
    waiting: 'Kecha hali tugamadi…',
  },

  dawn: {
    title: 'Tong',
    quiet: 'Kecha tinch o‘tdi. Hech kim o‘lmadi.',
    died: (name: string): string => `${name} o‘lik topildi.`,
    roleWas: (role: string): string => `Roli: ${role}.`,
  },

  day: {
    title: (round: number): string => `${round}-kun`,
    lead: 'Shahar gaplashmoqda. Shu yerdagi kimdir — oiladan.',
    silenced: (name: string): string => `${name}ning og‘zi beklangan va u bugun ovoz bera olmaydi.`,
    silencedYou: 'Og‘zingiz beklangan. Bugun ovoz bera olmaysiz.',
  },

  vote: {
    title: 'Ovoz berish',
    lead: 'Barmoq ko‘rsating. Shaharning tanlovi osiladi.',
    abstain: 'Ovoz bermaslik',
    youVoted: (name: string): string => `Siz ${name}ni ko‘rsatdingiz.`,
    youAbstained: 'Siz ovoz bermadingiz.',
    change: 'O‘zgartirish',
    waiting: (n: number): string => `Yana ${n} ta ovoz kutilmoqda…`,
    lynched: (name: string): string => `Shahar ${name}ni osdi.`,
    roleWas: (role: string): string => `Roli: ${role}.`,
    noLynch: 'Aniq tanlov yo‘q. Hech kim osilmaydi.',
  },

  over: {
    title: 'Chang yotadi',
    mafiaWins: 'Shahar oilaning qo‘lida.',
    villageWins: 'Shahar oilani quvib chiqardi.',
    jesterWins: (name: string): string => `${name} hammani aldadi. Masxaraboz yolg‘iz g‘olib bo‘ldi.`,
    abandoned: 'Tungi daftar mezbon bilan birga yo‘qoldi. O‘yin shu yerda tugaydi.',
    again: 'Lobbiga qaytish',
  },

  home: {
    lead: 'Shahar ichida oila yashirinib yuribdi. Har kecha ular qurbon tanlaydi, har kuni shahar bahslashadi, barmoq ko‘rsatadi va kimnidir osadi. Doktor, detektiv va boshqalar zulmatda ishlaydi — oxirigacha kim kimligini hech kim bilmaydi.',
    note: 'Stolda beshdan o‘n ikkitagacha, bo‘sh o‘rinlarni botlar egallaydi. Biringiz mezbon, qolganlar to‘g‘ridan-to‘g‘ri uning oynasiga ulanadi. Ro‘yxatdan o‘tish ham, o‘rnatish ham yo‘q.',
    cast: ['godfather', 'detective', 'doctor'] as MafiaRole[],
  },

  setup: {
    tableSize: 'Stoldagi o‘yinchilar',
    needPlayers: (n: number): string => `Omertà uchun kamida ${n} o‘yinchi kerak — bot qo‘shing yoki stolni botlar bilan to‘ldirishni yoqing.`,
    fillNote: 'O‘yin boshlanganda beshtagacha bo‘sh o‘rinlarni botlar egallaydi.',
    publicSoon: 'Omertà stollari hozircha faqat taklif bilan: havolani ulashing.',
  },

  table: {
    alive: (n: number, total: number): string => `${total} tadan ${n} tasi tirik`,
    you: 'Siz',
    dead: 'O‘lgan',
    silenced: 'Ovozsiz',
    away: 'Aloqada emas',
    family: 'Oila',
    votes: (n: number): string => `${n} ta ovoz`,
    openVote: 'Ovoz berishni hozir ochish',
    deadNote: 'Siz o‘ldingiz. O‘yinning qolganini jim kuzating.',
    deadChat: 'O‘liklar gapirmaydi.',
    pick: 'Tanlash uchun o‘yinchiga bosing.',
    confirm: 'Tasdiqlash',
    skip: 'Bu kechani o‘tkazib yuborish',
    youChose: (name: string): string => `Tanlovingiz: ${name}.`,
    youSkipped: 'Bu kechani o‘tkazib yubordingiz.',
    nobody: 'hech kim',
    checksTitle: 'Tekshiruvlaringiz',
    bulletLeft: 'Bitta o‘q qoldi',
    bulletSpent: 'O‘q sarflangan',
    self: '(siz)',
    tabs: { players: 'Shahar', stage: 'Stol', log: 'Jurnal va chat' },
  },

  end: {
    rolesTitle: 'Kim kim edi',
    youWon: 'Tomoningiz g‘olib bo‘ldi.',
    youLost: 'Tomoningiz yutqazdi.',
    spectated: 'Bu o‘yinni kuzatdingiz.',
  },

  help: {
    title: 'Omertà qanday o‘ynaladi',
    lines: [
      'Har kimga yashirin rol beriladi. Oila (Don, Mafiya, Ovoz o‘chiruvchi) bir-birini biladi; boshqalar hech narsa bilmaydi.',
      'Kechasi oila qurbon tanlaydi. Doktor kimnidir qutqaradi, Qo‘riqchi qo‘riqlaydi, Detektiv tekshiradi, Ovoz o‘chiruvchi og‘zini yopadi, Snayper esa yagona o‘qini sarflashi mumkin.',
      'Tongda shahar kim o‘lganini bilib oladi. Kunduzi hamma bahslashadi va ovoz beradi: eng ko‘p ovoz olgan o‘yinchi osiladi. Durangda hech kim osilmaydi.',
      'Oila qolmasa, shahar g‘olib. Oila qolganlarga tenglashsa, oila g‘olib. Masxaraboz osilsa, yolg‘iz o‘zi g‘olib bo‘ladi.',
      'O‘liklar gapirmaydi. Detektiv uchun Don begunoh ko‘rinadi.',
    ],
  },

  result: {
    guilty: 'oiladan',
    innocent: 'oiladan emas',
    checked: (name: string, verdict: string): string => `${name} — ${verdict}.`,
  },
};
