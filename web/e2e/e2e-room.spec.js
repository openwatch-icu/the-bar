// @ts-check
/**
 * E2E room encryption spec: two browser contexts join the same room, User1 sends
 * an E2E message, User2 should see the decrypted plaintext (not the raw e2e. ciphertext).
 *
 * Requires a running server with E2E_ACCESS_CODE set. Both clients join with the
 * same access code so the room key can be wrapped/unwrapped correctly.
 */
import { test, expect } from '@playwright/test'

const ACCESS_CODE = process.env.E2E_ACCESS_CODE || 'e2etestcode16chars!!'
const TIMEOUT = 25000

/**
 * Fills login form and clicks Join. Waits for the chat layout to appear.
 * @param {import('@playwright/test').Page} page
 * @param {string} username
 */
async function joinChat(page, username) {
  await page.goto('/')

  const inviteInput = page.getByPlaceholder(/Invite.*access code/i)
  await inviteInput.waitFor({ state: 'visible', timeout: TIMEOUT })
  await inviteInput.fill(ACCESS_CODE)

  const usernameInput = page.getByPlaceholder('Username')
  await usernameInput.fill(username)

  const joinButton = page.getByRole('button', { name: /Join/i })
  await expect(joinButton).toBeEnabled({ timeout: TIMEOUT })
  await joinButton.click()

  await expect(
    page.locator('.chat-layout').or(page.getByText(/Welcome|#general/i))
  ).toBeVisible({ timeout: TIMEOUT })
}

test.describe('E2E room encryption', () => {
  test(
    'two users in the same room can exchange an E2E-encrypted message',
    async ({ browser }) => {
      // Two separate browser contexts → two separate E2E keypairs / sessions.
      const ctx1 = await browser.newContext()
      const ctx2 = await browser.newContext()
      const page1 = await ctx1.newPage()
      const page2 = await ctx2.newPage()

      try {
        await joinChat(page1, 'e2e_sender')
        await joinChat(page2, 'e2e_receiver')

        // Give the key-exchange a moment: page2 should receive the wrappedroomkey
        // that page1 uploaded when it joined first.
        await page1.waitForTimeout(1500)
        await page2.waitForTimeout(1500)

        // User1 types and sends a unique plaintext message.
        const plaintext = `e2e-test-${Date.now()}`
        const messageInput = page1.locator(
          'input[placeholder*="message" i], textarea[placeholder*="message" i], .chat-input input, .message-input'
        )
        await messageInput.first().fill(plaintext)
        await page1.keyboard.press('Enter')

        // User2 should see the decrypted plaintext, NOT the raw ciphertext.
        await expect(
          page2.getByText(plaintext, { exact: false })
        ).toBeVisible({ timeout: TIMEOUT })

        // Sanity: ciphertext prefix should not be visible as a raw line.
        // (The message might briefly show e2e. while decrypting, but after
        // decryption it should show the plaintext. We check after it settles.)
        await page2.waitForTimeout(500)
        const rawCipherVisible = await page2
          .getByText(/^e2e\.[A-Za-z0-9+/=]{10,}$/)
          .isVisible()
          .catch(() => false)
        expect(rawCipherVisible).toBe(false)
      } finally {
        await ctx1.close()
        await ctx2.close()
      }
    }
  )
})
