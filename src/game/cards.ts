import type { Card } from './types';

/* Sixteen Fortune and sixteen Bazaar cards. The Royal Pardon is the only card a
 * player retains; everything else resolves immediately and cycles to the
 * bottom of its deck. */

export const CHANCE: readonly Card[] = [
  { id: 'ch01', deck: 'chance', text: 'The caravan turns for home. Advance to Start and collect $200.', effect: { kind: 'move', to: 0, passGoPays: true } },
  { id: 'ch02', deck: 'chance', text: 'A signpost points west. Travel to Isfahan, collecting $200 if you pass Start.', effect: { kind: 'move', to: 24, passGoPays: true } },
  { id: 'ch03', deck: 'chance', text: 'Business calls you to Osh. Collect $200 if you pass Start on the way.', effect: { kind: 'move', to: 11, passGoPays: true } },
  { id: 'ch04', deck: 'chance', text: 'Head for the nearest utility. If nobody owns it, you may buy it. If someone does, roll the dice and pay them ten times what you roll.', effect: { kind: 'nearest', target: 'utility' } },
  { id: 'ch05', deck: 'chance', text: 'Catch the nearest rail line. If it has an owner, pay them double the usual fare; if not, you may buy it from the bank.', effect: { kind: 'nearest', target: 'railroad' } },
  { id: 'ch06', deck: 'chance', text: 'The signal turns green. Ride to the nearest rail line and pay its owner double the usual fare, or buy it from the bank if nobody owns it.', effect: { kind: 'nearest', target: 'railroad' } },
  { id: 'ch07', deck: 'chance', text: 'Your shares pay out. The bank sends you a $50 dividend.', effect: { kind: 'money', amount: 50 } },
  { id: 'ch08', deck: 'chance', text: 'Royal Pardon. Keep this card until you need to walk out of the Zindan, or sell it to another player.', effect: { kind: 'getOutFree' } },
  { id: 'ch09', deck: 'chance', text: 'Wrong turn at the crossroads. Move back three spaces.', effect: { kind: 'moveRelative', delta: -3 } },
  { id: 'ch10', deck: 'chance', text: 'Caught smuggling saffron. Straight to the Zindan: you do not pass Start and collect nothing.', effect: { kind: 'jail' } },
  { id: 'ch11', deck: 'chance', text: 'Upkeep is due on everything you have built: $25 for each house, $100 for each hotel.', effect: { kind: 'repairs', perHouse: 25, perHotel: 100 } },
  { id: 'ch12', deck: 'chance', text: 'A patrol stops your cart for racing. Pay a $15 fine.', effect: { kind: 'money', amount: -15 } },
  { id: 'ch13', deck: 'chance', text: 'Ride the Northern Line. Collect $200 if you pass Start.', effect: { kind: 'move', to: 5, passGoPays: true } },
  { id: 'ch14', deck: 'chance', text: 'The merchants’ guild elects you its head. Pay every player $50.', effect: { kind: 'moneyToEach', amount: 50 } },
  { id: 'ch15', deck: 'chance', text: 'Your construction loan comes good. Collect $150.', effect: { kind: 'money', amount: 150 } },
  { id: 'ch16', deck: 'chance', text: 'An evening stroll through Tashkent. Advance there.', effect: { kind: 'move', to: 39, passGoPays: true } },
];

export const CHEST: readonly Card[] = [
  { id: 'cc01', deck: 'chest', text: 'Dawn over the bazaar. Advance to Start and collect $200.', effect: { kind: 'move', to: 0, passGoPays: true } },
  { id: 'cc02', deck: 'chest', text: 'The money changer miscounts in your favour. Collect $200.', effect: { kind: 'money', amount: 200 } },
  { id: 'cc03', deck: 'chest', text: 'The physician calls. Pay $50.', effect: { kind: 'money', amount: -50 } },
  { id: 'cc04', deck: 'chest', text: 'You sell a parcel of shares for $50.', effect: { kind: 'money', amount: 50 } },
  { id: 'cc05', deck: 'chest', text: 'Royal Pardon. Keep this card until you need to walk out of the Zindan, or sell it to another player.', effect: { kind: 'getOutFree' } },
  { id: 'cc06', deck: 'chest', text: 'Arrested in the bazaar. Straight to the Zindan: you do not pass Start and collect nothing.', effect: { kind: 'jail' } },
  { id: 'cc07', deck: 'chest', text: 'Your travel savings mature. Collect $100.', effect: { kind: 'money', amount: 100 } },
  { id: 'cc08', deck: 'chest', text: 'Customs refunds an overpayment. Collect $20.', effect: { kind: 'money', amount: 20 } },
  { id: 'cc09', deck: 'chest', text: 'It is your birthday! Every player gives you $10.', effect: { kind: 'moneyFromEach', amount: 10 } },
  { id: 'cc10', deck: 'chest', text: 'Your insurance policy pays out. Collect $100.', effect: { kind: 'money', amount: 100 } },
  { id: 'cc11', deck: 'chest', text: 'Medicine for the whole household. Pay $100.', effect: { kind: 'money', amount: -100 } },
  { id: 'cc12', deck: 'chest', text: 'Tuition is due at the madrasa. Pay $50.', effect: { kind: 'money', amount: -50 } },
  { id: 'cc13', deck: 'chest', text: 'A neighbour pays you $25 for your advice.', effect: { kind: 'money', amount: 25 } },
  { id: 'cc14', deck: 'chest', text: 'The city repaves your street: $40 for each house, $115 for each hotel.', effect: { kind: 'repairs', perHouse: 40, perHotel: 115 } },
  { id: 'cc15', deck: 'chest', text: 'Your plov takes second place at the festival. Collect $10.', effect: { kind: 'money', amount: 10 } },
  { id: 'cc16', deck: 'chest', text: 'A distant relative leaves you $100.', effect: { kind: 'money', amount: 100 } },
];

const BY_ID: Record<string, Card> = {};
for (const c of [...CHANCE, ...CHEST]) BY_ID[c.id] = c;

export const cardById = (id: string): Card => BY_ID[id];
