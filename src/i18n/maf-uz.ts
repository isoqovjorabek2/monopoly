import type { MafiaRole } from '../mafia/types';
import type { MafDict } from './maf-en';

/* Uzbek for Omertà. The game name stays as-is, like Nest Egg and Bazaar
 * Barons. */

export const mafUz: MafDict = {
  name: 'Omertà',

  roles: {
    godfather: {
      name: 'Don',
      brief: 'Siz oila boshlig‘isiz va har kechagi qurbon bo‘yicha oxirgi so‘z sizniki. Detektiv uchun siz oddiy shaharlik bo‘lib ko‘rinasiz.',
    },
    mafia: {
      name: 'Mafiya',
      brief: 'Oila a’zosi. Har kecha o‘zingiznikilar bilan qurbon tanlang, kunduzi esa o‘zingizni sezdirmang.',
    },
    silencer: {
      name: 'Ovoz o‘chiruvchi',
      brief: 'Oila a’zosi. Har kecha bir o‘yinchining og‘zini yopasiz: ertasi kuni u gapira olmaydi.',
    },
    doctor: {
      name: 'Doktor',
      brief: 'Har kecha bir o‘yinchini himoya qiling — o‘zingizni ham mumkin. Lekin bir kishini ketma-ket ikki kecha emas.',
    },
    detective: {
      name: 'Detektiv',
      brief: 'Har kecha bir o‘yinchini tekshirib, rolini bilib oling — yoki gumondorni otib tashlang. Doktor o‘qingizni to‘xtata olmaydi.',
    },
    bodyguard: {
      name: 'Qo‘riqchi',
      brief: 'Har kecha bir o‘yinchini qo‘riqlang. Unga hujum qilishsa, uning o‘rniga siz halok bo‘lasiz.',
    },
    sniper: {
      name: 'Snayper',
      brief: 'Butun o‘yinga bitta o‘q, u kunduzi otiladi. Behuda ketmasin.',
    },
    jester: {
      name: 'Masxaraboz',
      brief: 'Siz hech kimning tomonida emassiz. Shahar sizni ossa yoki snayper otsa — g‘alaba yolg‘iz sizniki.',
    },
    villager: {
      name: 'Shaharlik',
      brief: 'Tunda ishingiz yo‘q. Kuzating, tinglang va kunduzi ovoz berib oilani shahardan quvib chiqaring.',
    },
  } satisfies Record<MafiaRole, { name: string; brief: string }>,

  home: {
    lead: 'Shahar ichida oila yashirinib yuribdi. Har kecha ular qurbon tanlaydi, har kuni shahar bahslashadi, barmoq ko‘rsatadi va kimnidir osadi. Doktor, detektiv va boshqalar zulmatda ishlaydi — oxirigacha kim kimligini hech kim bilmaydi.',
    note: 'Stolda to‘rtdan o‘n beshtagacha, bo‘sh o‘rinlarni botlar egallaydi. Biringiz mezbon, qolganlar to‘g‘ridan-to‘g‘ri uning oynasiga ulanadi. Ro‘yxatdan o‘tish ham, o‘rnatish ham yo‘q.',
    cast: ['godfather', 'detective', 'doctor'] as MafiaRole[],
  },

  lobby: {
    castTitle: 'Tarkib',
    auto: 'Muvozanatli',
    autoNote: 'Tarkib stoldagi o‘yinchilar soniga qarab tanlanadi.',
    custom: 'O‘zim',
    presets: {
      small: ['Klassik, kichik', '4–6 o‘yinchi. Oddiy va toza.'],
      medium: ['Klassik', '7–10 o‘yinchi. Odatiy o‘yin.'],
      large: ['Klassik, katta', '11–15 o‘yinchi, maxsus rollar bilan.'],
      chaos: ['Tartibsizlik', '8–15 o‘yinchi. Hamma yoqda maxsus rollar.'],
    },
    total: (cast, table) => `${table} o‘yinchiga ${cast} ta rol`,
    problems: {
      size: 'Rollar soni o‘yinchilar soniga teng bo‘lishi kerak.',
      no_mafia: 'Tarkibda kamida bitta oila a’zosi bo‘lishi kerak.',
      no_town: 'Tarkibda kamida bitta shaharlik bo‘lishi kerak.',
      mafia_heavy: 'Oila boshidanoq shahar bilan tenglashib qoladi.',
    },
    fallback: 'O‘yin boshlanganda ham tarkib mos kelmasa, stol muvozanatli tarkibni tarqatadi.',
    timers: 'Bosqich soatlari',
    night: 'Kecha',
    day: 'Kunduzgi suhbat',
    vote: 'Ovoz berish',
    seconds: (n) => `${n} s`,
    revealRoles: 'O‘lganlarning rollarini oshkor qilish',
    revealRolesNote: 'O‘chirilsa, shahar kimni ko‘mganini taxmin qilib yuradi.',
    tableSize: 'Stoldagi o‘yinchilar',
    needPlayers: (n) => `Omertà uchun kamida ${n} o‘yinchi kerak — bot qo‘shing yoki stolni botlar bilan to‘ldirishni yoqing.`,
    fillNote: 'O‘yin boshlanganda to‘rttagacha bo‘sh o‘rinlarni botlar egallaydi.',
    publicSoon: 'Omertà stollari hozircha faqat taklif bilan: havolani ulashing.',
  },

  reveal: {
    title: 'Shahar o‘z o‘rinlarini egallaydi',
    lead: 'Rolingiz faqat o‘zingizniki. Jim turing.',
    yourRole: 'Siz —',
    teammatesTitle: 'Oila',
    ack: 'O‘rnimni egallash',
  },

  night: {
    title: (round) => `${round}-kecha`,
    lead: 'Shahar uxlamoqda. Tungi odamlar o‘z ishlarida.',
    asleep: 'Tunda ishingiz yo‘q. Tongni kuting — ko‘zingizni ochmang.',
    choose: {
      kill: 'Oila qurbonini tanlang',
      silence: 'Ertaga kim gapira olmasligini tanlang',
      protect: 'Bu kecha kimni himoya qilishni tanlang',
      investigate: 'Kimni tekshirishni tanlang',
      shoot: 'Otish uchun gumondorni tanlang',
      guard: 'Bu kecha kimni qo‘riqlashni tanlang',
    },
    confirm: {
      kill: 'Belgilash',
      silence: 'Og‘zini yopish',
      protect: 'Himoya qilish',
      investigate: 'Tekshirish',
      shoot: 'Otish',
      guard: 'Qo‘riqlash',
    },
    modes: { kill: 'Qotillik', silence: 'Ovozsizlik', protect: 'Himoya', investigate: 'Tekshiruv', shoot: 'O‘q', guard: 'Qo‘riq' },
    investigateNote: 'O‘yinchining rolini bilib oling. Don oddiy shaharlik bo‘lib ko‘rinadi.',
    shootNote: 'Bu o‘yinchi bu kecha halok bo‘ladi. Doktor qutqara olmaydi, qo‘riqchi — oladi.',
    noRepeat: 'Uni o‘tgan kecha himoya qilgansiz.',
    boss: (name) => `Bu kecha oxirgi so‘z ${name}da. Sizning tanlovingiz — maslahat.`,
    youAreBoss: 'Bu kecha oilaning oxirgi so‘zi sizda.',
    crew: 'Oilangiz — nishon emas',
    picks: 'Oilaning tanlovi',
    submitted: 'Ishingiz bitdi. Tongni kuting.',
    waiting: 'Kecha hali tugamadi…',
  },

  dawn: {
    title: 'Tong',
    quiet: 'Kecha tinch o‘tdi. Hech kim o‘lmadi.',
    died: (name) => `${name} o‘lik holda topildi — oila o‘z qurbonini oldi.`,
    guarded: (name, saved) => `${name} ${saved}ni himoya qilib, jonini fido qildi.`,
    shot: (name) => `Detektiv ${name}ni otdi.`,
    sniped: (name) => `O‘q ovozi yangradi — snayper ${name}ni urdi.`,
    saved: (name) => `${name}ga hujum qilishdi, lekin doktor qutqarib qoldi.`,
    roleWas: (role) => `Roli: ${role}.`,
  },

  day: {
    title: (round) => `${round}-kun`,
    lead: 'Shahar gaplashmoqda. Shu yerdagi kimdir — oiladan.',
    silenced: (name) => `${name}ning og‘zi yopilgan, bugun gapira olmaydi.`,
    silencedYou: 'Og‘zingiz yopildi. Ovoz berishgacha gapira olmaysiz.',
    snipe: {
      title: 'Yagona o‘qingiz',
      note: 'Hozir otsangiz, o‘q darhol, hammaning ko‘z o‘ngida tegadi.',
      confirm: 'Otish',
      spent: 'O‘qingiz sarflangan.',
    },
  },

  vote: {
    title: 'Ovoz berish',
    lead: 'Barmoq ko‘rsating. Shaharning tanlovi osiladi; durangda hech kim osilmaydi.',
    youVoted: (name) => `Siz ${name}ni ko‘rsatdingiz.`,
    retract: 'Qaytarib olish',
    change: 'O‘zgartirish',
    waiting: (n) => `Yana ${n} ta ovoz kutilmoqda…`,
    lynched: (name) => `Shahar ${name}ni osdi.`,
    roleWas: (role) => `Roli: ${role}.`,
    tie: 'Ovozlar teng bo‘ldi. Hech kim osilmaydi.',
    noVotes: 'Hech kim ovoz bermadi. Hech kim osilmaydi.',
  },

  over: {
    title: 'Chang yotadi',
    mafiaWins: 'Shahar oilaning qo‘lida.',
    villageWins: 'Shahar oilani quvib chiqardi.',
    jesterWins: (name) => `${name} hammani aldadi. Masxaraboz yolg‘iz g‘olib bo‘ldi.`,
    abandoned: 'Tungi daftar mezbon bilan birga yo‘qoldi. O‘yin shu yerda tugaydi.',
  },

  end: {
    rolesTitle: 'Kim kim edi',
    youWon: 'Tomoningiz g‘olib bo‘ldi.',
    youLost: 'Tomoningiz yutqazdi.',
    spectated: 'Bu o‘yinni kuzatdingiz.',
    mvp: 'MVP',
    mvpYou: 'Siz — MVP',
    stat: {
      kills: (n) => `${n} ta qotillik`,
      saves: (n) => `${n} ta qutqaruv`,
      reads: (n) => `${n} ta to‘g‘ri taxmin`,
      finds: (n) => `${n} ta tekshiruv`,
      survived: 'tirik qoldi',
      clutch: 'hal qiluvchi o‘yin',
    },
    nearMiss: {
      survive: 'Tirik qolish uchun bitta ovoz yetmadi.',
      town: 'Shaharni tozalash uchun bitta osish yetmadi.',
      family: 'Oilaga g‘alabagacha bitta yurish yetmadi.',
    },
  },

  table: {
    alive: (n, total) => `${total} tadan ${n} tasi tirik`,
    counts: (town, family, jester) => `Shahar ${town} · Oila ${family}${jester > 0 ? ` · Masxaraboz ${jester}` : ''}`,
    you: 'Siz',
    dead: 'O‘lgan',
    silenced: 'Ovozsiz',
    away: 'Aloqada emas',
    family: 'Oila',
    boss: 'Boshliq',
    votes: (n) => `${n} ta ovoz`,
    skip: 'Keyingi bosqichga o‘tish',
    deadNote: 'Siz o‘ldingiz. O‘yinning qolganini kuzating — chatda bitta oxirgi so‘zingiz bor.',
    pick: 'Tanlash uchun o‘yinchiga bosing.',
    confirm: 'Tasdiqlash',
    youChose: (name) => `Tanlovingiz: ${name}.`,
    nobody: 'hech kim',
    self: '(siz)',
    checksTitle: 'Tekshiruvlaringiz',
    tabs: { stage: 'Stol', chat: 'Chat', log: 'Jurnal' },
    layout: { label: 'O‘tirish', grid: 'To‘r', round: 'Dumaloq stol' },
    music: 'Musiqa',
  },

  chat: {
    placeholder: 'Biror narsa yozing yoki shivirlash uchun @ism…',
    familyPlaceholder: 'Oilangiz bilan gaplashing…',
    lastWordsPlaceholder: 'Oxirgi so‘zingiz…',
    nightQuiet: 'Tunda faqat oila gapiradi.',
    silenced: 'Ovoz berishgacha og‘zingiz yopiq.',
    lastWordsUsed: 'O‘liklar oxirgi so‘zini aytib bo‘lgan.',
    familyTag: 'Oila',
    lastWordsTag: 'Oxirgi so‘z',
    whisperTo: (name) => `${name}ga shivirlash`,
    whisperFrom: (name) => `${name}dan shivir`,
    empty: 'Hali hech kim hech narsa demadi.',
    send: 'Yuborish',
    aria: 'Stol chati',
  },

  result: {
    guilty: 'oiladan',
    innocent: 'oiladan emas',
    checked: (name, role, verdict) => `${name}: ${role} — ${verdict}.`,
  },

  help: {
    title: 'Omertà qanday o‘ynaladi',
    lines: [
      'Har kimga yashirin rol beriladi. Oila (Don, Mafiya, Ovoz o‘chiruvchi) bir-birini biladi; boshqalar hech narsa bilmaydi.',
      'Kechasi oila qurbonni belgilaydi — oxirgi so‘z Don yoki hozir oilani boshqarayotgan kishida. Doktor kimnidir himoya qiladi, Qo‘riqchi qo‘riqlaydi va uning o‘rniga halok bo‘ladi, Detektiv tekshiradi yoki otadi, Ovoz o‘chiruvchi esa kimningdir og‘zini ertangi kunga yopadi.',
      'Tongda shahar nima bo‘lganini bilib oladi. Kunduzgi vaqt tugaguncha suhbat davom etadi, keyin ovoz beriladi: eng ko‘p ovoz olgan o‘yinchi osiladi, durangda — hech kim. Snayper kunning istalgan paytida yagona o‘qini otishi mumkin.',
      'Oila qolmasa, shahar g‘olib. Oila qolganlarga tenglashsa, oila g‘olib. Masxaraboz osilsa yoki otilsa, yolg‘iz o‘zi g‘olib bo‘ladi.',
      'Tunda faqat oila gapiradi. Og‘zi yopilgan kunduzi gapira olmaydi. O‘liklarning bitta oxirgi so‘zi bor. Shivirlash uchun xabarni @ism bilan boshlang.',
    ],
  },
};
