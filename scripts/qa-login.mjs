import { chromium } from '@playwright/test';

const {
  QA_LOGIN_URL,
  QA_USER,
  QA_PASSWORD
} = process.env;

if (!QA_LOGIN_URL || !QA_USER || !QA_PASSWORD) {
  throw new Error(
    'Faltan QA_LOGIN_URL, QA_USER o QA_PASSWORD'
  );
}

const browser = await chromium.launch({
  headless: true
});

const context = await browser.newContext();
const page = await context.newPage();

console.log(`Abriendo ${QA_LOGIN_URL}`);

await page.goto(QA_LOGIN_URL, {
  waitUntil: 'domcontentloaded'
});

const userInput = page.locator([
  'input[type="email"]',
  'input[name="email"]',
  'input[name="username"]',
  'input[name="user"]'
].join(',')).first();

const passwordInput = page.locator(
  'input[type="password"]'
).first();

await userInput.fill(QA_USER);
await passwordInput.fill(QA_PASSWORD);

const submit = page.locator([
  'button[type="submit"]',
  'input[type="submit"]'
].join(',')).first();

await submit.click();

await page.waitForLoadState('networkidle').catch(() => {});

await page.waitForTimeout(1500);

console.log(`URL después del login: ${page.url()}`);

if (
  page.url().includes('/login') ||
  page.url().includes('/signin')
) {
  console.error('El login parece haber fallado.');
  await browser.close();
  process.exit(1);
}

await context.storageState({
  path: 'playwright/.auth/monkeytest.json'
});

console.log(
  'Sesión guardada en playwright/.auth/monkeytest.json'
);

await browser.close();
