/** Router: authRouter. */

import { Router } from 'express'
import { requireAuth, type AuthRequest } from '../../../shared/middleware/auth'
import { asyncHandler } from '../../../shared/middleware/errorHandler'
import { createRateLimiter } from '../../../shared/middleware/rateLimit'
import { logoutSession, refreshSession, signInWithGoogle } from '../application/authService'
import {
	createOAuthState,
	getGoogleAuthUrl,
	getGoogleProfileFromCode,
} from '../infrastructure/googleOAuthProvider'

export const authRouter = Router()

const REFRESH_COOKIE_NAME = 'refreshToken'

const refreshCookieOptions = {
	httpOnly: true,
	secure: true,
	sameSite: 'none' as const,
	maxAge: 7 * 24 * 60 * 60 * 1000,
	path: '/api/auth',
}

const clearCookieOptions = {
	httpOnly: true,
	secure: true,
	sameSite: 'none' as const,
	path: '/api/auth',
}

const oauthRateLimit = createRateLimiter({
	windowMs: 10 * 60 * 1000,
	max: 20,
	keyPrefix: 'auth:oauth',
})

const refreshRateLimit = createRateLimiter({
	windowMs: 60 * 1000,
	max: 30,
	keyPrefix: 'auth:refresh',
})

// ── GET /api/auth/google ──────────────────────────────────────
// Цей маршрут запускає вхід через Google.
// Користувач не вводить тут email або пароль на нашому сервері. Замість цього ми готуємо спеціальне посилання на Google і перенаправляємо користувача туди. Далі Google сам перевіряє користувача, а потім повертає його на callback: GET /api/auth/google/callback.
authRouter.get('/google', oauthRateLimit, (_req, res) => {
	// state — це випадковий секретний рядок для одного OAuth-запиту.
	// Його головна задача — захистити процес авторизації від підміни. Ми створюємо state тут, передаємо його в Google URL, а ще зберігаємо в cookie. Коли Google поверне користувача назад, callback отримає state з URL і  порівняє його зі state з cookie.
	const state = createOAuthState()

	// getGoogleAuthUrl(state) створює повне посилання на сторінку Google.
	// У цьому посиланні вже є: client_id нашого застосунку; callback URL, куди Google поверне користувача; scope з дозволами на email і profile; state, який ми щойно створили.
	const url = getGoogleAuthUrl(state)

	// Зберігаємо state у cookie перед редиректом на Google.
	// Cookie потрібна тому, що після переходу на Google і повернення назад сервер має згадати, який саме state він створив на початку. Без цього callback не зміг би перевірити, чи відповідь від Google належить до нашого запиту.
	res.cookie('oauth_state', state, {
		// httpOnly: true означає, що JavaScript у браузері не може прочитати цю cookie. Це зменшує ризик крадіжки state через XSS.
		httpOnly: true,

		// У production cookie передається тільки через HTTPS. У local/dev режимі це вимкнено, щоб авторизацію можна було тестувати без HTTPS.
		secure: process.env.NODE_ENV === 'production',

		// sameSite: 'lax' допомагає проти CSRF. Це означає, що браузер не відправлятиме цю cookie, якщо запит походить з іншого сайту. 
		sameSite: 'lax',

		// maxAge задає час життя cookie в мілісекундах. 10 хвилин. Якщо користувач не завершить вхід за цей час, state застаріє і OAuth доведеться почати заново.
		maxAge: 10 * 60 * 1000,
	})

	// Після підготовки state і cookie перенаправляємо користувача на Google.
	res.redirect(url)
})

