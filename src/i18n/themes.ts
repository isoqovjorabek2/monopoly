import type { BoardTheme } from '../game/types';
import type { Lang } from './index';

/* ------------------------------------------------------------------ *
 * Board themes: Party Hall Plus.
 *
 * A theme is words, never rules. It renames the squares a table plays on
 * and the four cards that name a square - prices, rents, sets and card
 * effects are the same on every board. The engine keeps speaking in the
 * base board's names; each client swaps the words at the moment it draws
 * them, the same way it already swaps languages (see useT in index.ts).
 *
 * Only the squares a theme renames are listed. Anything else - Start, the
 * Zindan, taxes, the decks - reads as it does on the Silk Road.
 * ------------------------------------------------------------------ */

export const BOARD_THEMES: readonly BoardTheme[] = ['silk', 'tashkent', 'europe'];

type Names = Record<number, [name: string, short: string]>;

/** Tashkent: its districts, its landmarks, and its four metro lines. */
const TASHKENT: Record<Lang, Names> = {
  en: {
    1: ['Bektemir', 'Bektemir'],
    3: ['Sergeli', 'Sergeli'],
    5: ['Chilanzar Line', 'Metro 1'],
    6: ['Uchtepa', 'Uchtepa'],
    8: ['Olmazor', 'Olmazor'],
    9: ['Yangihayot', 'Yangi Hayot'],
    11: ['Chilanzar', 'Chilanzar'],
    13: ['Yakkasaray', 'Yakka Saray'],
    14: ['Mirobod', 'Mirobod'],
    15: ['Uzbekistan Line', 'Metro 2'],
    16: ['Yashnobod', 'Yashnobod'],
    18: ['Shaykhantahur', 'Shaykhan Tahur'],
    19: ['Mirzo Ulugbek', 'Mirzo Ulugbek'],
    21: ['Yunusabad', 'Yunusabad'],
    23: ['Chorsu Bazaar', 'Chorsu'],
    24: ['Minor', 'Minor'],
    25: ['Yunusabad Line', 'Metro 3'],
    26: ['Sayilgoh Street', 'Sayilgoh'],
    27: ['Navoi Theatre', 'Navoi Theatre'],
    28: ['Bozsu Canal', 'Bozsu Canal'],
    29: ['TV Tower', 'TV Tower'],
    31: ['Hazrati Imam', 'Hazrati Imam'],
    32: ['Independence Square', 'Indep. Square'],
    34: ['Navoi Park', 'Navoi Park'],
    35: ['Circle Line', 'Metro 4'],
    37: ['Amir Temur Square', 'Amir Temur'],
    39: ['Tashkent City', 'Tashkent City'],
  },
  ru: {
    1: ['Бектемир', 'Бектемир'],
    3: ['Сергели', 'Сергели'],
    5: ['Чиланзарская линия', 'Метро 1'],
    6: ['Учтепа', 'Учтепа'],
    8: ['Алмазар', 'Алмазар'],
    9: ['Янгихаёт', 'Янгихаёт'],
    11: ['Чиланзар', 'Чиланзар'],
    13: ['Яккасарай', 'Яккасарай'],
    14: ['Мирабад', 'Мирабад'],
    15: ['Узбекистанская линия', 'Метро 2'],
    16: ['Яшнабад', 'Яшнабад'],
    18: ['Шайхантахур', 'Шайхантахур'],
    19: ['Мирзо-Улугбек', 'Мирзо-Улугбек'],
    21: ['Юнусабад', 'Юнусабад'],
    23: ['Базар Чорсу', 'Чорсу'],
    24: ['Минор', 'Минор'],
    25: ['Юнусабадская линия', 'Метро 3'],
    26: ['Улица Сайилгох', 'Сайилгох'],
    27: ['Театр Навои', 'Театр Навои'],
    28: ['Канал Бозсу', 'Бозсу'],
    29: ['Телебашня', 'Телебашня'],
    31: ['Хазрати Имам', 'Хазрати Имам'],
    32: ['Площадь Мустакиллик', 'Мустакиллик'],
    34: ['Парк Навои', 'Парк Навои'],
    35: ['Кольцевая линия', 'Метро 4'],
    37: ['Сквер Амира Темура', 'Амир Темур'],
    39: ['Ташкент-Сити', 'Ташкент-Сити'],
  },
  uz: {
    1: ['Bektemir', 'Bektemir'],
    3: ['Sergeli', 'Sergeli'],
    5: ['Chilonzor yo‘li', 'Metro 1'],
    6: ['Uchtepa', 'Uchtepa'],
    8: ['Olmazor', 'Olmazor'],
    9: ['Yangihayot', 'Yangihayot'],
    11: ['Chilonzor', 'Chilonzor'],
    13: ['Yakkasaroy', 'Yakkasaroy'],
    14: ['Mirobod', 'Mirobod'],
    15: ['O‘zbekiston yo‘li', 'Metro 2'],
    16: ['Yashnobod', 'Yashnobod'],
    18: ['Shayxontohur', 'Shayxontohur'],
    19: ['Mirzo Ulug‘bek', 'Mirzo Ulug‘bek'],
    21: ['Yunusobod', 'Yunusobod'],
    23: ['Chorsu bozori', 'Chorsu'],
    24: ['Minor', 'Minor'],
    25: ['Yunusobod yo‘li', 'Metro 3'],
    26: ['Sayilgoh ko‘chasi', 'Sayilgoh'],
    27: ['Navoiy teatri', 'Navoiy teatri'],
    28: ['Bo‘zsuv kanali', 'Bo‘zsuv'],
    29: ['Teleminora', 'Teleminora'],
    31: ['Hazrati Imom', 'Hazrati Imom'],
    32: ['Mustaqillik maydoni', 'Mustaqillik'],
    34: ['Navoiy bog‘i', 'Navoiy bog‘i'],
    35: ['Halqa yo‘li', 'Metro 4'],
    37: ['Amir Temur xiyoboni', 'Amir Temur'],
    39: ['Toshkent Siti', 'Toshkent Siti'],
  },
};

