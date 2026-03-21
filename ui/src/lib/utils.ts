import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Strip :80 from http and :443 from https — for display and copy purposes. */
export function displayHost(host: string, scheme: string): string {
  const defaultPort = scheme === 'https' ? ':443' : ':80'
  return host.endsWith(defaultPort) ? host.slice(0, -defaultPort.length) : host
}
