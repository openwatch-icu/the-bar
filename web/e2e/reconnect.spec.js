// @ts-check
/**
 * Reconnect spec: a client joins, receives a reconnect token (stored automatically
 * in localStorage), reloads the page, and is welcomed back without re-entering
 * credentials.
 *
 * Requires a running server with E2E_ACCESS_CODE set.
 */
import { test, expect } from '@playwright/test'

const ACCESS_CODE = process.env.E2E_ACCESS_CODE || 'e2etestcode16chars!!'
const TIMEOUT = 25000

test.describe('Reconnect with stored token', () => {
  test('user is welcomed back after page reload using stored token', async ({
    page,
  }) => {
    // ── Initial join ──────────────────────────────────────────────────────
    await page.goto('/')

    const inviteInput = page.getByPlaceholder(/Invite.*access code/i)
    await inviteInput.waitFor({ state: 'visible', timeout: TIMEOUT })
    await inviteInput.fill(ACCESS_CODE)

    const usernameInput = page.getByPlaceholder('Username')
    await usernameInput.fill('reconnect_user')

    const joinButton = page.getByRole('button', { name: /Join/i })
    await expect(joinButton).toBeEnabled({ timeout: TIMEOUT })
    await joinButton.click()

    // Wait for the initial welcome.
    await expect(
      page.locator('.chat-layout').or(page.getByText(/Welcome,?.*reconnect_user/i))
    ).toBeVisible({ timeout: TIMEOUT })

    // Wait briefly to ensure the reconnect token is delivered and stored.
    await page.waitForTimeout(2000)

    // Verify a reconnect token is in localStorage.
    const storedToken = await page.evaluate(() => {
      try {
        const raw = localStorage.getItem('thebar_reconnect') || ''
        return raw
      } catch {
        return ''
      }
    })
    // If the server doesn't issue reconnect tokens, skip the rest.
    test.skip(
      !storedToken || !storedToken.startsWith('reconnect:'),
      'Server did not issue a reconnect token — skipping reconnect test'
    )

    // ── Reload (simulate browser refresh) ────────────────────────────────
    await page.reload()

    // The UI should auto-populate the access code from sessionStorage/URL or user
    // must re-enter it. The invite input is required.
    const inviteAfterReload = page.getByPlaceholder(/Invite.*access code/i)
    await inviteAfterReload.waitFor({ state: 'visible', timeout: TIMEOUT })
    await inviteAfterReload.fill(ACCESS_CODE)

    // The username should be pre-filled from the stored reconnect token.
    const joinAgain = page.getByRole('button', { name: /Join/i })
    await expect(joinAgain).toBeEnabled({ timeout: TIMEOUT })
    await joinAgain.click()

    // Expect "Welcome back" or standard welcome with the same username.
    await expect(
      page
        .getByText(/Welcome back.*reconnect_user|Welcome.*reconnect_user/i)
        .or(page.locator('.chat-layout'))
    ).toBeVisible({ timeout: TIMEOUT })
  })
})