/** Europe: twenty-two capitals and great cities, and four night trains. */
const EUROPE: Record<Lang, Names> = {
  en: {
    1: ['Tirana', 'Tirana'],
    3: ['Sofia', 'Sofia'],
    5: ['Night Express', 'Night Express'],
    6: ['Lisbon', 'Lisbon'],
    8: ['Athens', 'Athens'],
    9: ['Dublin', 'Dublin'],
    11: ['Prague', 'Prague'],
    13: ['Budapest', 'Budapest'],
    14: ['Warsaw', 'Warsaw'],
    15: ['Alpine Line', 'Alpine Line'],
    16: ['Vienna', 'Vienna'],
    18: ['Brussels', 'Brussels'],
    19: ['Amsterdam', 'Amsterdam'],
    21: ['Madrid', 'Madrid'],
    23: ['Barcelona', 'Barcelona'],
    24: ['Milan', 'Milan'],
    25: ['Riviera Line', 'Riviera Line'],
    26: ['Berlin', 'Berlin'],
    27: ['Munich', 'Munich'],
    29: ['Rome', 'Rome'],
    31: ['Zurich', 'Zurich'],
    32: ['Stockholm', 'Stockholm'],
    34: ['Copenhagen', 'Copenhagen'],
    35: ['Nordic Express', 'Nordic Express'],
    37: ['London', 'London'],
    39: ['Paris', 'Paris'],
  },
  ru: {
    1: ['Тирана', 'Тирана'],
    3: ['София', 'София'],
    5: ['Ночной экспресс', 'Ночной экспресс'],
    6: ['Лиссабон', 'Лиссабон'],
    8: ['Афины', 'Афины'],
    9: ['Дублин', 'Дублин'],
    11: ['Прага', 'Прага'],
    13: ['Будапешт', 'Будапешт'],
    14: ['Варшава', 'Варшава'],
    15: ['Альпийская линия', 'Альпийская'],
    16: ['Вена', 'Вена'],
    18: ['Брюссель', 'Брюссель'],
    19: ['Амстердам', 'Амстердам'],
    21: ['Мадрид', 'Мадрид'],
    23: ['Барселона', 'Барселона'],
    24: ['Милан', 'Милан'],
    25: ['Ривьера', 'Ривьера'],
    26: ['Берлин', 'Берлин'],
    27: ['Мюнхен', 'Мюнхен'],
    29: ['Рим', 'Рим'],
    31: ['Цюрих', 'Цюрих'],
    32: ['Стокгольм', 'Стокгольм'],
    34: ['Копенгаген', 'Копенгаген'],
    35: ['Северный экспресс', 'Северный экспресс'],
    37: ['Лондон', 'Лондон'],
    39: ['Париж', 'Париж'],
  },
  uz: {
    1: ['Tirana', 'Tirana'],
    3: ['Sofiya', 'Sofiya'],
    5: ['Tungi ekspress', 'Tungi ekspress'],
    6: ['Lissabon', 'Lissabon'],
    8: ['Afina', 'Afina'],
    9: ['Dublin', 'Dublin'],
    11: ['Praga', 'Praga'],
    13: ['Budapesht', 'Budapesht'],
    14: ['Varshava', 'Varshava'],
    15: ['Alp yo‘li', 'Alp yo‘li'],
    16: ['Vena', 'Vena'],
    18: ['Bryussel', 'Bryussel'],
    19: ['Amsterdam', 'Amsterdam'],
    21: ['Madrid', 'Madrid'],
    23: ['Barselona', 'Barselona'],
    24: ['Milan', 'Milan'],
    25: ['Riviera yo‘li', 'Riviera yo‘li'],
    26: ['Berlin', 'Berlin'],
    27: ['Myunxen', 'Myunxen'],
    29: ['Rim', 'Rim'],
    31: ['Syurix', 'Syurix'],
    32: ['Stokgolm', 'Stokgolm'],
    34: ['Kopengagen', 'Kopengagen'],
    35: ['Shimol ekspressi', 'Shimol ekspressi'],
    37: ['London', 'London'],
    39: ['Parij', 'Parij'],
  },
};

