/** Utility-файл: routeParams. */

export function routeParam(value: string | string[] | undefined): string {
	return Array.isArray(value) ? value[0] ?? '' : value ?? ''
}