// ── GET /api/auth/google/callback ─────────────────────────────
// Цей маршрут спрацьовує після того, як користувач завершив дію на сторінці Google.
// Google повертає користувача назад на наш сервер і додає в URL спеціальні параметри: code і state.
// Тут ми перевіряємо, що запит безпечний, отримуємо профіль Google і створюємо токени для входу в наш застосунок.
authRouter.get('/google/callback', async (req, res) => {
	// req.query — це параметри з URL, які прийшли від Google. code — тимчасовий код авторизації.  state — випадковий рядок.
	const { code, state } = req.query as { code?: string; state?: string }

	// У нас є два значення: state з URL і storedState з cookie. Вони мають збігатися.
	const storedState = req.cookies?.oauth_state

	// Перевіряємо захист OAuth-запиту:
	//  - якщо state не прийшов з URL — запит підозрілий; якщо storedState немає в cookie — сервер не пам'ятає такого OAuth-запиту; якщо state і storedState різні — хтось міг підмінити або повторити запит.
	if (!state || !storedState || state !== storedState) {
		res.status(400).send('Invalid OAuth state. Please try again.')
		return
	}

	// Якщо state успішно перевірено, cookie більше не потрібна. Видаляємо її, щоб цей state не можна було використати повторно.
	res.clearCookie('oauth_state')

	// Якщо code немає, значить ми не можемо отримати профіль користувача від Google. Тому повертаємо користувача на сторінку логіну з error=oauth_cancelled.
	if (!code) {
		res.redirect(`${process.env.CLIENT_URL}/login?error=oauth_cancelled`)
		return
	}

	try {
		// Обмінюємо тимчасовий code на дані профілю Google. Усередині getGoogleProfileFromCode сервер звертається до Google, перевіряє id_token і повертає email, ім'я та googleId.
		const profile = await getGoogleProfileFromCode(code)

		// signInWithGoogle внутрішня логіка входу через Google. Вона знаходить користувача за googleId/email або створює нового, а потім генерує accessToken і refreshToken для нашого застосунку.
		const { accessToken, refreshToken } = await signInWithGoogle({
			email: profile.email,
			name: profile.name,
			googleId: profile.googleId,
		})

		// refreshToken зберігаємо в httpOnly cookie. Він потрібен, щоб пізніше оновлювати accessToken без повторного входу через Google.
		// httpOnly cookie не читається JavaScript-кодом у браузері, тому це безпечніше, ніж зберігати refreshToken у localStorage.
		res.cookie(REFRESH_COOKIE_NAME, refreshToken, refreshCookieOptions)

		// accessToken передаємо на фронтенд через redirect. Він додається після символу #, тобто у fragment URL. Fragment не відправляється назад на сервер у звичайних HTTP-запитах.
		// encodeURIComponent потрібен, щоб токен безпечно вставився в URL і не зламав його спеціальними символами.
		res.redirect(`${process.env.CLIENT_URL}/auth/callback#token=${encodeURIComponent(accessToken)}`)
	} catch (err: unknown) {
		// Якщо Google не повернув коректний token, профіль неповний, база не створила користувача або сталася інша помилка.
		// Ми не показуємо користувачу технічні деталі, а відправляємо його на login з error=oauth_failed. Для розробника помилка логуються в консоль сервера.
		const message = err instanceof Error ? err.message : String(err)
		console.error('[Auth] Google OAuth error:', message)
		res.redirect(`${process.env.CLIENT_URL}/login?error=oauth_failed`)
	}
})

// ── GET /api/auth/me ──────────────────────────────────────────
authRouter.get('/me', requireAuth, (req: AuthRequest, res) => {
	res.json(req.user)
})

// ── POST /api/auth/refresh ────────────────────────────────────
authRouter.post('/refresh', refreshRateLimit, asyncHandler(async (req, res) => {
	const refreshToken = req.cookies?.[REFRESH_COOKIE_NAME]
	const result = await refreshSession(refreshToken)

	if (!result.ok) {
		res.clearCookie(REFRESH_COOKIE_NAME, clearCookieOptions)
		const message = result.reason === 'missing'
			? 'Refresh token відсутній'
			: result.reason === 'invalid'
				? 'Невалідний refresh token'
				: 'Сесію завершено. Увійдіть знову.'
		res.status(401).json({ error: message })
		return
	}

	res.cookie(REFRESH_COOKIE_NAME, result.refreshToken, refreshCookieOptions)
	res.json({ accessToken: result.accessToken, user: result.user })
}))

// ── POST /api/auth/logout ─────────────────────────────────────
authRouter.post('/logout', asyncHandler(async (req, res) => {
	const refreshToken = req.cookies?.[REFRESH_COOKIE_NAME]
	await logoutSession(refreshToken)

	res.clearCookie(REFRESH_COOKIE_NAME, clearCookieOptions)
	res.json({ success: true })
}))
