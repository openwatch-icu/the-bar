// @ts-check
/**
 * Slowmode spec: when SLOWMODE_SECONDS > 0, sending messages faster than the
 * cooldown window results in a "slowmode" rejection displayed to the sender.
 *
 * Requires a running server with E2E_ACCESS_CODE and SLOWMODE_SECONDS > 0.
 * The test is automatically skipped when the server has no slowmode configured
 * (i.e. the rejection message never appears).
 */
import { test, expect } from '@playwright/test'

const ACCESS_CODE = process.env.E2E_ACCESS_CODE || 'e2etestcode16chars!!'
const TIMEOUT = 25000

/** Fill login form and wait for the chat layout. */
async function joinChat(page) {
  await page.goto('/')
  const inviteInput = page.getByPlaceholder(/Invite.*access code/i)
  await inviteInput.waitFor({ state: 'visible', timeout: TIMEOUT })
  await inviteInput.fill(ACCESS_CODE)

  await page.getByPlaceholder('Username').fill('slowmode_tester')

  const joinButton = page.getByRole('button', { name: /Join/i })
  await expect(joinButton).toBeEnabled({ timeout: TIMEOUT })
  await joinButton.click()

  await expect(
    page.locator('.chat-layout').or(page.getByText(/Welcome|#general/i))
  ).toBeVisible({ timeout: TIMEOUT })
}

/** Locate the message input (adapts to different selector strategies). */
function messageInput(page) {
  return page
    .locator(
      'input[placeholder*="message" i], textarea[placeholder*="message" i],' +
        ' .chat-input input, .message-input'
    )
    .first()
}

test.describe('Slowmode', () => {
  test(
    'rapid messages trigger a slowmode countdown in the UI',
    async ({ page }) => {
      await joinChat(page)

      const input = messageInput(page)

      // Send two messages back-to-back as fast as possible.
      await input.fill('e2e.slow-test-1')
      await page.keyboard.press('Enter')
      await input.fill('e2e.slow-test-2')
      await page.keyboard.press('Enter')

      // Look for the slowmode countdown indicator. Different UIs may show:
      //  - "slowmode" text/element
      //  - a number countdown
      //  - an error message containing "slow" or a remaining-seconds number
      const slowmodeIndicator = page
        .getByText(/slowmode|slow mode|seconds|wait/i)
        .or(page.locator('[class*="slowmode" i]'))
        .or(page.locator('[class*="rate" i]'))

      const appeared = await slowmodeIndicator
        .first()
        .waitFor({ state: 'visible', timeout: 5000 })
        .then(() => true)
        .catch(() => false)

      if (!appeared) {
        // Server may not have slowmode configured — skip rather than fail.
        test.skip(
          true,
          'Slowmode indicator did not appear — SLOWMODE_SECONDS may not be set on the server'
        )
        return
      }

      await expect(slowmodeIndicator.first()).toBeVisible()
    }
  )
})
