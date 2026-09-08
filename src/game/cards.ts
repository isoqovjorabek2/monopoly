import type { Card } from './types';

/* The 16 + 16 standard cards. "Get Out of Jail Free" is the only card a
 * player retains; everything else resolves immediately and cycles to the
 * bottom of its deck. */

export const CHANCE: readonly Card[] = [
  { id: 'ch01', deck: 'chance', text: 'Advance to GO. Collect $200.', effect: { kind: 'move', to: 0, passGoPays: true } },
  { id: 'ch02', deck: 'chance', text: 'Advance to Illinois Avenue. If you pass GO, collect $200.', effect: { kind: 'move', to: 24, passGoPays: true } },
  { id: 'ch03', deck: 'chance', text: 'Advance to St. Charles Place. If you pass GO, collect $200.', effect: { kind: 'move', to: 11, passGoPays: true } },
  { id: 'ch04', deck: 'chance', text: 'Advance to the nearest Utility. If unowned you may buy it. If owned, throw the dice and pay the owner ten times the amount thrown.', effect: { kind: 'nearest', target: 'utility' } },
  { id: 'ch05', deck: 'chance', text: 'Advance to the nearest Railroad and pay the owner twice the rental they are otherwise entitled to. If unowned you may buy it from the Bank.', effect: { kind: 'nearest', target: 'railroad' } },
  { id: 'ch06', deck: 'chance', text: 'Advance to the nearest Railroad and pay the owner twice the rental they are otherwise entitled to. If unowned you may buy it from the Bank.', effect: { kind: 'nearest', target: 'railroad' } },
  { id: 'ch07', deck: 'chance', text: 'Bank pays you a dividend of $50.', effect: { kind: 'money', amount: 50 } },
  { id: 'ch08', deck: 'chance', text: 'Get Out of Jail Free. This card may be kept until needed, or traded.', effect: { kind: 'getOutFree' } },
  { id: 'ch09', deck: 'chance', text: 'Go back three spaces.', effect: { kind: 'moveRelative', delta: -3 } },
  { id: 'ch10', deck: 'chance', text: 'Go to Jail. Go directly to Jail. Do not pass GO, do not collect $200.', effect: { kind: 'jail' } },
  { id: 'ch11', deck: 'chance', text: 'Make general repairs on all your property: for each house pay $25, for each hotel pay $100.', effect: { kind: 'repairs', perHouse: 25, perHotel: 100 } },
  { id: 'ch12', deck: 'chance', text: 'Speeding fine. Pay $15.', effect: { kind: 'money', amount: -15 } },
  { id: 'ch13', deck: 'chance', text: 'Take a trip to Reading Railroad. If you pass GO, collect $200.', effect: { kind: 'move', to: 5, passGoPays: true } },
  { id: 'ch14', deck: 'chance', text: 'You have been elected Chairman of the Board. Pay each player $50.', effect: { kind: 'moneyToEach', amount: 50 } },
  { id: 'ch15', deck: 'chance', text: 'Your building loan matures. Collect $150.', effect: { kind: 'money', amount: 150 } },
  { id: 'ch16', deck: 'chance', text: 'Advance to Boardwalk.', effect: { kind: 'move', to: 39, passGoPays: true } },
];

export const CHEST: readonly Card[] = [
  { id: 'cc01', deck: 'chest', text: 'Advance to GO. Collect $200.', effect: { kind: 'move', to: 0, passGoPays: true } },
  { id: 'cc02', deck: 'chest', text: 'Bank error in your favour. Collect $200.', effect: { kind: 'money', amount: 200 } },
  { id: 'cc03', deck: 'chest', text: "Doctor's fee. Pay $50.", effect: { kind: 'money', amount: -50 } },
  { id: 'cc04', deck: 'chest', text: 'From the sale of stock you get $50.', effect: { kind: 'money', amount: 50 } },
  { id: 'cc05', deck: 'chest', text: 'Get Out of Jail Free. This card may be kept until needed, or traded.', effect: { kind: 'getOutFree' } },
  { id: 'cc06', deck: 'chest', text: 'Go to Jail. Go directly to Jail. Do not pass GO, do not collect $200.', effect: { kind: 'jail' } },
  { id: 'cc07', deck: 'chest', text: 'Holiday fund matures. Receive $100.', effect: { kind: 'money', amount: 100 } },
  { id: 'cc08', deck: 'chest', text: 'Income tax refund. Collect $20.', effect: { kind: 'money', amount: 20 } },
  { id: 'cc09', deck: 'chest', text: 'It is your birthday. Collect $10 from every player.', effect: { kind: 'moneyFromEach', amount: 10 } },
  { id: 'cc10', deck: 'chest', text: 'Life insurance matures. Collect $100.', effect: { kind: 'money', amount: 100 } },
  { id: 'cc11', deck: 'chest', text: 'Pay hospital fees of $100.', effect: { kind: 'money', amount: -100 } },
  { id: 'cc12', deck: 'chest', text: 'Pay school fees of $50.', effect: { kind: 'money', amount: -50 } },
  { id: 'cc13', deck: 'chest', text: 'Receive $25 consultancy fee.', effect: { kind: 'money', amount: 25 } },
  { id: 'cc14', deck: 'chest', text: 'You are assessed for street repairs: $40 per house, $115 per hotel.', effect: { kind: 'repairs', perHouse: 40, perHotel: 115 } },
  { id: 'cc15', deck: 'chest', text: 'You have won second prize in a beauty contest. Collect $10.', effect: { kind: 'money', amount: 10 } },
  { id: 'cc16', deck: 'chest', text: 'You inherit $100.', effect: { kind: 'money', amount: 100 } },
];

const BY_ID: Record<string, Card> = {};
for (const c of [...CHANCE, ...CHEST]) BY_ID[c.id] = c;

export const cardById = (id: string): Card => BY_ID[id];
