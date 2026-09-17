/* Scratch screenshot harness (not shipped): drives the preview build with
 * the system Chrome so UI changes can be reviewed as pixels.
 *   node scripts/shots.mjs home                 front door
 *   node scripts/shots.mjs lobby [board]        hosted lobby (board = silk|tashkent|europe)
 *   node scripts/shots.mjs game [board]         practice game, flat board
 */
import puppeteer from 'puppeteer-core';

const BASE = 'http://localhost:4199/monopoly/';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const [, , what = 'home', board] = process.argv;
const suffix = board && board !== 'silk' ? `?board=${board}` : '';

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--window-size=1440,900', '--force-device-scale-factor=1'],
  defaultViewport: { width: 1440, height: 900 },
});
const page = await browser.newPage();

if (what === 'home') {
  await page.goto(BASE, { waitUntil: 'networkidle0', timeout: 60000 });
  await new Promise((r) => setTimeout(r, 1500));
  await page.screenshot({ path: 'shot-home.png' });
} else {
  await page.goto(BASE + suffix, { waitUntil: 'networkidle0', timeout: 60000 });
  // Take a seat as a guest, then host a private table.
  const nameInput = await page.$('.entry input');
  if (nameInput) await nameInput.type('Shooter');
  if (what === 'game') {
    await page.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find((x) => /practice/i.test(x.textContent));
      if (b) b.click();
    });
    await new Promise((r) => setTimeout(r, 400));
  }
  const clicked = await page.evaluate(() => {
    const b = document.querySelector('.entry .btn--primary')
      ?? [...document.querySelectorAll('button')].find((x) => /create|start/i.test(x.textContent));
    if (b) { b.click(); return b.textContent.trim().slice(0, 60); }
    return null;
  });
  console.log('clicked:', clicked);
  await new Promise((r) => setTimeout(r, 4000));
  if (what === 'game') {
    const startClicked = await page.evaluate(() => {
      const b = document.querySelector('.lobby__foot .btn--primary');
      if (b) { b.click(); return b.textContent.trim(); }
      return null;
    });
    console.log('start:', startClicked);
    await new Promise((r) => setTimeout(r, 8000));
  }
  await page.screenshot({ path: `shot-${what}${board ? '-' + board : ''}.png` });
  console.log('url now:', page.url());
}

await browser.close();