const NAMES: Record<Exclude<BoardTheme, 'silk'>, Record<Lang, Names>> = { tashkent: TASHKENT, europe: EUROPE };

/** The squares a theme renames, in one language. Empty for the Silk Road. */
export function themeSpaces(theme: BoardTheme, lang: Lang): Names {
  return theme === 'silk' ? {} : NAMES[theme][lang];
}

type NameOf = (id: number) => string;

/**
 * The cards that send a player to a named square, worded for the board. The
 * effects are fixed by id in game/cards.ts; only the name in the sentence
 * moves. Squares: 24 (the third red), 11 (the first pink), 5 (the first
 * line) and 39 (the top of the board).
 */
const CARD_TEXT: Record<Lang, (n: NameOf) => Record<string, string>> = {
  en: (n) => ({
    ch02: `A signpost points the way. Travel to ${n(24)}, collecting $200 if you pass Start.`,
    ch03: `Business calls you to ${n(11)}. Collect $200 if you pass Start on the way.`,
    ch13: `Take a ride on the ${n(5)}. Collect $200 if you pass Start.`,
    ch16: `An evening stroll through ${n(39)}. Advance there.`,
  }),
  ru: (n) => ({
    ch02: `Указатель показывает дорогу. Отправляйтесь на поле «${n(24)}»; если проходите «Старт», получите $200.`,
    ch03: `Дела зовут на поле «${n(11)}». Если по пути проходите «Старт», получите $200.`,
    ch13: `Поездка: «${n(5)}». Если проходите «Старт», получите $200.`,
    ch16: `Вечерняя прогулка: «${n(39)}». Отправляйтесь туда.`,
  }),
  uz: (n) => ({
    ch02: `Ko‘rsatkich yo‘lni ko‘rsatmoqda. «${n(24)}» katagiga boring; «Start»dan o‘tsangiz, $200 oling.`,
    ch03: `Ishlar sizni «${n(11)}» katagiga chorlaydi. Yo‘lda «Start»dan o‘tsangiz, $200 oling.`,
    ch13: `«${n(5)}» bo‘ylab sayohat. «Start»dan o‘tsangiz, $200 oling.`,
    ch16: `«${n(39)}» bo‘ylab kechki sayr. O‘sha yerga boring.`,
  }),
};

/** Card texts a theme rewords, in one language. Empty for the Silk Road. */
export function themeCards(theme: BoardTheme, lang: Lang, nameOf: NameOf): Record<string, string> {
  return theme === 'silk' ? {} : CARD_TEXT[lang](nameOf);
}
