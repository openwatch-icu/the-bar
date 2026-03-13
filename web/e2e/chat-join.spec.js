// @ts-check
import { test, expect } from '@playwright/test'

const ACCESS_CODE = process.env.E2E_ACCESS_CODE || 'e2etestcode16chars!!'

test.describe('Chat join and send', () => {
  test('can open app, join with access code and username, and see chat UI', async ({
    page,
  }) => {
    await page.goto('/')
    // Wait for login form (invite input or heading); session-info fetch may delay first paint
    const inviteInput = page.getByPlaceholder(/Invite.*access code/i)
    await inviteInput.waitFor({ state: 'visible', timeout: 15000 })
    await inviteInput.fill(ACCESS_CODE)

    const usernameInput = page.getByPlaceholder('Username')
    await usernameInput.fill('e2euser')

    const joinButton = page.getByRole('button', { name: /Join/i })
    // Wait for session-info to finish (button enabled); avoid clicking while "Loading session…" is shown
    await expect(joinButton).toBeEnabled({ timeout: 15000 })
    await joinButton.click()

    // Chat UI: sidebar or main area
    const chatLayout = page.locator('.chat-layout')
    const chatText = page.getByText(/Welcome|Recent messages|#general|e2e\./i)
    const success = chatLayout.or(chatText)
    try {
      await expect(success).toBeVisible({ timeout: 20000 })
    } catch (e) {
      const errText = await page.locator('.login-error').first().textContent().catch(() => '')
      const loading = await page.getByText(/Loading session/i).isVisible().catch(() => false)
      throw new Error(
        errText
          ? `Join failed: ${errText.trim()}`
          : loading
            ? 'Join timed out (still loading session)'
            : 'Join timed out (no chat UI and no login error visible)',
        { cause: e }
      )
    }
  })
})
